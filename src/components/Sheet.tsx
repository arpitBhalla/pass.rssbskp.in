'use client';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { isUnsaved } from '@/client/store';
import { toast } from '@/client/toast';
import { addedBy, useUserNames } from '@/client/users';
import {
  type ClipboardEvent, type FocusEvent, type FormEvent, type KeyboardEvent, memo, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { blankPass, groupRuns, isGiven, isMultiCell, isPrinted, planClear, ranges } from '@/lib/passes';
import { alsoHeld, detailsFor, type Duplicate, passLabel, phoneKey } from '@/lib/people';
import { cleanField, cleanText, type Field, FIELD_LABELS, fieldLabel, fieldsFor, fmtSerial, locksWhenPrinted, type Pass, type PassType, TYPE_INFO, type Values } from '@/shared/types';

const ROW_H = 30; // keep in step with h-[30px] below

type Arrow = { dr: number; dc: number };
const ARROWS: Record<string, Arrow> = {
  ArrowUp: { dr: -1, dc: 0 }, ArrowDown: { dr: 1, dc: 0 }, ArrowLeft: { dr: 0, dc: -1 }, ArrowRight: { dr: 0, dc: 1 },
};
/** Columns with typing suggestions (datalists rendered by SheetScreen). Name: people, see `namePicks`. */
const SUGGEST: Partial<Record<Field, string>> = { name: 'dl-person', incharge: 'dl-incharge', area: 'dl-area', dept: 'dl-dept' };
const WIDTH: Partial<Record<Field, number>> = { dept: 118, area: 118, phone: 112, vehicle: 140, vehicle_no: 124 };
/** Name, Incharge and Issued To take the spare width, but never less than this: the table scrolls sideways first. */
const FLEX_MIN = 112;
/** The other columns' widths. Mobile sheets fit beside the side panel on a 1440 px screen. */
const COL = { serial: 90, added: 70, by: 92, printed: 66, given: 64 };

export interface Span {
  lo: number;
  hi: number;
}
const inSpan = (s: Span | null, p: Pass) => !!s && p.serial >= s.lo && p.serial <= s.hi;

/**
 * One on-screen row: a pass, a collapsed series given to one incharge, an unfilled serial (not in
 * the register yet), or the blank row for the next serial.
 */
type Item =
  | { kind: 'row'; key: string; p: Pass }
  | { kind: 'group'; key: string; passes: Pass[]; open: boolean }
  | { kind: 'empty'; key: string; serial: number }
  | { kind: 'new'; key: string; serial: number };

/** Blank rows after the last pass, the first the "+" row (the owner, 2026-11-17: a few extra rows to type into). */
const BLANK_ROWS = 10;

/**
 * The sheet's columns: its fields up to Incharge, then Printed and Given, the handover fields
 * (Issued To), and Added, Added by. Cells are numbered by their place in the sheet's fields (`data-c`),
 * which is also the order a paste or fill goes rightward in.
 */
const before = (fields: readonly Field[]) => fields.filter(locksWhenPrinted);
const after = (fields: readonly Field[]) => fields.filter((k) => !locksWhenPrinted(k));

/** A cell: its row (by item key, so it survives rows moving) and column (index into the sheet's fields). */
interface Cell { key: string; c: number }
/** A block of cells: rows r0–r1 (item indexes) and columns c0–c1. */
interface Rect { r0: number; r1: number; c0: number; c1: number }
/** How a row's cells are marked: selected block, fill preview, and which cell has the fill handle. */
interface Mark { sel?: [number, number]; fill?: [number, number]; handle?: number }
const within = (span: [number, number] | undefined, c: number) => !!span && c >= span[0] && c <= span[1];
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Cells as Excel takes them: tab-separated text, plus an HTML table marking every cell as text (keeps 0001's zeros). */
const toClipboard = (rows: string[][]) => ({
  text: rows.map((r) => r.join('\t')).join('\n'),
  html: `<table>${rows.map((r) => `<tr>${r.map((v) => `<td style="mso-number-format:'\\@'">${escHtml(v)}</td>`).join('')}</tr>`).join('')}</table>`,
});

/** What Ctrl+C / Ctrl+X takes: the cells as text, the passes behind them and their columns. */
interface Clip {
  rows: string[][];
  passes: Pass[];
  keys: readonly Field[];
  /** "9 cells", "3 rows" */
  what: string;
  /** Rows picked by Sr. No.: copied with their Sr. No. first. */
  withSerial?: boolean;
  /** One cell: no "Copied" note, and the cursor stays in it after a cut. */
  cell?: { i: number; k: Field };
}
/** The last rows copied with their Sr. No.: pasted back into the sheet, they fill from Name (without the Sr. No.). */
let copiedRows: { text: string; cells: string } | null = null;
const trimLines = (t: string) => t.replace(/\r/g, '').replace(/\n+$/, '');

/** The passes behind a row. An unfilled row stands for a pass that doesn't exist yet. */
const itemPasses = (type: PassType, it: Item): Pass[] =>
  it.kind === 'row' ? [it.p] : it.kind === 'group' ? it.passes : it.kind === 'empty' ? [blankPass(type, it.serial)] : [];

/** Saves one cell for these passes. `saved` is the value the user started from. Resolves false if nothing was saved. */
export type EditFn = (target: Pass[], key: Field, value: string, saved: string) => Promise<boolean>;
/** Saves a person picked from the Name suggestions for this pass (see `namePicks`). Resolves false if nothing was saved. */
export type PickFn = (p: Pass, values: Values) => Promise<boolean>;
/** The person a Name suggestion stands for, if `text` is one. */
type PickOf = (text: string) => Values | undefined;

export interface SheetProps {
  type: PassType;
  view: Pass[];
  total: number;
  selection: Span | null;
  /** Show the blank row for adding the next serial (off while searching / filtering). */
  canAdd: boolean;
  /** The blank rows under the "+" row (off while empty rows are hidden). */
  blankRows: boolean;
  next: number;
  /** Serials not in the register yet, shown as empty rows to type or paste into ([] while searching). */
  missing: number[];
  onEdit: EditFn;
  /** Adds this serial with these values. */
  onCreate: (serial: number, values: Values) => Promise<boolean>;
  /** Pastes (or, `fill`, fills from the fill handle) these lines of cells from row `start`, column `key`. */
  onPaste: (rows: Pass[][], start: number, key: Field, text: string | string[][], canCreate: boolean, fill?: boolean) => void;
  /** Ctrl+X (`cut`: these cells were copied) or Delete: empty columns `keys` of these passes. */
  onClear: (passes: Pass[], keys: readonly Field[], what: string, cut: boolean) => void;
  onPrinted: (passes: Pass[], printed: boolean) => void;
  onGiven: (passes: Pass[], given: boolean) => void;
  onSelect: (span: Span) => void;
  onSelectEnd: () => void;
  /** A cell got the cursor: the rows picked by Sr. No. are let go (as in Excel). */
  onClearSelection: () => void;
  /** Passes that repeat someone's (see people.ts), by id: their phone / Reg. No. cell is marked. */
  dupes: ReadonlyMap<number, Duplicate[]>;
  /** Everyone's passes by phone: a phone on more passes shows how many, and opens them (`onPerson`). */
  phones: ReadonlyMap<string, Pass[]>;
  onPerson: (phoneKey: string) => void;
  /** The Name suggestions (`namePicks`): picking one fills in the person's phone, dept and area too. */
  picks: ReadonlyMap<string, Values>;
  onPick: PickFn;
}

/** Only the rows in view (plus a few either side) are drawn, so thousands of passes stay fast. */
export const Sheet = memo(function Sheet(props: SheetProps) {
  const { type, view, total, selection, canAdd, blankRows, next, missing, onEdit, onCreate, onPaste, onClear, onPrinted, onGiven, onSelect, onSelectEnd, onClearSelection, dupes, phones, onPerson, picks, onPick } = props;
  const fields = fieldsFor(type);
  const cols = 5 + fields.length;
  const tableMin = Object.values(COL).reduce((a, b) => a + b, 0) + fields.reduce((sum, k) => sum + (WIDTH[k] ?? FLEX_MIN), 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  const items = useMemo(() => {
    const out: Item[] = [];
    let m = 0; // next unfilled serial to place, in serial order
    const emptiesBefore = (serial: number) => {
      for (; m < missing.length && missing[m] < serial; m++) out.push({ kind: 'empty', key: `e${missing[m]}`, serial: missing[m] });
    };
    for (const run of groupRuns(view)) {
      emptiesBefore(run[0].serial);
      if (run.length === 1) { out.push({ kind: 'row', key: String(run[0].id), p: run[0] }); continue; }
      const key = `g${run[0].id}`;
      const open = opened.has(key);
      out.push({ kind: 'group', key, passes: run, open });
      if (open) for (const p of run) out.push({ kind: 'row', key: String(p.id), p });
    }
    emptiesBefore(Infinity);
    if (canAdd) {
      out.push({ kind: 'new', key: 'new', serial: next });
      if (blankRows) for (let s = next + 1; s < next + BLANK_ROWS; s++) out.push({ kind: 'empty', key: `e${s}`, serial: s });
    }
    return out;
  }, [view, opened, canAdd, blankRows, missing, next]);
  /** Every row's passes, an entry per row (the "+" row's pass-to-be too), for a paste or fill from row `i`. */
  const pasteRows = () => items.map((it) => (it.kind === 'new' ? [blankPass(type, it.serial)] : itemPasses(type, it)));

  const toggle = (key: string) => setOpened((s) => {
    const nextSet = new Set(s);
    if (!nextSet.delete(key)) nextSet.add(key);
    return nextSet;
  });

  const [active, setActive] = useState<Cell | null>(null); // the cell with the cursor
  const indexOf = useMemo(() => new Map(items.map((it, i) => [it.key, i])), [items]);
  // The row with the cursor stays drawn when scrolled out of view (e.g. a block grown far down from
  // it), so the cell keeps the cursor and the keys keep working.
  const keep = active ? indexOf.get(active.key) : undefined;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    getItemKey: (i) => items[i].key,
    paddingStart: ROW_H, // the sticky header sits above the first row
    scrollPaddingStart: ROW_H,
    overscan: 15,
    rangeExtractor: (range) => {
      const shown = defaultRangeExtractor(range);
      return keep === undefined || shown.includes(keep) ? shown : [...shown, keep].sort((a, b) => a - b);
    },
  });
  const vItems = virtualizer.getVirtualItems();
  const padTop = vItems.length ? vItems[0].start - ROW_H : 0;
  const padBottom = vItems.length ? virtualizer.getTotalSize() - vItems[vItems.length - 1].end : 0;

  // A sheet opens with the last pass added in the middle of the screen, the blank rows under it (the owner,
  // 2026-11-17). Once, when its passes are in; opened with a search, it starts at the top as before.
  const openedAt = useRef<PassType | null>(null);
  useEffect(() => {
    if (openedAt.current === type || !total) return;
    openedAt.current = type;
    if (!canAdd || !view.length) return;
    const newest = view.reduce((a, p) => (p.id > a.id ? p : a));
    const i = items.findIndex((it) => (it.kind === 'row' ? it.p.id === newest.id : it.kind === 'group' && it.passes.includes(newest)));
    if (i >= 0) virtualizer.scrollToIndex(i, { align: 'center' });
  }, [type, total, canAdd, view, items, virtualizer]);

  /* ----- selecting rows: click # or Sr. No.; Shift+click or drag for more ----- */
  const anchor = useRef<Span | null>(null);
  const dragging = useRef(false);
  const itemAt = (el: Element) => items[Number(el.closest('tr')?.dataset.i)];
  const spanOf = (it: Item | undefined): Span | null => {
    if (it?.kind === 'empty') return { lo: it.serial, hi: it.serial };
    const ps = it ? itemPasses(type, it) : [];
    return ps.length ? { lo: ps[0].serial, hi: ps[ps.length - 1].serial } : null;
  };
  const extendTo = (span: Span) => {
    const a = anchor.current ?? span;
    onSelect({ lo: Math.min(a.lo, span.lo), hi: Math.max(a.hi, span.hi) });
  };
  /* ----- cells, like Excel: drag or Shift+click for a block, Ctrl+C copies it, the corner square fills ----- */
  const [block, setBlock] = useState<{ a: Cell; b: Cell } | null>(null);
  const [fillTo, setFillToState] = useState<Rect | null>(null);
  const fillRef = useRef<Rect | null>(null); // the same, for the mouseup that runs the fill
  const setFillTo = (r: Rect | null) => { fillRef.current = r; setFillToState(r); };
  const cellDrag = useRef<{ mode: 'block' | 'fill'; start: Cell } | null>(null);
  const rectOf = (a: Cell, b: Cell): Rect | null => {
    const ia = indexOf.get(a.key), ib = indexOf.get(b.key);
    if (ia === undefined || ib === undefined) return null;
    return { r0: Math.min(ia, ib), r1: Math.max(ia, ib), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
  };
  const rect = block ? rectOf(block.a, block.b) : null;
  const multi = !!rect && (rect.r0 !== rect.r1 || rect.c0 !== rect.c1);
  /** What the fill handle copies: the block, or the cell with the cursor. */
  const source = rect ?? (active ? rectOf(active, active) : null);

  const cellAt = (el: Element | null): Cell | null => {
    const tdEl = el?.closest<HTMLElement>('td[data-c]');
    const it = items[Number(tdEl?.closest<HTMLElement>('tr[data-i]')?.dataset.i)];
    return tdEl && it ? { key: it.key, c: Number(tdEl.dataset.c) } : null;
  };
  /** A cell's value: what's typed in it if it's on screen, else what's saved. */
  const valueAt = (i: number, c: number): string => {
    const k = fields[c];
    const el = scrollRef.current?.querySelector<HTMLInputElement>(`tr[data-i="${i}"] input[data-k="${k}"]`);
    if (el) return cleanText(el.value);
    const it = items[i];
    return it ? (itemPasses(type, it)[0]?.[k] ?? '') : '';
  };

  /** Copies the fill source into `to` (rows below it, or columns to its right), saved like a paste. Selects both after. */
  const fill = (from: Rect, to: Rect, select = true) => {
    const lines: string[][] = [];
    const h = from.r1 - from.r0 + 1, w = from.c1 - from.c0 + 1;
    for (let i = to.r0; i <= to.r1; i++) {
      const line: string[] = [];
      for (let c = to.c0; c <= to.c1; c++) {
        const si = to.r0 > from.r1 ? from.r0 + ((i - to.r0) % h) : i; // filling down repeats the source rows
        const sc = to.c0 > from.c1 ? from.c0 + ((c - to.c0) % w) : c; // filling right repeats the source columns
        line.push(valueAt(si, sc));
      }
      lines.push(line);
    }
    onPaste(pasteRows(), to.r0, fields[to.c0], lines, canAdd, true);
    if (select) setBlock({ a: { key: items[Math.min(from.r0, to.r0)].key, c: Math.min(from.c0, to.c0) }, b: { key: items[Math.max(from.r1, to.r1)].key, c: Math.max(from.c1, to.c1) } });
  };

  /**
   * What Ctrl+C / Ctrl+X takes: the selected block; else the cell with the cursor (its whole value,
   * unless some of its text is selected or it's being typed in: then the box's own copy / cut); else
   * the rows picked by Sr. No. Null: leave it to the browser.
   */
  const collect = (): Clip | null => {
    const el = document.activeElement;
    const inSheet = !!el && !!scrollRef.current?.contains(el);
    const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    if (multi && rect && (inSheet || !typing)) {
      const rows: string[][] = [];
      const passes: Pass[] = [];
      for (let i = rect.r0; i <= rect.r1; i++) {
        const it = items[i];
        if (!it || it.kind === 'new') continue;
        const line: string[] = [];
        for (let c = rect.c0; c <= rect.c1; c++) line.push(valueAt(i, c));
        rows.push(line);
        passes.push(...itemPasses(type, it));
      }
      const n = rows.length * (rect.c1 - rect.c0 + 1);
      return { rows, passes, keys: fields.slice(rect.c0, rect.c1 + 1), what: `${n} cell${n === 1 ? '' : 's'}` };
    }
    if (inSheet && el instanceof HTMLInputElement && el.dataset.k && el.selectionStart === el.selectionEnd) {
      const k = el.dataset.k as Field;
      if (cleanField(k, el.value) !== cleanField(k, el.defaultValue)) return null; // being typed in
      const i = Number(el.closest('tr')?.dataset.i);
      const it = items[i];
      return { rows: [[cleanText(el.value)]], passes: it ? itemPasses(type, it) : [], keys: [k], what: '1 cell', cell: { i, k } };
    }
    if (selection && !typing && !window.getSelection()?.toString()) {
      const ps = view.filter((p) => inSpan(selection, p));
      if (!ps.length) return null;
      return { rows: ps.map((p) => [fmtSerial(p.serial), ...fields.map((k) => p[k])]), passes: ps, keys: fields, what: `${ps.length} row${ps.length === 1 ? '' : 's'}`, withSerial: true };
    }
    return null;
  };

  // Latest state for the document-level mouse and copy listeners below.
  const live = useRef({ cellAt, rect, source, multi, fill, valueAt, items, selection, view, fields, setFillTo, collect, onClear, focusCell: (_i: number, _k: string) => {} });
  useEffect(() => { live.current = { cellAt, rect, source, multi, fill, valueAt, items, selection, view, fields, setFillTo, collect, onClear, focusCell }; });

  useEffect(() => {
    let raf = 0;
    let pt: { x: number; y: number } | null = null;
    /** Follows the mouse while dragging a block or the fill handle; scrolls when it nears an edge. */
    const track = () => {
      raf = 0;
      const d = cellDrag.current, box = scrollRef.current;
      if (!d || !pt || !box) return;
      const { cellAt: at, source: src } = live.current;
      const r = box.getBoundingClientRect();
      const dy = pt.y > r.bottom - 24 ? 16 : pt.y < r.top + ROW_H + 12 ? -16 : 0;
      const dx = pt.x > r.right - 24 ? 16 : pt.x < r.left + 24 ? -16 : 0;
      if (dx || dy) box.scrollBy(dx, dy);
      const cell = at(document.elementFromPoint(Math.min(Math.max(pt.x, r.left + 2), r.right - 2), Math.min(Math.max(pt.y, r.top + ROW_H + 2), r.bottom - 2)));
      if (cell && d.mode === 'block' && (cell.key !== d.start.key || cell.c !== d.start.c)) setBlock({ a: d.start, b: cell });
      if (cell && d.mode === 'fill' && src) {
        const i = live.current.items.findIndex((it) => it.key === cell.key);
        const set = live.current.setFillTo;
        if (i > src.r1) set({ r0: src.r1 + 1, r1: i, c0: src.c0, c1: src.c1 });
        else if (cell.c > src.c1 && i >= src.r0) set({ r0: src.r0, r1: src.r1, c0: src.c1 + 1, c1: cell.c });
        else set(null);
      }
      if (dx || dy) raf = requestAnimationFrame(track);
    };
    const move = (e: globalThis.MouseEvent) => {
      if (!cellDrag.current) return;
      pt = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(track);
    };
    const up = () => {
      const d = cellDrag.current;
      if (!d) return;
      if (raf) { cancelAnimationFrame(raf); track(); } // where the mouse was let go counts, even if not drawn yet
      cellDrag.current = null;
      pt = null;
      document.body.classList.remove('select-none');
      if (d.mode === 'fill') {
        const to = fillRef.current, src = live.current.source;
        live.current.setFillTo(null);
        if (to && src) live.current.fill(src, to);
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, []);

  // Typed into a cell but not left it yet: start saving it now, and have the browser ask before closing.
  useEffect(() => {
    const leaving = (e: BeforeUnloadEvent) => {
      const typed = [...(scrollRef.current?.querySelectorAll<HTMLInputElement>('input[data-k]') ?? [])]
        .some((el) => !el.readOnly && cleanField(el.dataset.k as Field, el.value) !== cleanField(el.dataset.k as Field, el.defaultValue));
      if (!typed) return;
      e.preventDefault();
      e.returnValue = '';
      const el = document.activeElement;
      if (el instanceof HTMLElement && scrollRef.current?.contains(el)) el.blur(); // starts saving it
    };
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, []);

  // Ctrl+C copies, Ctrl+X copies then empties (one change, so Undo brings it back): see `collect`.
  // The keys are handled here because a Mac browser ignores ⌘C / ⌘X when no text is selected.
  // Delete / Backspace empties a block of cells, or the rows picked by Sr. No. (the passes stay).
  useEffect(() => {
    let cutting = false;
    const onCopy = (e: globalThis.ClipboardEvent) => {
      const got = live.current.collect();
      if (!got?.rows.length || !e.clipboardData) return;
      const { text, html } = toClipboard(got.rows);
      e.clipboardData.setData('text/plain', text);
      e.clipboardData.setData('text/html', html);
      e.preventDefault();
      copiedRows = got.withSerial ? { text, cells: got.rows.map((r) => r.slice(1).join('\t')).join('\n') } : null;
      if (!got.cell && !cutting) toast(`Copied ${got.what}${got.withSerial ? ', with Sr. No.' : ''}`);
    };
    const refuse = refuseLocked;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const got = live.current.collect();
        if (!got?.rows.length || got.cell) return; // one cell: the box edits its text
        e.preventDefault();
        const { locked } = planClear(got.passes, got.keys);
        if (locked.length) return refuse(locked, 'cleared');
        return live.current.onClear(got.passes, got.keys, got.what, false);
      }
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'x') return;
      const got = live.current.collect();
      if (!got?.rows.length) return; // the browser's own copy / cut
      e.preventDefault();
      if (key === 'x') {
        const { locked } = planClear(got.passes, got.keys);
        if (locked.length) return refuse(locked, 'cut');
      }
      cutting = key === 'x';
      const copied = document.execCommand('copy'); // runs onCopy above
      cutting = false;
      if (!copied) void navigator.clipboard?.writeText(toClipboard(got.rows).text);
      if (key !== 'x') return;
      live.current.onClear(got.passes, got.keys, got.what, true);
      const c = got.cell;
      if (c) requestAnimationFrame(() => live.current.focusCell(c.i, c.k)); // the cursor stays in the cell
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const onMouseDown = (e: MouseEvent<HTMLTableSectionElement>) => {
    const el = e.target as Element;
    if (e.button !== 0 || el.closest('button')) return;
    if (el.closest('[data-fill]')) { // the fill handle
      e.preventDefault(); // keep the cursor where it is
      if (source) { cellDrag.current = { mode: 'fill', start: { key: items[source.r0].key, c: source.c0 } }; document.body.classList.add('select-none'); }
      return;
    }
    if (!el.closest('td[data-pick]')) {
      const cell = cellAt(el);
      if (!cell) return;
      const box = el.closest('td')?.querySelector<HTMLInputElement>('input[data-k]');
      if (box && !box.readOnly) return; // being edited: a click moves the caret, a drag selects its text
      e.preventDefault(); // like Excel, a click selects the cell without a caret; no text selection while dragging
      if (e.shiftKey && active) { setBlock({ a: active, b: cell }); return; }
      setBlock(null);
      box?.focus({ preventScroll: true });
      if (box && e.detail >= 2) startEdit(box, caretAt(box, e.clientX)); // double-click: edit, the caret where clicked
      else cellDrag.current = { mode: 'block', start: cell };
      return;
    }
    setBlock(null);
    const span = spanOf(itemAt(el));
    if (!span) return;
    e.preventDefault(); // no text selection while dragging
    // Leave the cell being typed in (it saves), so Ctrl+C copies the picked rows rather than that cell.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && scrollRef.current?.contains(focused)) focused.blur();
    if (e.shiftKey && anchor.current) extendTo(span);
    else { anchor.current = span; onSelect(span); }
    dragging.current = true;
  };
  // Dragging out of the first cell turns it into a block: no text selection inside that box.
  const onMouseOverCells = (e: MouseEvent<HTMLTableSectionElement>) => {
    const d = cellDrag.current;
    if (d?.mode !== 'block') return;
    const cell = cellAt(e.target as Element);
    if (!cell || (cell.key === d.start.key && cell.c === d.start.c)) return;
    document.body.classList.add('select-none');
  };
  const onFocusCell = (e: FocusEvent<HTMLTableSectionElement>) => {
    const cell = (e.target as HTMLElement).dataset.k ? cellAt(e.target as Element) : null;
    if (!cell) return;
    const box = e.target;
    if (box instanceof HTMLInputElement && box.readOnly) box.setSelectionRange(0, 0);
    setActive(cell);
    if (selection) onClearSelection();
  };
  // Leaving a cell ends its edit (the box saves what was typed): it's only selected when it gets the cursor again.
  const onBlurCell = (e: FocusEvent<HTMLTableSectionElement>) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.dataset.k && !el.readOnly) stopEdit(el);
  };
  const onMouseOver = (e: MouseEvent<HTMLTableSectionElement>) => {
    onMouseOverCells(e);
    if (!dragging.current) return;
    const span = spanOf(itemAt(e.target as Element));
    if (span) extendTo(span);
  };
  useEffect(() => {
    const up = () => { if (dragging.current) { dragging.current = false; onSelectEnd(); } };
    document.addEventListener('mouseup', up);
    return () => document.removeEventListener('mouseup', up);
  }, [onSelectEnd]);

  // Moves focus to the same column in another row, scrolling it into view first if needed.
  const focusCell = (index: number, k: string) => {
    const find = () => scrollRef.current?.querySelector<HTMLInputElement>(`tr[data-i="${index}"] [data-k="${k}"]`);
    const go = (el: HTMLInputElement | null | undefined) => el?.focus();
    const el = find();
    if (el) return go(el);
    virtualizer.scrollToIndex(index);
    requestAnimationFrame(() => go(find()));
  };

  // Enter / ↓ moves down, Shift+Enter / ↑ moves up, Ctrl+D fills down, like Excel.
  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k as Field | undefined;
    if (!k || e.defaultPrevented) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault(); // not the browser's "bookmark this page"
      const i = Number(el.closest('tr')!.dataset.i);
      const c = fields.indexOf(k);
      if (multi && rect && rect.r1 > rect.r0) { // the block's top row into the rows below it
        fill({ ...rect, r1: rect.r0 }, { ...rect, r0: rect.r0 + 1 }, false);
      } else if (!multi && i > 0 && items[i].kind !== 'new') { // one cell: the cell above into it
        fill({ r0: i - 1, r1: i - 1, c0: c, c1: c }, { r0: i, r1: i, c0: c, c1: c }, false);
        requestAnimationFrame(() => focusCell(i, k)); // the cursor stays in the cell
      }
      return;
    }
    const selected = el.readOnly; // the cell is selected, not being edited (see startEdit)
    const typing = !selected && !!el.dataset.typing; // edited by typing into it: ← → still move between cells
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key.length === 1 && plain) setBlock(null); // typing edits the one cell
    if (selected && plain) {
      if (e.key === 'F2') { e.preventDefault(); startEdit(el, 'end'); return; }
      // Typing replaces what's in the cell; Backspace empties it to type afresh (Esc puts it back).
      if (e.key.length === 1 || (e.key === 'Backspace' && !multi)) {
        if (!startEdit(el, undefined, true)) { e.preventDefault(); return; }
        el.value = '';
        if (e.key === 'Backspace') e.preventDefault();
        return; // the key's letter goes into the cell
      }
      if (e.key === 'Delete' && !multi) { e.preventDefault(); clearCell(el); return; }
    }
    // Shift+arrow grows the block a cell; Ctrl+arrow (⌘ on a Mac) jumps to the edge of the filled cells;
    // Ctrl+Shift+arrow grows the block to there. As in Excel.
    const arrow = ARROWS[e.key];
    if (selected && arrow && !e.altKey && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const here = cellAt(el);
      if (!here) return;
      const jump = e.ctrlKey || e.metaKey;
      if (e.shiftKey) {
        const a = block?.a ?? here;
        const b = block?.b ?? here;
        // Jumps follow the line the cursor's cell is on (its column going up or down, its row sideways), from the block's far edge.
        let to: Cell | null;
        if (!jump) to = step(b, arrow);
        else if (arrow.dr) { const end = edge({ key: b.key, c: a.c }, arrow); to = end && { key: end.key, c: b.c }; }
        else { const end = edge({ key: a.key, c: b.c }, arrow); to = end && { key: b.key, c: end.c }; }
        if (to) { setBlock({ a, b: to }); reveal(to); }
      } else {
        const to = edge(here, arrow);
        setBlock(null);
        if (to) focusCell(indexOf.get(to.key)!, fields[to.c]);
      }
      return;
    }
    if (selected && arrow && block) setBlock(null); // a plain arrow lets the block go
    if ((selected || typing) && plain && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const c = fields.indexOf(k) + (e.key === 'ArrowRight' ? 1 : -1);
      if (c >= 0 && c < fields.length) el.closest('tr')?.querySelector<HTMLInputElement>(`input[data-k="${fields[c]}"]`)?.focus();
      return;
    }
    let dir = 0;
    if (e.key === 'Enter') dir = e.shiftKey ? -1 : 1;
    else if (e.key === 'Escape') { // a block lets go; an edit is dropped (the cell goes back to what it held), the cell stays selected
      if (block) setBlock(null);
      else if (!selected) { el.value = el.defaultValue; stopEdit(el); }
      return;
    }
    else if ((selected || !SUGGEST[k]) && e.key === 'ArrowDown') dir = 1; // boxes with suggestions keep ↑↓ for the list while edited
    else if ((selected || !SUGGEST[k]) && e.key === 'ArrowUp') dir = -1;
    if (!dir) return;
    e.preventDefault();
    const i = Number(el.closest('tr')!.dataset.i) + dir;
    if (i >= 0 && i < items.length) focusCell(i, k);
    else el.blur();
  };

  /** The next cell that way, if any. */
  const step = (cell: Cell, d: Arrow): Cell | null => {
    const i = indexOf.get(cell.key)! + d.dr, c = cell.c + d.dc;
    return i >= 0 && i < items.length && c >= 0 && c < fields.length ? { key: items[i].key, c } : null;
  };
  /**
   * Where Ctrl+arrow goes, as in Excel: from a filled cell with a filled one next to it, to the last filled
   * cell of that run; otherwise to the next filled cell, or the far end if there's none.
   */
  const edge = (cell: Cell, d: Arrow): Cell | null => {
    let i = indexOf.get(cell.key)!, c = cell.c;
    const inside = (r: number, k: number) => r >= 0 && r < items.length && k >= 0 && k < fields.length;
    const filled = (r: number, k: number) => valueAt(r, k) !== '';
    if (!inside(i + d.dr, c + d.dc)) return null;
    if (filled(i, c) && filled(i + d.dr, c + d.dc)) {
      while (inside(i + d.dr, c + d.dc) && filled(i + d.dr, c + d.dc)) { i += d.dr; c += d.dc; }
    } else {
      do { i += d.dr; c += d.dc; } while (inside(i, c) && !filled(i, c));
      if (!inside(i, c)) { i -= d.dr; c -= d.dc; }
    }
    return { key: items[i].key, c };
  };
  /** Scrolls a cell into view (the corner of a block being grown with the keys). */
  const reveal = (cell: Cell) => {
    const i = indexOf.get(cell.key)!;
    virtualizer.scrollToIndex(i, { align: 'auto' });
    requestAnimationFrame(() => scrollRef.current?.querySelector(`tr[data-i="${i}"] td[data-c="${cell.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };

  /** Delete on a selected cell empties it (saved as one change; Undo brings it back). */
  const clearCell = (el: HTMLInputElement) => {
    const i = Number(el.closest('tr')?.dataset.i);
    const it = items[i];
    const k = el.dataset.k as Field;
    if (!it || !el.value) return;
    if (it.kind === 'empty' || it.kind === 'new') { el.value = ''; return; } // nothing saved there yet
    const passes = itemPasses(type, it);
    const { locked } = planClear(passes, [k]);
    if (locked.length) return refuseLocked(locked, 'cleared');
    onClear(passes, [k], '1 cell', false);
    requestAnimationFrame(() => focusCell(i, k)); // the cell stays selected
  };

  // Cells copied from Excel fill downward (one line per row) and rightward.
  const onPasteCells = (e: ClipboardEvent<HTMLTableSectionElement>) => {
    const el = e.target as HTMLInputElement;
    let k = el.dataset.k as Field | undefined;
    let text = e.clipboardData.getData('text');
    // Rows copied from the sheet by Sr. No.: fill this row from Name, leaving the Sr. No. out.
    if (copiedRows && trimLines(text) === copiedRows.text) { text = copiedRows.cells; k = fields[0]; }
    if (!k) return;
    // One value into a cell being edited goes in at the caret. Into a selected cell it replaces what's
    // there, as in Excel: through the paste, which asks first if the cell holds something. Into a row
    // not in the register yet it's typed in (the pass is added when the row is left).
    if (!isMultiCell(text) && !el.readOnly) return;
    e.preventDefault();
    setBlock(null);
    const i = Number(el.closest('tr')!.dataset.i);
    if (!isMultiCell(text) && items[i].kind !== 'row' && items[i].kind !== 'group') {
      if (startEdit(el, undefined, true)) { el.value = cleanText(text); el.setSelectionRange(el.value.length, el.value.length); }
      return;
    }
    onPaste(pasteRows(), i, k, text, canAdd);
  };

  const lookup = (phone: string) => detailsFor(phones, phone);
  const picksRef = useRef(picks);
  useEffect(() => { picksRef.current = picks; });
  const pickOf = useCallback<PickOf>((text) => picksRef.current.get(text), []); // the same each time: rows stay memoised
  /** One row of the sheet. */
  const drawItem = (v: (typeof vItems)[number]) => {
    const it = items[v.index];
    const i = v.index;
    let mark: Mark | undefined;
    if (multi && rect && i >= rect.r0 && i <= rect.r1) mark = { sel: [rect.c0, rect.c1] };
    if (fillTo && i >= fillTo.r0 && i <= fillTo.r1) mark = { ...mark, fill: [fillTo.c0, fillTo.c1] };
    if (source && i === source.r1) mark = { ...mark, handle: source.c1 };
    if (it.kind === 'row') {
      const ds = dupes.get(it.p.id);
      return (
        <Row
          key={v.key} p={it.p} i={i} fields={fields} mark={mark} selected={inSpan(selection, it.p)} onEdit={onEdit} onPrinted={onPrinted} onGiven={onGiven}
          dupePhone={alsoHeld(ds, 'phone') || undefined} dupeReg={alsoHeld(ds, 'vehicle_no') || undefined}
          held={phones.get(phoneKey(it.p.phone))?.length ?? 0} onPerson={onPerson} pickOf={pickOf} onPick={onPick}
        />
      );
    }
    if (it.kind === 'group') {
      return (
        <GroupRow
          key={v.key} passes={it.passes} i={i} open={it.open} fields={fields} mark={mark}
          selected={it.passes.every((p) => inSpan(selection, p))}
          onToggle={() => toggle(it.key)} onEdit={onEdit} onPrinted={onPrinted} onGiven={onGiven}
        />
      );
    }
    if (it.kind === 'empty') {
      return <BlankRow key={v.key} i={i} serial={it.serial} fields={fields} mark={mark} selected={selection !== null && it.serial >= selection.lo && it.serial <= selection.hi} onCreate={onCreate} lookup={lookup} pickOf={pickOf} />;
    }
    return <BlankRow key={v.key} i={i} serial={next} fields={fields} mark={mark} selected={false} onCreate={onCreate} lookup={lookup} pickOf={pickOf} last />;
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <Watermark type={type} />
    <div ref={scrollRef} className="relative min-h-0 min-w-0 flex-1 overflow-auto">
      <table className={`sheet-grid w-full table-fixed border-separate border-spacing-0 ${multi ? 'has-block' : ''}`} style={{ minWidth: tableMin }}>
        <colgroup>
          <col style={{ width: COL.serial }} />
          {before(fields).map((k) => <col key={k} style={{ width: WIDTH[k] }} />)}
          <col style={{ width: COL.printed }} />
          <col style={{ width: COL.given }} />
          {after(fields).map((k) => <col key={k} style={{ width: WIDTH[k] }} />)}
          <col style={{ width: COL.added }} />
          <col style={{ width: COL.by }} />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr className="h-[30px] text-left">
            <th className={`${th} ${margin}`}>Sr. No.</th>
            {before(fields).map((k) => <th key={k} data-col={k} className={th}>{fieldLabel(type, k)}</th>)}
            <th data-col="printed" className={`${th} text-center`}>Printed</th>
            <th data-col="given" className={`${th} text-center`}>Given</th>
            {after(fields).map((k) => (
              <th key={k} data-col={k} className={th} title="Who collected the pass. Can be filled in after printing.">{fieldLabel(type, k)}</th>
            ))}
            <th className={th}>Added</th>
            <th className={th}>Added by</th>
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown} onPaste={onPasteCells} onMouseDown={onMouseDown} onMouseOver={onMouseOver} onFocus={onFocusCell} onBlur={onBlurCell}>
          {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={cols} /></tr>}
          {vItems.flatMap((v, j) => {
            const gap = j > 0 ? v.start - vItems[j - 1].end : 0; // the row kept drawn, away from the rest
            const row = drawItem(v);
            return gap > 0 ? [<tr key={`gap${v.key}`} aria-hidden style={{ height: gap }}><td colSpan={cols} /></tr>, row] : [row];
          })}
          {padBottom > 0 && <tr style={{ height: padBottom }}><td colSpan={cols} /></tr>}
        </tbody>
      </table>
      {view.length === 0 && !canAdd && (
        <p className="py-16 text-center text-muted-foreground">{total === 0 ? 'No passes yet.' : 'Nothing matches your search.'}</p>
      )}
      {total === 0 && canAdd && (
        <p className="py-10 text-center text-muted-foreground">
          No passes yet. Give a range in the panel on the right, or type / paste rows from Excel into the rows above.
        </p>
      )}
    </div>
    </div>
  );
});

/** The sheet's name, large and faint behind the rows in its template colour, so nobody types into the wrong sheet. */
function Watermark({ type }: { type: PassType }) {
  const { label, color } = TYPE_INFO[type];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden pt-8 print:hidden">
      <div
        className="max-w-[92%] text-center font-condensed text-[clamp(64px,10vw,168px)] font-bold uppercase leading-[0.9] tracking-[0.01em] select-none"
        style={{ color: color.band, opacity: 0.075 }}
      >
        {label}
      </div>
    </div>
  );
}

// Ruled like the desk's register: pale blue lines, and a double maroon margin rule after the serial.
const th = 'border-b border-r border-b-input border-r-rule bg-panel px-2 font-condensed text-[14.5px] font-semibold text-foreground/70';
const td = 'h-[30px] border-b border-r border-rule px-2 whitespace-nowrap overflow-hidden text-ellipsis';
const tdCell = 'h-[30px] border-b border-r border-rule p-0 focus-within:shadow-[inset_0_0_0_2px_var(--color-primary)] [tr>&:has(input:read-write)]:!bg-white'; // white while being edited (over the focused row's tint)
/** A field cell, marked if it's in the selected block, in the fill preview, or holds the fill handle. */
const cellTd = (c: number, mark: Mark | undefined) =>
  `${tdCell} ${within(mark?.sel, c) ? 'shadow-[inset_0_0_0_999px_rgb(37_99_235/0.11)]' : ''} ${within(mark?.fill, c) ? 'shadow-[inset_0_0_0_999px_rgb(138_14_3/0.09)]' : ''} ${mark?.handle === c ? 'relative' : ''}`;
/** The fill handle: drag it down or right to copy the cell (or block) into the cells it passes. */
const FillHandle = () => (
  <span
    data-fill aria-hidden title="Drag down or right to copy into those cells"
    className="absolute -right-[4px] -bottom-[4px] z-[5] size-[8px] cursor-crosshair border border-white bg-primary"
  />
);
/**
 * On a row the server hasn't confirmed yet. Shown only while saving is slow or the connection is down
 * (the bar above says so, see AppShell): normally a row is saved before anyone could notice.
 */
const NotSaved = () => (
  <span role="img" aria-label="not saved yet" title="Not saved yet: kept on this screen until the connection is back"
    className="ml-1.5 hidden size-[9px] rounded-full bg-amber-500 align-[1px] ring-2 ring-amber-200 group-data-[unsaved]/app:inline-block" />
);
const margin = 'border-r-[3px] border-double !border-r-primary/75';
const serialCls = 'font-condensed text-[16px] font-semibold tabular-nums tracking-[0.02em]';
const rowCls = (selected: boolean, extra = '') =>
  `${selected ? '[&>td]:bg-sand-100' : `hover:[&>td]:bg-muted/60 ${focusRow}`} ${extra}`;
/** The row holding the cell being typed in (like Excel): tinted, with its Sr. No. marked. */
const focusRow = '[&:focus-within>td]:!bg-[#edf3f9]';
const rowHead = '[tr:focus-within>&]:!bg-rule [tr:focus-within>&]:!text-foreground';
/** Sr. No. of a row picked for the bar above (click, Shift+click or drag down the Sr. No.s). */
const picked = '!bg-sand-200 !text-sand-900';

/**
 * One pass. `dupePhone` / `dupeReg`: what its phone / Reg. No. repeats (the cell is marked red, and says so
 * on hover). `held`: passes on its phone, on every sheet. The Sr. No. shows a person icon that opens them all
 * (with the count from 2; for one, only while the row is pointed at or has the cursor).
 */
const Row = memo(function Row({ p, i, fields, mark, selected, onEdit, onPrinted, onGiven, dupePhone, dupeReg, held, onPerson, pickOf, onPick }: {
  p: Pass; i: number; fields: readonly Field[]; mark?: Mark; selected: boolean; onEdit: EditFn; onPrinted: SheetProps['onPrinted'];
  onGiven: SheetProps['onGiven']; dupePhone?: string; dupeReg?: string; held: number; onPerson: SheetProps['onPerson'];
  pickOf: PickOf; onPick: PickFn;
}) {
  const printed = isPrinted(p);
  const given = isGiven(p);
  const cell = (k: Field) => {
    const c = fields.indexOf(k);
    const warn = k === 'phone' ? dupePhone : k === 'vehicle_no' ? dupeReg : undefined;
    return (
      <td key={k} data-c={c} className={`${cellTd(c, mark)} ${warn ? 'relative' : ''}`} title={warn}>
        {warn && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-red-600" />}
        <CellInput
          key={p[k]} target={[p]} k={k} saved={p[k]} locked={printed && locksWhenPrinted(k)} warn={!!warn} onEdit={onEdit}
          pick={k === 'name' ? { of: pickOf, save: (v) => onPick(p, v) } : undefined}
        />
        {mark?.handle === c && <FillHandle />}
      </td>
    );
  };
  return (
    <tr data-i={i} className={rowCls(selected)}>
      <td data-pick className={`${td} ${margin} ${serialCls} ${rowHead} relative cursor-pointer select-none ${selected ? picked : ''}`} title="Click to select. Shift+click or drag for more.">
        {fmtSerial(p.serial)}{isUnsaved(p) && <NotSaved />}
        {held > 0 && <HeldCount n={held} warn={!!(dupePhone || dupeReg)} onClick={() => onPerson(phoneKey(p.phone))} />}
      </td>
      {before(fields).map(cell)}
      <td className={`${td} text-center`}>
        <TickBox col="printed" checked={printed} onChange={(v) => onPrinted([p], v)} title={printed ? `Printed ${new Date(p.printed_at!).toLocaleString()}. Locked. Untick to change it or print it again.` : 'Not printed yet'} />
      </td>
      <td className={`${td} text-center`}>
        <TickBox
          col="given" checked={given} disabled={!given && !printed} onChange={(v) => onGiven([p], v)}
          title={given ? `Given ${new Date(p.given_at!).toLocaleString()}. Untick if it wasn't handed over.` : printed ? 'Not given yet: tick when the pass is handed over' : 'Not printed yet: print it first, then tick Given when it is handed over'}
        />
      </td>
      {after(fields).map(cell)}
      <td className={`${td} text-[13.5px] text-muted-foreground`} title={new Date(p.created_at).toLocaleString()}>{shortDate(p.created_at)}</td>
      <AddedBy ids={[p.created_by]} />
    </tr>
  );
});

/**
 * The person on this pass (by phone): opens all their passes. On more passes (any sheet) it shows how many,
 * red if one breaks a rule; on just this one it shows only while the row is pointed at or has the cursor.
 */
const HeldCount = ({ n, warn, onClick }: { n: number; warn: boolean; onClick: () => void }) => (
  <button
    type="button" tabIndex={-1} onClick={onClick}
    title={n > 1 ? `Holds ${n} passes (same phone)${warn ? ', breaking a rule' : ''}: click to see them all` : "This person's passes"}
    className={`absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 rounded-full py-px font-condensed text-[12.5px] leading-[16px] font-semibold tabular-nums ${
      n === 1 ? 'px-1 text-muted-foreground opacity-0 hover:bg-sand-200 hover:text-sand-900 [tr:focus-within_&]:opacity-100 [tr:hover_&]:opacity-100'
        : `pr-1.5 pl-1 ${warn ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-sand-200 text-sand-900 hover:bg-sand-500 hover:text-white'}`
    }`}
  >
    <svg aria-hidden width="10" height="11" viewBox="0 0 10 11" fill="currentColor"><circle cx="5" cy="3" r="2.6" /><path d="M0 11c0-3 2.2-4.8 5-4.8s5 1.8 5 4.8z" /></svg>
    {n > 1 && n}
  </button>
);

/** "0500–04", "0598–603": the second serial without the digits it shares with the first (at least two kept). */
function shortRange(lo: number, hi: number) {
  const a = fmtSerial(lo), b = fmtSerial(hi);
  let same = 0;
  while (same < a.length && a.length === b.length && a[same] === b[same]) same++;
  return `${a}–${b.slice(Math.min(same, b.length - 2))}`;
}

/** A series given to one incharge, shown as "0003–17". Edits apply to every pass in it. */
function GroupRow({ passes, i, open, fields, mark, selected, onToggle, onEdit, onPrinted, onGiven }: {
  passes: Pass[]; i: number; open: boolean; fields: readonly Field[]; mark?: Mark; selected: boolean; onToggle: () => void;
  onEdit: EditFn; onPrinted: SheetProps['onPrinted']; onGiven: SheetProps['onGiven'];
}) {
  const first = passes[0];
  const printed = isPrinted(first);
  const given = isGiven(first);
  const cell = (k: Field) => {
    const c = fields.indexOf(k);
    return (
      <td key={k} data-c={c} className={cellTd(c, mark)}>
        <CellInput key={first[k]} target={passes} k={k} saved={first[k]} locked={printed && locksWhenPrinted(k)} onEdit={onEdit} />
        {mark?.handle === c && <FillHandle />}
      </td>
    );
  };
  return (
    <tr data-i={i} className={rowCls(selected, '[&>td]:bg-sand-50')}>
      <td
        data-pick className={`${td} ${margin} ${serialCls} ${rowHead} !pr-1 !pl-0 cursor-pointer select-none ${selected ? picked : ''}`}
        title={`${fmtSerial(first.serial)}–${fmtSerial(passes[passes.length - 1].serial)}: ${passes.length} passes. Click to select them.`}
      >
        <button
          className="w-4 text-center text-[13px] text-primary hover:bg-primary/10" onClick={onToggle}
          title={open ? 'Collapse' : `Show each of the ${passes.length} passes`}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="text-[14px]">{shortRange(first.serial, passes[passes.length - 1].serial)}</span>
      </td>
      {before(fields).map(cell)}
      <td className={`${td} text-center`}>
        <TickBox col="printed" checked={printed} onChange={(v) => onPrinted(passes, v)} title={printed ? 'Printed: locked. Untick to change them or print them again.' : 'Not printed yet'} />
      </td>
      <td className={`${td} text-center`}>
        <TickBox
          col="given" checked={given} disabled={!given && !printed} onChange={(v) => onGiven(passes, v)}
          title={given ? 'Given. Untick if they weren\'t handed over.' : printed ? 'Not given yet: tick when these passes are handed over' : 'Not printed yet: print them first, then tick Given when they are handed over'}
        />
      </td>
      {after(fields).map(cell)}
      <td className={`${td} text-[13.5px] text-muted-foreground`}>{addedSpan(passes)}</td>
      <AddedBy ids={passes.map((p) => p.created_by)} />
    </tr>
  );
}

/**
 * A serial not in the register yet: an unfilled row, or (`last`) the row for the next serial at the
 * bottom. Type across it (Tab between cells); the pass is added when you leave the row, with
 * everything typed in it. Enter on the last row adds it and stays there for the next one.
 */
function BlankRow({ i, serial, fields, mark, selected, onCreate, lookup, pickOf, last = false }: {
  i: number; serial: number; fields: readonly Field[]; mark?: Mark; selected: boolean; onCreate: SheetProps['onCreate'];
  lookup: (phone: string) => ReturnType<typeof detailsFor>; pickOf: PickOf; last?: boolean;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  const latest = useRef({ onCreate, serial, lookup });
  useEffect(() => { latest.current = { onCreate, serial, lookup }; });

  const collect = (row: HTMLTableRowElement | null): Values | null => {
    const values: Values = {};
    for (const el of row?.querySelectorAll<HTMLInputElement>('input[data-k]') ?? []) {
      const v = cleanText(el.value);
      if (v) values[el.dataset.k as Field] = v;
    }
    return Object.keys(values).length ? values : null;
  };
  // The pass shows as a row above at once (saved in the background), so the row empties at once: what
  // was typed is never left here to be added a second time.
  const commit = (refocus: boolean) => {
    const row = ref.current;
    const values = collect(row);
    if (!row || !values) return;
    const saving = latest.current.onCreate(latest.current.serial, values);
    const inputs = [...row.querySelectorAll<HTMLInputElement>('input[data-k]')];
    for (const el of inputs) el.value = '';
    if (refocus) inputs[0]?.focus();
    // Refused (e.g. a value not allowed): what was typed comes back, unless the next one is being typed.
    void saving.then((ok) => {
      if (ok || !ref.current || collect(ref.current)) return;
      for (const el of ref.current.querySelectorAll<HTMLInputElement>('input[data-k]')) el.value = values[el.dataset.k as Field] ?? '';
    });
  };
  const onBlur = (e: FocusEvent<HTMLTableRowElement>) => {
    if (!ref.current?.contains(e.relatedTarget as Node | null)) void commit(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (!last || e.key !== 'Enter') return; // other rows: Enter moves down, and leaving the row adds it
    e.preventDefault();
    void commit(true);
  };
  // A known phone fills in the name, dept and area still empty, from the person's latest pass. Only while
  // the row is still being typed (the cursor moves on within it), so what's filled is seen before it's added.
  const fillFromPhone = (e: FocusEvent<HTMLInputElement>) => {
    const row = ref.current;
    if (!row?.contains(e.relatedTarget as Node | null)) return; // leaving the row: it's added as typed
    const found = latest.current.lookup(e.currentTarget.value);
    if (!found) return;
    const filled: string[] = [];
    for (const el of row.querySelectorAll<HTMLInputElement>('input[data-k]')) {
      const k = el.dataset.k as Field;
      const v = found.values[k];
      if (v && !el.value.trim()) { el.value = v; filled.push(FIELD_LABELS[k]); }
    }
    if (filled.length) toast(`Filled in ${filled.join(', ')} from ${passLabel(found.from)}. Change them if they're not right.`);
  };
  // A person picked from the Name suggestions: their name, and their phone, dept and area where still empty.
  // Added with the rest when the row is left, as if typed.
  const pickPerson = (e: FormEvent<HTMLInputElement>) => {
    const found = pickOf(e.currentTarget.value);
    if (!found) return;
    e.currentTarget.value = found.name ?? '';
    for (const el of ref.current?.querySelectorAll<HTMLInputElement>('input[data-k]') ?? []) {
      const v = found[el.dataset.k as Field];
      if (el !== e.currentTarget && v && !el.value.trim()) el.value = v;
    }
  };
  const cell = (k: Field) => {
    const c = fields.indexOf(k);
    return (
      <td key={k} data-c={c} className={cellTd(c, mark)}>
        <input
          data-k={k} readOnly list={SUGGEST[k]} placeholder={last && c === 0 ? 'type or paste…' : ''} className={cellCls(false, k)}
          onBlur={k === 'phone' ? fillFromPhone : undefined} onInput={k === 'name' ? pickPerson : undefined}
        />
        {mark?.handle === c && <FillHandle />}
      </td>
    );
  };
  // Typed something, then scrolled away before leaving the row: still add it.
  useEffect(() => {
    const row = ref.current;
    return () => {
      const values = collect(row);
      if (values) void latest.current.onCreate(latest.current.serial, values);
    };
  }, []);

  return (
    <tr ref={ref} data-i={i} data-new={last || undefined} className={last ? `[&>td]:bg-sand-50/70 ${focusRow}` : rowCls(selected)} onBlur={onBlur} onKeyDown={onKeyDown}>
      <td data-pick={last ? undefined : true} className={`${td} ${margin} ${serialCls} ${rowHead} !font-normal !text-muted-foreground/80 ${last ? '' : 'cursor-pointer select-none'} ${selected ? picked : ''}`} title={last ? 'Type or paste here to add the next pass' : 'Not in the register yet: type or paste to fill it'}>
        {last && <span aria-hidden className="mr-1">+</span>}{fmtSerial(serial)}
      </td>
      {before(fields).map(cell)}
      <td className={td} />
      <td className={`${td} text-[13.5px] text-muted-foreground/60`}>{last ? '' : 'Free'}</td>
      {after(fields).map(cell)}
      <td className={td} />
      <td className={td} />
    </tr>
  );
}

const dayFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' });
const shortDate = (iso: string) => dayFmt.format(new Date(iso));
/** "10 Nov", or "08 Nov–10 Nov" when a series was added over several days. */
/** Who added the pass(es) to the register. */
function AddedBy({ ids }: { ids: number[] }) {
  const who = addedBy(ids, useUserNames());
  return <td className={`${td} text-[13.5px] text-muted-foreground`} title={who}>{who}</td>;
}

function addedSpan(passes: Pass[]) {
  let lo = passes[0].created_at;
  let hi = lo;
  for (const p of passes) {
    if (p.created_at < lo) lo = p.created_at;
    if (p.created_at > hi) hi = p.created_at;
  }
  const a = shortDate(lo);
  const b = shortDate(hi);
  return a === b ? a : `${a}–${b}`;
}

function TickBox({ col, checked, disabled, onChange, title }: {
  col: 'printed' | 'given'; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; title: string;
}) {
  return (
    <input
      type="checkbox" data-col={col} disabled={disabled} title={title} checked={checked} onChange={(e) => onChange(e.target.checked)}
      className="size-4 cursor-pointer align-middle accent-primary disabled:cursor-not-allowed disabled:opacity-35"
    />
  );
}

/*
 * Cells work like Excel's. A cell's box is read-only while the cell is only selected (clicked, or reached
 * with Tab, Enter or the arrow keys): no caret, the arrow keys move between cells, Delete empties it,
 * and typing replaces what's in it. Double-click, F2 or typing edits it (the box becomes editable)
 * until the cell is left (it saves) or Esc (it goes back). Printed cells can't be edited (`data-locked`).
 */
/**
 * Starts editing a selected cell, with the caret at `caret` (else wherever the browser puts it). `typing`:
 * started by typing into it, so ← → still move between cells (as in Excel). False if printed.
 */
function startEdit(el: HTMLInputElement, caret?: number | 'end', typing = false): boolean {
  if (el.dataset.locked) {
    toast('This pass is printed, so this cell is locked. Untick Printed first to change it.', 'error');
    return false;
  }
  el.readOnly = false;
  if (typing) el.dataset.typing = '1';
  if (caret !== undefined) {
    const at = caret === 'end' ? el.value.length : caret;
    el.setSelectionRange(at, at);
  }
  return true;
}
function stopEdit(el: HTMLInputElement) {
  el.readOnly = true;
  delete el.dataset.typing;
  el.setSelectionRange(0, 0);
}
const refuseLocked = (locked: number[], what: string) =>
  toast(`${ranges(locked)} ${locked.length === 1 ? 'is' : 'are'} printed, so nothing was ${what}. Untick Printed first.`, 'error');

let ruler: CanvasRenderingContext2D | null = null;
/** Where in the box's text a click at `x` falls: the nearest place for the caret. */
function caretAt(el: HTMLInputElement, x: number): number {
  ruler ??= document.createElement('canvas').getContext('2d');
  if (!ruler) return el.value.length;
  const s = getComputedStyle(el);
  ruler.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  ruler.letterSpacing = s.letterSpacing === 'normal' ? '0px' : s.letterSpacing;
  const text = s.textTransform === 'uppercase' ? el.value.toUpperCase() : el.value;
  const at = x - el.getBoundingClientRect().left - parseFloat(s.paddingLeft) - parseFloat(s.borderLeftWidth) + el.scrollLeft;
  let best = text.length;
  let gap = Infinity;
  for (let i = 0; i <= text.length; i++) {
    const d = Math.abs(ruler.measureText(text.slice(0, i)).width - at);
    if (d < gap) { gap = d; best = i; }
  }
  return best;
}

const cellCls = (locked: boolean, k: Field, warn = false) =>
  `h-[29px] w-full bg-transparent px-2 uppercase outline-none ${warn ? '!text-red-700' : ''} placeholder:normal-case placeholder:text-muted-foreground/50 read-only:selection:bg-transparent ${locked ? 'cursor-default text-muted-foreground' : 'read-only:cursor-cell'} ${k === 'name' || k === 'incharge' ? 'font-medium' : ''} ${k === 'phone' || k === 'vehicle_no' ? 'tabular-nums' : ''}`;

/**
 * Uncontrolled box that saves on blur. Keyed by its value, so it redraws when the value changes
 * from outside (another desk, undo, paste). A row scrolled out of view mid-edit still saves.
 * If a save fails the box goes back to the saved value, so it never shows something unsaved.
 */
function CellInput({ target, k, saved, locked, warn, onEdit, pick }: {
  target: Pass[]; k: Field; saved: string; locked: boolean; warn?: boolean; onEdit: EditFn;
  /** Name, on a single pass: suggests people, and a person picked is saved at once with their phone, dept and area. */
  pick?: { of: PickOf; save: (v: Values) => Promise<boolean> };
}) {
  const ref = useRef<HTMLInputElement>(null);
  const sent = useRef(saved); // last value saved, or being saved
  const latest = useRef({ target, onEdit, locked });
  useEffect(() => { latest.current = { target, onEdit, locked }; });

  const save = (raw: string) => {
    const { target: t, onEdit: edit, locked: l } = latest.current;
    const v = cleanField(k, raw);
    if (l) return;
    // Nothing new: e.g. a plate typed without dashes, or a value saved before capitals, left as it was.
    if (v === cleanField(k, sent.current)) { if (ref.current) ref.current.value = v; return; }
    sent.current = v;
    void edit(t, k, v, saved).then((ok) => {
      if (ok || !ref.current) return;
      ref.current.value = saved;
      sent.current = saved;
    });
  };
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  // Removed while holding an unsaved edit (scrolled away, or the value changed meanwhile): save it.
  // If the value changed meanwhile, the server refuses and says who changed it.
  useEffect(() => {
    const el = ref.current;
    return () => { if (el) saveRef.current(el.value); };
  }, []);

  const pickPerson = (e: FormEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const found = pick?.of(el.value);
    if (!pick || !found) return;
    el.value = found.name ?? '';
    sent.current = el.value; // saved here, not again on leaving the cell
    stopEdit(el);
    const back = `tbody tr[data-i="${el.closest('tr')?.dataset.i}"] input[data-k="${k}"]`;
    void pick.save(found).then((ok) => {
      if (ok || !ref.current) return;
      ref.current.value = saved;
      sent.current = saved;
    });
    // The row is drawn again with the new values: the cursor stays on it (unless a question took it).
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) document.querySelector<HTMLInputElement>(back)?.focus();
    });
  };

  return (
    <input
      ref={ref}
      data-k={k}
      defaultValue={saved}
      readOnly // until edited: see startEdit
      data-locked={locked || undefined}
      list={locked || (k === 'name' && !pick) ? undefined : SUGGEST[k]}
      onInput={pick && pickPerson}
      title={locked ? 'Printed: locked. Untick Printed to change it.' : undefined}
      onBlur={(e) => save(e.target.value)}
      className={cellCls(locked, k, warn)}
    />
  );
}
