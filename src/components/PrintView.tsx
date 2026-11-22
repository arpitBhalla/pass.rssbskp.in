'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setPaper, usePaper } from '@/client/paper';
import { errorMessage, useTRPCClient } from '@/client/trpc';
import { type CardData, nPasses } from '@/lib/passes';
import { pagesFor, PAPER, PAPERS } from '@/lib/sheets';
import { fmtSerial, TYPE_INFO } from '@/shared/types';
import { PassMark } from './AppShell';
import { PassCard, type PrintTexts, useCardFonts } from './cards/PassCard';
import { btn, btnPrimary } from './ui';

type Mark = { state: 'idle' } | { state: 'busy' } | { state: 'done'; undo: () => Promise<boolean> } | { state: 'error'; text: string };
/** The QR codes by `type:serial`. */
type Codes = { state: 'loading' } | { state: 'ready'; byPass: Map<string, string> } | { state: 'error'; text: string };
const keyOf = (c: CardData) => `${c.type}:${c.serial}`;

/**
 * Full-screen preview of the passes on A3, A3+ or A4 sheets, each sheet one vector SVG: the passes edge to
 * edge, with faint cut lines out to the paper's edge. Each pass gets a
 * QR code made by the server. When the print dialog closes (Print button or Ctrl/Cmd+P) the passes
 * are marked printed, with "Didn't print? Undo". The passes may come from several sheets, of one size or of
 * several (the print queue): they share the paper sheets (pagesFor).
 */
export function PrintView({ cards, texts, onMark, onClose }: {
  cards: CardData[];
  texts: PrintTexts;
  /** Marks the passes printed; resolves to an undo function, or an error message. */
  onMark: () => Promise<{ undo: () => Promise<boolean> } | { error: string }>;
  onClose: () => void;
}) {
  const [mark, setMark] = useState<Mark>({ state: 'idle' });
  const markRef = useRef(mark);
  useEffect(() => { markRef.current = mark; });
  const fonts = useCardFonts();

  const types = useMemo(() => [...new Set(cards.map((c) => c.type))], [cards]);
  const paper = usePaper();
  const sheets = useMemo(() => pagesFor(paper, cards.map((c) => TYPE_INFO[c.type].layout)), [paper, cards]);

  // The QR codes: made on the server with the name now in the register, which must be the name printed.
  const client = useTRPCClient();
  const [codes, setCodes] = useState<Codes>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    Promise.all(types.map(async (t) => {
      const list = cards.filter((c) => c.type === t);
      return { t, list, r: await client.passes.codes.mutate({ type: t, serials: list.map((c) => c.serial) }) };
    })).then(
      (sheets) => {
        if (!live) return;
        const byPass = new Map<string, string>();
        for (const { t, list, r } of sheets) {
          const changed = r.find((x, i) => x.name !== list[i].name.trim().toUpperCase());
          if (changed) {
            setCodes({ state: 'error', text: `${TYPE_INFO[t].label} ${fmtSerial(changed.serial)} was just changed on another desk. Close and print again.` });
            return;
          }
          for (const x of r) byPass.set(keyOf({ ...list[0], serial: x.serial }), x.code);
        }
        setCodes({ state: 'ready', byPass });
      },
      (e) => { if (live) setCodes({ state: 'error', text: errorMessage(e) }); },
    );
    return () => { live = false; };
  }, [client, cards, types]);

  const ready = fonts && codes.state === 'ready';

  useEffect(() => {
    document.body.classList.add('printing-passes');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('printing-passes');
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // After the print dialog closes. Marks once; printing a second copy doesn't mark again.
  useEffect(() => {
    if (!ready) return;
    const afterPrint = async () => {
      if (markRef.current.state === 'busy' || markRef.current.state === 'done') return;
      setMark({ state: 'busy' });
      const r = await onMark();
      setMark('error' in r ? { state: 'error', text: r.error } : { state: 'done', undo: r.undo });
    };
    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, [onMark, ready]);

  const undo = async () => {
    if (mark.state !== 'done') return;
    if (await mark.undo()) setMark({ state: 'idle' });
  };

  const { w, h } = PAPER[paper];
  return createPortal(
    <div className="print-root fixed inset-0 z-40 overflow-auto bg-sand-200/95">
      <style>{`@page { size: ${w}mm ${h}mm; margin: 0; } @media print { .sheet-page { height: ${h - 1}mm !important; } }`}</style>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-2.5 print:hidden">
        {types.map((t, i) => (
          <span key={t} className="flex items-center gap-2 font-condensed text-[18px] font-bold">
            {i > 0 && <span className="font-normal text-muted-foreground">+</span>}
            <PassMark type={t} size={16} />
            {TYPE_INFO[t].label}
          </span>
        ))}
        <span className="tabular-nums">{nPasses(cards.length)} on {sheets.length} {PAPER[paper].label} sheet{sheets.length === 1 ? '' : 's'}</span>
        <span role="group" aria-label="Paper" className="inline-flex overflow-hidden rounded-[3px] border border-input">
          {PAPERS.map((p) => (
            <button key={p} aria-pressed={p === paper} onClick={() => setPaper(p)}
              className={`h-8 px-3 text-[14px] font-semibold ${p === paper ? 'bg-foreground text-background' : 'bg-background hover:bg-panel'}`}>
              {PAPER[p].label}
            </button>
          ))}
        </span>
        {codes.state === 'loading' && <span className="text-muted-foreground">Making the QR codes…</span>}
        {codes.state === 'error' && <span className="font-medium text-red-700">No QR codes: {codes.text}</span>}
        {ready && mark.state === 'idle' && (
          <span className="text-xs text-muted-foreground">In the print dialog: {PAPER[paper].dialog}, scale 100% (Actual size), margins None, headers and footers off.</span>
        )}
        {mark.state === 'busy' && <span className="text-muted-foreground">Marking as printed…</span>}
        {mark.state === 'done' && (
          <>
            <span className="font-semibold text-green-800">Marked as printed.</span>
            <button className={btn} onClick={undo}>Didn&apos;t print? Undo</button>
          </>
        )}
        {mark.state === 'error' && <span className="font-medium text-red-700">Not marked as printed: {mark.text}</span>}
        <span className="flex-1" />
        <button className={btnPrimary} disabled={!ready} onClick={() => window.print()}>Print</button>
        <button className={btn} onClick={onClose}>Close</button>
      </div>
      {!ready ? (
        <p className="p-10 text-center text-muted-foreground">
          {codes.state === 'error' ? 'Close this and print again.' : 'Getting the passes ready…'}
        </p>
      ) : (
        <div className="flex flex-col items-center gap-6 py-6 print:block print:p-0">
          {sheets.map((sheet, i) => (
            <svg
              key={i}
              className="sheet-page bg-white shadow-md"
              width={`${w}mm`}
              height={`${h - 1}mm`}
              viewBox={`0 0 ${w} ${h - 1}`}
              xmlns="http://www.w3.org/2000/svg"
            >
              {sheet.items.map(({ i: k, x, y, turn }) => (
                <PassCard
                  key={keyOf(cards[k])}
                  p={cards[k]}
                  texts={texts}
                  code={codes.byPass.get(keyOf(cards[k]))}
                  x={x}
                  y={y}
                  turn={turn}
                  outline={false}
                />
              ))}
              {/* Faint cut lines along every edge, out to the paper's edge to line the cutter up with. */}
              <g stroke="#000" strokeOpacity={0.3} strokeWidth={0.15}>
                {sheet.cuts.map((c) => <line key={`${c.x1} ${c.y1} ${c.x2} ${c.y2}`} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} />)}
              </g>
            </svg>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
