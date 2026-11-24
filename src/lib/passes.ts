import {
  cleanField, type CreateOp, type Field, fieldLabel, FIELDS, fieldsFor, FLAGS, type Flags, flagsFor, fmtSerial, locksWhenPrinted, MAX_BATCH, MAX_SERIAL, type Pass,
  type PassMeta, PASS_TYPES, SHEETS, type PassType, type SetOp, TYPE_INFO, type Values,
} from '@/shared/types';

/** Number part of a serial: "M-0105" → 105, "0105" → 105. NaN if there is none. */
export function parseSerial(s: string): number {
  const m = String(s ?? '').match(/(\d+)\D*$/);
  return m ? parseInt(m[1], 10) : NaN;
}

export const nPasses = (n: number) => `${n} pass${n === 1 ? '' : 'es'}`;

/** Given = handed over: ticked by hand in the sheet or the side panel (filling in details doesn't tick it). */
export const isGiven = (p: Pick<Pass, 'given_at'>) => p.given_at !== null;
export const isPrinted = (p: Pass) => p.printed_at !== null;
/** Marked LOST: stays in the register, locked, and the gate refuses it (the owner, 2026-11-24). */
export const isLost = (p: Pick<Pass, 'lost_at'>) => p.lost_at !== null;

/** Compresses serials into readable ranges: "0101–0145, 0150". */
export function ranges(serials: number[]): string {
  const s = [...new Set(serials)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? fmtSerial(s[i]) : `${fmtSerial(s[i])}–${fmtSerial(s[j])}`);
    i = j + 1;
  }
  return out.join(', ');
}
export const passRanges = (list: Pass[]) => ranges(list.map((p) => p.serial));

/** Stands in for a serial that isn't in the register yet (an unfilled row). Its id is negative. */
export const blankPass = (type: PassType, serial: number): Pass => ({
  id: -serial, type, serial, name: '', dept: '', area: '', phone: '', vehicle: '', vehicle_no: '', incharge: '', issued_to: '', packet: '',
  printed_at: null, given_at: null, meta: {}, lost_at: null, copy_of: null, created_at: '', created_by: 0, updated_by: 0, rev: 0,
});

/** The same yes / no details (FLAGS) ticked. */
export const sameMeta = (a: PassMeta, b: PassMeta) => FLAGS.every((f) => !!a[f] === !!b[f]);

/** Serials 1 … highest in the sheet that aren't in the register yet. `sheet` is sorted by serial. */
export function missingSerials(sheet: Pass[]): number[] {
  const out: number[] = [];
  let want = 1;
  for (const p of sheet) {
    for (; want < p.serial; want++) out.push(want);
    want = p.serial + 1;
  }
  return out;
}

/** One past the highest serial in the sheet. */
export const nextSerial = (sheet: Pass[]) => (sheet.length ? sheet[sheet.length - 1].serial + 1 : 1);

/* ---------------- search ---------------- */

export type Show = 'all' | 'given' | 'free' | 'unprinted' | 'printed' | 'dupes';
export const SHOW_LABEL: Record<Show, string> = {
  all: 'All passes', given: 'Given', free: 'Not given', unprinted: 'Not printed', printed: 'Printed', dupes: 'Duplicates',
};

export interface Filters {
  q: string;
  show: Show;
  /** Added between these dates, inclusive ("yyyy-mm-dd", '' = open-ended). */
  from: string;
  to: string;
}
export const NO_FILTERS: Filters = { q: '', show: 'all', from: '', to: '' };
export const hasFilters = (f: Filters) => f.q.trim() !== '' || f.show !== 'all' || f.from !== '' || f.to !== '';

/** "yyyy-mm-dd" of an ISO time, in this computer's time zone. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A number plate without spaces, dashes or dots, for searching. */
const squash = (s: string) => s.toLowerCase().replace(/[\s.\-/]+/g, '');

/** `dupes`: ids of passes that break a rule (see people.ts), for Show: Duplicates. */
export function filterPasses(sheet: Pass[], f: Filters, dupes?: ReadonlyMap<number, unknown>): Pass[] {
  if (!hasFilters(f)) return sheet;
  const q = f.q.trim().toLowerCase();
  const qNum = /^\d+$/.test(q) ? parseInt(q, 10) : null;
  const plate = /[a-z]/.test(q) && /\d/.test(q) ? squash(q) : ''; // "hr24ab" finds HR-24AB-9168
  const [from, to] = f.from && f.to && f.from > f.to ? [f.to, f.from] : [f.from, f.to];
  return sheet.filter(
    (p) =>
      (!from || localDay(p.created_at) >= from) &&
      (!to || localDay(p.created_at) <= to) &&
      (f.show === 'all' ||
        (f.show === 'given' && isGiven(p)) ||
        (f.show === 'free' && !isGiven(p)) ||
        (f.show === 'printed' && isPrinted(p)) ||
        (f.show === 'unprinted' && !isPrinted(p)) ||
        (f.show === 'dupes' && !!dupes?.has(p.id))) &&
      (!q ||
        (qNum !== null
          ? p.serial === qNum || (q.length >= 5 && p.phone.includes(q)) // a plain number = that serial (gate check), or a phone
          : FIELDS.some((k) => p[k].toLowerCase().includes(q)) || (plate !== '' && squash(p.vehicle_no).includes(plate)))),
  );
}

/* ---------------- hiding rows ---------------- */

/** Kinds of rows a desk can hide in every sheet (remembered in the browser: client/hide.ts). */
export type Hide = 'printed' | 'given' | 'filled' | 'partial' | 'empty';
export const HIDES: readonly Hide[] = ['printed', 'given', 'filled', 'partial', 'empty'];
export const HIDE_LABEL: Record<Hide, string> = {
  printed: 'Printed', given: 'Given', filled: 'Fully filled in', partial: 'Partly filled in', empty: 'Empty rows',
};

/** Nothing filled in at all, not even Incharge, and nothing ticked (Ferry Sewa). */
export const isBlank = (type: PassType, p: Pass) => fieldsFor(type).every((k) => !p[k].trim()) && flagsFor(type).every((f) => !p.meta[f]);
/** Something filled in, but a detail it needs to print is still empty. */
export const isPartlyFilled = (type: PassType, p: Pass) => !isBlank(type, p) && unfilledOf(type, p).length > 0;
/** Every detail it needs to print is filled in. */
export const isFullyFilled = (type: PassType, p: Pass) => !isBlank(type, p) && unfilledOf(type, p).length === 0;

/** The passes left after hiding these kinds. (The empty rows not in the register are left out by the sheet.) */
export function hidePasses(view: Pass[], type: PassType, hide: readonly Hide[]): Pass[] {
  if (!hide.length) return view;
  return view.filter((p) => !(
    (hide.includes('printed') && isPrinted(p)) ||
    (hide.includes('given') && isGiven(p)) ||
    (hide.includes('filled') && isFullyFilled(type, p)) ||
    (hide.includes('partial') && isPartlyFilled(type, p)) ||
    (hide.includes('empty') && isBlank(type, p))
  ));
}

/* ---------------- collapsing a series given to someone ---------------- */

/**
 * Splits the visible passes into runs: consecutive serials given to the same incharge with
 * identical details (and printed state) collapse into one run; everything else is a run of one.
 */
export function groupRuns(view: Pass[]): Pass[][] {
  const runs: Pass[][] = [];
  for (const p of view) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    const joins = prev && p.incharge && p.serial === prev.serial + 1 && isPrinted(prev) === isPrinted(p) && isGiven(prev) === isGiven(p)
      && FIELDS.every((k) => prev[k] === p[k]) && sameMeta(prev.meta, p.meta) && prev.packet === p.packet
      && !isLost(prev) && !isLost(p) && prev.copy_of === null && p.copy_of === null; // lost passes and duplicates show on their own
    if (joins) run.push(p);
    else runs.push([p]);
  }
  return runs;
}

/* ---------------- Give / fill a range ---------------- */

/** Trims the values and drops empty ones (and Vehicle No. on sheets without it). */
export function cleanFill(type: PassType, values: Values): Values {
  const out: Values = {};
  for (const k of fieldsFor(type)) {
    const v = values[k] && cleanField(k, values[k]!);
    if (v) out[k] = v;
  }
  return out;
}

export interface FillPlan {
  set: SetOp[];
  create: CreateOp[];
  /** Serials that will change or be created. */
  serials: number[];
  /** Left alone: already holds a different value (never overwritten), or printed (locked). */
  skipped: { serial: number; why: string }[];
  /** Already have exactly these values. */
  same: number;
  err: string;
}

/**
 * What filling `values` into serials `from`–`to` (or `only` those of them) would do. Missing serials are created.
 * `flags`: the ones true are ticked too (a pass already ticked stays so; nothing is unticked).
 */
export function planFill(sheet: Pass[], type: PassType, from: string, to: string, values: Values, only?: readonly number[], flags: Flags = {}): FillPlan {
  const plan: FillPlan = { set: [], create: [], serials: [], skipped: [], same: 0, err: '' };
  const r = serialRange(from, to, only);
  if ('err' in r) return { ...plan, err: r.err };

  const keys = (Object.keys(values) as Field[]).filter((k) => values[k]);
  const ticks = flagsFor(type).filter((f) => flags[f]);
  const bySerial = new Map(sheet.map((p) => [p.serial, p]));
  for (const n of r.serials) {
    const p = bySerial.get(n);
    if (!p) {
      plan.create.push({ type, serial: n, values: { ...values }, ...(ticks.length && { flags: Object.fromEntries(ticks.map((f) => [f, true])) }) });
      plan.serials.push(n);
      continue;
    }
    const clash = keys.find((k) => p[k] && p[k] !== values[k]);
    const changed = keys.filter((k) => p[k] !== values[k]);
    const toTick = ticks.filter((f) => !p.meta[f]);
    if (clash) plan.skipped.push({ serial: n, why: `${fieldLabel(type, clash)} is ${p[clash]}` });
    else if (!changed.length && !toTick.length) plan.same++;
    else if (isPrinted(p)) plan.skipped.push({ serial: n, why: 'printed' });
    else {
      plan.set.push({
        id: p.id,
        values: Object.fromEntries(changed.map((k) => [k, values[k]])),
        expect: {
          ...Object.fromEntries(changed.map((k) => [k, p[k]])),
          ...(toTick.length && { flags: Object.fromEntries(toTick.map((f) => [f, false])) }),
        },
        ...(toTick.length && { flags: Object.fromEntries(toTick.map((f) => [f, true])) }),
      });
      plan.serials.push(n);
    }
  }
  return plan;
}

/* ---------------- pasting cells from Excel ---------------- */

/** True when clipboard text spans several cells (copied from Excel: has a line break or a tab). */
export function isMultiCell(text: string): boolean {
  return /[\t\n]/.test(text.replace(/\r/g, '').replace(/\n+$/, ''));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export interface PastePlan {
  set: SetOp[];
  create: CreateOp[];
  /** Lines that filled a row. */
  rows: number;
  /** Lines with no row to go in (only when new rows can't be added). */
  extra: number;
  /** Filled cells that will be replaced: the sheet asks before pasting over them. */
  replaced: { serial: number; key: Field; from: string; to: string }[];
  skippedHeader: boolean;
  error: string;
}

/**
 * A block copied from Excel, pasted at on-screen row `start`, column `key`: each line fills one
 * row downward and tab-separated cells fill the columns to the right. `rows` lists the passes
 * behind each on-screen row (a collapsed series is one row of many passes). Lines past the last
 * row become new passes when `canCreate`. Printed passes are never pasted over (except Issued To).
 */
export function planPaste(opts: {
  type: PassType;
  rows: Pass[][];
  start: number;
  key: Field;
  /** Copied text, or the cells themselves (a fill: may be blank, and is never a header). */
  text: string | string[][];
  nextSerial: number;
  canCreate: boolean;
}): PastePlan {
  const { type, rows, start, key, nextSerial, canCreate } = opts;
  const cols = fieldsFor(type);
  const c0 = cols.indexOf(key);
  const plan: PastePlan = { set: [], create: [], rows: 0, extra: 0, replaced: [], skippedHeader: false, error: '' };
  let lines = typeof opts.text !== 'string' ? opts.text : opts.text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));

  // A copied header row ("Name  Dept  Area …") is skipped.
  const first = lines[0] ?? [];
  const labelHits = first.filter((cell, c) => cols[c0 + c] && norm(cell) === norm(fieldLabel(opts.type, cols[c0 + c]))).length;
  if (typeof opts.text === 'string' && lines.length > 1 && labelHits > 0 && labelHits >= Math.ceil(first.length / 2)) {
    lines = lines.slice(1);
    plan.skippedHeader = true;
  }

  const locked: number[] = [];
  let made = 0;
  lines.forEach((cells, i) => {
    const values: Values = {};
    cells.forEach((cell, c) => {
      const k = cols[c0 + c];
      if (k) values[k] = cleanField(k, cell);
    });
    const keys = Object.keys(values) as Field[];
    const targets = rows[start + i];
    if (!targets) {
      if (!canCreate) return void plan.extra++;
      const filled = Object.fromEntries(keys.filter((k) => values[k]).map((k) => [k, values[k]]));
      if (!Object.keys(filled).length) return; // blank line at the end
      plan.create.push({ type, serial: nextSerial + made++, values: filled });
      plan.rows++;
      return;
    }
    plan.rows++;
    for (const p of targets) {
      if (p.id < 0) { // an unfilled row: add that serial
        const filled = Object.fromEntries(keys.filter((k) => values[k]).map((k) => [k, values[k]]));
        if (Object.keys(filled).length) plan.create.push({ type, serial: p.serial, values: filled });
        continue;
      }
      const changed = keys.filter((k) => p[k] !== values[k]);
      if (!changed.length) continue;
      if (isPrinted(p) && changed.some(locksWhenPrinted)) { locked.push(p.serial); continue; }
      for (const k of changed) if (p[k]) plan.replaced.push({ serial: p.serial, key: k, from: p[k], to: values[k] ?? '' });
      plan.set.push({
        id: p.id,
        values: Object.fromEntries(changed.map((k) => [k, values[k]])),
        expect: Object.fromEntries(changed.map((k) => [k, p[k]])),
      });
    }
  });
  if (locked.length) plan.error = `${ranges(locked)} ${locked.length === 1 ? 'is' : 'are'} printed. Untick Printed first, or paste somewhere else.`;
  else if (nextSerial + made - 1 > MAX_SERIAL) plan.error = `Serial numbers go up to ${MAX_SERIAL}.`;
  else if (plan.set.length + plan.create.length > MAX_BATCH) plan.error = `Please paste at most ${MAX_BATCH} rows at a time.`;
  return plan;
}

/* ---------------- cutting cells ---------------- */

export interface ClearPlan {
  set: SetOp[];
  /** Passes that will change. */
  passes: Pass[];
  /** Filled cells that will be emptied. */
  cells: number;
  /** Printed passes with something to clear in a locked column: nothing is cut then. */
  locked: number[];
}

/** Empties columns `keys` of these passes (after Ctrl+X). Each pass counts once; unfilled rows are skipped. */
export function planClear(passes: Pass[], keys: readonly Field[]): ClearPlan {
  const plan: ClearPlan = { set: [], passes: [], cells: 0, locked: [] };
  const seen = new Set<number>();
  for (const p of passes) {
    if (p.id < 0 || seen.has(p.id)) continue;
    seen.add(p.id);
    const changed = keys.filter((k) => p[k] !== '');
    if (!changed.length) continue;
    if (isLost(p) || (isPrinted(p) && changed.some(locksWhenPrinted))) { plan.locked.push(p.serial); continue; }
    plan.cells += changed.length;
    plan.passes.push(p);
    plan.set.push({ id: p.id, values: Object.fromEntries(changed.map((k) => [k, ''])), expect: Object.fromEntries(changed.map((k) => [k, p[k]])) });
  }
  return plan;
}

/* ---------------- printing a range ---------------- */

/** Most passes in one print run: 100 A4 pages keeps the browser quick. */
export const MAX_PRINT = 900;

/** What a printed card shows. */
export type CardData = Pick<Pass, 'type' | 'serial' | 'name' | 'dept' | 'area' | 'phone' | 'vehicle' | 'vehicle_no'> & {
  /** Ticks printed on the pass (Ferry Sewa). */
  meta?: PassMeta;
  /** A duplicate of a lost pass: prints DUPLICATE. */
  copy_of?: number | null;
};

/**
 * What a pass prints: a detail of only dots, dashes or other symbols (no letter or digit) was typed to leave
 * it blank, so it counts as filled in (the pass prints) and prints empty (the owner, 2026-11-22).
 */
export function forPrint<T extends CardData>(p: T): T {
  const blank = (v: string) => (/[\p{L}\p{N}]/u.test(v) ? v : '');
  return { ...p, name: blank(p.name), dept: blank(p.dept), area: blank(p.area), phone: blank(p.phone), vehicle: blank(p.vehicle), vehicle_no: blank(p.vehicle_no) };
}

export interface PrintPlan {
  cards: CardData[];
  /** Saving these marks the cards printed (on a helpline sheet, serials not in the register yet are added). */
  set: SetOp[];
  create: CreateOp[];
  /** Already printed: left out (untick Printed in the sheet to print again). */
  printed: number[];
  /** Not filled in (a detail empty, or not in the register yet): left out. */
  unfilled: number[];
  err: string;
}

/** The holder's details: a pass prints only with every one its sheet has filled in. Not Incharge or Issued To. */
const DETAILS: readonly Field[] = ['name', 'dept', 'area', 'phone', 'vehicle', 'vehicle_no'];
/** The details this pass still needs before it prints (every one, for a serial not in the register). */
export const unfilledOf = (type: PassType, p: Pass | undefined): Field[] =>
  fieldsFor(type).filter((k) => DETAILS.includes(k) && !p?.[k].trim());

/** The passes of a sheet that would print now: in the register, not printed, every detail filled in. Lowest serials first. */
export const readyToPrint = (sheet: readonly Pass[], type: PassType): Pass[] =>
  sheet.filter((p) => !isPrinted(p) && !unfilledOf(type, p).length).sort((a, b) => a.serial - b.serial);

/**
 * The passes from–to that aren't printed yet and are filled in: nothing empty is printed (the owner,
 * 2026-11-18). The helpline sheets have no details, so their serials not in the register print too.
 */
export function planPrint(sheet: Pass[], type: PassType, from: string, to: string, only?: readonly number[]): PrintPlan {
  const plan = emptyPlan();
  const r = serialRange(from, to, only, Infinity); // at most MAX_PRINT are printed (addToPlan)
  if ('err' in r) return { ...plan, err: r.err };
  addToPlan(plan, sheet, type, r.serials);
  return plan;
}

/**
 * The print queue's passes (printQueue.ts): sheet by sheet (in tab order), each by serial, by the same rules.
 * Passes of one size only (one Layout), so they share the paper sheets: Mobile Pandal with Non Pandal, ….
 */
export function planQueue(items: readonly { type: PassType; serial: number }[], sheetOf: (t: PassType) => readonly Pass[]): PrintPlan {
  const plan = emptyPlan();
  for (const t of PASS_TYPES) {
    const serials = items.filter((x) => x.type === t).map((x) => x.serial).sort((a, b) => a - b);
    if (serials.length && !addToPlan(plan, sheetOf(t), t, serials)) break;
  }
  return plan;
}

const emptyPlan = (): PrintPlan => ({ cards: [], set: [], create: [], printed: [], unfilled: [], err: '' });

/** Adds these serials of one sheet to the plan, leaving out what's printed or not filled in. False once it's full (MAX_PRINT). */
function addToPlan(plan: PrintPlan, sheet: readonly Pass[], type: PassType, serials: readonly number[]): boolean {
  const bySerial = new Map(sheet.map((p) => [p.serial, p]));
  for (const n of serials) {
    const p = bySerial.get(n);
    if (p && isPrinted(p)) { plan.printed.push(n); continue; }
    if (unfilledOf(type, p).length) { plan.unfilled.push(n); continue; }
    if (plan.cards.length >= MAX_PRINT) {
      plan.err = `Please print at most ${MAX_PRINT} passes at a time (${MAX_PRINT / 9} pages).`;
      return false;
    }
    if (!p) {
      plan.cards.push({ type, serial: n, name: '', dept: '', area: '', phone: '', vehicle: '', vehicle_no: '' });
      plan.create.push({ type, serial: n, values: {}, printed: true });
      continue;
    }
    plan.cards.push(p);
    // If anything on the card changed after the preview, nothing is marked and the user is told.
    const seen = { name: p.name, dept: p.dept, area: p.area, phone: p.phone, vehicle: p.vehicle, vehicle_no: p.vehicle_no };
    const ticks = flagsFor(type).length ? { flags: Object.fromEntries(flagsFor(type).map((f) => [f, !!p.meta[f]])) } : {};
    plan.set.push({ id: p.id, printed: true, expect: { ...seen, ...ticks, printed: false } });
  }
  return true;
}

/** "Mobile Pandal 0001–40, Mobile Non Pandal 0005": the cards, sheet by sheet. */
export const cardsLabel = (cards: readonly CardData[]) =>
  SHEETS.flatMap((t) => {
    const serials = cards.filter((c) => c.type === t).map((c) => c.serial);
    return serials.length ? [`${TYPE_INFO[t].label} ${ranges(serials)}`] : [];
  }).join(', ');

/* ---------------- Given and Delete for a range ---------------- */

/** The serials from–to (either order), or why not. */
/** Passes picked: From–To, or `only` some of them (rows picked in the sheet while others between were hidden). */
export interface Picked { from: string; to: string; only?: readonly number[] }

/**
 * The serials from–to, in order; with `only` (rows picked in the sheet while a search or Show hid some
 * between them), just those of them.
 */
function serialRange(from: string, to: string, only?: readonly number[], limit = MAX_BATCH): { serials: number[] } | { err: string } {
  const f = parseSerial(from);
  const t = Number.isNaN(parseSerial(to)) ? f : parseSerial(to);
  if (Number.isNaN(f)) return { err: 'Enter the From and To serial numbers.' };
  const [lo, hi] = [Math.min(f, t), Math.max(f, t)];
  if (lo < 1 || hi > MAX_SERIAL) return { err: `Serial numbers go from 1 to ${MAX_SERIAL}.` };
  const n = only ? only.length : hi - lo + 1;
  if (n > limit) return { err: `Please do at most ${MAX_BATCH} passes at a time.` };
  const serials = only ? [...only].filter((s) => s >= lo && s <= hi).sort((a, b) => a - b) : Array.from({ length: n }, (_, i) => lo + i);
  return { serials };
}

/** The passes in the register with these serials (serials not in it are left out). */
function passesIn(sheet: Pass[], serials: readonly number[]): Pass[] {
  const want = new Set(serials);
  return sheet.filter((p) => want.has(p.serial));
}

export interface GivenPlan {
  /** Passes to tick, and to untick. */
  tick: SetOp[];
  untick: SetOp[];
  tickSerials: number[];
  untickSerials: number[];
  /** Not given and not printed: can't be ticked Given until printed. */
  notPrinted: number[];
  err: string;
}

/** Ticking or unticking Given for the passes from–to. */
export function planGiven(sheet: Pass[], from: string, to: string, only?: readonly number[]): GivenPlan {
  const plan: GivenPlan = { tick: [], untick: [], tickSerials: [], untickSerials: [], notPrinted: [], err: '' };
  const r = serialRange(from, to, only);
  if ('err' in r) return { ...plan, err: r.err };
  for (const p of passesIn(sheet, r.serials)) {
    const given = isGiven(p);
    if (isLost(p)) continue; // locked
    if (!given && !isPrinted(p)) { plan.notPrinted.push(p.serial); continue; } // printed first, then given
    (given ? plan.untick : plan.tick).push({ id: p.id, given: !given, expect: { given } });
    (given ? plan.untickSerials : plan.tickSerials).push(p.serial);
  }
  return plan;
}

export interface UnprintPlan {
  /** Untick Printed: printed → not printed. */
  set: { id: number; printed: false; expect: { printed: true } }[];
  serials: number[];
  err: string;
}

/** The passes from–to that are printed, to untick Printed (to print them again). Given stays as it is, as in the sheet. */
export function planUnprint(sheet: Pass[], from: string, to: string, only?: readonly number[]): UnprintPlan {
  const plan: UnprintPlan = { set: [], serials: [], err: '' };
  const r = serialRange(from, to, only);
  if ('err' in r) return { ...plan, err: r.err };
  for (const p of passesIn(sheet, r.serials)) {
    if (!isPrinted(p) || isLost(p)) continue; // a lost pass is never printed again: its duplicate is
    plan.set.push({ id: p.id, printed: false, expect: { printed: true } });
    plan.serials.push(p.serial);
  }
  return plan;
}

export interface DeletePlan {
  items: { id: number; rev: number }[];
  serials: number[];
  /** Printed: can't be deleted (untick Printed first). */
  printed: number[];
  err: string;
}

/** The passes from–to that can be deleted: those in the register and not printed. */
export function planDelete(sheet: Pass[], from: string, to: string, only?: readonly number[]): DeletePlan {
  const plan: DeletePlan = { items: [], serials: [], printed: [], err: '' };
  const r = serialRange(from, to, only);
  if ('err' in r) return { ...plan, err: r.err };
  for (const p of passesIn(sheet, r.serials)) {
    if (isPrinted(p)) plan.printed.push(p.serial);
    else { plan.items.push({ id: p.id, rev: p.rev }); plan.serials.push(p.serial); }
  }
  return plan;
}

/* ---------------- lost passes ---------------- */

export interface LostPlan {
  /** Mark these LOST… */
  set: SetOp[];
  /** …and add a duplicate of each, with the same details, at the end of the sheet. */
  create: CreateOp[];
  serials: number[];
  /** The duplicates' serials (another desk may take them first: then they go after the last pass). */
  to: number[];
  /** Not printed: nothing to lose (delete or change it instead). */
  notPrinted: number[];
  err: string;
}

/**
 * Marking the printed passes from–to LOST (stolen or lost, the owner, 2026-11-24): each stays in the register, locked, and a duplicate
 * with the same details (Issued To and ticks too, not Printed or Given) is added after the sheet's last pass, to print and hand over.
 */
export function planLost(sheet: Pass[], type: PassType, from: string, to: string, only?: readonly number[]): LostPlan {
  const plan: LostPlan = { set: [], create: [], serials: [], to: [], notPrinted: [], err: '' };
  const r = serialRange(from, to, only);
  if ('err' in r) return { ...plan, err: r.err };
  let next = nextSerial(sheet);
  for (const p of passesIn(sheet, r.serials)) {
    if (isLost(p)) continue;
    if (!isPrinted(p)) { plan.notPrinted.push(p.serial); continue; }
    plan.set.push({ id: p.id, lost: true, expect: { lost: false, printed: true } });
    const values = Object.fromEntries(fieldsFor(type).filter((k) => p[k]).map((k) => [k, p[k]]));
    const flags = Object.fromEntries(flagsFor(type).filter((f) => p.meta[f]).map((f) => [f, true]));
    plan.create.push({ type, serial: next, values, flags, copy_of: p.id });
    plan.serials.push(p.serial);
    plan.to.push(next++);
  }
  return plan;
}
