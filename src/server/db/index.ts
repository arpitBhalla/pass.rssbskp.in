import 'server-only';
import { attachDatabasePool } from '@vercel/functions';
import { Kysely, PostgresDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import pg from 'pg';
import { DO_CA } from './doCa';
import { migrations } from './migrations';
import type { Database } from './schema';

export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/passes';

/** True for a DigitalOcean managed database (its server certificate is signed by DO_CA). */
export const onDigitalOcean = (url: URL) => url.hostname.endsWith('.db.ondigitalocean.com');

/**
 * Connection settings for an address. A DigitalOcean server is always checked against DO_CA (like
 * sslmode=verify-full), whatever the address's ssl… settings say: a certificate file named in the address
 * (sslrootcert) isn't found when the server runs from another folder or on another machine.
 */
export function pgConfig(url: string): pg.ClientConfig {
  const u = new URL(url);
  if (!onDigitalOcean(u)) return { connectionString: url };
  return { connectionString: withoutSsl(u).toString(), ssl: { ca: DO_CA } };
}

/** The address without its ssl… settings (sslmode, sslrootcert, …). */
export function withoutSsl(url: URL): URL {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (k.startsWith('ssl') || k === 'uselibpqcompat') u.searchParams.delete(k);
  return u;
}

/**
 * Limits on waits, so a request can't hang until Vercel cuts it off after 5 minutes (as on 14 Nov). All are
 * kept at this end: production connects through DigitalOcean's connection pool (PgBouncer), which refuses
 * any connection that asks for database settings such as statement_timeout.
 */
export const LIMITS = {
  connectionTimeoutMillis: 10_000,
  query_timeout: 25_000, // give up on an answer that never comes (a connection dropped on the way)
  keepAlive: true,
} satisfies pg.ClientConfig;

function create(url: string) {
  // Vercel pauses a server between requests: idle connections close after 5 s there, and attachDatabasePool
  // keeps the server awake until they have (it does nothing anywhere else).
  const idleTimeoutMillis = process.env.VERCEL ? 5_000 : 30_000;
  const pool = new pg.Pool({ ...pgConfig(url), ...LIMITS, max: 10, idleTimeoutMillis });
  pool.on('error', (e) => console.error('Postgres pool error:', e.message)); // a dropped idle connection must not crash the server
  attachDatabasePool(pool);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

// One pool per server process (survives hot reloads in development).
const g = globalThis as typeof globalThis & { __passDb?: Kysely<Database> };
export const db = (g.__passDb ??= create(DATABASE_URL));

/** Creates the database if it doesn't exist yet. */
export async function ensureDatabase(url = DATABASE_URL) {
  const probe = new pg.Client({ ...pgConfig(url), ...LIMITS });
  try {
    await probe.connect();
    return;
  } catch (e) {
    if ((e as { code?: string }).code !== '3D000') throw e; // 3D000 = database does not exist
  } finally {
    await probe.end().catch(() => {});
  }
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Unusual database name "${name}": please create it yourself.`);
  target.pathname = '/postgres';
  const admin = new pg.Client({ ...pgConfig(target.toString()), ...LIMITS });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    console.log(`Created database "${name}".`);
  } finally {
    await admin.end();
  }
}

/** Applies pending migrations. Throws (stopping the server) if one fails. */
export async function migrate(kysely: Kysely<Database> = db) {
  const migrator = new Migrator({ db: kysely, provider: { getMigrations: async () => migrations } });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === 'Success') console.log(`Applied migration ${r.migrationName}`);
    if (r.status === 'Error') console.error(`Migration ${r.migrationName} failed`);
  }
  if (error) throw error;
}
