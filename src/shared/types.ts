// Shared by the server and the browser. Plain TypeScript, no imports.

/**
 * The pass sheets. Each has its own serial numbers, starting at 0001. Add new ones at the end and never
 * reorder: a pass's QR code holds its sheet's position in this list.
 */
export const PASS_TYPES = [
  'mobile-pandal',
  'mobile-non-pandal',
  'bike-pandal',
  'bike-non-pandal',
  'sewa-vehicle',
  'tractor-trolley',
  'gate3-entry',
  'bav-entry',
  'vip-gate',
  'admin',
  'e-rickshaw',
  'eco',
  'metro',
] as const;
export type PassType = (typeof PASS_TYPES)[number];

/** Text columns. A sheet shows its own subset, in its own order (see `fields` below). */
export const FIELDS = ['name', 'dept', 'area', 'phone', 'vehicle', 'vehicle_no', 'incharge', 'issued_to'] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABELS: Record<Field, string> = {
  name: 'Name', dept: 'Dept', area: 'Area', phone: 'Phone', vehicle: 'Vehicle', vehicle_no: 'Reg. No.', incharge: 'Incharge',
  issued_to: 'Issued To',
};

/**
 * Filled in when a pass is handed over, which is after it's printed: these stay editable on printed
 * passes (everything else on a printed pass is locked), and the sheet shows them after Given.
 */
export const HANDOVER_FIELDS: readonly Field[] = ['issued_to'];
/** False for the handover columns: a printed pass can still record who it was issued to. */
export const locksWhenPrinted = (k: Field) => !HANDOVER_FIELDS.includes(k);

/**
 * Which printed template a sheet uses (the RSSB SKP pass templates), and so its size (CARD_SIZE).
 * 'gate': Gate 3 Entry, Gate 1 & 12 (BAV), Gate 3 - VIP and Admin, vehicle passes printed smaller since
 * 2026-11-15, 6 to an A3 (the owner's choice); Sewa Vehicle and Tractor Trolley stay 'vehicle'.
 * 'large': Tractor Trolley and the Free Helpline Sewa passes (E-Rickshaw, Eco, Metro): 232 × 158, 4 to an A3+,
 * 2 to an A3 (the owner, 2026-11-17).
 */
export type Layout = 'mobile' | 'bike' | 'vehicle' | 'gate' | 'large';

export interface PassTypeInfo {
  /** Tab / sheet name. */
  label: string;
  /** Two letters, used where several sheets are listed together (report). */
  short: string;
  layout: Layout;
  /** A Free Helpline Sewa pass (E-Rickshaw, Eco, Metro): prints only its serial; its own group of tabs. */
  helpline?: boolean;
  /** Big title line(s) on the printed pass. */
  title: string;
  /** Columns, in sheet order (a multi-column paste from Excel fills them left to right). */
  fields: readonly Field[];
  /** Columns named differently on this sheet (see fieldLabel). */
  labels?: Partial<Record<Field, string>>;
  /** Template colours: top / bottom band, the thin stripe beside it, card background and logo box; `title`: 150 × 100 mm passes' title. */
  color: { name: string; band: string; stripe: string; bg: string; logo: string; title?: string };
}

// The handover columns (Issued To) come last.
const MOBILE_FIELDS: readonly Field[] = ['name', 'dept', 'area', 'phone', 'incharge', 'issued_to'];
const BIKE_FIELDS: readonly Field[] = ['name', 'dept', 'area', 'vehicle_no', 'phone', 'incharge', 'issued_to'];
const VEHICLE_FIELDS: readonly Field[] = ['name', 'vehicle', 'vehicle_no', 'area', 'dept', 'phone', 'incharge', 'issued_to'];
/** Free Helpline Sewa passes print only their serial: the sheet records who each pass went to (the owner, 2026-11-15). */
const HELPLINE_FIELDS: readonly Field[] = ['incharge', 'issued_to'];
/** Gate 3, Gate 3 - VIP and Admin passes are given on someone's word: the Incharge column is who referred them. */
const REFERRED = { incharge: 'Referred by' };

// Colours sampled from the templates (Downloads/passes-template). Pandal is blue, Non Pandal grey,
// vehicle passes green; Mobile (portrait) and Bike (landscape, tinted card) differ by shape.
// Gate 3 Entry (orange) and BAV Parking (purple) have no template: the Sewa Vehicle pass in their colour,
// title included, so the gate tells them apart at a glance. Gate 3 - VIP (red) and Admin (teal) print in
// the design v2 Ticket and Rail passes (components/cards), in their colour. Gate 3 - VIP prints as
// "GATE 3 ENTRY" (the user's wish, 15 Nov: no VIP on the pass); the app still calls the sheet Gate 3 - VIP.
const BLUE = { name: 'Blue', band: '#2e3192', logo: '#231f20' };
const GREY = { name: 'Grey', band: '#808285', logo: '#9e0b0f' };
const GREEN = { name: 'Green', band: '#007236', stripe: '#bcbec0', bg: '#ffffff', logo: '#939598' };
const ORANGE = { ...GREEN, name: 'Orange', band: '#d35400', title: '#d35400' };
const PURPLE = { ...GREEN, name: 'Purple', band: '#5b2c83', title: '#5b2c83' };
const RED = { ...GREEN, name: 'Red', band: '#b3122e', title: '#b3122e' };
const TEAL = { ...GREEN, name: 'Teal', band: '#00727a', title: '#00727a' };
// The Free Helpline Sewa passes (design round 24): E-Rickshaw in Gate 3 - VIP's red, Eco in brown (leaf
// green until 2026-11-16, too like Sewa Vehicle's green; the owner), Metro in navy (no other pass's colour).
const BROWN = { ...GREEN, name: 'Brown', band: '#7a4a1f', title: '#7a4a1f' };
const NAVY = { ...GREEN, name: 'Navy', band: '#1d4e89', title: '#1d4e89' };

export const TYPE_INFO: Record<PassType, PassTypeInfo> = {
  'mobile-pandal': {
    label: 'Mobile Pandal', short: 'MP', layout: 'mobile', title: 'PANDAL', fields: MOBILE_FIELDS,
    color: { ...BLUE, stripe: '#bcbec0', bg: '#ffffff' },
  },
  'mobile-non-pandal': {
    label: 'Mobile Non Pandal', short: 'MN', layout: 'mobile', title: 'NON PANDAL', fields: MOBILE_FIELDS,
    color: { ...GREY, stripe: '#e6e7e8', bg: '#ffffff' },
  },
  'bike-pandal': {
    label: 'Bike Pandal', short: 'BP', layout: 'bike', title: 'PANDAL', fields: BIKE_FIELDS,
    color: { ...BLUE, stripe: '#a7a9ac', bg: '#d4eefb' },
  },
  'bike-non-pandal': {
    label: 'Bike Non Pandal', short: 'BN', layout: 'bike', title: 'NON PANDAL', fields: BIKE_FIELDS,
    color: { ...GREY, stripe: '#a7a9ac', bg: '#e6e7e8' },
  },
  'sewa-vehicle': { label: 'Sewa Vehicle', short: 'SV', layout: 'vehicle', title: 'SEWA VEHICLE PASS', fields: VEHICLE_FIELDS, color: GREEN },
  'tractor-trolley': { label: 'Tractor Trolley', short: 'TT', layout: 'large', title: 'TRACTOR TROLLEY PASS', fields: VEHICLE_FIELDS, color: GREEN },
  'gate3-entry': { label: 'Gate 3 Entry', short: 'G3', layout: 'gate', title: 'GATE 3 ENTRY PASS', fields: VEHICLE_FIELDS, labels: REFERRED, color: ORANGE },
  'bav-entry': { label: 'BAV Parking', short: 'BA', layout: 'gate', title: 'BAV PARKING PASS', fields: VEHICLE_FIELDS, color: PURPLE },
  'vip-gate': { label: 'Gate 3 - VIP', short: 'VG', layout: 'gate', title: 'GATE 3 ENTRY PASS', fields: VEHICLE_FIELDS, labels: REFERRED, color: RED },
  admin: { label: 'Admin', short: 'AD', layout: 'gate', title: 'ADMIN PASS', fields: VEHICLE_FIELDS, labels: REFERRED, color: TEAL },
  'e-rickshaw': { label: 'E-Rickshaw', short: 'ER', layout: 'large', helpline: true, title: 'E-RICKSHAW', fields: HELPLINE_FIELDS, color: RED },
  // The Eco pass prints FREE HELPLINE SEWA on its band (the owner, 2026-11-16); its tab says Helpline (2026-11-19).
  eco: { label: 'Helpline', short: 'EC', layout: 'large', helpline: true, title: 'FREE HELPLINE SEWA', fields: HELPLINE_FIELDS, color: BROWN },
  metro: { label: 'Metro', short: 'ME', layout: 'large', helpline: true, title: 'METRO', fields: HELPLINE_FIELDS, color: NAVY },
};

/** A column's name on this sheet: Incharge is "Referred by" on Gate 3, Gate 3 - VIP and Admin. */
export const fieldLabel = (type: PassType, k: Field) => TYPE_INFO[type].labels?.[k] ?? FIELD_LABELS[k];

export const isPassType = (v: unknown): v is PassType => PASS_TYPES.includes(v as PassType);

/** The columns a sheet has, in its order. */
export const fieldsFor = (t: PassType): readonly Field[] => TYPE_INFO[t].fields;

export const MAX_TEXT = 120;
export const MAX_SERIAL = 99999;
/** Most passes one action may touch (a give, paste, print or import). */
export const MAX_BATCH = 5000;

/** Printed as 4 digits: 7 → "0007". */
export const fmtSerial = (n: number) => String(n).padStart(4, '0');

/** Trims, flattens tabs / line breaks to spaces and caps the length. */
export const cleanText = (v: string) => v.replace(/[\t\r\n]+/g, ' ').trim().slice(0, MAX_TEXT);

/**
 * A number plate written one way: "hr 24 ab 9168", "HR24AB9168" and "HR-24-AB-9168" all become
 * "HR-24AB-9168" (state, district and series, number). Anything else ("E-SCOOTY") stays as typed.
 */
export function formatRegNo(v: string): string {
  const s = v.toUpperCase().replace(/[\s.\-/]+/g, '');
  const m = s.length >= 6 && s.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/); // not a half-typed "HR26"
  return m ? `${m[1]}-${m[2]}${m[3]}-${m[4]}` : v;
}

/**
 * A mobile number written one way: "9876543210", "98765 43210", "+91 98765-43210" and "098765 43210" all
 * become "98765-43210" (the owner, 2026-11-17). Several numbers ("…, …", "… / …"): each one. Anything
 * else (a half-typed or landline number) stays as typed.
 */
export function formatPhone(v: string): string {
  return v.split(/([,;/&]| or )/i).map((part, i) => {
    if (i % 2) return part; // a separator
    const m = part.replace(/[\s\-.()]/g, '').match(/^(?:\+?91|0)?([6-9]\d{9})$/);
    return m ? part.replace(/\S.*\S|\S/, `${m[1].slice(0, 5)}-${m[1].slice(5)}`) : part;
  }).join('');
}

/**
 * A value as it's saved in this column: cleaned, in capitals (the owner, 2026-11-17), number plates and
 * mobile numbers written one way.
 */
export function cleanField(k: Field, v: string): string {
  const s = cleanText(v).toUpperCase();
  return (k === 'vehicle_no' ? formatRegNo(s) : k === 'phone' ? formatPhone(s) : s).slice(0, MAX_TEXT);
}

/** A pass as the browser sees it. */
export interface Pass {
  id: number;
  type: PassType;
  serial: number;
  name: string;
  dept: string;
  area: string;
  phone: string;
  /** Vehicle make / model (Sewa Vehicle, Tractor Trolley). */
  vehicle: string;
  /** Registration no. (Bike, Sewa Vehicle, Tractor Trolley). */
  vehicle_no: string;
  incharge: string;
  /** Who collected the pass at the desk (filled in at handover; not printed on the pass). */
  issued_to: string;
  /** ISO time, or null if not printed yet. */
  printed_at: string | null;
  /** ISO time Given was ticked (handed over), or null. */
  given_at: string | null;
  /** ISO time the pass entered the register (when its range was given, or it was added). */
  created_at: string;
  /** User id of the last change. */
  /** User who added the pass to the register. */
  created_by: number;
  updated_by: number;
  /** Database version of the last change to this pass (for live updates). */
  rev: number;
}

export interface User {
  id: number;
  username: string;
  name: string;
  is_admin: boolean;
  active: boolean;
}

/* ---------------- API ---------------- */

export type Values = Partial<Record<Field, string>>;

/** Change an existing pass. `expect` holds what the user saw; if the pass changed since, nothing is saved. */
export interface SetOp {
  id: number;
  values?: Values;
  printed?: boolean;
  given?: boolean;
  /** Filling in a completely empty pass (Give with no range): Added by becomes whoever saves it. Refused unless it is still empty. */
  claim?: boolean;
  expect: Values & { printed?: boolean; given?: boolean };
}

/** Create a pass. Fails if that serial already exists in the sheet (unless the request is `next`). */
export interface CreateOp {
  type: PassType;
  serial: number;
  values: Values;
  printed?: boolean;
  given?: boolean;
}

export const ACTIONS = ['give', 'given', 'edit', 'paste', 'print', 'import'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * A request sent again (its answer was lost on the way) carries the same `requestId`: the server
 * answers with what the first one did instead of doing it twice. Any string unique to the request.
 */
export interface Resendable {
  requestId?: string;
}

/** One user action. All of it is saved, or none of it. */
export interface ApplyRequest extends Resendable {
  action: Action;
  summary: string;
  set?: SetOp[];
  create?: CreateOp[];
  /**
   * The passes to create were typed or pasted as the next ones: if another desk has just taken any of
   * those serials, they are saved after the sheet's last pass instead (in the same order).
   */
  next?: boolean;
}

export interface ApplyResult {
  changeId: number;
  rows: Pass[];
  /** The ids of the passes created, in the order of `create`. */
  created: number[];
}

export interface UndoResult {
  rows: Pass[];
  deleted: number[];
  summary: string;
}

/** Delete these passes. `rev`: the version the user saw; if a pass changed since, nothing is deleted. */
export interface DeleteRequest extends Resendable {
  summary: string;
  items: { id: number; rev: number }[];
}

export interface DeleteResult {
  changeId: number;
  deleted: { id: number; rev: number }[];
}

export interface SyncResult {
  rev: number;
  rows: Pass[];
  deleted: { id: number; rev: number }[];
  /** True when the database was replaced (e.g. restored from a backup): drop everything and reload. */
  reset: boolean;
  /** Set when the last automatic backup failed. */
  backupError: string;
}

export interface Change {
  id: number;
  done_at: string;
  done_by: string;
  action: Action | 'undo';
  type: PassType | null;
  serial_from: number | null;
  serial_to: number | null;
  summary: string;
  count: number;
  undone_at: string | null;
  undone_by: string | null;
}
