import 'server-only';
import { startBackups } from './backup';
import { DATABASE_URL, ensureDatabase, migrate } from './db';

/** Creates the database if needed, applies migrations and starts backups. Stops the server if Postgres is unreachable. */
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
