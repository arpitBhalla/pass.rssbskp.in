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
] as const;
export type PassType = (typeof PASS_TYPES)[number];

/** Text columns. A sheet shows its own subset, in its own order (see `fields` below). */
export const FIELDS = ['name', 'dept', 'area', 'phone', 'vehicle', 'vehicle_no', 'incharge'] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABELS: Record<Field, string> = {
  name: 'Name', dept: 'Dept', area: 'Area', phone: 'Phone', vehicle: 'Vehicle', vehicle_no: 'Reg. No.', incharge: 'Incharge',
};

/** Which printed template a sheet uses (the RSSB SKP pass templates). */
export type Layout = 'mobile' | 'bike' | 'vehicle';

export interface PassTypeInfo {
  /** Tab / sheet name. */
  label: string;
  /** Two letters, used where several sheets are listed together (report). */
  short: string;
  layout: Layout;
  /** Big title line(s) on the printed pass. */
  title: string;
  /** Columns, in sheet order (a multi-column paste from Excel fills them left to right). */
  fields: readonly Field[];
  /** Template colours: top / bottom band, the thin stripe beside it, card background and logo box; `title`: 150 × 100 mm passes' title. */
  color: { name: string; band: string; stripe: string; bg: string; logo: string; title?: string };
}

const MOBILE_FIELDS: readonly Field[] = ['name', 'dept', 'area', 'phone', 'incharge'];
const BIKE_FIELDS: readonly Field[] = ['name', 'dept', 'area', 'vehicle_no', 'phone', 'incharge'];
const VEHICLE_FIELDS: readonly Field[] = ['name', 'vehicle', 'vehicle_no', 'area', 'dept', 'phone', 'incharge'];

// Colours sampled from the templates (Downloads/passes-template). Pandal is blue, Non Pandal grey,
// vehicle passes green; Mobile (portrait) and Bike (landscape, tinted card) differ by shape.
// Gate 3 Entry (orange) and BAV Entry (purple) have no template: the Sewa Vehicle pass in their colour,
// title included, so the gate tells them apart at a glance.
const BLUE = { name: 'Blue', band: '#2e3192', logo: '#231f20' };
const GREY = { name: 'Grey', band: '#808285', logo: '#9e0b0f' };
const GREEN = { name: 'Green', band: '#007236', stripe: '#bcbec0', bg: '#ffffff', logo: '#939598' };
const ORANGE = { ...GREEN, name: 'Orange', band: '#d35400', title: '#d35400' };
const PURPLE = { ...GREEN, name: 'Purple', band: '#5b2c83', title: '#5b2c83' };

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
  'tractor-trolley': { label: 'Tractor Trolley', short: 'TT', layout: 'vehicle', title: 'TRACTOR TROLLEY PASS', fields: VEHICLE_FIELDS, color: GREEN },
  'gate3-entry': { label: 'Gate 3 Entry', short: 'G3', layout: 'vehicle', title: 'GATE 3 ENTRY PASS', fields: VEHICLE_FIELDS, color: ORANGE },
  'bav-entry': { label: 'BAV Entry', short: 'BA', layout: 'vehicle', title: 'BAV ENTRY PASS', fields: VEHICLE_FIELDS, color: PURPLE },
};

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
  /** ISO time, or null if not printed yet. */
  printed_at: string | null;
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
  expect: Values & { printed?: boolean };
}

/** Create a pass. Fails if that serial already exists in the sheet. */
export interface CreateOp {
  type: PassType;
  serial: number;
  values: Values;
  printed?: boolean;
}

export const ACTIONS = ['give', 'edit', 'paste', 'print', 'import'] as const;
export type Action = (typeof ACTIONS)[number];

/** One user action. All of it is saved, or none of it. */
export interface ApplyRequest {
  action: Action;
  summary: string;
  set?: SetOp[];
  create?: CreateOp[];
}

export interface ApplyResult {
  changeId: number;
  rows: Pass[];
}

export interface UndoResult {
  rows: Pass[];
  deleted: number[];
  summary: string;
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
