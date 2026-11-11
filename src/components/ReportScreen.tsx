'use client';
import { Fragment, useMemo, useState } from 'react';
import { useAllPasses } from '@/client/store';
import { isGiven } from '@/lib/passes';
import { BY_LABEL, buildReport, type ReportBy, reportCSV } from '@/lib/report';
import { PASS_TYPES, TYPE_INFO } from '@/shared/types';
import { PassMark } from './AppShell';
import { btn, heading } from './ui';

/** Given passes counted per sheet, by Area then Dept (or Dept then Area). Prints on A4. */
export function ReportScreen() {
  const all = useAllPasses();
  const [by, setBy] = useState<ReportBy>('area');
  const [onlyGiven, setOnlyGiven] = useState(true);
  const [today] = useState(() => new Date().toLocaleDateString());
  const report = useMemo(() => buildReport(onlyGiven ? all.filter(isGiven) : all, by), [all, by, onlyGiven]);

  const download = () => {
    const blob = new Blob([reportCSV(report)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pass-report-by-${by}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const n = (v: number) => (v ? v : <span className="text-muted-foreground/40">–</span>);
  const cell = 'border-b border-rule px-2 py-1';

  return (
    <div className="report-page min-w-0 flex-1 overflow-auto bg-background p-4 print:overflow-visible print:p-0">
      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <h1 className={`${heading} !text-[20px]`}>Report</h1>
        <div className="flex overflow-hidden rounded-[3px] border border-input">
          {(['area', 'dept'] as ReportBy[]).map((b) => (
            <button key={b} onClick={() => setBy(b)} className={`h-8 px-3 text-[13.5px] font-semibold ${by === b ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              By {BY_LABEL[b]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" className="accent-primary" checked={onlyGiven} onChange={(e) => setOnlyGiven(e.target.checked)} /> Only given passes
        </label>
        <span className="flex-1" />
        <button className={btn} onClick={download}>Export CSV</button>
        <button className={btn} onClick={() => window.print()}>Print</button>
      </div>
      <h2 className="mb-2 hidden font-condensed text-[18px] font-bold print:block">
        Pass report by {BY_LABEL[by]}, {today}
      </h2>

      <table className="w-full border-separate border-spacing-0 text-[14px]">
        <thead className="sticky top-0 bg-panel text-left font-condensed text-[14.5px] text-foreground/70 print:static">
          <tr>
            <th className={cell}>{BY_LABEL[by]}</th>
            <th className={cell}>{BY_LABEL[by === 'area' ? 'dept' : 'area']}</th>
            {PASS_TYPES.map((t) => (
              <th key={t} className={`${cell} text-right`} title={TYPE_INFO[t].label}>
                <span className="inline-flex items-center gap-1"><PassMark type={t} size={11} />{TYPE_INFO[t].short}</span>
              </th>
            ))}
            <th className={`${cell} text-right`}>Total</th>
            <th className={cell}>Serial nos.</th>
            <th className={cell}>Incharges</th>
          </tr>
        </thead>
        <tbody>
          {report.groups.map((g) => (
            <Fragment key={g.label}>
              {g.lines.map((l, i) => (
                <tr key={l.label} className="break-inside-avoid align-top">
                  <td className={`${cell} font-semibold`}>{i === 0 ? g.label : ''}</td>
                  <td className={cell}>{l.label}</td>
                  {PASS_TYPES.map((t) => <td key={t} className={`${cell} text-right tabular-nums`}>{n(l.counts[t])}</td>)}
                  <td className={`${cell} text-right font-semibold tabular-nums`}>{l.total}</td>
                  <td className={`${cell} font-condensed text-[13px] tabular-nums`}>{l.serials}</td>
                  <td className={`${cell} text-xs`}>{l.incharges}</td>
                </tr>
              ))}
              {g.lines.length > 1 && (
                <tr className="bg-sand-50 font-semibold">
                  <td className={cell} />
                  <td className={`${cell} text-xs text-muted-foreground`}>{g.label} total</td>
                  {PASS_TYPES.map((t) => <td key={t} className={`${cell} text-right tabular-nums`}>{n(g.counts[t])}</td>)}
                  <td className={`${cell} text-right tabular-nums`}>{g.total}</td>
                  <td className={cell} colSpan={2} />
                </tr>
              )}
            </Fragment>
          ))}
          <tr className="bg-muted font-bold">
            <td className={cell} colSpan={2}>Total</td>
            {PASS_TYPES.map((t) => <td key={t} className={`${cell} text-right tabular-nums`}>{report.total.counts[t]}</td>)}
            <td className={`${cell} text-right tabular-nums`}>{report.total.total}</td>
            <td className={cell} colSpan={2} />
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        {PASS_TYPES.map((t) => `${TYPE_INFO[t].short} ${TYPE_INFO[t].label}`).join(', ')}
      </p>
    </div>
  );
}
