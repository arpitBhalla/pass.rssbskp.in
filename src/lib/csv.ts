import {
  cleanText, type CreateOp, type Field, FIELD_LABELS, fieldsFor, fmtSerial, isPassType, PASS_TYPES, type Pass, type PassType,
  type SetOp, TYPE_INFO,
} from '@/shared/types';
import { isGiven, isPrinted, localDay, parseSerial } from './passes';

/** Parses CSV (comma or semicolon separated, quoted fields, optional BOM). */
export function parseCSV(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n')[0];
  const delim = first.split(';').length > first.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** CSV text that opens in Excel (the BOM keeps Hindi / Punjabi names readable). */
export function toCSV(rows: string[][]): string {
  const cell = (v: string) => (/[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Excel turns "+919876543210" into 9.19E+11 and drops leading zeros; ="..." keeps it as text. */
const excelText = (v: string) => (/^\+|^0|^\d{12,}$/.test(v) ? `="${v}"` : v);

/** `names`: user id → name, for the Added by column. */
export function exportCSV(rows: Pass[], type: PassType, names: Map<number, string> = new Map()): string {
  const cols = fieldsFor(type);
  return toCSV([
    ['Sr. No.', 'Pass type', ...cols.map((k) => FIELD_LABELS[k]), 'Status', 'Printed', 'Added', 'Added by'],
    ...rows.map((p) => [
      `="${fmtSerial(p.serial)}"`, TYPE_INFO[p.type].label,
      ...cols.map((k) => (k === 'phone' ? excelText(p[k]) : p[k])),
      isGiven(p) ? 'Given' : 'Free', isPrinted(p) ? 'Yes' : '', localDay(p.created_at), names.get(p.created_by) ?? '',
    ]),
  ]);
}

/** Which sheet a CSV row belongs to: from a "Pass type" column (new exports) or Type + Pandal (old app). */
function rowType(passType: string, oldType: string, zone: string): PassType | 'unknown' | null {
  if (passType) {
    const t = PASS_TYPES.find((x) => TYPE_INFO[x].label.toLowerCase() === passType.trim().toLowerCase() || x === passType.trim());
    return t ?? 'unknown';
  }
  if (!oldType) return null; // no type info: goes into the open sheet
  const kind = /^\s*b/i.test(oldType) ? 'bike' : /^\s*m/i.test(oldType) ? 'mobile' : '';
  const where = /non|out/i.test(zone) ? 'non-pandal' : /pandal|^\s*in/i.test(zone) ? 'pandal' : '';
  const t = `${kind}-${where}`;
  return isPassType(t) ? t : 'unknown';
}

export interface ImportPlan {
  set: SetOp[];
  create: CreateOp[];
  /** Rows for another sheet, or whose sheet can't be told (old file without Pandal / Non Pandal). */
  otherSheet: number;
  unknownSheet: number;
  /** Rows left alone: a cell differs from what's saved (never overwritten), or the pass is printed. */
  clashes: string[];
  same: number;
  error: string;
}

/**
 * Merges a CSV into one sheet, matching on serial number. Blank cells never erase anything and
 * filled cells never overwrite a different saved value: those rows are listed instead.
 */
export function planImport(sheet: Pass[], type: PassType, text: string): ImportPlan {
  const plan: ImportPlan = { set: [], create: [], otherSheet: 0, unknownSheet: 0, clashes: [], same: 0, error: '' };
  const rows = parseCSV(text);
  if (rows.length < 2) return { ...plan, error: 'That file has no data rows.' };
  const head = rows[0].map((h) => h.trim());
  const find = (re: RegExp, not?: number) => head.findIndex((h, i) => i !== not && re.test(h));
  const c = {
    serial: find(/serial|sr\.?\s*no|token|pass\s*no|^no\.?$/i),
    passType: find(/pass\s*type/i),
    oldType: find(/^type$/i),
    zone: find(/pandal/i),
    incharge: find(/in-?charge|given\s*to/i),
    dept: find(/dept|department/i),
    area: find(/area|centre|center|city/i),
    phone: find(/phone|contact|mobile\s*no/i),
    vehicle_no: find(/reg(istration)?\.?\s*no|vehicle\s*no|veh\.?\s*reg/i),
    vehicle: find(/^vehicle$|vehicle\s*(type|model|make|name)/i),
    printed: find(/printed/i),
    name: -1,
  };
  c.name = find(/name/i, c.incharge);
  if (c.serial < 0) return { ...plan, error: 'Could not find a "Sr. No." or "Serial" column in the first row.' };

  const cell = (r: string[], i: number) => (i < 0 ? '' : cleanText((r[i] ?? '').replace(/^="(.*)"$/, '$1')));
  const cols = fieldsFor(type);
  const bySerial = new Map(sheet.map((p) => [p.serial, p]));
  const seen = new Set<number>();

  for (const r of rows.slice(1)) {
    const serial = parseSerial(cell(r, c.serial));
    if (Number.isNaN(serial) || serial < 1) continue;
    const t = rowType(cell(r, c.passType), cell(r, c.oldType), cell(r, c.zone));
    if (t === 'unknown') { plan.unknownSheet++; continue; }
    if (t && t !== type) { plan.otherSheet++; continue; }
    if (seen.has(serial)) continue; // a repeated row: the first one counts
    seen.add(serial);
    const values = Object.fromEntries(cols.map((k) => [k, cell(r, c[k])]).filter(([, v]) => v)) as Partial<Record<Field, string>>;
    const printed = /^(y|true|1|✓)/i.test(cell(r, c.printed));
    const p = bySerial.get(serial);
    if (!p) {
      plan.create.push({ type, serial, values, printed });
      continue;
    }
    const keys = Object.keys(values) as Field[];
    const clash = keys.find((k) => p[k] && p[k] !== values[k]);
    const changed = keys.filter((k) => p[k] !== values[k]);
    const tick = printed && !isPrinted(p);
    if (clash) plan.clashes.push(`${fmtSerial(serial)} (${FIELD_LABELS[clash]})`);
    else if (changed.length && isPrinted(p)) plan.clashes.push(`${fmtSerial(serial)} (printed)`);
    else if (!changed.length && !tick) plan.same++;
    else {
      plan.set.push({
        id: p.id,
        values: Object.fromEntries(changed.map((k) => [k, values[k]])),
        ...(tick ? { printed: true } : {}),
        expect: { ...Object.fromEntries(changed.map((k) => [k, p[k]])), ...(tick ? { printed: false } : {}) },
      });
    }
  }
  return plan;
}
