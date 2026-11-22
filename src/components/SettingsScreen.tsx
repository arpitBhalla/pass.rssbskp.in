'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { toast } from '@/client/toast';
import { errorMessage, useTRPC } from '@/client/trpc';
import type { CardData } from '@/lib/passes';
import { CARD_SIZE } from '@/lib/sheets';
import { PASS_TYPES, type PassType, TYPE_INFO } from '@/shared/types';
import { PassCard, type PrintTexts, useCardFonts } from './cards/PassCard';
import { Qr } from './cards/Qr';
import { btn, btnDanger, input } from './ui';

/** One-time setup of what every pass prints with. Admin only; every desk uses it. */
export function SettingsScreen() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.get.queryOptions());
  const s = q.data;
  return (
    <div className="min-w-0 flex-1 overflow-auto bg-background p-4">
      <h1 className="font-condensed text-[22px] font-bold">Settings</h1>
      <p className="mb-5 text-muted-foreground">Printed on the passes. Set once; every desk uses them.</p>
      {q.isLoading || !s ? <p className="text-muted-foreground">Loading…</p> : (
        <div className="max-w-xl divide-y divide-border border-y border-border">
          <Row title="Signature" note="On every pass, above Auth Signatory. An SVG stays sharp at any size; photos are resized.">
            <Signature signature={s.signature} />
          </Row>
          <Row title="Tag" note="The tab at the bottom of every pass.">
            <TextSetting name="tag" value={s.tag} placeholder="NOV - 2026" />
          </Row>
          <Row title="Gate check page" note="Gate volunteers check passes here on their phones (same Wi-Fi as this computer): Scan, then photograph the pass's QR code.">
            <GatePage />
          </Row>
          <Row title="QR key" note="A secret on the server behind every QR code, so a copied design can't make a pass that checks VALID.">
            <QrKey />
          </Row>
        </div>
      )}
      {s && <Previews texts={s} />}
    </div>
  );
}

function Row({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[11rem_1fr]">
      <div>
        <h2 className="font-condensed text-[17px] font-bold">{title}</h2>
        <p className="text-[13.5px] leading-snug text-muted-foreground">{note}</p>
      </div>
      <div className="self-center">{children}</div>
    </section>
  );
}

function useSaved() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return {
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
      toast('Saved');
    },
    onError: (e: unknown) => toast(errorMessage(e), 'error'),
  };
}

/** A line of text printed on passes. Saved with Save or Enter. */
function TextSetting({ name, value, placeholder }: { name: 'tag'; value: string; placeholder: string }) {
  const trpc = useTRPC();
  const saved = useSaved();
  const [draft, setDraft] = useState(value);
  const save = useMutation(trpc.settings.setText.mutationOptions(saved));
  const changed = draft.trim() !== value;
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (changed) save.mutate({ key: name, value: draft.trim() }); }}>
      <input className={input} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} />
      <button className={btn} disabled={!changed || save.isPending}>Save</button>
    </form>
  );
}

/** The signature printed on every pass. Shared by all desks. SVG stays vector; photos are resized. */
function Signature({ signature }: { signature: string }) {
  const trpc = useTRPC();
  const save = useMutation(trpc.settings.setSignature.mutationOptions(useSaved()));
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      save.mutate({ signature: await toDataUrl(file) });
    } catch {
      toast("Couldn't read that image. Use a PNG, JPEG or SVG.", 'error');
    }
  };
  return (
    <div className="flex items-center gap-3">
      {signature
        ? <img src={signature} alt="Signature" className="h-16 w-40 rounded-[3px] border border-border bg-white object-contain p-1" />
        : <span className="text-muted-foreground">None yet</span>}
      <label className={`${btn} cursor-pointer`}>
        {signature ? 'Change' : 'Upload'}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {signature && <button className="text-muted-foreground hover:text-destructive hover:underline" onClick={() => save.mutate({ signature: '' })}>Remove</button>}
    </div>
  );
}

/** SVG as it is (vector); other images scaled to at most 1600 px wide as PNG (sharp when printed small). */
async function toDataUrl(file: File): Promise<string> {
  const read = (blob: Blob) => new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
  if (file.type === 'image/svg+xml') return read(file);
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** The signing key: its short id, and a new key (every pass printed before it then checks NOT VALID). */
function QrKey() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.settings.qrKey.queryOptions());
  const [sure, setSure] = useState(false);
  const make = useMutation(trpc.settings.newKey.mutationOptions({
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.settings.qrKey.queryKey() });
      setSure(false);
      toast('New key made. Passes printed before now check as NOT VALID.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  }));
  if (q.isLoading) return <span className="text-muted-foreground">Loading…</span>;
  const k = q.data;
  if (!k) return <span className="text-muted-foreground">Made on the first print.</span>;
  const since = new Date(k.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="space-y-2">
      <p>
        Key <span className="font-condensed text-[16px] font-semibold tracking-[0.04em]">{k.fingerprint}</span>
        <span className="text-muted-foreground">, in use since {since}</span>
      </p>
      {!sure ? (
        <button className={btn} onClick={() => setSure(true)}>Make a new key…</button>
      ) : (
        <div className="space-y-2 rounded-[3px] border-l-4 border-destructive bg-red-50 px-3 py-2">
          <p>Every pass printed before now will check as NOT VALID at the gate and must be printed again. Use this if the key may have leaked, or for a new year.</p>
          <div className="flex gap-2">
            <button className={btnDanger} disabled={make.isPending} onClick={() => make.mutate()}>Make a new key</button>
            <button className={btn} onClick={() => setSure(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const noChange = () => () => {};

/** The gate check page's address on this network, with a QR code that opens it on a phone. */
function GatePage() {
  const origin = useSyncExternalStore(noChange, () => window.location.origin, () => '');
  if (!origin) return null;
  if (/^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(origin)) {
    return <p>Open this app by the computer&apos;s network address (like http://192.168.1.20:5180) to see the address phones use.</p>;
  }
  const url = `${origin}/v`;
  return (
    <div className="flex items-center gap-4">
      <svg width={112} height={112} viewBox="0 0 112 112" role="img" aria-label={`QR code for ${url}`} className="flex-none">
        <Qr text={url} x={0} y={0} size={112} pad={8} ec="M" />
      </svg>
      <div className="space-y-1">
        <Link href="/v" className="font-semibold text-primary hover:underline">{url}</Link>
        <p className="text-[13.5px] leading-snug text-muted-foreground">
          On each gate phone: scan this with the camera, log in, and add the page to the home screen.
        </p>
      </div>
    </div>
  );
}

/** Sample details for the previews. */
const SAMPLE: Record<PassType, Partial<CardData>> = {
  'mobile-pandal': { name: 'Harpreet Singh', dept: 'Security', area: 'Sirsa', phone: '9876543210' },
  'mobile-non-pandal': { name: 'Sunita Devi', dept: 'Langar', area: 'Gurugram', phone: '9812345678' },
  'bike-pandal': { name: 'Harpreet Singh', dept: 'Security', area: 'Sirsa', vehicle_no: 'HR-26AB-1234' },
  'bike-non-pandal': { name: 'Rajinder Kumar', dept: 'Traffic', area: 'Delhi', vehicle_no: 'DL-3SCK-7788' },
  'sewa-vehicle': { name: 'Harpreet Singh', vehicle: 'Maruti Swift', vehicle_no: 'HR-26AB-1234', area: 'Sirsa', dept: 'Security' },
  'tractor-trolley': { name: 'Baldev Singh', phone: '98765-12345', vehicle: 'Mahindra 575 DI', vehicle_no: 'PB-10X-4455', area: 'Ludhiana', dept: 'Construction' },
  'gate3-entry': { name: 'Gurmeet Kaur', phone: '98123-45678', vehicle: 'Toyota Innova', vehicle_no: 'HR-55AL-9021', area: 'Gurugram', dept: 'Langar' },
  'bav-entry': { name: 'Rajinder Kumar', vehicle: 'Mahindra Bolero', vehicle_no: 'DL-8CAB-3310', area: 'Delhi', dept: 'Traffic' },
  'vip-gate': { name: 'Amarjit Singh', phone: '98765-43210', vehicle: 'Toyota Fortuner', vehicle_no: 'HR-26DK-0007', area: 'Gurugram', dept: 'Reception' },
  admin: { name: 'Sukhwinder Kaur', vehicle: 'Honda City', vehicle_no: 'HR-29T-4512', area: 'Faridabad', dept: 'Administration' },
  /* The Free Helpline Sewa passes print only their serial. */
  'e-rickshaw': {},
  eco: {},
  metro: {},
};

/** A made-up code as long as a real one (44 digits: a sample QR the right size; it checks NOT VALID). */
const SAMPLE_CODE = Array.from({ length: 44 }, (_, i) => (i === 0 ? 4 : (i * 7 + 3) % 10)).join('');

/** PX per mm on screen. */
const PX = 3.4;

/** Every pass as it prints, with sample details and the settings above. */
function Previews({ texts }: { texts: PrintTexts }) {
  const ready = useCardFonts();
  return (
    <section className="mt-8">
      <h2 className="font-condensed text-[19px] font-bold">Passes</h2>
      <p className="mb-4 text-muted-foreground">As they print, with sample details. The sample QR codes check as NOT VALID.</p>
      {!ready ? <p className="text-muted-foreground">Loading the pass fonts…</p> : (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-5">
          {PASS_TYPES.map((t, i) => {
            const { w, h } = CARD_SIZE[TYPE_INFO[t].layout];
            const p: CardData = { type: t, serial: i + 1, name: '', dept: '', area: '', phone: '', vehicle: '', vehicle_no: '', ...SAMPLE[t] };
            return (
              <figure key={t}>
                <svg width={w * PX} height={h * PX} viewBox={`0 0 ${w} ${h}`} className="shadow-[0_1px_3px_rgb(0_0_0/0.18)]">
                  <PassCard p={p} texts={texts} code={SAMPLE_CODE} />
                </svg>
                <figcaption className="mt-1.5 text-[13.5px] text-muted-foreground">
                  {TYPE_INFO[t].label}, {w} × {h} mm
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}
