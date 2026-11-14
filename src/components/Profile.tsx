'use client';
import { useEffect } from 'react';
import { isGiven, isPrinted } from '@/lib/passes';
import { type Duplicate, profileOf } from '@/lib/people';
import { fmtSerial, type Pass, TYPE_INFO } from '@/shared/types';
import { btn, card } from './ui';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const th = 'border-b border-rule px-2 py-1.5 text-left font-condensed text-[14px] font-semibold text-foreground/70';
const td = 'border-b border-rule px-2 py-1.5 align-top';

/**
 * Everyone with this phone number is one person: every pass they hold, on every sheet, worked out from
 * the register. A pass that breaks a rule says which. Click a pass to go to it.
 */
export function ProfileCard({ phone, passes, dupes, onJump, onClose }: {
  phone: string; passes: Pass[]; dupes: ReadonlyMap<number, Duplicate[]>; onJump: (p: Pass) => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const profile = profileOf(passes, phone);
  if (!profile) return null;
  const broken = profile.passes.filter((p) => dupes.has(p.id)).length;
  const about = [profile.phone, profile.area, profile.dept].filter(Boolean).join(', ');

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4 print:hidden" onClick={onClose}>
      <div
        role="dialog" aria-modal aria-labelledby="profile-name"
        className={`${card} max-h-[85vh] w-full max-w-4xl overflow-auto border-t-4 border-t-primary p-5 shadow-[0_12px_40px_rgb(35_31_32/0.25)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 id="profile-name" className="font-condensed text-[22px] leading-tight font-bold">{profile.name || 'No name given'}</h2>
            <p className="text-[14.5px] text-muted-foreground tabular-nums">{about}</p>
            {profile.aka.length > 0 && <p className="text-[13.5px] text-muted-foreground">Also written {profile.aka.map((n) => `"${n}"`).join(', ')}</p>}
          </div>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- a dialog: Esc or Close leaves it */}
          <button className={btn} autoFocus onClick={onClose}>Close</button>
        </div>
        <p className="mt-3 mb-1.5 text-[14px]">
          Holds <b>{profile.passes.length} {profile.passes.length === 1 ? 'pass' : 'passes'}</b>
          {broken > 0 && <span className="font-semibold text-red-700">, {broken} breaking a rule</span>}
          <span className="text-muted-foreground">. Click one to go to it.</span>
        </p>
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={th}>Sheet</th><th className={th}>Sr. No.</th><th className={th}>Name</th><th className={th}>Vehicle</th>
              <th className={th}>Incharge / Referred by</th><th className={th}>Printed</th><th className={th}>Given</th><th className={th}>Issued to</th>
            </tr>
          </thead>
          <tbody>
            {profile.passes.map((p) => {
              const notes = [...new Set((dupes.get(p.id) ?? []).map((d) => d.rule.text))];
              return (
                <tr key={p.id} className={`cursor-pointer hover:bg-muted/60 ${notes.length ? 'bg-red-50' : ''}`} onClick={() => onJump(p)}>
                  <td className={`${td} whitespace-nowrap`}>
                    <span aria-hidden className="mr-1.5 inline-block size-2.5 rounded-[2px] align-[0px]" style={{ background: TYPE_INFO[p.type].color.band }} />
                    {TYPE_INFO[p.type].label}
                  </td>
                  <td className={td}>
                    <button className="font-condensed text-[15px] font-semibold tabular-nums text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onJump(p); }}>
                      {fmtSerial(p.serial)}
                    </button>
                  </td>
                  <td className={td}>
                    <span className="font-medium">{p.name}</span>
                    {notes.map((n) => <span key={n} className="block text-[13px] font-semibold text-red-700">{n}</span>)}
                  </td>
                  <td className={`${td} tabular-nums`}>{[p.vehicle, p.vehicle_no].filter(Boolean).join(' ')}</td>
                  <td className={td}>{p.incharge}</td>
                  <td className={`${td} whitespace-nowrap`}>{isPrinted(p) ? day(p.printed_at) : <span className="text-muted-foreground">No</span>}</td>
                  <td className={`${td} whitespace-nowrap`}>{isGiven(p) ? day(p.given_at) : <span className="text-muted-foreground">No</span>}</td>
                  <td className={td}>{p.issued_to}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
