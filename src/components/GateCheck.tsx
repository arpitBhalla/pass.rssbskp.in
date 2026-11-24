'use client';
import { useQuery } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, isUnauthorized, useTRPC, useTRPCClient } from '@/client/trpc';
import { readPhoto } from '@/client/readPhoto';
import { claimOf, codeIn } from '@/lib/gateCode';
import type { AppRouter } from '@/server/routers/_app';
import { fieldLabel, fmtSerial, type PassType, TYPE_INFO } from '@/shared/types';
import { beep, useLiveScan } from './LiveScan';

type Check = inferRouterOutputs<AppRouter>['gate']['check'];
type Verdict = Check['verdict'];
type Claim = { type: PassType; serial: number };
/** One scan on this phone: what was read, and what the register said (or why it couldn't be asked). */
type Scan = { n: number; at: number; claim: Claim | null; code: string; r?: Check; note?: string; login?: boolean };

const NOT_A_PASS: Check = { verdict: 'invalid', reasons: ['This QR code is not an RSSB SKP pass.'], claim: null, pass: null, earlier: [], scans: 0, lost: null, copyOf: null };
const WORD = { valid: 'VALID', check: 'CHECK', invalid: 'NOT VALID', lost: 'LOST' } as const;
const ADVICE = {
  valid: 'Let in.', check: 'Genuine pass, but the register disagrees. Look closer:', invalid: "Don't let in.",
  lost: "Reported lost or stolen: don't let in. Keep the pass.",
} as const;
const BAND = { valid: 'bg-[#007236] text-white', check: 'bg-[#f2b705] text-[#231f20]', invalid: 'bg-[#9e0b0f] text-white', lost: 'bg-[#9e0b0f] text-white', none: 'bg-[#6d6e71] text-white' };
const RESULT = { valid: 'text-[#007236]', check: 'text-[#8a6100]', invalid: 'text-[#9e0b0f]', lost: 'text-[#9e0b0f]' } as Record<string, string>;
const LABELS = { name: 'Name', dept: 'Dept', area: 'Area', incharge: 'Incharge', issued_to: 'Issued To', vehicle: 'Vehicle', vehicle_no: 'Reg. No.', ferry: 'Ferry Sewa', rtb3: 'Behind RTB 3' } as const;
const login = (next: string) => `/login?next=${encodeURIComponent(next)}`;
const passName = (c: Claim) => `${TYPE_INFO[c.type].label} ${fmtSerial(c.serial)}`;

/** What the verdict sounds and feels like: one high beep to let in, two for a closer look, a long low tone for no. */
function signal(v: Verdict | 'error') {
  if (v === 'valid') { beep(1400, 90); navigator.vibrate?.(60); return; }
  if (v === 'check') { beep(900, 90); window.setTimeout(() => beep(900, 90), 160); navigator.vibrate?.([80, 80, 80]); return; }
  beep(300, 450);
  navigator.vibrate?.([250, 100, 250]);
}

function when(iso: string | number) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago, ${clock}`;
  const day = d.toDateString() === new Date().toDateString() ? 'today' : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `${day} ${clock}`;
}

/** The big coloured block at the top: the verdict, and which pass. */
function VerdictBlock({ band, word, claim, children }: { band: string; word: string; claim?: Claim | null; children?: ReactNode }) {
  return (
    <section className={`px-4 pt-5 pb-5 ${band}`}>
      <div className="text-[clamp(44px,15vw,84px)] leading-none font-extrabold">{word}</div>
      {claim && (
        <div className="mt-3 flex items-center gap-2.5 text-[22px] font-bold">
          <span className="h-5 w-3.5 flex-none rounded-[2px] border-2 border-white" style={{ background: TYPE_INFO[claim.type].color.band }} />
          {TYPE_INFO[claim.type].label}
          <b className="text-[26px] tabular-nums">{fmtSerial(claim.serial)}</b>
        </div>
      )}
      {children && <p className="mt-1.5 text-[19px]">{children}</p>}
    </section>
  );
}

function Result({ r }: { r: Check }) {
  const rows = r.pass ? (Object.keys(LABELS) as (keyof typeof LABELS)[]).filter((k) => r.pass?.[k]) : [];
  return (
    <>
      <VerdictBlock band={BAND[r.verdict]} word={WORD[r.verdict]} claim={r.claim}>{ADVICE[r.verdict]}</VerdictBlock>
      {r.lost && (
        <div className="space-y-1 border-b border-[#f1c4c5] bg-[#fdecec] px-4 py-3 text-[18px]">
          <p>Marked lost {when(r.lost.at)}{r.lost.by && <> by {r.lost.by}</>}.</p>
          {r.lost.replacedBy && <p>Replaced by <b>{r.lost.replacedBy}</b>: only that pass is valid now.</p>}
        </div>
      )}
      {r.copyOf && (
        <p className="border-b border-[#c9d8ee] bg-[#eef4fc] px-4 py-2.5 text-[17px]">
          <b>Duplicate</b> of {r.copyOf}, which was lost.
        </p>
      )}
      {r.reasons.length > 0 && (
        <ul className="list-disc border-b border-[#e9d9a6] bg-[#fff8e1] py-3 pr-4 pl-9 text-[18px]">
          {r.reasons.map((x) => <li key={x} className="mt-1.5 first:mt-0">{x}</li>)}
        </ul>
      )}
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-b border-border bg-white px-4 py-3.5 text-[18px]">
          {rows.map((k) => [
            <dt key={`${k}-t`} className="text-muted-foreground">{r.claim && k !== 'ferry' && k !== 'rtb3' ? fieldLabel(r.claim.type, k) : LABELS[k]}</dt>,
            <dd key={k} className="font-bold [overflow-wrap:anywhere]">{r.pass?.[k].toUpperCase()}</dd>,
          ])}
        </dl>
      )}
      {r.earlier.length > 0 && (
        <div className="border-b border-border bg-white px-4 py-3.5">
          <h2 className="mb-1.5 text-[15px] font-semibold text-muted-foreground">
            {r.scans === 1 ? 'Scanned once before' : `Scanned ${r.scans} times before`}
          </h2>
          <table className="w-full text-[16px]">
            <tbody>
              {r.earlier.map((e) => (
                <tr key={e.at} className="border-t border-[#eceef0] align-top">
                  <td className="py-1.5">{when(e.at)}</td>
                  <td className="py-1.5 pl-3">{e.by}</td>
                  <td className={`py-1.5 pl-3 font-bold ${RESULT[e.result] ?? ''}`}>{WORD[e.result as keyof typeof WORD] ?? e.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** A scan's result: checking, the register's answer, or why it couldn't be checked. */
function ScanResult({ scan }: { scan: Scan }) {
  if (scan.r) return <Result r={scan.r} />;
  if (scan.note === undefined) return <VerdictBlock band={BAND.none} word="Checking" claim={scan.claim} />;
  return (
    <>
      <VerdictBlock band={BAND.none} word="NOT CHECKED" claim={scan.claim} />
      <p className="px-4 py-3 text-[16px] text-muted-foreground">{scan.note}</p>
      {scan.login && (
        <a href={login(`/v#${scan.code}`)} className="mx-4 block rounded-[4px] bg-primary py-3.5 text-center font-bold text-white">
          Log in to check the register
        </a>
      )}
    </>
  );
}

/** This phone's scans, newest first: tap one to see its result again. */
function ScanList({ scans, current, onPick }: { scans: Scan[]; current: number; onPick: (n: number) => void }) {
  const count = (v: Verdict) => scans.filter((s) => s.r?.verdict === v).length;
  const tally = (['valid', 'check', 'invalid', 'lost'] as const).filter((v) => count(v)).map((v) => `${count(v)} ${WORD[v].toLowerCase()}`);
  return (
    <section className="mt-3 border-t border-border bg-white">
      <h2 className="px-4 pt-3 pb-1.5 text-[15px] font-semibold text-muted-foreground">
        Scanned on this phone: {scans.length}{tally.length > 0 && <span className="font-normal"> ({tally.join(', ')})</span>}
      </h2>
      <ul>
        {scans.map((s) => (
          <li key={s.n}>
            <button
              onClick={() => onPick(s.n)}
              className={`flex w-full items-baseline gap-3 border-t border-[#eceef0] px-4 py-2 text-left text-[16px] ${s.n === current ? 'bg-[#f3efe6]' : ''}`}
            >
              <span className="w-[4.2rem] flex-none text-muted-foreground tabular-nums">{new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className="min-w-0 flex-1 truncate">
                {s.claim ? <b className="font-semibold tabular-nums">{passName(s.claim)}</b> : 'Not a pass'}
                {s.r?.pass?.name && <span className="text-muted-foreground"> {s.r.pass.name.toUpperCase()}</span>}
              </span>
              <b className={`flex-none ${s.r ? RESULT[s.r.verdict] : 'text-muted-foreground'}`}>{s.r ? WORD[s.r.verdict] : s.note === undefined ? '…' : 'NOT CHECKED'}</b>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The gate check page (/v; verify.rssbskp.in opens it). Volunteers check passes with their phones: the camera stays on and each
 * pass's QR code held up to it is checked against the register at once (gate.check), with a sound for the verdict; or a photo
 * of the QR code. A pass marked LOST shows LOST, and the duplicate that replaced it. Each scan is recorded; this phone's scans
 * are listed below. Needs a login, which the phone keeps: Scan only users can check passes and nothing else (the owner, 2026-11-24).
 */
export function GateCheck() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const status = useQuery(trpc.auth.status.queryOptions());
  // Until the server says (offline: assume logged in; the check then says what's wrong).
  const known = status.data !== undefined || status.isError;
  const loggedOut = status.data !== undefined && !status.data.user;
  const [scans, setScans] = useState<Scan[]>([]);
  /** The scan whose result is shown (tapped in the list); null: the latest. */
  const [picked, setPicked] = useState<number | null>(null);
  const [photo, setPhoto] = useState<'reading' | 'unread' | null>(null);
  const seq = useRef(0);

  const check = useCallback(async (text: string) => {
    const code = codeIn(text);
    const claim = code ? claimOf(code) : null;
    const n = ++seq.current;
    const put = (patch: Partial<Scan>) => setScans((all) => all.map((s) => (s.n === n ? { ...s, ...patch } : s)));
    setScans((all) => [{ n, at: Date.now(), claim, code: code ?? '', ...(!claim && { r: NOT_A_PASS }) }, ...all].slice(0, 100));
    setPicked(null);
    setPhoto(null);
    if (!claim || !code) return signal('invalid');
    try {
      const r = await client.gate.check.mutate({ code });
      put({ r });
      signal(r.verdict);
    } catch (e) {
      put({
        login: isUnauthorized(e),
        note: isUnauthorized(e) ? 'Log in once on this phone to check passes.'
          : e instanceof TRPCClientError && !e.data ? 'No connection to the register. Check the internet and scan again.'
          : errorMessage(e),
      });
      signal('error');
    }
  }, [client]);

  const { on: camOn, toggle: camToggle, error: camError, video } = useLiveScan(check, { sound: false }); // the verdict makes the sound

  // Passes printed before 2026-11-12 hold a link, /v#<code>, which the phone's camera opens here.
  useEffect(() => {
    const code = codeIn(decodeURIComponent(window.location.hash.slice(1)));
    if (!code) return;
    window.history.replaceState(null, '', '/v');
    // oxlint-disable-next-line react/set-state-in-effect -- reads the address bar (outside React) once, on opening
    void check(code);
  }, [check]);

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhoto('reading');
    const text = await readPhoto(file).catch(() => null);
    if (text === null) return setPhoto('unread');
    await check(text);
  };

  const current = (picked !== null && scans.find((s) => s.n === picked)) || scans[0];
  const canScan = known && !loggedOut;
  return (
    <div className="min-h-dvh bg-[#f6f7f8] pb-28 text-[18px] leading-snug text-[#231f20]">
      <header className="flex items-baseline justify-between gap-3 bg-primary px-4 py-3 text-white">
        <span className="text-[17px] font-bold">RSSB SKP Pass Check</span>
        {status.data?.user && <span className="truncate text-[14px] opacity-85">{status.data.user.name}</span>}
      </header>
      <main className="mx-auto max-w-[34rem]">
        {known && loggedOut && (
          <div className="space-y-3 px-4 py-6">
            <p>Log in once on this phone to check passes. Ask the admin for a user if you don&apos;t have one.</p>
            <a href={login('/v')} className="block rounded-[4px] bg-primary py-3.5 text-center font-bold text-white">Log in</a>
          </div>
        )}
        {camOn && (
          <div className="relative bg-black">
            <video ref={video} muted playsInline className="block aspect-[4/3] max-h-[42vh] w-full object-cover" />
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 size-[55%] max-h-[80%] -translate-x-1/2 -translate-y-1/2 rounded-[6px] border-[3px] border-white/75" />
          </div>
        )}
        {camError && <p className="bg-[#fdecec] px-4 py-3 text-[16px] font-semibold text-[#9e0b0f]">{camError}</p>}
        {photo === 'reading' ? <VerdictBlock band={BAND.none} word="Reading…" />
          : photo === 'unread' ? (
            <VerdictBlock band={BAND.none} word="TRY AGAIN">
              No QR code found in the photo. Hold the phone 10–20 cm from the pass, with the QR code in the middle and sharp, and take another.
            </VerdictBlock>
          ) : current ? <ScanResult scan={current} />
          : canScan && (
            <div className="space-y-3 px-4 py-6">
              <p>Tap <b>Start camera</b> and hold each pass&apos;s QR code in the frame: it is checked at once, and the phone beeps once to let in, twice to look closer, long for no.</p>
              <p className="text-[16px] text-muted-foreground">Or tap <b>Photo</b> and take a photo of the QR code from close up (10–20 cm). Each scan is checked against the register and recorded.</p>
            </div>
          )}
        {scans.length > 0 && <ScanList scans={scans} current={current?.n ?? 0} onPick={setPicked} />}
      </main>
      {canScan && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-white/95 p-3">
          <div className="mx-auto grid max-w-[34rem] grid-cols-[1.4fr_1fr] gap-2.5 text-[19px] font-bold">
            <button onClick={camToggle} className={`rounded-[4px] py-4 text-white ${camOn ? 'bg-[#414042] active:bg-black' : 'bg-primary active:bg-primary-hover'}`}>
              {camOn ? 'Stop camera' : 'Start camera'}
            </button>
            <label className={`rounded-[4px] border-2 py-[14px] text-center ${photo === 'reading' ? 'border-[#6d6e71] text-[#6d6e71]' : 'border-primary text-primary active:bg-primary/10'}`}>
              {photo === 'reading' ? 'Wait…' : 'Photo'}
              <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={photo === 'reading'} onChange={onPhoto} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
