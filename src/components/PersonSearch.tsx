'use client';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useAllPasses, useStatus } from '@/client/store';
import { byPhone, findDuplicates, listPeople, matchesPerson, phoneLabel, SEARCH_IN, type SearchIn, withoutPhone } from '@/lib/people';
import { fmtSerial, type Pass } from '@/shared/types';
import { PassList, ProfileCard } from './Profile';
import { card, input } from './ui';

const LIMIT = 50; // people listed: type more to find someone else
const isFindKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k';
const onMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const never = () => () => {};

/** Tabs over a people search (the owner, 2026-11-24): All, or only the Person (name, phone), Centre, Incharge or Vehicle No. */
export function SearchTabs({ look, onLook }: { look: SearchIn; onLook: (l: SearchIn) => void }) {
  return (
    <span role="group" aria-label="Search in" className="inline-flex overflow-hidden rounded-[3px] border border-input">
      {SEARCH_IN.map(([k, name]) => (
        <button
          key={k} type="button" aria-pressed={k === look} onClick={() => onLook(k)}
          className={`h-8 px-3 text-[14px] font-semibold whitespace-nowrap ${k === look ? 'bg-foreground text-background' : 'bg-background hover:bg-panel'}`}
        >
          {name}
        </button>
      ))}
    </span>
  );
}

/**
 * Ctrl+K (⌘K on a Mac) on any page, or the header's Find person: search people as on the People page
 * (name, phone or Reg. No.) and open one to see all their passes; click a pass to go to it.
 */
export function PersonSearch() {
  const [open, setOpen] = useState(false);
  const mac = useSyncExternalStore(never, onMac, () => false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isFindKey(e)) return;
      e.preventDefault(); // the browser's own Ctrl+K goes to its address bar
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        className="flex items-center gap-2 rounded-[3px] px-2 py-1 text-[14px] text-white/75 hover:bg-white/10 hover:text-white"
        onClick={() => setOpen(true)} title="Find a person and see all their passes"
      >
        Find person
        <kbd className="rounded-[3px] bg-white/15 px-1.5 font-sans text-[12px] text-white/90">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {open && createPortal(<Finder onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Finder({ onClose }: { onClose: () => void }) {
  const all = useAllPasses();
  const { loaded } = useStatus();
  const dupes = useMemo(() => findDuplicates(all), [all]);
  // Everyone with a phone, and each pass with no full phone number on its own, so a search finds every pass.
  const phones = useMemo(() => new Map([...byPhone(all), ...withoutPhone(all)]), [all]);
  const people = useMemo(() => listPeople(phones, dupes), [phones, dupes]);

  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const [look, setLook] = useState<SearchIn>('all');
  const hint = SEARCH_IN.find(([k]) => k === look)![2];
  const field = useRef<HTMLInputElement>(null);
  const found = useMemo(() => (query.trim() ? people.filter((p) => matchesPerson(p, query, look)) : []), [people, query, look]);
  const shown = found.slice(0, LIMIT);
  const [at, setAt] = useState(0); // the highlighted row
  const sel = Math.min(at, shown.length - 1);
  const [person, setPerson] = useState<string | null>(null);

  // Closing goes back to where the cursor was (a cell on the sheet, say).
  const [before] = useState(() => document.activeElement);
  const close = () => {
    onClose();
    if (before instanceof HTMLElement && before.isConnected) before.focus();
  };
  const router = useRouter();
  const goTo = (p: Pass) => {
    onClose();
    router.push(`/s/${p.type}?q=${fmtSerial(p.serial)}`);
  };

  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { list.current?.children[sel]?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  // Keys stop here, so the sheet underneath doesn't act on them (Delete would empty its selected cells).
  // Esc on a person goes back to the list; Esc again, or Ctrl+K, closes.
  const box = useRef<HTMLDivElement>(null);
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    e.stopPropagation();
    if (isFindKey(e) || e.key === 'Escape') {
      e.preventDefault();
      if (person && e.key === 'Escape') setPerson(null);
      else close();
      return;
    }
    if (person) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) setAt((sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
    } else if (e.key === 'Enter' && shown[sel]) {
      e.preventDefault();
      setPerson(shown[sel].key);
    }
  });
  useEffect(() => {
    const el = box.current!;
    const listener = (e: KeyboardEvent) => onKey(e);
    el.addEventListener('keydown', listener);
    return () => el.removeEventListener('keydown', listener);
  }, []);

  return (
    <div ref={box} className="relative z-40 text-foreground print:hidden">
      {person ? (
        <ProfileCard phone={person} passes={phones.get(person) ?? []} dupes={dupes} onJump={goTo} onClose={() => setPerson(null)} />
      ) : (
        <div className="fixed inset-0 flex items-start justify-center bg-black/30 p-4 pt-[12vh]" onClick={close}>
          <div
            role="dialog" aria-modal aria-label="Find a person"
            className={`${card} flex max-h-[70vh] w-full max-w-4xl flex-col border-t-4 border-t-primary shadow-[0_12px_40px_rgb(35_31_32/0.25)]`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border p-3">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- opened to type in: Esc leaves it */}
              <input
                ref={field} type="search" autoFocus className={`${input} !h-10 !text-[16px]`} placeholder={hint}
                role="combobox" aria-expanded={shown.length > 0} aria-controls="find-person-list" aria-autocomplete="list"
                aria-activedescendant={shown[sel] ? `find-person-${shown[sel].key}` : undefined}
                value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }}
              />
              <div className="mt-2"><SearchTabs look={look} onLook={(l) => { setLook(l); setAt(0); field.current?.focus(); }} /></div>
            </div>
            {!query.trim() ? (
              <p className="px-4 py-3 text-[14px] text-muted-foreground">
                {loaded ? `Type: ${hint.toLowerCase()}. ↑ ↓ to pick, Enter to see their passes, Esc to close.` : 'Loading passes…'}
              </p>
            ) : !shown.length ? (
              <p className="px-4 py-3 text-[14px] text-muted-foreground">No one matches that.</p>
            ) : (
              <ul ref={list} id="find-person-list" role="listbox" aria-label="People" className="min-h-0 flex-1 overflow-auto py-1">
                {shown.map((p, i) => (
                  <li
                    key={p.key} id={`find-person-${p.key}`} role="option" aria-selected={i === sel}
                    className={`flex cursor-pointer items-start gap-3 px-4 py-2 ${i === sel ? 'bg-muted' : ''}`}
                    onMouseMove={() => i !== sel && setAt(i)} onClick={() => setPerson(p.key)}
                  >
                    <div className="w-60 shrink-0">
                      <span className={`block font-medium ${p.broken ? 'text-red-700' : ''}`}>{p.name || 'No name given'}</span>
                      <span className="block text-[13px] text-muted-foreground tabular-nums">{[phoneLabel(p.key, p.phone), p.area, p.dept].filter(Boolean).join(' · ')}</span>
                      {p.aka.length > 0 && <span className="block text-[13px] text-muted-foreground">also {p.aka.join(', ')}</span>}
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5"><PassList passes={p.passes} dupes={dupes} max={4} /></div>
                  </li>
                ))}
                {found.length > LIMIT && <li className="px-4 py-2 text-[13.5px] text-muted-foreground">{found.length - LIMIT} more: type more to find them.</li>}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
