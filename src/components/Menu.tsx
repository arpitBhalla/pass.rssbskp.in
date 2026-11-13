'use client';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { btn } from './ui';

export interface MenuItem {
  label: string;
  /** One line under the label: what it does. */
  hint?: string;
  onSelect: () => void;
}

/** Open / closed state for a drop-down that closes on a click elsewhere or Escape. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const Chevron = () => (
  <svg aria-hidden width="10" height="6" viewBox="0 0 10 6" className="shrink-0"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
);
const panel = 'absolute top-full z-30 mt-1 rounded-[3px] border border-border bg-background shadow-[0_8px_28px_rgb(35_31_32/0.18)]';

/** A button that opens a short list of actions below it. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div ref={ref} className="relative">
      <button className={btn} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <Chevron />
      </button>
      {open && (
        <div role="menu" className={`${panel} right-0 w-72 py-1`}>
          {items.map((it) => (
            <button
              key={it.label} role="menuitem"
              className="block w-full px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              onClick={() => { setOpen(false); it.onSelect(); }}
            >
              <span className="block text-[14px] font-semibold">{it.label}</span>
              {it.hint && <span className="block text-[12.5px] leading-snug text-muted-foreground">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A button that opens a small box of controls below it. `active` marks it while it changes what's shown. */
export function Popover({ label, active, title, children }: { label: string; active?: boolean; title?: string; children: ReactNode }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div ref={ref} className="relative">
      <button
        className={`${btn} ${active ? '!border-primary/45 !bg-primary/[0.06] !text-primary' : '!font-normal text-foreground/80'}`}
        aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)}
      >
        {label}
        <Chevron />
      </button>
      {open && <div role="dialog" aria-label={title} className={`${panel} left-0 w-max p-3`}>{children}</div>}
    </div>
  );
}
