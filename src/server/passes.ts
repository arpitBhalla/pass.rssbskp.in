import 'server-only';
import { TRPCError } from '@trpc/server';
import { type Kysely, type Transaction, sql } from 'kysely';
import {
  type ApplyRequest, type ApplyResult, type Change, type CreateOp, type Field, FIELD_LABELS, FIELDS, fieldsFor, fmtSerial, cleanField,
  type DeleteRequest, type DeleteResult, FLAG_LABELS, FLAGS, type Flags, flagsFor, locksWhenPrinted, MAX_BATCH, MAX_SERIAL, type Pass, type PassMeta,
  type PassType, type SetOp, type SyncResult, TYPE_INFO, type UndoResult, type Values, withFlags, cleanPacket,
} from '@/shared/types';
import type { ChangeBefore, Database, PassRow, PassRowJson } from './db/schema';

const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });
const conflict = (message: string) => new TRPCError({ code: 'CONFLICT', message });

const PASS_COLUMNS = ['id', 'type', 'serial', 'name', 'dept', 'area', 'phone', 'vehicle', 'vehicle_no', 'incharge', 'issued_to', 'printed_at', 'given_at', 'printed_by', 'given_by', 'meta', 'packet', 'lost_at', 'copy_of', 'created_at', 'created_by', 'updated_by', 'rev'] as const;

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

export function toPass(r: Pick<PassRow, (typeof PASS_COLUMNS)[number]>): Pass {
  return {
    id: r.id, type: r.type, serial: r.serial, name: r.name, dept: r.dept, area: r.area, phone: r.phone,
    vehicle: r.vehicle, vehicle_no: r.vehicle_no, incharge: r.incharge, issued_to: r.issued_to, printed_at: iso(r.printed_at), given_at: iso(r.given_at), printed_by: r.printed_by ?? null, given_by: r.given_by ?? null, meta: r.meta ?? {}, packet: r.packet ?? '', lost_at: iso(r.lost_at ?? null), copy_of: r.copy_of ?? null, created_at: iso(r.created_at)!, created_by: r.created_by, updated_by: r.updated_by, rev: r.rev,
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

/**
 * Called first in every write: locks the meta row, so writes are saved one at a time and in order.
 * Returns the change already made by this request, if it was sent before (the desk never got the
 * answer, e.g. the connection dropped, and sent it again).
 */
async function sentBefore(trx: Transaction<Database>, userId: number, requestId: string | undefined) {
  await sql`SELECT 1 FROM meta WHERE id = 1 FOR UPDATE`.execute(trx);
  if (!requestId) return undefined;
  return trx.selectFrom('changes').select(['id', 'rev', 'before', 'summary'])
    .where('request_id', '=', requestId).where('done_by', '=', userId).executeTakeFirst();
}

/** These passes as they are now (any that were deleted since are left out). */
async function passesNow(trx: Transaction<Database>, ids: number[]): Promise<Pass[]> {
  if (!ids.length) return [];
  return (await trx.selectFrom('passes').select(PASS_COLUMNS).where('id', 'in', ids).execute()).map(toPass);
}

/** Next database version (the meta row is locked by `sentBefore`). */
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
  for (const k of FIELDS) if (v?.[k] !== undefined) out[k] = cleanField(k, v[k]!);
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

/** Refuses values for columns the sheet doesn't have (e.g. Reg. No. on a Mobile pass), and ticks it has no column for. */
function checkFields(type: PassType, values: Values = {}, flags: Flags = {}) {
  const allowed = fieldsFor(type);
  const extra = (Object.keys(values) as Field[]).find((k) => values[k] && !allowed.includes(k));
  if (extra) throw bad(`${TYPE_INFO[type].label} passes have no ${FIELD_LABELS[extra]}.`);
  const flag = FLAGS.find((f) => flags[f] && !flagsFor(type).includes(f));
  if (flag) throw bad(`${TYPE_INFO[type].label} passes have no ${FLAG_LABELS[flag]}.`);
}

/** Whether flag `f` is ticked on this pass. */
const ticked = (meta: PassMeta | null | undefined, f: string) => !!meta?.[f as keyof PassMeta];

/**
 * Saves one user action (give, edit, paste, print, import): all of it, or nothing.
 * Refused if any pass changed since the user saw it, if a printed pass would change, or if a
 * pass to create already exists.
 */
export async function applyChange(db: Kysely<Database>, userId: number, req: ApplyRequest): Promise<ApplyResult> {
  const set: SetOp[] = (req.set ?? []).map((o) => ({ ...o, values: cleanValues(o.values), ...(o.packet !== undefined && { packet: cleanPacket(o.packet) }) }));
  const create: CreateOp[] = (req.create ?? []).map((o) => ({ ...o, values: cleanValues(o.values) }));
  if (!set.length && !create.length) throw bad('Nothing to save.');
  if (set.length + create.length > MAX_BATCH) throw bad(`Please do at most ${MAX_BATCH} passes at a time.`);
  if (new Set(set.map((o) => o.id)).size !== set.length) throw bad('The same pass appears twice.');
  if (new Set(create.map((o) => `${o.type}|${o.serial}`)).size !== create.length) throw bad('The same serial appears twice.');
  // A duplicate is added only with its pass being marked lost, in the same change (Undo takes back both).
  const losing = new Set(set.filter((o) => o.lost).map((o) => o.id));
  for (const c of create) {
    checkFields(c.type, c.values, c.flags);
    if (c.copy_of !== undefined && !losing.has(c.copy_of)) throw bad('A duplicate is added only when its pass is marked lost.');
  }

  try {
    return await db.transaction().execute(async (trx) => {
      const done = await sentBefore(trx, userId, req.requestId);
      if (done) {
        const { rows, created } = done.before;
        return { changeId: done.id, rows: await passesNow(trx, [...rows.map((r) => r.id), ...created]), created };
      }
      const rev = await bump(trx);

      const current = set.length
        ? await trx.selectFrom('passes').selectAll().where('id', 'in', set.map((o) => o.id)).forUpdate().execute()
        : [];
      const byId = new Map(current.map((r) => [r.id, r]));
      const stale: PassRow[] = [];
      const locked: PassRow[] = [];
      const unprinted: PassRow[] = [];
      const unpackable: PassRow[] = [];
      const lostLocked: PassRow[] = [];
      const updates: Record<string, unknown>[] = [];
      for (const op of set) {
        const row = byId.get(op.id);
        if (!row) throw conflict('Some of these passes were removed meanwhile. The sheet has been refreshed.');
        const isStale = Object.entries(op.expect).some(([k, v]) =>
          k === 'printed' ? (row.printed_at !== null) !== v : k === 'given' ? (row.given_at !== null) !== v
            : k === 'lost' ? (row.lost_at !== null) !== v
            : k === 'flags' ? Object.entries(v as Flags).some(([f, on]) => ticked(row.meta, f) !== on)
              : k === 'packet' ? row.packet !== cleanPacket(v as string) : row[k as Field] !== v,
        );
        // Taking a completely empty pass: someone may have started filling it in meanwhile.
        const filled = row.printed_at !== null || row.given_at !== null || FIELDS.some((k) => row[k] !== '') || Object.keys(row.meta ?? {}).length > 0
          || row.packet !== '';
        if (isStale || (op.claim && filled)) { stale.push(row); continue; }
        // A lost pass is locked: nothing changes on it but Lost itself. Only a printed pass can be lost.
        if (row.lost_at !== null && op.lost !== false) { lostLocked.push(row); continue; }
        if (op.lost && row.printed_at === null && !op.printed) { unprinted.push(row); continue; }
        const values = op.values ?? {};
        // A printed pass can't change until Printed is unticked (in a separate step), except who it was issued to.
        const meta = withFlags(row.meta ?? {}, op.flags);
        const differs = (Object.keys(values) as Field[]).some((k) => locksWhenPrinted(k) && row[k] !== values[k])
          || FLAGS.some((f) => ticked(row.meta, f) !== ticked(meta, f)); // a tick prints on the pass
        if (row.printed_at !== null && differs) { locked.push(row); continue; }
        // Only a printed pass not given yet goes in a packet (the owner, 2026-11-24); taking one out is always allowed.
        if (op.packet && op.packet !== row.packet && (row.printed_at === null || row.given_at !== null)) { unpackable.push(row); continue; }
        // A pass is printed first, then handed over: Given needs Printed (unticking either is always allowed).
        if (op.given && row.given_at === null && !(op.printed ?? row.printed_at !== null)) { unprinted.push(row); continue; }
        checkFields(row.type, values, op.flags);
        // The packet a pass goes in may change once printed: packing comes after printing.
        const merged: Record<string, unknown> = {
          id: row.id, printed: op.printed ?? null, given: op.given ?? null, claim: !!op.claim, meta, packet: op.packet ?? row.packet, lost: op.lost ?? null,
        };
        for (const k of FIELDS) merged[k] = values[k] ?? row[k];
        updates.push(merged);
      }
      if (stale.length) {
        const who = await userName(trx, stale[0].updated_by);
        throw conflict(`${serialList(stale.map((r) => r.serial))} ${isAre(stale.length)} just changed by ${who}. The sheet has been refreshed: check and try again.`);
      }
      if (lostLocked.length) {
        throw bad(`${serialList(lostLocked.map((r) => r.serial))} ${lostLocked.length === 1 ? 'is' : 'are'} marked LOST and can't be changed. Undo the Lost in History first.`);
      }
      if (locked.length) {
        throw bad(`${serialList(locked.map((r) => r.serial))} ${locked.length === 1 ? 'is' : 'are'} printed and can't be changed. Untick Printed first.`);
      }
      if (unpackable.length) {
        throw bad(`${serialList(unpackable.map((r) => r.serial))} can't go in a packet: only printed passes not given yet do.`);
      }
      const unprintedNew = create.filter((c) => c.given && !c.printed);
      if (unprinted.length || unprintedNew.length) {
        const serials = [...unprinted.map((r) => r.serial), ...unprintedNew.map((c) => c.serial)];
        throw bad(`${serialList(serials)} ${serials.length === 1 ? 'is' : 'are'} not printed yet. Print first, then tick Given when handed over.`);
      }

      const updated = updates.length
        ? (await sql<PassRow>`
            UPDATE passes AS p SET
              name = v.name, dept = v.dept, area = v.area, phone = v.phone, vehicle = v.vehicle, vehicle_no = v.vehicle_no, incharge = v.incharge,
              issued_to = v.issued_to,
              printed_at = CASE WHEN v.printed IS NULL THEN p.printed_at WHEN v.printed THEN coalesce(p.printed_at, now()) ELSE NULL END,
              given_at = CASE WHEN v.given IS NULL THEN p.given_at WHEN v.given THEN coalesce(p.given_at, now()) ELSE NULL END,
              printed_by = CASE WHEN v.printed IS NULL THEN p.printed_by WHEN v.printed THEN CASE WHEN p.printed_at IS NULL THEN ${userId} ELSE p.printed_by END END,
              given_by = CASE WHEN v.given IS NULL THEN p.given_by WHEN v.given THEN CASE WHEN p.given_at IS NULL THEN ${userId} ELSE p.given_by END END,
              created_by = CASE WHEN v.claim THEN ${userId} ELSE p.created_by END, meta = v.meta, packet = v.packet,
              lost_at = CASE WHEN v.lost IS NULL THEN p.lost_at WHEN v.lost THEN coalesce(p.lost_at, now()) ELSE NULL END,
              updated_at = now(), updated_by = ${userId}, rev = ${rev}
            FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
              AS v(id int, name text, dept text, area text, phone text, vehicle text, vehicle_no text, incharge text, issued_to text, printed boolean, given boolean, claim boolean, meta jsonb, packet text, lost boolean)
            WHERE p.id = v.id
            RETURNING p.*`.execute(trx)).rows
        : [];

      // Typed or pasted as the next passes, but another desk has just taken some of those serials:
      // they go after the sheet's last pass instead, in the same order.
      const moved: { from: number; to: number }[] = [];
      if (req.next) {
        for (const type of new Set(create.map((c) => c.type))) {
          const mine = create.filter((c) => c.type === type);
          const taken = await trx.selectFrom('passes').select('serial')
            .where('type', '=', type).where('serial', 'in', mine.map((c) => c.serial)).limit(1).execute();
          if (!taken.length) continue;
          const { last } = await trx.selectFrom('passes').select((eb) => eb.fn.max('serial').as('last'))
            .where('type', '=', type).executeTakeFirstOrThrow();
          if ((last ?? 0) + mine.length > MAX_SERIAL) throw bad(`Serial numbers go up to ${MAX_SERIAL}.`);
          mine.forEach((c, i) => {
            moved.push({ from: c.serial, to: (last ?? 0) + 1 + i });
            c.serial = (last ?? 0) + 1 + i;
          });
        }
      }

      const createRows = create.map((c) => ({
        type: c.type, serial: c.serial, printed: c.printed ?? false, given: c.given ?? false, meta: withFlags({}, c.flags), copy_of: c.copy_of ?? null, ...c.values,
      }));
      const created = create.length
        ? (await sql<PassRow>`
            INSERT INTO passes (type, serial, name, dept, area, phone, vehicle, vehicle_no, incharge, issued_to, printed_at, given_at, printed_by, given_by, meta, copy_of, created_by, updated_by, rev)
            SELECT v.type::pass_type, v.serial,
                   coalesce(v.name, ''), coalesce(v.dept, ''), coalesce(v.area, ''), coalesce(v.phone, ''),
                   coalesce(v.vehicle, ''), coalesce(v.vehicle_no, ''), coalesce(v.incharge, ''), coalesce(v.issued_to, ''),
                   CASE WHEN v.printed THEN now() END, CASE WHEN v.given THEN now() END,
                   CASE WHEN v.printed THEN ${userId}::int END, CASE WHEN v.given THEN ${userId}::int END, coalesce(v.meta, '{}'), v.copy_of, ${userId}, ${userId}, ${rev}
            FROM jsonb_to_recordset(${JSON.stringify(createRows)}::jsonb)
              AS v(type text, serial int, name text, dept text, area text, phone text, vehicle text, vehicle_no text, incharge text, issued_to text, printed boolean, given boolean, meta jsonb, copy_of int)
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
      const idOf = new Map(created.map((r) => [`${r.type}|${r.serial}`, r.id]));
      const before: ChangeBefore = {
        rows: JSON.parse(JSON.stringify(current.filter((r) => updatedIds.has(r.id)))),
        created: create.map((c) => idOf.get(`${c.type}|${c.serial}`)!), // in the order asked for
      };
      const summary = moved.length
        ? `${req.summary} (saved as ${serialList(moved.map((m) => m.to))}: ${serialList(moved.map((m) => m.from))} ${isAre(moved.length)} taken)`
        : req.summary;
      const { id: changeId } = await trx
        .insertInto('changes')
        .values({
          done_by: userId,
          action: req.action,
          type: types.size === 1 ? [...types][0] : null,
          serial_from: Math.min(...serials),
          serial_to: Math.max(...serials),
          summary: summary.slice(0, 300),
          count: rows.length,
          rev,
          before: JSON.stringify(before),
          request_id: req.requestId ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { changeId, rows: rows.map(toPass), created: before.created };
    });
  } catch (e) {
    throw explain(e);
  }
}

/** Puts back what a change did, if none of its passes changed since. */
export async function undoChange(db: Kysely<Database>, userId: number, changeId: number, requestId?: string): Promise<UndoResult> {
  try {
    return await db.transaction().execute(async (trx) => {
      const done = await sentBefore(trx, userId, requestId);
      const rev = done ? 0 : await bump(trx);
      const ch = await trx.selectFrom('changes').selectAll().where('id', '=', changeId).forUpdate().executeTakeFirst();
      if (!ch) throw new TRPCError({ code: 'NOT_FOUND', message: 'That change no longer exists.' });
      if (done) {
        const { rows, created, deleted = [] } = ch.before;
        return { rows: await passesNow(trx, [...rows.map((r) => r.id), ...deleted.map((r) => r.id)]), deleted: created, summary: ch.summary };
      }
      if (ch.undone_at) throw bad('That was already undone.');
      if (ch.action === 'undo') throw bad('An undo cannot be undone.');

      const { rows: beforeRows, created, deleted = [] } = ch.before;
      const ids = [...beforeRows.map((r) => r.id), ...created];
      const current = ids.length
        ? await trx.selectFrom('passes').select(['id', 'serial', 'rev', 'updated_by']).where('id', 'in', ids).forUpdate().execute()
        : [];
      const byId = new Map(current.map((r) => [r.id, r]));
      if (ids.some((id) => !byId.has(id))) throw conflict("Can't undo: some of these passes were removed since.");
      const moved = current.filter((r) => r.rev !== ch.rev);
      // Changed since only by changes that were undone since (Undo pressed twice): they are back as
      // this change left them, so it can be undone too.
      const later = moved.length
        ? (await sql<{ id: number }>`
            SELECT c.id FROM changes c
            WHERE c.rev > ${ch.rev} AND c.action <> 'undo' AND c.undone_at IS NULL AND (
              EXISTS (SELECT 1 FROM jsonb_array_elements(c.before->'rows') r WHERE (r->>'id')::int = ANY(${moved.map((r) => r.id)}::int[]))
              OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(c.before->'created') x WHERE x::int = ANY(${moved.map((r) => r.id)}::int[]))
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(c.before->'deleted', '[]'::jsonb)) d WHERE (d->>'id')::int = ANY(${moved.map((r) => r.id)}::int[])))
            LIMIT 1`.execute(trx)).rows
        : [];
      if (later.length) {
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
              incharge = v.incharge, issued_to = coalesce(v.issued_to, ''), -- empty in changes saved before Issued To existed
              printed_at = v.printed_at, given_at = v.given_at, created_by = coalesce(v.created_by, p.created_by),
              -- who, as it was; kept (or none) in changes saved before Printed by existed
              printed_by = CASE WHEN v.printed_at IS NOT NULL THEN coalesce(v.printed_by, p.printed_by) END,
              given_by = CASE WHEN v.given_at IS NOT NULL THEN coalesce(v.given_by, p.given_by) END,
              meta = coalesce(v.meta, p.meta), -- kept in changes saved before meta existed
              packet = coalesce(v.packet, p.packet), -- and before packets existed
              lost_at = v.lost_at, -- none was lost before Lost existed; a pass lost since can't be undone to then (it moved on)
              updated_at = now(), updated_by = ${userId}, rev = ${rev}
            FROM jsonb_to_recordset(${JSON.stringify(beforeRows)}::jsonb)
              AS v(id int, name text, dept text, area text, phone text, vehicle text, vehicle_no text, incharge text, issued_to text, printed_at timestamptz, given_at timestamptz, created_by int, meta jsonb, packet text, lost_at timestamptz, printed_by int, given_by int)
            WHERE p.id = v.id
            RETURNING p.*`.execute(trx)).rows
        : [];
      const back = deleted.length ? await putBack(trx, userId, rev, deleted) : [];

      await trx.updateTable('changes').set({ undone_at: new Date(), undone_by: userId }).where('id', '=', changeId).execute();
      await trx
        .insertInto('changes')
        .values({
          done_by: userId, action: 'undo', type: ch.type, serial_from: ch.serial_from, serial_to: ch.serial_to,
          summary: `Undo: ${ch.summary}`.slice(0, 300), count: ids.length + deleted.length, rev,
          before: JSON.stringify({ rows: [], created: [] } satisfies ChangeBefore), request_id: requestId ?? null,
        })
        .execute();
      return { rows: [...restored, ...back].map(toPass), deleted: created, summary: ch.summary };
    });
  } catch (e) {
    throw explain(e);
  }
}

/**
 * Removes passes from the register; their serials become empty rows again. Printed passes can't be
 * deleted (their cards are out there). Refused if any pass changed since the user saw it. Undo puts
 * them back as they were.
 */
export async function deletePasses(db: Kysely<Database>, userId: number, req: DeleteRequest): Promise<DeleteResult> {
  const ids = req.items.map((i) => i.id);
  if (!ids.length) throw bad('Nothing to delete.');
  if (ids.length > MAX_BATCH) throw bad(`Please do at most ${MAX_BATCH} passes at a time.`);
  if (new Set(ids).size !== ids.length) throw bad('The same pass appears twice.');
  const seen = new Map(req.items.map((i) => [i.id, i.rev]));
  try {
    return await db.transaction().execute(async (trx) => {
      const done = await sentBefore(trx, userId, req.requestId);
      if (done) return { changeId: done.id, deleted: (done.before.deleted ?? []).map((r) => ({ id: r.id, rev: done.rev })) };
      const rev = await bump(trx);
      const rows = await trx.selectFrom('passes').selectAll().where('id', 'in', ids).forUpdate().execute();
      if (rows.length < ids.length) throw conflict('Some of these passes were removed meanwhile. The sheet has been refreshed.');
      const moved = rows.filter((r) => r.rev !== seen.get(r.id));
      if (moved.length) {
        const who = await userName(trx, moved[0].updated_by);
        throw conflict(`${serialList(moved.map((r) => r.serial))} ${isAre(moved.length)} just changed by ${who}. The sheet has been refreshed: check and try again.`);
      }
      const printed = rows.filter((r) => r.printed_at !== null);
      if (printed.length) {
        throw bad(`${serialList(printed.map((r) => r.serial))} ${printed.length === 1 ? 'is' : 'are'} printed and can't be deleted. Untick Printed first.`);
      }
      await trx.deleteFrom('passes').where('id', 'in', ids).execute();
      await trx.insertInto('deleted_passes').values(ids.map((id) => ({ id, rev })))
        .onConflict((oc) => oc.column('id').doUpdateSet({ rev })).execute();
      const types = new Set(rows.map((r) => r.type));
      const serials = rows.map((r) => r.serial);
      const before: ChangeBefore = { rows: [], created: [], deleted: JSON.parse(JSON.stringify(rows)) };
      const { id: changeId } = await trx.insertInto('changes')
        .values({
          done_by: userId, action: 'delete', type: types.size === 1 ? [...types][0] : null,
          serial_from: Math.min(...serials), serial_to: Math.max(...serials),
          summary: req.summary.slice(0, 300), count: rows.length, rev, before: JSON.stringify(before),
          request_id: req.requestId ?? null,
        })
        .returning('id').executeTakeFirstOrThrow();
      return { changeId, deleted: ids.map((id) => ({ id, rev })) };
    });
  } catch (e) {
    throw explain(e);
  }
}

/** Undoing a delete: the passes come back as they were (same id), unless their serials were used again. */
async function putBack(trx: Transaction<Database>, userId: number, rev: number, rows: PassRowJson[]): Promise<PassRow[]> {
  const json = JSON.stringify(rows);
  const taken = (await sql<{ type: PassType; serial: number }>`
    SELECT p.type, p.serial FROM passes p JOIN jsonb_to_recordset(${json}::jsonb) AS v(type text, serial int)
      ON p.type::text = v.type AND p.serial = v.serial`.execute(trx)).rows;
  if (taken.length) {
    throw conflict(`Can't undo: ${TYPE_INFO[taken[0].type].label} ${serialList(taken.map((t) => t.serial))} ${taken.length === 1 ? 'was' : 'were'} added again since.`);
  }
  const back = (await sql<PassRow>`
    INSERT INTO passes (id, type, serial, name, dept, area, phone, vehicle, vehicle_no, incharge, issued_to, printed_at, given_at, printed_by, given_by, meta, packet, lost_at, copy_of, created_at, created_by, updated_by, rev)
    OVERRIDING SYSTEM VALUE
    SELECT v.id, v.type::pass_type, v.serial, v.name, v.dept, v.area, v.phone, v.vehicle, v.vehicle_no, v.incharge, coalesce(v.issued_to, ''),
           v.printed_at, v.given_at, v.printed_by, v.given_by, coalesce(v.meta, '{}'), coalesce(v.packet, ''), v.lost_at, v.copy_of, v.created_at, v.created_by, ${userId}, ${rev}
    FROM jsonb_to_recordset(${json}::jsonb)
      AS v(id int, type text, serial int, name text, dept text, area text, phone text, vehicle text, vehicle_no text, incharge text, issued_to text,
           printed_at timestamptz, given_at timestamptz, printed_by int, given_by int, meta jsonb, packet text, lost_at timestamptz, copy_of int,
           created_at timestamptz, created_by int)
    RETURNING *`.execute(trx)).rows;
  await trx.deleteFrom('deleted_passes').where('id', 'in', rows.map((r) => r.id)).execute();
  return back;
}

/**
 * Everything that changed after version `since` (0 = everything). One query, so one round trip to a
 * database that may be far away; a single statement sees the database at one moment.
 */
export async function syncSince(db: Kysely<Database>, since: number): Promise<Omit<SyncResult, 'backupError'>> {
  type Row = { rev: number; rows: PassRow[] | null; deleted: { id: number; rev: number }[] | null };
  const cols = sql.join(PASS_COLUMNS.map((c) => sql.ref(c)));
  // A `since` ahead of the database means it was replaced (e.g. restored from a backup): send everything.
  const { rows: [r] } = await sql<Row>`
    WITH m AS (SELECT version, CASE WHEN ${since}::int > version THEN 0 ELSE ${since}::int END AS since FROM meta WHERE id = 1)
    SELECT m.version AS rev,
      (SELECT json_agg(p) FROM (SELECT ${cols} FROM passes WHERE rev > m.since) p) AS rows,
      (SELECT json_agg(d) FROM (SELECT id, rev FROM deleted_passes WHERE m.since > 0 AND rev > m.since) d) AS deleted
    FROM m`.execute(db);
  return { rev: r.rev, rows: (r.rows ?? []).map(toPass), deleted: r.deleted ?? [], reset: since > r.rev };
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
