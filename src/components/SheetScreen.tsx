'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useActions } from '@/client/actions';
import { useUserNames } from '@/client/users';
import { store, useAllPasses, useSheet, useStatus } from '@/client/store';
import { toast } from '@/client/toast';
import { AREAS } from '@/lib/areas';
import { DEPTS } from '@/lib/depts';
import { exportCSV, exportWorkbook, type ImportPlan, planImport } from '@/lib/csv';
import {
  blankPass, filterPasses, type Filters, hasFilters, isGiven, isPrinted, missingSerials, nextSerial, NO_FILTERS, nPasses, passRanges, planClear, planPaste, type PastePlan,
  ranges, type Show, SHOW_LABEL,
} from '@/lib/passes';
import { byPhone, describe, type Duplicate, duplicatesOf, findDuplicates, namePicks } from '@/lib/people';
import { cleanField, type Field, fieldLabel, fieldsFor, fmtSerial, type Pass, PASS_TYPES, type PassType, TYPE_INFO, type Values } from '@/shared/types';
import { Menu, Popover } from './Menu';
import { ProfileCard } from './Profile';
import { RangeBar } from './RangeBar';
import { RangePanel } from './RangePanel';
import { Sheet, type Span } from './Sheet';
import { btn, btnPrimary, card, input, label } from './ui';

const NONE: number[] = [];

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const today = () => new Date().toISOString().slice(0, 10);

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function SheetScreen({ type }: { type: PassType }) {
  const info = TYPE_INFO[type];
  const sheet = useSheet(type);
  const { apply, undoLast } = useActions();
  const status = useStatus();
  /** This tab's last change in this sheet, for Undo (each sheet undoes its own). */
  const lastUndo = status.undo.findLast((u) => u.type === type && !u.undoing);

  // People: worked out from every sheet. Passes that break a rule (one mobile pass per person, …) are marked.
  const all = useAllPasses();
  const dupes = useMemo(() => findDuplicates(all), [all]);
  const phones = useMemo(() => byPhone(all), [all]);
  const picks = useMemo(() => namePicks(phones), [phones]);
  const nDupes = useMemo(() => sheet.reduce((n, p) => n + (dupes.has(p.id) ? 1 : 0), 0), [sheet, dupes]);

  // ?q=0012 (from a person's passes on another sheet) starts with that search.
  const params = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => ({ ...NO_FILTERS, q: params.get('q') ?? '' }));
  useEffect(() => { if (params.get('q')) window.history.replaceState(null, '', window.location.pathname); }, [params]);
  const deferred = useDeferredValue(filters); // typing in search stays smooth on big sheets
  const view = useMemo(() => filterPasses(sheet, deferred, dupes), [sheet, deferred, dupes]);
  // Unfilled serials show as empty rows, except while searching or showing given / printed / duplicate passes.
  const showBlank = !deferred.q.trim() && !deferred.from && !deferred.to && !['given', 'printed', 'dupes'].includes(deferred.show);
  const allMissing = useMemo(() => missingSerials(sheet), [sheet]);
  const missing = showBlank ? allMissing : NONE;
  const canAdd = showBlank;
  const next = nextSerial(sheet);

  const sheetRef = useRef(sheet);
  useEffect(() => { sheetRef.current = sheet; });

  /* ----- selection → range in the side panel ----- */
  const [selection, setSelection] = useState<Span | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const selRef = useRef(selection);
  useEffect(() => { selRef.current = selection; });
  const clearRange = useCallback(() => { setRange({ from: '', to: '' }); setSelection(null); }, []);
  const onSelectEnd = useCallback(() => {
    const s = selRef.current;
    if (s) setRange({ from: fmtSerial(s.lo), to: fmtSerial(s.hi) });
  }, []);

  /* ----- a pass that repeats someone's: say so, and save it only if told to ----- */
  const [asking, setAsking] = useState<Asking | null>(null);
  const askingRef = useRef<Asking | null>(null);
  const ask = useCallback((found: Duplicate[], verb: string, back = focusPath()) => new Promise<boolean>((done) => {
    askingRef.current?.done(false); // a newer question replaces one not answered
    askingRef.current = { found, verb, back, done };
    setAsking(askingRef.current);
  }), []);
  const answer = (go: boolean) => {
    const q = askingRef.current;
    askingRef.current = null;
    setAsking(null);
    q?.done(go);
    if (q?.back) requestAnimationFrame(() => document.querySelector<HTMLInputElement>(q.back)?.focus());
  };
  /** True to go ahead: nothing repeated, or "… anyway". */
  const checkDupes = useCallback(async (changes: Change[], verb: string) => {
    const found = duplicatesOf(store.getAll(), changes);
    return !found.length || ask(found, verb);
  }, [ask]);

  /* ----- saving ----- */
  const onEdit = useCallback(async (target: Pass[], k: Field, v: string, saved: string) => {
    const changed = target.filter((p) => p[k] !== v);
    const set = changed.map((p) => ({ id: p.id, values: { [k]: v }, expect: { [k]: saved } }));
    if (!set.length) return true;
    if ((k === 'phone' || k === 'vehicle_no') && !(await checkDupes(changed.map((p) => ({ before: p, after: { ...p, [k]: v } })), 'Save'))) return false;
    const where = `${info.label} ${passRanges(target)}`;
    const summary = `${fieldLabel(type, k)} ${saved ? `"${saved}"` : '(blank)'} → ${v ? `"${v}"` : '(blank)'} · ${where}`;
    return !!(await apply({ action: 'edit', summary, set }, { toast: target.length > 1 ? undefined : false }));
  }, [apply, checkDupes, info.label, type]);

  // A person picked from the Name suggestions: their name, and their phone, dept and area where this pass has
  // none (what's there is never overwritten). One change, so one Undo.
  const onPick = useCallback(async (p: Pass, found: Values) => {
    const values: Values = {};
    for (const k of fieldsFor(type)) {
      const v = found[k];
      if (v && v !== p[k] && (k === 'name' || !p[k])) values[k] = v;
    }
    const keys = Object.keys(values) as Field[];
    if (!keys.length) return true;
    if (values.phone && !(await checkDupes([{ before: p, after: { ...p, ...values } }], 'Save'))) return false;
    const expect = Object.fromEntries(keys.map((k) => [k, p[k]])) as Values;
    const summary = `Picked ${values.name ?? p.name}: ${keys.map((k) => fieldLabel(type, k)).join(', ')} · ${info.label} ${fmtSerial(p.serial)}`;
    return !!(await apply({ action: 'edit', summary, set: [{ id: p.id, values, expect }] }, { toast: false }));
  }, [apply, checkDupes, info.label, type]);

  // Typed as the next pass (or into an empty row): if another desk takes that serial meanwhile, it is
  // saved after the last pass instead. On screen at once; resolves when saved.
  const onCreate = useCallback(async (serial: number, values: Values) => {
    if (!(await checkDupes([{ after: { ...blankPass(type, serial), ...values } }], 'Add'))) return false;
    return Boolean(await apply(
      { action: 'edit', summary: `Added ${info.label} ${fmtSerial(serial)}`, create: [{ type, serial, values }], next: true },
      { toast: false },
    ));
  }, [apply, checkDupes, info.label, type]);

  // A paste over cells that already hold something waits here until it's confirmed (or cancelled).
  const [pendingPaste, setPendingPaste] = useState<{ replaced: PastePlan['replaced']; run: () => void; back: string } | null>(null);
  const onPaste = useCallback((rows: Pass[][], start: number, key: Field, text: string | string[][], canCreate: boolean, fill = false) => {
    // Lines past the last row on screen (the blank rows after the last pass included) get the serials after it.
    const after = rows.reduce((n, r) => Math.max(n, ...r.map((p) => p.serial + 1)), nextSerial(sheetRef.current));
    const plan = planPaste({ type, rows, start, key, text, nextSerial: after, canCreate });
    if (plan.error) return toast(plan.error, 'error');
    if (!plan.set.length && !plan.create.length) return toast('Nothing to change: those cells already hold that.');
    const serials = [...rows.slice(start, start + plan.rows).flat().map((p) => p.serial), ...plan.create.map((c) => c.serial)];
    const notes = [
      plan.create.length ? `${plan.create.length} new` : '',
      plan.replaced.length ? `replaced ${plan.replaced.length} filled cell${plan.replaced.length === 1 ? '' : 's'}` : '',
      plan.skippedHeader ? 'skipped the header row' : '',
      plan.extra ? `${plan.extra} line${plan.extra === 1 ? '' : 's'} had no row (clear the search to add new passes)` : '',
    ].filter(Boolean);
    const summary = `${fill ? 'Filled' : 'Pasted'} ${plan.rows} row${plan.rows === 1 ? '' : 's'} ${fill ? 'of' : 'into'} ${info.label} ${ranges(serials)}`;
    const save = () => void apply({ action: 'paste', summary, set: plan.set, create: plan.create, next: true }, { toast: `${summary}${notes.length ? ` (${notes.join(', ')})` : ''}` });
    // A phone or Reg. No. that repeats someone's pass asks first (after the question below, if both).
    const found = duplicatesOf(store.getAll(), [
      ...plan.set.flatMap((o) => {
        const was = store.get(o.id);
        return was && o.values && ('phone' in o.values || 'vehicle_no' in o.values) ? [{ before: was, after: { ...was, ...o.values } }] : [];
      }),
      ...plan.create.map((c) => ({ after: { ...blankPass(c.type, c.serial), ...c.values } })),
    ]);
    const back = focusPath(); // where the cursor goes back to after a question
    const run = () => (found.length ? void ask(found, fill ? 'Fill' : 'Paste', back).then((go) => go && save()) : save());
    // Pasting (not filling) over filled cells asks first.
    if (!fill && plan.replaced.length) setPendingPaste({ replaced: plan.replaced, run, back });
    else run();
  }, [apply, ask, info.label, type]);
  const closePaste = (paste: boolean) => {
    if (paste) pendingPaste?.run();
    const back = pendingPaste?.back;
    setPendingPaste(null);
    if (back) requestAnimationFrame(() => document.querySelector<HTMLInputElement>(back)?.focus());
  };

  // Ctrl+X (the cells were copied) or Delete: empty them, as one change. The passes stay.
  const onClear = useCallback((passes: Pass[], keys: readonly Field[], what: string, cut: boolean) => {
    const plan = planClear(passes, keys);
    if (!plan.set.length) return toast(cut ? `Copied ${what} (nothing to cut: they were empty)` : 'Nothing to clear: those cells are empty.');
    void apply({ action: 'edit', summary: `${cut ? 'Cut' : 'Cleared'} ${what} ${cut ? 'from' : 'of'} ${info.label} ${passRanges(plan.passes)}`, set: plan.set });
  }, [apply, info.label]);

  const onPrinted = useCallback((passes: Pass[], printed: boolean) => {
    const set = passes.filter((p) => isPrinted(p) !== printed).map((p) => ({ id: p.id, printed, expect: { printed: !printed } }));
    if (!set.length) return;
    const summary = `${printed ? 'Ticked' : 'Unticked'} Printed · ${info.label} ${passRanges(passes)}`;
    void apply({ action: 'print', summary, set });
  }, [apply, info.label]);

  const onGiven = useCallback((passes: Pass[], given: boolean) => {
    const set = passes.filter((p) => isGiven(p) !== given && (!given || isPrinted(p))).map((p) => ({ id: p.id, given, expect: { given: !given } }));
    if (!set.length) return;
    const summary = `${given ? 'Ticked' : 'Unticked'} Given · ${info.label} ${passRanges(passes)}`;
    void apply({ action: 'given', summary, set });
  }, [apply, info.label]);

  // Ctrl/Cmd+Z undoes this tab's last change in this sheet, like Excel: in a sheet cell too, unless something is
  // being typed there (then it undoes the typing). Other text boxes keep their own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      const el = document.activeElement;
      const k = el instanceof HTMLInputElement ? el.dataset.k as Field | undefined : undefined;
      const typing = !!k && cleanField(k, (el as HTMLInputElement).value) !== cleanField(k, (el as HTMLInputElement).defaultValue);
      if (typing || (!k && (el instanceof HTMLInputElement && el.type !== 'checkbox' || el instanceof HTMLTextAreaElement))) return;
      e.preventDefault();
      void undoLast(type);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undoLast, type]);

  /* ----- CSV ----- */
  const fileRef = useRef<HTMLInputElement>(null);
  const names = useUserNames();
  const [importPlan, setImportPlan] = useState<{ name: string; plan: ImportPlan; found: Duplicate[] } | null>(null);
  const exportFile = () => {
    const list = hasFilters(filters) ? view : sheet;
    download(new Blob([exportCSV(list, type, names)], { type: 'text/csv;charset=utf-8' }), `${type}-${today()}.csv`);
  };
  const exportAll = async () => {
    const sheets = Object.fromEntries(PASS_TYPES.map((t) => [t, store.getSheet(t)])) as Record<PassType, Pass[]>;
    download(new Blob([await exportWorkbook(sheets, names)], { type: XLSX }), `rssb-skp-passes-${today()}.xlsx`);
  };
  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const plan = planImport(sheetRef.current, type, await file.text());
    if (plan.error) return toast(plan.error, 'error');
    const found = duplicatesOf(store.getAll(), [
      ...plan.set.flatMap((o) => { const was = store.get(o.id); return was && o.values ? [{ before: was, after: { ...was, ...o.values } }] : []; }),
      ...plan.create.map((c) => ({ after: { ...blankPass(c.type, c.serial), ...c.values } })),
    ]);
    setImportPlan({ name: file.name, plan, found });
  };
  const runImport = async () => {
    if (!importPlan) return;
    const { plan, name } = importPlan;
    const serials = [...plan.create.map((c) => c.serial), ...plan.set.map((o) => sheetRef.current.find((p) => p.id === o.id)?.serial ?? 0)];
    setImportPlan(null); // the passes show at once; a refusal says why
    await apply({ action: 'import', summary: `Imported ${name} into ${info.label} ${ranges(serials)}`, set: plan.set, create: plan.create });
  };

  const given = useMemo(() => sheet.reduce((n, p) => n + (isGiven(p) ? 1 : 0), 0), [sheet]);

  /* ----- a person's passes ----- */
  const [person, setPerson] = useState<string | null>(null); // phone key
  const closePerson = useCallback(() => setPerson(null), []);
  const router = useRouter();
  const goTo = useCallback((p: Pass) => {
    setPerson(null);
    if (p.type === type) setFilters({ ...NO_FILTERS, q: fmtSerial(p.serial) });
    else router.push(`/s/${p.type}?q=${fmtSerial(p.serial)}`);
  }, [router, type]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-rule bg-background px-4 py-2.5">
          <h1 className="sr-only">{info.label}</h1>
          <label className="relative">
            <span className="sr-only">Search</span>
            <svg aria-hidden width="15" height="15" viewBox="0 0 16 16" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground">
              <circle cx="6.8" cy="6.8" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              className={`${input} !w-64 !pl-8`}
              placeholder="Name, phone or serial no."
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            />
          </label>
          <select className={`${input} !w-auto`} aria-label="Show" value={filters.show} onChange={(e) => setFilters((f) => ({ ...f, show: e.target.value as Show }))}>
            {(Object.keys(SHOW_LABEL) as Show[]).map((s) => <option key={s} value={s}>{SHOW_LABEL[s]}</option>)}
          </select>
          <DateFilter from={filters.from} to={filters.to} onChange={(from, to) => setFilters((f) => ({ ...f, from, to }))} />
          {hasFilters(filters) && <button className="text-[13.5px] font-semibold text-primary hover:underline" onClick={() => setFilters(NO_FILTERS)}>Clear</button>}
          <span className="pl-1.5 text-[14px] text-muted-foreground tabular-nums" aria-live="polite">
            {hasFilters(deferred)
              ? <><b className="font-semibold text-foreground">{view.length}</b> of {sheet.length} shown</>
              : <><b className="font-semibold text-foreground">{sheet.length}</b> {sheet.length === 1 ? 'pass' : 'passes'}, <b className="font-semibold text-foreground">{given}</b> given</>}
          </span>
          {nDupes > 0 && filters.show !== 'dupes' && (
            <button
              className="text-[13.5px] font-semibold text-red-700 hover:underline" onClick={() => setFilters((f) => ({ ...f, show: 'dupes' }))}
              title="Passes that repeat someone's: one mobile pass and one bike pass per person, one pass per vehicle. Click to show them."
            >
              {nDupes} {nDupes === 1 ? 'duplicate' : 'duplicates'}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
          <button
            className={btn} disabled={!lastUndo} onClick={() => void undoLast(type)}
            title={lastUndo ? `Undo: ${lastUndo.summary} (Ctrl+Z)` : `Nothing to undo in ${info.label}`}
          >
            Undo
          </button>
          <Menu
            label="Import / Export"
            items={[
              { label: 'Import CSV…', hint: `Add or fill ${info.label} passes from a CSV file (e.g. saved from Excel)`, onSelect: () => fileRef.current?.click() },
              { label: 'Export this sheet', hint: "CSV for Excel: this sheet, or what's shown while searching", onSelect: exportFile },
              { label: 'Export all sheets', hint: 'One Excel workbook, a tab per sheet', onSelect: () => void exportAll() },
            ]}
          />
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <RangeBar type={type} sheet={sheet} range={range} onClear={clearRange} />
        {pendingPaste && <PasteWarning type={type} replaced={pendingPaste.replaced} onClose={closePaste} />}
        {asking && <DuplicateWarning found={asking.found} verb={asking.verb} onClose={answer} />}
        <Sheet
          type={type} view={view} total={sheet.length} selection={selection} canAdd={canAdd} next={next} missing={missing}
          onEdit={onEdit} onCreate={onCreate} onPaste={onPaste} onClear={onClear} onPrinted={onPrinted} onGiven={onGiven}
          onSelect={setSelection} onClearSelection={clearRange} onSelectEnd={onSelectEnd}
          dupes={dupes} phones={phones} onPerson={setPerson} picks={picks} onPick={onPick}
        />
      </section>

      <RangePanel type={type} sheet={sheet} range={range} setRange={setRange} picks={picks} />
      <Suggestions picks={picks} />
      {person && <ProfileCard phone={person} passes={phones.get(person) ?? []} dupes={dupes} onJump={goTo} onClose={closePerson} />}

      {importPlan && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4" onClick={() => setImportPlan(null)}>
          <div className={`${card} w-full max-w-md space-y-3 border-t-4 p-5 shadow-[0_12px_40px_rgb(35_31_32/0.25)]`} style={{ borderTopColor: info.color.band }} onClick={(e) => e.stopPropagation()}>
            <h2 className="font-condensed text-[18px] font-bold">Import {importPlan.name} into {info.label}</h2>
            <ImportSummary plan={importPlan.plan} found={importPlan.found} />
            <div className="flex justify-end gap-2 pt-1">
              <button className={btn} onClick={() => setImportPlan(null)}>Cancel</button>
              <button className={btnPrimary} disabled={!importPlan.plan.set.length && !importPlan.plan.create.length} onClick={() => void runImport()}>
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Date added" filter: two dates in a drop-down, so the toolbar stays one line. */
function DateFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const day = (d: string) => new Date(`${d}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const text = from && to ? `Added ${day(from)} – ${day(to)}` : from ? `Added from ${day(from)}` : to ? `Added until ${day(to)}` : 'Date added';
  return (
    <Popover label={text} active={!!(from || to)} title="Passes added to the register between these dates">
      <div className="flex items-end gap-2">
        <label className={label}>From<input type="date" className={`${input} !w-[9.5rem]`} value={from} onChange={(e) => onChange(e.target.value, to)} /></label>
        <label className={label}>To<input type="date" className={`${input} !w-[9.5rem]`} value={to} onChange={(e) => onChange(from, e.target.value)} /></label>
      </div>
      {(from || to) && <button className="mt-2.5 text-[13.5px] font-semibold text-primary hover:underline" onClick={() => onChange('', '')}>Any date</button>}
    </Popover>
  );
}

function ImportSummary({ plan, found }: { plan: ImportPlan; found: Duplicate[] }) {
  const repeated = new Set(found.map((d) => d.pass)).size;
  const items = [
    plan.create.length && `${nPasses(plan.create.length)} to add`,
    plan.set.length && `${nPasses(plan.set.length)} to fill in`,
    plan.same && `${nPasses(plan.same)} already the same`,
    plan.otherSheet && `${plan.otherSheet} row${plan.otherSheet === 1 ? '' : 's'} for other sheets (import those from their own tab)`,
    plan.unknownSheet && `${plan.unknownSheet} row${plan.unknownSheet === 1 ? '' : 's'} skipped: Pandal / Non Pandal not given`,
    plan.givenNotPrinted && `${nPasses(plan.givenNotPrinted)} marked Given but not printed: left unticked (print first)`,
  ].filter(Boolean);
  return (
    <div className="space-y-2">
      <ul className="list-disc space-y-0.5 pl-5">{items.map((t) => <li key={String(t)}>{t}</li>)}</ul>
      {plan.clashes.length > 0 && (
        <p className="rounded-[3px] bg-sand-100 px-3 py-2 text-[13.5px] text-sand-900">
          Left alone, because the sheet already has something different (never overwritten): {plan.clashes.slice(0, 12).join(', ')}
          {plan.clashes.length > 12 && ` and ${plan.clashes.length - 12} more`}
        </p>
      )}
      {repeated > 0 && (
        <div className="rounded-[3px] bg-amber-50 px-3 py-2 text-[13.5px] text-amber-950">
          <p className="font-semibold">{nPasses(repeated)} would repeat someone&apos;s pass (added all the same, and marked as duplicates):</p>
          <ul className="list-disc pl-5">{found.slice(0, 5).map((d, i) => <li key={i}>{fmtSerial(d.pass.serial)}: {describe(d)}</li>)}</ul>
          {found.length > 5 && <p>and {found.length - 5} more.</p>}
        </div>
      )}
    </div>
  );
}

/** Typing suggestions for Incharge / Area / Dept, from everything entered so far on every sheet; for Name, people (`namePicks`). */
const Suggestions = memo(function Suggestions({ picks }: { picks: ReadonlyMap<string, Values> }) {
  const all = useAllPasses();
  const lists = useMemo(() => {
    const pick = (k: Field, extra: string[] = []) =>
      [...new Set([...extra, ...all.map((p) => p[k]).filter(Boolean)])].sort((a, b) => a.localeCompare(b)).slice(0, 500);
    return { incharge: pick('incharge'), area: pick('area', AREAS), dept: pick('dept', DEPTS) };
  }, [all]);
  return (
    <>
      {(Object.keys(lists) as (keyof typeof lists)[]).map((k) => (
        <datalist key={k} id={`dl-${k}`}>{lists[k].map((v) => <option key={v} value={v} />)}</datalist>
      ))}
      <datalist id="dl-person">{[...picks.keys()].map((v) => <option key={v} value={v} />)}</datalist>
    </>
  );
});

type Change = { before?: Pass; after: Pass };
type Asking = { found: Duplicate[]; verb: string; back: string; done: (go: boolean) => void };

/** Where the cursor is, to put it back after a question: the cell, found again by row and column ('' if not in one). */
function focusPath(): string {
  const el = document.activeElement as HTMLElement | null;
  const k = el?.dataset.k;
  if (!el || !k) return '';
  if (el.closest('tr[data-new]')) return `tbody tr[data-new] [data-k="${k}"]`; // the row for the next pass moves down as one is added
  const i = el.closest('tr')?.dataset.i;
  return i ? `tbody tr[data-i="${i}"] [data-k="${k}"]` : '';
}

/**
 * Before saving a pass that repeats someone's (same phone on two mobile passes, …): which, and the rule.
 * Cancel (Esc, and where the cursor starts) or "… anyway": the rules only warn.
 */
function DuplicateWarning({ found, verb, onClose }: { found: Duplicate[]; verb: string; onClose: (go: boolean) => void }) {
  return (
    <div
      role="alertdialog" aria-label="Repeats someone's pass"
      className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-amber-300 bg-amber-50 px-4 py-2 text-[14px] print:hidden"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(false); } }}
    >
      <div className="leading-snug">
        {found.slice(0, 3).map((d, i) => <p key={i}><b>{fmtSerial(d.pass.serial)}</b>: {describe(d)} {d.rule.text}</p>)}
        {found.length > 3 && <p>And {found.length - 3} more.</p>}
      </div>
      <span className="flex-1" />
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the save is waiting on this answer: Enter cancels, so a slip doesn't add it */}
      <button className={btn} autoFocus onClick={() => onClose(false)}>Cancel</button>
      <button className={btnPrimary} onClick={() => onClose(true)}>{verb} anyway</button>
    </div>
  );
}

/** Asks before a paste replaces cells that already hold something: which cells, then Paste over / Cancel (Enter / Esc). */
function PasteWarning({ type, replaced, onClose }: { type: PassType; replaced: PastePlan['replaced']; onClose: (paste: boolean) => void }) {
  const n = replaced.length;
  const byKey = new Map<Field, number[]>();
  for (const r of replaced) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r.serial]);
  const one = replaced[0];
  const quote = (v: string) => (v ? `"${v.length > 30 ? `${v.slice(0, 29)}…` : v}"` : 'empty');
  return (
    <div
      role="alertdialog" aria-label="Paste over filled cells?"
      className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-amber-300 bg-amber-50 px-4 py-2 text-[14px] print:hidden"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(false); } }}
    >
      <p className="leading-snug">
        {n === 1
          ? <>{fmtSerial(one.serial)} {fieldLabel(type, one.key)} already has {quote(one.from)}; the paste puts {quote(one.to)}.</>
          : <><b>{n} cells</b> already have something in them: {[...byKey].map(([k, serials]) => `${fieldLabel(type, k)} in ${ranges(serials)}`).join(', ')}.</>}
        {' '}Paste over {n === 1 ? 'it' : 'them'}? <b>Undo</b> brings {n === 1 ? 'it' : 'them'} back.
      </p>
      <span className="flex-1" />
      <button className={btn} onClick={() => onClose(false)}>Cancel</button>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the paste is waiting on this answer: Enter pastes, Esc cancels */}
      <button className={btnPrimary} autoFocus onClick={() => onClose(true)}>Paste over {n === 1 ? '1 cell' : `${n} cells`}</button>
    </div>
  );
}
