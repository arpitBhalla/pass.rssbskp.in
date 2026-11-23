import 'server-only';
import { type Kysely, sql } from 'kysely';
import { type PassType, TYPE_INFO } from '@/shared/types';
import type { Database } from './db/schema';
import { checkCode, currentKeys, hashOfName, keysFor, makeCode, printedName } from './qr';

/** The QR code of each pass being printed, signed with the name now in the register. */
export async function passCodes(db: Kysely<Database>, userId: number, type: PassType, serials: number[]) {
  const keys = await keysFor(db, userId);
  const rows = await db.selectFrom('passes').select(['serial', 'name'])
    .where('type', '=', type).where('serial', 'in', serials).execute();
  const names = new Map(rows.map((r) => [r.serial, r.name]));
  return serials.map((serial) => {
    const name = names.get(serial) ?? '';
    return { serial, name: printedName(name), code: makeCode(keys, type, serial, name) };
  });
}

/** valid: let in. check: genuine, but the register disagrees with the pass; look closer. invalid: don't let in. */
export type Verdict = 'valid' | 'check' | 'invalid';

/**
 * A gate check: reads the code, checks its secret tag and the register, and records the scan.
 * Shows the register's details only for genuine codes.
 */
export async function checkPass(db: Kysely<Database>, userId: number, code: string) {
  const c = checkCode(await currentKeys(db), code);
  if (c.why === 'unreadable') {
    return { verdict: 'invalid' as Verdict, reasons: ['This QR code is not an RSSB SKP pass.'], claim: null, pass: null, earlier: [], scans: 0 };
  }

  const reasons: string[] = [];
  let verdict: Verdict = 'valid';
  let pass = null;
  if (c.why === 'fake') {
    verdict = 'invalid';
    reasons.push("Fake: the code doesn't match the register's secret.");
  } else if (c.why === 'old-key') {
    verdict = 'invalid';
    reasons.push('Not made with the current key: a fake, or printed before the key was changed in Settings.');
  } else {
    const row = await db.selectFrom('passes')
      .select(['name', 'dept', 'area', 'phone', 'incharge', 'issued_to', 'vehicle', 'vehicle_no', 'printed_at', 'given_at', 'meta'])
      .where('type', '=', c.type).where('serial', '=', c.serial).executeTakeFirst();
    if (!row) {
      verdict = 'invalid';
      reasons.push('Not in the register.');
    } else {
      pass = {
        name: row.name, dept: row.dept, area: row.area, incharge: row.incharge, issued_to: row.issued_to, vehicle: row.vehicle, vehicle_no: row.vehicle_no,
        ferry: row.meta?.ferry ? 'Yes' : '', // Ferry Sewa (Gate 3 Hospital)
        rtb3: row.meta?.rtb3 ? 'Yes' : '', // Behind RTB 3 (Gate 1 & 11), not BAV Parking
      };
      // A pass printed blank gets its name later, by hand and in the register: only a printed name must match.
      if (!hashOfName(c.nameHash, '') && !hashOfName(c.nameHash, row.name)) {
        reasons.push(row.name.trim()
          ? `The name printed on this pass isn't the one in the register (now ${printedName(row.name)}): it was changed after printing.`
          : 'The name printed on this pass has since been removed from the register.');
      }
      if (!row.printed_at) reasons.push("The register doesn't show this pass as printed.");
      if (!row.given_at) reasons.push("The register doesn't show this pass as given (Given not ticked).");
      if (reasons.length) verdict = 'check';
    }
  }

  const earlier = await db.selectFrom('scans').innerJoin('users', 'users.id', 'scans.scanned_by')
    .select(['scans.scanned_at as at', 'scans.result', 'users.name as by'])
    .where('scans.type', '=', c.type).where('scans.serial', '=', c.serial)
    .orderBy('scans.scanned_at', 'desc').limit(5).execute();
  const { n } = await db.selectFrom('scans').select(sql<number>`count(*)::int`.as('n'))
    .where('type', '=', c.type).where('serial', '=', c.serial).executeTakeFirstOrThrow();
  await db.insertInto('scans').values({ type: c.type, serial: c.serial, result: verdict, scanned_by: userId }).execute();

  return {
    verdict,
    reasons,
    claim: { type: c.type, label: TYPE_INFO[c.type].label, serial: c.serial },
    pass,
    earlier: earlier.map((e) => ({ at: e.at.toISOString(), result: e.result, by: e.by })),
    scans: n,
  };
}
