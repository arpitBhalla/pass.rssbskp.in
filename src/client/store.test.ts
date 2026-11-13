import { describe, expect, it } from 'vitest';
import { blankPass } from '@/lib/passes';
import type { Pass } from '@/shared/types';
import { PassStore } from './store';

const pass = (id: number, serial: number, rev: number, extra: Partial<Pass> = {}): Pass =>
  ({ ...blankPass('mobile-pandal', serial), id, rev, created_at: '2026-11-13T00:00:00Z', created_by: 1, updated_by: 1, ...extra });
const names = (s: PassStore) => s.getSheet('mobile-pandal').map((p) => `${p.serial}:${p.name}${p.printed_at ? ':printed' : ''}`);

describe('unsaved changes on screen', () => {
  it('shows a change at once, keeps it over a sync, and gives way to the saved copy', () => {
    const s = new PassStore();
    s.merge([pass(1, 1, 5, { name: 'A' }), pass(2, 2, 5, { name: 'B' })]);
    const h = s.show([pass(1, 1, 5, { name: 'A', printed_at: '2026-11-13T10:00:00Z' })]);
    expect(names(s)).toEqual(['1:A:printed', '2:B']);
    s.merge([pass(1, 1, 5, { name: 'A' }), pass(2, 2, 6, { name: 'B2' })]); // a sync that started before the save
    expect(names(s)).toEqual(['1:A:printed', '2:B2']);
    s.merge([pass(1, 1, 7, { name: 'A', printed_at: '2026-11-13T10:00:01Z' })]); // the server's answer
    s.settle(h);
    expect(names(s)).toEqual(['1:A:printed', '2:B2']);
    expect(s.get(1)?.rev).toBe(7);
  });

  it('puts things back when the server refuses', () => {
    const s = new PassStore();
    s.merge([pass(1, 1, 5, { name: 'A' })]);
    const h = s.show([pass(1, 1, 5, { name: 'X' })]);
    expect(names(s)).toEqual(['1:X']);
    s.settle(h);
    expect(names(s)).toEqual(['1:A']);
  });

  it('hides deleted passes, and counts what is shown', () => {
    const s = new PassStore();
    s.merge([pass(1, 1, 5), pass(2, 2, 5), pass(3, 3, 5)]);
    const h = s.show([], [1, 2]);
    expect(names(s)).toEqual(['3:']);
    expect(s.getCounts()['mobile-pandal']).toBe(1);
    expect(s.get(1)).toBeUndefined();
    s.settle(h);
    expect(s.getCounts()['mobile-pandal']).toBe(3);
  });

  it('a pass added a moment ago keeps later changes when it gets its real id', () => {
    const s = new PassStore();
    const add = s.show([pass(-1_000_000, 4, 0, { name: 'New' })]);
    const edit = s.show([pass(-1_000_000, 4, 0, { name: 'New', phone: '98' })]); // edited before the add was saved
    expect(s.getSheet('mobile-pandal').map((p) => p.phone)).toEqual(['98']);
    s.merge([pass(40, 4, 9, { name: 'New' })]);
    s.settle(add);
    s.rename(-1_000_000, 40);
    const shown = s.getSheet('mobile-pandal');
    expect(shown.map((p) => [p.id, p.phone])).toEqual([[40, '98']]); // one row, not two
    s.merge([pass(40, 4, 10, { name: 'New', phone: '98' })]);
    s.settle(edit);
    expect(s.getSheet('mobile-pandal').map((p) => [p.id, p.rev])).toEqual([[40, 10]]);
  });
});
