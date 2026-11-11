import { EDIT_KEYS, FILL_KEYS, TYPES, type EditKey, type FillKey, type Pass, type PassType, type PassZone } from '../types';

let seq = 0;
export function uid(): string {
  return Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Number part of a serial: "M-0105" → 105, "105" → 105. NaN if there is none. */
export function serialNum(s: string): number {
  const m = String(s ?? '').match(/(\d+)\D*$/);
  return m ? parseInt(m[1], 10) : NaN;
}

export const nPasses = (n: number) => `${n} pass${n === 1 ? '' : 'es'}`;

/** A pass is "given" once it has a name or an incharge on it. */
export const isGiven = (p: Pass) => Boolean(p.name || p.incharge);

export function newPass(type: PassType, serial: string, num: number): Pass {
  return { id: uid(), type, serial, num, name: '', dept: '', area: '', phone: '', incharge: '', zone: '', printed: false };
}

/** "Non Pandal", "non-pandal", "outside" → Non Pandal; "Pandal", "inside" → Pandal; anything else → ''. */
export function parseZone(s: string): PassZone | '' {
  if (/non|out/i.test(s)) return 'Non Pandal';
  if (/pandal|^\s*in/i.test(s)) return 'Pandal';
  return '';
}

export function parseType(s: string): PassType | null {
  if (/^\s*b/i.test(s)) return 'Bike';
  if (/^\s*m/i.test(s)) return 'Mobile';
  return null;
}

/** Rebuilds a pass from saved data; null if unusable. */
export function normalize(raw: unknown): Pass | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
  const serial = str('serial');
  const num = typeof r.num === 'number' ? r.num : serialNum(serial);
  if (!serial || Number.isNaN(num)) return null;
  const type = parseType(str('type')) ?? 'Mobile';
  return {
    id: str('id') || uid(), type, serial, num,
    name: str('name'), dept: str('dept'), area: str('area'), phone: str('phone'), incharge: str('incharge'),
    zone: type === 'Mobile' ? parseZone(str('zone')) : '',
    printed: r.printed === true,
  };
}

export function sortPasses(list: Pass[]): Pass[] {
  return [...list].sort(
    (a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.num - b.num || a.serial.localeCompare(b.serial),
  );
}

/** Compresses passes into readable ranges: "M-101–M-145, M-150, B-001–B-010". */
export function ranges(list: Pass[]): string {
  const out: string[] = [];
  for (const t of TYPES) {
    const ps = list.filter((p) => p.type === t).sort((a, b) => a.num - b.num);
    for (let i = 0; i < ps.length; ) {
      let j = i;
      while (j + 1 < ps.length && ps[j + 1].num === ps[j].num + 1) j++;
      out.push(i === j ? ps[i].serial : `${ps[i].serial}–${ps[j].serial}`);
      i = j + 1;
    }
  }
  return out.join(', ');
}

/* ---------------- search ---------------- */

export interface Filters {
  q: string;
  type: PassType | '';
  show: 'all' | 'free' | 'given';
}

export function filterPasses(passes: Pass[], f: Filters): Pass[] {
  const q = f.q.trim().toLowerCase();
  const qNum = /^\d+$/.test(q) ? parseInt(q, 10) : null;
  return passes.filter(
    (p) =>
      (!f.type || p.type === f.type) &&
      (f.show === 'all' || (f.show === 'given') === isGiven(p)) &&
      (!q ||
        (qNum !== null
          ? p.num === qNum || (q.length >= 5 && p.phone.includes(q)) // a plain number = that serial (gate check), or a phone
          : [p.serial, p.name, p.dept, p.area, p.phone, p.incharge, p.zone].some((v) => v.toLowerCase().includes(q)))),
  );
}

/* ---------------- editing ---------------- */

/** Sets one column on the given passes. Returns the same array when nothing changed. */
export function editPasses(passes: Pass[], ids: ReadonlySet<string>, key: FillKey, value: string): Pass[] {
  const v = value.trim();
  let changed = false;
  const next = passes.map((p) => {
    if (!ids.has(p.id) || p[key] === v) return p;
    changed = true;
    return { ...p, [key]: v };
  });
  return changed ? next : passes;
}

export const editPass = (passes: Pass[], id: string, key: FillKey, value: string) => editPasses(passes, new Set([id]), key, value);

/** Ticks or unticks Printed on the given passes. Returns the same array when nothing changed. */
export function setPrinted(passes: Pass[], ids: ReadonlySet<string>, printed: boolean): Pass[] {
  let changed = false;
  const next = passes.map((p) => {
    if (!ids.has(p.id) || p.printed === printed) return p;
    changed = true;
    return { ...p, printed };
  });
  return changed ? next : passes;
}

/* ---------------- collapsing a series given to someone ---------------- */

/**
 * Splits the visible passes into runs: consecutive serials of one type that were given to the same
 * incharge with identical details (Pandal / Non Pandal and Printed too) collapse into one run; everything else is a run of one.
 */
export function groupRuns(view: Pass[]): Pass[][] {
  const runs: Pass[][] = [];
  for (const p of view) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    const joins = prev && p.incharge && prev.type === p.type && p.num === prev.num + 1 && prev.printed === p.printed && FILL_KEYS.every((k) => prev[k] === p[k]);
    if (joins) run.push(p);
    else runs.push([p]);
  }
  return runs;
}

/** A selected stretch of serial numbers of one type. */
export interface Span {
  type: PassType;
  lo: number;
  hi: number;
}

/** True when clipboard text spans several cells (copied from Excel: has a line break or a tab). */
export function isMultiCell(text: string): boolean {
  return /[\t\n]/.test(text.replace(/\r/g, '').replace(/\n+$/, ''));
}

/**
 * Pastes a block copied from Excel: each line fills one on-screen row downward from row `start`;
 * tab-separated cells fill the columns to the right (Name, Dept, Area, Phone, Incharge).
 * `rows` lists the passes behind each on-screen row (a collapsed series is one row of many passes).
 */
export function pasteCells(passes: Pass[], rows: Pass[][], start: number, key: EditKey, text: string) {
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  const c0 = EDIT_KEYS.indexOf(key);
  const updates = new Map<string, Pass>();
  let filled = 0;
  lines.forEach((line, r) => {
    const targets = rows[start + r];
    if (!targets) return;
    filled++;
    for (const target of targets) {
      const next = { ...target };
      line.split('\t').forEach((cell, c) => {
        const k = EDIT_KEYS[c0 + c];
        if (k) next[k] = cell.trim();
      });
      updates.set(target.id, next);
    }
  });
  return {
    passes: passes.map((p) => updates.get(p.id) ?? p),
    rows: filled,
    extra: lines.length - filled,
  };
}

/* ---------------- filling a range (give to incharge, set dept, …) ---------------- */

/** The serial range picked in the Give / fill box (typed, or set by selecting rows). */
export interface FillRange {
  type: PassType;
  from: string;
  to: string;
}

/** The rows a From / To range covers, or null if From is empty. */
export function rangeSpan(r: FillRange): Span | null {
  const f = serialNum(r.from);
  if (Number.isNaN(f)) return null;
  const t = Number.isNaN(serialNum(r.to)) ? f : serialNum(r.to);
  return { type: r.type, lo: Math.min(f, t), hi: Math.max(f, t) };
}

/** Values to write into a range of passes; only non-empty ones are used. */
export type FillValues = Partial<Pick<Pass, FillKey>>;

export const FIELD_LABELS: Record<FillKey, string> = {
  name: 'Name', dept: 'Dept', area: 'Area', phone: 'Phone', incharge: 'Incharge', zone: 'Pandal / Non Pandal',
};

/** "Name: Ram" — or just "Pandal" for Pandal / Non Pandal. */
export const describeValue = (k: FillKey, v: string) => (k === 'zone' ? v : `${FIELD_LABELS[k]}: ${v}`);

/** Trims the values and drops empty ones. */
export function cleanFill(values: FillValues): FillValues {
  const out: FillValues = {};
  for (const k of EDIT_KEYS) {
    const v = values[k]?.trim();
    if (v) out[k] = v;
  }
  if (values.zone) out.zone = values.zone;
  return out;
}

export interface FillPlan {
  /** Passes that will change. */
  take: Pass[];
  /** Passes left alone because a field already holds a different value (never overwritten). */
  skipped: { pass: Pass; why: string }[];
  /** Passes that already have exactly these values. */
  same: number;
  /** Serial numbers in the range that don't exist. */
  missing: number;
  err: string;
}

/** What filling `values` into passes of `type` from serial `from` to `to` would do. */
export function planFill(passes: Pass[], type: PassType, from: string, to: string, values: FillValues): FillPlan {
  const empty = { take: [], skipped: [], same: 0, missing: 0 };
  const f = serialNum(from);
  const t = Number.isNaN(serialNum(to)) ? f : serialNum(to);
  if (Number.isNaN(f)) return { ...empty, err: 'Enter the From and To serial numbers.' };
  const lo = Math.min(f, t);
  const hi = Math.max(f, t);
  const inRange = passes.filter((p) => p.type === type && p.num >= lo && p.num <= hi);
  if (!inRange.length) return { ...empty, err: `No ${type} passes between ${lo} and ${hi}. Add them first.` };

  if (type !== 'Mobile') values = { ...values, zone: undefined }; // only Mobile passes are Pandal / Non Pandal
  const keys = FILL_KEYS.filter((k) => values[k]);
  const take: Pass[] = [];
  const skipped: FillPlan['skipped'] = [];
  let same = 0;
  for (const p of inRange) {
    const clash = keys.find((k) => p[k] && p[k] !== values[k]);
    if (clash) skipped.push({ pass: p, why: clash === 'zone' ? `already ${p.zone}` : `${FIELD_LABELS[clash]} is ${p[clash]}` });
    else if (keys.length && keys.every((k) => p[k] === values[k])) same++;
    else take.push(p);
  }
  return { take, skipped, same, missing: hi - lo + 1 - new Set(inRange.map((p) => p.num)).size, err: '' };
}

export function fillPasses(passes: Pass[], ids: ReadonlySet<string>, values: FillValues): Pass[] {
  return passes.map((p) => (ids.has(p.id) ? { ...p, ...values, zone: p.type === 'Mobile' ? values.zone || p.zone : '' } : p));
}

/* ---------------- adding serial numbers ---------------- */

const MAX_ADD = 20000;

/** One past the highest serial number of this type (1 if there are none). */
export function nextStart(passes: Pass[], type: PassType): number {
  return passes.reduce((max, p) => (p.type === type && p.num > max ? p.num : max), 0) + 1;
}

/** Serial numbers to create for type/from/to; ones that already exist are skipped. */
export function planAdd(passes: Pass[], type: PassType, prefix: string, from: string, to: string) {
  const f = parseInt(from, 10);
  const t = parseInt(to, 10);
  if (Number.isNaN(f) || Number.isNaN(t) || f < 0 || t < f) return { err: 'Enter a valid From / To (From ≤ To).', create: [] };
  if (t - f + 1 > MAX_ADD) return { err: `Please add at most ${MAX_ADD.toLocaleString()} at a time.`, create: [] };
  // Match the width of existing serials of this type (M-0001 stays M-0001 style), else at least 3 digits.
  const existingWidth = passes.find((p) => p.type === type)?.serial.match(/(\d+)\D*$/)?.[1].length;
  const digits = existingWidth ?? Math.max(3, String(t).length);
  const exists = new Set(passes.filter((p) => p.type === type).map((p) => p.num));
  const create: { serial: string; num: number }[] = [];
  for (let n = f; n <= t; n++) if (!exists.has(n)) create.push({ serial: prefix + String(n).padStart(digits, '0'), num: n });
  return { err: '', create, existing: t - f + 1 - create.length };
}

export function addPasses(passes: Pass[], type: PassType, items: { serial: string; num: number }[]): Pass[] {
  if (!items.length) return passes;
  return sortPasses([...passes, ...items.map((x) => newPass(type, x.serial, x.num))]);
}

/* ---------------- printing ---------------- */

/** Passes of `type` between two serial numbers; a blank From / To means "from the first" / "to the last". */
export function passesForPrint(passes: Pass[], type: PassType, from: string, to: string): Pass[] {
  const f = serialNum(from);
  const t = serialNum(to);
  return passes.filter(
    (p) => p.type === type && (Number.isNaN(f) || p.num >= f) && (Number.isNaN(t) || p.num <= t),
  );
}
