'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActions } from '@/client/actions';
import { usePaper } from '@/client/paper';
import { printQueue, usePrintQueue } from '@/client/printQueue';
import { toast } from '@/client/toast';
import { useTRPC } from '@/client/trpc';
import { nPasses, parseSerial, type Picked, planDelete, planGiven, planPrint, planUnprint, ranges } from '@/lib/passes';
import { pagesFor, PAPER } from '@/lib/sheets';
import { fmtSerial, layoutOf, type Pass, type PassType, TYPE_INFO } from '@/shared/types';
import { useMe } from './AppShell';
import { PrintView } from './PrintView';
import { btn, btnDanger, btnPrimary } from './ui';

const bar = 'flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-4 py-2 print:hidden';
const note = 'text-[13.5px] leading-snug text-muted-foreground';
const Divider = () => <span aria-hidden className="mx-1 h-5 w-px bg-foreground/15" />;

/**
 * The bar above the sheet, for the passes picked (rows selected, or From / To in the panel): print
 * them, mark them printed or unprinted, tick or untick Given, or delete them. Each button says how many passes it changes.
 */
export function RangeBar({ type, sheet, range, onClear }: {
  type: PassType;
  sheet: Pass[];
  range: Picked;
  onClear: () => void;
}) {
  const info = TYPE_INFO[type];
  const { apply, remove, undo } = useActions();
  const hasRange = range.from.trim() !== '';

  /* ----- print ----- */
  const print = useMemo(() => (hasRange ? planPrint(sheet, type, range.from, range.to, range.only) : null), [hasRange, sheet, type, range]);
  const [printing, setPrinting] = useState<NonNullable<typeof print> | null>(null);
  const trpc = useTRPC();
  const settings = useQuery(trpc.settings.get.queryOptions());
  const texts = useMemo(
    () => ({ signature: settings.data?.signature ?? '', tag: settings.data?.tag ?? '' }),
    [settings.data?.signature, settings.data?.tag],
  );
  const paper = usePaper();
  const nCards = print && !print.err ? print.cards.length : 0;
  /** Gate 3 Hospital's Ferry Sewa passes print larger (layoutOf), sharing sheets with the rest. */
  const sheets = useMemo(() => (print && !print.err ? pagesFor(paper, print.cards.map(layoutOf)).length : 0), [print, paper]);

  const onMark = useCallback(async () => {
    if (!printing) return { error: 'Nothing to mark.' };
    const summary = `Printed ${info.label} ${ranges(printing.cards.map((c) => c.serial))}`;
    const r = await apply({ action: 'print', summary, set: printing.set, create: printing.create });
    if (!r) return { error: 'see the message below. Tick Printed in the sheet once it is sorted out.' };
    printQueue.remove(printing.cards); // printed: not waiting in the queue any more
    return { undo: () => undo(r.changeId) };
  }, [apply, undo, printing, info.label]);
  const closePrint = useCallback(() => setPrinting(null), []);
  /** Ticks Printed without printing (printed some other way). Same rules as printing; Undo reverses it. */
  const markPrinted = async () => {
    if (!print || !nCards) return;
    await apply({ action: 'print', summary: `Marked ${info.label} ${ranges(print.cards.map((c) => c.serial))} printed`, set: print.set, create: print.create });
  };

  /* ----- print queue ----- */
  // The picked passes already waiting in the queue, and those ready to print that aren't yet.
  const queue = usePrintQueue();
  const queued = useMemo(() => {
    if (!hasRange) return [];
    const lo = parseSerial(range.from);
    const hi = Number.isNaN(parseSerial(range.to)) ? lo : parseSerial(range.to);
    const only = range.only && new Set(range.only);
    return queue.filter((x) => x.type === type && x.serial >= Math.min(lo, hi) && x.serial <= Math.max(lo, hi) && (!only || only.has(x.serial)));
  }, [queue, hasRange, range, type]);
  const toQueue = useMemo(() => {
    const have = new Set(queued.map((x) => x.serial));
    return nCards && print ? print.cards.filter((c) => !have.has(c.serial)) : [];
  }, [queued, nCards, print]);
  /** Keeps them for the print queue (top right), to print with passes of the same size from other sheets. */
  const addToQueue = useCallback(() => {
    const added = printQueue.add(toQueue.map((c) => ({ type: c.type, serial: c.serial })));
    if (added) toast(`Added ${nPasses(added)} to the print queue (top right): ${printQueue.get().length} waiting. Alt+Q again takes them out.`);
  }, [toQueue]);
  const removeFromQueue = useCallback(() => {
    printQueue.remove(queued);
    toast(`Took ${nPasses(queued.length)} out of the print queue: ${printQueue.get().length} waiting.`);
  }, [queued]);
  // Alt+Q (Option+Q on a Mac): adds the picked passes to the queue, or takes them out if they're all in it already.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyQ') return;
      e.preventDefault();
      if (toQueue.length) addToQueue();
      else if (queued.length) removeFromQueue();
      else if (hasRange) toast('Nothing to add to the print queue: none of these is filled in and unprinted.', 'error');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toQueue, queued, hasRange, addToQueue, removeFromQueue]);

  /** Unticks Printed (to print them again), like unticking it in the sheet; Undo reverses it. */
  const unprint = useMemo(() => (hasRange ? planUnprint(sheet, range.from, range.to, range.only) : null), [hasRange, sheet, range]);
  const markUnprinted = async () => {
    if (!unprint?.set.length) return;
    await apply({ action: 'print', summary: `Marked ${info.label} ${ranges(unprint.serials)} unprinted`, set: unprint.set });
  };

  /* ----- given ----- */
  const given = useMemo(() => (hasRange ? planGiven(sheet, range.from, range.to, range.only) : null), [hasRange, sheet, range]);
  const setGiven = async (tick: boolean) => {
    const set = tick ? given?.tick : given?.untick;
    if (!given || !set?.length) return;
    const serials = tick ? given.tickSerials : given.untickSerials;
    await apply({ action: 'given', summary: `${tick ? 'Ticked' : 'Unticked'} Given · ${info.label} ${ranges(serials)}`, set });
  };

  /* ----- delete ----- */
  const del = useMemo(() => (hasRange ? planDelete(sheet, range.from, range.to, range.only) : null), [hasRange, sheet, range]);
  const rangeKey = `${type}:${range.from}–${range.to}:${range.only?.join() ?? ''}`;
  const [confirming, setConfirming] = useState(''); // the range whose Delete is being confirmed
  const doDelete = async () => {
    if (!del?.items.length) return;
    setConfirming('');
    await remove({ summary: `Deleted ${info.label} ${ranges(del.serials)}`, items: del.items });
  };

  const printView = printing && <PrintView cards={printing.cards} texts={texts} onMark={onMark} onClose={closePrint} />;

  if (confirming === rangeKey && del?.items.length) {
    return (
      <div role="alertdialog" aria-label="Confirm delete" className={`${bar} border-destructive/25 bg-red-50 text-[14px]`}>
        <p className="leading-snug">
          Delete <b>{nPasses(del.items.length)}</b> ({ranges(del.serials)}) from the register?
          {del.printed.length > 0 && <> {del.printed.length} printed stay.</>} <b>Undo</b> brings them back.
        </p>
        <span className="flex-1" />
        <button className={btn} onClick={() => setConfirming('')}>Cancel</button>
        <button className={`${btnDanger} !border-destructive !bg-destructive !text-white`} onClick={() => void doDelete()}>Delete {nPasses(del.items.length)}</button>
      </div>
    );
  }

  const lo = parseSerial(range.from);
  const hiRaw = parseSerial(range.to);
  const hi = Number.isNaN(hiRaw) ? lo : hiRaw;
  const rangeErr = given?.err ?? '';
  const missing = [!texts.signature && 'signature', !texts.tag && 'tag'].filter(Boolean);

  return (
    <div className={`${bar} ${hasRange ? 'border-sand-200 bg-sand-100/80' : 'border-rule bg-background'}`}>
      {hasRange ? (
        <>
          <span className="flex items-baseline gap-2">
            <b className="max-w-[22rem] truncate font-condensed text-[17px] font-bold tabular-nums" title={range.only ? ranges([...range.only]) : undefined}>
              {range.only ? ranges([...range.only]) : Number.isNaN(lo) ? range.from : lo === hi ? fmtSerial(lo) : `${fmtSerial(Math.min(lo, hi))}–${fmtSerial(Math.max(lo, hi))}`}
            </b>
            {!rangeErr && <span className="text-[13.5px] text-sand-900">{nPasses(range.only ? range.only.length : Math.abs(hi - lo) + 1)}{range.only ? ' shown' : ''}</span>}
          </span>
          <button className="text-[13.5px] font-semibold text-primary hover:underline" onClick={onClear} title="Clear the selection">Clear</button>
        </>
      ) : (
        <span className={note} title="Click a Sr. No., then Shift+click or drag. Or enter From and To on the right.">No passes selected</span>
      )}
      {rangeErr ? <p className="ml-2 text-[13.5px] text-destructive">{rangeErr}</p> : (
        <>
          <Divider />
          {print?.err ? <p className="text-[13.5px] text-destructive">{print.err}</p> : (
            <>
              <button
                className={btnPrimary} disabled={!nCards} onClick={() => print && setPrinting(print)}
                title={nCards
                  ? `${nPasses(nCards)} on ${sheets} ${PAPER[paper].label} sheet${sheets === 1 ? '' : 's'}${print?.create.length ? `, ${print.create.length} blank` : ''}${print?.printed.length ? `. Skips ${print.printed.length} already printed (${ranges(print.printed)}).` : ''}`
                  : print?.unfilled.length ? 'Nothing to print: none of these is filled in and unprinted' : 'All of these are printed already'}
              >
                Preview &amp; print
              </button>
              {/* Add to the queue, or take out once they're all in it (Alt+Q either way). Away from Mark printed (the owner, 2026-11-23). */}
              {toQueue.length || !queued.length ? (
                <button
                  className={btn} disabled={!toQueue.length} onClick={addToQueue}
                  title="Keep them in the print queue (top right), to print with passes from other sheets on the same paper sheets. Shortcut: Alt+Q (Option+Q on a Mac)."
                >
                  {toQueue.length ? `Add ${toQueue.length} to queue` : 'Add to queue'}
                  <kbd className="ml-1.5 font-sans text-[11.5px] font-normal text-muted-foreground">⌥Q</kbd>
                </button>
              ) : (
                <button className={btn} onClick={removeFromQueue} title="Take them out of the print queue. Shortcut: Alt+Q (Option+Q on a Mac).">
                  Remove {queued.length} from queue
                  <kbd className="ml-1.5 font-sans text-[11.5px] font-normal text-muted-foreground">⌥Q</kbd>
                </button>
              )}
              {toQueue.length > 0 && queued.length > 0 && (
                <button className="text-[13.5px] text-primary hover:underline" onClick={removeFromQueue} title={`Take the ${queued.length} already queued out of the print queue`}>
                  {queued.length} queued: remove
                </button>
              )}
              {print && !nCards && !print.unfilled.length && print.printed.length > 0 && (
                <span className={note} title="Mark them unprinted to print them again.">all printed</span>
              )}
              {print && print.unfilled.length > 0 && (
                <span className="text-[13.5px] leading-snug text-amber-800" title={`Not printed until every detail is filled in (Incharge and Issued To don't count): ${ranges(print.unfilled)}`}>
                  {print.unfilled.length === 1 ? `${fmtSerial(print.unfilled[0])} isn't` : `${print.unfilled.length} aren't`} filled in: left out
                </span>
              )}
              {nCards > 0 && !settings.isLoading && missing.length > 0 && <MissingSetup missing={missing as string[]} />}
            </>
          )}
          <Divider />
          {!print?.err && (
            <button className={btn} disabled={!nCards} onClick={() => void markPrinted()} title="Tick Printed without printing (printed some other way). Undo reverses it.">
              {nCards ? `Mark ${nCards} printed` : 'Mark printed'}
            </button>
          )}
          <button
            className={btn} disabled={!unprint?.set.length} onClick={() => void markUnprinted()}
            title={unprint?.set.length ? `Untick Printed for ${ranges(unprint.serials)}, to change or print them again. Undo reverses it.` : 'None of these are printed'}
          >
            {unprint?.set.length ? `Mark ${unprint.set.length} unprinted` : 'Mark unprinted'}
          </button>
          <Divider />
          <button
            className={btn} disabled={!given?.tick.length} onClick={() => void setGiven(true)}
            title={given?.notPrinted.length ? `Tick Given: handed over. Skips ${given.notPrinted.length} not printed yet (${ranges(given.notPrinted)}): print first.` : 'Tick Given: these passes are handed over'}
          >
            {given?.tick.length ? `Mark ${given.tick.length} given` : 'Mark given'}
          </button>
          <button className={btn} disabled={!given?.untick.length} onClick={() => void setGiven(false)} title="Untick Given for these passes">
            {given?.untick.length ? `Untick ${given.untick.length} given` : 'Untick given'}
          </button>
          {given && !given.tick.length && given.notPrinted.length > 0 && (
            <span className={note} title={`Not printed yet: ${ranges(given.notPrinted)}`}>print first</span>
          )}
          <span className="flex-1" />
          <button
            className={btnDanger} disabled={!del?.items.length} onClick={() => setConfirming(rangeKey)}
            title={del?.printed.length ? `Printed passes aren't deleted (${ranges(del.printed)}): mark them unprinted first.` : 'Remove these passes from the register. Undo brings them back.'}
          >
            {del?.items.length ? `Delete ${nPasses(del.items.length)}…` : 'Delete'}
          </button>
        </>
      )}
      {printView}
    </div>
  );
}

/** Passes print with the signature and tag from Settings; says which is missing. */
function MissingSetup({ missing }: { missing: string[] }) {
  const me = useMe();
  const what = `No ${missing.join(' or ')}`;
  const why = `Passes print without the ${missing.join(' or ')} until it's set in Settings${me.is_admin ? '' : ' (ask an admin)'}.`;
  const chip = 'rounded-[3px] border border-sand-200 bg-background px-2 py-0.5 text-[13px] text-sand-900';
  return me.is_admin
    ? <Link href="/settings" className={`${chip} hover:underline`} title={why}>{what}</Link>
    : <span className={chip} title={why}>{what}</span>;
}
