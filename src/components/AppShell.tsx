'use client';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, Fragment, type ReactNode, use, useEffect, useRef } from 'react';
import { useSyncLoop } from '@/client/actions';
import { type Status, store, useCounts, useStatus } from '@/client/store';
import { dismissToast, useToast } from '@/client/toast';
import { useTRPC } from '@/client/trpc';
import { type PassType, SHEETS, TYPE_INFO, type User } from '@/shared/types';
import { nPasses } from '@/lib/passes';
import { PacketTray, ScanCatcher } from './NextPacket';
import { PersonSearch } from './PersonSearch';
import { PrintQueueButton } from './PrintQueue';

const MeContext = createContext<User | null>(null);

/** Saving is slow or the connection is down while changes are waiting: the rows not saved yet are marked. */
const stuck = (s: Status) => s.unsaved > 0 && (s.slow || s.retrying || !s.online);

/** Says when the server can't be reached, or saving is slow, and how many changes are waiting. */
function ConnectionBar({ status: s }: { status: Status }) {
  const n = `${s.unsaved} change${s.unsaved === 1 ? '' : 's'}`;
  const dot = <span aria-hidden className="mx-0.5 inline-block size-[9px] rounded-full bg-amber-500 ring-2 ring-amber-200" />;
  if (s.unsaved && (s.retrying || !s.online)) {
    return (
      <div role="alert" className="bg-destructive px-4 py-1.5 text-white print:hidden">
        <b>No connection to the server: {n} not saved yet</b> (rows marked {dot}). Keep this tab open: they are saved by
        themselves as soon as the connection is back.
      </div>
    );
  }
  if (!s.online) {
    return (
      <div role="alert" className="bg-destructive px-4 py-1.5 font-semibold text-white print:hidden">
        Can&apos;t reach the server. Nothing can be saved until it&apos;s back; retrying.
      </div>
    );
  }
  if (s.unsaved && s.slow) {
    return (
      <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-amber-950 print:hidden">
        <b>Slow connection: {n} still saving</b> (rows marked {dot}). Keep this tab open until this goes away.
      </div>
    );
  }
  return null;
}
/** The logged-in user. */
export const useMe = () => use(MeContext)!;

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  useEffect(() => { store.me = user.id; }, [user.id]); // passes this tab adds show who added them before the server answers
  useSyncLoop();
  const path = usePathname();
  const counts = useCounts();
  const status = useStatus();
  const trpc = useTRPC();
  // On narrow screens the tabs scroll sideways: keep the open sheet's tab in view.
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => { tabsRef.current?.querySelector('[aria-current=page]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [path]);
  // Their scrollbar is hidden (the owner, 2026-11-16), so a mouse wheel scrolls them sideways.
  useEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || nav.scrollWidth <= nav.clientWidth) return;
      e.preventDefault();
      nav.scrollLeft += e.deltaY;
    };
    nav.addEventListener('wheel', onWheel, { passive: false });
    return () => nav.removeEventListener('wheel', onWheel);
  }, []);
  const logout = useMutation(trpc.auth.logout.mutationOptions({ onSettled: () => window.location.assign('/login') }));
  const pages = [
    { href: '/people', label: 'People' },
    { href: '/packets', label: 'Packets' },
    { href: '/report', label: 'Report' },
    { href: '/history', label: 'History' },
    ...(user.is_admin ? [{ href: '/users', label: 'Users' }, { href: '/settings', label: 'Settings' }] : []),
  ];

  return (
    <MeContext value={user}>
      <div className="group/app flex h-dvh flex-col print:block print:h-auto" data-unsaved={stuck(status) || undefined}>
        <header className="shrink-0 bg-primary text-primary-foreground print:hidden">
          <div className="flex h-11 items-center gap-5 px-4">
            <Link href="/s/mobile-pandal" className="flex items-baseline gap-1.5 font-condensed text-[19px] leading-none">
              <span className="font-bold">RSSB SKP</span>
              <span className="text-white/75">Pass Register</span>
            </Link>
            <nav className="flex items-center gap-1 text-[14.5px]">
              {pages.map((l) => {
                const on = path === l.href;
                return (
                  <Link
                    key={l.href} href={l.href} aria-current={on ? 'page' : undefined}
                    className={`rounded-[3px] px-2.5 py-1 ${on ? 'bg-white/15 font-semibold text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
            <span className="flex-1" />
            <PersonSearch />
            <PrintQueueButton />
            {status.saving && <span role="status" className="text-[13.5px] text-white/75">Saving…</span>}
            <span className="flex items-center gap-2 text-[14.5px] text-white/90">
              <span aria-hidden className="grid size-6 place-items-center rounded-full bg-white/15 text-[12.5px] font-bold">
                {user.name.trim().charAt(0).toUpperCase()}
              </span>
              {user.name}
            </span>
            <button className="-mr-2 rounded-[3px] px-2 py-1 text-[14px] text-white/75 hover:bg-white/10 hover:text-white" onClick={() => logout.mutate()}>
              Log out
            </button>
          </div>
          {/* The sheets, as tabs of the register. The open one joins the page below. */}
          {/* Mobile, Bike and Vehicle sheets in three groups. Below 1440 px only the open tab shows its count (the others on hover). */}
          <nav ref={tabsRef} className="flex items-end overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Sheets">
            {SHEETS.map((t, i) => {
              const on = path === `/s/${t}`;
              const newGroup = i > 0 && groupOf(t) !== groupOf(SHEETS[i - 1]);
              return (
                <Fragment key={t}>
                  {newGroup && <span aria-hidden className="mx-1.5 mb-2.5 h-4 w-px shrink-0 bg-white/25 max-[1599px]:mx-1" />}
                  <Link
                    href={`/s/${t}`} prefetch aria-current={on ? 'page' : undefined} title={`${TYPE_INFO[t].label}: ${nPasses(counts[t])}`}
                    className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-[4px] border-t-[3px] px-2.5 text-[14.5px] max-[1599px]:gap-1 max-[1599px]:px-1.5 max-[1599px]:text-[13px] ${
                      on ? 'bg-background font-semibold text-foreground' : 'border-transparent text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                    style={on ? { borderTopColor: TYPE_INFO[t].color.band } : undefined}
                  >
                    <PassMark type={t} />
                    {TYPE_INFO[t].label}
                    <span
                      className={`ml-0.5 min-w-[1.7em] rounded-full px-1.5 text-center max-[1599px]:px-1 font-condensed text-[12.5px] font-normal leading-[18px] tabular-nums ${
                        on ? 'bg-muted text-muted-foreground' : `max-[1439px]:hidden ${counts[t] ? 'bg-white/15 text-white/90' : 'text-white/40'}`
                      }`}
                    >
                      {counts[t]}
                    </span>
                  </Link>
                </Fragment>
              );
            })}
          </nav>
        </header>

        <ConnectionBar status={status} />
        {status.backupError && (
          <div role="alert" className="border-b border-sand-200 bg-sand-100 px-4 py-1.5 text-sand-900 print:hidden">{status.backupError}</div>
        )}

        <div className="flex min-h-0 flex-1 print:block">
          {status.loaded ? children : <div className="m-auto text-muted-foreground">Loading passes…</div>}
        </div>
      </div>
      {status.loaded && <><PacketTray /><ScanCatcher /></>}
      <Toaster />
    </MeContext>
  );
}

/** A sheet's tab group: Mobile, Bike, Vehicle (every vehicle sheet, whatever its size), Helpline. */
const groupOf = (t: PassType) => {
  const { layout, helpline } = TYPE_INFO[t];
  return helpline ? 'helpline' : layout === 'mobile' || layout === 'bike' ? layout : 'vehicle';
};

/**
 * The sheet's mark: the shape of its pass (portrait Mobile, landscape Bike, wide Vehicle) in the
 * template's colours, so sheets that share a colour still look different.
 */
export function PassMark({ type, size = 14 }: { type: PassType; size?: number }) {
  const { layout, color: c } = TYPE_INFO[type];
  const [w, h] = layout === 'mobile' ? [10, 14] : layout === 'bike' || layout === 'gate' ? [14, 10] : [16, 11];
  const band = layout === 'mobile' ? 4 : 3;
  return (
    <svg aria-hidden width={(w * size) / 14} height={(h * size) / 14} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={1} fill={c.bg} stroke={c.band} />
      <rect x={0.5} y={0.5} width={w - 1} height={band} fill={c.band} />
      <rect x={0.5} y={h - 2} width={w - 1} height={1.5} fill={c.band} />
    </svg>
  );
}

function Toaster() {
  const t = useToast();
  if (!t) return null;
  return (
    <div
      key={t.id}
      role={t.kind === 'error' ? 'alert' : 'status'}
      onClick={dismissToast}
      className={`fixed bottom-5 left-1/2 z-50 max-w-[80vw] -translate-x-1/2 cursor-pointer rounded-[3px] px-4 py-2.5 text-[15px] text-white shadow-[0_6px_24px_rgb(35_31_32/0.25)] print:hidden ${
        t.kind === 'error' ? 'bg-destructive' : 'bg-foreground'
      }`}
    >
      {t.text}
    </div>
  );
}
