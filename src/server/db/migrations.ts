import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';
import { cleanField, type Field, FIELDS } from '@/shared/types';

/**
 * Database migrations, applied in name order when the server starts.
 * Never edit one that has run on a real database: add a new one instead.
 */
export const migrations: Record<string, Migration> = {
  '0001_init': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        CREATE TYPE pass_type AS ENUM (
          'mobile-pandal', 'mobile-non-pandal',
          'bike-pandal',   'bike-non-pandal',
          'sewa-vehicle',  'tractor-trolley'
        );

        CREATE TABLE users (
          id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          username       text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{2,40}$'),
          name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
          password_hash  text NOT NULL,
          is_admin       boolean NOT NULL DEFAULT false,
          active         boolean NOT NULL DEFAULT true,
          created_at     timestamptz NOT NULL DEFAULT now(),
          created_by     integer REFERENCES users (id)
        );

        CREATE TABLE sessions (
          id          text PRIMARY KEY,
          user_id     integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          created_at  timestamptz NOT NULL DEFAULT now(),
          expires_at  timestamptz NOT NULL
        );
        CREATE INDEX sessions_user_id ON sessions (user_id);

        -- One row per pass. A range given to an incharge is one row per serial, so a pass can
        -- never be given twice (UNIQUE) and one pass in a range can get a name later.
        CREATE TABLE passes (
          id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          type        pass_type NOT NULL,
          serial      integer NOT NULL CHECK (serial BETWEEN 1 AND 99999),
          name        text NOT NULL DEFAULT '' CHECK (length(name) <= 120),
          dept        text NOT NULL DEFAULT '' CHECK (length(dept) <= 120),
          area        text NOT NULL DEFAULT '' CHECK (length(area) <= 120),
          phone       text NOT NULL DEFAULT '' CHECK (length(phone) <= 120),
          vehicle_no  text NOT NULL DEFAULT '' CHECK (length(vehicle_no) <= 120),
          incharge    text NOT NULL DEFAULT '' CHECK (length(incharge) <= 120),
          printed_at  timestamptz,
          created_at  timestamptz NOT NULL DEFAULT now(),
          created_by  integer NOT NULL REFERENCES users (id),
          updated_at  timestamptz NOT NULL DEFAULT now(),
          updated_by  integer NOT NULL REFERENCES users (id),
          rev         integer NOT NULL,
          UNIQUE (type, serial),
          CHECK (vehicle_no = '' OR type IN ('sewa-vehicle', 'tractor-trolley'))
        );
        CREATE INDEX passes_rev ON passes (rev);

        -- Every action, for History and Undo.
        CREATE TABLE changes (
          id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          done_at      timestamptz NOT NULL DEFAULT now(),
          done_by      integer NOT NULL REFERENCES users (id),
          action       text NOT NULL,
          type         pass_type,
          serial_from  integer,
          serial_to    integer,
          summary      text NOT NULL,
          count        integer NOT NULL,
          rev          integer NOT NULL,
          before       jsonb NOT NULL,
          undone_at    timestamptz,
          undone_by    integer REFERENCES users (id)
        );

        -- Bumped by every write. Each write locks this row first, so writes are saved one at a
        -- time, in order, and every desk can fetch exactly what changed since its last look.
        CREATE TABLE meta (
          id       integer PRIMARY KEY CHECK (id = 1),
          version  integer NOT NULL
        );
        INSERT INTO meta VALUES (1, 0);

        -- Passes removed by Undo, so other desks drop them too.
        CREATE TABLE deleted_passes (
          id   integer PRIMARY KEY,
          rev  integer NOT NULL
        );
        CREATE INDEX deleted_passes_rev ON deleted_passes (rev);

        CREATE TABLE settings (
          key         text PRIMARY KEY,
          value       text NOT NULL,
          updated_at  timestamptz NOT NULL DEFAULT now(),
          updated_by  integer NOT NULL REFERENCES users (id)
        );
      `).execute(db);
    },
  },
  // Pass templates: Bike passes carry a Veh. Reg No.; Sewa Vehicle / Tractor Trolley passes also
  // carry the Vehicle (make / model) next to its Reg. No.
  '0002_vehicle': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        ALTER TABLE passes ADD COLUMN vehicle text NOT NULL DEFAULT '' CHECK (length(vehicle) <= 120);
        ALTER TABLE passes DROP CONSTRAINT IF EXISTS passes_check;
        ALTER TABLE passes ADD CONSTRAINT passes_vehicle_no_sheets
          CHECK (vehicle_no = '' OR type NOT IN ('mobile-pandal', 'mobile-non-pandal'));
        ALTER TABLE passes ADD CONSTRAINT passes_vehicle_sheets
          CHECK (vehicle = '' OR type IN ('sewa-vehicle', 'tractor-trolley'));
      `).execute(db);
    },
  },
  // Gate checks: every scan of a pass's QR code, so a pass scanned again shows when and by whom.
  '0003_scans': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        CREATE TABLE scans (
          id          bigserial PRIMARY KEY,
          type        text NOT NULL,
          serial      integer NOT NULL,
          result      text NOT NULL,
          scanned_by  integer NOT NULL REFERENCES users (id),
          scanned_at  timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX scans_pass ON scans (type, serial, scanned_at DESC);
      `).execute(db);
    },
  },
  // Two more sheets, laid out like the Sewa Vehicle pass. The Vehicle rule names the sheets without a
  // Vehicle column, as new enum values can't be used in the transaction that adds them.
  '0004_entry_passes': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        ALTER TYPE pass_type ADD VALUE IF NOT EXISTS 'gate3-entry';
        ALTER TYPE pass_type ADD VALUE IF NOT EXISTS 'bav-entry';
        ALTER TABLE passes DROP CONSTRAINT passes_vehicle_sheets;
        ALTER TABLE passes ADD CONSTRAINT passes_vehicle_sheets
          CHECK (vehicle = '' OR type NOT IN ('mobile-pandal', 'mobile-non-pandal', 'bike-pandal', 'bike-non-pandal'));
      `).execute(db);
    },
  },
  // Given is ticked by hand when a pass is handed over (until now a pass counted as given once it had
  // an incharge, name, dept or phone). Every existing pass starts unticked.
  '0005_given': {
    async up(db: Kysely<unknown>) {
      await sql.raw('ALTER TABLE passes ADD COLUMN given_at timestamptz;').execute(db);
    },
  },
  // Two more vehicle-size sheets: VIP Gate (red; shown as "Gate 3 - VIP") and Admin (teal). Added at the
  // end: a pass's QR code holds its sheet's position in the list.
  '0007_vip_admin': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        ALTER TYPE pass_type ADD VALUE IF NOT EXISTS 'vip-gate';
        ALTER TYPE pass_type ADD VALUE IF NOT EXISTS 'admin';
      `).execute(db);
    },
  },
  // A desk whose connection drops sends a request again: the change it made is found by this code
  // instead of being made twice.
  '0008_request_id': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        ALTER TABLE changes ADD COLUMN request_id text CHECK (length(request_id) <= 64);
        CREATE UNIQUE INDEX changes_request_id_key ON changes (request_id) WHERE request_id IS NOT NULL;
      `).execute(db);
    },
  },
  // Who collected the pass at the desk, filled in at handover (after printing). Not printed on the pass.
  '0006_issued_to': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`ALTER TABLE passes ADD COLUMN issued_to text NOT NULL DEFAULT '' CHECK (length(issued_to) <= 120);`).execute(db);
    },
  },
  // Three Free Helpline Sewa sheets: E-Rickshaw, Eco and Metro (the owner, 2026-11-15). Added at the end:
  // a pass's QR code holds its sheet's position in the list. The Vehicle and Reg. No. rules name the sheets
  // that may not have them, so these need no change.
  '0009_helpline': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        ALTER TYPE pass_type ADD VALUE IF NOT EXISTS 'e-rickshaw';
        ALTER TYPE pass_type ADD VALUE IF NOT EXISTS 'eco';
        ALTER TYPE pass_type ADD VALUE IF NOT EXISTS 'metro';
      `).execute(db);
    },
  },
  // Every value is saved in capitals and mobiles as 98765-43210 since 2026-11-17 (cleanField): the passes
  // saved before then are written the same way, once (the owner's yes, 2026-11-17), so "Ramesh" and "RAMESH"
  // are one value. One new revision, so every desk picks the changes up on its next sync. Not in History.
  '0010_capitals': {
    async up(db: Kysely<unknown>) {
      type Row = { id: number } & Record<Field, string>;
      const { rows } = await sql<Row>`SELECT id, ${sql.join(FIELDS.map((k) => sql.ref(k)))} FROM passes`.execute(db);
      const changed = rows.flatMap((r) => {
        const v = Object.fromEntries(FIELDS.map((k) => [k, cleanField(k, r[k])])) as Record<Field, string>;
        return FIELDS.some((k) => v[k] !== r[k]) ? [{ id: r.id, ...v }] : [];
      });
      if (!changed.length) return;
      const { rows: [{ version }] } = await sql<{ version: number }>`UPDATE meta SET version = version + 1 WHERE id = 1 RETURNING version`.execute(db);
      await sql`
        UPDATE passes p SET ${sql.join(FIELDS.map((k) => sql`${sql.ref(k)} = v.${sql.ref(k)}`))}, rev = ${version}
        FROM jsonb_to_recordset(${JSON.stringify(changed)}::jsonb)
          AS v(id int, ${sql.join(FIELDS.map((k) => sql`${sql.ref(k)} text`))})
        WHERE p.id = v.id`.execute(db);
    },
  },
  // Gate 3 Hospital (the owner, 2026-11-22): a sheet added at the end (a pass's QR code holds its sheet's
  // position in the list), and `meta`, a pass's yes / no details (FLAGS: Ferry Sewa), only the ticked ones.
  '0011_hospital_meta': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        ALTER TYPE pass_type ADD VALUE IF NOT EXISTS 'gate3-hospital';
        ALTER TABLE passes ADD COLUMN meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object' AND length(meta::text) <= 500);
      `).execute(db);
    },
  },
  // Packets (the owner, 2026-11-24): the passes for one incharge, scanned into a packet and handed over together.
  '0012_packet': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        ALTER TABLE passes ADD COLUMN packet text NOT NULL DEFAULT '' CHECK (length(packet) <= 40);
        CREATE INDEX passes_packet_idx ON passes (packet) WHERE packet <> '';
      `).execute(db);
    },
  },
  // Lost passes and their duplicates; users who can only check passes at the gate (the owner, 2026-11-24).
  '0013_lost': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        ALTER TABLE passes ADD COLUMN lost_at timestamptz, ADD COLUMN copy_of integer;
        CREATE INDEX passes_copy_of_idx ON passes (copy_of) WHERE copy_of IS NOT NULL;
        ALTER TABLE users ADD COLUMN scan_only boolean NOT NULL DEFAULT false;
      `).execute(db);
    },
  },
  // Who ticked Printed and Given (the owner, 2026-11-24). Passes printed or given before: the user of the History entry that
  // did it (its done_at is the same now() as the pass's printed_at / given_at, one transaction); none if History can't tell.
  '0014_printed_by': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`
        ALTER TABLE passes ADD COLUMN printed_by integer REFERENCES users (id), ADD COLUMN given_by integer REFERENCES users (id);
        UPDATE passes p SET printed_by = c.done_by FROM changes c WHERE c.done_at = p.printed_at AND c.undone_at IS NULL;
        UPDATE passes p SET given_by = c.done_by FROM changes c WHERE c.done_at = p.given_at AND c.undone_at IS NULL;
      `).execute(db);
    },
  },
  // Gate 3 - Family (the owner, 2026-11-25): a sheet added at the end (a pass's QR code holds its sheet's position in the list).
  '0015_gate3_family': {
    async up(db: Kysely<unknown>) {
      await sql.raw(`ALTER TYPE pass_type ADD VALUE IF NOT EXISTS 'gate3-family';`).execute(db);
    },
  },
};
