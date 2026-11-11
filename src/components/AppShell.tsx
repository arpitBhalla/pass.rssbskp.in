'use client';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, type ReactNode, use } from 'react';
import { useSyncLoop } from '@/client/actions';
import { useCounts, useStatus } from '@/client/store';
import { dismissToast, useToast } from '@/client/toast';
import { useTRPC } from '@/client/trpc';
import { PASS_TYPES, type PassType, TYPE_INFO, type User } from '@/shared/types';

const MeContext = createContext<User | null>(null);
/** The logged-in user. */
export const useMe = () => use(MeContext)!;

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  useSyncLoop();
  const path = usePathname();
  const counts = useCounts();
  const status = useStatus();
  const trpc = useTRPC();
  const logout = useMutation(trpc.auth.logout.mutationOptions({ onSettled: () => window.location.assign('/login') }));
  const pages = [
    { href: '/report', label: 'Report' },
    { href: '/history', label: 'History' },
    ...(user.is_admin ? [{ href: '/users', label: 'Users' }, { href: '/settings', label: 'Settings' }] : []),
  ];

  return (
    <MeContext value={user}>
      <div className="flex h-dvh flex-col print:block print:h-auto">
        <header className="shrink-0 bg-primary text-primary-foreground print:hidden">
          <div className="flex h-11 items-center gap-6 px-4">
            <Link href="/s/mobile-pandal" className="font-condensed text-[19px] font-bold leading-none">RSSB SKP Pass Register</Link>
            <nav className="flex items-center gap-5 text-[14.5px]">
              {pages.map((l) => (
                <Link
                  key={l.href} href={l.href} aria-current={path === l.href ? 'page' : undefined}
                  className={path === l.href ? 'font-semibold underline decoration-2 underline-offset-[7px]' : 'text-white/75 hover:text-white'}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <span className="flex-1" />
            <span className="text-white/75">{user.name}</span>
            <button className="text-white/75 hover:text-white hover:underline" onClick={() => logout.mutate()}>Log out</button>
          </div>
          {/* The sheets, as tabs of the register. The open one joins the page below. */}
          <nav className="flex items-end gap-0.5 overflow-x-auto px-3" aria-label="Sheets">
            {PASS_TYPES.map((t) => {
              const on = path === `/s/${t}`;
              return (
                <Link
                  key={t} href={`/s/${t}`} prefetch aria-current={on ? 'page' : undefined}
                  className={`flex h-9 items-center gap-2 whitespace-nowrap rounded-t-[4px] border-t-[3px] px-3 text-[14.5px] ${
                    on ? 'bg-background font-semibold text-foreground' : 'border-transparent text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                  style={on ? { borderTopColor: TYPE_INFO[t].color.band } : undefined}
                >
                  <PassMark type={t} />
                  {TYPE_INFO[t].label}
                  <span className={`font-condensed tabular-nums ${on ? 'font-normal text-muted-foreground' : 'text-white/60'}`}>{counts[t]}</span>
                </Link>
              );
            })}
          </nav>
        </header>

        {!status.online && (
          <div role="alert" className="bg-destructive px-4 py-1.5 font-semibold text-white print:hidden">
            Can&apos;t reach the server. Nothing can be saved until it&apos;s back; retrying.
          </div>
        )}
        {status.backupError && (
          <div role="alert" className="border-b border-sand-200 bg-sand-100 px-4 py-1.5 text-sand-900 print:hidden">{status.backupError}</div>
        )}

        <div className="flex min-h-0 flex-1 print:block">
          {status.loaded ? children : <div className="m-auto text-muted-foreground">Loading passes…</div>}
        </div>
      </div>
      <Toaster />
    </MeContext>
  );
}

/**
 * The sheet's mark: the shape of its pass (portrait Mobile, landscape Bike, wide Vehicle) in the
 * template's colours, so sheets that share a colour still look different.
 */
export function PassMark({ type, size = 14 }: { type: PassType; size?: number }) {
  const { layout, color: c } = TYPE_INFO[type];
  const [w, h] = layout === 'mobile' ? [10, 14] : layout === 'bike' ? [14, 10] : [16, 11];
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
