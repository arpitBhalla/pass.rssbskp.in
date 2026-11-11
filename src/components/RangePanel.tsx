'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useActions } from '@/client/actions';
import { usePaper } from '@/client/paper';
import { useTRPC } from '@/client/trpc';
import { cleanFill, nPasses, parseSerial, planFill, planPrint, ranges } from '@/lib/passes';
import { PAPER, sheetPlan } from '@/lib/sheets';
import { type Field, FIELD_LABELS, fieldsFor, type Layout, type Pass, type PassType, TYPE_INFO, type Values } from '@/shared/types';
import { useMe } from './AppShell';
import type { PrintTexts } from './cards/PassCard';
import { PrintView } from './PrintView';
import { btn, btnPrimary, heading, input, label } from './ui';

const SUGGEST: Partial<Record<Field, string>> = { incharge: 'dl-incharge', area: 'dl-area', dept: 'dl-dept' };
/** Give box order: Area first, then who it's given to. */
const GIVE_ORDER: Field[] = ['area', 'incharge', 'dept', 'name', 'phone', 'vehicle', 'vehicle_no'];
/** A Give needs one of these: the incharge, or the holder's Name / Dept / Phone. */
const WHO: Field[] = ['incharge', 'name', 'dept', 'phone'];

/**
 * Side panel: pick a range of serials (or select rows in the sheet), then Give them to someone
 * or Print them. Both show exactly what will happen before anything is saved.
 */
export function RangePanel({ type, sheet, range, setRange }: {
  type: PassType;
  sheet: Pass[];
  range: { from: string; to: string };
  setRange: (r: { from: string; to: string }) => void;
}) {
  const info = TYPE_INFO[type];
  const { apply, undo } = useActions();

  /* ----- give ----- */
  const fields = GIVE_ORDER.filter((k) => fieldsFor(type).includes(k));
  const [values, setValues] = useState<Values>({});
  const fill = useMemo(() => cleanFill(type, values), [type, values]);
  const hasRange = range.from.trim() !== '';
  const give = useMemo(() => (hasRange ? planFill(sheet, type, range.from, range.to, fill) : null), [hasRange, sheet, type, range, fill]);
  const giveCount = give ? give.serials.length : 0;
  const hasWho = WHO.some((k) => fill[k]);

  const doGive = async () => {
    if (!give || !giveCount || !hasWho) return;
    const who = fill.incharge || fill.name || fill.dept || fill.phone;
    const summary = `Gave ${info.label} ${ranges(give.serials)} to ${who}`;
    const r = await apply({ action: 'give', summary, set: give.set, create: give.create });
    if (r) setValues({});
  };

  /* ----- print ----- */
  const print = useMemo(() => (hasRange ? planPrint(sheet, type, range.from, range.to) : null), [hasRange, sheet, type, range]);
  const [printing, setPrinting] = useState<NonNullable<typeof print> | null>(null);
  const trpc = useTRPC();
  const sig = useQuery(trpc.settings.get.queryOptions());
  const signature = sig.data?.signature ?? '';
  const texts = useMemo(
    () => ({ signature, validFor: sig.data?.validFor ?? '', tag: sig.data?.tag ?? '', checkUrl: sig.data?.checkUrl ?? '' }),
    [signature, sig.data?.validFor, sig.data?.tag, sig.data?.checkUrl],
  );
  const layout = info.layout;
  const paper = usePaper();
  const sheets = print ? Math.ceil(print.cards.length / sheetPlan(paper, layout).perSheet) : 0;

  const onMark = useCallback(async () => {
    if (!printing) return { error: 'Nothing to mark.' };
    const summary = `Printed ${info.label} ${ranges(printing.cards.map((c) => c.serial))}`;
    const r = await apply({ action: 'print', summary, set: printing.set, create: printing.create });
    if (!r) return { error: 'see the message below. Tick Printed in the sheet once it is sorted out.' };
    return { undo: () => undo(r.changeId) };
  }, [apply, undo, printing, info.label]);
  const closePrint = useCallback(() => setPrinting(null), [setPrinting]);
  /** Ticks Printed on the range without printing (printed elsewhere). Same rules as printing; Undo reverses it. */
  const markPrinted = async () => {
    if (!print || print.err || !print.cards.length) return;
    const summary = `Marked ${info.label} ${ranges(print.cards.map((c) => c.serial))} printed`;
    await apply({ action: 'print', summary, set: print.set, create: print.create });
  };

  const from = parseSerial(range.from);
  const to = Number.isNaN(parseSerial(range.to)) ? from : parseSerial(range.to);
  const span = Number.isNaN(from) ? 0 : Math.abs(to - from) + 1;

  return (
    <aside className="w-[310px] shrink-0 space-y-4 overflow-y-auto border-l border-border bg-panel px-4 py-3 print:hidden">
      <section className="space-y-2">
        <h2 className={heading}>Passes</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>From<input className={`${input} font-condensed !text-[16px] tabular-nums`} inputMode="numeric" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} placeholder="0001" /></label>
          <label className={label}>To<input className={`${input} font-condensed !text-[16px] tabular-nums`} inputMode="numeric" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} placeholder="0050" /></label>
        </div>
        <p className="text-[13.5px] leading-snug text-muted-foreground">
          {span ? <b className="font-semibold text-foreground">{nPasses(span)}. </b> : ''}Or select rows in the sheet: click a Sr. No., then Shift+click or drag.
        </p>
      </section>

      <section className="space-y-2.5 border-t border-border pt-3">
        <h2 className={heading}>Give</h2>
        {fields.map((k) => (
          <label key={k} className={label}>
            {FIELD_LABELS[k]}
            <input className={input} list={SUGGEST[k]} value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
          </label>
        ))}
        {give?.err && <p className="text-[13.5px] text-destructive">{give.err}</p>}
        {give && !give.err && !hasWho && (
          <p className="text-[13.5px] leading-snug text-muted-foreground">Fill Incharge, or at least one of Name, Dept and Phone.</p>
        )}
        {give && !give.err && hasWho && (
          <div className="space-y-1 text-[13.5px] leading-snug text-muted-foreground">
            {giveCount > 0 && (
              <p>
                Gives <b className="text-foreground">{nPasses(giveCount)}</b> ({ranges(give.serials)})
                {give.create.length > 0 && <>, {give.create.length} new to the register</>}
              </p>
            )}
            {give.same > 0 && <p>{nPasses(give.same)} already like this.</p>}
            {give.skipped.length > 0 && (
              <p className="rounded-[3px] bg-sand-100 px-2 py-1 text-sand-900">
                Left alone (never overwritten): {give.skipped.slice(0, 6).map((s) => `${String(s.serial).padStart(4, '0')} (${s.why})`).join(', ')}
                {give.skipped.length > 6 && ` and ${give.skipped.length - 6} more`}
              </p>
            )}
          </div>
        )}
        <button className={`${btnPrimary} w-full`} disabled={!giveCount || !hasWho} onClick={() => void doGive()}>
          {!hasRange ? 'Enter a range' : !hasWho ? 'Give' : !giveCount ? 'Nothing to change' : `Give ${nPasses(giveCount)}`}
        </button>
      </section>

      <section className="space-y-2.5 border-t border-border pt-3">
        <h2 className={heading}>Print</h2>
        {print?.err && <p className="text-[13.5px] text-destructive">{print.err}</p>}
        {print && !print.err && (
          <div className="space-y-1 text-[13.5px] leading-snug text-muted-foreground">
            <p>
              <b className="text-foreground">{nPasses(print.cards.length)}</b> to print ({sheets} {PAPER[paper].label} sheet{sheets === 1 ? '' : 's'})
              {print.create.length > 0 && <>, {print.create.length} blank (not given yet)</>}
            </p>
            {print.printed.length > 0 && <p>Skipping {print.printed.length} already printed ({ranges(print.printed)}). Untick Printed in the sheet to print again.</p>}
          </div>
        )}
        <PrintSetup layout={layout} texts={texts} loading={sig.isLoading} />
        <div className="flex gap-2">
          <button className={`${btnPrimary} flex-1`} disabled={!print || !!print.err || !print.cards.length} onClick={() => print && setPrinting(print)}>
            Preview &amp; print
          </button>
          <button
            className={btn} disabled={!print || !!print.err || !print.cards.length} onClick={() => void markPrinted()}
            title="Tick Printed for these passes without printing (printed some other way). Undo reverses it."
          >
            {print && !print.err && print.cards.length ? `Mark ${print.cards.length} printed` : 'Mark printed'}
          </button>
        </div>
      </section>

      {printing && <PrintView cards={printing.cards} texts={texts} onMark={onMark} onClose={closePrint} />}
    </aside>
  );
}

/** What the passes print with (set once in Settings), and what's missing. */
function PrintSetup({ layout, texts, loading }: { layout: Layout; texts: PrintTexts; loading: boolean }) {
  const me = useMe();
  if (loading) return null;
  const missing = [
    !texts.signature && 'signature',
    layout === 'bike' && !texts.validFor && 'Valid For',
    layout === 'vehicle' && !texts.tag && 'tag',
  ].filter(Boolean) as string[];
  const where = me.is_admin ? <Link href="/settings" className="font-semibold text-primary hover:underline">Settings</Link> : 'Settings (ask an admin)';
  return (
    <div className="space-y-1 text-[13.5px] leading-snug text-muted-foreground">
      {layout === 'bike' && texts.validFor && <p>Valid For: <span className="text-foreground">{texts.validFor}</span></p>}
      {layout === 'vehicle' && texts.tag && <p>Tag: <span className="text-foreground">{texts.tag}</span></p>}
      {missing.length > 0
        ? <p className="rounded-[3px] bg-sand-100 px-2 py-1 text-sand-900">No {missing.join(' or ')} yet: printed blank. Set it in {where}.</p>
        : me.is_admin && <p>Change these in {where}.</p>}
    </div>
  );
}
