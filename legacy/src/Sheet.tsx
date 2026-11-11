import { memo, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { EDIT_KEYS, ZONES, type EditKey, type FillKey, type Pass } from './types';
import { groupRuns, isGiven, isMultiCell, type Span } from './lib/passes';

const ROW_H = 31; // must match `th, td { height }` in index.css (header row is the same height)
const COLS = 11;
/** Sheet columns that offer typing suggestions (datalist ids rendered in App). */
const SUGGEST: Partial<Record<EditKey, string>> = { incharge: 'incharges', area: 'areas' };

/** One on-screen row: a single pass, or a collapsed series given to one incharge. */
type Item =
  | { kind: 'row'; key: string; p: Pass; n: number }
  | { kind: 'group'; key: string; passes: Pass[]; open: boolean };

const itemPasses = (it: Item) => (it.kind === 'row' ? [it.p] : it.passes);
const itemSpan = (it: Item): Span => {
  const ps = itemPasses(it);
  return { type: ps[0].type, lo: ps[0].num, hi: ps[ps.length - 1].num };
};
const inSpan = (s: Span | null, p: Pass) => !!s && p.type === s.type && p.num >= s.lo && p.num <= s.hi;

interface Props {
  view: Pass[];
  total: number;
  selection: Span | null;
  /** ids: comma-separated pass ids (a collapsed series edits all of its passes). */
  onEdit: (ids: string, key: FillKey, value: string) => void;
  onPasteCells: (rows: Pass[][], start: number, key: EditKey, text: string) => void;
  onPrinted: (ids: string[], printed: boolean) => void;
  onSelect: (span: Span) => void;
  onSelectEnd: () => void;
}

/** Only the rows in view (plus a few either side) are drawn, so thousands of passes stay fast. */
export function Sheet({ view, total, selection, onEdit, onPasteCells, onPrinted, onSelect, onSelectEnd }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  const items = useMemo(() => {
    const out: Item[] = [];
    let n = 0;
    for (const run of groupRuns(view)) {
      if (run.length === 1) { out.push({ kind: 'row', key: run[0].id, p: run[0], n: ++n }); continue; }
      const key = `g:${run[0].id}`;
      const open = opened.has(key);
      out.push({ kind: 'group', key, passes: run, open });
      for (const p of run) { n++; if (open) out.push({ kind: 'row', key: p.id, p, n }); }
    }
    return out;
  }, [view, opened]);

  const toggle = (key: string) => setOpened((s) => {
    const next = new Set(s);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    getItemKey: (i) => items[i].key,
    paddingStart: ROW_H, // the sticky header sits above the first row
    scrollPaddingStart: ROW_H,
    overscan: 12,
  });
  const vItems = virtualizer.getVirtualItems();
  const padTop = vItems.length ? vItems[0].start - ROW_H : 0;
  const padBottom = vItems.length ? virtualizer.getTotalSize() - vItems[vItems.length - 1].end : 0;

  /* ----- selecting rows: click # or Serial; Shift+click or drag to extend ----- */
  const anchor = useRef<Span | null>(null);
  const dragging = useRef(false);
  const itemAt = (el: Element) => items[Number(el.closest('tr')?.dataset.i)];
  const extendTo = (span: Span) => {
    const a = anchor.current;
    if (!a || a.type !== span.type) { anchor.current = span; onSelect(span); return; }
    onSelect({ type: a.type, lo: Math.min(a.lo, span.lo), hi: Math.max(a.hi, span.hi) });
  };
  const onMouseDown = (e: MouseEvent<HTMLTableSectionElement>) => {
    const el = e.target as Element;
    if (e.button !== 0 || el.closest('button') || !el.closest('td.idx, td.serial')) return;
    const it = itemAt(el);
    if (!it) return;
    e.preventDefault(); // no text selection while dragging
    if (e.shiftKey) extendTo(itemSpan(it));
    else { anchor.current = itemSpan(it); onSelect(anchor.current); }
    dragging.current = true;
  };
  const onMouseOver = (e: MouseEvent<HTMLTableSectionElement>) => {
    if (!dragging.current) return;
    const it = itemAt(e.target as Element);
    if (it) extendTo(itemSpan(it));
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

  // Enter / ↓ moves down, Shift+Enter / ↑ moves up — like Excel.
  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k;
    if (!k) return;
    let dir = 0;
    if (e.key === 'Enter') dir = e.shiftKey ? -1 : 1;
    else if (!SUGGEST[k as EditKey] && e.key === 'ArrowDown') dir = 1; // boxes with suggestions keep ↑↓ for the list
    else if (!SUGGEST[k as EditKey] && e.key === 'ArrowUp') dir = -1;
    if (!dir) return;
    e.preventDefault();
    const next = Number(el.closest('tr')!.dataset.i) + dir;
    if (next >= 0 && next < items.length) focusCell(next, k);
    else el.blur();
  };

  // Cells copied from Excel fill downward (one line per row) and rightward (Name → Dept → Area → Phone → Incharge).
  const onPaste = (e: ClipboardEvent<HTMLTableSectionElement>) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k as EditKey | undefined;
    const text = e.clipboardData.getData('text');
    if (!k || !isMultiCell(text)) return;
    e.preventDefault();
    onPasteCells(items.map(itemPasses), Number(el.closest('tr')!.dataset.i), k, text);
  };

  return (
    <div className="grid" ref={scrollRef}>
      <table>
        <colgroup>
          <col style={{ width: 64 }} /><col style={{ width: 128 }} /><col style={{ width: 78 }} /><col style={{ width: 112 }} />
          <col /><col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 120 }} />
          <col /><col style={{ width: 70 }} /><col style={{ width: 66 }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th><th>Serial</th><th>Type</th><th>Pandal</th><th>Name</th><th>Dept</th><th>Area</th><th>Phone</th>
            <th>Incharge</th><th>Status</th><th>Printed</th>
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown} onPaste={onPaste} onMouseDown={onMouseDown} onMouseOver={onMouseOver}>
          {padTop > 0 && <tr className="pad" style={{ height: padTop }}><td colSpan={COLS} /></tr>}
          {vItems.map((v) => {
            const it = items[v.index];
            if (it.kind === 'row') {
              return <Row key={v.key} p={it.p} i={v.index} n={it.n} selected={inSpan(selection, it.p)} onEdit={onEdit} onPrinted={onPrinted} />;
            }
            return (
              <GroupRow
                key={v.key}
                passes={it.passes}
                i={v.index}
                open={it.open}
                selected={it.passes.every((p) => inSpan(selection, p))}
                onToggle={() => toggle(it.key)}
                onEdit={onEdit}
                onPrinted={onPrinted}
              />
            );
          })}
          {padBottom > 0 && <tr className="pad" style={{ height: padBottom }}><td colSpan={COLS} /></tr>}
        </tbody>
      </table>
      {view.length === 0 && (
        <div className="note empty">
          {total === 0 ? 'No passes yet. Add serial numbers in the panel on the right →' : 'Nothing matches your search.'}
        </div>
      )}
    </div>
  );
}

const Row = memo(function Row({ p, i, n, selected, onEdit, onPrinted }: {
  p: Pass; i: number; n: number; selected: boolean; onEdit: Props['onEdit']; onPrinted: Props['onPrinted'];
}) {
  const given = isGiven(p);
  return (
    <tr data-i={i} className={selected ? 'sel' : undefined}>
      <td className="idx" title="Click to select · Shift+click or drag to select more">{n}</td>
      <td className="serial mono">{p.serial}</td>
      <td><span className={`tag ${p.type}`}>{p.type}</span></td>
      <td className="cell">{p.type === 'Mobile' && <ZonePick ids={p.id} zone={p.zone} onEdit={onEdit} />}</td>
      {EDIT_KEYS.map((k) => (
        <td className="cell" key={k}><CellInput key={p[k]} ids={p.id} k={k} saved={p[k]} onEdit={onEdit} /></td>
      ))}
      <td><span className={given ? 'st given' : 'st'}>{given ? 'Given' : 'Free'}</span></td>
      <td className="printed"><input type="checkbox" checked={p.printed} onChange={(e) => onPrinted([p.id], e.target.checked)} /></td>
    </tr>
  );
});

/** A series given to one incharge, shown as "M-003 … M-017". Edits apply to every pass in it. */
function GroupRow({ passes, i, open, selected, onToggle, onEdit, onPrinted }: {
  passes: Pass[]; i: number; open: boolean; selected: boolean; onToggle: () => void; onEdit: Props['onEdit']; onPrinted: Props['onPrinted'];
}) {
  const first = passes[0];
  const last = passes[passes.length - 1];
  const ids = passes.map((p) => p.id).join(',');
  return (
    <tr data-i={i} className={`group${selected ? ' sel' : ''}`}>
      <td className="idx">
        <button className="twisty" onClick={onToggle} title={open ? 'Collapse' : 'Show each pass'}>
          {open ? '▾' : '▸'} {passes.length}
        </button>
      </td>
      <td className="serial mono" title={`${passes.length} passes`}>{first.serial} … {last.serial}</td>
      <td><span className={`tag ${first.type}`}>{first.type}</span></td>
      <td className="cell">{first.type === 'Mobile' && <ZonePick ids={ids} zone={first.zone} onEdit={onEdit} />}</td>
      {EDIT_KEYS.map((k) => (
        <td className="cell" key={k}><CellInput key={first[k]} ids={ids} k={k} saved={first[k]} onEdit={onEdit} /></td>
      ))}
      <td><span className="st given">Given</span></td>
      <td className="printed">
        <input type="checkbox" checked={first.printed} onChange={(e) => onPrinted(passes.map((p) => p.id), e.target.checked)} />
      </td>
    </tr>
  );
}

/** Pandal / Non Pandal for a Mobile pass (or a whole collapsed series). */
function ZonePick({ ids, zone, onEdit }: { ids: string; zone: Pass['zone']; onEdit: Props['onEdit'] }) {
  return (
    <select className={`zone-pick${zone ? ` ${zone === 'Pandal' ? 'pandal' : 'non-pandal'}` : ''}`} value={zone} onChange={(e) => onEdit(ids, 'zone', e.target.value)}>
      <option value="">—</option>
      {ZONES.map((z) => <option key={z}>{z}</option>)}
    </select>
  );
}

/**
 * Uncontrolled box that saves on blur. Keyed by its value so it redraws when the value changes
 * from outside (undo, paste, fill). Also saves if its row scrolls out of view mid-edit,
 * because a removed input never fires blur.
 */
function CellInput({ ids, k, saved, onEdit }: { ids: string; k: EditKey; saved: string; onEdit: Props['onEdit'] }) {
  const ref = useRef<HTMLInputElement>(null);

  // On unmount (row scrolled away), save whatever was typed.
  useEffect(() => {
    const el = ref.current;
    return () => { if (el && el.value.trim() !== saved) onEdit(ids, k, el.value); };
  }, [ids, k, saved, onEdit]);

  return (
    <input
      ref={ref}
      data-k={k}
      defaultValue={saved}
      list={SUGGEST[k]}
      onBlur={(e) => { if (e.target.value.trim() !== saved) onEdit(ids, k, e.target.value); }}
    />
  );
}
