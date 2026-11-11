import type { Pass } from '../types';
import { ranges } from './passes';
import { toCSV } from './csv';

/** The column the report is grouped by first; the other one is the sub-group. */
export type ReportBy = 'area' | 'dept';

export const BY_LABEL: Record<ReportBy, string> = { area: 'Area', dept: 'Dept' };
const other = (by: ReportBy): ReportBy => (by === 'area' ? 'dept' : 'area');

export interface ReportLine {
  label: string;
  mobile: number;
  bike: number;
  total: number;
  serials: string;
  incharges: string;
}

export interface ReportGroup extends ReportLine {
  lines: ReportLine[];
}

export interface Report {
  by: ReportBy;
  groups: ReportGroup[];
  total: ReportLine;
}

function line(label: string, ps: Pass[]): ReportLine {
  const mobile = ps.filter((p) => p.type === 'Mobile').length;
  return {
    label,
    mobile,
    bike: ps.length - mobile,
    total: ps.length,
    serials: ranges(ps),
    incharges: [...new Set(ps.map((p) => p.incharge).filter(Boolean))].join(', '),
  };
}

const norm = (v: string) => v.trim().replace(/\s+/g, ' ');

/** "Sirsa", "SIRSA" and "sirsa " are one value, written the way it's spelled most often. */
function spellings(ps: Pass[], k: ReportBy): Map<string, string> {
  const count = new Map<string, number>();
  for (const p of ps) count.set(norm(p[k]), (count.get(norm(p[k])) ?? 0) + 1);
  const best = new Map<string, [string, number]>();
  for (const [v, n] of count) {
    const b = best.get(v.toLowerCase());
    if (!b || n > b[1]) best.set(v.toLowerCase(), [v, n]);
  }
  return new Map([...best].map(([key, [v]]) => [key, v]));
}

/** Splits passes by a column, ignoring case. Sorted A–Z, with blanks ("(no area)") last. */
function bucket(ps: Pass[], k: ReportBy, labels: Map<string, string>): [string, Pass[]][] {
  const map = new Map<string, Pass[]>();
  for (const p of ps) {
    const key = norm(p[k]).toLowerCase();
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return [...map]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)))
    .map(([key, list]) => [key ? labels.get(key)! : `(no ${BY_LABEL[k].toLowerCase()})`, list]);
}

/** Pass counts and serial numbers grouped by Area then Dept (or Dept then Area). */
export function buildReport(passes: Pass[], by: ReportBy): Report {
  const labels = { area: spellings(passes, 'area'), dept: spellings(passes, 'dept') };
  return {
    by,
    groups: bucket(passes, by, labels[by]).map(([label, ps]) => ({
      ...line(label, ps),
      lines: bucket(ps, other(by), labels[other(by)]).map(([sub, list]) => line(sub, list)),
    })),
    total: line('Total', passes),
  };
}

/** The report as a CSV file: one row per sub-group, a total row after each group, and a grand total. */
export function reportCSV(r: Report): string {
  const n = (l: ReportLine) => [String(l.mobile), String(l.bike), String(l.total)];
  const rows = [[BY_LABEL[r.by], BY_LABEL[other(r.by)], 'Mobile', 'Bike', 'Total', 'Serial nos.', 'Incharges']];
  for (const g of r.groups) {
    for (const l of g.lines) rows.push([g.label, l.label, ...n(l), l.serials, l.incharges]);
    rows.push([g.label, 'Total', ...n(g), '', '']);
  }
  rows.push(['All', 'Total', ...n(r.total), '', '']);
  return toCSV(rows);
}
