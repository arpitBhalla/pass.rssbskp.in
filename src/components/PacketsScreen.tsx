'use client';
import Link from 'next/link';
import { type ChangeEvent, type FormEvent, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { useActions } from '@/client/actions';
import { packetScan as scanned } from '@/client/packetScan';
import { readPhoto } from '@/client/readPhoto';
import { useAllPasses, useStatus } from '@/client/store';
import { type Packet, handOverOps, nextTag, noteOn, packetsOf, packOps, scanOf } from '@/lib/packets';
import { cardsLabel, isGiven, isPrinted, nPasses } from '@/lib/passes';
import { cleanPacket, fmtSerial, MAX_PACKET, type Pass, TYPE_INFO } from '@/shared/types';
import { PassMark } from './AppShell';
import { LiveScan } from './LiveScan';
import { btn, btnPrimary, card, heading, input } from './ui';

const keyOf = (x: { type: string; serial: number }) => `${x.type}:${x.serial}`;
const passName = (p: Pass) => `${TYPE_INFO[p.type].label} ${fmtSerial(p.serial)}`;

/**
 * Packets (the owner, 2026-11-24): scan the passes going to one incharge (the camera reading each QR code held up to it,
 * a handheld scanner typing it into the box, or a photo), tag them as a packet, and hand the packet over: Issued To filled in and Given
 * ticked on all its passes at once. Each step is one change in History, so Undo puts it back.
 */
export function PacketsScreen() {
  const all = useAllPasses();
  const status = useStatus();
  const items = scanned.use();
  const { apply } = useActions();
  const byKey = useMemo(() => new Map(all.map((p) => [keyOf(p), p])), [all]);
  const list = items.flatMap((x) => byKey.get(keyOf(x)) ?? []);
  const gone = items.filter((x) => !byKey.has(keyOf(x)));
  const packets = useMemo(() => packetsOf(all), [all]);

  const [code, setCode] = useState('');
  const [tag, setTag] = useState('');
  const tagNow = cleanPacket(tag) || nextTag(all);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  /** Adds what was scanned (several codes at once when pasted). */
  const take = (text: string) => {
    for (const t of text.split(/\s+/).filter(Boolean)) {
      const s = scanOf(t, all);
      if ('error' in s) setNote({ text: s.error, bad: true });
      else if (!scanned.add([s.pass])) setNote({ text: `${passName(s.pass)} is already in the list.` });
      else setNote({ text: `Added ${passName(s.pass)}${s.pass.name ? `, ${s.pass.name}` : ''}.` });
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    take(code);
    setCode('');
  };
  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNote({ text: 'Reading the photo…' });
    const text = await readPhoto(file).catch(() => null);
    if (text === null) setNote({ text: 'No QR code found in the photo: take another, from 10–20 cm.', bad: true });
    else take(text);
  };

  const ops = packOps(list, tagNow);
  const onTag = async () => {
    setBusy(true);
    const r = await apply({ action: 'pack', summary: `Packet ${tagNow}: ${cardsLabel(list)}`, set: ops });
    setBusy(false);
    if (!r) return;
    scanned.clear();
    setTag('');
    setNote({ text: `Packet ${tagNow} tagged: ${nPasses(list.length)}. Hand it over below.` });
    box.current?.focus();
  };

  const waiting = packets.filter((k) => k.given < k.passes.length);
  const done = packets.filter((k) => k.given === k.passes.length);
  const onAddTo = (k: Packet) => { setTag(k.tag); box.current?.focus(); };

  return (
    <div className="min-w-0 flex-1 overflow-auto bg-background p-4">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
        <h1 className={`${heading} !text-[20px]`}>Packets</h1>
        {status.loaded && packets.length > 0 && (
          <span className="text-[14px] text-muted-foreground tabular-nums">
            {packets.length} packet{packets.length === 1 ? '' : 's'}, {nPasses(packets.reduce((n, k) => n + k.passes.length, 0))}
            {waiting.length > 0 && <>, <b className="font-semibold text-amber-800">{waiting.length} to hand over</b></>}
          </span>
        )}
      </div>
      <p className="mb-4 text-[13.5px] text-muted-foreground">
        Put the passes for one incharge in a packet, tag it, then hand it over: Issued To and Given are filled in on all its passes at once.
      </p>

      <div className="grid max-w-[88rem] items-start gap-5 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
        {/* ----- the next packet: scan or pick its passes, then tag them ----- */}
        <section className={`${card} space-y-3 border-t-4 border-t-primary p-4 lg:sticky lg:top-0`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={heading}>New packet</h2>
            {list.length > 0 && <span className="text-[13.5px] text-muted-foreground tabular-nums">{nPasses(list.length)} in the list</span>}
          </div>
          <input
            ref={box} autoFocus className={input} placeholder="Scan a pass QR code here (or paste codes, then Enter)" aria-label="Scan a pass"
            value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onKey}
          />
          <div className="flex flex-wrap items-center gap-2">
            <LiveScan onCode={take} />
            <label className={`${btn} cursor-pointer`}>
              Photo
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} />
            </label>
          </div>
          {note && <p aria-live="polite" className={`text-[14px] ${note.bad ? 'font-semibold text-red-700' : 'text-muted-foreground'}`}>{note.text}</p>}

          {list.length === 0 ? (
            <p className="rounded-[3px] border border-dashed border-input px-3 py-4 text-center text-[13.5px] text-muted-foreground">
              Only printed passes not given yet go in. Scan them here, or select rows in a sheet and use <b className="font-semibold">Add to packet</b>.
            </p>
          ) : (
            <ol className="max-h-[45vh] divide-y divide-border overflow-auto rounded-[3px] border border-border">
              {list.map((p, i) => {
                const why = noteOn(p, tagNow);
                return (
                  <li key={p.id} className={`flex flex-wrap items-center gap-x-2 px-2 py-1.5 ${why ? 'bg-amber-50' : ''}`}>
                    <span className="w-5 text-right text-[13px] text-muted-foreground tabular-nums">{i + 1}</span>
                    <PassMark type={p.type} />
                    <span className="whitespace-nowrap text-[14px] font-semibold">{passName(p)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]" title={[p.name, p.vehicle_no].filter(Boolean).join(', ')}>
                      {p.name}{p.vehicle_no && <span className="text-muted-foreground"> {p.vehicle_no}</span>}
                    </span>
                    <button className="px-1 text-[16px] leading-none text-muted-foreground hover:text-destructive" onClick={() => scanned.remove([p])} title="Take it out of the list" aria-label={`Remove ${passName(p)}`}>
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
              <button className="font-semibold text-primary hover:underline" onClick={() => scanned.remove(gone)}>Remove {gone.length === 1 ? 'it' : 'them'}</button>
            </p>
          )}
          {list.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-[14px] font-semibold">
                Packet
                <input
                  className={`${input} !w-auto flex-1`} maxLength={MAX_PACKET} placeholder={nextTag(all)} aria-label="Packet tag"
                  value={tag} onChange={(e) => setTag(e.target.value)}
                />
              </label>
              <div className="flex items-center gap-3">
                <button className={`${btnPrimary} flex-1`} disabled={busy || !ops.length} onClick={onTag}>
                  {ops.length ? `Tag ${nPasses(ops.length)} as packet ${tagNow}` : `All in packet ${tagNow} already`}
                </button>
                <button className="text-[13.5px] font-semibold text-primary hover:underline" onClick={() => { scanned.clear(); setNote(null); }}>Clear the list</button>
              </div>
            </div>
          )}
        </section>

        {/* ----- the packets: those still to hand over first ----- */}
        <div className="space-y-5">
          {!status.loaded ? <p className="text-muted-foreground">Loading…</p> : !packets.length ? (
            <p className="text-muted-foreground">No packets yet: put passes in the list and tag them.</p>
          ) : (
            <>
              {waiting.length > 0 && (
                <section>
                  <h2 className={`${heading} mb-2`}>To hand over <span className="font-normal text-muted-foreground">({waiting.length})</span></h2>
                  <ul className="space-y-2">{waiting.map((k) => <PacketItem key={k.tag} k={k} onAddTo={() => onAddTo(k)} />)}</ul>
                </section>
              )}
              {done.length > 0 && (
                <section>
                  <h2 className={`${heading} mb-2`}>Handed over <span className="font-normal text-muted-foreground">({done.length})</span></h2>
                  <ul className={`${card} divide-y divide-border`}>{done.map((k) => <GivenItem key={k.tag} k={k} />)}</ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The packet's tag: opens the People page with only its people (the owner, 2026-11-24). */
const TagLink = ({ tag }: { tag: string }) => (
  <Link href={`/people?packet=${encodeURIComponent(tag)}`} className="font-condensed text-[17px] font-bold text-primary hover:underline" title={`See the people in packet ${tag} on the People page`}>
    {tag}
  </Link>
);

/** A packet still to hand over: its passes, and Issued To + Hand over (Given on the passes not given yet). */
function PacketItem({ k, onAddTo }: { k: Packet; onAddTo: () => void }) {
  const { apply } = useActions();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const left = k.passes.filter((p) => !isGiven(p));
  const unprinted = left.filter((p) => !isPrinted(p));
  const onHandOver = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !to.trim() || unprinted.length) return;
    setBusy(true);
    const r = await apply({ action: 'given', summary: `Packet ${k.tag} handed over to ${to.trim().toUpperCase()}: ${cardsLabel(left)}`, set: handOverOps(k.passes, to) });
    setBusy(false);
    if (r) setTo('');
  };
  return (
    <li className={`${card} flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 border-l-amber-500 px-3 py-2.5`}>
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <TagLink tag={k.tag} />
          <span className="text-[14px] font-semibold">{nPasses(k.passes.length)}</span>
          <button className="text-[13px] text-primary hover:underline" onClick={onAddTo} title="Put more passes in this packet: scan them, then Tag">Add more</button>
        </div>
        <p className="text-[13px] text-muted-foreground tabular-nums">{cardsLabel(k.passes)}</p>
        {k.given > 0 && <p className="text-[13px]">{k.given} given to <b className="font-semibold">{k.issuedTo.join(', ') || 'no one named'}</b></p>}
        {unprinted.length > 0 && <p className="text-[13px] font-semibold text-red-700">Not printed: {cardsLabel(unprinted)}. Print first.</p>}
      </div>
      <form onSubmit={onHandOver} className="flex items-center gap-2">
        <input className={`${input} !w-52`} placeholder="Issued To" aria-label={`Packet ${k.tag} issued to`} value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="submit" className={btnPrimary} disabled={busy || !to.trim() || unprinted.length > 0}>Hand over {nPasses(left.length)}</button>
      </form>
    </li>
  );
}

/** A packet handed over: who to, and when. */
function GivenItem({ k }: { k: Packet }) {
  const at = k.passes.reduce((m, p) => (p.given_at && p.given_at > m ? p.given_at : m), '');
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
      <TagLink tag={k.tag} />
      <span className="text-[14px] font-semibold">{nPasses(k.passes.length)}</span>
      <span className="min-w-0 flex-1 basis-48 text-[13px] text-muted-foreground tabular-nums">{cardsLabel(k.passes)}</span>
      <span className="text-[14px]">
        <span aria-hidden className="mr-1 font-bold text-emerald-700">✓</span>
        Given to <b className="font-semibold">{k.issuedTo.join(', ') || 'no one named'}</b>
        {at && <span className="text-muted-foreground" title={new Date(at).toLocaleString()}>, {new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
      </span>
    </li>
  );
}
