// Shared by the server (Node) and the browser app. Keep it plain TypeScript: no imports.

/** The six pass sheets. Each has its own serial numbers, starting at 0001. */
export const PASS_TYPES = [
  'mobile-pandal',
  'mobile-non-pandal',
  'bike-pandal',
  'bike-non-pandal',
  'sewa-vehicle',
  'tractor-trolley',
] as const;
export type PassType = (typeof PASS_TYPES)[number];

export interface PassTypeInfo {
  /** Tab / sheet name. */
  label: string;
  /** Two letters, used where several sheets are listed together (report). */
  short: string;
  /** Grey line on the printed pass. */
  kind: string;
  /** Big line on the printed pass. */
  title: string;
  /** Has a Vehicle No. */
  vehicle: boolean;
}

export const TYPE_INFO: Record<PassType, PassTypeInfo> = {
  'mobile-pandal': { label: 'Mobile Pandal', short: 'MP', kind: 'MOBILE PASS', title: 'PANDAL', vehicle: false },
  'mobile-non-pandal': { label: 'Mobile Non Pandal', short: 'MN', kind: 'MOBILE PASS', title: 'NON PANDAL', vehicle: false },
  'bike-pandal': { label: 'Bike Pandal', short: 'BP', kind: 'BIKE PASS', title: 'PANDAL', vehicle: false },
  'bike-non-pandal': { label: 'Bike Non Pandal', short: 'BN', kind: 'BIKE PASS', title: 'NON PANDAL', vehicle: false },
  'sewa-vehicle': { label: 'Sewa Vehicle', short: 'SV', kind: 'VEHICLE PASS', title: 'SEWA VEHICLE', vehicle: true },
  'tractor-trolley': { label: 'Tractor Trolley', short: 'TT', kind: 'VEHICLE PASS', title: 'TRACTOR TROLLEY', vehicle: true },
};

export const isPassType = (v: unknown): v is PassType => PASS_TYPES.includes(v as PassType);

/** Text columns, in sheet order (a multi-column paste from Excel fills them left to right). */
export const FIELDS = ['name', 'dept', 'area', 'phone', 'vehicle_no', 'incharge'] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABELS: Record<Field, string> = {
  name: 'Name', dept: 'Dept', area: 'Area', phone: 'Phone', vehicle_no: 'Vehicle No.', incharge: 'Incharge',
};

/** The columns a sheet has: Vehicle No. only on vehicle sheets. */
export const fieldsFor = (t: PassType): readonly Field[] =>
  TYPE_INFO[t].vehicle ? FIELDS : FIELDS.filter((f) => f !== 'vehicle_no');

export const MAX_TEXT = 120;
export const MAX_SERIAL = 99999;
/** Most passes one action may touch (a give, paste, print or import). */
export const MAX_BATCH = 5000;

/** Printed as 4 digits: 7 → "0007". */
export const fmtSerial = (n: number) => String(n).padStart(4, '0');

/** Trims, flattens tabs / line breaks to spaces and caps the length. */
export const cleanText = (v: string) => v.replace(/[\t\r\n]+/g, ' ').trim().slice(0, MAX_TEXT);

export interface Pass {
  id: number;
  type: PassType;
  serial: number;
  name: string;
  dept: string;
  area: string;
  phone: string;
  vehicle_no: string;
  incharge: string;
  /** ISO time, or null if not printed yet. */
  printed_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  /** Database version of the last change to this pass (for live updates). */
  rev: number;
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

export interface Settings {
  /** Signature image as a data: URL ('' = none). */
  signature: string;
}

export const USER_HEADER = 'x-pass-user';
