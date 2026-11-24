'use client';
import { Fragment, type ReactNode, useEffect, useState } from 'react';
import { useLost } from '@/client/lost';
import { useAllPasses } from '@/client/store';
import { useUserNames } from '@/client/users';
import { isGiven, isLost, isPrinted, planLost } from '@/lib/passes';
import { type Duplicate, isPhoneless, phoneLabel, profileOf } from '@/lib/people';
import { fmtSerial, type Pass, TYPE_INFO } from '@/shared/types';
import { GivenIcon, PacketIcon, PrinterIcon } from './icons';
import { PacketCell } from './NextPacket';
import { btn, btnDanger, card } from './ui';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const th = 'border-b border-rule px-2 py-1.5 text-left font-condensed text-[14px] font-semibold text-foreground/70';
const td = 'border-b border-rule px-2 py-1.5 align-top';

/** The columns of a person's passes, the same on every row so they line up: pass, printed, given, packet. */
const passGrid = 'grid grid-cols-[10.5rem_8.5rem_8.5rem_minmax(0,1fr)] items-center gap-x-3';

/** A date with its icon (printed, given) and who did it, or a dash when not yet. */
function Stamp({ icon, at, who, cls, title }: { icon: ReactNode; at: string | null; who: string; cls: string; title: string }) {
  return at
    ? <span className={`flex min-w-0 items-center gap-1 whitespace-nowrap ${cls}`} title={title}>{icon}{day(at)}{who && <span className="truncate text-foreground/55">· {who}</span>}</span>
    : <span className="flex items-center gap-1 text-foreground/25" title={title}>{icon}–</span>;
}

/** The heading over a person's passes: Pass, Printed, Given, Packet, with their icons. */
export function PassListHead() {
  return (
    <span className={`${passGrid} font-condensed`}>
      <span>Passes</span>
      <span className="flex items-center gap-1"><PrinterIcon size={13} />Printed</span>
      <span className="flex items-center gap-1"><GivenIcon size={13} />Given</span>
      <span className="flex items-center gap-1"><PacketIcon size={13} />Packet</span>
    </span>
  );
}

/**
 * A person's passes, one a row (the owner, 2026-11-24): the pass in its sheet's colour (red if it breaks a rule), when it was
 * printed and given, and its packet; the first few.
 */
export function PassList({ passes, dupes, max = 6 }: { passes: readonly Pass[]; dupes: ReadonlyMap<number, unknown>; max?: number }) {
  const names = useUserNames();
  const who = (id: number | null) => (id === null ? '' : names.get(id) ?? '');
  const by = (id: number | null) => (who(id) ? ` by ${who(id)}` : '');
  return (
    <span className={`${passGrid} gap-y-0.5 font-condensed text-[14px] tabular-nums`}>
      {passes.slice(0, max).map((x) => (
        <Fragment key={x.id}>
          <span
            className={`truncate border-l-[3px] pl-1.5 ${dupes.has(x.id) ? 'font-semibold text-red-700' : ''}`}
            style={{ borderLeftColor: TYPE_INFO[x.type].color.band }}
          >
            {TYPE_INFO[x.type].label} {fmtSerial(x.serial)}
          </span>
          <Stamp
            icon={<PrinterIcon size={13} />} at={isPrinted(x) ? x.printed_at : null} who={who(x.printed_by)} cls="text-foreground/80"
            title={isPrinted(x) ? `Printed ${when(x.printed_at)}${by(x.printed_by)}` : 'Not printed yet'}
          />
          <Stamp
            icon={<GivenIcon size={13} />} at={isGiven(x) ? x.given_at : null} who={who(x.given_by)} cls="text-emerald-700"
            title={isGiven(x) ? `Given ${when(x.given_at)}${by(x.given_by)}${x.issued_to ? ` to ${x.issued_to}` : ''}` : 'Not given yet'}
          />
          <PacketCell p={x} />
        </Fragment>
      ))}
      {passes.length > max && <span className="col-span-4 text-[13.5px] text-muted-foreground">+{passes.length - max} more</span>}
    </span>
  );
}

/**
 * Everyone with this phone number is one person: every pass they hold, on every sheet, worked out from
 * the register. A pass that breaks a rule says which. Click a pass to go to it.
 */
export function ProfileCard({ phone, passes, dupes, onJump, onClose, same }: {
  phone: string; passes: Pass[]; dupes: ReadonlyMap<number, Duplicate[]>; onJump: (p: Pass) => void; onClose: () => void;
  /** Not a person: the passes sharing a phone or Reg. No. (a red cell clicked), with its own heading, and each pass's phone. */
  same?: { title: string; about: string; holds: string };
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const names = useUserNames();
  const all = useAllPasses();
  const { markLost } = useLost();
  const [losing, setLosing] = useState<number | null>(null); // the pass whose Mark lost is being confirmed
  const profile = profileOf(passes, phone);
  if (!profile) return null;
  /** Marking one pass lost: its sheet's plan (the duplicate goes at the end of that sheet). */
  const lostPlan = (p: Pass) => planLost(all.filter((x) => x.type === p.type), p.type, fmtSerial(p.serial), fmtSerial(p.serial));
  const who = (id: number | null) => (id !== null && names.get(id) ? <span className="block text-[13px] text-muted-foreground">by {names.get(id)}</span> : null);
  const broken = profile.passes.filter((p) => dupes.has(p.id)).length;
  const about = [phoneLabel(phone, profile.phone), profile.area, profile.dept].filter(Boolean).join(', ');

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4 print:hidden" onClick={onClose}>
      <div
        role="dialog" aria-modal aria-labelledby="profile-name"
        className={`${card} max-h-[85vh] w-full max-w-5xl overflow-auto border-t-4 border-t-primary p-5 shadow-[0_12px_40px_rgb(35_31_32/0.25)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 id="profile-name" className="font-condensed text-[22px] leading-tight font-bold tabular-nums">{same?.title ?? (profile.name || 'No name given')}</h2>
            <p className={`text-[14.5px] tabular-nums ${same ? 'font-semibold text-red-700' : 'text-muted-foreground'}`}>{same?.about ?? about}</p>
            {!same && profile.aka.length > 0 && <p className="text-[13.5px] text-muted-foreground">Also written {profile.aka.map((n) => `"${n}"`).join(', ')}</p>}
          </div>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- a dialog: Esc or Close leaves it */}
          <button className={btn} autoFocus onClick={onClose}>Close</button>
        </div>
        <p className="mt-3 mb-1.5 text-[14px]">
          {same ? <b>{same.holds}</b> : <>Holds <b>{profile.passes.length} {profile.passes.length === 1 ? 'pass' : 'passes'}</b></>}
          {!same && broken > 0 && <span className="font-semibold text-red-700">, {broken} breaking a rule</span>}
          {!same && isPhoneless(phone) && <span className="text-muted-foreground">. With no full phone number it isn&apos;t matched to their other passes</span>}
          <span className="text-muted-foreground">. Click one to go to it.</span>
        </p>
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={th}>Sheet</th><th className={th}>Sr. No.</th><th className={th}>Name</th>{same && <th className={th}>Phone</th>}<th className={th}>Vehicle</th>
              <th className={th}>Incharge / Referred by</th><th className={th}><span className="flex items-center gap-1"><PrinterIcon size={13} />Printed</span></th>
              <th className={th}><span className="flex items-center gap-1"><GivenIcon size={13} />Given</span></th>
              <th className={th}>Issued to</th>
              <th className={th}><span className="flex items-center gap-1"><PacketIcon size={13} />Packet</span></th>
              <th className={th}><span className="sr-only">Lost</span></th>
            </tr>
          </thead>
          <tbody>
            {profile.passes.map((p) => {
              const notes = [...new Set((dupes.get(p.id) ?? []).map((d) => d.rule.text))];
              const plan = losing === p.id ? lostPlan(p) : null;
              return (
                <Fragment key={p.id}>
                <tr className={`cursor-pointer hover:bg-muted/60 ${notes.length ? 'bg-red-50' : ''}`} onClick={() => onJump(p)}>
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
                    {!same && notes.map((n) => <span key={n} className="block text-[13px] font-semibold text-red-700">{n}</span>)}
                  </td>
                  {same && <td className={`${td} whitespace-nowrap tabular-nums`}>{p.phone}</td>}
                  <td className={`${td} tabular-nums`}>{[p.vehicle, p.vehicle_no].filter(Boolean).join(' ')}</td>
                  <td className={td}>{p.incharge}</td>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{isPrinted(p) ? <>{when(p.printed_at)}{who(p.printed_by)}</> : <span className="text-muted-foreground">No</span>}</td>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{isGiven(p) ? <>{when(p.given_at)}{who(p.given_by)}</> : <span className="text-muted-foreground">No</span>}</td>
                  <td className={td}>{p.issued_to}</td>
                  <td className={`${td} whitespace-nowrap`}><PacketCell p={p} none="–" /></td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {isPrinted(p) && !isLost(p) && (
                      <button
                        className="text-[13px] font-semibold text-destructive hover:underline" title="Stolen or lost after printing: mark it LOST (the gate check refuses it)"
                        onClick={(e) => { e.stopPropagation(); setLosing(losing === p.id ? null : p.id); }}
                      >
                        Mark lost
                      </button>
                    )}
                  </td>
                </tr>
                {plan && plan.set.length > 0 && (
                  <tr role="alertdialog" aria-label={`Confirm ${TYPE_INFO[p.type].label} ${fmtSerial(p.serial)} lost`} className="bg-red-50">
                    <td colSpan={11} className={`${td} !py-2.5`}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <p className="min-w-0 flex-1 basis-80 leading-snug">
                          Mark <b>{TYPE_INFO[p.type].label} {fmtSerial(p.serial)}</b> LOST? It stays in the register, locked, and the gate check shows LOST.{' '}
                          <b>Add a duplicate</b> with the same details, as <b>{fmtSerial(plan.to[0])}</b>, to print and hand over? <b>Undo</b> takes it back.
                        </p>
                        <button className={btn} onClick={() => setLosing(null)}>Cancel</button>
                        <button className={btnDanger} onClick={() => { setLosing(null); void markLost(p.type, plan, false); }}>Lost, no duplicate</button>
                        <button className={`${btnDanger} !border-destructive !bg-destructive !text-white`} onClick={() => { setLosing(null); void markLost(p.type, plan, true); }}>
                          Lost + add duplicate
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
