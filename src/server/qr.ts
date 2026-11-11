import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Kysely } from 'kysely';
import { PASS_TYPES, type PassType } from '@/shared/types';
import type { Database } from './db/schema';

/*
 * The code in each pass's QR. The QR holds a link: <check address>/v#<code>.
 *
 *   bytes = [0] format (2)
 *           [1] key id: first byte of a hash of the secret
 *           [2] sheet: index in PASS_TYPES (so never reorder PASS_TYPES)
 *           [3..5] serial, 24-bit big-endian
 *           [6..8] name hash: first 3 bytes of SHA-256 of the name as printed (trimmed, upper case)
 *           [9..18] tag: HMAC-SHA256 with the server's secret over "RSSB-SKP-PASS" ‖ bytes 0..8, first 10 bytes
 *   code  = the 19 bytes as one decimal number: always 44 digits (QR numeric mode packs digits densest)
 *
 * Only the server knows the secret, so only it can make or check a tag: a copied design can't make a pass
 * that checks VALID, and the gate needs a connection to the server. Short on purpose: the QR stays at
 * 33 × 33 squares, big enough per square to scan easily on a small pass. A new secret (Settings) makes
 * every pass printed before it invalid.
 */

const FORMAT = 2;
const HEAD = 9;
const TAG = 10;
const DOMAIN = Buffer.from('RSSB-SKP-PASS');
const SECRET = 'qr_secret';

export interface Keys {
  secret: Buffer;
  kid: number;
  /** Short id shown in Settings, e.g. "3FA2C4D1". */
  fingerprint: string;
}

/** A new secret, base64url. */
export const newSecret = () => randomBytes(32).toString('base64url');

export function toKeys(secret: string): Keys {
  const s = Buffer.from(secret, 'base64url');
  const id = createHash('sha256').update('RSSB-SKP-KEY-ID').update(s).digest();
  return { secret: s, kid: id[0], fingerprint: id.subarray(0, 4).toString('hex').toUpperCase() };
}

/** The current keys, or null before the first print. */
export async function currentKeys(db: Kysely<Database>): Promise<(Keys & { since: Date }) | null> {
  const row = await db.selectFrom('settings').select(['value', 'updated_at']).where('key', '=', SECRET).executeTakeFirst();
  return row ? { ...toKeys(row.value), since: row.updated_at } : null;
}

/** Makes a secret. `replace`: also when one exists (Settings → New key); otherwise keeps the existing one. */
export async function makeKeys(db: Kysely<Database>, userId: number, replace: boolean) {
  const value = newSecret();
  const q = db.insertInto('settings').values({ key: SECRET, value, updated_by: userId });
  await (replace
    ? q.onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_by: userId, updated_at: new Date() }))
    : q.onConflict((oc) => oc.column('key').doNothing())
  ).execute();
  return (await currentKeys(db))!;
}

/** The current keys, made on first use (the first print). */
export async function keysFor(db: Kysely<Database>, userId: number) {
  return (await currentKeys(db)) ?? makeKeys(db, userId, false);
}

/** The name as printed on the pass. */
export const printedName = (name: string) => name.trim().toUpperCase();

const nameHash = (name: string) => createHash('sha256').update(printedName(name)).digest().subarray(0, 3);
const tagOf = (keys: Keys, head: Buffer) => createHmac('sha256', keys.secret).update(DOMAIN).update(head).digest().subarray(0, TAG);

const toDigits = (b: Buffer) => BigInt(`0x${b.toString('hex')}`).toString(10);

function fromDigits(code: string): Buffer | null {
  if (!/^[1-9]\d{0,59}$/.test(code)) return null;
  const hex = BigInt(code).toString(16);
  return Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
}

export function makeCode(keys: Keys, type: PassType, serial: number, name: string): string {
  const head = Buffer.concat([
    Buffer.from([FORMAT, keys.kid, PASS_TYPES.indexOf(type), (serial >> 16) & 255, (serial >> 8) & 255, serial & 255]),
    nameHash(name),
  ]);
  return toDigits(Buffer.concat([head, tagOf(keys, head)]));
}

export type CodeCheck =
  | { why: 'unreadable' }
  | { why: 'valid' | 'fake' | 'old-key'; type: PassType; serial: number; nameHash: Buffer };

/** Reads a code and checks its tag against the current secret. */
export function checkCode(keys: Keys | null, code: string): CodeCheck {
  const raw = fromDigits(code.trim());
  if (!raw || raw.length !== HEAD + TAG || raw[0] !== FORMAT || raw[2] >= PASS_TYPES.length) return { why: 'unreadable' };
  const head = raw.subarray(0, HEAD);
  const info = { type: PASS_TYPES[raw[2]], serial: (raw[3] << 16) | (raw[4] << 8) | raw[5], nameHash: Buffer.from(raw.subarray(6, HEAD)) };
  if (!keys || raw[1] !== keys.kid) return { why: keys ? 'old-key' : 'fake', ...info };
  return { why: timingSafeEqual(tagOf(keys, head), raw.subarray(HEAD)) ? 'valid' : 'fake', ...info };
}

/** True when the name hash in a code is that of `name` (as printed). */
export const hashOfName = (hash: Buffer, name: string) => hash.equals(nameHash(name));
