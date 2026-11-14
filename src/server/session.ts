import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionUser } from './auth';
import { db } from './db';
import { ready } from './startup';

/** The logged-in user for a page render, or null. */
export async function currentUser() {
  await ready();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionUser(db, token);
}

export async function needsSetup() {
  await ready();
  return !(await db.selectFrom('users').select('id').limit(1).executeTakeFirst());
}
