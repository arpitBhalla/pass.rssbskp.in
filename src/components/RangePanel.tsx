'use client';
import { useMemo, useState } from 'react';
import { useActions } from '@/client/actions';
import { cleanFill, nPasses, parseSerial, planFill, ranges } from '@/lib/passes';
import { type Field, fieldLabel, fieldsFor, type Pass, type PassType, TYPE_INFO, type Values } from '@/shared/types';
import { btnPrimary, heading, input, label } from './ui';

const SUGGEST: Partial<Record<Field, string>> = { incharge: 'dl-incharge', area: 'dl-area', dept: 'dl-dept' };
/** Give box order: Area first, then who it's given to. */
const GIVE_ORDER: Field[] = ['area', 'incharge', 'dept', 'name', 'phone', 'vehicle', 'vehicle_no'];
/** A Give needs one of these: the incharge, or the holder's Name / Dept / Phone. */
const WHO: Field[] = ['incharge', 'name', 'dept', 'phone'];

/**
 * Side panel: pick a range of serials (or select rows in the sheet) and Give them to someone. It shows
 * exactly what will happen before anything is saved. Print / Given / Delete are in the RangeBar.
 */
export function RangePanel({ type, sheet, range, setRange }: {
  type: PassType;
  sheet: Pass[];
  range: { from: string; to: string };
  setRange: (r: { from: string; to: string }) => void;
}) {
  const info = TYPE_INFO[type];
  const { apply } = useActions();

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
    const typed = values;
    setValues({}); // the passes show as given at once; if the server refuses, the box gets its values back
    const r = await apply({ action: 'give', summary, set: give.set, create: give.create });
    if (!r) setValues((v) => (Object.values(v).some(Boolean) ? v : typed));
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
            {fieldLabel(type, k)}
            <input className={input} list={SUGGEST[k]} value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
          </label>
        ))}
        {give?.err && <p className="text-[13.5px] text-destructive">{give.err}</p>}
        {give && !give.err && !hasWho && (
          <p className="text-[13.5px] leading-snug text-muted-foreground">Fill {fieldLabel(type, 'incharge')}, or at least one of Name, Dept and Phone.</p>
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

    </aside>
  );
}
