export const TYPES = ['Mobile', 'Bike'] as const;
export type PassType = (typeof TYPES)[number];

export const PREFIX: Record<PassType, string> = { Mobile: 'M-', Bike: 'B-' };

/** Where a Mobile pass is valid. Someone who needs both gets two passes. */
export const ZONES = ['Pandal', 'Non Pandal'] as const;
export type PassZone = (typeof ZONES)[number];

export interface Pass {
  id: string;
  type: PassType;
  /** As printed on the pass, e.g. "M-105". */
  serial: string;
  /** Number part of the serial, unique within a type. Used for ranges. */
  num: number;
  /** Sewadar name on the pass (blank passes have none). */
  name: string;
  dept: string;
  area: string;
  phone: string;
  /** Incharge the pass was handed to. */
  incharge: string;
  /** Mobile passes only ('' = not set yet). */
  zone: PassZone | '';
  /** Ticked automatically after printing; untick to print it again. */
  printed: boolean;
}

/** Editable sheet columns, in on-screen order (a multi-column paste fills them left to right). */
export const EDIT_KEYS = ['name', 'dept', 'area', 'phone', 'incharge'] as const;
export type EditKey = (typeof EDIT_KEYS)[number];
/** Everything the Give / fill box can set: the sheet columns plus Pandal / Non Pandal. */
export const FILL_KEYS = [...EDIT_KEYS, 'zone'] as const;
export type FillKey = (typeof FILL_KEYS)[number];

/** Bike passes: chosen when printing. (Mobile passes carry their own Pandal / Non Pandal.) */
export type Zone = 'inside' | 'outside';

export interface PrintSettings {
  zone: Zone;
  /** Side text, e.g. "SIKANDERPUR 2025". */
  event: string;
  validTill: string;
  /** Signature image as a data: URL ('' = none). */
  signature: string;
}
