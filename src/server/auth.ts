import 'server-only';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Kysely } from 'kysely';
import type { User } from '@/shared/types';
import type { Database } from './db/schema';

export const SESSION_COOKIE = 'pass_session';
export const SESSION_DAYS = 30;

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Starts a session; returns the token for the cookie (only its hash is stored). */
export async function createSession(db: Kysely<Database>, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db
    .insertInto('sessions')
    .values({ id: sha256(token), user_id: userId, expires_at: new Date(Date.now() + SESSION_DAYS * 864e5) })
    .execute();
  return token;
}

export async function deleteSession(db: Kysely<Database>, token: string) {
  sessionCache.delete(token);
  await db.deleteFrom('sessions').where('id', '=', sha256(token)).execute();
}

/** Forgets cached sessions of a user (after they're deactivated or changed). */
export function forgetUser(userId: number) {
  for (const [k, v] of sessionCache) if (v.user?.id === userId) sessionCache.delete(k);
}

// Every request checks the session; a short cache saves a query per poll.
const sessionCache = new Map<string, { user: User | null; at: number }>();
const CACHE_MS = 20_000;

export async function sessionUser(db: Kysely<Database>, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const hit = sessionCache.get(token);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['users.id', 'users.username', 'users.name', 'users.is_admin', 'users.active'])
    .where('sessions.id', '=', sha256(token))
    .where('sessions.expires_at', '>', new Date())
    .where('users.active', '=', true)
    .executeTakeFirst();
  const user = row ?? null;
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(token, { user, at: Date.now() });
  return user;
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_DAYS * 86400) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/* ----- slows down password guessing: 10 failed tries per username per 10 minutes ----- */
const failures = new Map<string, { n: number; until: number }>();

export function loginBlocked(username: string): boolean {
  const f = failures.get(username);
  return !!f && f.n >= 10 && Date.now() < f.until;
}

export function noteLogin(username: string, ok: boolean) {
  if (ok) return void failures.delete(username);
  const f = failures.get(username);
  const fresh = !f || Date.now() > f.until;
  failures.set(username, { n: fresh ? 1 : f.n + 1, until: fresh ? Date.now() + 10 * 60_000 : f.until });
}
