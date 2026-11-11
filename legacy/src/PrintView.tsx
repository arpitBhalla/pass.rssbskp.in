import { useEffect, useMemo, useState } from 'react';
import type { Pass, PrintSettings } from './types';
import { nPasses } from './lib/passes';
import { MobilePassCard } from './MobilePassCard';
import { PassCard } from './PassCard';
import './print.css';

export const PER_PAGE = 9; // 3 × 3 cards on A4

/**
 * Full-screen preview of the passes laid out on A4 pages, with a Print button.
 * When the print dialog closes the passes are ticked as printed (Undo if it was cancelled).
 */
export function PrintView({ passes, settings, onPrinted, onClose }: {
  passes: Pass[];
  settings: PrintSettings;
  onPrinted: (ids: string[], printed: boolean) => void;
  onClose: () => void;
}) {
  const [marked, setMarked] = useState(false);

  const pages = useMemo(() => {
    const out: Pass[][] = [];
    for (let i = 0; i < passes.length; i += PER_PAGE) out.push(passes.slice(i, i + PER_PAGE));
    return out;
  }, [passes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Fires after the print dialog closes, whether opened with the button or Ctrl/Cmd+P.
  useEffect(() => {
    const afterPrint = () => { onPrinted(passes.map((p) => p.id), true); setMarked(true); };
    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, [passes, onPrinted]);
  const unmark = () => { onPrinted(passes.map((p) => p.id), false); setMarked(false); };

  return (
    <div className="print-view">
      <div className="print-bar">
        <b>{nPasses(passes.length)} · {pages.length} A4 page{pages.length === 1 ? '' : 's'}</b>
        {marked ? (
          <>
            <span className="ok">✓ Marked as printed</span>
            <button onClick={unmark}>Didn’t print? Undo</button>
          </>
        ) : (
          <span className="muted small">In the print dialog: paper A4, scale 100%, turn off “Headers and footers”.</span>
        )}
        <span className="spacer" />
        <button className="primary" onClick={() => window.print()}>🖨 Print</button>
        <button onClick={onClose}>Close</button>
      </div>
      <div className="sheets">
        {pages.map((page, i) => (
          <div className="a4" key={i}>
            {page.map((p) => p.type === 'Mobile'
              ? <MobilePassCard key={p.id} p={p} s={settings} />
              : <PassCard key={p.id} p={p} s={settings} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
