'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useActions } from '@/client/actions';
import { openPacket, packetName, packetScan, tray } from '@/client/packetScan';
import { useScannerCatch } from '@/client/scanner';
import { useUserNames } from '@/client/users';
import { useAllPasses } from '@/client/store';
import { canPack, handOverOps, noteOn, type Packet, packetsOf, packOps, retagOps, scanOf, suggestTag } from '@/lib/packets';
import { cardsLabel, isGiven, isPrinted, nPasses } from '@/lib/passes';
import { cleanField, cleanPacket, fmtSerial, MAX_PACKET, type Pass, TYPE_INFO } from '@/shared/types';
import { PassMark, useMe } from './AppShell';
import { GivenIcon, PacketIcon } from './icons';
import { beep } from './LiveScan';
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
  const finish = () => { packetScan.clear(); packetName.set(''); setTo(''); tray.set({ ...tray.get(), scan: undefined }); onDone?.(); };
  const scan = tray.use().scan;
  const marked = useRef<HTMLLIElement>(null);
  useEffect(() => { marked.current?.scrollIntoView({ block: 'nearest' }); }, [scan]);

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
      {scan && (
        <p aria-live="polite" className={`rounded-[3px] px-2.5 py-1.5 text-[14px] font-semibold ${scan.bad ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
          {scan.bad ? '✕ ' : '✓ '}{scan.text}
        </p>
      )}
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
              <li
                key={p.id} ref={p.id === scan?.id ? marked : undefined}
                className={`flex flex-wrap items-center gap-x-2 px-2 py-1.5 ${p.id === scan?.id ? 'bg-emerald-50 shadow-[inset_3px_0_0] shadow-emerald-600' : why ? 'bg-amber-50' : ''}`}
              >
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
 * open it to see them, tag them or hand them over. Shown once a pass is in it, or a packet is opened (its mark in a sheet clicked):
 * then that packet.
 */
export function PacketTray() {
  const path = usePathname();
  const me = useMe();
  const { all, list, gone } = useNextPacket();
  const n = list.length + gone.length;
  const view = tray.use();
  const packets = useMemo(() => packetsOf(all), [all]);
  const k = view.packet ? packets.find((x) => x.tag === view.packet) : undefined;
  // Opens by itself on the next packet when a pass is added to it (not when one is taken out).
  const was = useRef(n);
  useEffect(() => {
    if (n > was.current) {
      const v = tray.get();
      tray.set(v.hold ? { ...v, hold: false } : { ...v, open: true, packet: '' });
    }
    was.current = n;
  }, [n]);
  // Shown while it holds passes, a packet is opened, or a scan that didn't go in says why.
  if (me.scan_only || (!n && !k && !view.scan?.bad)) return null;
  const open = view.open;
  const toggle = () => tray.set({ ...view, open: !open });
  return (
    <section
      aria-label={k ? `Packet ${k.tag}` : 'Next packet'}
      className="fixed right-4 bottom-0 z-40 flex max-h-[80vh] w-[25rem] flex-col rounded-t-[4px] border border-b-0 border-border bg-background shadow-[0_-4px_24px_rgb(35_31_32/0.18)] print:hidden max-md:inset-x-0 max-md:w-auto"
    >
      <div className={`flex h-10 shrink-0 items-center gap-2 rounded-t-[4px] border-t-[3px] pr-1 ${k ? 'border-t-amber-500' : 'border-t-primary'}`}>
        <button className="flex h-full min-w-0 flex-1 items-center gap-2 pl-3 text-left hover:bg-muted/60" onClick={toggle} aria-expanded={open}>
          <span className={k ? 'text-amber-700' : ''}><PacketIcon size={15} /></span>
          <span className="truncate font-condensed text-[16px] font-bold">{k ? `Packet ${k.tag}` : 'Next packet'}</span>
          <span className={`rounded-full px-1.5 text-[12.5px] leading-[18px] font-semibold text-white tabular-nums ${k ? 'bg-amber-600' : 'bg-primary'}`}>{k ? k.passes.length : n}</span>
          <span className="ml-auto shrink-0 pr-1 text-[13px] text-muted-foreground">{open ? 'Hide ▾' : 'Show ▴'}</span>
        </button>
        {!k && !n && (
          <button className="h-8 shrink-0 rounded-[3px] px-2 text-[13px] font-semibold text-primary hover:bg-muted" onClick={() => tray.set({ open: false, packet: '' })} title="Close">
            ✕
          </button>
        )}
        {k && (
          <button
            className="h-8 shrink-0 rounded-[3px] px-2 text-[13px] font-semibold text-primary hover:bg-muted" onClick={() => tray.set({ open: n > 0, packet: '' })}
            title={n ? 'Back to the next packet' : 'Close'}
          >
            {n ? `← Next packet ${n}` : '✕'}
          </button>
        )}
      </div>
      {open && (
        <div className="min-h-0 overflow-auto border-t border-border p-3">
          {k ? <PacketView k={k} packets={packets} /> : (
            <>
              <NextPacket listClass="max-h-[35vh]" />
              {path !== '/packets' && <Link href="/packets" className="mt-3 block text-[13.5px] font-semibold text-primary hover:underline">Scan with the camera on the Packets page →</Link>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A packet in the box (the owner, 2026-11-24): its passes (click one to go to it, × takes it out of the packet), whether it is handed
 * over, Hand over, + Add more (the next packet, named this one), Rename / move.
 */
function PacketView({ k, packets }: { k: Packet; packets: readonly Packet[] }) {
  const { apply } = useActions();
  const names = useUserNames();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const left = k.passes.filter((p) => !isGiven(p) && p.lost_at === null);
  const unprinted = left.filter((p) => !isPrinted(p));
  const given = k.passes.filter(isGiven);
  const at = given.reduce((m, p) => (p.given_at! > m ? p.given_at! : m), '');
  const by = [...new Set(given.map((p) => (p.given_by === null ? '' : names.get(p.given_by) ?? '')).filter(Boolean))].join(', ');
  const takeOut = (p: Pass) =>
    apply({ action: 'pack', summary: `${passName(p)} taken out of packet ${k.tag}`, set: [{ id: p.id, packet: '', expect: { packet: k.tag } }] });
  const onHandOver = async (e: FormEvent) => {
    e.preventDefault();
    const who = cleanField('issued_to', to);
    if (busy || !who || !left.length || unprinted.length) return;
    setBusy(true);
    const r = await apply({ action: 'given', summary: `Packet ${k.tag} handed over to ${who}: ${cardsLabel(left)}`, set: handOverOps(k.passes, who) });
    setBusy(false);
    if (r) setTo('');
  };
  const addMore = () => { packetName.set(k.tag); tray.set({ open: true, packet: '' }); };

  return (
    <div className="space-y-3">
      {renaming && <Rename k={k} tags={packets} onClose={() => setRenaming(false)} onDone={(tag) => tray.set({ open: true, packet: tag })} />}
      {given.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-[14px]" title={at ? new Date(at).toLocaleString() : undefined}>
          <span className="text-emerald-700"><GivenIcon size={14} /></span>
          {left.length > 0 && <span className="tabular-nums">{given.length} given to </span>}
          <b className="font-semibold">{k.issuedTo.join(', ') || 'no one named'}</b>
          {at && <span className="text-muted-foreground">· {new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{by && ` · by ${by}`}</span>}
        </p>
      )}
      <ol className="max-h-[35vh] divide-y divide-border overflow-auto rounded-[3px] border border-border">
        {k.passes.map((p, i) => (
          <li key={p.id} className={`flex items-center gap-x-2 px-2 py-1.5 ${p.lost_at ? 'bg-red-50 text-foreground/55' : ''}`}>
            <span className="w-5 text-right text-[13px] text-muted-foreground tabular-nums">{i + 1}</span>
            <PassMark type={p.type} />
            <Link href={`/s/${p.type}?q=${fmtSerial(p.serial)}`} className="whitespace-nowrap text-[14px] font-semibold hover:text-primary hover:underline" title="Go to it in its sheet">
              {passName(p)}
            </Link>
            <span className="min-w-0 flex-1 truncate text-[13.5px]" title={[p.name, p.vehicle_no, p.incharge].filter(Boolean).join(', ')}>
              {p.name}{p.lost_at ? <b className="ml-1 text-[12px] text-red-700">LOST</b> : isGiven(p) ? <span className="ml-1 text-emerald-700"><GivenIcon size={12} /></span> : null}
            </span>
            {!p.lost_at && (
              <button className="px-1 text-[16px] leading-none text-muted-foreground hover:text-destructive" onClick={() => takeOut(p)} title={`Take it out of packet ${k.tag} (Undo puts it back)`} aria-label={`Take ${passName(p)} out of the packet`}>
                ×
              </button>
            )}
          </li>
        ))}
      </ol>
      {unprinted.length > 0 && <p className="text-[13.5px] font-semibold text-red-700">Not printed: {cardsLabel(unprinted)}. Print first.</p>}
      {left.length > 0 && (
        <form onSubmit={onHandOver} className="space-y-1.5 border-t border-border pt-3">
          <span className="flex items-center gap-1.5 text-[14px] font-semibold"><GivenIcon size={14} />Hand over{left.length < k.passes.length ? ` the ${left.length} not given` : ''}</span>
          <div className="flex items-center gap-2">
            <input className={`${input} min-w-0 flex-1`} placeholder="Issued To" aria-label={`Packet ${k.tag} issued to`} value={to} onChange={(e) => setTo(e.target.value)} />
            <button type="submit" className={btnPrimary} disabled={busy || !to.trim() || unprinted.length > 0}>Hand over {left.length}</button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2.5 text-[13.5px] font-semibold">
        <button className="text-primary hover:underline" onClick={addMore} title="Pick or scan more passes into the next packet, named this one: Tag puts them in it">+ Add more</button>
        <button className="text-primary hover:underline" onClick={() => setRenaming(true)}>Rename / move</button>
        <Link href={`/people?packet=${encodeURIComponent(k.tag)}`} className="text-primary hover:underline">Its people</Link>
      </div>
    </div>
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
    return (
      <button
        className="flex min-w-0 items-center gap-1 text-left text-amber-800 hover:underline" title={`In packet ${p.packet}: click to open it (bottom right)`}
        onClick={(e) => { e.stopPropagation(); openPacket(p.packet); }} onMouseDown={(e) => e.stopPropagation()}
      >
        <PacketIcon size={13} /><span className="truncate">{p.packet}</span>
      </button>
    );
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

/**
 * Renames a packet, or moves all its passes into another (the name of one there already), given and lost passes too
 * (the owner, 2026-11-24). One change in History: Undo puts it back.
 */
export function Rename({ k, tags, onClose, onDone }: { k: Packet; tags: readonly Packet[]; onClose: () => void; onDone?: (tag: string) => void }) {
  const { apply } = useActions();
  const [name, setName] = useState(k.tag);
  const [busy, setBusy] = useState(false);
  const to = cleanPacket(name);
  const into = tags.find((o) => o.tag === to && o.tag !== k.tag);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !to || to === k.tag) return;
    setBusy(true);
    const summary = into ? `Packet ${k.tag} moved into ${to}: ${cardsLabel(k.passes)}` : `Packet ${k.tag} renamed ${to}`;
    const r = await apply({ action: 'pack', summary, set: retagOps(k.passes, to) });
    setBusy(false);
    if (!r) return;
    onClose();
    onDone?.(to);
  };
  return (
    <form onSubmit={onSubmit} onKeyDown={(e) => e.key === 'Escape' && onClose()} className="flex flex-wrap items-center gap-2 py-0.5">
      <input
        autoFocus className={`${input} !h-8 !w-56 max-md:!h-10 max-md:!w-full`} maxLength={MAX_PACKET} list="packet-tags-all" aria-label={`New name for packet ${k.tag}`}
        value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()}
      />
      <button type="submit" className={`${btnPrimary} !h-8 max-md:!h-10`} disabled={busy || !to || to === k.tag}>
        {into ? `Move ${k.passes.length} into ${to}` : 'Rename'}
      </button>
      <button type="button" className="text-[13px] font-semibold text-primary hover:underline" onClick={onClose}>Cancel</button>
      {into && <span className="basis-full text-[13px] text-muted-foreground">{to} has {nPasses(into.passes.length)}: all of {k.tag} joins it, and {k.tag} is gone.</span>}
    </form>
  );
}

/**
 * A scanned pass code (the owner, 2026-11-25): the pass goes in the next packet's list, and the box bottom right opens on it, saying
 * what happened (added, in the list already, or why it can't go in, with a low beep). Then tag them as a packet or hand them over there.
 * `open: false` (the phone's camera): the box isn't opened over the camera.
 */
export function takeScan(text: string, all: readonly Pass[], { open = true } = {}) {
  const s = scanOf(text, all);
  if ('error' in s) {
    beep(330, 260);
    const view = tray.get();
    return tray.set({ ...view, open: open || view.open, packet: open ? '' : view.packet, scan: { text: s.error, bad: true } });
  }
  const p = s.pass;
  const added = packetScan.add([p]);
  const who = p.name ? `, ${p.name}` : '';
  const view = tray.get();
  tray.set({ ...view, open: open || view.open, packet: open ? '' : view.packet, hold: added > 0 && !open, scan: { text: added ? `Added ${passName(p)}${who}` : `${passName(p)}${who} is in the list already`, id: p.id } });
}

/** A scan from a scanner on any page, wherever the cursor is (a phone app as a Bluetooth keyboard needs no box clicked first). */
export function ScanCatcher() {
  const me = useMe();
  const all = useAllPasses();
  useScannerCatch((text) => {
    // Not even part of a code: stray text from the scanner (the phone app types some when closed), thrown away.
    if (!/\d{12}/.test(text)) {
      const t = text.length > 40 ? `${text.slice(0, 37)}…` : text;
      return tray.set({ ...tray.get(), open: true, packet: '', scan: { text: `Ignored text from the scanner: “${t}”`, bad: true } });
    }
    takeScan(text, all);
  }, !me.scan_only);
  return null;
}
