import { claimOf, codeIn } from '@/lib/gateCode';
import { cleanField, cleanPacket, fmtSerial, MAX_PACKET, type Pass, type SetOp, SHEETS, TYPE_INFO } from '@/shared/types';
import { cardsLabel, isGiven, isPrinted } from './passes';

/*
 * Packets (the owner, 2026-11-24): the passes for one incharge are scanned into a packet on the Packets page and
 * tagged with it (Pass.packet), then the packet is handed over: Issued To filled in and Given ticked on them all.
 */

/** A scanned QR code: the pass it is, or why not. */
export type Scan = { pass: Pass } | { error: string };

/** Only passes printed and not given yet go in a packet (the owner, 2026-11-24). */
export const canPack = (p: Pass) => isPrinted(p) && !isGiven(p) && p.lost_at === null;

/** Why this pass can't go in a packet: "not printed yet", "given already (to HARJIT)"; '' if it can. */
const reason = (p: Pass) => (p.lost_at !== null ? 'marked LOST' : !isPrinted(p) ? 'not printed yet'
  : isGiven(p) ? `given already${p.issued_to ? ` (to ${p.issued_to})` : ''}` : '');

/** What a scanned QR code (or a typed code) is in the register, if it can go in a packet. */
export function scanOf(text: string, all: readonly Pass[]): Scan {
  const code = codeIn(text);
  const claim = code ? claimOf(code) : null;
  if (!claim) return { error: 'Not an RSSB SKP pass QR code.' };
  const pass = all.find((p) => p.type === claim.type && p.serial === claim.serial);
  if (!pass) return { error: `${TYPE_INFO[claim.type].label} ${fmtSerial(claim.serial)} is not in the register.` };
  const why = reason(pass);
  return why ? { error: `${TYPE_INFO[pass.type].label} ${fmtSerial(pass.serial)} is ${why}.` } : { pass };
}

/** What to look at in the list before tagging: a pass that can't go in any more (left out), or one moving from another packet. */
export function noteOn(p: Pass, tag: string): string {
  const why = reason(p);
  if (why) return `${why}: left out`;
  return p.packet && p.packet !== cleanPacket(tag) ? `in packet ${p.packet}: moves to this one` : '';
}

export interface Packet {
  tag: string;
  /** Sheet by sheet, by serial. */
  passes: Pass[];
  given: number;
  /** Who it was handed to (Issued To of its given passes). */
  issuedTo: string[];
}

const order = (p: Pass) => SHEETS.indexOf(p.type);
/** "2" before "10"; then by name. */
const byTag = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Every packet, by tag. */
export function packetsOf(all: readonly Pass[]): Packet[] {
  const by = new Map<string, Pass[]>();
  for (const p of all) if (p.packet) by.set(p.packet, [...(by.get(p.packet) ?? []), p]);
  return [...by]
    .sort(([a], [b]) => byTag(a, b))
    .map(([tag, ps]) => {
      const passes = ps.sort((a, b) => order(a) - order(b) || a.serial - b.serial);
      const given = passes.filter(isGiven);
      return { tag, passes, given: given.length, issuedTo: [...new Set(given.map((p) => p.issued_to).filter(Boolean))] };
    });
}

/** What a packet's mark in the sheet says on hover: "Packet 1: 3 passes (Mobile Pandal 0001–0003). Given to RAJ KUMAR ARORA." */
export function packetNote(k: Packet): string {
  const given = k.given === 0 ? 'Not handed over yet.'
    : `${k.given < k.passes.length ? `${k.given} of ${k.passes.length} given` : 'Given'} to ${k.issuedTo.join(', ') || 'no one named'}.`;
  return `Packet ${k.tag}: ${k.passes.length} pass${k.passes.length === 1 ? '' : 'es'} (${cardsLabel(k.passes)}). ${given}`;
}

/** The tag offered for a new packet: one more than the highest number used ("1" for the first). */
export function nextTag(all: readonly Pass[]): string {
  const most = all.reduce((m, p) => (/^\d+$/.test(p.packet) ? Math.max(m, Number(p.packet)) : m), 0);
  return String(most + 1);
}

/** The most common of these (first seen on a tie); '' if none. */
function most(values: readonly string[]): string {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  let best = '';
  for (const [v, k] of n) if (k > (n.get(best) ?? 0)) best = v;
  return best;
}

/**
 * The name offered for the next packet (the owner, 2026-11-24): the Area and Incharge most of its passes share, "SIRSA - CHIMAN LAL",
 * like the packets tagged by hand; a packet of that name still to hand over takes them, one handed over already gets the next number
 * ("SIRSA - CHIMAN LAL 2"). No Area or Incharge: the next number.
 */
export function suggestTag(list: readonly Pass[], packets: readonly Packet[], all: readonly Pass[]): string {
  const base = cleanPacket([most(list.map((p) => p.area)), most(list.map((p) => p.incharge))].filter(Boolean).join(' - '));
  if (!base) return nextTag(all);
  const tags = new Map(packets.map((k) => [k.tag, k]));
  for (let n = 1; ; n++) {
    const tag = n === 1 ? base : cleanPacket(`${base.slice(0, MAX_PACKET - String(n).length - 1)} ${n}`);
    const k = tags.get(tag);
    if (!k || k.given < k.passes.length) return tag;
  }
}

/** Renames a packet, or moves all of it into another packet: every pass in it, given or lost too. */
export const retagOps = (passes: readonly Pass[], tag: string): SetOp[] =>
  passes.filter((p) => p.packet && p.packet !== cleanPacket(tag)).map((p) => ({ id: p.id, packet: tag, expect: { packet: p.packet } }));

/** Puts these passes in packet `tag`: the printed ones not given yet (a pass already in it is left as it is). */
export const packOps = (passes: readonly Pass[], tag: string): SetOp[] =>
  passes.filter((p) => canPack(p) && p.packet !== cleanPacket(tag))
    .map((p) => ({ id: p.id, packet: tag, expect: { packet: p.packet, printed: true, given: false } }));

/** Hands a packet over to `to`: Issued To filled in and Given ticked, on its passes not given yet. */
export const handOverOps = (passes: readonly Pass[], to: string): SetOp[] =>
  passes.filter((p) => !isGiven(p) && p.lost_at === null).map((p) => ({
    id: p.id, values: { issued_to: cleanField('issued_to', to) }, given: true, expect: { issued_to: p.issued_to, given: false },
  }));
