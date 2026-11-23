'use client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActions } from '@/client/actions';
import { setPaper, usePaper } from '@/client/paper';
import { printQueue, type QueueItem, usePrintQueue } from '@/client/printQueue';
import { useAllPasses } from '@/client/store';
import { useTRPC } from '@/client/trpc';
import { type CardData, cardsLabel, nPasses, planQueue, type PrintPlan, ranges, readyToPrint } from '@/lib/passes';
import { CARD_SIZE, pagesFor, PAPER, PAPERS, roomFor, sheetPlan } from '@/lib/sheets';
import { type Layout, layoutOf, type Pass, type PassType, SHEETS, TYPE_INFO } from '@/shared/types';
import { PassMark } from './AppShell';
import { PrintView } from './PrintView';
import { btn, btnPrimary, card } from './ui';

/** In the header while the print queue has passes: how many, and opens it. */
export function PrintQueueButton() {
  const items = usePrintQueue();
  const [open, setOpen] = useState(false);
  if (!items.length && !open) return null;
  return (
    <>
      <button
        className="rounded-[3px] bg-white/15 px-2.5 py-1 text-[14px] font-semibold text-white hover:bg-white/25" onClick={() => setOpen(true)}
        title="Passes waiting to print, from any sheets. Printed together, passes of every size share the paper sheets."
      >
        Print queue <span className="font-condensed tabular-nums">· {items.length}</span>
      </button>
      {open && <PrintQueue onClose={() => setOpen(false)} />}
    </>
  );
}

const same = (a: QueueItem, b: QueueItem) => a.type === b.type && a.serial === b.serial;
const keyOf = (x: QueueItem) => `${x.type}:${x.serial}`;
const area = (l: Layout) => CARD_SIZE[l].w * CARD_SIZE[l].h;
/** The pass sizes, in the order of the sheets. */
const SIZES = [...new Set(SHEETS.map((t) => TYPE_INFO[t].layout))];
/** Gate 3 Hospital's Ferry Sewa passes are a size of their own (layoutOf). */
const FERRY_SIZE = layoutOf({ type: 'gate3-hospital', meta: { ferry: true } });
/** A size by the sheets that have it: Mobile, Bike, Sewa Vehicle / Ferry Sewa, … */
const sizeName = (l: Layout) => (l === 'mobile' ? 'Mobile' : l === 'bike' ? 'Bike'
  : [...SHEETS.filter((t) => TYPE_INFO[t].layout === l).map((t) => TYPE_INFO[t].label), ...(l === FERRY_SIZE ? ['Ferry Sewa'] : [])].join(' / '));
/** A sheet's passes of one size: Gate 3 Hospital, or Gate 3 Hospital (Ferry Sewa). */
const kindName = (t: PassType, l: Layout) => TYPE_INFO[t].label + (l === TYPE_INFO[t].layout ? '' : ' (Ferry Sewa)');

/**
 * The print queue (printQueue.ts), in groups of passes of one size: each group can print on its own paper
 * sheets, Mobile Pandal and Non Pandal together, …; "Print full sheets" leaves the rest waiting for more.
 * With several sizes, "Print all together" prints everything at once, the sizes sharing sheets (pagesFor).
 * Each pass is checked again here: one printed meanwhile, or no longer filled in, is left out.
 */
function PrintQueue({ onClose }: { onClose: () => void }) {
  const items = usePrintQueue();
  const all = useAllPasses();
  const paper = usePaper();
  const { apply, undo } = useActions();
  const trpc = useTRPC();
  const settings = useQuery(trpc.settings.get.queryOptions());
  const texts = useMemo(
    () => ({ signature: settings.data?.signature ?? '', tag: settings.data?.tag ?? '' }),
    [settings.data?.signature, settings.data?.tag],
  );

  const sheetOf = useMemo(() => {
    const by = new Map<PassType, Pass[]>();
    for (const p of all) by.set(p.type, [...(by.get(p.type) ?? []), p]);
    return (t: PassType) => by.get(t) ?? [];
  }, [all]);
  /** A queued pass's size, by its row in the register (layoutOf). */
  const sizeOf = useMemo(() => {
    const by = new Map(all.map((p) => [keyOf(p), layoutOf(p)]));
    return (x: QueueItem) => by.get(keyOf(x)) ?? TYPE_INFO[x.type].layout;
  }, [all]);
  const groups = useMemo(() => {
    const layouts = [...new Set(SHEETS.flatMap((t) => items.filter((x) => x.type === t).map(sizeOf)))];
    return layouts.map((layout) => {
      const mine = items.filter((x) => sizeOf(x) === layout);
      const plan = planQueue(mine, sheetOf);
      return { layout, mine, plan, perSheet: sheetPlan(paper, layout).perSheet, leftOut: mine.filter((x) => !plan.cards.some((c) => same(c, x))) };
    });
  }, [items, sheetOf, paper, sizeOf]);

  // Every size at once: each size's full sheets as usual, what's left sharing sheets.
  const together = useMemo(() => {
    if (groups.length < 2) return null;
    const plan = planQueue(items, sheetOf);
    const sheets = pagesFor(paper, plan.cards.map(layoutOf)).length;
    const apart = groups.reduce((n, g) => n + Math.ceil(g.plan.cards.length / g.perSheet), 0);
    return { plan, sheets, apart };
  }, [groups, items, sheetOf, paper]);

  /**
   * Everything printed at once (Print all together, or Print all with one size): how full its last sheet is, the
   * passes ready to print elsewhere in the register that would fit on it without another sheet (the owner,
   * 2026-11-23: "suggest what else I can add to fill the empty gap"), and, with several sizes, whether leaving
   * that sheet's passes for next time saves a sheet.
   */
  const last = useMemo(() => {
    const plan = planQueue(items, sheetOf);
    if (!plan.cards.length || plan.err) return null;
    const layouts = plan.cards.map(layoutOf);
    const pages = pagesFor(paper, layouts);
    const end = pages[pages.length - 1];
    const used = end.items.reduce((a, it) => a + area(layouts[it.i]), 0) / (PAPER[paper].w * PAPER[paper].h);
    const queued = new Set(items.map(keyOf));
    /** How many more of each size fit on it, ready to print or not (the owner, 2026-11-23: "we can fit a mobile pass here"). */
    const room = new Map(SIZES.map((l) => [l, roomFor(paper, layouts, l)]));
    const offers = SHEETS.flatMap((t) => {
      const ready = readyToPrint(sheetOf(t), t).filter((p) => !queued.has(keyOf(p)));
      return SIZES.flatMap((l) => {
        const these = ready.filter((p) => layoutOf(p) === l);
        const n = Math.min(room.get(l)!, these.length);
        return n ? [{ type: t, layout: l, add: these.slice(0, n).map((p) => ({ type: t, serial: p.serial })), ready: these.length }] : [];
      });
    });
    const onEnd = new Set(end.items.map((it) => it.i));
    const keep = plan.cards.filter((_, i) => !onEnd.has(i));
    const leave = plan.cards.filter((_, i) => onEnd.has(i));
    const wait = groups.length > 1 && pages.length > 1 && used < 0.5
      && pagesFor(paper, keep.map(layoutOf)).length < pages.length ? { keep, leave } : null;
    const space = SIZES.filter((l) => room.get(l)! > 0).map((l) => `${room.get(l)} ${sizeName(l)}`);
    return { sheets: pages.length, used, n: end.items.length, offers, wait, space };
  }, [items, sheetOf, paper, groups.length]);

  const [printing, setPrinting] = useState<PrintPlan | null>(null);
  const print = (cards: CardData[]) => setPrinting(planQueue(cards, sheetOf));
  const onMark = useCallback(async () => {
    if (!printing) return { error: 'Nothing to mark.' };
    const r = await apply({ action: 'print', summary: `Printed ${cardsLabel(printing.cards)}`, set: printing.set, create: printing.create });
    if (!r) return { error: 'see the message below. Tick Printed in the sheets once it is sorted out.' };
    printQueue.remove(printing.cards);
    return {
      undo: async () => {
        const ok = await undo(r.changeId);
        if (ok) printQueue.add(printing.cards); // didn't print: back in the queue
        return ok;
      },
    };
  }, [apply, undo, printing]);
  const closePrint = useCallback(() => setPrinting(null), []);

  useEffect(() => {
    if (printing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, printing]);

  if (printing) return <PrintView cards={printing.cards} texts={texts} onMark={onMark} onClose={closePrint} />;

  const sheetName = `${PAPER[paper].label} sheet`;
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4 text-foreground" onClick={onClose}>
      <div role="dialog" aria-label="Print queue" className={`${card} max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto p-5 shadow-[0_12px_40px_rgb(35_31_32/0.25)]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <h2 className="font-condensed text-[19px] font-bold">Print queue</h2>
          <span className="flex-1" />
          <span role="group" aria-label="Paper" className="inline-flex overflow-hidden rounded-[3px] border border-input">
            {PAPERS.map((p) => (
              <button key={p} aria-pressed={p === paper} onClick={() => setPaper(p)}
                className={`h-8 px-3 text-[14px] font-semibold ${p === paper ? 'bg-foreground text-background' : 'bg-background hover:bg-panel'}`}>
                {PAPER[p].label}
              </button>
            ))}
          </span>
        </div>
        {!items.length && <p className="text-muted-foreground">Nothing waiting. Pick passes in a sheet and press <b>Add to queue</b>.</p>}
        {groups.map(({ layout, mine, plan, perSheet, leftOut }) => {
          const n = plan.cards.length;
          const full = Math.floor(n / perSheet);
          return (
            <section key={layout} className="space-y-2 border-t border-border pt-3 text-[14px]">
              <ul className="space-y-1">
                {SHEETS.filter((t) => mine.some((x) => x.type === t)).map((t) => {
                  const these = mine.filter((x) => x.type === t);
                  return (
                    <li key={t} className="flex items-baseline gap-2">
                      <PassMark type={t} />
                      <b className="font-semibold">{kindName(t, layout)}</b>
                      <span className="min-w-0 flex-1 text-muted-foreground tabular-nums">{ranges(these.map((x) => x.serial))} ({these.length})</span>
                      <button className="text-[13px] text-primary hover:underline" onClick={() => printQueue.remove(these)}>Remove</button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-muted-foreground">
                {perSheet} to an {sheetName}:{' '}
                {full
                  ? <><b className="text-foreground">{full} full sheet{full === 1 ? '' : 's'}</b> ready{n > full * perSheet ? `, ${n - full * perSheet} waiting for more` : ''}.</>
                  : <>{n} of {perSheet} for the first sheet.</>}
              </p>
              {leftOut.length > 0 && (
                <p className="rounded-[3px] bg-amber-50 px-2 py-1 text-[13.5px] text-amber-950">
                  {nPasses(leftOut.length)} left out: printed meanwhile, or not filled in any more.{' '}
                  <button className="font-semibold text-primary hover:underline" onClick={() => printQueue.remove(leftOut)}>Remove {leftOut.length === 1 ? 'it' : 'them'}</button>
                </p>
              )}
              {plan.err && <p className="text-[13.5px] text-destructive">{plan.err}</p>}
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={!full || !!plan.err} onClick={() => print(plan.cards.slice(0, full * perSheet))}>
                  {full ? `Print ${full} full sheet${full === 1 ? '' : 's'} (${full * perSheet})` : 'Print full sheets'}
                </button>
                <button className={btn} disabled={!n || !!plan.err} onClick={() => print(plan.cards)}>Print all {n}</button>
              </div>
            </section>
          );
        })}
        {together && (
          <section className="space-y-2 border-t border-border pt-3 text-[14px]">
            <p className="text-muted-foreground">
              All sizes together: <b className="text-foreground">{nPasses(together.plan.cards.length)} on {together.sheets} {sheetName}{together.sheets === 1 ? '' : 's'}</b>
              {together.sheets < together.apart ? ` (${together.apart} printed size by size)` : ''}. The big passes first, the small ones in the
              space left beside them.
            </p>
            {together.plan.err && <p className="text-[13.5px] text-destructive">{together.plan.err}</p>}
            <button className={btnPrimary} disabled={!together.plan.cards.length || !!together.plan.err} onClick={() => print(together.plan.cards)}>
              Print all {together.plan.cards.length} together
            </button>
          </section>
        )}
        {last && (
          <section className="space-y-2 border-t border-border pt-3 text-[14px]">
            <p className="text-muted-foreground">
              {groups.length > 1 ? 'Printed all together' : `Printed all ${together?.plan.cards.length ?? groups[0].plan.cards.length}`}, the last {sheetName} is{' '}
              <b className="text-foreground">{Math.round(last.used * 100)}% used</b> ({nPasses(last.n)}).
              {last.space.length === 0 ? ' No other pass fits on it.' : <> Room on it for <b className="text-foreground">{last.space.join(' or ')}</b> more.</>}
              {last.space.length > 0 && (last.offers.length > 0
                ? ' Fill it with passes ready to print (filled in, not printed):'
                : ' None of those are ready to print (filled in, not printed, not in the queue).')}
            </p>
            {last.offers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {last.offers.map((o) => (
                  <button key={`${o.type}:${o.layout}`} className={`${btn} !h-auto gap-1.5 !px-2.5 !py-1 text-[13.5px]`} onClick={() => printQueue.add(o.add)}
                    title={`${kindName(o.type, o.layout)}: ${o.ready} ready to print, the lowest serials first. One size fills the space: adding one changes what the others can add.`}>
                    <PassMark type={o.type} />
                    + {o.add.length} {kindName(o.type, o.layout)}
                    <span className="font-normal text-muted-foreground tabular-nums">{ranges(o.add.map((x) => x.serial))}</span>
                  </button>
                ))}
              </div>
            )}
            {last.wait && (
              <p className="rounded-[3px] bg-sand-100 px-2 py-1.5 text-sand-900">
                Or leave its {nPasses(last.wait.leave.length)} ({cardsLabel(last.wait.leave)}) in the queue for next time:{' '}
                <button className="font-semibold text-primary hover:underline" onClick={() => print(last.wait!.keep)}>
                  print {nPasses(last.wait.keep.length)} on {last.sheets - 1} {sheetName}{last.sheets - 1 === 1 ? '' : 's'}
                </button>
              </p>
            )}
          </section>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          {items.length > 0 && <button className={btn} onClick={() => printQueue.remove(items)}>Empty the queue</button>}
          <button className={btn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
