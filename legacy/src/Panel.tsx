import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { PREFIX, TYPES, ZONES, type EditKey, type Pass, type PassType, type PassZone, type PrintSettings } from './types';
import {
  cleanFill, FIELD_LABELS, nextStart, nPasses, passesForPrint, planAdd, planFill, ranges, type FillRange, type FillValues,
} from './lib/passes';
import { PER_PAGE } from './PrintView';

const zoneClass = (z: PassZone) => (z === 'Pandal' ? 'pandal' : 'non-pandal');

function TypePicker({ value, onChange }: { value: PassType; onChange: (t: PassType) => void }) {
  return (
    <div className="seg">
      {TYPES.map((t) => (
        <button type="button" key={t} className={t === value ? 'on' : ''} onClick={() => onChange(t)}>{t}</button>
      ))}
    </div>
  );
}

/**
 * Main box: a serial range (typed, or set by selecting rows in the sheet) and any of the columns
 * to fill (at least one) — e.g. give the passes to an incharge.
 */
export function FillBox({ passes, range, onRange, focusSignal, onFill }: {
  passes: Pass[];
  range: FillRange;
  onRange: (patch: Partial<FillRange>) => void;
  /** Changes when rows were just selected in the sheet: jump to the Incharge box. */
  focusSignal: number;
  onFill: (take: Pass[], values: FillValues) => void;
}) {
  const { type, from, to } = range;
  const [values, setValues] = useState<FillValues>({});
  const inchargeRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusSignal) inchargeRef.current?.focus(); }, [focusSignal]);
  const mobile = type === 'Mobile';
  const filled = useMemo(() => cleanFill(mobile ? values : { ...values, zone: undefined }), [values, mobile]);
  const plan = useMemo(() => planFill(passes, type, from, to, filled), [passes, type, from, to, filled]);
  const nFields = Object.keys(filled).length;
  const ready = !plan.err && plan.take.length > 0 && nFields > 0;
  const onlyIncharge = filled.incharge && nFields === (filled.zone ? 2 : 1); // "Give 5 Pandal passes to Ram"
  const noZone = mobile && !filled.zone && plan.take.some((p) => !p.zone);

  const field = (k: EditKey, list?: string, extra?: { inputMode?: 'tel'; ref?: typeof inchargeRef }) => (
    <label>{FIELD_LABELS[k]}
      <input value={values[k] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} list={list} autoComplete="off" {...extra} />
    </label>
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onFill(plan.take, filled);
    onRange({ from: '', to: '' });
    setValues({});
  };

  return (
    <form onSubmit={submit}>
      <h3>Give / fill passes</h3>
      <p className="muted small fill-hint top">Type a range, or select rows in the sheet (click the row numbers; Shift+click or drag for more).</p>
      <TypePicker value={type} onChange={(t) => onRange({ type: t })} />
      <div className="row2">
        <label>From serial no.<input value={from} onChange={(e) => onRange({ from: e.target.value })} placeholder="101" inputMode="numeric" /></label>
        <label>To serial no.<input value={to} onChange={(e) => onRange({ to: e.target.value })} placeholder="150" inputMode="numeric" /></label>
      </div>
      <p className="muted small fill-hint">Fill any of these (at least one). Blank ones are left as they are.</p>
      {mobile && (
        <div className="seg zone">
          {ZONES.map((z) => (
            <button
              type="button" key={z} className={values.zone === z ? `on ${zoneClass(z)}` : ''}
              onClick={() => setValues((v) => ({ ...v, zone: v.zone === z ? undefined : z }))}
            >{z}</button>
          ))}
        </div>
      )}
      {field('incharge', 'incharges', { ref: inchargeRef })}
      {field('name')}
      <div className="row2">{field('dept', 'depts')}{field('area', 'areas')}</div>
      {field('phone', undefined, { inputMode: 'tel' })}
      <div className="preview">
        {plan.err ? (
          <span className="muted">{plan.err}</span>
        ) : (
          <>
            <div className="ok">{nPasses(plan.take.length)} to fill</div>
            {plan.take.length > 0 && <div className="mono">{ranges(plan.take)}</div>}
            {plan.skipped.length > 0 && (
              <div className="warn">
                Skipping {plan.skipped.length} that already have a different value ({plan.skipped[0].why}
                {plan.skipped.length > 1 ? ', …' : ''}): <span className="mono">{ranges(plan.skipped.map((x) => x.pass))}</span>
              </div>
            )}
            {plan.same > 0 && <div className="muted">{plan.same} already have these values</div>}
            {plan.missing > 0 && <div className="warn">{plan.missing} numbers in this range don't exist</div>}
            {filled.name && plan.take.length > 1 && <div className="warn">The same name will go on all {plan.take.length} passes</div>}
            {noZone && <div className="warn">Pandal / Non Pandal not chosen (needed to print)</div>}
            {nFields === 0 && <div className="muted">Fill at least one field above.</div>}
          </>
        )}
      </div>
      <button className="primary wide" disabled={!ready}>
        {!ready ? 'Fill passes'
          : onlyIncharge ? `Give ${filled.zone ? `${plan.take.length} ${filled.zone} pass${plan.take.length === 1 ? '' : 'es'}` : nPasses(plan.take.length)} to ${filled.incharge}`
          : `Fill ${nPasses(plan.take.length)}`}
      </button>
    </form>
  );
}

/** Setup step: enter the serial numbers of the printed passes. Collapsed once passes exist. */
export function AddBox({ passes, onAdd }: { passes: Pass[]; onAdd: (type: PassType, items: { serial: string; num: number }[]) => void }) {
  const [open, setOpen] = useState(passes.length === 0);
  const [type, setType] = useState<PassType>('Mobile');
  const [prefix, setPrefix] = useState(PREFIX.Mobile);
  // Suggest the 100 numbers right after the last existing pass.
  const [from, setFrom] = useState(() => String(nextStart(passes, 'Mobile')));
  const [to, setTo] = useState(() => String(nextStart(passes, 'Mobile') + 99));
  const plan = useMemo(() => planAdd(passes, type, prefix, from, to), [passes, type, prefix, from, to]);
  const n = plan.create.length;

  const changeType = (t: PassType) => {
    if (prefix === PREFIX[type]) setPrefix(PREFIX[t]);
    setType(t);
    const start = nextStart(passes, t);
    setFrom(String(start));
    setTo(String(start + 99));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!n) return;
    onAdd(type, plan.create);
    const last = parseInt(to, 10);
    const size = last - parseInt(from, 10) + 1;
    setFrom(String(last + 1)); // ready for the next batch
    setTo(String(last + size));
  };

  return (
    <details className="add" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>＋ Add passes</summary>
      <p className="muted">One-time setup: enter the serial numbers printed on the passes. Come back only if more get printed.</p>
      <form onSubmit={submit}>
        <TypePicker value={type} onChange={changeType} />
        <div className="row3">
          <label>Prefix<input value={prefix} onChange={(e) => setPrefix(e.target.value)} /></label>
          <label>From<input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" /></label>
          <label>To<input value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" /></label>
        </div>
        <div className="preview">
          {plan.err ? (
            <span className="muted">{plan.err}</span>
          ) : (
            <>
              {n > 0 && <div className="mono">{plan.create[0].serial} … {plan.create[n - 1].serial}</div>}
              {plan.existing ? <div className="warn">{plan.existing} already exist (skipped)</div> : null}
            </>
          )}
        </div>
        <button className="primary wide" disabled={!n}>{n ? `Add ${nPasses(n)}` : 'Add passes'}</button>
      </form>
    </details>
  );
}

const MAX_PRINT = 900; // 100 A4 pages per print run keeps the browser responsive

/** Scales an uploaded signature down (max 400 px wide) so it fits comfortably in browser storage. */
async function shrinkImage(file: File, maxWidth = 400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxWidth / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PrintBox({ passes, settings, onSettings, onPreview }: {
  passes: Pass[];
  settings: PrintSettings;
  onSettings: (patch: Partial<PrintSettings>) => void;
  onPreview: (list: Pass[]) => void;
}) {
  const [type, setType] = useState<PassType>('Mobile');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const mobile = type === 'Mobile'; // Mobile passes use the RSSB SKP template, Pandal / Non Pandal from each pass
  const inRange = useMemo(() => passesForPrint(passes, type, from, to), [passes, type, from, to]);
  const done = inRange.filter((p) => p.printed); // never print a pass twice by accident
  const noZone = mobile ? inRange.filter((p) => !p.printed && !p.zone) : [];
  const list = inRange.filter((p) => !p.printed && (!mobile || p.zone));
  const pandal = list.filter((p) => p.zone === 'Pandal').length;
  const named = list.filter((p) => p.name).length;
  const pages = Math.ceil(list.length / PER_PAGE);
  const tooMany = list.length > MAX_PRINT;

  const onSignature = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onSettings({ signature: await shrinkImage(file) });
  };

  return (
    <details className="add">
      <summary>🖨 Print passes</summary>
      <TypePicker value={type} onChange={setType} />
      <div className="row2">
        <label>From serial no.<input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="first" inputMode="numeric" /></label>
        <label>To serial no.<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="last" inputMode="numeric" /></label>
      </div>
      {!mobile && (
        <>
          <div className="seg zone">
            <button type="button" className={settings.zone === 'inside' ? 'on inside' : ''} onClick={() => onSettings({ zone: 'inside' })}>Inside Pandal</button>
            <button type="button" className={settings.zone === 'outside' ? 'on outside' : ''} onClick={() => onSettings({ zone: 'outside' })}>Outside Pandal</button>
          </div>
          <label>Event (side text)<input value={settings.event} onChange={(e) => onSettings({ event: e.target.value })} placeholder="e.g. SIKANDERPUR 2025" /></label>
          <label>Valid till<input value={settings.validTill} onChange={(e) => onSettings({ validTill: e.target.value })} placeholder="e.g. Oct 5th 2025" /></label>
        </>
      )}
      <label>Signature image (optional)<input type="file" accept="image/*" onChange={onSignature} /></label>
      {settings.signature && (
        <div className="sig-preview">
          <img src={settings.signature} alt="Signature" />
          <button type="button" onClick={() => onSettings({ signature: '' })}>Remove</button>
        </div>
      )}
      <div className="preview">
        {list.length > 0 && (
          <>
            <div className="ok">{nPasses(list.length)} · {pages} A4 page{pages === 1 ? '' : 's'}</div>
            {mobile && <div>{pandal} Pandal, {list.length - pandal} Non Pandal</div>}
            <div>{named} with names, {list.length - named} blank</div>
            <div className="mono">{ranges(list)}</div>
            {tooMany && <div className="warn">Too many for one go: print at most {MAX_PRINT} at a time.</div>}
          </>
        )}
        {done.length > 0 && (
          <div className="muted">
            Skipping {done.length} already printed (untick <i>Printed</i> in the sheet to print again):{' '}
            <span className="mono">{ranges(done)}</span>
          </div>
        )}
        {noZone.length > 0 && (
          <div className="warn">
            Skipping {noZone.length} with no Pandal / Non Pandal (set it in Give / fill or the sheet):{' '}
            <span className="mono">{ranges(noZone)}</span>
          </div>
        )}
        {!inRange.length && <span className="muted">No {type} passes in this range.</span>}
      </div>
      <button type="button" className="primary wide" disabled={!list.length || tooMany} onClick={() => onPreview(list)}>
        Preview &amp; print
      </button>
    </details>
  );
}
