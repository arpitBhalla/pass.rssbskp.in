import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, ensureDatabase, migrate } from './db';
import { checkPass, passCodes } from './gate';
import { PASS_TYPES } from '@/shared/types';
import { claimOf, codeIn } from '../lib/gateCode';
import { checkCode, hashOfName, makeCode, newSecret, toKeys } from './qr';

describe('pass codes', () => {
  const keys = toKeys(newSecret());

  it('round-trips the sheet and serial in 44 digits, whatever the name', () => {
    for (const name of ['', 'Harpreet Singh', 'Gurpreet Singh Dhillon Randhawa Sandhu', 'ਹਰਪ੍ਰੀਤ ਸਿੰਘ']) {
      const code = makeCode(keys, 'bike-non-pandal', 1234, name);
      expect(code).toMatch(/^[1-9]\d{43}$/);
      const r = checkCode(keys, code);
      expect(r).toMatchObject({ why: 'valid', type: 'bike-non-pandal', serial: 1234 });
      if (r.why !== 'unreadable') expect(hashOfName(r.nameHash, ` ${name.toLowerCase()} `)).toBe(true);
    }
  });

  it('every sheet, Gate 3 - VIP and Admin included, reads back as itself on the server and the gate phone', () => {
    for (const t of PASS_TYPES) {
      const code = makeCode(keys, t, 7, 'AMARJIT SINGH');
      expect(checkCode(keys, code)).toMatchObject({ why: 'valid', type: t, serial: 7 });
      expect(claimOf(code)).toEqual({ type: t, serial: 7 });
    }
  });

  it('rejects a changed code, another key and junk', () => {
    const code = makeCode(keys, 'sewa-vehicle', 42, 'BALDEV');
    for (let i = 3; i < code.length; i += 4) {
      const changed = code.slice(0, i) + ((Number(code[i]) + 1) % 10) + code.slice(i + 1);
      expect(checkCode(keys, changed).why).not.toBe('valid');
    }
    expect(checkCode(toKeys(newSecret()), code).why).toMatch(/old-key|fake/);
    expect(checkCode(null, code).why).toBe('fake');
    for (const junk of ['', 'abc', '0123', '1'.repeat(70), 'https://example.org']) expect(checkCode(keys, junk).why).toBe('unreadable');
  });
});

describe('reading a scanned QR code on the gate phone', () => {
  const code = makeCode(toKeys(newSecret()), 'gate3-entry', 317, 'GURMEET KAUR');

  it('finds the code alone, or at the end of an old pass link', () => {
    expect(codeIn(code)).toBe(code);
    expect(codeIn(` ${code}\n`)).toBe(code);
    expect(codeIn(`http://192.168.1.20:5180/v#${code}`)).toBe(code);
    for (const junk of ['', 'hello', 'https://example.org', `https://example.org/x${code}`, `${code}0000000000000000`, `0${code}`]) {
      expect(codeIn(junk)).toBeNull();
    }
  });

  it('shows which pass a code says it is, as the server reads it', () => {
    expect(claimOf(code)).toEqual({ type: 'gate3-entry', serial: 317 });
    expect(claimOf('1'.repeat(44))).toBeNull();
  });
});

describe('gate check (database)', () => {
  let ramesh: number;
  let gate: number;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('test')) throw new Error('Refusing to wipe a database whose name lacks "test"');
    await ensureDatabase();
    await sql`DROP SCHEMA public CASCADE`.execute(db);
    await sql`CREATE SCHEMA public`.execute(db);
    await migrate();
    const users = await db.insertInto('users')
      .values([
        { username: 'ramesh', name: 'Ramesh', password_hash: 'x', created_by: null },
        { username: 'gate1', name: 'Gate One', password_hash: 'x', created_by: null },
      ])
      .returning('id').execute();
    [ramesh, gate] = users.map((u) => u.id);
  });
  beforeEach(async () => {
    await sql`TRUNCATE passes, scans`.execute(db);
    await db.deleteFrom('settings').execute();
  });
  afterAll(async () => { await db.destroy(); });

  // Printed and Given unless told otherwise.
  const addPass = (serial: number, v: { name?: string; incharge?: string; printed?: boolean; given?: boolean }) =>
    db.insertInto('passes').values({
      type: 'mobile-pandal', serial, name: v.name ?? '', incharge: v.incharge ?? '',
      printed_at: v.printed === false ? null : new Date(), given_at: v.given === false ? null : new Date(),
      created_by: ramesh, updated_by: ramesh, rev: 1,
    }).execute();

  it('says VALID for a printed, given pass and records each scan', async () => {
    await addPass(1, { name: 'Harpreet Singh', incharge: 'Ramesh' });
    const [{ code, name }] = await passCodes(db, ramesh, 'mobile-pandal', [1]);
    expect(name).toBe('HARPREET SINGH');
    const first = await checkPass(db, gate, code);
    expect(first.verdict).toBe('valid');
    expect(first.pass?.incharge).toBe('Ramesh');
    expect(first.scans).toBe(0);
    const again = await checkPass(db, gate, code);
    expect(again.scans).toBe(1);
    expect(again.earlier[0]).toMatchObject({ by: 'Gate One', result: 'valid' });
  });

  it('says CHECK when the register disagrees with the pass, but not for a blank pass named later', async () => {
    await addPass(2, { name: 'Harpreet Singh', incharge: 'Ramesh' });
    await addPass(3, { incharge: 'Ramesh' });
    const [named, blank] = await passCodes(db, ramesh, 'mobile-pandal', [2, 3]);
    await db.updateTable('passes').set({ name: 'Someone Else' }).where('serial', 'in', [2, 3]).execute();
    const r = await checkPass(db, gate, named.code);
    expect(r.verdict).toBe('check');
    expect(r.reasons.join(' ')).toContain('now SOMEONE ELSE');
    expect((await checkPass(db, gate, blank.code)).verdict).toBe('valid');
    await db.updateTable('passes').set({ printed_at: null }).where('serial', '=', 3).execute();
    expect((await checkPass(db, gate, blank.code)).verdict).toBe('check');
  });

  it('says CHECK for a genuine pass whose Given is not ticked, even with details filled in', async () => {
    await addPass(5, { name: 'Harpreet Singh', incharge: 'Ramesh', given: false });
    const [{ code }] = await passCodes(db, ramesh, 'mobile-pandal', [5]);
    const r = await checkPass(db, gate, code);
    expect(r.verdict).toBe('check');
    expect(r.reasons.join(' ')).toContain('Given not ticked');
  });

  it('says NOT VALID for a pass not in the register, a fake, and after a new key', async () => {
    const [missing] = await passCodes(db, ramesh, 'mobile-pandal', [99]);
    expect((await checkPass(db, gate, missing.code)).reasons).toContain('Not in the register.');
    await addPass(4, { incharge: 'Ramesh' });
    const [real] = await passCodes(db, ramesh, 'mobile-pandal', [4]);
    const fake = real.code.slice(0, -5) + ((Number(real.code.slice(-5)) + 1) % 100000).toString().padStart(5, '0');
    expect((await checkPass(db, gate, fake)).verdict).toBe('invalid');
    expect((await checkPass(db, gate, 'hello')).claim).toBeNull();
    await db.deleteFrom('settings').execute();
    await passCodes(db, ramesh, 'mobile-pandal', [4]); // makes a new key
    expect((await checkPass(db, gate, real.code)).verdict).toBe('invalid');
  });
});
