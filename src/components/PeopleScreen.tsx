'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useAllPasses, useStatus } from '@/client/store';
import { byPhone, filterChoices, findDuplicates, hasValue, listPeople, matchesPerson, type PeopleBy, phoneKey } from '@/lib/people';
import { fmtSerial, type Pass, TYPE_INFO } from '@/shared/types';
import { ProfileCard } from './Profile';
import { input } from './ui';

const LIMIT = 300; // rows drawn at once: search to find the rest
const MAX_CHIPS = 6;
/** The dropdown filters: what each picks by, its name and its "anyone" choice. */
const BY: readonly [PeopleBy, string, string][] = [['incharge', 'Incharge', 'All incharges'], ['area', 'Area', 'All areas'], ['dept', 'Dept', 'All depts']];
const NONE: Record<PeopleBy, string> = { incharge: '', area: '', dept: '' };

/**
 * Everyone in the register: a person is a phone number (see people.ts), with every pass they hold on
 * every sheet. Search by name, phone or Reg. No.; click someone to see their passes and go to one.
 */
export function PeopleScreen() {
  const all = useAllPasses();
  const status = useStatus();
  const dupes = useMemo(() => findDuplicates(all), [all]);
  const phones = useMemo(() => byPhone(all), [all]);
  const people = useMemo(() => listPeople(phones, dupes), [phones, dupes]);
  const noPhone = useMemo(() => all.filter((p) => p.name && !phoneKey(p.phone)).length, [all]);

  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const [onlyBroken, setOnlyBroken] = useState(false);
  /** Only those with a pass under this Incharge, in this Area or Dept (the owner, 2026-11-24); '' is anyone. */
  const [picked, setPicked] = useState<Record<PeopleBy, string>>(NONE);
  const choices = useMemo(() => Object.fromEntries(BY.map(([k]) => [k, filterChoices(people, k)])) as Record<PeopleBy, ReturnType<typeof filterChoices>>, [people]);
  const shown = useMemo(
    () => people.filter((p) => (!onlyBroken || p.broken > 0) && BY.every(([k]) => hasValue(p, k, picked[k])) && matchesPerson(p, query)),
    [people, onlyBroken, picked, query],
  );
  const filtered = !!(query || onlyBroken || BY.some(([k]) => picked[k]));
  const several = people.filter((p) => p.passes.length > 1).length;
  const broken = people.filter((p) => p.broken > 0).length;

  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const router = useRouter();
  const goTo = useCallback((p: Pass) => router.push(`/s/${p.type}?q=${fmtSerial(p.serial)}`), [router]);

  const cell = 'border-b border-border px-2 py-1.5 align-top';
  return (
    <div className="min-w-0 flex-1 overflow-auto bg-background p-4">
      <h1 className="mb-1 font-condensed text-[20px] font-bold">People</h1>
      <p className="mb-3 text-[13.5px] text-muted-foreground">
        Everyone with a phone number on a pass: the same number on several passes is one person. Click someone to see all their passes.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          type="search" className={`${input} !w-72`} placeholder="Name, phone or Reg. No." aria-label="Search people"
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        {BY.map(([k, label, all]) => (
          <select key={k} className={`${input} !w-auto max-w-56`} aria-label={label} value={picked[k]} onChange={(e) => setPicked((f) => ({ ...f, [k]: e.target.value }))}>
            <option value="">{all}</option>
            {choices[k].map((c) => <option key={c.key} value={c.key}>{c.label} ({c.people})</option>)}
          </select>
        ))}
        {filtered && (
          <button className="text-[13.5px] font-semibold text-primary hover:underline" onClick={() => { setQ(''); setOnlyBroken(false); setPicked(NONE); }}>
            Clear
          </button>
        )}
        <label className="flex items-center gap-1.5 text-[14px]">
          <input type="checkbox" className="size-4 accent-primary" checked={onlyBroken} onChange={(e) => setOnlyBroken(e.target.checked)} />
          Only those breaking a rule
        </label>
        <span className="text-[14px] text-muted-foreground tabular-nums" aria-live="polite">
          {!status.loaded ? 'Loading…' : (
            <>
              <b className="font-semibold text-foreground">{people.length}</b> people, <b className="font-semibold text-foreground">{several}</b> with more than one pass
              {broken > 0 && <>, <b className="font-semibold text-red-700">{broken}</b> breaking a rule</>}
              {filtered && <>; {shown.length} shown</>}
            </>
          )}
        </span>
      </div>

      {status.loaded && shown.length === 0 && <p className="text-muted-foreground">{people.length ? 'No one matches that.' : 'No passes with a phone number yet.'}</p>}
      {shown.length > 0 && (
        <table className="w-full border-separate border-spacing-0 text-[15px]">
          <thead className="sticky -top-4 bg-panel text-left font-condensed text-[14.5px] text-foreground/70">
            <tr>
              <th className={cell}>Name</th><th className={cell}>Phone</th><th className={cell}>Area</th><th className={cell}>Dept</th>
              <th className={cell}>Passes</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, LIMIT).map((p) => (
              <tr key={p.key} className={`cursor-pointer hover:bg-muted/60 ${p.broken ? 'bg-red-50' : ''}`} onClick={() => setOpen(p.key)}>
                <td className={cell}>
                  <button className="text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(p.key); }}>{p.name || 'No name given'}</button>
                  {p.aka.length > 0 && <span className="block text-[13px] text-muted-foreground">also {p.aka.join(', ')}</span>}
                </td>
                <td className={`${cell} whitespace-nowrap tabular-nums`}>{p.phone}</td>
                <td className={cell}>{p.area}</td>
                <td className={cell}>{p.dept}</td>
                <td className={cell}>
                  <span className="flex flex-wrap gap-1">
                    {p.passes.slice(0, MAX_CHIPS).map((x) => (
                      <span
                        key={x.id} title={TYPE_INFO[x.type].label}
                        className={`rounded-[3px] border-l-[3px] bg-muted px-1.5 font-condensed text-[13.5px] tabular-nums ${dupes.has(x.id) ? 'font-semibold text-red-700' : ''}`}
                        style={{ borderLeftColor: TYPE_INFO[x.type].color.band }}
                      >
                        {TYPE_INFO[x.type].label} {fmtSerial(x.serial)}
                      </span>
                    ))}
                    {p.passes.length > MAX_CHIPS && <span className="text-[13.5px] text-muted-foreground">+{p.passes.length - MAX_CHIPS} more</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {shown.length > LIMIT && <p className="mt-2 text-[13.5px] text-muted-foreground">Showing the first {LIMIT} of {shown.length}: search to find someone else.</p>}
      {status.loaded && noPhone > 0 && (
        <p className="mt-3 text-[13.5px] text-muted-foreground">{noPhone} {noPhone === 1 ? 'pass has' : 'passes have'} a name but no full phone number, so {noPhone === 1 ? "it isn't" : "they aren't"} matched to anyone.</p>
      )}
      {open && <ProfileCard phone={open} passes={phones.get(open) ?? []} dupes={dupes} onJump={goTo} onClose={close} />}
    </div>
  );
}
