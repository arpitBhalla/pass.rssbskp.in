import { describe, expect, it } from 'vitest';
import { formatRegNo, type Pass, type PassType } from '@/shared/types';
import { exportCSV, exportTable, planImport } from './csv';
import {
  blankPass, cleanFill, filterPasses, groupRuns, isMultiCell, missingSerials, NO_FILTERS, planClear, planDelete, planFill, planGiven, planPaste, planUnprint,
  planPrint, ranges,
} from './passes';
import { buildReport, reportCSV } from './report';

let id = 0;
function pass(serial: number, extra: Partial<Pass> = {}, type: PassType = 'mobile-pandal'): Pass {
  return {
    id: ++id, type, serial, name: '', dept: '', area: '', phone: '', vehicle: '', vehicle_no: '', incharge: '', issued_to: '',
    printed_at: null, given_at: null, created_at: '2026-11-10T06:00:00.000Z', created_by: 1, updated_by: 1, rev: 1, ...extra,
  };
}
const sheet = (from: number, to: number, extra: Partial<Pass> = {}) =>
  Array.from({ length: to - from + 1 }, (_, i) => pass(from + i, extra));

describe('give / fill a range', () => {
  it('creates missing serials and fills blanks, never overwriting', () => {
    const s = [pass(1), pass(2, { incharge: 'Suresh' }), pass(3, { incharge: 'Ramesh' })];
    const plan = planFill(s, 'mobile-pandal', '1', '5', cleanFill('mobile-pandal', { incharge: ' Ramesh ', area: 'Sirsa' }));
    expect(plan.set.map((o) => o.id)).toEqual([s[0].id, s[2].id]);
    expect(plan.set[0]).toMatchObject({ values: { incharge: 'Ramesh', area: 'Sirsa' }, expect: { incharge: '', area: '' } });
    expect(plan.set[1]).toMatchObject({ values: { area: 'Sirsa' }, expect: { area: '' } }); // incharge already Ramesh
    expect(plan.create.map((c) => c.serial)).toEqual([4, 5]);
    expect(plan.skipped).toEqual([{ serial: 2, why: 'Incharge is Suresh' }]);
  });

  it('skips printed passes (locked) and counts ones already done', () => {
    const s = [pass(1, { printed_at: '2026-01-01T00:00:00Z' }), pass(2, { incharge: 'Ramesh' })];
    const plan = planFill(s, 'mobile-pandal', '1', '2', { incharge: 'Ramesh' });
    expect(plan.set).toEqual([]);
    expect(plan.skipped).toEqual([{ serial: 1, why: 'printed' }]);
    expect(plan.same).toBe(1);
  });

  it('accepts To blank (one pass), either order, and old-style serials', () => {
    expect(planFill([], 'bike-pandal', 'M-0007', '', { incharge: 'X' }).create.map((c) => c.serial)).toEqual([7]);
    expect(planFill([], 'bike-pandal', '9', '7', { incharge: 'X' }).create.map((c) => c.serial)).toEqual([7, 8, 9]);
    expect(planFill([], 'bike-pandal', '', '', { incharge: 'X' }).err).toMatch(/Enter the From/);
    expect(planFill([], 'bike-pandal', '1', '9000', { incharge: 'X' }).err).toMatch(/at most/);
  });

  it('drops Vehicle No. on sheets without it', () => {
    expect(cleanFill('mobile-pandal', { vehicle_no: 'HR26', name: 'A' })).toEqual({ name: 'A' });
    expect(cleanFill('sewa-vehicle', { vehicle_no: 'HR26' })).toEqual({ vehicle_no: 'HR26' });
    expect(cleanFill('bike-pandal', { vehicle_no: 'HR26', vehicle: 'Splendor' })).toEqual({ vehicle_no: 'HR26' });
  });
});

describe('paste from Excel', () => {
  const rowsOf = (s: Pass[]) => s.map((p) => [p]);

  it('fills down and across, and adds new passes past the last row', () => {
    const s = sheet(1, 2);
    const plan = planPaste({
      type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'name', nextSerial: 3, canCreate: true,
      text: 'Amit\tLangar\tDelhi\nRaj\tSecurity\tSirsa\nVijay\t\tHisar\n',
    });
    expect(plan.set).toHaveLength(2);
    expect(plan.set[1]).toMatchObject({ values: { name: 'Raj', dept: 'Security', area: 'Sirsa' } });
    expect(plan.create).toEqual([{ type: 'mobile-pandal', serial: 3, values: { name: 'Vijay', area: 'Hisar' } }]);
    expect(plan.rows).toBe(3);
  });

  it('skips a copied header row and fills Vehicle and Reg. No. on vehicle sheets', () => {
    const s = [pass(1, {}, 'sewa-vehicle')];
    const plan = planPaste({
      type: 'sewa-vehicle', rows: rowsOf(s), start: 0, key: 'vehicle', nextSerial: 2, canCreate: false,
      text: 'Vehicle\tReg. No.\nSwift car\tHR 26 AB 1234\n',
    });
    expect(plan.skippedHeader).toBe(true);
    expect(plan.set[0].values).toEqual({ vehicle: 'Swift car', vehicle_no: 'HR-26AB-1234' });
  });

  it('refuses to paste over printed passes, and lists what it overwrites', () => {
    const s = [pass(1, { name: 'Old' }), pass(2, { printed_at: '2026-01-01T00:00:00Z' })]; // blank but printed: still locked
    const ok = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'name', text: 'New\n', nextSerial: 3, canCreate: false });
    expect(ok.replaced).toEqual([{ serial: 1, key: 'name', from: 'Old', to: 'New' }]);
    const bad = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'name', text: 'A\nB\n', nextSerial: 3, canCreate: false });
    expect(bad.error).toMatch(/0002 is printed/);
  });

  it('lists every filled cell a paste replaces (the sheet asks first), but not empty ones or ones that stay the same', () => {
    const s = [pass(1, { name: 'Asha', dept: 'Langar' }), pass(2, { name: 'Ravi' }), pass(3)];
    const plan = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'name', text: 'Asha\tSecurity\nRavinder\t\nNew\tCanteen\n', nextSerial: 4, canCreate: false });
    expect(plan.replaced).toEqual([
      { serial: 1, key: 'dept', from: 'Langar', to: 'Security' },
      { serial: 2, key: 'name', from: 'Ravi', to: 'Ravinder' },
    ]);
    const empty = planPaste({ type: 'mobile-pandal', rows: rowsOf([pass(3)]), start: 0, key: 'name', text: 'New\n', nextSerial: 4, canCreate: false });
    expect(empty.replaced).toEqual([]);
  });

  it('pasting over unfilled rows adds those serials', () => {
    const s = [pass(1), pass(4)];
    expect(missingSerials(s)).toEqual([2, 3]);
    const rows = [[s[0]], [blankPass('mobile-pandal', 2)], [blankPass('mobile-pandal', 3)], [s[1]]];
    const plan = planPaste({ type: 'mobile-pandal', rows, start: 1, key: 'name', text: 'A\n\nC\n', nextSerial: 5, canCreate: true });
    expect(plan.create).toEqual([{ type: 'mobile-pandal', serial: 2, values: { name: 'A' } }]);
    expect(plan.set).toEqual([{ id: s[1].id, values: { name: 'C' }, expect: { name: '' } }]);
  });

  it('a pasted line fills every pass of a collapsed series', () => {
    const s = sheet(1, 3, { incharge: 'Ramesh' });
    const plan = planPaste({ type: 'mobile-pandal', rows: [s], start: 0, key: 'dept', text: 'Langar\tSirsa', nextSerial: 4, canCreate: false });
    expect(plan.set).toHaveLength(3);
    expect(isMultiCell('Langar\tSirsa')).toBe(true);
    expect(isMultiCell('Langar\n')).toBe(false);
  });
});

describe('sheet', () => {
  it('groups a series given to one incharge; a name or printing breaks it', () => {
    const s = sheet(1, 6, { incharge: 'Ramesh' });
    s[2] = { ...s[2], name: 'Amit' };
    s[5] = { ...s[5], printed_at: '2026-01-01T00:00:00Z' };
    expect(groupRuns(s).map((r) => r.length)).toEqual([2, 1, 2, 1]);
    expect(groupRuns(sheet(1, 3)).every((r) => r.length === 1)).toBe(true); // nobody given: no groups
  });

  it('search: a number finds that serial, text finds names', () => {
    const s = [pass(105, { name: 'Amit' }), pass(5, { phone: '9810512345' })];
    expect(filterPasses(s, { ...NO_FILTERS, q: '105' }).map((p) => p.serial)).toEqual([105]);
    expect(filterPasses(s, { ...NO_FILTERS, q: 'ami' })).toHaveLength(1);
    expect(filterPasses(s, NO_FILTERS)).toBe(s);
    expect(ranges([3, 1, 2, 7])).toBe('0001–0003, 0007');
  });
});

describe('date range', () => {
  it('lists passes added between two dates (either order, either end open)', () => {
    const s = [
      pass(1, { created_at: '2026-11-01T06:00:00.000Z' }),
      pass(2, { created_at: '2026-11-05T06:00:00.000Z' }),
      pass(3, { created_at: '2026-11-09T06:00:00.000Z' }),
    ];
    const serials = (from: string, to: string) => filterPasses(s, { ...NO_FILTERS, from, to }).map((p) => p.serial);
    expect(serials('2026-11-02', '2026-11-09')).toEqual([2, 3]);
    expect(serials('2026-11-09', '2026-11-02')).toEqual([2, 3]);
    expect(serials('', '2026-11-05')).toEqual([1, 2]);
    expect(serials('2026-11-05', '')).toEqual([2, 3]);
  });
});

describe('CSV', () => {
  it('round-trips through export and import into the same sheet', () => {
    const s = [pass(1, { name: 'Kaur, Harpreet', phone: '+919996577213', printed_at: '2026-01-01T00:00:00Z', given_at: '2026-01-02T00:00:00Z' }), pass(2, { incharge: 'Mohan' })];
    const plan = planImport([], 'mobile-pandal', exportCSV(s, 'mobile-pandal'));
    expect(plan.create).toEqual([
      { type: 'mobile-pandal', serial: 1, values: { name: 'Kaur, Harpreet', phone: '+919996577213' }, printed: true, given: true },
      { type: 'mobile-pandal', serial: 2, values: { incharge: 'Mohan' }, printed: false, given: false },
    ]);
    // Importing it again changes nothing.
    const again = planImport([pass(1, { name: 'Kaur, Harpreet', phone: '+919996577213', printed_at: 'x', given_at: 'x' }), pass(2, { incharge: 'Mohan' })], 'mobile-pandal', exportCSV(s, 'mobile-pandal'));
    expect(again).toMatchObject({ set: [], create: [], same: 2 });
  });

  it('reads old-app exports: Type + Pandal / Non Pandal pick the sheet', () => {
    const old = 'Serial,Type,Pandal / Non Pandal,Name,Incharge\nM-001,Mobile,Pandal,Amit,\nM-002,Mobile,Non Pandal,Raj,\nB-001,Bike,Pandal,,Mohan\nM-003,Mobile,,Vijay,\n';
    const plan = planImport([], 'mobile-pandal', old);
    expect(plan.create.map((c) => c.serial)).toEqual([1]);
    expect(plan).toMatchObject({ otherSheet: 2, unknownSheet: 1 });
    expect(planImport([], 'bike-pandal', old).create).toEqual([{ type: 'bike-pandal', serial: 1, values: { incharge: 'Mohan' }, printed: false, given: false }]);
  });

  it('never overwrites a different saved value', () => {
    const plan = planImport([pass(1, { name: 'Amit' })], 'mobile-pandal', 'Sr. No.,Name,Dept\n1,Raj,Langar\n');
    expect(plan.clashes).toEqual(['0001 (Name)']);
    expect(plan.set).toHaveLength(0);
  });
});

describe('cut and clear', () => {
  it('empties the columns once per pass, skips unfilled rows, refuses printed passes', () => {
    const a = pass(1, { name: 'Amit', dept: 'Langar' });
    const plan = planClear([a, a, blankPass('mobile-pandal', 2), pass(3)], ['name', 'dept']);
    expect(plan.set).toEqual([{ id: a.id, values: { name: '', dept: '' }, expect: { name: 'Amit', dept: 'Langar' } }]);
    expect(plan.cells).toBe(2);
    expect(planClear([pass(4, { name: 'Raj', printed_at: '2026-11-12T10:00:00Z' })], ['name']).locked).toEqual([4]);
    expect(planClear([pass(5, { issued_to: 'Raj', printed_at: '2026-11-12T10:00:00Z' })], ['issued_to']).set).toHaveLength(1);
  });

  it('a fill from an empty cell empties every row below, not just the first', () => {
    const s = sheet(1, 3, { dept: 'Langar' });
    const plan = planPaste({ type: 'mobile-pandal', rows: s.map((p) => [p]), start: 0, key: 'dept', nextSerial: 4, canCreate: false, text: [[''], [''], ['']] });
    expect(plan.set.map((o) => o.values)).toEqual([{ dept: '' }, { dept: '' }, { dept: '' }]);
  });
});

describe('Issued To and Reg. No.', () => {
  const rowsOf = (s: Pass[]) => s.map((p) => [p]);
  const printed = { printed_at: '2026-11-12T10:00:00Z', name: 'Amit' };

  it('writes number plates one way, and leaves anything else as typed', () => {
    expect(formatRegNo('hr24ab9168')).toBe('HR-24AB-9168');
    expect(formatRegNo('HR 24 H 4877')).toBe('HR-24H-4877');
    expect(formatRegNo('HR-24-T-1457')).toBe('HR-24T-1457');
    expect(formatRegNo('HR-24AB-9168')).toBe('HR-24AB-9168');
    expect(formatRegNo('dl3cab1234')).toBe('DL-3CAB-1234');
    expect(formatRegNo('HR26 1234')).toBe('HR-26-1234');
    for (const v of ['E-SCOOTY', 'Swift car', '22BH1234AA', 'Applied for', 'HR26']) expect(formatRegNo(v)).toBe(v);
  });

  it('a pasted or given plate is written one way, and search finds it typed without dashes', () => {
    const s = [pass(1, {}, 'bike-pandal')];
    const plan = planPaste({ type: 'bike-pandal', rows: rowsOf(s), start: 0, key: 'vehicle_no', nextSerial: 2, canCreate: false, text: 'hr 24 ab 9168\tSecurity\n' });
    expect(plan.set[0].values).toMatchObject({ vehicle_no: 'HR-24AB-9168' });
    expect(cleanFill('bike-pandal', { vehicle_no: 'hr24h4877' })).toEqual({ vehicle_no: 'HR-24H-4877' });
    const found = filterPasses([pass(1, { vehicle_no: 'HR-24AB-9168' }, 'bike-pandal'), pass(2, { vehicle_no: 'HR-24T-1457' }, 'bike-pandal')], { ...NO_FILTERS, q: 'hr24ab' });
    expect(found.map((p) => p.serial)).toEqual([1]);
  });

  it('Issued To can be pasted onto a printed pass; the other columns stay locked', () => {
    const s = [pass(1, printed)];
    const ok = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'issued_to', nextSerial: 2, canCreate: false, text: 'Harjit\n' });
    expect(ok.error).toBe('');
    expect(ok.set[0]).toMatchObject({ values: { issued_to: 'Harjit' }, expect: { issued_to: '' } });
    const no = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'incharge', nextSerial: 2, canCreate: false, text: 'Mohan\tHarjit\n' });
    expect(no.error).toMatch(/0001 is printed/);
  });

  it('exports Issued To after Given, and imports it onto printed passes too', () => {
    const s = [pass(1, { ...printed, given_at: '2026-11-12T11:00:00Z', issued_to: 'Harjit' })];
    const [head, row] = exportTable(s, 'mobile-pandal');
    expect(head.slice(head.indexOf('Given'))).toEqual(['Given', 'Issued To', 'Added', 'Added by']);
    expect(row[head.indexOf('Issued To')]).toBe('Harjit');
    const plan = planImport([pass(1, printed)], 'mobile-pandal', 'Sr. No.,Name,Issued To\n0001,Amit,Harjit\n');
    expect(plan.clashes).toEqual([]);
    expect(plan.set[0].values).toEqual({ issued_to: 'Harjit' });
  });
});

describe('report', () => {
  it('counts each sheet by area then dept, ignoring case', () => {
    const ps = [
      pass(1, { area: 'Sirsa', dept: 'Langar' }),
      pass(2, { area: 'SIRSA', dept: 'Langar' }, 'bike-pandal'),
      pass(3, { area: 'Delhi', dept: '' }, 'sewa-vehicle'),
    ];
    const r = buildReport(ps, 'area');
    expect(r.groups.map((g) => [g.label, g.total])).toEqual([['Delhi', 1], ['Sirsa', 2]]);
    expect(r.groups[1].lines[0]).toMatchObject({ label: 'Langar', serials: 'MP 0001 · BP 0002' });
    expect(r.total.counts['sewa-vehicle']).toBe(1);
    expect(reportCSV(r).split('\r\n').at(-1)).toBe('All,Total,1,0,1,0,1,0,0,0,0,0,0,0,0,3,,');
  });
});

describe('print', () => {
  it('prints unprinted and missing serials, skipping printed ones', () => {
    const s = [pass(1, { name: 'Amit' }), pass(2, { printed_at: 'x' })];
    const plan = planPrint(s, 'mobile-pandal', '1', '3');
    expect(plan.cards.map((c) => c.serial)).toEqual([1, 3]);
    expect(plan.printed).toEqual([2]);
    expect(plan.set).toEqual([{ id: s[0].id, printed: true, expect: { name: 'Amit', dept: '', area: '', phone: '', vehicle: '', vehicle_no: '', printed: false } }]);
    expect(plan.create).toEqual([{ type: 'mobile-pandal', serial: 3, values: {}, printed: true }]);
    expect(planPrint([], 'mobile-pandal', '1', '1000').err).toMatch(/at most 900/);
  });
});

describe('Given and Delete for a range', () => {
  it('Given: ticks what is printed and unticked, unticks what is ticked, ignores serials not in the register', () => {
    const printed = { printed_at: '2026-11-13T09:00:00Z' };
    const s = [pass(1, printed), pass(2, { ...printed, given_at: 'x' }), pass(3), pass(4, { ...printed, incharge: 'Mohan' })];
    const plan = planGiven(s, '1', '5');
    expect(plan.tickSerials).toEqual([1, 4]);
    expect(plan.untickSerials).toEqual([2]);
    expect(plan.notPrinted).toEqual([3]); // printed first, then given
    expect(plan.tick[0]).toEqual({ id: s[0].id, given: true, expect: { given: false } });
    expect(planGiven(s, '', '').err).toMatch(/Enter the From/);
  });

  it('Mark unprinted: unticks Printed on the printed ones only, given or not', () => {
    const s = [pass(1, { printed_at: 'x' }), pass(2), pass(3, { printed_at: 'x', given_at: 'y' })];
    const plan = planUnprint(s, '1', '4');
    expect(plan.serials).toEqual([1, 3]);
    expect(plan.set[0]).toEqual({ id: s[0].id, printed: false, expect: { printed: true } });
    expect(planUnprint(s, '', '').err).toMatch(/Enter the From/);
  });

  it('Delete: passes in the register, printed ones left out', () => {
    const s = [pass(1), pass(2, { printed_at: 'x' }), pass(3, { incharge: 'Mohan', rev: 7 })];
    const plan = planDelete(s, '3', '1');
    expect(plan.serials).toEqual([1, 3]);
    expect(plan.items[1]).toEqual({ id: s[2].id, rev: 7 });
    expect(plan.printed).toEqual([2]);
  });

  it('a filled-in pass is not Given until ticked, and filters follow the tick', () => {
    const s = [pass(1, { incharge: 'Mohan' }), pass(2, { given_at: 'x' })];
    expect(filterPasses(s, { ...NO_FILTERS, show: 'given' }).map((p) => p.serial)).toEqual([2]);
    expect(filterPasses(s, { ...NO_FILTERS, show: 'free' }).map((p) => p.serial)).toEqual([1]);
  });
});
