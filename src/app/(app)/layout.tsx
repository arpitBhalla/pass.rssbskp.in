import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { currentUser } from '@/server/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.scan_only) redirect('/v'); // can only check passes
  return <AppShell user={user}>{children}</AppShell>;
}
