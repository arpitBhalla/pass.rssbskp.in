import type { Pass } from '../types';
import { isGiven, newPass, parseType, parseZone, serialNum, sortPasses } from './passes';

/** Parses CSV (comma or semicolon separated, quoted fields, optional BOM). */
export function parseCSV(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
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

export type ImportResult =
  | { ok: false; error: string }
  | { ok: true; passes: Pass[]; added: number; updated: number };

/**
 * Merges a CSV (columns: Serial, Type, Pandal / Non Pandal, Name, Dept, Area, Phone, Incharge, Printed — only Serial is required)
 * into the register, matching on type + serial number. Blank cells never erase data.
 */
export function importCSV(passes: Pass[], text: string): ImportResult {
  const rows = parseCSV(text);
  if (rows.length < 2) return { ok: false, error: 'That file has no data rows.' };
  const head = rows[0].map((h) => h.trim());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const cSerial = find(/serial|token|pass\s*no|^no\.?$/i);
  const cIncharge = find(/in-?charge|given\s*to/i);
  const cType = find(/^type$|pass\s*type/i);
  const cDept = find(/dept|department/i);
  const cArea = find(/area|centre|center|city/i);
  const cPhone = find(/phone|contact|mobile\s*no/i);
  const cZone = find(/pandal/i);
  const cPrinted = find(/printed/i);
  const cName = head.findIndex((h, i) => i !== cIncharge && /name/i.test(h));
  if (cSerial < 0) return { ok: false, error: 'Could not find a "Serial" column in the first row.' };

  // ="..." is how Excel-safe text (phone numbers) is exported; unwrap it.
  const cell = (r: string[], i: number) => (i < 0 ? '' : (r[i] ?? '').trim().replace(/^="(.*)"$/, '$1'));
  const key = (type: string, num: number) => `${type}|${num}`;
  const byKey = new Map(passes.map((p) => [key(p.type, p.num), p]));
  let added = 0;
  let updated = 0;

  for (const r of rows.slice(1)) {
    const serial = cell(r, cSerial);
    const num = serialNum(serial);
    if (!serial || Number.isNaN(num)) continue;
    const type = parseType(cell(r, cType)) ?? parseType(serial) ?? 'Mobile';
    const existing = byKey.get(key(type, num));
    const p = existing ? { ...existing } : newPass(type, serial, num);
    if (existing) updated++; else added++;
    const cols = { name: cName, dept: cDept, area: cArea, phone: cPhone, incharge: cIncharge } as const;
    for (const [k, i] of Object.entries(cols) as [keyof typeof cols, number][]) {
      const v = cell(r, i);
      if (v) p[k] = v;
    }
    if (type === 'Mobile' && parseZone(cell(r, cZone))) p.zone = parseZone(cell(r, cZone));
    if (/^(y|true|1|✓)/i.test(cell(r, cPrinted))) p.printed = true;
    byKey.set(key(type, num), p);
  }
  return { ok: true, passes: sortPasses([...byKey.values()]), added, updated };
}

/** CSV text that opens in Excel (BOM keeps Hindi/Punjabi names readable). */
export function toCSV(rows: string[][]): string {
  const cell = (v: string) => (/[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** The pass list as a CSV file. */
export function exportCSV(rows: Pass[]): string {
  // Excel turns "+919876543210" into 9.19E+11 and drops leading zeros; ="..." keeps it as text.
  const phone = (v: string) => (/^\+|^0|^\d{12,}$/.test(v) ? `="${v}"` : v);
  return toCSV([
    ['Serial', 'Type', 'Pandal / Non Pandal', 'Name', 'Dept', 'Area', 'Phone', 'Incharge', 'Status', 'Printed'],
    ...rows.map((p) => [
      p.serial, p.type, p.zone, p.name, p.dept, p.area, phone(p.phone), p.incharge, isGiven(p) ? 'Given' : 'Free', p.printed ? 'Yes' : '',
    ]),
  ]);
}
