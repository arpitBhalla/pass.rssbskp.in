import { PASS_TYPES, type PassType } from '@/shared/types';

/**
 * The pass code in what a QR code holds: just the code (44 digits), or, on passes printed before
 * 2026-11-12, a link ending in "/v#" and the code. Null: not a pass code.
 */
export function codeIn(text: string): string | null {
  const m = /(?:^|\/v#)([1-9]\d{43})$/.exec(text.trim());
  return m ? m[1] : null;
}

/**
 * Which pass a code says it is, before the server checks it (so the gate sees which pass even when
 * the register can't be reached). The code is one number of 19 bytes: format (2), key id, sheet,
 * serial (3 bytes), name hash (3 bytes), secret tag (10 bytes). See src/server/qr.ts.
 */
export function claimOf(code: string): { type: PassType; serial: number } | null {
  let hex = BigInt(code).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const b = Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  if (b.length !== 19 || b[0] !== 2 || b[2] >= PASS_TYPES.length) return null;
  return { type: PASS_TYPES[b[2]], serial: (b[3] << 16) | (b[4] << 8) | b[5] };
}
