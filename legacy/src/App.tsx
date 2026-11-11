import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AddBox, FillBox, PrintBox } from './Panel';
import { AREAS } from './areas';
import { PrintView } from './PrintView';
import { Report } from './Report';
import { Sheet } from './Sheet';
import { usePassStore, usePrintSettings } from './store';
import { TYPES, type EditKey, type FillKey, type Pass, type PassType } from './types';
import {
  addPasses, describeValue, editPasses, fillPasses, filterPasses, isGiven, nPasses, pasteCells, rangeSpan, ranges, setPrinted,
  type FillRange, type FillValues, type Filters, type Span,
} from './lib/passes';
import { exportCSV, importCSV } from './lib/csv';
import { BY_LABEL, buildReport, reportCSV, type ReportBy } from './lib/report';

function useToast() {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);
  const show = useCallback((text: string) => setMsg((m) => ({ text, n: (m?.n ?? 0) + 1 })), []);
  return [msg?.text ?? '', show] as const;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function download(text: string, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const SHOW_LABEL: Record<Filters['show'], string> = { all: 'Given + Free', given: 'Given only', free: 'Free only' };

export default function App() {
  const { passes, commit, undo, canUndo, saveError } = usePassStore();
  const [toast, showToast] = useToast();
  const [filters, setFilters] = useState<Filters>({ q: '', type: '', show: 'all' });
  const deferredFilters = useDeferredValue(filters);
  const view = useMemo(() => filterPasses(passes, deferredFilters), [passes, deferredFilters]);
  const [page, setPage] = useState<'sheet' | 'report'>('sheet');
  const [reportBy, setReportBy] = useState<ReportBy>('area');
  const report = useMemo(() => (page === 'report' ? buildReport(view, reportBy) : null), [page, view, reportBy]);
  // Typing suggestions: values already used, plus the preset areas (any other text is still allowed).
  const suggestions = useMemo(() => {
    const uniq = (k: 'incharge' | 'dept' | 'area') => [...new Set(passes.map((p) => p[k]).filter(Boolean))].sort();
    const preset = new Set(AREAS.map((a) => a.name));
    const opts = (values: string[]) => values.map((value) => ({ value, label: undefined as string | undefined }));
    return {
      incharges: opts(uniq('incharge')),
      depts: opts(uniq('dept')),
      areas: [
        ...AREAS.map((a) => ({ value: a.name, label: a.code as string | undefined })),
        ...opts(uniq('area').filter((v) => !preset.has(v.toUpperCase()))),
      ],
    };
  }, [passes]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [printSettings, setPrintSettings] = usePrintSettings();
  const [printing, setPrinting] = useState<Pass[] | null>(null);
  const [resetCount, setResetCount] = useState(0); // bumping it clears the side-panel forms
  const closePrint = useCallback(() => setPrinting(null), []);

  // The Give / fill range. Selecting rows in the sheet sets it; the rows it covers are highlighted.
  const [range, setRange] = useState<FillRange>({ type: 'Mobile', from: '', to: '' });
  const updateRange = useCallback((patch: Partial<FillRange>) => setRange((r) => ({ ...r, ...patch })), []);
  const selection = useMemo(() => rangeSpan(range), [range]);
  const onSelect = useCallback((s: Span) => setRange({ type: s.type, from: String(s.lo), to: String(s.hi) }), []);
  const [focusFill, setFocusFill] = useState(0);
  const onSelectEnd = useCallback(() => setFocusFill((n) => n + 1), []);

  // Ctrl/Cmd+Z undoes the last change, Esc clears the selection (unless you're typing in a box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement) return;
      if (e.key === 'Escape') { setRange((r) => ({ ...r, from: '', to: '' })); return; }
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      undo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo]);

  const onEdit = useCallback(
    (ids: string, key: FillKey, value: string) => commit((prev) => editPasses(prev, new Set(ids.split(',')), key, value)),
    [commit],
  );

  const onPrinted = useCallback(
    (ids: string[], printed: boolean) => commit((prev) => setPrinted(prev, new Set(ids), printed)),
    [commit],
  );

  const onPasteCells = (rows: Pass[][], start: number, key: EditKey, text: string) => {
    const r = pasteCells(passes, rows, start, key, text);
    commit(() => r.passes);
    showToast(`Pasted ${r.rows} rows` + (r.extra > 0 ? ` — ${r.extra} lines didn't fit (no more rows below)` : ''));
  };

  const onFill = (take: Pass[], values: FillValues) => {
    commit((prev) => fillPasses(prev, new Set(take.map((p) => p.id)), values));
    const what = Object.entries(values).map(([k, v]) => describeValue(k as FillKey, v)).join(', ');
    showToast(`✓ ${nPasses(take.length)} filled (${what}): ${ranges(take)}`);
  };

  const onAdd = (type: PassType, items: { serial: string; num: number }[]) => {
    commit((prev) => addPasses(prev, type, items));
    showToast(`✓ Added ${nPasses(items.length)}`);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const res = importCSV(passes, await file.text());
    if (!res.ok) return showToast(res.error);
    commit(() => res.passes);
    showToast(`Imported: ${res.added} new, ${res.updated} updated`);
  };

  const onReset = () => {
    if (!confirm(`Delete all ${nPasses(passes.length)} and start fresh?\n\nYou can click Undo right after if this was a mistake.`)) return;
    commit(() => []);
    setResetCount((n) => n + 1);
    setRange({ type: 'Mobile', from: '', to: '' });
    showToast('All passes deleted. Click Undo to bring them back.');
  };

  const onExport = () => download(exportCSV(view), `passes-${today()}.csv`);
  const onExportReport = () => report && download(reportCSV(report), `pass-report-by-${reportBy}-${today()}.csv`);
  const caption = [
    today(),
    filters.type || 'Mobile + Bike',
    SHOW_LABEL[filters.show],
    filters.q && `search "${filters.q}"`,
    nPasses(view.length),
  ].filter(Boolean).join(' · ');

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <>
      <div className="app" hidden={printing !== null}>
        <header>
          <h1>🎫 Pass Register</h1>
          <nav className="tabs">
            <button className={page === 'sheet' ? 'on' : ''} onClick={() => setPage('sheet')}>Sheet</button>
            <button className={page === 'report' ? 'on' : ''} onClick={() => setPage('report')}>Report</button>
          </nav>
          <div className="stats">
            {TYPES.map((t) => {
              const ps = passes.filter((p) => p.type === t);
              const given = ps.filter(isGiven).length;
              return (
                <div className="stat" key={t}>
                  <span className={`tag ${t}`}>{t}</span>
                  <span><b>{ps.length}</b> total</span>
                  <span><b className="given-text">{given}</b> given</span>
                  <span><b>{ps.length - given}</b> free</span>
                </div>
              );
            })}
          </div>
        </header>

        {saveError && <div className="banner">⚠ {saveError}</div>}

        <div className="toolbar">
          <input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search serial no., name, phone, dept, incharge…" />
          <select value={filters.type} onChange={(e) => set({ type: e.target.value as Filters['type'] })}>
            <option value="">Mobile + Bike</option>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={filters.show} onChange={(e) => set({ show: e.target.value as Filters['show'] })}>
            <option value="all">Given + Free</option>
            <option value="given">Given only</option>
            <option value="free">Free only</option>
          </select>
          <span className="muted">{view.length} of {passes.length}</span>
          <span className="spacer" />
          {page === 'sheet' ? (
            <>
              <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">↶ Undo</button>
              <button onClick={() => fileRef.current?.click()}>Import</button>
              <button onClick={onExport} disabled={!view.length} title="Download what's shown as a CSV file for Excel">Export to Excel</button>
              <button className="danger" onClick={onReset} disabled={!passes.length} title="Delete all passes and start fresh">Reset</button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImport} />
            </>
          ) : (
            <>
              <span className="muted">Group by</span>
              <div className="seg inline">
                {(['area', 'dept'] as const).map((b) => (
                  <button key={b} className={reportBy === b ? 'on' : ''} onClick={() => setReportBy(b)}>
                    {BY_LABEL[b]} → {BY_LABEL[b === 'area' ? 'dept' : 'area']}
                  </button>
                ))}
              </div>
              <button onClick={onExportReport} disabled={!view.length}>Export to Excel</button>
              <button onClick={() => window.print()} disabled={!view.length}>🖨 Print</button>
            </>
          )}
        </div>

        <main>
          {report ? (
            <Report report={report} caption={caption} />
          ) : (
            <>
              <Sheet
                view={view}
                total={passes.length}
                selection={selection}
                onEdit={onEdit}
                onPasteCells={onPasteCells}
                onPrinted={onPrinted}
                onSelect={onSelect}
                onSelectEnd={onSelectEnd}
              />
              <aside>
                <FillBox
                  key={`fill-${resetCount}`}
                  passes={passes}
                  range={range}
                  onRange={updateRange}
                  focusSignal={focusFill}
                  onFill={onFill}
                />
                <hr />
                <AddBox key={`add-${resetCount}`} passes={passes} onAdd={onAdd} />
                <hr />
                <PrintBox passes={passes} settings={printSettings} onSettings={setPrintSettings} onPreview={setPrinting} />
                <hr />
                <p className="muted small">
                  <b>Names &amp; details:</b> copy rows from Excel (Name, Dept, Area, Phone) and paste into the first <i>Name</i> cell. They fill down and across.
                </p>
                <p className="muted small">Everything saves automatically in this browser. Use <b>Export to Excel</b> now and then as a backup.</p>
              </aside>
            </>
          )}
        </main>
      </div>

      {printing && <PrintView passes={printing} settings={printSettings} onPrinted={onPrinted} onClose={closePrint} />}
      {Object.entries(suggestions).map(([id, list]) => (
        <datalist id={id} key={id}>{list.map((o) => <option key={o.value} value={o.value} label={o.label} />)}</datalist>
      ))}
      <div className={toast ? 'toast show' : 'toast'}>{toast}</div>
    </>
  );
}
