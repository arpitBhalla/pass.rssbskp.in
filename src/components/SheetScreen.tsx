'use client';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useActions } from '@/client/actions';
import { useUserNames } from '@/client/users';
import { store, useAllPasses, useSheet, useStatus } from '@/client/store';
import { toast } from '@/client/toast';
import { AREAS } from '@/lib/areas';
import { DEPTS } from '@/lib/depts';
import { exportCSV, exportWorkbook, type ImportPlan, planImport } from '@/lib/csv';
import { filterPasses, type Filters, hasFilters, isGiven, isPrinted, missingSerials, nextSerial, NO_FILTERS, nPasses, passRanges, planPaste, ranges, type Show, SHOW_LABEL } from '@/lib/passes';
import { type Field, FIELD_LABELS, fmtSerial, type Pass, PASS_TYPES, type PassType, TYPE_INFO, type Values } from '@/shared/types';
import { Menu, Popover } from './Menu';
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
  const { apply, undo } = useActions();
  const status = useStatus();

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const deferred = useDeferredValue(filters); // typing in search stays smooth on big sheets
  const view = useMemo(() => filterPasses(sheet, deferred), [sheet, deferred]);
  // Unfilled serials show as empty rows, except while searching or showing given / printed passes.
  const showBlank = !deferred.q.trim() && !deferred.from && !deferred.to && deferred.show !== 'given' && deferred.show !== 'printed';
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

  /* ----- saving ----- */
  const onEdit = useCallback(async (target: Pass[], k: Field, v: string, saved: string) => {
    const set = target.filter((p) => p[k] !== v).map((p) => ({ id: p.id, values: { [k]: v }, expect: { [k]: saved } }));
    if (!set.length) return true;
    const where = `${info.label} ${passRanges(target)}`;
    const summary = `${FIELD_LABELS[k]} ${saved ? `"${saved}"` : '(blank)'} → ${v ? `"${v}"` : '(blank)'} · ${where}`;
    return !!(await apply({ action: 'edit', summary, set }, { toast: target.length > 1 ? undefined : false }));
  }, [apply, info.label]);

  const onCreate = useCallback(async (serial: number, values: Values) => {
    return !!(await apply(
      { action: 'edit', summary: `Added ${info.label} ${fmtSerial(serial)}`, create: [{ type, serial, values }] },
      { toast: false },
    ));
  }, [apply, info.label, type]);

  const onPaste = useCallback((rows: Pass[][], start: number, key: Field, text: string, canCreate: boolean) => {
    const plan = planPaste({ type, rows, start, key, text, nextSerial: nextSerial(sheetRef.current), canCreate });
    if (plan.error) return toast(plan.error, 'error');
    if (!plan.set.length && !plan.create.length) return toast('Nothing to change: those cells already hold that.');
    const serials = [...rows.slice(start, start + plan.rows).flat().map((p) => p.serial), ...plan.create.map((c) => c.serial)];
    const notes = [
      plan.create.length ? `${plan.create.length} new` : '',
      plan.overwritten ? `replaced ${plan.overwritten} filled cell${plan.overwritten === 1 ? '' : 's'}` : '',
      plan.skippedHeader ? 'skipped the header row' : '',
      plan.extra ? `${plan.extra} line${plan.extra === 1 ? '' : 's'} had no row (clear the search to add new passes)` : '',
    ].filter(Boolean);
    const summary = `Pasted ${plan.rows} row${plan.rows === 1 ? '' : 's'} into ${info.label} ${ranges(serials)}`;
    void apply({ action: 'paste', summary, set: plan.set, create: plan.create }, { toast: `${summary}${notes.length ? ` (${notes.join(', ')})` : ''}` });
  }, [apply, info.label, type]);

  const onPrinted = useCallback((passes: Pass[], printed: boolean) => {
    const set = passes.filter((p) => isPrinted(p) !== printed).map((p) => ({ id: p.id, printed, expect: { printed: !printed } }));
    if (!set.length) return;
    const summary = `${printed ? 'Ticked' : 'Unticked'} Printed · ${info.label} ${passRanges(passes)}`;
    void apply({ action: 'print', summary, set });
  }, [apply, info.label]);

  const onGiven = useCallback((passes: Pass[], given: boolean) => {
    const set = passes.filter((p) => isGiven(p) !== given).map((p) => ({ id: p.id, given, expect: { given: !given } }));
    if (!set.length) return;
    const summary = `${given ? 'Ticked' : 'Unticked'} Given · ${info.label} ${passRanges(passes)}`;
    void apply({ action: 'given', summary, set });
  }, [apply, info.label]);

  // Ctrl/Cmd+Z outside a text box undoes this tab's last change.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type !== 'checkbox' || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      void undo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo]);

  /* ----- CSV ----- */
  const fileRef = useRef<HTMLInputElement>(null);
  const names = useUserNames();
  const [importPlan, setImportPlan] = useState<{ name: string; plan: ImportPlan } | null>(null);
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
    setImportPlan({ name: file.name, plan });
  };
  const runImport = async () => {
    if (!importPlan) return;
    const { plan, name } = importPlan;
    const serials = [...plan.create.map((c) => c.serial), ...plan.set.map((o) => sheetRef.current.find((p) => p.id === o.id)?.serial ?? 0)];
    const r = await apply({ action: 'import', summary: `Imported ${name} into ${info.label} ${ranges(serials)}`, set: plan.set, create: plan.create });
    if (r) setImportPlan(null);
  };

  const given = useMemo(() => sheet.reduce((n, p) => n + (isGiven(p) ? 1 : 0), 0), [sheet]);

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
          <div className="ml-auto flex items-center gap-2">
          <button className={btn} disabled={!status.undo} onClick={() => void undo()} title={status.undo ? `Undo: ${status.undo.summary} (Ctrl+Z)` : 'Nothing to undo'}>
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
        <Sheet
          type={type} view={view} total={sheet.length} selection={selection} canAdd={canAdd} next={next} missing={missing}
          onEdit={onEdit} onCreate={onCreate} onPaste={onPaste} onPrinted={onPrinted} onGiven={onGiven}
          onSelect={setSelection} onSelectEnd={onSelectEnd}
        />
      </section>

      <RangePanel type={type} sheet={sheet} range={range} setRange={setRange} />
      <Suggestions />

      {importPlan && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4" onClick={() => setImportPlan(null)}>
          <div className={`${card} w-full max-w-md space-y-3 border-t-4 p-5 shadow-[0_12px_40px_rgb(35_31_32/0.25)]`} style={{ borderTopColor: info.color.band }} onClick={(e) => e.stopPropagation()}>
            <h2 className="font-condensed text-[18px] font-bold">Import {importPlan.name} into {info.label}</h2>
            <ImportSummary plan={importPlan.plan} />
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

function ImportSummary({ plan }: { plan: ImportPlan }) {
  const items = [
    plan.create.length && `${nPasses(plan.create.length)} to add`,
    plan.set.length && `${nPasses(plan.set.length)} to fill in`,
    plan.same && `${nPasses(plan.same)} already the same`,
    plan.otherSheet && `${plan.otherSheet} row${plan.otherSheet === 1 ? '' : 's'} for other sheets (import those from their own tab)`,
    plan.unknownSheet && `${plan.unknownSheet} row${plan.unknownSheet === 1 ? '' : 's'} skipped: Pandal / Non Pandal not given`,
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
    </div>
  );
}

/** Typing suggestions for Incharge / Area / Dept, from everything entered so far on every sheet. */
const Suggestions = memo(function Suggestions() {
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
    </>
  );
});
