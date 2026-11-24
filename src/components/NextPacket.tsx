'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useActions } from '@/client/actions';
import { packetName, packetScan } from '@/client/packetScan';
import { useAllPasses } from '@/client/store';
import { canPack, handOverOps, noteOn, packetsOf, packOps, suggestTag } from '@/lib/packets';
import { cardsLabel, nPasses } from '@/lib/passes';
import { cleanField, cleanPacket, fmtSerial, MAX_PACKET, type Pass, TYPE_INFO } from '@/shared/types';
import { PassMark, useMe } from './AppShell';
import { GivenIcon, PacketIcon } from './icons';
import { btnPrimary, input } from './ui';

const keyOf = (x: { type: string; serial: number }) => `${x.type}:${x.serial}`;
const passName = (p: Pass) => `${TYPE_INFO[p.type].label} ${fmtSerial(p.serial)}`;

/** The passes in the next packet in the order added (those still in the register), and those no longer in it. */
export function useNextPacket() {
  const all = useAllPasses();
  const items = packetScan.use();
  const byKey = useMemo(() => new Map(all.map((p) => [keyOf(p), p])), [all]);
  const list = useMemo(() => items.flatMap((x) => byKey.get(keyOf(x)) ?? []), [items, byKey]);
  const gone = useMemo(() => items.filter((x) => !byKey.has(keyOf(x))), [items, byKey]);
  return { all, list, gone };
}

/**
 * The next packet (the owner, 2026-11-24): its passes, each with ×; then either tag them as a packet (the name offered from their
 * Area and Incharge), or hand them straight over with no packet: Issued To filled in and Given ticked on them all (scanned at the
 * end, just before handing over). On the Packets page, and in the Next packet box on every other page.
 */
export function NextPacket({ onDone, listClass = 'max-h-[45vh]' }: { onDone?: () => void; listClass?: string }) {
  const { all, list, gone } = useNextPacket();
  const { apply } = useActions();
  const name = packetName.use();
  const packets = useMemo(() => packetsOf(all), [all]);
  const offered = useMemo(() => suggestTag(list, packets, all), [list, packets, all]);
  const tag = cleanPacket(name) || offered;
  const joins = packets.find((k) => k.tag === tag);
  const ops = packOps(list, tag);
  const ready = list.filter(canPack);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const finish = () => { packetScan.clear(); packetName.set(''); setTo(''); onDone?.(); };

  const onTag = async () => {
    setBusy(true);
    const r = await apply(
      { action: 'pack', summary: `Packet ${tag}: ${cardsLabel(list)}`, set: ops },
      { toast: `Packet ${tag} tagged: ${nPasses(ops.length)}. Hand it over on the Packets page.` },
    );
    setBusy(false);
    if (r) finish();
  };
  const onHandOver = async (e: FormEvent) => {
    e.preventDefault();
    const who = cleanField('issued_to', to);
    if (busy || !who || !ready.length) return;
    setBusy(true);
    const r = await apply(
      { action: 'given', summary: `Handed over to ${who}, no packet: ${cardsLabel(ready)}`, set: handOverOps(ready, who) },
      { toast: `Handed over to ${who}: ${nPasses(ready.length)}, Given ticked.` },
    );
    setBusy(false);
    if (r) finish();
  };

  return (
    <div className="space-y-3">
      {list.length === 0 ? (
        <p className="rounded-[3px] border border-dashed border-input px-3 py-4 text-center text-[13.5px] text-muted-foreground">
          Only printed passes not given yet go in. Scan them, select rows in a sheet and use <b className="font-semibold">Add to packet</b>,
          or <b className="font-semibold">+ Add</b> on a pass in People.
        </p>
      ) : (
        <ol className={`${listClass} divide-y divide-border overflow-auto rounded-[3px] border border-border`}>
          {list.map((p, i) => {
            const why = noteOn(p, tag);
            return (
              <li key={p.id} className={`flex flex-wrap items-center gap-x-2 px-2 py-1.5 ${why ? 'bg-amber-50' : ''}`}>
                <span className="w-5 text-right text-[13px] text-muted-foreground tabular-nums">{i + 1}</span>
                <PassMark type={p.type} />
                <span className="whitespace-nowrap text-[14px] font-semibold">{passName(p)}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px]" title={[p.name, p.vehicle_no, p.incharge].filter(Boolean).join(', ')}>
                  {p.name}{p.vehicle_no && <span className="text-muted-foreground"> {p.vehicle_no}</span>}
                </span>
                <button className="px-1 text-[16px] leading-none text-muted-foreground hover:text-destructive" onClick={() => packetScan.remove([p])} title="Take it out of the list" aria-label={`Remove ${passName(p)}`}>
                  ×
                </button>
                {why && <span className="basis-full pl-7 text-[13px] text-amber-900">{why}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {gone.length > 0 && (
        <p className="text-[13.5px] text-red-700">
          {nPasses(gone.length)} in the list {gone.length === 1 ? 'is' : 'are'} no longer in the register.{' '}
          <button className="font-semibold text-primary hover:underline" onClick={() => packetScan.remove(gone)}>Remove {gone.length === 1 ? 'it' : 'them'}</button>
        </p>
      )}
      {list.length > 0 && (
        <>
          <div className="space-y-1.5 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-[14px] font-semibold">
              <PacketIcon size={14} />Packet
              <input
                className={`${input} !w-auto min-w-0 flex-1`} maxLength={MAX_PACKET} placeholder={offered} aria-label="Packet name" list="packet-tags"
                value={name} onChange={(e) => packetName.set(e.target.value)}
              />
            </label>
            {joins && (
              <p className="text-[13px] text-muted-foreground">
                Packet {tag} has {nPasses(joins.passes.length)} already{joins.given ? `, ${joins.given} given` : ''}: these join it.
              </p>
            )}
            <div className="flex items-center gap-3">
              <button className={`${btnPrimary} min-w-0 flex-1`} disabled={busy || !ops.length} onClick={onTag}>
                <span className="truncate">{ops.length ? `Tag ${nPasses(ops.length)} as ${tag}` : `All in packet ${tag} already`}</span>
              </button>
              <button className="text-[13.5px] font-semibold text-primary hover:underline" onClick={() => { packetScan.clear(); packetName.set(''); }}>Clear</button>
            </div>
          </div>
          <form onSubmit={onHandOver} className="space-y-1.5 border-t border-border pt-3">
            <span className="flex items-center gap-1.5 text-[14px] font-semibold"><GivenIcon size={14} />Or hand over now, no packet</span>
            <div className="flex items-center gap-2">
              <input className={`${input} min-w-0 flex-1`} placeholder="Issued To" aria-label="Hand over to" value={to} onChange={(e) => setTo(e.target.value)} />
              <button type="submit" className={btnPrimary} disabled={busy || !to.trim() || !ready.length}>
                Hand over {ready.length}
              </button>
            </div>
          </form>
          <datalist id="packet-tags">{packets.map((k) => <option key={k.tag} value={k.tag} />)}</datalist>
        </>
      )}
    </div>
  );
}

/**
 * The Next packet box, docked bottom right on every page but Packets (the owner, 2026-11-24): how many passes are in the next packet;
 * open it to see them, tag them or hand them over. Shown once a pass is in it.
 */
export function PacketTray() {
  const path = usePathname();
  const me = useMe();
  const { list, gone } = useNextPacket();
  const n = list.length + gone.length;
  const [open, setOpen] = useState(false);
  // Opens by itself when a pass is added (not when one is taken out).
  const was = useRef(n);
  useEffect(() => {
    if (n > was.current) setOpen(true);
    was.current = n;
  }, [n]);
  if (me.scan_only || path === '/packets' || !n) return null;
  return (
    <section
      aria-label="Next packet"
      className="fixed right-4 bottom-0 z-40 flex max-h-[80vh] w-[25rem] flex-col rounded-t-[4px] border border-b-0 border-border bg-background shadow-[0_-4px_24px_rgb(35_31_32/0.18)] print:hidden max-md:inset-x-0 max-md:w-auto"
    >
      <button
        className="flex h-10 shrink-0 items-center gap-2 rounded-t-[4px] border-t-[3px] border-t-primary px-3 text-left hover:bg-muted/60"
        onClick={() => setOpen((x) => !x)} aria-expanded={open}
      >
        <PacketIcon size={15} />
        <span className="font-condensed text-[16px] font-bold">Next packet</span>
        <span className="rounded-full bg-primary px-1.5 text-[12.5px] leading-[18px] font-semibold text-white tabular-nums">{n}</span>
        <span className="ml-auto text-[13px] text-muted-foreground">{open ? 'Hide ▾' : 'Show ▴'}</span>
      </button>
      {open && (
        <div className="min-h-0 overflow-auto border-t border-border p-3">
          <NextPacket listClass="max-h-[35vh]" />
          <Link href="/packets" className="mt-3 block text-[13.5px] font-semibold text-primary hover:underline">Scan more on the Packets page →</Link>
        </div>
      )}
    </section>
  );
}

/**
 * A pass's packet: its tag, or + Add to put it in the next packet (a printed pass not given yet), ✓ Next packet to take it out
 * (the owner, 2026-11-24). On People, Find person and a person's card.
 */
export function PacketCell({ p, none = '' }: { p: Pass; none?: string }) {
  const items = packetScan.use();
  const me = useMe();
  if (p.packet) {
    return <span className="flex min-w-0 items-center gap-1 text-amber-800" title={`In packet ${p.packet}`}><PacketIcon size={13} /><span className="truncate">{p.packet}</span></span>;
  }
  if (me.scan_only || !canPack(p)) return <span className="text-muted-foreground">{none}</span>;
  const inList = items.some((x) => x.type === p.type && x.serial === p.serial);
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (inList) packetScan.remove([p]);
    else packetScan.add([p]);
  };
  return (
    <button
      className={`flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold hover:underline ${inList ? 'text-emerald-700' : 'text-primary'}`}
      title={inList ? 'In the next packet (bottom right): click to take it out' : 'Put it in the next packet (bottom right)'}
      onClick={onClick} onMouseDown={(e) => e.stopPropagation()}
    >
      <PacketIcon size={13} />{inList ? '✓ Next packet' : '+ Add'}
    </button>
  );
}
