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

const GATE3: readonly PassType[] = ['gate3-entry', 'vip-gate', 'gate3-hospital'];

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
  // The Gate 3 sheets together (the owner, 2026-11-24): one Gate 3 pass per vehicle, Entry, VIP or Hospital.
  { types: GATE3, by: 'vehicle_no', noun: 'a Gate 3 pass', text: 'One Gate 3 pass per vehicle (Entry, VIP or Hospital).' },
  // Each other vehicle sheet on its own: the same car may hold, say, a Sewa Vehicle and a BAV Parking pass.
  ...PASS_TYPES.filter((t) => TYPE_INFO[t].layout !== 'bike' && TYPE_INFO[t].fields.includes('vehicle_no') && !GATE3.includes(t)).map((t): Rule => (
    { types: [t], by: 'vehicle_no', noun: `a ${TYPE_INFO[t].label} pass`, text: `One ${TYPE_INFO[t].label} pass per vehicle.` }
  )),
];
const keyOf = (rule: Rule, p: Pass) => (rule.by === 'phone' ? phoneKey(p.phone) : regKey(p.vehicle_no));

/**
 * Every pass with `p`'s phone (or Reg. No.) on the sheets its rules cover, `p` among them: what a red cell repeats, Pandal and
 * Non Pandal together, the Gate 3 sheets together (the owner, 2026-11-24). Lost passes aren't held any more: left out.
 */
export function sameAs(all: readonly Pass[], p: Pass, by: Rule['by']): { rules: Rule[]; passes: Pass[] } {
  const rules = RULES.filter((r) => r.by === by && r.types.includes(p.type));
  const types = new Set(rules.flatMap((r) => r.types));
  const keyBy = (x: Pass) => (by === 'phone' ? phoneKey(x.phone) : regKey(x.vehicle_no));
  const key = keyBy(p);
  const order = (x: Pass) => PASS_TYPES.indexOf(x.type);
  const passes = !key || !rules.length ? [] : all
    .filter((x) => x.lost_at === null && types.has(x.type) && keyBy(x) === key)
    .sort((a, b) => order(a) - order(b) || a.serial - b.serial);
  return { rules, passes };
}

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
  // A lost pass isn't held any more: its duplicate doesn't repeat it.
  group(all.filter((p) => p.lost_at === null)).forEach((groups, r) => {
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
  const groups = group([...all.filter((p) => !replaced.has(p.id) && p.lost_at === null), ...changes.map((c) => c.after)]);
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
    if (!key || p.lost_at !== null) continue; // a lost pass isn't held any more
    const g = m.get(key);
    if (g) g.push(p);
    else m.set(key, [p]);
  }
  return m;
}

/**
 * Passes with a name or Reg. No. but no full phone number, each on its own (keyed "#" and its id), so a search still finds them
 * (the owner, 2026-11-24): with no phone they can't be matched to anyone's other passes.
 */
export function withoutPhone(all: readonly Pass[]): Map<string, Pass[]> {
  const m = new Map<string, Pass[]>();
  for (const p of all) if (!phoneKey(p.phone) && p.lost_at === null && (p.name.trim() || p.vehicle_no.trim())) m.set(`#${p.id}`, [p]);
  return m;
}
/** A key from withoutPhone: one pass with no full phone number. */
export const isPhoneless = (key: string) => key.startsWith('#');
/** The phone to show for a person (key) or a pass with no full phone: "No phone", or the part written and "(not full)". */
export const phoneLabel = (key: string, phone: string) => (!isPhoneless(key) ? phone : phone ? `${phone} (not full)` : 'No phone');

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
    phone: isPhoneless(key) ? passes[0].phone.trim() : showPhone(key), name, aka, area: latest(recent, 'area'), dept: latest(recent, 'dept'),
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

/**
 * The Name box's suggestions: everyone with a phone and a name, as "RAMESH KUMAR — 98765-43210 · SEWA · SIRSA"
 * (the phone tells two of the same name apart), by name. Each with what picking them fills in: the name,
 * phone, dept and area from their latest passes. A person with a mobile pass gets their bike pass this way.
 */
export function namePicks(phones: ReadonlyMap<string, Pass[]>): Map<string, Values> {
  const list: [string, Values][] = [];
  for (const passes of phones.values()) {
    const recent = [...passes].sort(newestFirst);
    const name = latest(recent, 'name');
    if (!name) continue;
    const values: Values = { name, phone: recent[0].phone, dept: latest(recent, 'dept'), area: latest(recent, 'area') };
    list.push([`${name} — ${[values.phone, values.dept, values.area].filter(Boolean).join(' · ')}`, values]);
  }
  return new Map(list.sort(([a], [b]) => a.localeCompare(b)));
}

/** A person in the People list: their profile, with how many of their passes break a rule. */
export interface Person extends Profile { key: string; broken: number }

/** Everyone with a phone (and passes from withoutPhone, if given), by name (no name last). */
export function listPeople(phones: ReadonlyMap<string, Pass[]>, dupes: ReadonlyMap<number, unknown>): Person[] {
  const out: Person[] = [];
  for (const [key, passes] of phones) {
    const profile = profileOf(passes, key);
    if (profile) out.push({ ...profile, key, broken: passes.filter((p) => dupes.has(p.id)).length });
  }
  return out.sort((a, b) => (!a.name ? 1 : 0) - (!b.name ? 1 : 0) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key));
}

/** The People page's other filters (the owner, 2026-11-24: "filter by in charge or area", "also add department dropdown", and packet). */
export type PeopleBy = 'incharge' | 'area' | 'dept' | 'packet';
const valueOf = (v: string) => v.trim().replace(/\s+/g, ' ');

/**
 * The incharges (areas, depts) on everyone's passes, to pick from: "Sirsa" and "SIRSA " are one, written as spelled most often,
 * A–Z, each with how many people have a pass with it. `key`: what hasValue takes.
 */
export function filterChoices(people: readonly Person[], k: PeopleBy): { key: string; label: string; people: number }[] {
  const spellings = new Map<string, Map<string, number>>();
  const count = new Map<string, number>();
  for (const p of people) {
    const keys = new Set<string>();
    for (const x of p.passes) {
      const v = valueOf(x[k]);
      if (!v) continue;
      const key = v.toLowerCase();
      keys.add(key);
      const s = spellings.get(key) ?? new Map<string, number>();
      spellings.set(key, s.set(v, (s.get(v) ?? 0) + 1));
    }
    for (const key of keys) count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...count]
    .map(([key, n]) => ({ key, label: [...spellings.get(key)!].sort((a, b) => b[1] - a[1])[0][0], people: n }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
}

/** Someone with a pass whose Incharge (Area, Dept) is this one (a filterChoices key); '' is anyone. */
export const hasValue = (p: Person, k: PeopleBy, key: string) => !key || p.passes.some((x) => valueOf(x[k]).toLowerCase() === key);

/** What a search looks in (the owner, 2026-11-24): everything, or only the name, phone, Area (centre), Dept, Incharge or Reg. No. */
export type SearchIn = 'all' | 'person' | 'phone' | 'area' | 'dept' | 'incharge' | 'vehicle';
/** The search tabs: what each looks in, its name, and the hint in the search box. */
export const SEARCH_IN: readonly (readonly [SearchIn, string, string])[] = [
  ['all', 'All', 'Name, phone, Reg. No., Centre, Dept or Incharge'],
  ['person', 'Name', 'Any spelling of the name'],
  ['phone', 'Phone', 'Any part of the phone number'],
  ['area', 'Centre', 'Centre (Area)'],
  ['dept', 'Dept', 'Dept'],
  ['incharge', 'Incharge', 'Incharge'],
  ['vehicle', 'Vehicle No.', 'Any part of a Reg. No.: 4417, 26DK, HR26'],
];

/**
 * Search: a number (3+ digits) finds a phone; otherwise any spelling of the name, the Incharge, Area (centre) or Dept on any of
 * their passes, or a Reg. No. (`hr26cd` finds HR-26CD-1001). A tab other than All looks only there; Vehicle No. finds any part
 * of a Reg. No., numbers too (`4417` finds HR-26DK-4417).
 */
export function matchesPerson(p: Person, query: string, look: SearchIn = 'all'): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const isNumber = /^[\d\s+()-]+$/.test(q);
  const phone = () => {
    const digits = q.replace(/\D/g, '');
    const own = isPhoneless(p.key) ? p.phone.replace(/\D/g, '') : p.key; // a pass with part of a phone: those digits
    return digits.length >= 3 && own.includes(digits.length > 10 ? digits.slice(-10) : digits);
  };
  const name = () => [p.name, ...p.aka].some((n) => n.toLowerCase().includes(q));
  // The Incharge or Area on any of their passes, however it is spaced.
  const words = q.replace(/\s+/g, ' ');
  const has = (k: 'incharge' | 'area' | 'dept') => p.passes.some((x) => valueOf(x[k]).toLowerCase().includes(words));
  const plate = () => {
    const key = regKey(q);
    return key !== '' && p.passes.some((x) => regKey(x.vehicle_no).includes(key));
  };
  switch (look) {
    case 'person': return name();
    case 'phone': return phone();
    case 'area': return has('area');
    case 'dept': return has('dept');
    case 'incharge': return has('incharge');
    case 'vehicle': return plate();
    default: return isNumber ? phone() : name() || has('incharge') || has('area') || has('dept') || (/[a-z]/.test(q) && /\d/.test(q) && plate());
  }
}
