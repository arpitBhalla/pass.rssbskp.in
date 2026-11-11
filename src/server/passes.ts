import 'server-only';
import { TRPCError } from '@trpc/server';
import { type Kysely, type Transaction, sql } from 'kysely';
import {
  type ApplyRequest, type ApplyResult, type Change, type CreateOp, type Field, FIELD_LABELS, FIELDS, fieldsFor, fmtSerial, cleanText,
  MAX_BATCH, type Pass, type PassType, type SetOp, type SyncResult, TYPE_INFO, type UndoResult, type Values,
} from '@/shared/types';
import type { ChangeBefore, Database, PassRow } from './db/schema';

const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });
const conflict = (message: string) => new TRPCError({ code: 'CONFLICT', message });

const PASS_COLUMNS = ['id', 'type', 'serial', 'name', 'dept', 'area', 'phone', 'vehicle', 'vehicle_no', 'incharge', 'printed_at', 'created_at', 'created_by', 'updated_by', 'rev'] as const;

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

export function toPass(r: Pick<PassRow, (typeof PASS_COLUMNS)[number]>): Pass {
  return {
    id: r.id, type: r.type, serial: r.serial, name: r.name, dept: r.dept, area: r.area, phone: r.phone,
    vehicle: r.vehicle, vehicle_no: r.vehicle_no, incharge: r.incharge, printed_at: iso(r.printed_at), created_at: iso(r.created_at)!, created_by: r.created_by, updated_by: r.updated_by, rev: r.rev,
  };
}

/** "0101–0103, 0107" */
export function serialList(serials: number[]): string {
  const s = [...new Set(serials)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? fmtSerial(s[i]) : `${fmtSerial(s[i])}–${fmtSerial(s[j])}`);
    i = j + 1;
  }
  return out.length > 6 ? `${out.slice(0, 6).join(', ')}, …` : out.join(', ');
}
const isAre = (n: number) => (n === 1 ? 'was' : 'were');

/** Next database version. Locks the meta row, so writes are saved one at a time and in order. */
async function bump(trx: Transaction<Database>): Promise<number> {
  const { version } = await trx
    .updateTable('meta')
    .set((eb) => ({ version: eb('version', '+', 1) }))
    .where('id', '=', 1)
    .returning('version')
    .executeTakeFirstOrThrow();
  return version;
}

function cleanValues(v: Values | undefined): Values {
  const out: Values = {};
  for (const k of FIELDS) if (v?.[k] !== undefined) out[k] = cleanText(v[k]!);
  return out;
}

/** Turns database errors into messages a person can act on. */
function explain(e: unknown): unknown {
  const code = (e as { code?: string }).code;
  if (code === '23505') return conflict('Some of these passes already exist. The sheet has been refreshed: check and try again.');
  if (code === '23514') return bad('A value is too long or not allowed here.');
  if (code === '40001' || code === '40P01') return conflict('Several desks saved at the same moment. Please try again.');
  return e;
}

async function userName(trx: Kysely<Database>, id: number) {
  return (await trx.selectFrom('users').select('name').where('id', '=', id).executeTakeFirst())?.name ?? 'someone';
}

/** Refuses values for columns the sheet doesn't have (e.g. Reg. No. on a Mobile pass). */
function checkFields(type: PassType, values: Values = {}) {
  const allowed = fieldsFor(type);
  const extra = (Object.keys(values) as Field[]).find((k) => values[k] && !allowed.includes(k));
  if (extra) throw bad(`${TYPE_INFO[type].label} passes have no ${FIELD_LABELS[extra]}.`);
}

/**
 * Saves one user action (give, edit, paste, print, import): all of it, or nothing.
 * Refused if any pass changed since the user saw it, if a printed pass would change, or if a
 * pass to create already exists.
 */
export async function applyChange(db: Kysely<Database>, userId: number, req: ApplyRequest): Promise<ApplyResult> {
  const set: SetOp[] = (req.set ?? []).map((o) => ({ ...o, values: cleanValues(o.values) }));
  const create: CreateOp[] = (req.create ?? []).map((o) => ({ ...o, values: cleanValues(o.values) }));
  if (!set.length && !create.length) throw bad('Nothing to save.');
  if (set.length + create.length > MAX_BATCH) throw bad(`Please do at most ${MAX_BATCH} passes at a time.`);
  if (new Set(set.map((o) => o.id)).size !== set.length) throw bad('The same pass appears twice.');
  if (new Set(create.map((o) => `${o.type}|${o.serial}`)).size !== create.length) throw bad('The same serial appears twice.');
  for (const c of create) {
    checkFields(c.type, c.values);
  }

  try {
    return await db.transaction().execute(async (trx) => {
      const rev = await bump(trx);

      const current = set.length
        ? await trx.selectFrom('passes').selectAll().where('id', 'in', set.map((o) => o.id)).forUpdate().execute()
        : [];
      const byId = new Map(current.map((r) => [r.id, r]));
      const stale: PassRow[] = [];
      const locked: PassRow[] = [];
      const updates: Record<string, unknown>[] = [];
      for (const op of set) {
        const row = byId.get(op.id);
        if (!row) throw conflict('Some of these passes were removed meanwhile. The sheet has been refreshed.');
        const isStale = Object.entries(op.expect).some(([k, v]) =>
          k === 'printed' ? (row.printed_at !== null) !== v : row[k as Field] !== v,
        );
        if (isStale) { stale.push(row); continue; }
        const values = op.values ?? {};
        // A printed pass can't change at all until Printed is unticked (in a separate step).
        const differs = (Object.keys(values) as Field[]).some((k) => row[k] !== values[k]);
        if (row.printed_at !== null && differs) { locked.push(row); continue; }
        checkFields(row.type, values);
        const merged: Record<string, unknown> = { id: row.id, printed: op.printed ?? null };
        for (const k of FIELDS) merged[k] = values[k] ?? row[k];
        updates.push(merged);
      }
      if (stale.length) {
        const who = await userName(trx, stale[0].updated_by);
        throw conflict(`${serialList(stale.map((r) => r.serial))} ${isAre(stale.length)} just changed by ${who}. The sheet has been refreshed: check and try again.`);
      }
      if (locked.length) {
        throw bad(`${serialList(locked.map((r) => r.serial))} ${locked.length === 1 ? 'is' : 'are'} printed and can't be changed. Untick Printed first.`);
      }

      const updated = updates.length
        ? (await sql<PassRow>`
            UPDATE passes AS p SET
              name = v.name, dept = v.dept, area = v.area, phone = v.phone, vehicle = v.vehicle, vehicle_no = v.vehicle_no, incharge = v.incharge,
              printed_at = CASE WHEN v.printed IS NULL THEN p.printed_at WHEN v.printed THEN coalesce(p.printed_at, now()) ELSE NULL END,
              updated_at = now(), updated_by = ${userId}, rev = ${rev}
            FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
              AS v(id int, name text, dept text, area text, phone text, vehicle text, vehicle_no text, incharge text, printed boolean)
            WHERE p.id = v.id
            RETURNING p.*`.execute(trx)).rows
        : [];

      const createRows = create.map((c) => ({ type: c.type, serial: c.serial, printed: c.printed ?? false, ...c.values }));
      const created = create.length
        ? (await sql<PassRow>`
            INSERT INTO passes (type, serial, name, dept, area, phone, vehicle, vehicle_no, incharge, printed_at, created_by, updated_by, rev)
            SELECT v.type::pass_type, v.serial,
                   coalesce(v.name, ''), coalesce(v.dept, ''), coalesce(v.area, ''), coalesce(v.phone, ''),
                   coalesce(v.vehicle, ''), coalesce(v.vehicle_no, ''), coalesce(v.incharge, ''),
                   CASE WHEN v.printed THEN now() END, ${userId}, ${userId}, ${rev}
            FROM jsonb_to_recordset(${JSON.stringify(createRows)}::jsonb)
              AS v(type text, serial int, name text, dept text, area text, phone text, vehicle text, vehicle_no text, incharge text, printed boolean)
            ON CONFLICT (type, serial) DO NOTHING
            RETURNING *`.execute(trx)).rows
        : [];
      if (created.length < create.length) {
        const got = new Set(created.map((r) => `${r.type}|${r.serial}`));
        const taken = create.filter((c) => !got.has(`${c.type}|${c.serial}`));
        throw conflict(`${TYPE_INFO[taken[0].type].label} ${serialList(taken.map((c) => c.serial))} already exist (just added by another desk). The sheet has been refreshed: check and try again.`);
      }

      const rows = [...updated, ...created];
      const types = new Set(rows.map((r) => r.type));
      const serials = rows.map((r) => r.serial);
      const updatedIds = new Set(updated.map((r) => r.id));
      const before: ChangeBefore = {
        rows: JSON.parse(JSON.stringify(current.filter((r) => updatedIds.has(r.id)))),
        created: created.map((r) => r.id),
      };
      const { id: changeId } = await trx
        .insertInto('changes')
        .values({
          done_by: userId,
          action: req.action,
          type: types.size === 1 ? [...types][0] : null,
          serial_from: Math.min(...serials),
          serial_to: Math.max(...serials),
          summary: req.summary.slice(0, 300),
          count: rows.length,
          rev,
          before: JSON.stringify(before),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { changeId, rows: rows.map(toPass) };
    });
  } catch (e) {
    throw explain(e);
  }
}

/** Puts back what a change did, if none of its passes changed since. */
export async function undoChange(db: Kysely<Database>, userId: number, changeId: number): Promise<UndoResult> {
  try {
    return await db.transaction().execute(async (trx) => {
      const rev = await bump(trx);
      const ch = await trx.selectFrom('changes').selectAll().where('id', '=', changeId).forUpdate().executeTakeFirst();
      if (!ch) throw new TRPCError({ code: 'NOT_FOUND', message: 'That change no longer exists.' });
      if (ch.undone_at) throw bad('That was already undone.');
      if (ch.action === 'undo') throw bad('An undo cannot be undone.');

      const { rows: beforeRows, created } = ch.before;
      const ids = [...beforeRows.map((r) => r.id), ...created];
      const current = ids.length
        ? await trx.selectFrom('passes').select(['id', 'serial', 'rev', 'updated_by']).where('id', 'in', ids).forUpdate().execute()
        : [];
      const byId = new Map(current.map((r) => [r.id, r]));
      if (ids.some((id) => !byId.has(id))) throw conflict("Can't undo: some of these passes were removed since.");
      const moved = current.filter((r) => r.rev !== ch.rev);
      if (moved.length) {
        const who = await userName(trx, moved[0].updated_by);
        throw conflict(`Can't undo: ${serialList(moved.map((r) => r.serial))} ${isAre(moved.length)} changed afterwards (by ${who}). Change ${moved.length === 1 ? 'it' : 'them'} by hand instead.`);
      }

      if (created.length) {
        await trx.deleteFrom('passes').where('id', 'in', created).execute();
        await trx
          .insertInto('deleted_passes')
          .values(created.map((id) => ({ id, rev })))
          .onConflict((oc) => oc.column('id').doUpdateSet({ rev }))
          .execute();
      }
      const restored = beforeRows.length
        ? (await sql<PassRow>`
            UPDATE passes AS p SET
              name = v.name, dept = v.dept, area = v.area, phone = v.phone, vehicle = coalesce(v.vehicle, ''), vehicle_no = v.vehicle_no,
              incharge = v.incharge, printed_at = v.printed_at, updated_at = now(), updated_by = ${userId}, rev = ${rev}
            FROM jsonb_to_recordset(${JSON.stringify(beforeRows)}::jsonb)
              AS v(id int, name text, dept text, area text, phone text, vehicle text, vehicle_no text, incharge text, printed_at timestamptz)
            WHERE p.id = v.id
            RETURNING p.*`.execute(trx)).rows
        : [];

      await trx.updateTable('changes').set({ undone_at: new Date(), undone_by: userId }).where('id', '=', changeId).execute();
      await trx
        .insertInto('changes')
        .values({
          done_by: userId, action: 'undo', type: ch.type, serial_from: ch.serial_from, serial_to: ch.serial_to,
          summary: `Undo: ${ch.summary}`.slice(0, 300), count: ids.length, rev,
          before: JSON.stringify({ rows: [], created: [] } satisfies ChangeBefore),
        })
        .execute();
      return { rows: restored.map(toPass), deleted: created, summary: ch.summary };
    });
  } catch (e) {
    throw explain(e);
  }
}

/** Everything that changed after version `since` (0 = everything). */
export async function syncSince(db: Kysely<Database>, since: number): Promise<Omit<SyncResult, 'backupError'>> {
  const { version } = await db.selectFrom('meta').select('version').where('id', '=', 1).executeTakeFirstOrThrow();
  if (since === version) return { rev: version, rows: [], deleted: [], reset: false }; // the usual case: one cheap query
  const reset = since > version; // the database was replaced (e.g. restored from a backup)
  const from = reset ? 0 : since;
  return db.transaction().setIsolationLevel('repeatable read').execute(async (trx) => {
    const { version: rev } = await trx.selectFrom('meta').select('version').where('id', '=', 1).executeTakeFirstOrThrow();
    const rows = await trx.selectFrom('passes').select(PASS_COLUMNS).where('rev', '>', from).execute();
    const deleted = from > 0 ? await trx.selectFrom('deleted_passes').select(['id', 'rev']).where('rev', '>', from).execute() : [];
    return { rev, rows: rows.map(toPass), deleted, reset };
  });
}

export async function listChanges(db: Kysely<Database>, limit: number): Promise<Change[]> {
  const rows = await db
    .selectFrom('changes as c')
    .innerJoin('users as u', 'u.id', 'c.done_by')
    .leftJoin('users as x', 'x.id', 'c.undone_by')
    .select([
      'c.id', 'c.done_at', 'u.name as done_by', 'c.action', 'c.type', 'c.serial_from', 'c.serial_to',
      'c.summary', 'c.count', 'c.undone_at', 'x.name as undone_by',
    ])
    .orderBy('c.id', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({ ...r, action: r.action as Change['action'], done_at: iso(r.done_at)!, undone_at: iso(r.undone_at) }));
}
