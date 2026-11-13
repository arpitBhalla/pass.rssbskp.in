import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyRequest, Pass, Values } from '@/shared/types';
import { db, ensureDatabase, migrate } from './db';
import { applyChange, deletePasses, syncSince, undoChange } from './passes';

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

describe('Given', () => {
  it('starts unticked whatever is filled in; ticking is saved, refused if stale, allowed on printed passes', async () => {
    const [p] = (await applyChange(db, ramesh, give(1, 1, 'Gurpreet'))).rows;
    expect(p.given_at).toBeNull();
    const t = await applyChange(db, ramesh, { action: 'given', summary: 'tick', set: [{ id: p.id, given: true, expect: { given: false } }] });
    expect(t.rows[0].given_at).not.toBeNull();
    // Another desk still saw it unticked: refused.
    await expect(applyChange(db, suresh, { action: 'given', summary: 'tick', set: [{ id: p.id, given: true, expect: { given: false } }] }))
      .rejects.toThrow(/just changed by Ramesh/);
    await applyChange(db, ramesh, { action: 'print', summary: 'print', set: [{ id: p.id, printed: true, expect: { printed: false } }] });
    const u = await applyChange(db, ramesh, { action: 'given', summary: 'untick', set: [{ id: p.id, given: false, expect: { given: true } }] });
    expect(u.rows[0]).toMatchObject({ given_at: null });
    expect(u.rows[0].printed_at).not.toBeNull();
  });

  it('undo restores Given as it was', async () => {
    const [p] = (await applyChange(db, ramesh, give(1, 1, 'Gurpreet'))).rows;
    const t = await applyChange(db, ramesh, { action: 'given', summary: 'tick', set: [{ id: p.id, given: true, expect: { given: false } }] });
    expect((await undoChange(db, ramesh, t.changeId)).rows[0].given_at).toBeNull();
  });
});

describe('delete', () => {
  const items = (rows: Pass[]) => rows.map((p) => ({ id: p.id, rev: p.rev }));

  it('deletes several passes as one change; sync reports them; undo brings them back as they were', async () => {
    const g = await applyChange(db, ramesh, give(1, 5, 'Gurpreet'));
    await applyChange(db, ramesh, { action: 'given', summary: 'tick', set: [{ id: g.rows[1].id, given: true, expect: { given: false } }] });
    const before = (await syncSince(db, 0)).rows.sort((a, b) => a.serial - b.serial);
    const rev = (await syncSince(db, 0)).rev;
    const d = await deletePasses(db, suresh, { summary: 'Deleted 0002–0004', items: items(before.slice(1, 4)) });
    expect(d.deleted).toHaveLength(3);
    expect((await syncSince(db, 0)).rows.map((p) => p.serial).sort()).toEqual([1, 5]);
    expect((await syncSince(db, rev)).deleted.map((x) => x.id).sort()).toEqual(before.slice(1, 4).map((p) => p.id).sort());
    expect(await db.selectFrom('changes').select(['action', 'count', 'serial_from', 'serial_to']).where('id', '=', d.changeId).executeTakeFirst())
      .toMatchObject({ action: 'delete', count: 3, serial_from: 2, serial_to: 4 });

    const u = await undoChange(db, ramesh, d.changeId);
    const back = u.rows.sort((a, b) => a.serial - b.serial);
    expect(back.map((p) => [p.id, p.serial, p.incharge, p.created_at])).toEqual(before.slice(1, 4).map((p) => [p.id, p.serial, p.incharge, p.created_at]));
    expect(back[0].given_at).toBe(before[1].given_at);
    expect(await db.selectFrom('deleted_passes').select('id').execute()).toHaveLength(0);
    // A client that saw the delete gets them back on its next sync.
    const after = await syncSince(db, d.deleted[0].rev);
    expect(after.rows.map((p) => p.serial).sort()).toEqual([2, 3, 4]);
  });

  it('refuses printed passes and passes changed since; deletes nothing then', async () => {
    const g = await applyChange(db, ramesh, give(1, 3, 'Gurpreet'));
    await applyChange(db, ramesh, { action: 'print', summary: 'p', set: [{ id: g.rows[2].id, printed: true, expect: { printed: false } }] });
    const now = (await syncSince(db, 0)).rows.sort((a, b) => a.serial - b.serial);
    await expect(deletePasses(db, ramesh, { summary: 'x', items: items(now) })).rejects.toThrow(/0003 is printed and can't be deleted/);
    await expect(deletePasses(db, ramesh, { summary: 'x', items: items(g.rows.slice(0, 2)).map((i) => ({ ...i, rev: i.rev - 1 })) }))
      .rejects.toThrow(/just changed by/);
    expect((await syncSince(db, 0)).rows).toHaveLength(3);
  });

  it("can't undo a delete once a serial is used again", async () => {
    const g = await applyChange(db, ramesh, give(1, 2, 'Gurpreet'));
    const d = await deletePasses(db, ramesh, { summary: 'x', items: items(g.rows) });
    await applyChange(db, suresh, give(2, 2, 'Harjit'));
    await expect(undoChange(db, ramesh, d.changeId)).rejects.toThrow(/Mobile Pandal 0002 was added again since/);
    expect((await syncSince(db, 0)).rows.map((p) => p.incharge)).toEqual(['Harjit']);
  });

  it('undoing a give of passes deleted since is refused', async () => {
    const g = await applyChange(db, ramesh, give(1, 2, 'Gurpreet'));
    await deletePasses(db, ramesh, { summary: 'x', items: items(g.rows.slice(0, 1)) });
    await expect(undoChange(db, ramesh, g.changeId)).rejects.toThrow(/removed since/);
  });
});
