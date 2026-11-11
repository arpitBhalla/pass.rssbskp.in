import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { currentUser, needsSetup } from '@/server/session';

/** Where to go after logging in: a path on this site only (e.g. back to a pass check), else home. */
const safeNext = (v: unknown) => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : '/');

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return <LoginForm setup={await needsSetup()} next={next} />;
}
