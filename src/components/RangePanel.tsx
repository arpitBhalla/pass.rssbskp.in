'use client';
import { useMemo, useState } from 'react';
import { useActions } from '@/client/actions';
import { cleanFill, isBlank, isGiven, isPrinted, nextSerial, nPasses, parseSerial, type Picked, planFill, ranges } from '@/lib/passes';
import { type Field, fieldLabel, fieldsFor, fmtSerial, type Pass, type PassType, TYPE_INFO, type Values } from '@/shared/types';
import { btnPrimary, heading, input, label } from './ui';

const SUGGEST: Partial<Record<Field, string>> = { name: 'dl-person', incharge: 'dl-incharge', area: 'dl-area', dept: 'dl-dept' };
/** Give box order: Area first, then who it's given to. */
const GIVE_ORDER: Field[] = ['area', 'incharge', 'dept', 'name', 'phone', 'vehicle', 'vehicle_no'];
/** A Give needs one of these: the incharge, or the holder's Name / Dept / Phone. */
const WHO: Field[] = ['incharge', 'name', 'dept', 'phone'];

/**
 * Side panel: pick a range of serials (or select rows in the sheet) and Give them to someone. It shows
 * exactly what will happen before anything is saved. Print / Given / Delete are in the RangeBar.
 */
export function RangePanel({ type, sheet, range, setRange, picks }: {
  type: PassType;
  sheet: Pass[];
  range: Picked;
  setRange: (r: Picked) => void;
  /** The Name suggestions (`namePicks`): picking one fills in the person's phone, dept and area too. */
  picks: ReadonlyMap<string, Values>;
}) {
  const info = TYPE_INFO[type];
  const { apply } = useActions();

  /* ----- give ----- */
  const fields = GIVE_ORDER.filter((k) => fieldsFor(type).includes(k));
  const [values, setValues] = useState<Values>({});
  const fill = useMemo(() => cleanFill(type, values), [type, values]);
  const hasRange = range.from.trim() !== '';
  // No range: the first completely empty pass is filled in, and its Added by becomes whoever gives it; passes
  // partly filled in are left alone (the owner, 2026-11-22). With none empty, one new pass at the end
  // (2026-11-17): if another desk takes that serial meanwhile, it is saved after the last pass instead.
  const blank = useMemo(() => sheet.find((p) => isBlank(type, p) && !isPrinted(p) && !isGiven(p)), [sheet, type]);
  const end = nextSerial(sheet);
  const target = blank?.serial ?? end;
  const give = useMemo(() => {
    const plan = planFill(sheet, type, hasRange ? range.from : String(target), hasRange ? range.to : '', fill, hasRange ? range.only : undefined);
    return !hasRange && blank ? { ...plan, set: plan.set.map((o) => ({ ...o, claim: true })) } : plan;
  }, [hasRange, sheet, type, range, target, blank, fill]);
  const giveCount = give.serials.length;
  const hasWho = WHO.some((k) => fill[k]);
  const typedAny = Object.values(values).some((v) => v?.trim());
  // A person picked from the Name suggestions: their name, and their phone, dept and area in the boxes still empty.
  const change = (k: Field, v: string) => {
    const found = k === 'name' ? picks.get(v) : undefined;
    if (!found) return setValues({ ...values, [k]: v });
    const add = fields.filter((f) => found[f] && (f === 'name' || !values[f]?.trim())).map((f) => [f, found[f]]);
    setValues({ ...values, ...Object.fromEntries(add) });
  };

  const doGive = async () => {
    if (!giveCount || !hasWho) return;
    const who = fill.incharge || fill.name || fill.dept || fill.phone;
    const summary = hasRange ? `Gave ${info.label} ${ranges(give.serials)} to ${who}`
      : blank ? `Filled empty ${info.label} ${fmtSerial(target)} for ${who}` : `Added ${info.label} ${fmtSerial(end)} for ${who}`;
    const typed = values;
    setValues({}); // the passes show as given at once; if the server refuses, the box gets its values back
    const r = await apply({ action: 'give', summary, set: give.set, create: give.create, next: !hasRange && !blank });
    if (!r) setValues((v) => (Object.values(v).some(Boolean) ? v : typed));
  };

  const from = parseSerial(range.from);
  const to = Number.isNaN(parseSerial(range.to)) ? from : parseSerial(range.to);
  const span = range.only ? range.only.length : Number.isNaN(from) ? 0 : Math.abs(to - from) + 1;

  return (
    <aside className="w-[310px] shrink-0 space-y-4 overflow-y-auto border-l border-border bg-panel px-4 py-3 print:hidden">
      <section className="space-y-2">
        <h2 className={heading}>Passes</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>From<input className={`${input} font-condensed !text-[16px] tabular-nums`} inputMode="numeric" value={range.from} onChange={(e) => setRange({ from: e.target.value, to: range.to })} placeholder="0001" /></label>
          <label className={label}>To<input className={`${input} font-condensed !text-[16px] tabular-nums`} inputMode="numeric" value={range.to} onChange={(e) => setRange({ from: range.from, to: e.target.value })} placeholder="0050" /></label>
        </div>
        <p className="text-[13.5px] leading-snug text-muted-foreground">
          {span ? <b className="font-semibold text-foreground">{nPasses(span)}{range.only ? ' shown in the sheet' : ''}. </b> : ''}
          {range.only ? 'Only the rows picked; the hidden ones between are left alone.' : 'Or select rows in the sheet: click a Sr. No., then Shift+click or drag.'}
        </p>
      </section>

      {/* Enter in any box gives too. */}
      <form className="space-y-2.5 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); void doGive(); }}>
        <h2 className={heading}>Give</h2>
        {fields.map((k) => (
          <label key={k} className={label}>
            {fieldLabel(type, k)}
            <input className={input} list={SUGGEST[k]} value={values[k] ?? ''} onChange={(e) => change(k, e.target.value)} />
          </label>
        ))}
        {give.err && <p className="text-[13.5px] text-destructive">{give.err}</p>}
        {!give.err && !hasWho && (hasRange || typedAny) && (
          <p className="text-[13.5px] leading-snug text-muted-foreground">Fill {fieldLabel(type, 'incharge')}, or at least one of Name, Dept and Phone.</p>
        )}
        {!give.err && hasWho && !hasRange && (
          <p className="text-[13.5px] leading-snug text-muted-foreground">
            {blank
              ? <>No range: fills the first empty row, <b className="text-foreground">{fmtSerial(target)}</b>.</>
              : <>No range: adds a new pass at the end, <b className="text-foreground">{fmtSerial(end)}</b>.</>}
          </p>
        )}
        {!give.err && hasWho && hasRange && (
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
        <button type="submit" className={`${btnPrimary} w-full`} disabled={!giveCount || !hasWho}>
          {!hasWho ? 'Give' : !hasRange ? (blank ? `Fill ${fmtSerial(target)}` : `Add ${fmtSerial(end)} at the end`) : !giveCount ? 'Nothing to change' : `Give ${nPasses(giveCount)}`}
        </button>
      </form>

    </aside>
  );
}
