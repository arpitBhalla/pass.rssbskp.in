'use client';
import { useQuery } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { errorMessage, isUnauthorized, useTRPC, useTRPCClient } from '@/client/trpc';
import { claimOf, codeIn } from '@/lib/gateCode';
import type { AppRouter } from '@/server/routers/_app';
import { fmtSerial, type PassType, TYPE_INFO } from '@/shared/types';

type Check = inferRouterOutputs<AppRouter>['gate']['check'];
type Claim = { type: PassType; serial: number };
type Screen =
  | { at: 'start' }
  | { at: 'reading' }
  | { at: 'unread' }
  | { at: 'checking'; claim: Claim }
  | { at: 'checked'; r: Check }
  | { at: 'unchecked'; claim: Claim; code: string; note: string; login?: boolean };

const NOT_A_PASS: Check = { verdict: 'invalid', reasons: ['This QR code is not an RSSB SKP pass.'], claim: null, pass: null, earlier: [], scans: 0 };
const WORD = { valid: 'VALID', check: 'CHECK', invalid: 'NOT VALID' } as const;
const ADVICE = { valid: 'Let in.', check: 'Genuine pass, but the register disagrees. Look closer:', invalid: "Don't let in." } as const;
const BAND = { valid: 'bg-[#007236] text-white', check: 'bg-[#f2b705] text-[#231f20]', invalid: 'bg-[#9e0b0f] text-white', none: 'bg-[#6d6e71] text-white' };
const RESULT = { valid: 'text-[#007236]', check: 'text-[#8a6100]', invalid: 'text-[#9e0b0f]' } as Record<string, string>;
const LABELS = { name: 'Name', dept: 'Dept', area: 'Area', incharge: 'Incharge', issued_to: 'Issued To', vehicle: 'Vehicle', vehicle_no: 'Reg. No.' } as const;
const login = (next: string) => `/login?next=${encodeURIComponent(next)}`;

/**
 * Finds a QR code in a photo from the phone's camera: the whole photo, then its middle enlarged, then
 * the whole at a higher resolution (a pass photographed from further away).
 */
async function readPhoto(file: File): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const [W, H] = [img.naturalWidth, img.naturalHeight];
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    const tried = new Set<string>();
    for (const [part, most] of [[1, 1600], [0.5, 1600], [1, 2800]]) {
      const [sw, sh] = [W * part, H * part];
      const k = Math.min(1, most / Math.max(sw, sh));
      const [w, h] = [Math.round(sw * k), Math.round(sh * k)];
      if (tried.has(`${part} ${w}`)) continue;
      tried.add(`${part} ${w}`);
      await new Promise((r) => setTimeout(r)); // lets "Reading the photo…" show first
      [canvas.width, canvas.height] = [w, h];
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, w, h);
      const found = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (found) return found.data;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function when(iso: string) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago, ${clock}`;
  const day = d.toDateString() === new Date().toDateString() ? 'today' : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `${day} ${clock}`;
}

/** The big coloured block at the top: the verdict, and which pass. */
function Verdict({ band, word, claim, children }: { band: string; word: string; claim?: Claim | null; children?: ReactNode }) {
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
      <Verdict band={BAND[r.verdict]} word={WORD[r.verdict]} claim={r.claim}>{ADVICE[r.verdict]}</Verdict>
      {r.reasons.length > 0 && (
        <ul className="list-disc border-b border-[#e9d9a6] bg-[#fff8e1] py-3 pr-4 pl-9 text-[18px]">
          {r.reasons.map((x) => <li key={x} className="mt-1.5 first:mt-0">{x}</li>)}
        </ul>
      )}
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-b border-border bg-white px-4 py-3.5 text-[18px]">
          {rows.map((k) => [
            <dt key={`${k}-t`} className="text-muted-foreground">{LABELS[k]}</dt>,
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
      {r.claim && <p className="px-4 py-3 text-[15px] text-muted-foreground">Checked against the register; this scan is recorded.</p>}
    </>
  );
}

/**
 * The gate check page (/v). A volunteer taps Scan, the phone's camera takes a photo of the pass's QR
 * code, and the server checks the code against the register (gate.check; needs a login, which the
 * phone keeps). A photo, not a live camera: phones allow live camera only on https, and this runs
 * on http on the local network.
 */
export function GateCheck() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const status = useQuery(trpc.auth.status.queryOptions());
  // Until the server says (offline: assume logged in; the check then says what's wrong).
  const known = status.data !== undefined || status.isError;
  const loggedOut = status.data !== undefined && !status.data.user;
  const [screen, setScreen] = useState<Screen>({ at: 'start' });

  const check = useCallback(async (code: string) => {
    const claim = claimOf(code);
    if (!claim) return setScreen({ at: 'checked', r: NOT_A_PASS });
    setScreen({ at: 'checking', claim });
    try {
      setScreen({ at: 'checked', r: await client.gate.check.mutate({ code }) });
    } catch (e) {
      setScreen({
        at: 'unchecked', claim, code,
        login: isUnauthorized(e),
        note: isUnauthorized(e) ? 'Log in once on this phone to check passes.'
          : e instanceof TRPCClientError && !e.data ? 'No connection to the register. Join the gate Wi-Fi and scan again.'
          : errorMessage(e),
      });
    }
  }, [client]);

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
    setScreen({ at: 'reading' });
    const text = await readPhoto(file).catch(() => null);
    if (text === null) return setScreen({ at: 'unread' });
    const code = codeIn(text);
    await (code ? check(code) : setScreen({ at: 'checked', r: NOT_A_PASS }));
  };

  const busy = screen.at === 'reading' || screen.at === 'checking';
  return (
    <div className="min-h-dvh bg-[#f6f7f8] pb-28 text-[18px] leading-snug text-[#231f20]">
      <header className="bg-primary px-4 py-3 text-[17px] font-bold text-white">RSSB SKP Pass Check</header>
      <main className="mx-auto max-w-[34rem]">
        {screen.at === 'start' && known && (
          loggedOut ? (
            <div className="space-y-3 px-4 py-6">
              <p>Log in once on this phone to check passes. Ask the admin for a user if you don&apos;t have one.</p>
              <a href={login('/v')} className="block rounded-[4px] bg-primary py-3.5 text-center font-bold text-white">Log in</a>
            </div>
          ) : (
            <div className="space-y-3 px-4 py-6">
              <p>Tap <b>Scan a pass</b> and take a photo of the QR code on the pass, from close up (10–20 cm), with the code in the middle.</p>
              <p className="text-[16px] text-muted-foreground">Each pass is checked against the register, and each scan is recorded.</p>
            </div>
          )
        )}
        {screen.at === 'reading' && <Verdict band={BAND.none} word="Reading…" />}
        {screen.at === 'unread' && (
          <Verdict band={BAND.none} word="TRY AGAIN">
            No QR code found in the photo. Hold the phone 10–20 cm from the pass, with the QR code in the middle and sharp, and take another.
          </Verdict>
        )}
        {screen.at === 'checking' && <Verdict band={BAND.none} word="Checking" claim={screen.claim} />}
        {screen.at === 'checked' && <Result r={screen.r} />}
        {screen.at === 'unchecked' && (
          <>
            <Verdict band={BAND.none} word="NOT CHECKED" claim={screen.claim} />
            <p className="px-4 py-3 text-[16px] text-muted-foreground">{screen.note}</p>
            {screen.login && (
              <a href={login(`/v#${screen.code}`)} className="mx-4 block rounded-[4px] bg-primary py-3.5 text-center font-bold text-white">
                Log in to check the register
              </a>
            )}
          </>
        )}
      </main>
      {known && !loggedOut && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-white/95 p-3">
          <label className={`mx-auto block max-w-[34rem] rounded-[4px] py-4 text-center text-[19px] font-bold text-white ${busy ? 'bg-[#6d6e71]' : 'bg-primary active:bg-primary-hover'}`}>
            {busy ? 'Wait…' : screen.at === 'start' ? 'Scan a pass' : 'Scan next pass'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={onPhoto} />
          </label>
        </div>
      )}
    </div>
  );
}
