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

  it('Issued To can be filled in on a printed pass, and undone; Reg. No. is written one way', async () => {
    const [p] = (await applyChange(db, ramesh, give(1, 1, 'Gurpreet', 'bike-pandal'))).rows;
    await applyChange(db, ramesh, { action: 'print', summary: 'Printed', set: [{ id: p.id, printed: true, expect: { printed: false } }] });
    const r = await applyChange(db, ramesh, { action: 'edit', summary: 'issued', set: [{ id: p.id, values: { issued_to: 'Harjit' }, expect: { issued_to: '' } }] });
    expect(r.rows[0].issued_to).toBe('Harjit');
    expect(r.rows[0].printed_at).not.toBeNull();
    // A change saved before Issued To existed has none in its copy: undo leaves it empty.
    await sql`UPDATE changes SET before = jsonb_set(before, '{rows,0}', (before->'rows'->0) - 'issued_to') WHERE id = ${r.changeId}`.execute(db);
    expect((await undoChange(db, ramesh, r.changeId)).rows[0]).toMatchObject({ issued_to: '', incharge: 'Gurpreet' });
    const [q] = (await applyChange(db, ramesh, { action: 'edit', summary: 'reg', create: [{ type: 'bike-pandal', serial: 2, values: { vehicle_no: 'hr 24 ab 9168' } }] })).rows;
    expect(q.vehicle_no).toBe('HR-24AB-9168');
  });

  it('keeps Reg. No. and Vehicle to the sheets that have them', async () => {
    const req = (type: Pass['type'], values: Values): ApplyRequest =>
      ({ action: 'give', summary: 'x', create: [{ type, serial: 1, values }] });
    await expect(applyChange(db, ramesh, req('mobile-pandal', { vehicle_no: 'HR 26 1234' }))).rejects.toThrow(/no Reg\. No\./);
    await expect(applyChange(db, ramesh, req('bike-pandal', { vehicle: 'Splendor' }))).rejects.toThrow(/no Vehicle/);
    await expect(applyChange(db, ramesh, req('bike-pandal', { vehicle_no: 'HR 26 1234' }))).resolves.toBeTruthy();
    const [p] = (await applyChange(db, ramesh, req('sewa-vehicle', { vehicle: 'Swift', vehicle_no: 'HR 26 1234' }))).rows;
    expect(p).toMatchObject({ vehicle: 'Swift', vehicle_no: 'HR-26-1234' });
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
    await expect(undoChange(db, ramesh, e.changeId)).rejects.toThrow(/already undone/);
    // The edit was undone, so the give's passes are as the give left them: it can be undone too.
    expect((await undoChange(db, ramesh, g.changeId)).deleted).toHaveLength(3);

    const g2 = await applyChange(db, ramesh, give(10, 12, 'Harjit'));
    const u2 = await undoChange(db, suresh, g2.changeId);
    expect(u2.deleted).toHaveLength(3);
    expect(await db.selectFrom('passes').select('id').where('serial', '>=', 10).execute()).toHaveLength(0);
  });
});

describe('undo twice', () => {
  it('undoes the same cell twice in a row; refused if someone else changed it meanwhile', async () => {
    const [p] = (await applyChange(db, ramesh, give(1, 1, 'Gurpreet'))).rows;
    const name = (from: string, to: string) => applyChange(db, ramesh, { action: 'edit', summary: to, set: [{ id: p.id, values: { name: to }, expect: { name: from } }] });
    const a = await name('', 'Amit');
    const b = await name('Amit', 'Amrit');
    expect((await undoChange(db, ramesh, b.changeId)).rows[0].name).toBe('Amit');
    expect((await undoChange(db, ramesh, a.changeId)).rows[0].name).toBe('');
    // Now with a change by someone else in between that is not undone: refused.
    const c = await name('', 'Raj');
    await applyChange(db, suresh, { action: 'edit', summary: 'dept', set: [{ id: p.id, values: { dept: 'Langar' }, expect: { dept: '' } }] });
    await expect(undoChange(db, ramesh, c.changeId)).rejects.toThrow(/changed afterwards \(by Suresh\)/);
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
  const print = (id: number) => applyChange(db, ramesh, { action: 'print', summary: 'print', set: [{ id, printed: true, expect: { printed: false } }] });

  it('starts unticked whatever is filled in; ticking is saved on printed passes, refused if stale', async () => {
    const [p] = (await applyChange(db, ramesh, give(1, 1, 'Gurpreet'))).rows;
    expect(p.given_at).toBeNull();
    await print(p.id);
    const t = await applyChange(db, ramesh, { action: 'given', summary: 'tick', set: [{ id: p.id, given: true, expect: { given: false } }] });
    expect(t.rows[0].given_at).not.toBeNull();
    // Another desk still saw it unticked: refused.
    await expect(applyChange(db, suresh, { action: 'given', summary: 'tick', set: [{ id: p.id, given: true, expect: { given: false } }] }))
      .rejects.toThrow(/just changed by Ramesh/);
    const u = await applyChange(db, ramesh, { action: 'given', summary: 'untick', set: [{ id: p.id, given: false, expect: { given: true } }] });
    expect(u.rows[0]).toMatchObject({ given_at: null });
    expect(u.rows[0].printed_at).not.toBeNull();
  });

  it('a pass is printed first: Given is refused until it is printed', async () => {
    const [p] = (await applyChange(db, ramesh, give(1, 1, 'Gurpreet'))).rows;
    await expect(applyChange(db, ramesh, { action: 'given', summary: 'tick', set: [{ id: p.id, given: true, expect: { given: false } }] }))
      .rejects.toThrow(/0001 is not printed yet/);
    await expect(applyChange(db, ramesh, { action: 'import', summary: 'add', create: [{ type: 'mobile-pandal', serial: 9, values: { name: 'A' }, given: true }] }))
      .rejects.toThrow(/0009 is not printed yet/);
    // Printed and Given in one go (e.g. an import of passes printed elsewhere) is fine.
    const both = await applyChange(db, ramesh, { action: 'import', summary: 'add', create: [{ type: 'mobile-pandal', serial: 9, values: { name: 'A' }, printed: true, given: true }] });
    expect(both.rows[0].given_at).not.toBeNull();
    // Unticking Printed later (to reprint) leaves Given as it is.
    await print(p.id);
    await applyChange(db, ramesh, { action: 'given', summary: 'tick', set: [{ id: p.id, given: true, expect: { given: false } }] });
    const r = await applyChange(db, ramesh, { action: 'print', summary: 'untick', set: [{ id: p.id, printed: false, expect: { printed: true } }] });
    expect(r.rows[0].printed_at).toBeNull();
    expect(r.rows[0].given_at).not.toBeNull();
  });

  it('undo restores Given as it was', async () => {
    const [p] = (await applyChange(db, ramesh, give(1, 1, 'Gurpreet'))).rows;
    await print(p.id);
    const t = await applyChange(db, ramesh, { action: 'given', summary: 'tick', set: [{ id: p.id, given: true, expect: { given: false } }] });
    expect((await undoChange(db, ramesh, t.changeId)).rows[0].given_at).toBeNull();
  });
});

describe('delete', () => {
  const items = (rows: Pass[]) => rows.map((p) => ({ id: p.id, rev: p.rev }));

  it('deletes several passes as one change; sync reports them; undo brings them back as they were', async () => {
    const g = await applyChange(db, ramesh, give(1, 5, 'Gurpreet'));
    // Given, then Printed unticked again (e.g. to reprint it): still deletable, and undo keeps Given.
    await db.updateTable('passes').set({ given_at: new Date('2026-11-13T10:00:00Z') }).where('id', '=', g.rows[1].id).execute();
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

describe('two desks adding the next pass at once', () => {
  const add = (serials: number[], name: string, next = true): ApplyRequest => ({
    action: 'edit', summary: `Added ${serials.join(', ')}`, next,
    create: serials.map((serial, i) => ({ type: 'sewa-vehicle', serial, values: { name: `${name} ${i + 1}` } })),
  });

  it('the later one is saved after the last pass, in the same order, and History says so', async () => {
    await applyChange(db, ramesh, add([1], 'Pardeep'));
    await applyChange(db, ramesh, add([2], 'Gagan')); // desk X got there first
    const r = await applyChange(db, suresh, add([2, 3], 'Navneet')); // desk Y still thought 0002 was next
    const byId = new Map(r.rows.map((p) => [p.id, p]));
    expect(r.created.map((id) => [byId.get(id)!.serial, byId.get(id)!.name])).toEqual([[3, 'Navneet 1'], [4, 'Navneet 2']]);
    const ch = await db.selectFrom('changes').select('summary').where('id', '=', r.changeId).executeTakeFirstOrThrow();
    expect(ch.summary).toBe('Added 2, 3 (saved as 0003–0004: 0002–0003 were taken)');
    // Free serials stay as asked; undo removes the moved passes.
    const free = await applyChange(db, suresh, add([5], 'Raj'));
    expect(free.rows[0].serial).toBe(5);
    await undoChange(db, suresh, r.changeId);
    expect((await syncSince(db, 0)).rows.map((p) => p.serial).sort()).toEqual([1, 2, 5]);
  });

  it('ranges given, printed or imported keep their serials: refused when taken', async () => {
    await applyChange(db, ramesh, add([1], 'Gagan'));
    await expect(applyChange(db, suresh, add([1], 'Navneet', false))).rejects.toThrow(/0001 already exist/);
  });
});

describe('a request sent again (the answer was lost)', () => {
  const id = (n: number) => `test-request-${n}`;
  const items = (rows: Pass[]) => rows.map((p) => ({ id: p.id, rev: p.rev }));

  it('a save is made once; the second answer is the first one', async () => {
    const req = { ...give(1, 2, 'Gurpreet'), requestId: id(1) };
    const a = await applyChange(db, ramesh, req);
    const b = await applyChange(db, ramesh, req);
    expect(b.changeId).toBe(a.changeId);
    expect(b.created).toEqual(a.created);
    expect(b.rows.map((p) => p.id).sort()).toEqual(a.rows.map((p) => p.id).sort());
    expect((await syncSince(db, 0)).rows).toHaveLength(2);
    expect(await db.selectFrom('changes').select('id').execute()).toHaveLength(1);
    // Another user's request with the same code is not mistaken for it.
    await expect(applyChange(db, suresh, req)).rejects.toThrow(/already exist/);
  });

  it('a delete and an undo are each done once', async () => {
    const g = await applyChange(db, ramesh, give(1, 2, 'Gurpreet'));
    const del = { summary: 'x', items: items(g.rows), requestId: id(2) };
    const d1 = await deletePasses(db, ramesh, del);
    const d2 = await deletePasses(db, ramesh, del);
    expect(d2).toEqual(d1);
    const u1 = await undoChange(db, ramesh, d1.changeId, id(3));
    const u2 = await undoChange(db, ramesh, d1.changeId, id(3));
    expect(u2.rows.map((p) => p.id).sort()).toEqual(u1.rows.map((p) => p.id).sort());
    expect(u2.summary).toBe(u1.summary);
    expect((await syncSince(db, 0)).rows).toHaveLength(2);
    expect(await db.selectFrom('changes').select('action').orderBy('id').execute()).toEqual([{ action: 'give' }, { action: 'delete' }, { action: 'undo' }]);
  });

  it('two copies sent at the same moment: one makes the change, the other waits and gets its answer', async () => {
    const req = { ...give(1, 50, 'Gurpreet'), requestId: id(4) };
    const [a, b] = await Promise.all([applyChange(db, ramesh, req), applyChange(db, ramesh, req)]);
    expect(b.changeId).toBe(a.changeId);
    expect((await syncSince(db, 0)).rows).toHaveLength(50);
  });
});
