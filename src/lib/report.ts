import { PASS_TYPES, SHEETS, type Pass, type PassType, TYPE_INFO } from '@/shared/types';
import { toCSV } from './csv';
import { isBlank, localDay, ranges } from './passes';

/** The column the report is grouped by first; the other one is the sub-group. */
export type ReportBy = 'area' | 'dept';
export const BY_LABEL: Record<ReportBy, string> = { area: 'Area', dept: 'Dept' };
const other = (by: ReportBy): ReportBy => (by === 'area' ? 'dept' : 'area');

export interface ReportLine {
  label: string;
  counts: Record<PassType, number>;
  total: number;
  /** "MP 0101–0150 · BN 0001–0004" */
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
  const counts = Object.fromEntries(PASS_TYPES.map((t) => [t, 0])) as Record<PassType, number>;
  const byType = new Map<PassType, number[]>();
  for (const p of ps) {
    counts[p.type]++;
    const list = byType.get(p.type);
    if (list) list.push(p.serial);
    else byType.set(p.type, [p.serial]);
  }
  return {
    label,
    counts,
    total: ps.length,
    serials: SHEETS.filter((t) => byType.has(t)).map((t) => `${TYPE_INFO[t].short} ${ranges(byType.get(t)!)}`).join(' · '),
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

/** Pass counts per sheet, grouped by Area then Dept (or Dept then Area). Empty rows (nothing filled in) aren't counted. */
export function buildReport(all: Pass[], by: ReportBy): Report {
  const passes = all.filter((p) => p.lost_at === null && !isBlank(p.type, p)); // a lost pass is counted once, as its duplicate
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

/** The report's headline numbers, per sheet. */
export const STATS = ['passes', 'printed', 'given', 'today', 'toGive', 'unprinted', 'lost'] as const;
export type Stat = (typeof STATS)[number];
export const STAT_LABEL: Record<Stat, string> = {
  passes: 'Passes', printed: 'Printed', given: 'Given', today: 'Given today', toGive: 'Printed, not given yet', unprinted: 'Not printed yet', lost: 'Lost',
};

/** Counts per sheet. Empty rows aren't counted, and a lost pass only as Lost (its duplicate is counted as the pass). */
export function buildStats(all: Pass[], today = localDay(new Date().toISOString())): Record<Stat, Record<PassType, number>> {
  const s = Object.fromEntries(STATS.map((k) => [k, Object.fromEntries(PASS_TYPES.map((t) => [t, 0]))])) as Record<Stat, Record<PassType, number>>;
  for (const p of all) {
    if (isBlank(p.type, p)) continue;
    if (p.lost_at !== null) { s.lost[p.type]++; continue; }
    s.passes[p.type]++;
    if (p.printed_at === null) s.unprinted[p.type]++;
    else {
      s.printed[p.type]++;
      if (p.given_at === null) s.toGive[p.type]++;
    }
    if (p.given_at !== null) {
      s.given[p.type]++;
      if (localDay(p.given_at) === today) s.today[p.type]++;
    }
  }
  return s;
}

/** The report as a CSV file: one row per sub-group, a total row after each group, and a grand total. */
export function reportCSV(r: Report): string {
  const n = (l: ReportLine) => [...SHEETS.map((t) => String(l.counts[t])), String(l.total)];
  const rows = [[BY_LABEL[r.by], BY_LABEL[other(r.by)], ...SHEETS.map((t) => TYPE_INFO[t].label), 'Total', 'Serial nos.', 'Incharges']];
  for (const g of r.groups) {
    for (const l of g.lines) rows.push([g.label, l.label, ...n(l), l.serials, l.incharges]);
    rows.push([g.label, 'Total', ...n(g), '', '']);
  }
  rows.push(['All', 'Total', ...n(r.total), '', '']);
  return toCSV(rows);
}
