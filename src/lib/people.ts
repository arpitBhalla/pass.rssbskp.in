import { fmtSerial, PASS_TYPES, type Pass, type PassType, TYPE_INFO, type Values } from '@/shared/types';
import { isGiven, isPrinted } from './passes';

/*
 * People, worked out from the register itself (nothing more is stored): a person is a phone number, a
 * vehicle is a registration no. The rules say who may hold what. Breaking one only warns (a family may
 * share a phone, the phone on a vehicle pass may be the driver's) and marks the rows.
 */

/**
 * A phone number as a key: its last 10 digits, so "+91 98100-07919" and "098100 07919" match. '' when it
 * has fewer (it can't be matched). Of several numbers in one cell, the first counts.
 */
export function phoneKey(s: string): string {
  const d = s.split(/[,;/&]| or /i)[0].replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}
/** "98100 07919" */
export const showPhone = (key: string) => `${key.slice(0, 5)} ${key.slice(5)}`;
/** A registration no. as a key: letters and digits only, in capitals ("hr 26 cd 1001" is HR-26CD-1001). */
export const regKey = (s: string) => s.replace(/[^0-9a-z]/gi, '').toUpperCase();

export interface Rule {
  /** The sheets it covers: one pass across all of them. */
  types: readonly PassType[];
  by: 'phone' | 'vehicle_no';
  /** What a second one is: "a mobile pass". */
  noun: string;
  text: string;
}
export const RULES: readonly Rule[] = [
  { types: ['mobile-pandal', 'mobile-non-pandal'], by: 'phone', noun: 'a mobile pass', text: 'One mobile pass per person.' },
  { types: ['bike-pandal', 'bike-non-pandal'], by: 'phone', noun: 'a bike pass', text: 'One bike pass per person.' },
  { types: ['bike-pandal', 'bike-non-pandal'], by: 'vehicle_no', noun: 'a bike pass', text: 'One bike pass per bike.' },
  // Each vehicle sheet on its own: the same car may hold, say, a Sewa Vehicle and a BAV Parking pass.
  ...PASS_TYPES.filter((t) => TYPE_INFO[t].layout === 'vehicle').map((t): Rule => (
    { types: [t], by: 'vehicle_no', noun: `a ${TYPE_INFO[t].label} pass`, text: `One ${TYPE_INFO[t].label} pass per vehicle.` }
  )),
];
const keyOf = (rule: Rule, p: Pass) => (rule.by === 'phone' ? phoneKey(p.phone) : regKey(p.vehicle_no));

/** A pass that breaks a rule, and the passes it repeats. */
export interface Duplicate { pass: Pass; rule: Rule; others: Pass[] }

/** For each rule, its passes by key. */
function group(list: readonly Pass[]): Map<string, Pass[]>[] {
  const groups = RULES.map(() => new Map<string, Pass[]>());
  for (const p of list) {
    RULES.forEach((rule, r) => {
      if (!rule.types.includes(p.type)) return;
      const key = keyOf(rule, p);
      if (!key) return;
      const g = groups[r].get(key);
      if (g) g.push(p);
      else groups[r].set(key, [p]);
    });
  }
  return groups;
}

/** Every pass that breaks a rule, by id: the rows are marked. */
export function findDuplicates(all: readonly Pass[]): Map<number, Duplicate[]> {
  const found = new Map<number, Duplicate[]>();
  group(all).forEach((groups, r) => {
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      for (const pass of g) found.set(pass.id, [...(found.get(pass.id) ?? []), { pass, rule: RULES[r], others: g.filter((o) => o !== pass) }]);
    }
  });
  return found;
}

/**
 * What a change would repeat: passes added (no `before`) or changed (`before` → `after`), against the
 * register. A pass that already had that phone or Reg. No. isn't warned about again.
 */
export function duplicatesOf(all: readonly Pass[], changes: readonly { before?: Pass; after: Pass }[]): Duplicate[] {
  if (!changes.length) return [];
  const replaced = new Set(changes.flatMap((c) => (c.before ? [c.before.id] : [])));
  const groups = group([...all.filter((p) => !replaced.has(p.id)), ...changes.map((c) => c.after)]);
  const out: Duplicate[] = [];
  for (const { before, after } of changes) {
    RULES.forEach((rule, r) => {
      if (!rule.types.includes(after.type)) return;
      const key = keyOf(rule, after);
      if (!key || (before && rule.types.includes(before.type) && keyOf(rule, before) === key)) return;
      const others = groups[r].get(key)!.filter((o) => o !== after);
      if (others.length) out.push({ pass: after, rule, others });
    });
  }
  return out;
}

/** "Mobile Non Pandal 0007 (Navneet Gumber, printed)" */
export function passLabel(p: Pass): string {
  const extra = [p.name, isGiven(p) ? 'given' : isPrinted(p) ? 'printed' : ''].filter(Boolean).join(', ');
  return `${TYPE_INFO[p.type].label} ${fmtSerial(p.serial)}${extra ? ` (${extra})` : ''}`;
}
const listOf = (ps: Pass[], max = 3) => ps.slice(0, max).map(passLabel).join('; ') + (ps.length > max ? ` and ${ps.length - max} more` : '');
/** "98100 07919 already has a mobile pass: Mobile Non Pandal 0007 (Navneet Gumber, printed)." */
export const describe = (d: Duplicate) => `${d.pass[d.rule.by]} already has ${d.rule.noun}: ${listOf(d.others)}.`;
/** For a marked cell: "Also Mobile Non Pandal 0007 (Navneet Gumber). One mobile pass per person." '' if none. */
export const alsoHeld = (ds: readonly Duplicate[] | undefined, by: Rule['by']) =>
  (ds ?? []).filter((d) => d.rule.by === by).map((d) => `Also ${listOf(d.others)}. ${d.rule.text}`).join('\n');

/** Everyone's passes, by phone key. */
export function byPhone(all: readonly Pass[]): Map<string, Pass[]> {
  const m = new Map<string, Pass[]>();
  for (const p of all) {
    const key = phoneKey(p.phone);
    if (!key) continue;
    const g = m.get(key);
    if (g) g.push(p);
    else m.set(key, [p]);
  }
  return m;
}

export interface Profile {
  phone: string;
  /** As written on their latest pass; other spellings in `aka`. */
  name: string;
  aka: string[];
  area: string;
  dept: string;
  /** Every pass they hold, sheet by sheet. */
  passes: Pass[];
}
const newestFirst = (a: Pass, b: Pass) => b.created_at.localeCompare(a.created_at) || b.id - a.id;
const latest = (ps: Pass[], k: 'name' | 'area' | 'dept') => ps.find((p) => p[k])?.[k] ?? '';

/** The person with this phone (key), from their passes. */
export function profileOf(passes: readonly Pass[], key: string): Profile | null {
  if (!passes.length) return null;
  const recent = [...passes].sort(newestFirst);
  const name = latest(recent, 'name');
  const aka = [...new Set(recent.map((p) => p.name).filter((n) => n && n.toLowerCase() !== name.toLowerCase()))];
  const order = (p: Pass) => PASS_TYPES.indexOf(p.type);
  return {
    phone: showPhone(key), name, aka, area: latest(recent, 'area'), dept: latest(recent, 'dept'),
    passes: [...passes].sort((a, b) => order(a) - order(b) || a.serial - b.serial),
  };
}

/** For a new pass with this phone: the person's name, dept and area from their latest pass that has a name. */
export function detailsFor(phones: ReadonlyMap<string, Pass[]>, phone: string): { from: Pass; values: Values } | null {
  const from = [...(phones.get(phoneKey(phone)) ?? [])].sort(newestFirst).find((p) => p.name);
  if (!from) return null;
  const values: Values = {};
  for (const k of ['name', 'dept', 'area'] as const) if (from[k]) values[k] = from[k];
  return { from, values };
}

/** A person in the People list: their profile, with how many of their passes break a rule. */
export interface Person extends Profile { key: string; broken: number }

/** Everyone with a phone, by name (no name last). */
export function listPeople(phones: ReadonlyMap<string, Pass[]>, dupes: ReadonlyMap<number, unknown>): Person[] {
  const out: Person[] = [];
  for (const [key, passes] of phones) {
    const profile = profileOf(passes, key);
    if (profile) out.push({ ...profile, key, broken: passes.filter((p) => dupes.has(p.id)).length });
  }
  return out.sort((a, b) => (!a.name ? 1 : 0) - (!b.name ? 1 : 0) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key));
}

/** Search: a number (3+ digits) finds a phone; otherwise any spelling of the name, or a Reg. No. (`hr26cd` finds HR-26CD-1001). */
export function matchesPerson(p: Person, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  if (/^[\d\s+()-]+$/.test(q)) return digits.length >= 3 && p.key.includes(digits.length > 10 ? digits.slice(-10) : digits);
  if ([p.name, ...p.aka].some((n) => n.toLowerCase().includes(q))) return true;
  const plate = regKey(q);
  return /[a-z]/.test(q) && /\d/.test(q) && p.passes.some((x) => regKey(x.vehicle_no).includes(plate));
}
