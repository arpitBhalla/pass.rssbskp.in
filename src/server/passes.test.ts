import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyRequest, Pass, Values } from '@/shared/types';
import { db, ensureDatabase, migrate } from './db';
import { applyChange, syncSince, undoChange } from './passes';

// Runs against TEST_DATABASE_URL (default: postgres://localhost:5432/passes_test), wiped first.
let ramesh: number;
let suresh: number;

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes('test')) throw new Error('Refusing to wipe a database whose name lacks "test"');
  await ensureDatabase();
  await sql`DROP SCHEMA public CASCADE`.execute(db);
  await sql`CREATE SCHEMA public`.execute(db);
  await migrate();
  const users = await db
    .insertInto('users')
    .values([
      { username: 'ramesh', name: 'Ramesh', password_hash: 'x', created_by: null },
      { username: 'suresh', name: 'Suresh', password_hash: 'x', created_by: null },
    ])
    .returning('id')
    .execute();
  [ramesh, suresh] = users.map((u) => u.id);
});

beforeEach(async () => {
  await sql`TRUNCATE passes, changes, deleted_passes`.execute(db);
});

afterAll(() => db.destroy());

const give = (from: number, to: number, incharge: string, type: Pass['type'] = 'mobile-pandal'): ApplyRequest => ({
  action: 'give',
  summary: `Gave ${from}–${to} to ${incharge}`,
  create: Array.from({ length: to - from + 1 }, (_, i) => ({ type, serial: from + i, values: { incharge, area: 'Sirsa' } })),
});

describe('apply', () => {
  it('gives a range as one row per pass, logged as one change', async () => {
    const r = await applyChange(db, ramesh, give(101, 150, 'Gurpreet'));
    expect(r.rows).toHaveLength(50);
    expect(r.rows.every((p) => p.incharge === 'Gurpreet' && p.area === 'Sirsa' && p.updated_by === ramesh)).toBe(true);
    const ch = await db.selectFrom('changes').selectAll().executeTakeFirstOrThrow();
    expect(ch).toMatchObject({ action: 'give', serial_from: 101, serial_to: 150, count: 50, done_by: ramesh });
  });

  it('never gives a pass twice: an overlapping range saves nothing', async () => {
    await applyChange(db, ramesh, give(101, 150, 'Gurpreet'));
    await expect(applyChange(db, suresh, give(140, 160, 'Harjit'))).rejects.toThrow(/0140–0150 already exist/);
    expect(await db.selectFrom('passes').select('id').where('serial', '>', 150).execute()).toHaveLength(0);
    // The same numbers in another sheet are fine.
    await expect(applyChange(db, suresh, give(140, 160, 'Harjit', 'bike-pandal'))).resolves.toBeTruthy();
  });

  it('refuses an edit when the pass changed since the user saw it', async () => {
    const [p] = (await applyChange(db, ramesh, give(1, 1, 'Gurpreet'))).rows;
    await applyChange(db, suresh, { action: 'edit', summary: 'name', set: [{ id: p.id, values: { name: 'Amit' }, expect: { name: '' } }] });
    await expect(
      applyChange(db, ramesh, { action: 'edit', summary: 'name', set: [{ id: p.id, values: { name: 'Raj' }, expect: { name: '' } }] }),
    ).rejects.toThrow(/0001 was just changed by Suresh/);
  });

  it('locks printed passes until Printed is unticked', async () => {
    const [p] = (await applyChange(db, ramesh, give(1, 1, 'Gurpreet'))).rows;
    await applyChange(db, ramesh, { action: 'print', summary: 'Printed', set: [{ id: p.id, printed: true, expect: { printed: false } }] });
    // Nothing changes on a printed pass: not a blank field, not the incharge.
    const fill = { action: 'edit' as const, summary: 'fill', set: [{ id: p.id, values: { name: 'Amit' }, expect: { name: '' } }] };
    await expect(applyChange(db, ramesh, fill)).rejects.toThrow(/0001 is printed/);
    const reassign = { action: 'edit' as const, summary: 'incharge', set: [{ id: p.id, values: { incharge: 'Mohan' }, expect: { incharge: 'Gurpreet' } }] };
    await expect(applyChange(db, ramesh, reassign)).rejects.toThrow(/0001 is printed/);
    // Unticking and changing in one go is refused too: untick first.
    await expect(applyChange(db, ramesh, { ...fill, set: [{ ...fill.set[0], printed: false, expect: { name: '', printed: true } }] })).rejects.toThrow(/0001 is printed/);
    await applyChange(db, ramesh, { action: 'edit', summary: 'untick', set: [{ id: p.id, printed: false, expect: { printed: true } }] });
    const [after] = (await applyChange(db, ramesh, fill)).rows;
    expect(after).toMatchObject({ name: 'Amit', printed_at: null });
  });

  it('keeps Reg. No. and Vehicle to the sheets that have them', async () => {
    const req = (type: Pass['type'], values: Values): ApplyRequest =>
      ({ action: 'give', summary: 'x', create: [{ type, serial: 1, values }] });
    await expect(applyChange(db, ramesh, req('mobile-pandal', { vehicle_no: 'HR 26 1234' }))).rejects.toThrow(/no Reg\. No\./);
    await expect(applyChange(db, ramesh, req('bike-pandal', { vehicle: 'Splendor' }))).rejects.toThrow(/no Vehicle/);
    await expect(applyChange(db, ramesh, req('bike-pandal', { vehicle_no: 'HR 26 1234' }))).resolves.toBeTruthy();
    const [p] = (await applyChange(db, ramesh, req('sewa-vehicle', { vehicle: 'Swift', vehicle_no: 'HR 26 1234' }))).rows;
    expect(p).toMatchObject({ vehicle: 'Swift', vehicle_no: 'HR 26 1234' });
  });
});

describe('undo', () => {
  it('removes passes a give created, and restores edited ones', async () => {
    const g = await applyChange(db, ramesh, give(1, 3, 'Gurpreet'));
    const e = await applyChange(db, ramesh, {
      action: 'edit', summary: 'name', set: [{ id: g.rows[0].id, values: { name: 'Amit' }, expect: { name: '' } }],
    });
    const u1 = await undoChange(db, ramesh, e.changeId);
    expect(u1.rows[0].name).toBe('');
    // The give's rows were touched by the undo, so the give can no longer be undone blindly.
    await expect(undoChange(db, ramesh, g.changeId)).rejects.toThrow(/changed afterwards/);
    await expect(undoChange(db, ramesh, e.changeId)).rejects.toThrow(/already undone/);

    const g2 = await applyChange(db, ramesh, give(10, 12, 'Harjit'));
    const u2 = await undoChange(db, suresh, g2.changeId);
    expect(u2.deleted).toHaveLength(3);
    expect(await db.selectFrom('passes').select('id').where('serial', '>=', 10).execute()).toHaveLength(0);
  });
});

describe('sync', () => {
  it('returns only what changed, including passes removed by undo', async () => {
    const start = (await syncSince(db, 0)).rev;
    const g = await applyChange(db, ramesh, give(1, 5, 'Gurpreet'));
    const s1 = await syncSince(db, start);
    expect(s1.rows).toHaveLength(5);
    expect(await syncSince(db, s1.rev)).toMatchObject({ rows: [], deleted: [], reset: false });
    await undoChange(db, ramesh, g.changeId);
    const s2 = await syncSince(db, s1.rev);
    expect(s2.deleted.map((d) => d.id).sort()).toEqual(g.rows.map((p) => p.id).sort());
    expect((await syncSince(db, s2.rev + 100)).reset).toBe(true); // database replaced: reload everything
  });
});
