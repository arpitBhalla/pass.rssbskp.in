import { describe, expect, it } from 'vitest';
import { cleanField, formatPhone, formatRegNo, type Pass, type PassType } from '@/shared/types';
import { exportCSV, exportTable, planImport } from './csv';
import {
  blankPass, cleanFill, filterPasses, hidePasses, isMultiCell, missingSerials, NO_FILTERS, planClear, planDelete, planFill, planGiven, planPaste, planUnprint,
  cardsLabel, forPrint, planLost, planPrint, planQueue, ranges, readyToPrint, unfilledOf,
} from './passes';
import { findDuplicates } from './people';
import { buildReport, reportCSV } from './report';

let id = 0;
function pass(serial: number, extra: Partial<Pass> = {}, type: PassType = 'mobile-pandal'): Pass {
  return {
    id: ++id, type, serial, name: '', dept: '', area: '', phone: '', vehicle: '', vehicle_no: '', incharge: '', issued_to: '', packet: '',
    printed_at: null, given_at: null, printed_by: null, given_by: null, meta: {}, lost_at: null, copy_of: null, created_at: '2026-11-10T06:00:00.000Z', created_by: 1, updated_by: 1, rev: 1, ...extra,
  };
}
const sheet = (from: number, to: number, extra: Partial<Pass> = {}) =>
  Array.from({ length: to - from + 1 }, (_, i) => pass(from + i, extra));

describe('lost passes', () => {
  const printed = '2026-11-20T06:00:00.000Z';
  it('marks printed passes LOST and adds a duplicate of each at the end, with the same details', () => {
    const s = [
      pass(1, { name: 'AMIT', phone: '9000000011', issued_to: 'RAJ', printed_at: printed, given_at: printed, packet: '3' }),
      pass(2, { name: 'B' }),
      pass(3, { name: 'C', printed_at: printed, lost_at: printed }),
      pass(5, { name: 'D', printed_at: printed }),
    ];
    const plan = planLost(s, 'mobile-pandal', '1', '3');
    expect(plan.serials).toEqual([1]);
    expect(plan.notPrinted).toEqual([2]);
    expect(plan.to).toEqual([6]);
    expect(plan.set).toEqual([{ id: s[0].id, lost: true, expect: { lost: false, printed: true } }]);
    expect(plan.create).toEqual([{ type: 'mobile-pandal', serial: 6, values: { name: 'AMIT', phone: '9000000011', issued_to: 'RAJ' }, flags: {}, copy_of: s[0].id }]);
  });
  it("a lost pass's duplicate does not repeat its phone", () => {
    const a = pass(1, { name: 'A', phone: '9000000011', printed_at: printed, lost_at: printed, incharge: 'X' });
    const b = pass(2, { name: 'A', phone: '9000000011', copy_of: a.id, incharge: 'X' });
    expect(findDuplicates([a, b]).size).toBe(0);
    expect(findDuplicates([{ ...a, lost_at: null }, b]).size).toBe(2);
  });
});

describe('Ferry Sewa (Gate 3 Hospital)', () => {
  const H = 'gate3-hospital' as const;
  it('Give ticks it on the passes given, never unticks, and counts it as filled in', () => {
    const ticked = pass(2, { name: 'A', meta: { ferry: true } }, H);
    const rows = [pass(1, {}, H), ticked];
    const plan = planFill(rows, H, '1', '3', { name: 'A' }, undefined, { ferry: true });
    expect(plan.set).toEqual([
      { id: rows[0].id, values: { name: 'A' }, expect: { name: '', flags: { ferry: false } }, flags: { ferry: true } },
    ]);
    expect(plan.same).toBe(1);
    expect(plan.create).toEqual([{ type: H, serial: 3, values: { name: 'A' }, flags: { ferry: true } }]);
    // Not ticked in the Give box: left as it is.
    expect(planFill(rows, H, '2', '2', { name: 'A' }).same).toBe(1);
    // A sheet without it: nothing to tick.
    expect(planFill([pass(1)], 'mobile-pandal', '1', '1', { name: 'A' }, undefined, { ferry: true }).set[0]).not.toHaveProperty('flags');
    expect(hidePasses([pass(5, { meta: { ferry: true } }, H)], H, ['empty'])).toHaveLength(1);
  });
  it('prints with the pass and is checked when marking printed; exported as a column', () => {
    const p = pass(1, { name: 'A', dept: 'D', area: 'R', phone: '9', vehicle_no: 'HR-26DK-4417', meta: { ferry: true } }, H);
    const plan = planPrint([p], H, '1', '1');
    expect(plan.cards[0].meta).toEqual({ ferry: true });
    expect(plan.set[0].expect).toMatchObject({ flags: { ferry: true }, printed: false });
    const [head, row] = exportTable([p], H);
    expect(row[head.indexOf('Ferry Sewa')]).toBe('Yes');
    expect(head.indexOf('Ferry Sewa')).toBe(head.indexOf('Printed') - 1);
  });
});

describe('give / fill a range', () => {
  it('creates missing serials and fills blanks, never overwriting', () => {
    const s = [pass(1), pass(2, { incharge: 'SURESH' }), pass(3, { incharge: 'RAMESH' })];
    const plan = planFill(s, 'mobile-pandal', '1', '5', cleanFill('mobile-pandal', { incharge: ' RAMESH ', area: 'SIRSA' }));
    expect(plan.set.map((o) => o.id)).toEqual([s[0].id, s[2].id]);
    expect(plan.set[0]).toMatchObject({ values: { incharge: 'RAMESH', area: 'SIRSA' }, expect: { incharge: '', area: '' } });
    expect(plan.set[1]).toMatchObject({ values: { area: 'SIRSA' }, expect: { area: '' } }); // incharge already RAMESH
    expect(plan.create.map((c) => c.serial)).toEqual([4, 5]);
    expect(plan.skipped).toEqual([{ serial: 2, why: 'Incharge is SURESH' }]);
  });

  it('skips printed passes (locked) and counts ones already done', () => {
    const s = [pass(1, { printed_at: '2026-01-01T00:00:00Z' }), pass(2, { incharge: 'RAMESH' })];
    const plan = planFill(s, 'mobile-pandal', '1', '2', { incharge: 'RAMESH' });
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
    expect(cleanFill('bike-pandal', { vehicle_no: 'HR26', vehicle: 'SPLENDOR' })).toEqual({ vehicle_no: 'HR26' });
  });
});

describe('hiding rows', () => {
  const full = { name: 'A', dept: 'D', area: 'X', phone: '9812345678' };
  const s = [
    pass(1, { ...full, printed_at: 't', given_at: 't' }),
    pass(2, { ...full, printed_at: 't' }),
    pass(3, full),
    pass(4, { incharge: 'RAMESH' }), // partly filled in: details still empty
    pass(5),                         // nothing filled in
  ];
  const left = (hide: Parameters<typeof hidePasses>[2]) => hidePasses(s, 'mobile-pandal', hide).map((p) => p.serial);
  it('hides each kind, and any mix of them', () => {
    expect(left([])).toEqual([1, 2, 3, 4, 5]);
    expect(left(['printed'])).toEqual([3, 4, 5]);
    expect(left(['given'])).toEqual([2, 3, 4, 5]);
    expect(left(['filled'])).toEqual([4, 5]);
    expect(left(['partial'])).toEqual([1, 2, 3, 5]);
    expect(left(['empty'])).toEqual([1, 2, 3, 4]);
    expect(left(['printed', 'partial', 'empty'])).toEqual([3]);
  });
  it('never calls a helpline pass partly filled in (it has no details)', () => {
    expect(hidePasses([pass(1, { incharge: 'R' }, 'eco')], 'eco', ['partial']).length).toBe(1);
  });
});

describe('rows picked while searching', () => {
  it('acts on only the rows picked, not the hidden ones between them', () => {
    const s = [pass(1, { printed_at: 't' }), pass(2, { printed_at: 't' }), pass(3, { printed_at: 't' }), pass(4), pass(5)];
    const only = [1, 3, 5];
    expect(planGiven(s, '1', '5', only).tickSerials).toEqual([1, 3]);
    expect(planUnprint(s, '1', '5', only).serials).toEqual([1, 3]);
    expect(planDelete(s, '1', '5', only).serials).toEqual([5]);
    expect(planFill(s, 'mobile-pandal', '1', '7', { incharge: 'R' }, [4, 7]).serials).toEqual([4, 7]);
    const full = { name: 'A', dept: 'D', area: 'X', phone: '9812345678' };
    expect(planPrint([pass(1, full), pass(2, full), pass(3, full)], 'mobile-pandal', '1', '3', [1, 3]).cards.map((c) => c.serial)).toEqual([1, 3]);
  });
});

describe('what a pass prints', () => {
  it('prints a detail of only symbols (typed to leave it blank) empty; it still counts as filled in', () => {
    const p = pass(1, { name: 'A. SINGH', dept: '.', area: '-', phone: ' / ', vehicle: '', vehicle_no: 'HR-26AB-1234' }, 'tractor-trolley');
    expect(forPrint(p)).toMatchObject({ name: 'A. SINGH', dept: '', area: '', phone: '', vehicle: '', vehicle_no: 'HR-26AB-1234' });
    expect(unfilledOf('tractor-trolley', p)).toEqual(['vehicle']);
    expect(forPrint(pass(2, { name: 'हरप्रीत', dept: '9' })).name).toBe('हरप्रीत');
  });
});

describe('paste from Excel', () => {
  const rowsOf = (s: Pass[]) => s.map((p) => [p]);

  it('fills down and across, and adds new passes past the last row', () => {
    const s = sheet(1, 2);
    const plan = planPaste({
      type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'name', nextSerial: 3, canCreate: true,
      text: 'AMIT\tLangar\tDelhi\nRaj\tSecurity\tSirsa\nVijay\t\tHisar\n',
    });
    expect(plan.set).toHaveLength(2);
    expect(plan.set[1]).toMatchObject({ values: { name: 'RAJ', dept: 'SECURITY', area: 'SIRSA' } });
    expect(plan.create).toEqual([{ type: 'mobile-pandal', serial: 3, values: { name: 'VIJAY', area: 'HISAR' } }]);
    expect(plan.rows).toBe(3);
  });

  it('skips a copied header row and fills Vehicle and Reg. No. on vehicle sheets', () => {
    const s = [pass(1, {}, 'sewa-vehicle')];
    const plan = planPaste({
      type: 'sewa-vehicle', rows: rowsOf(s), start: 0, key: 'vehicle', nextSerial: 2, canCreate: false,
      text: 'Vehicle\tReg. No.\nSwift car\tHR 26 AB 1234\n',
    });
    expect(plan.skippedHeader).toBe(true);
    expect(plan.set[0].values).toEqual({ vehicle: 'SWIFT CAR', vehicle_no: 'HR-26AB-1234' });
  });

  it('refuses to paste over printed passes, and lists what it overwrites', () => {
    const s = [pass(1, { name: 'OLD' }), pass(2, { printed_at: '2026-01-01T00:00:00Z' })]; // blank but printed: still locked
    const ok = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'name', text: 'NEW\n', nextSerial: 3, canCreate: false });
    expect(ok.replaced).toEqual([{ serial: 1, key: 'name', from: 'OLD', to: 'NEW' }]);
    const bad = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'name', text: 'A\nB\n', nextSerial: 3, canCreate: false });
    expect(bad.error).toMatch(/0002 is printed/);
  });

  it('lists every filled cell a paste replaces (the sheet asks first), but not empty ones or ones that stay the same', () => {
    const s = [pass(1, { name: 'ASHA', dept: 'LANGAR' }), pass(2, { name: 'RAVI' }), pass(3)];
    const plan = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'name', text: 'ASHA\tSecurity\nRavinder\t\nNew\tCanteen\n', nextSerial: 4, canCreate: false });
    expect(plan.replaced).toEqual([
      { serial: 1, key: 'dept', from: 'LANGAR', to: 'SECURITY' },
      { serial: 2, key: 'name', from: 'RAVI', to: 'RAVINDER' },
    ]);
    const empty = planPaste({ type: 'mobile-pandal', rows: rowsOf([pass(3)]), start: 0, key: 'name', text: 'NEW\n', nextSerial: 4, canCreate: false });
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
    const s = sheet(1, 3, { incharge: 'RAMESH' });
    const plan = planPaste({ type: 'mobile-pandal', rows: [s], start: 0, key: 'dept', text: 'LANGAR\tSirsa', nextSerial: 4, canCreate: false });
    expect(plan.set).toHaveLength(3);
    expect(isMultiCell('LANGAR\tSirsa')).toBe(true);
    expect(isMultiCell('LANGAR\n')).toBe(false);
  });
});

describe('sheet', () => {
  it('search: a number finds that serial, text finds names', () => {
    const s = [pass(105, { name: 'AMIT' }), pass(5, { phone: '9810512345' })];
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
    const s = [pass(1, { name: 'KAUR, HARPREET', phone: '99965-77213', printed_at: '2026-01-01T00:00:00Z', given_at: '2026-01-02T00:00:00Z' }), pass(2, { incharge: 'MOHAN' })];
    const plan = planImport([], 'mobile-pandal', exportCSV(s, 'mobile-pandal'));
    expect(plan.create).toEqual([
      { type: 'mobile-pandal', serial: 1, values: { name: 'KAUR, HARPREET', phone: '99965-77213' }, printed: true, given: true },
      { type: 'mobile-pandal', serial: 2, values: { incharge: 'MOHAN' }, printed: false, given: false },
    ]);
    // Importing it again changes nothing.
    const again = planImport([pass(1, { name: 'KAUR, HARPREET', phone: '99965-77213', printed_at: 'x', given_at: 'x' }), pass(2, { incharge: 'MOHAN' })], 'mobile-pandal', exportCSV(s, 'mobile-pandal'));
    expect(again).toMatchObject({ set: [], create: [], same: 2 });
  });

  it('reads old-app exports: Type + Pandal / Non Pandal pick the sheet', () => {
    const old = 'Serial,Type,Pandal / Non Pandal,Name,Incharge\nM-001,Mobile,Pandal,AMIT,\nM-002,Mobile,Non Pandal,RAJ,\nB-001,Bike,Pandal,,MOHAN\nM-003,Mobile,,VIJAY,\n';
    const plan = planImport([], 'mobile-pandal', old);
    expect(plan.create.map((c) => c.serial)).toEqual([1]);
    expect(plan).toMatchObject({ otherSheet: 2, unknownSheet: 1 });
    expect(planImport([], 'bike-pandal', old).create).toEqual([{ type: 'bike-pandal', serial: 1, values: { incharge: 'MOHAN' }, printed: false, given: false }]);
  });

  it('never overwrites a different saved value', () => {
    const plan = planImport([pass(1, { name: 'AMIT' })], 'mobile-pandal', 'Sr. No.,Name,Dept\n1,RAJ,LANGAR\n');
    expect(plan.clashes).toEqual(['0001 (Name)']);
    expect(plan.set).toHaveLength(0);
  });
});

describe('cut and clear', () => {
  it('empties the columns once per pass, skips unfilled rows, refuses printed passes', () => {
    const a = pass(1, { name: 'AMIT', dept: 'LANGAR' });
    const plan = planClear([a, a, blankPass('mobile-pandal', 2), pass(3)], ['name', 'dept']);
    expect(plan.set).toEqual([{ id: a.id, values: { name: '', dept: '' }, expect: { name: 'AMIT', dept: 'LANGAR' } }]);
    expect(plan.cells).toBe(2);
    expect(planClear([pass(4, { name: 'RAJ', printed_at: '2026-11-12T10:00:00Z' })], ['name']).locked).toEqual([4]);
    expect(planClear([pass(5, { issued_to: 'RAJ', printed_at: '2026-11-12T10:00:00Z' })], ['issued_to']).set).toHaveLength(1);
  });

  it('a fill from an empty cell empties every row below, not just the first', () => {
    const s = sheet(1, 3, { dept: 'LANGAR' });
    const plan = planPaste({ type: 'mobile-pandal', rows: s.map((p) => [p]), start: 0, key: 'dept', nextSerial: 4, canCreate: false, text: [[''], [''], ['']] });
    expect(plan.set.map((o) => o.values)).toEqual([{ dept: '' }, { dept: '' }, { dept: '' }]);
  });
});

describe('Issued To and Reg. No.', () => {
  const rowsOf = (s: Pass[]) => s.map((p) => [p]);
  const printed = { printed_at: '2026-11-12T10:00:00Z', name: 'AMIT' };

  it('writes number plates one way, and leaves anything else as typed', () => {
    expect(formatRegNo('hr24ab9168')).toBe('HR-24AB-9168');
    expect(formatRegNo('HR 24 H 4877')).toBe('HR-24H-4877');
    expect(formatRegNo('HR-24-T-1457')).toBe('HR-24T-1457');
    expect(formatRegNo('HR-24AB-9168')).toBe('HR-24AB-9168');
    expect(formatRegNo('dl3cab1234')).toBe('DL-3CAB-1234');
    expect(formatRegNo('HR26 1234')).toBe('HR-26-1234');
    for (const v of ['E-SCOOTY', 'SWIFT CAR', '22BH1234AA', 'Applied for', 'HR26']) expect(formatRegNo(v)).toBe(v);
  });

  it('writes mobile numbers 98765-43210, each of several, and leaves anything else as typed', () => {
    for (const v of ['9876543210', '98765 43210', '98765-43210', '+91 98765 43210', '+919876543210', '098765 43210', ' 98765.43210 ']) {
      expect(formatPhone(v).trim()).toBe('98765-43210');
    }
    expect(formatPhone('9810007919 / 98111 22222')).toBe('98100-07919 / 98111-22222');
    expect(formatPhone('9810007919, 0124-2345678')).toBe('98100-07919, 0124-2345678');
    for (const v of ['98765', '987654321', '98765432109', 'NA', '']) expect(formatPhone(v)).toBe(v);
  });

  it('saves every value in capitals, plates and phones written one way', () => {
    expect(cleanField('name', '  harpreet  Singh ')).toBe('HARPREET  SINGH');
    expect(cleanField('dept', 'SECURITY')).toBe('SECURITY');
    expect(cleanField('vehicle', 'SWIFT CAR')).toBe('SWIFT CAR');
    expect(cleanField('vehicle_no', 'hr24ab9168')).toBe('HR-24AB-9168');
    expect(cleanField('phone', '+91 98765 43210')).toBe('98765-43210');
    expect(cleanField('phone', '9810007919 or 9811122222')).toBe('98100-07919 OR 98111-22222');
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
    const ok = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'issued_to', nextSerial: 2, canCreate: false, text: 'HARJIT\n' });
    expect(ok.error).toBe('');
    expect(ok.set[0]).toMatchObject({ values: { issued_to: 'HARJIT' }, expect: { issued_to: '' } });
    const no = planPaste({ type: 'mobile-pandal', rows: rowsOf(s), start: 0, key: 'incharge', nextSerial: 2, canCreate: false, text: 'MOHAN\tHarjit\n' });
    expect(no.error).toMatch(/0001 is printed/);
  });

  it('exports Issued To after Given, and imports it onto printed passes too', () => {
    const s = [pass(1, { ...printed, given_at: '2026-11-12T11:00:00Z', issued_to: 'HARJIT' })];
    const [head, row] = exportTable(s, 'mobile-pandal');
    expect(head.slice(head.indexOf('Given'))).toEqual(['Given', 'Issued To', 'Added', 'Added by']);
    expect(row[head.indexOf('Issued To')]).toBe('HARJIT');
    const plan = planImport([pass(1, printed)], 'mobile-pandal', 'Sr. No.,Name,Issued To\n0001,AMIT,HARJIT\n');
    expect(plan.clashes).toEqual([]);
    expect(plan.set[0].values).toEqual({ issued_to: 'HARJIT' });
  });
});

describe('report', () => {
  it('counts each sheet by area then dept, ignoring case', () => {
    const ps = [
      pass(1, { area: 'SIRSA', dept: 'LANGAR' }),
      pass(2, { area: 'SIRSA', dept: 'LANGAR' }, 'bike-pandal'),
      pass(3, { area: 'DELHI', dept: '' }, 'sewa-vehicle'),
    ];
    const r = buildReport(ps, 'area');
    expect(r.groups.map((g) => [g.label, g.total])).toEqual([['DELHI', 1], ['SIRSA', 2]]);
    expect(r.groups[1].lines[0]).toMatchObject({ label: 'LANGAR', serials: 'MP 0001 · BP 0002' });
    expect(r.total.counts['sewa-vehicle']).toBe(1);
    expect(reportCSV(r).split('\r\n').at(-1)).toBe('All,Total,1,0,1,0,1,0,0,0,0,0,0,0,0,0,3,,');
  });
});

describe('print', () => {
  const full = { name: 'AMIT', dept: 'LANGAR', area: 'SIRSA', phone: '98765-43210' };
  it('prints the passes filled in and not printed yet', () => {
    const s = [pass(1, full), pass(2, { ...full, printed_at: 'x' }), pass(4, { ...full, phone: '' }), pass(5, { incharge: 'MOHAN', area: 'DELHI' })];
    const plan = planPrint(s, 'mobile-pandal', '1', '5');
    expect(plan.cards.map((c) => c.serial)).toEqual([1]);
    expect(plan.printed).toEqual([2]);
    expect(plan.unfilled).toEqual([3, 4, 5]); // not in the register; no phone; only an area
    expect(plan.set).toEqual([{ id: s[0].id, printed: true, expect: { ...full, vehicle: '', vehicle_no: '', printed: false } }]);
    expect(plan.create).toEqual([]);
  });
  it('needs every detail its sheet has: a bike pass its Reg. No. too, not Incharge or Issued To', () => {
    const bike = (extra: Partial<Pass>) => ({ ...blankPass('bike-pandal', 1), id: 1, ...full, ...extra });
    expect(unfilledOf('bike-pandal', bike({}))).toEqual(['vehicle_no']);
    expect(unfilledOf('bike-pandal', bike({ vehicle_no: 'HR-24K-9300' }))).toEqual([]);
    expect(unfilledOf('mobile-pandal', undefined)).toEqual(['name', 'dept', 'area', 'phone']);
  });
  it('the print queue: Pandal and Non Pandal together, sheet by sheet and by serial, by the same rules', () => {
    const mp = [pass(7, full), pass(3, full), pass(5, { ...full, printed_at: 'x' })];
    const mn = [pass(2, full, 'mobile-non-pandal'), pass(4, { ...full, area: '' }, 'mobile-non-pandal')];
    const sheetOf = (t: PassType) => (t === 'mobile-pandal' ? mp : t === 'mobile-non-pandal' ? mn : []);
    const items = [{ type: 'mobile-non-pandal', serial: 2 }, { type: 'mobile-pandal', serial: 7 }, { type: 'mobile-pandal', serial: 3 },
      { type: 'mobile-pandal', serial: 5 }, { type: 'mobile-non-pandal', serial: 4 }] as const;
    const plan = planQueue(items, sheetOf);
    expect(plan.cards.map((c) => `${c.type} ${c.serial}`)).toEqual(['mobile-pandal 3', 'mobile-pandal 7', 'mobile-non-pandal 2']);
    expect(plan.set.map((o) => o.id)).toEqual([mp[1].id, mp[0].id, mn[0].id]);
    expect([plan.printed, plan.unfilled]).toEqual([[5], [4]]);
    expect(cardsLabel(plan.cards)).toBe('Mobile Pandal 0003, 0007, Mobile Non Pandal 0002');
  });
  it('helpline passes have no details: serials not in the register print, and are added', () => {
    const plan = planPrint([], 'e-rickshaw', '1', '2');
    expect(plan.cards.map((c) => c.serial)).toEqual([1, 2]);
    expect(plan.create[0]).toEqual({ type: 'e-rickshaw', serial: 1, values: {}, printed: true });
    expect(planPrint([], 'eco', '1', '1000').err).toMatch(/at most 900/);
  });
});

describe('Given and Delete for a range', () => {
  it('Given: ticks what is printed and unticked, unticks what is ticked, ignores serials not in the register', () => {
    const printed = { printed_at: '2026-11-13T09:00:00Z' };
    const s = [pass(1, printed), pass(2, { ...printed, given_at: 'x' }), pass(3), pass(4, { ...printed, incharge: 'MOHAN' })];
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
    const s = [pass(1), pass(2, { printed_at: 'x' }), pass(3, { incharge: 'MOHAN', rev: 7 })];
    const plan = planDelete(s, '3', '1');
    expect(plan.serials).toEqual([1, 3]);
    expect(plan.items[1]).toEqual({ id: s[2].id, rev: 7 });
    expect(plan.printed).toEqual([2]);
  });

  it('a filled-in pass is not Given until ticked, and filters follow the tick', () => {
    const s = [pass(1, { incharge: 'MOHAN' }), pass(2, { given_at: 'x' })];
    expect(filterPasses(s, { ...NO_FILTERS, show: 'given' }).map((p) => p.serial)).toEqual([2]);
    expect(filterPasses(s, { ...NO_FILTERS, show: 'free' }).map((p) => p.serial)).toEqual([1]);
  });
});

describe('readyToPrint', () => {
  it('lists the passes that would print now, lowest serials first', () => {
    const full = { name: 'A', dept: 'D', area: 'R', phone: '9' };
    const rows = [pass(3, full), pass(1, full), pass(2, { name: 'B' }), pass(4, { ...full, printed_at: '2026-11-20T00:00:00Z' })];
    expect(readyToPrint(rows, 'mobile-pandal').map((p) => p.serial)).toEqual([1, 3]);
  });
});
