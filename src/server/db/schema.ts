import type { ColumnType, Generated, Selectable } from 'kysely';
import type { PassType } from '@/shared/types';

/** Table types for Kysely. Must match migrations.ts. */
export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  passes: PassesTable;
  changes: ChangesTable;
  meta: MetaTable;
  deleted_passes: DeletedPassesTable;
  settings: SettingsTable;
  scans: ScansTable;
}

export interface UsersTable {
  id: Generated<number>;
  username: string;
  name: string;
  password_hash: string;
  is_admin: Generated<boolean>;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  created_by: number | null;
}

export interface SessionsTable {
  /** sha256 of the cookie token, so a leaked table can't be used to log in. */
  id: string;
  user_id: number;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface PassesTable {
  id: Generated<number>;
  type: PassType;
  serial: number;
  name: Generated<string>;
  dept: Generated<string>;
  area: Generated<string>;
  phone: Generated<string>;
  vehicle: Generated<string>;
  vehicle_no: Generated<string>;
  incharge: Generated<string>;
  issued_to: Generated<string>;
  printed_at: Date | null;
  given_at: Generated<Date | null>;
  created_at: Generated<Date>;
  created_by: number;
  updated_at: Generated<Date>;
  updated_by: number;
  rev: number;
}
export type PassRow = Selectable<PassesTable>;

/** What Undo needs: the passes as they were before, the ones the change created, and the ones it deleted. */
export interface ChangeBefore {
  rows: PassRowJson[];
  created: number[];
  deleted?: PassRowJson[];
}
/** A pass row after a trip through jsonb (dates become strings). */
export type PassRowJson = Omit<PassRow, 'printed_at' | 'given_at' | 'created_at' | 'updated_at'> & {
  printed_at: string | null;
  /** Missing in changes saved before Given existed. */
  given_at?: string | null;
  created_at: string;
  updated_at: string;
};

export interface ChangesTable {
  id: Generated<number>;
  done_at: Generated<Date>;
  done_by: number;
  action: string;
  type: PassType | null;
  serial_from: number | null;
  serial_to: number | null;
  summary: string;
  count: number;
  rev: number;
  before: ColumnType<ChangeBefore, string, string>;
  undone_at: Date | null;
  undone_by: number | null;
}

export interface MetaTable {
  id: number;
  version: number;
}

export interface DeletedPassesTable {
  id: number;
  rev: number;
}

export interface ScansTable {
  id: Generated<string>;
  type: string;
  serial: number;
  result: string;
  scanned_by: number;
  scanned_at: Generated<Date>;
}

export interface SettingsTable {
  key: string;
  value: string;
  updated_at: Generated<Date>;
  updated_by: number;
}
