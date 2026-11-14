import 'server-only';
import { startBackups } from './backup';
import { DATABASE_URL, ensureDatabase, migrate } from './db';

/** Creates the database if needed, applies migrations and starts backups. Throws if Postgres is unreachable. */
export async function startup() {
  const where = DATABASE_URL.replace(/\/\/[^@/]*@/, '//***@'); // never print a password
  try {
    await ensureDatabase();
    await migrate();
  } catch (e) {
    console.error(`\n✖ Can't use the database at ${where}\n  ${(e as Error).message}\n` +
      '  Is Postgres running? (macOS: brew services start postgresql@15)\n' +
      '  Set DATABASE_URL in .env.local if it lives elsewhere.\n');
    throw e;
  }
  if (process.env.NODE_ENV !== 'test') startBackups();
}

let started: Promise<void> | null = null;

/**
 * The database is ready (created and migrated): the server starts it, and every request waits for it.
 * If it failed (Postgres was down for a moment), the next request tries again, so the server recovers
 * on its own instead of failing every request until it restarts.
 */
export function ready(): Promise<void> {
  started ??= startup().catch((e) => {
    started = null;
    throw e;
  });
  return started;
}
