'use client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { addedBy, useUserNames } from '@/client/users';
import {
  type ClipboardEvent, type FocusEvent, type KeyboardEvent, memo, type MouseEvent, useEffect, useMemo, useRef, useState,
} from 'react';
import { blankPass, groupRuns, isGiven, isMultiCell, isPrinted } from '@/lib/passes';
import { cleanText, type Field, FIELD_LABELS, fieldsFor, fmtSerial, type Pass, type PassType, type Values } from '@/shared/types';

const ROW_H = 30; // keep in step with h-[30px] below
/** Columns with typing suggestions (datalists rendered by SheetScreen). */
const SUGGEST: Partial<Record<Field, string>> = { incharge: 'dl-incharge', area: 'dl-area', dept: 'dl-dept' };
const WIDTH: Partial<Record<Field, number>> = { dept: 130, area: 130, phone: 120, vehicle: 150, vehicle_no: 130 };

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
  | { kind: 'row'; key: string; p: Pass; n: number }
  | { kind: 'group'; key: string; passes: Pass[]; open: boolean }
  | { kind: 'empty'; key: string; serial: number; n: number }
  | { kind: 'new'; key: string };

/** The passes behind a row. An unfilled row stands for a pass that doesn't exist yet. */
const itemPasses = (type: PassType, it: Item): Pass[] =>
  it.kind === 'row' ? [it.p] : it.kind === 'group' ? it.passes : it.kind === 'empty' ? [blankPass(type, it.serial)] : [];

/** Saves one cell for these passes. `saved` is the value the user started from. Resolves false if nothing was saved. */
export type EditFn = (target: Pass[], key: Field, value: string, saved: string) => Promise<boolean>;

export interface SheetProps {
  type: PassType;
  view: Pass[];
  total: number;
  selection: Span | null;
  /** Show the blank row for adding the next serial (off while searching / filtering). */
  canAdd: boolean;
  next: number;
  /** Serials not in the register yet, shown as empty rows to type or paste into ([] while searching). */
  missing: number[];
  onEdit: EditFn;
  /** Adds this serial with these values. */
  onCreate: (serial: number, values: Values) => Promise<boolean>;
  onPaste: (rows: Pass[][], start: number, key: Field, text: string, canCreate: boolean) => void;
  onPrinted: (passes: Pass[], printed: boolean) => void;
  onSelect: (span: Span) => void;
  onSelectEnd: () => void;
}

/** Only the rows in view (plus a few either side) are drawn, so thousands of passes stay fast. */
export const Sheet = memo(function Sheet(props: SheetProps) {
  const { type, view, total, selection, canAdd, next, missing, onEdit, onCreate, onPaste, onPrinted, onSelect, onSelectEnd } = props;
  const fields = fieldsFor(type);
  const cols = 5 + fields.length;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  const items = useMemo(() => {
    const out: Item[] = [];
    let n = 0;
    let m = 0; // next unfilled serial to place, in serial order
    const emptiesBefore = (serial: number) => {
      for (; m < missing.length && missing[m] < serial; m++) out.push({ kind: 'empty', key: `e${missing[m]}`, serial: missing[m], n: ++n });
    };
    for (const run of groupRuns(view)) {
      emptiesBefore(run[0].serial);
      if (run.length === 1) { out.push({ kind: 'row', key: String(run[0].id), p: run[0], n: ++n }); continue; }
      const key = `g${run[0].id}`;
      const open = opened.has(key);
      out.push({ kind: 'group', key, passes: run, open });
      for (const p of run) { n++; if (open) out.push({ kind: 'row', key: String(p.id), p, n }); }
    }
    emptiesBefore(Infinity);
    if (canAdd) out.push({ kind: 'new', key: 'new' });
    return out;
  }, [view, opened, canAdd, missing]);

  const toggle = (key: string) => setOpened((s) => {
    const nextSet = new Set(s);
    if (!nextSet.delete(key)) nextSet.add(key);
    return nextSet;
  });

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    getItemKey: (i) => items[i].key,
    paddingStart: ROW_H, // the sticky header sits above the first row
    scrollPaddingStart: ROW_H,
    overscan: 15,
  });
  const vItems = virtualizer.getVirtualItems();
  const padTop = vItems.length ? vItems[0].start - ROW_H : 0;
  const padBottom = vItems.length ? virtualizer.getTotalSize() - vItems[vItems.length - 1].end : 0;

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
  const onMouseDown = (e: MouseEvent<HTMLTableSectionElement>) => {
    const el = e.target as Element;
    if (e.button !== 0 || el.closest('button') || !el.closest('td[data-pick]')) return;
    const span = spanOf(itemAt(el));
    if (!span) return;
    e.preventDefault(); // no text selection while dragging
    if (e.shiftKey && anchor.current) extendTo(span);
    else { anchor.current = span; onSelect(span); }
    dragging.current = true;
  };
  const onMouseOver = (e: MouseEvent<HTMLTableSectionElement>) => {
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
    const go = (el: HTMLInputElement | null | undefined) => { el?.focus(); el?.select(); };
    const el = find();
    if (el) return go(el);
    virtualizer.scrollToIndex(index);
    requestAnimationFrame(() => go(find()));
  };

  // Enter / ↓ moves down, Shift+Enter / ↑ moves up, like Excel.
  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k as Field | undefined;
    if (!k || e.defaultPrevented) return;
    let dir = 0;
    if (e.key === 'Enter') dir = e.shiftKey ? -1 : 1;
    else if (e.key === 'Escape') { el.value = el.defaultValue; el.blur(); return; }
    else if (!SUGGEST[k] && e.key === 'ArrowDown') dir = 1; // boxes with suggestions keep ↑↓ for the list
    else if (!SUGGEST[k] && e.key === 'ArrowUp') dir = -1;
    if (!dir) return;
    e.preventDefault();
    const i = Number(el.closest('tr')!.dataset.i) + dir;
    if (i >= 0 && i < items.length) focusCell(i, k);
    else el.blur();
  };

  // Cells copied from Excel fill downward (one line per row) and rightward.
  const onPasteCells = (e: ClipboardEvent<HTMLTableSectionElement>) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k as Field | undefined;
    const text = e.clipboardData.getData('text');
    if (!k || !isMultiCell(text)) return;
    e.preventDefault();
    const rows = items.filter((it) => it.kind !== 'new').map((it) => itemPasses(type, it));
    const i = Number(el.closest('tr')!.dataset.i);
    onPaste(rows, items[i].kind === 'new' ? rows.length : i, k, text, canAdd);
  };

  return (
    <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto bg-background">
      <table className="w-full min-w-[1100px] table-fixed border-separate border-spacing-0">
        <colgroup>
          <col style={{ width: 56 }} />
          <col style={{ width: 118 }} />
          {fields.map((k) => <col key={k} style={{ width: WIDTH[k] }} />)}
          <col style={{ width: 70 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 66 }} />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr className="h-[30px] text-left">
            <th className={`${th} text-right`}>#</th>
            <th className={`${th} ${margin}`}>Sr. No.</th>
            {fields.map((k) => <th key={k} className={th}>{FIELD_LABELS[k]}</th>)}
            <th className={th}>Added</th>
            <th className={th}>Added by</th>
            <th className={th}>Status</th>
            <th className={`${th} text-center`}>Printed</th>
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown} onPaste={onPasteCells} onMouseDown={onMouseDown} onMouseOver={onMouseOver}>
          {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={cols} /></tr>}
          {vItems.map((v) => {
            const it = items[v.index];
            if (it.kind === 'row') {
              return <Row key={v.key} p={it.p} i={v.index} n={it.n} fields={fields} selected={inSpan(selection, it.p)} onEdit={onEdit} onPrinted={onPrinted} />;
            }
            if (it.kind === 'group') {
              return (
                <GroupRow
                  key={v.key} passes={it.passes} i={v.index} open={it.open} fields={fields}
                  selected={it.passes.every((p) => inSpan(selection, p))}
                  onToggle={() => toggle(it.key)} onEdit={onEdit} onPrinted={onPrinted}
                />
              );
            }
            if (it.kind === 'empty') {
              return <BlankRow key={v.key} i={v.index} n={it.n} serial={it.serial} fields={fields} selected={selection !== null && it.serial >= selection.lo && it.serial <= selection.hi} onCreate={onCreate} />;
            }
            return <BlankRow key={v.key} i={v.index} serial={next} fields={fields} selected={false} onCreate={onCreate} last />;
          })}
          {padBottom > 0 && <tr style={{ height: padBottom }}><td colSpan={cols} /></tr>}
        </tbody>
      </table>
      {view.length === 0 && !canAdd && (
        <p className="py-16 text-center text-muted-foreground">{total === 0 ? 'No passes yet.' : 'Nothing matches your search.'}</p>
      )}
      {total === 0 && canAdd && (
        <p className="py-10 text-center text-muted-foreground">
          No passes yet. Give a range in the panel on the right, or type / paste rows from Excel into the row above.
        </p>
      )}
    </div>
  );
});

// Ruled like the desk's register: pale blue lines, and a double maroon margin rule after the serial.
const th = 'border-b border-r border-b-input border-r-rule bg-panel px-2 font-condensed text-[14.5px] font-semibold text-foreground/70';
const td = 'h-[30px] border-b border-r border-rule px-2 whitespace-nowrap overflow-hidden text-ellipsis';
const tdCell = 'h-[30px] border-b border-r border-rule p-0 focus-within:shadow-[inset_0_0_0_2px_var(--color-primary)]';
const margin = 'border-r-[3px] border-double !border-r-primary/75';
const lineNo = 'text-right font-condensed text-[13px] tabular-nums text-muted-foreground/75';
const serialCls = 'font-condensed text-[16px] font-semibold tabular-nums tracking-[0.02em]';
const rowCls = (selected: boolean, extra = '') =>
  `${selected ? '[&>td]:bg-sand-100' : 'hover:[&>td]:bg-muted/60'} ${extra}`;

const Row = memo(function Row({ p, i, n, fields, selected, onEdit, onPrinted }: {
  p: Pass; i: number; n: number; fields: readonly Field[]; selected: boolean; onEdit: EditFn; onPrinted: SheetProps['onPrinted'];
}) {
  const printed = isPrinted(p);
  const given = isGiven(p);
  return (
    <tr data-i={i} className={rowCls(selected)}>
      <td data-pick className={`${td} ${lineNo} cursor-pointer select-none ${selected ? '!bg-sand-200 font-semibold !text-sand-900' : ''}`} title="Click to select. Shift+click or drag for more.">{n}</td>
      <td data-pick className={`${td} ${margin} ${serialCls} cursor-pointer select-none`}>{fmtSerial(p.serial)}</td>
      {fields.map((k) => (
        <td key={k} className={tdCell}>
          <CellInput key={p[k]} target={[p]} k={k} saved={p[k]} locked={printed} onEdit={onEdit} />
        </td>
      ))}
      <td className={`${td} text-[13.5px] text-muted-foreground`} title={new Date(p.created_at).toLocaleString()}>{shortDate(p.created_at)}</td>
      <AddedBy ids={[p.created_by]} />
      <td className={`${td} text-[13.5px] ${given ? 'font-semibold text-primary' : 'text-muted-foreground/70'}`}>{given ? 'Given' : 'Free'}</td>
      <td className={`${td} text-center`}>
        <PrintedBox checked={printed} onChange={(v) => onPrinted([p], v)} title={printed ? `Printed ${new Date(p.printed_at!).toLocaleString()}. Locked. Untick to change it or print it again.` : 'Not printed yet'} />
      </td>
    </tr>
  );
});

/** A series given to one incharge, shown as "0003…0017". Edits apply to every pass in it. */
function GroupRow({ passes, i, open, fields, selected, onToggle, onEdit, onPrinted }: {
  passes: Pass[]; i: number; open: boolean; fields: readonly Field[]; selected: boolean; onToggle: () => void;
  onEdit: EditFn; onPrinted: SheetProps['onPrinted'];
}) {
  const first = passes[0];
  const printed = isPrinted(first);
  return (
    <tr data-i={i} className={rowCls(selected, '[&>td]:bg-sand-50')}>
      <td className={`${td} text-right`}>
        <button className="font-condensed text-[13.5px] font-semibold text-primary hover:underline" onClick={onToggle} title={open ? 'Collapse' : 'Show each pass'}>
          {open ? '▾' : '▸'} {passes.length}
        </button>
      </td>
      <td data-pick className={`${td} ${margin} ${serialCls} cursor-pointer select-none`} title={`${passes.length} passes`}>
        {fmtSerial(first.serial)}…{fmtSerial(passes[passes.length - 1].serial)}
      </td>
      {fields.map((k) => (
        <td key={k} className={tdCell}>
          <CellInput key={first[k]} target={passes} k={k} saved={first[k]} locked={printed} onEdit={onEdit} />
        </td>
      ))}
      <td className={`${td} text-[13.5px] text-muted-foreground`}>{addedSpan(passes)}</td>
      <AddedBy ids={passes.map((p) => p.created_by)} />
      <td className={`${td} text-[13.5px] font-semibold text-primary`}>Given</td>
      <td className={`${td} text-center`}>
        <PrintedBox checked={printed} onChange={(v) => onPrinted(passes, v)} title={printed ? 'Printed: locked. Untick to change them or print them again.' : 'Not printed yet'} />
      </td>
    </tr>
  );
}

/**
 * A serial not in the register yet: an unfilled row, or (`last`) the row for the next serial at the
 * bottom. Type across it (Tab between cells); the pass is added when you leave the row, with
 * everything typed in it. Enter on the last row adds it and stays there for the next one.
 */
function BlankRow({ i, n, serial, fields, selected, onCreate, last = false }: {
  i: number; n?: number; serial: number; fields: readonly Field[]; selected: boolean; onCreate: SheetProps['onCreate']; last?: boolean;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  const busy = useRef(false);
  const latest = useRef({ onCreate, serial });
  useEffect(() => { latest.current = { onCreate, serial }; });

  const collect = (row: HTMLTableRowElement | null): Values | null => {
    const values: Values = {};
    for (const el of row?.querySelectorAll<HTMLInputElement>('input[data-k]') ?? []) {
      const v = cleanText(el.value);
      if (v) values[el.dataset.k as Field] = v;
    }
    return Object.keys(values).length ? values : null;
  };
  const commit = async (refocus: boolean) => {
    const values = collect(ref.current);
    if (!values || busy.current) return;
    busy.current = true;
    const ok = await latest.current.onCreate(latest.current.serial, values);
    busy.current = false;
    if (!ok || !ref.current) return;
    for (const el of ref.current.querySelectorAll<HTMLInputElement>('input[data-k]')) el.value = '';
    if (refocus) ref.current.querySelector<HTMLInputElement>('input[data-k]')?.focus();
  };
  const onBlur = (e: FocusEvent<HTMLTableRowElement>) => {
    if (!ref.current?.contains(e.relatedTarget as Node | null)) void commit(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (!last || e.key !== 'Enter') return; // other rows: Enter moves down, and leaving the row adds it
    e.preventDefault();
    void commit(true);
  };
  // Typed something, then scrolled away before leaving the row: still add it.
  useEffect(() => {
    const row = ref.current;
    return () => {
      const values = collect(row);
      if (values && !busy.current) void latest.current.onCreate(latest.current.serial, values);
    };
  }, []);

  return (
    <tr ref={ref} data-i={i} className={last ? '[&>td]:bg-sand-50/70' : rowCls(selected)} onBlur={onBlur} onKeyDown={onKeyDown}>
      <td data-pick={last ? undefined : true} className={`${td} ${lineNo} ${last ? '' : 'cursor-pointer select-none'} ${selected ? '!bg-sand-200 font-semibold !text-sand-900' : ''}`}>
        {last ? '+' : n}
      </td>
      <td data-pick={last ? undefined : true} className={`${td} ${margin} ${serialCls} !font-normal !text-muted-foreground/80 ${last ? '' : 'cursor-pointer select-none'}`} title={last ? 'Type or paste here to add the next pass' : 'Not in the register yet: type or paste to fill it'}>
        {fmtSerial(serial)}
      </td>
      {fields.map((k, c) => (
        <td key={k} className={tdCell}>
          <input data-k={k} list={SUGGEST[k]} placeholder={last && c === 0 ? 'type or paste…' : ''} className={cellCls(false, k)} />
        </td>
      ))}
      <td className={td} />
      <td className={td} />
      <td className={`${td} text-[13.5px] text-muted-foreground/60`}>{last ? '' : 'Free'}</td>
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

function PrintedBox({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <input type="checkbox" className="size-4 cursor-pointer align-middle accent-primary" checked={checked} title={title} onChange={(e) => onChange(e.target.checked)} />
  );
}

const cellCls = (locked: boolean, k: Field) =>
  `h-[29px] w-full bg-transparent px-2 outline-none placeholder:text-muted-foreground/50 ${locked ? 'cursor-default text-muted-foreground' : ''} ${k === 'name' || k === 'incharge' ? 'font-medium' : ''}`;

/**
 * Uncontrolled box that saves on blur. Keyed by its value, so it redraws when the value changes
 * from outside (another desk, undo, paste). A row scrolled out of view mid-edit still saves.
 * If a save fails the box goes back to the saved value, so it never shows something unsaved.
 */
function CellInput({ target, k, saved, locked, onEdit }: { target: Pass[]; k: Field; saved: string; locked: boolean; onEdit: EditFn }) {
  const ref = useRef<HTMLInputElement>(null);
  const sent = useRef(saved); // last value saved, or being saved
  const latest = useRef({ target, onEdit, locked });
  useEffect(() => { latest.current = { target, onEdit, locked }; });

  const save = (raw: string) => {
    const { target: t, onEdit: edit, locked: l } = latest.current;
    const v = cleanText(raw);
    if (l || v === sent.current) return;
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

  return (
    <input
      ref={ref}
      data-k={k}
      defaultValue={saved}
      readOnly={locked}
      list={locked ? undefined : SUGGEST[k]}
      title={locked ? 'Printed: locked. Untick Printed to change it.' : undefined}
      onBlur={(e) => save(e.target.value)}
      className={cellCls(locked, k)}
    />
  );
}
