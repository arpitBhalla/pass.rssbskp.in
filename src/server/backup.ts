import 'server-only';
import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DATABASE_URL, db } from './db';

const run = promisify(execFile);
const DIR = resolve(/*turbopackIgnore: true*/ process.env.BACKUP_DIR || 'backups');
const EVERY_MS = 30 * 60_000;
const KEEP = 48; // a day of half-hourly backups, plus a few

// pg_dump may not be on PATH (Homebrew's postgresql@15 is "keg-only").
const PG_DUMP = [
  process.env.PG_DUMP,
  'pg_dump',
  '/opt/homebrew/opt/postgresql@15/bin/pg_dump',
  '/opt/homebrew/opt/postgresql@16/bin/pg_dump',
  '/opt/homebrew/opt/postgresql@17/bin/pg_dump',
  '/opt/homebrew/bin/pg_dump',
  '/usr/local/bin/pg_dump',
  '/usr/bin/pg_dump',
].filter((p): p is string => !!p);

const state = { lastVersion: -1, error: '', file: '' };

/** '' when the last backup worked; otherwise why it failed (shown as a banner in the app). */
export const backupError = () => state.error;

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

/** Writes a pg_dump (custom format, restore with pg_restore) if anything changed since the last one. */
export async function backupNow(reason: string): Promise<void> {
  const { version } = await db.selectFrom('meta').select('version').where('id', '=', 1).executeTakeFirstOrThrow();
  if (version === state.lastVersion) return;
  await mkdir(/*turbopackIgnore: true*/ DIR, { recursive: true });
  const file = join(DIR, `passes-${stamp()}-${reason}.dump`);
  let lastErr: unknown;
  for (const bin of PG_DUMP) {
    try {
      await run(bin, ['--format=custom', `--file=${file}`, `--dbname=${DATABASE_URL}`], { timeout: 5 * 60_000 });
      Object.assign(state, { lastVersion: version, error: '', file });
      await prune();
      return;
    } catch (e) {
      lastErr = e;
      if ((e as { code?: string }).code !== 'ENOENT') break; // pg_dump ran and failed: don't try others
    }
  }
  await rm(file, { force: true });
  const msg = (lastErr as { code?: string }).code === 'ENOENT'
    ? 'pg_dump was not found, so no automatic backups are being made. Install PostgreSQL client tools or set PG_DUMP.'
    : `Automatic backup failed: ${(lastErr as Error).message.split('\n')[0]}`;
  state.error = msg;
  console.error(msg);
}

async function prune() {
  const files = (await readdir(/*turbopackIgnore: true*/ DIR)).filter((f) => f.startsWith('passes-') && f.endsWith('.dump'));
  const dated = await Promise.all(files.map(async (f) => ({ f, t: (await stat(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ DIR, f))).mtimeMs })));
  dated.sort((a, b) => b.t - a.t);
  await Promise.all(dated.slice(KEEP).map(({ f }) => rm(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ DIR, f), { force: true })));
}

/** One backup at start, then every 30 minutes while something changes. */
export function startBackups() {
  const g = globalThis as typeof globalThis & { __passBackups?: NodeJS.Timeout };
  if (g.__passBackups) return;
  const tick = (reason: string) => backupNow(reason).catch((e) => { state.error = `Automatic backup failed: ${e.message}`; console.error(state.error); });
  void tick('start');
  g.__passBackups = setInterval(() => tick('auto'), EVERY_MS);
  g.__passBackups.unref();
  console.log(`Automatic backups go to ${DIR}`);
}
