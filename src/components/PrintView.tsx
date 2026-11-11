'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setPaper, usePaper } from '@/client/paper';
import { errorMessage, useTRPCClient } from '@/client/trpc';
import { type CardData, nPasses } from '@/lib/passes';
import { PAPER, PAPERS, sheetPlan } from '@/lib/sheets';
import { fmtSerial, TYPE_INFO } from '@/shared/types';
import { PassMark } from './AppShell';
import { PassCard, type PrintTexts, useCardFonts } from './cards/PassCard';
import type { PassCode } from './cards/Qr';
import { btn, btnPrimary } from './ui';

type Mark = { state: 'idle' } | { state: 'busy' } | { state: 'done'; undo: () => Promise<boolean> } | { state: 'error'; text: string };
type Codes = { state: 'loading' } | { state: 'ready'; bySerial: Map<number, PassCode> } | { state: 'error'; text: string };

/** The address the QR codes open. `local`: only this computer can open it, so phones couldn't. */
export function checkAddress(texts: PrintTexts): { base: string; local: boolean } {
  const base = (texts.checkUrl || window.location.origin).replace(/\/+$/, '');
  return { base, local: /^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(base) };
}

/**
 * Full-screen preview of the passes on A3+ or A4 sheets, each sheet one vector SVG. Each pass gets a
 * QR code made by the server. When the print dialog closes (Print button or Ctrl/Cmd+P) the passes
 * are marked printed, with "Didn't print? Undo".
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

  const type = cards[0]?.type ?? 'mobile-pandal';
  const paper = usePaper();
  const plan = useMemo(() => sheetPlan(paper, TYPE_INFO[type].layout), [paper, type]);
  const sheets = useMemo(() => {
    const out: CardData[][] = [];
    for (let i = 0; i < cards.length; i += plan.perSheet) out.push(cards.slice(i, i + plan.perSheet));
    return out;
  }, [cards, plan.perSheet]);

  // The QR codes: made on the server with the name now in the register, which must be the name printed.
  const client = useTRPCClient();
  const { base, local } = checkAddress(texts);
  const [codes, setCodes] = useState<Codes>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    client.passes.codes.mutate({ type, serials: cards.map((c) => c.serial) }).then(
      (r) => {
        if (!live) return;
        const changed = r.find((x, i) => x.name !== cards[i].name.trim().toUpperCase());
        setCodes(changed
          ? { state: 'error', text: `Pass ${fmtSerial(changed.serial)} was just changed on another desk. Close and print again.` }
          : { state: 'ready', bySerial: new Map(r.map((x) => [x.serial, { prefix: `${base}/v#`, digits: x.code }])) });
      },
      (e) => { if (live) setCodes({ state: 'error', text: errorMessage(e) }); },
    );
    return () => { live = false; };
  }, [client, cards, type, base]);

  const ready = fonts && codes.state === 'ready';
  const printable = ready && !local;

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
    if (!printable) return;
    const afterPrint = async () => {
      if (markRef.current.state === 'busy' || markRef.current.state === 'done') return;
      setMark({ state: 'busy' });
      const r = await onMark();
      setMark('error' in r ? { state: 'error', text: r.error } : { state: 'done', undo: r.undo });
    };
    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, [onMark, printable]);

  const undo = async () => {
    if (mark.state !== 'done') return;
    if (await mark.undo()) setMark({ state: 'idle' });
  };

  const { w, h } = plan.paper;
  return createPortal(
    <div className="print-root fixed inset-0 z-40 overflow-auto bg-sand-200/95">
      <style>{`@page { size: ${w}mm ${h}mm; margin: 0; } @media print { .sheet-page { height: ${h - 1}mm !important; } }`}</style>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-2.5 print:hidden">
        <span className="flex items-center gap-2 font-condensed text-[18px] font-bold">
          <PassMark type={type} size={16} />
          {TYPE_INFO[type].label}
        </span>
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
        {ready && local && (
          <span className="max-w-[46rem] font-medium text-red-700">
            The QR codes would open {base}, which phones can&apos;t reach. Open this app by its network address
            (like http://192.168.1.20:5180), or an admin can set the pass check address in Settings.
          </span>
        )}
        {printable && mark.state === 'idle' && (
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
        <button className={btnPrimary} disabled={!printable} onClick={() => window.print()}>Print</button>
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
              {sheet.map((c, j) => (
                <PassCard
                  key={`${c.type}-${c.serial}`}
                  p={c}
                  texts={texts}
                  code={codes.bySerial.get(c.serial)}
                  x={plan.slots[j].x}
                  y={plan.slots[j].y}
                  turn={plan.turn}
                />
              ))}
            </svg>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
