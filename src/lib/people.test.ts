import { describe as group, expect, it } from 'vitest';
import type { Pass, PassType } from '@/shared/types';
import { blankPass } from './passes';
import { alsoHeld, byPhone, describe, detailsFor, duplicatesOf, findDuplicates, listPeople, matchesPerson, namePicks, phoneKey, profileOf, regKey } from './people';

let nextId = 1;
const pass = (type: PassType, serial: number, extra: Partial<Pass> = {}): Pass =>
  ({ ...blankPass(type, serial), id: nextId++, created_at: '2026-11-14T10:00:00Z', ...extra });

group('name suggestions', () => {
  it('lists everyone with a phone and a name once, with what picking them fills in', () => {
    const picks = namePicks(byPhone([
      pass('mobile-pandal', 1, { name: 'RAMESH KUMAR', phone: '98765-43210', dept: 'SEWA', area: 'SIRSA', created_at: '2026-11-10T10:00:00Z' }),
      pass('bike-pandal', 2, { name: 'RAMESH KUMAR', phone: '98765-43210', area: 'HISAR', created_at: '2026-11-12T10:00:00Z' }),
      pass('mobile-pandal', 3, { name: 'RAMESH KUMAR', phone: '99999-11111' }), // another Ramesh: told apart by phone
      pass('mobile-pandal', 4, { phone: '98111-22222' }), // no name: nothing to suggest
      pass('mobile-pandal', 5, { name: 'NO PHONE' }),
    ]));
    expect([...picks.keys()]).toEqual(['RAMESH KUMAR — 98765-43210 · SEWA · HISAR', 'RAMESH KUMAR — 99999-11111']);
    expect(picks.get('RAMESH KUMAR — 98765-43210 · SEWA · HISAR')).toEqual({ name: 'RAMESH KUMAR', phone: '98765-43210', dept: 'SEWA', area: 'HISAR' });
  });
});

group('who is the same person', () => {
  it('matches a phone however it is written: its last 10 digits', () => {
    expect(phoneKey('+91 98100-07919')).toBe('9810007919');
    expect(phoneKey('098100 07919')).toBe('9810007919');
    expect(phoneKey('9810007919 / 9876543210')).toBe('9810007919'); // the first of two
    expect(phoneKey('12345')).toBe(''); // too short to tell
    expect(regKey('hr 26 cd-1001')).toBe(regKey('HR-26CD-1001'));
  });
});

group('the rules', () => {
  const all = [
    pass('mobile-pandal', 12, { name: 'Navneet Gumber', phone: '98100 07919', printed_at: '2026-11-14T11:00:00Z' }),
    pass('bike-pandal', 3, { name: 'Raj Kumar', phone: '9876543210', vehicle_no: 'HR-26CD-1001' }),
    pass('sewa-vehicle', 4, { name: 'Pardeep', vehicle_no: 'HR-26CD-1001' }),
  ];
  const add = (type: PassType, extra: Partial<Pass>) => duplicatesOf(all, [{ after: { ...blankPass(type, 99), ...extra } }]);

  it('one mobile pass per person, across Pandal and Non Pandal', () => {
    const [d] = add('mobile-non-pandal', { name: 'Navneet', phone: '+91 9810007919' });
    expect(describe(d)).toBe('+91 9810007919 already has a mobile pass: Mobile Pandal 0012 (Navneet Gumber, printed).');
    expect(d.rule.text).toBe('One mobile pass per person.');
  });
  it('a person may hold a mobile pass and a bike pass', () => {
    expect(add('bike-non-pandal', { phone: '9810007919', vehicle_no: 'PB-11X-2' })).toEqual([]);
  });
  it('one bike pass per person and per bike', () => {
    expect(add('bike-non-pandal', { phone: '9876543210' }).map((d) => d.rule.text)).toEqual(['One bike pass per person.']);
    expect(add('bike-non-pandal', { vehicle_no: 'hr26cd1001' }).map((d) => d.rule.text)).toEqual(['One bike pass per bike.']);
  });
  it('one pass per vehicle in each vehicle sheet, but the same car may be on two sheets', () => {
    expect(add('sewa-vehicle', { vehicle_no: 'HR26CD1001' }).map((d) => d.rule.text)).toEqual(['One Sewa Vehicle pass per vehicle.']);
    expect(add('bav-entry', { vehicle_no: 'HR26CD1001' })).toEqual([]);
    expect(add('sewa-vehicle', { phone: '9810007919' })).toEqual([]); // phones only count on mobile and bike passes
  });
  it("doesn't warn again about a pass that already had that phone", () => {
    const before = all[0];
    expect(duplicatesOf([...all, pass('mobile-non-pandal', 1, { phone: '9810007919' })], [{ before, after: { ...before, phone: '981-000-7919' } }])).toEqual([]);
  });
  it('two new rows with the same phone repeat each other', () => {
    const a = { ...blankPass('mobile-pandal', 50), phone: '9000000001' };
    const b = { ...blankPass('mobile-pandal', 51), phone: '9000000001' };
    expect(duplicatesOf(all, [{ after: a }, { after: b }]).map((d) => d.pass.serial)).toEqual([50, 51]);
  });
  it('marks every pass breaking a rule, in each sheet', () => {
    const second = pass('mobile-non-pandal', 7, { name: 'Navneet', phone: '9810007919' });
    const found = findDuplicates([...all, second]);
    expect([...found.keys()]).toEqual([all[0].id, second.id]);
    expect(alsoHeld(found.get(second.id), 'phone')).toBe('Also Mobile Pandal 0012 (Navneet Gumber, printed). One mobile pass per person.');
    expect(alsoHeld(found.get(second.id), 'vehicle_no')).toBe('');
  });
});

group('a profile', () => {
  const mine = [
    pass('bike-pandal', 3, { name: 'Navneet Gumber', phone: '9810007919', area: 'Sirsa', created_at: '2026-11-13T10:00:00Z' }),
    pass('mobile-pandal', 12, { name: 'navneet gumber', phone: '+91 98100 07919', dept: 'Traffic', created_at: '2026-11-14T10:00:00Z' }),
    pass('mobile-non-pandal', 2, { name: 'N. Gumber', phone: '98100-07919', created_at: '2026-11-12T10:00:00Z' }),
  ];
  const phones = byPhone([...mine, pass('mobile-pandal', 1, { phone: '9000000001' })]);

  it('gathers every pass with that phone, sheet by sheet, named as on the latest', () => {
    const p = profileOf(phones.get('9810007919')!, '9810007919')!;
    expect(p.passes.map((x) => `${x.type} ${x.serial}`)).toEqual(['mobile-pandal 12', 'mobile-non-pandal 2', 'bike-pandal 3']);
    expect(p).toMatchObject({ phone: '98100 07919', name: 'navneet gumber', aka: ['N. Gumber'], area: 'Sirsa', dept: 'Traffic' });
  });
  it('fills a new pass from the latest one', () => {
    expect(detailsFor(phones, '09810007919')).toMatchObject({ from: { serial: 12 }, values: { name: 'navneet gumber', dept: 'Traffic' } });
    expect(detailsFor(phones, '9111111111')).toBeNull();
  });
});

group('the People list', () => {
  const navneet = [
    pass('mobile-pandal', 12, { name: 'Navneet Gumber', phone: '9810007919' }),
    pass('mobile-non-pandal', 2, { name: 'N. Gumber', phone: '+91 98100 07919' }),
    pass('bike-pandal', 3, { name: 'Navneet Gumber', phone: '9810007919', vehicle_no: 'HR-26CD-1001' }),
  ];
  const all = [...navneet, pass('mobile-pandal', 1, { name: 'Amrit Kaur', phone: '9000000001' }), pass('mobile-pandal', 2, { phone: '9000000002' }), pass('mobile-pandal', 3, { name: 'No Phone' })];
  const people = listPeople(byPhone(all), findDuplicates(all));

  it('lists everyone with a phone, once, by name, with the rules they break', () => {
    expect(people.map((p) => [p.name, p.passes.length, p.broken])).toEqual([['Amrit Kaur', 1, 0], ['Navneet Gumber', 3, 2], ['', 1, 0]]);
  });
  it('finds a person by any spelling of the name, part of the phone, or a Reg. No.', () => {
    const find = (q: string) => people.filter((p) => matchesPerson(p, q)).map((p) => p.name || p.phone);
    expect(find('gumber')).toEqual(['Navneet Gumber']);
    expect(find('n. gum')).toEqual(['Navneet Gumber']);
    expect(find('07919')).toEqual(['Navneet Gumber']);
    expect(find('+91 98100 07919')).toEqual(['Navneet Gumber']);
    expect(find('hr26cd')).toEqual(['Navneet Gumber']);
    expect(find('90000')).toEqual(['Amrit Kaur', '90000 00002']);
    expect(find('')).toHaveLength(3);
  });
});
