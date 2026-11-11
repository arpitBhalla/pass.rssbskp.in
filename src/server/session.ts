import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionUser } from './auth';
import { db } from './db';

/** The logged-in user for a page render, or null. */
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionUser(db, token);
}

export async function needsSetup() {
  return !(await db.selectFrom('users').select('id').limit(1).executeTakeFirst());
}
