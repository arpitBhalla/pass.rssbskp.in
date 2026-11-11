import 'server-only';
import { Kysely, PostgresDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import pg from 'pg';
import { migrations } from './migrations';
import type { Database } from './schema';

export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/passes';

function create(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('Postgres pool error:', e.message)); // a dropped idle connection must not crash the server
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

// One pool per server process (survives hot reloads in development).
const g = globalThis as typeof globalThis & { __passDb?: Kysely<Database> };
export const db = (g.__passDb ??= create(DATABASE_URL));

/** Creates the database if it doesn't exist yet. */
export async function ensureDatabase(url = DATABASE_URL) {
  const probe = new pg.Client({ connectionString: url });
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
  const admin = new pg.Client({ connectionString: target.toString() });
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
