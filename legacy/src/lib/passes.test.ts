import { describe, expect, it } from 'vitest';
import type { Pass } from '../types';
import {
  addPasses, cleanFill, editPass, editPasses, fillPasses, filterPasses, groupRuns, nextStart, normalize, passesForPrint, pasteCells,
  planAdd, planFill, rangeSpan, ranges, setPrinted,
} from './passes';
import { barcodeBits } from './barcode';
import { exportCSV, importCSV } from './csv';
import { buildReport, reportCSV } from './report';

function register(): Pass[] {
  let ps: Pass[] = [];
  ps = addPasses(ps, 'Mobile', planAdd(ps, 'Mobile', 'M-', '1', '100').create);
  ps = addPasses(ps, 'Bike', planAdd(ps, 'Bike', 'B-', '1', '50').create);
  return ps;
}
const all = { q: '', type: '' as const, show: 'all' as const };

describe('adding passes', () => {
  it('creates zero-padded serials, sorted Mobile then Bike', () => {
    const ps = register();
    expect(ps).toHaveLength(150);
    expect(ps[0].serial).toBe('M-001');
    expect(ps[100].serial).toBe('B-001');
  });

  it('skips serials that already exist', () => {
    const ps = register();
    const plan = planAdd(ps, 'Mobile', 'M-', '90', '110');
    expect(plan.create).toHaveLength(10);
    expect(plan.existing).toBe(11);
  });

  it('suggests the number after the last pass of that type', () => {
    const ps = register();
    expect(nextStart(ps, 'Mobile')).toBe(101);
    expect(nextStart(ps, 'Bike')).toBe(51);
    expect(nextStart([], 'Bike')).toBe(1);
  });

  it('keeps the same digit width as existing serials', () => {
    const ps = addPasses([], 'Mobile', planAdd([], 'Mobile', 'M-', '1', '5000').create);
    expect(ps[0].serial).toBe('M-0001');
    expect(planAdd(ps, 'Mobile', 'M-', '5001', '10000').create[0].serial).toBe('M-5001');
  });

  it('rejects a backwards range', () => {
    expect(planAdd([], 'Mobile', 'M-', '10', '5').err).not.toBe('');
  });
});

describe('filling a range', () => {
  it('gives a range to an incharge, skipping passes held by someone else', () => {
    let ps = register();
    ps = editPass(ps, ps[2].id, 'incharge', 'Suresh'); // M-003 already with Suresh
    const plan = planFill(ps, 'Mobile', 'M-001', '10', { incharge: 'Ramesh' });
    expect(plan.take.map((p) => p.num)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10]);
    expect(plan.skipped.map((x) => x.why)).toEqual(['Incharge is Suresh']);

    ps = fillPasses(ps, new Set(plan.take.map((p) => p.id)), { incharge: 'Ramesh' });
    expect(ps.filter((p) => p.incharge === 'Ramesh')).toHaveLength(9);

    // Doing it again changes nothing.
    const again = planFill(ps, 'Mobile', '1', '10', { incharge: 'Ramesh' });
    expect(again.take).toHaveLength(0);
    expect(again.same).toBe(9);
    expect(planFill(ps, 'Mobile', '95', '105', { incharge: 'X' }).missing).toBe(5);
  });

  it('fills several columns and only fills blanks — never overwrites', () => {
    let ps = register();
    ps = editPass(ps, ps[0].id, 'name', 'Amit'); // a named pass can still get a dept / incharge
    ps = editPass(ps, ps[1].id, 'dept', 'Security');
    const values = cleanFill({ dept: ' Langar ', area: 'Sirsa', phone: '  ' });
    expect(values).toEqual({ dept: 'Langar', area: 'Sirsa' });
    const plan = planFill(ps, 'Mobile', '1', '3', values);
    expect(plan.take.map((p) => p.serial)).toEqual(['M-001', 'M-003']);
    expect(plan.skipped[0].why).toBe('Dept is Security');
    ps = fillPasses(ps, new Set(plan.take.map((p) => p.id)), values);
    expect(ps[0]).toMatchObject({ name: 'Amit', dept: 'Langar', area: 'Sirsa' });
  });

  it('sets Pandal / Non Pandal on Mobile passes, never overwriting the other one', () => {
    let ps = register();
    ps = editPass(ps, ps[1].id, 'zone', 'Non Pandal'); // M-002
    const plan = planFill(ps, 'Mobile', '1', '3', cleanFill({ zone: 'Pandal', incharge: 'Ramesh' }));
    expect(plan.take.map((p) => p.serial)).toEqual(['M-001', 'M-003']);
    expect(plan.skipped[0].why).toBe('already Non Pandal');
    ps = fillPasses(ps, new Set(plan.take.map((p) => p.id)), { zone: 'Pandal', incharge: 'Ramesh' });
    expect(ps.slice(0, 3).map((p) => p.zone)).toEqual(['Pandal', 'Non Pandal', 'Pandal']);
  });

  it('ignores Pandal / Non Pandal for Bike passes', () => {
    const ps = register();
    const plan = planFill(ps, 'Bike', '1', '2', { zone: 'Pandal', incharge: 'Ramesh' });
    expect(plan.take).toHaveLength(2);
    const next = fillPasses(ps, new Set(plan.take.map((p) => p.id)), { zone: 'Pandal', incharge: 'Ramesh' });
    expect(next.filter((p) => p.type === 'Bike' && p.zone)).toHaveLength(0);
  });

  it('loads passes saved before Pandal / Non Pandal and Printed existed', () => {
    expect(normalize({ id: 'a', type: 'Mobile', serial: 'M-001', num: 1, name: 'Amit' })).toMatchObject({ zone: '', printed: false });
  });

  it('explains when the range has no passes', () => {
    expect(planFill(register(), 'Bike', '500', '600', { incharge: 'X' }).err).toMatch(/No Bike passes/);
  });

  it('summarises ranges', () => {
    const ps = register().filter((p) => [1, 2, 3, 7].includes(p.num) && p.type === 'Mobile');
    expect(ranges(ps)).toBe('M-001–M-003, M-007');
  });
});

describe('sheet', () => {
  it('pastes a column of names downward from a row', () => {
    const ps = register();
    const view = filterPasses(ps, all);
    const r = pasteCells(ps, view.map((p) => [p]), 1, 'name', 'Amit\r\nPriya\r\nRahul\r\n');
    expect(r.rows).toBe(3);
    expect(r.passes.slice(0, 5).map((p) => p.name)).toEqual(['', 'Amit', 'Priya', 'Rahul', '']);
  });

  it('pastes several columns from Excel across Name → Dept → Area → Phone', () => {
    const ps = register();
    const r = pasteCells(ps, filterPasses(ps, all).map((p) => [p]), 0, 'name', 'Amit\tLangar\tSirsa\t9996577213\nPriya\tSecurity\n');
    expect(r.passes[0]).toMatchObject({ name: 'Amit', dept: 'Langar', area: 'Sirsa', phone: '9996577213' });
    expect(r.passes[1]).toMatchObject({ name: 'Priya', dept: 'Security', area: '' });
  });

  it('search: a plain number finds that serial in both types', () => {
    const ps = register();
    expect(filterPasses(ps, { ...all, q: '25' }).map((p) => p.serial)).toEqual(['M-025', 'B-025']);
  });

  it('filters given / free', () => {
    let ps = register();
    ps = editPass(ps, ps[0].id, 'incharge', 'Suresh');
    expect(filterPasses(ps, { ...all, show: 'given' })).toHaveLength(1);
    expect(filterPasses(ps, { ...all, q: 'sure' })).toHaveLength(1);
  });
});

describe('CSV', () => {
  it('round-trips through export and import', () => {
    let ps = register();
    ps = editPass(ps, ps[0].id, 'name', 'Kaur, Harpreet');
    ps = editPass(ps, ps[101].id, 'incharge', 'Mohan');
    ps = editPass(ps, ps[0].id, 'phone', '+919996577213');
    ps = editPass(ps, ps[0].id, 'dept', 'Langar');
    ps = editPass(ps, ps[0].id, 'zone', 'Non Pandal');
    ps = editPass(ps, ps[1].id, 'zone', 'Pandal');
    ps = setPrinted(ps, new Set([ps[1].id]), true);
    const res = importCSV([], exportCSV(ps));
    if (!res.ok) throw new Error(res.error);
    expect(res.passes).toHaveLength(150);
    expect(res.passes[0]).toMatchObject({ name: 'Kaur, Harpreet', phone: '+919996577213', dept: 'Langar', zone: 'Non Pandal' });
    expect(res.passes[1]).toMatchObject({ zone: 'Pandal', printed: true });
    expect(res.passes[0].printed).toBe(false);
    expect(res.passes.find((p) => p.serial === 'B-002')?.incharge).toBe('Mohan');
  });

  it('imports a semicolon file with an "Incharge Name" column and keeps existing data', () => {
    const res = importCSV(register(), 'Serial No;Name;Incharge Name\nM-040;Harpreet;\nB-060;;Mohan\n');
    if (!res.ok) throw new Error(res.error);
    expect(res.added).toBe(1); // B-060 is new
    expect(res.updated).toBe(1);
    expect(res.passes.find((p) => p.serial === 'M-040')?.name).toBe('Harpreet');
    expect(res.passes.find((p) => p.serial === 'B-060')?.incharge).toBe('Mohan');
  });

  it('needs a Serial column', () => {
    expect(importCSV([], 'Name\nAmit\n').ok).toBe(false);
  });
});

describe('printing', () => {
  it('picks passes in a range; blank ends mean first / last', () => {
    const ps = register();
    expect(passesForPrint(ps, 'Mobile', '', '')).toHaveLength(100);
    expect(passesForPrint(ps, 'Mobile', '91', '')).toHaveLength(10);
    expect(passesForPrint(ps, 'Bike', '', 'B-005').map((p) => p.serial)).toEqual(['B-001', 'B-002', 'B-003', 'B-004', 'B-005']);
  });

  it('ticks and unticks Printed; unchanged when nothing changes', () => {
    const ps = register();
    const ids = new Set([ps[0].id, ps[1].id]);
    const printed = setPrinted(ps, ids, true);
    expect(printed.filter((p) => p.printed).map((p) => p.serial)).toEqual(['M-001', 'M-002']);
    expect(setPrinted(printed, ids, true)).toBe(printed);
    expect(setPrinted(printed, ids, false).some((p) => p.printed)).toBe(false);
  });

  it('encodes the serial as a Code 128 barcode', () => {
    const bits = barcodeBits('M-0001');
    expect(bits.startsWith('11010010000')).toBe(true); // Start Code B
    expect(bits.endsWith('1100011101011')).toBe(true); // Stop pattern
    expect(barcodeBits('M-0002')).not.toBe(bits);
  });
});

describe('collapsing a series given to someone', () => {
  it('groups consecutive passes with the same incharge and details', () => {
    let ps = register();
    const ids = (from: number, to: number) => new Set(ps.filter((p) => p.type === 'Mobile' && p.num >= from && p.num <= to).map((p) => p.id));
    ps = fillPasses(ps, ids(3, 17), { incharge: 'Ramesh' });
    ps = fillPasses(ps, ids(18, 20), { incharge: 'Suresh' });
    ps = editPass(ps, ps[9].id, 'name', 'Amit'); // M-010 has a name, so it breaks Ramesh's series
    const runs = groupRuns(filterPasses(ps, all)).filter((r) => r.length > 1).map((r) => `${r[0].serial}…${r[r.length - 1].serial}`);
    expect(runs).toEqual(['M-003…M-009', 'M-011…M-017', 'M-018…M-020']);
  });

  it('keeps Pandal and Non Pandal passes in separate series', () => {
    let ps = register();
    const ids = (from: number, to: number) => new Set(ps.filter((p) => p.type === 'Mobile' && p.num >= from && p.num <= to).map((p) => p.id));
    ps = fillPasses(ps, ids(1, 3), { incharge: 'Ramesh', zone: 'Pandal' });
    ps = fillPasses(ps, ids(4, 6), { incharge: 'Ramesh', zone: 'Non Pandal' });
    expect(groupRuns(ps).filter((r) => r.length > 1).map((r) => r.length)).toEqual([3, 3]);
    ps = setPrinted(ps, new Set([ps[0].id]), true); // M-001 printed, M-002/003 not yet
    expect(groupRuns(ps).filter((r) => r.length > 1).map((r) => r.length)).toEqual([2, 3]);
  });

  it('never groups passes nobody has been given', () => {
    expect(groupRuns(register()).every((r) => r.length === 1)).toBe(true);
  });

  it('edits every pass of a collapsed series at once; a pasted line fills the whole series', () => {
    let ps = register();
    const series = new Set(ps.slice(0, 5).map((p) => p.id));
    ps = editPasses(ps, series, 'dept', 'Langar');
    expect(ps.slice(0, 6).map((p) => p.dept)).toEqual(['Langar', 'Langar', 'Langar', 'Langar', 'Langar', '']);
    const r = pasteCells(ps, [ps.slice(0, 5), [ps[5]]], 0, 'area', 'Sirsa\nHisar');
    expect(r.passes.slice(0, 6).map((p) => p.area)).toEqual(['Sirsa', 'Sirsa', 'Sirsa', 'Sirsa', 'Sirsa', 'Hisar']);
  });
});

describe('selected range', () => {
  it('turns From / To into a span (To optional, either order)', () => {
    expect(rangeSpan({ type: 'Bike', from: 'B-017', to: '3' })).toEqual({ type: 'Bike', lo: 3, hi: 17 });
    expect(rangeSpan({ type: 'Mobile', from: '5', to: '' })).toEqual({ type: 'Mobile', lo: 5, hi: 5 });
    expect(rangeSpan({ type: 'Mobile', from: '', to: '9' })).toBeNull();
  });
});

describe('report', () => {
  function given(): Pass[] {
    let ps = register();
    const ids = (type: string, from: number, to: number) =>
      new Set(ps.filter((p) => p.type === type && p.num >= from && p.num <= to).map((p) => p.id));
    ps = fillPasses(ps, ids('Mobile', 1, 10), { area: 'SIRSA', dept: 'Langar', incharge: 'Ramesh' });
    ps = fillPasses(ps, ids('Mobile', 11, 12), { area: 'sirsa ', dept: 'Security', incharge: 'Suresh' });
    ps = fillPasses(ps, ids('Bike', 1, 3), { area: 'Sirsa', dept: 'Langar', incharge: 'Mohan' });
    ps = fillPasses(ps, ids('Mobile', 20, 24), { area: 'DELHI', dept: 'Langar', incharge: 'Vikas' });
    return ps;
  }

  it('groups by area then dept, ignoring case, blanks last', () => {
    const r = buildReport(filterPasses(given(), { ...all, show: 'given' }), 'area');
    expect(r.groups.map((g) => [g.label, g.total])).toEqual([['DELHI', 5], ['SIRSA', 15]]);
    const sirsa = r.groups[1];
    expect(sirsa.lines.map((l) => [l.label, l.mobile, l.bike])).toEqual([['Langar', 10, 3], ['Security', 2, 0]]);
    expect(sirsa.lines[0].serials).toBe('M-001–M-010, B-001–B-003');
    expect(sirsa.lines[0].incharges).toBe('Ramesh, Mohan');
    expect(r.total.total).toBe(20);
    expect(buildReport(given(), 'area').groups.at(-1)?.label).toBe('(no area)');
  });

  it('can group by dept first, and exports with totals', () => {
    const r = buildReport(filterPasses(given(), { ...all, show: 'given' }), 'dept');
    expect(r.groups.map((g) => [g.label, g.lines.map((l) => l.label)])).toEqual([
      ['Langar', ['DELHI', 'SIRSA']],
      ['Security', ['SIRSA']], // spelled the way most passes spell it
    ]);
    const csv = reportCSV(r).split('\r\n');
    expect(csv[0]).toBe('﻿Dept,Area,Mobile,Bike,Total,Serial nos.,Incharges');
    expect(csv).toContain('Langar,Total,15,3,18,,');
    expect(csv.at(-1)).toBe('All,Total,17,3,20,,');
  });
});
