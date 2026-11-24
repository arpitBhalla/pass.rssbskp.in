import { describe, expect, it } from 'vitest';
import type { Pass, PassType } from '@/shared/types';
import { handOverOps, nextTag, noteOn, packetNote, packetsOf, packOps, retagOps, scanOf, suggestTag } from './packets';
import { blankPass } from './passes';

let id = 0;
const pass = (type: PassType, serial: number, extra: Partial<Pass> = {}): Pass =>
  ({ ...blankPass(type, serial), id: ++id, printed_at: '2026-11-24T10:00:00Z', ...extra });

/** A pass code for this sheet and serial (format 2; the key, name hash and tag don't matter here). */
function codeFor(sheet: number, serial: number): string {
  const b = [2, 1, sheet, (serial >> 16) & 255, (serial >> 8) & 255, serial & 255, ...Array<number>(13).fill(7)];
  return BigInt(`0x${b.map((x) => x.toString(16).padStart(2, '0')).join('')}`).toString(10);
}

describe('packets', () => {
  const a = pass('mobile-pandal', 12, { name: 'AMIT' });
  const d = pass('mobile-pandal', 14, { packet: '2' });
  const b = pass('bike-pandal', 3, { packet: '2', given_at: '2026-11-24T11:00:00Z', issued_to: 'HARJIT' });
  const c = pass('mobile-pandal', 13, { packet: '10', printed_at: null });
  const all = [a, b, c, d];

  it('finds the pass a scanned code is, or says why not', () => {
    expect(scanOf(codeFor(0, 12), all)).toEqual({ pass: a });
    expect(scanOf(` ${codeFor(0, 12)}\n`, all)).toEqual({ pass: a });
    expect(scanOf(codeFor(0, 99), all)).toEqual({ error: 'Mobile Pandal 0099 is not in the register.' });
    expect(scanOf('hello', all)).toEqual({ error: 'Not an RSSB SKP pass QR code. Read “hello” (5 characters).' });
    // Only printed passes not given yet.
    expect(scanOf(codeFor(0, 13), all)).toEqual({ error: 'Mobile Pandal 0013 is not printed yet.' });
    expect(scanOf(codeFor(2, 3), all)).toEqual({ error: 'Bike Pandal 0003 is given already (to HARJIT).' });
  });

  it("reads a code with a scanner app's prefix and suffix, and says what it read when it isn't one", () => {
    const code = codeFor(0, 12);
    const at = (text: string) => scanOf(text, all);
    expect(at(`#P:${code}`)).toEqual({ pass: a });
    expect(at(`PASS ${code} ;`)).toEqual({ pass: a });
    expect(at(`${code}5`)).toEqual({ error: expect.stringMatching(/^Not an RSSB SKP pass QR code\. Read “\d{16}…\d{16}” \(45 characters\)\.$/) });
    expect(at('hello')).toEqual({ error: 'Not an RSSB SKP pass QR code. Read “hello” (5 characters).' });
  });

  it('notes what to look at before packing', () => {
    expect(noteOn(a, '3')).toBe('');
    expect(noteOn(d, '3')).toBe('in packet 2: moves to this one');
    expect(noteOn(d, '2')).toBe('');
    expect(noteOn(b, '3')).toBe('given already (to HARJIT): left out');
    expect(noteOn(c, '3')).toBe('not printed yet: left out');
  });

  it('lists packets by tag (2 before 10) and offers the next number', () => {
    expect(packetsOf(all).map((k) => [k.tag, k.passes.length, k.given, k.issuedTo])).toEqual([['2', 2, 1, ['HARJIT']], ['10', 1, 0, []]]);
    expect(nextTag(all)).toBe('11');
    expect(nextTag([a])).toBe('1');
  });

  it('says on hover what is in a packet and who it went to', () => {
    const [two, ten] = packetsOf(all);
    expect(packetNote(two)).toBe('Packet 2: 2 passes (Mobile Pandal 0014, Bike Pandal 0003). 1 of 2 given to HARJIT.');
    expect(packetNote(ten)).toBe('Packet 10: 1 pass (Mobile Pandal 0013). Not handed over yet.');
  });

  it('tags only the passes not in that packet, and hands over only those not given', () => {
    expect(packOps([a, b, c, d], '2')).toEqual([{ id: a.id, packet: '2', expect: { packet: '', printed: true, given: false } }]);
    expect(handOverOps([a, b], ' raj kumar ')).toEqual([
      { id: a.id, values: { issued_to: 'RAJ KUMAR' }, given: true, expect: { issued_to: '', given: false } },
    ]);
  });

  it('renames a packet: every pass in it, given ones too', () => {
    expect(retagOps([a, b, d], 'b 2')).toEqual([
      { id: b.id, packet: 'b 2', expect: { packet: '2' } }, { id: d.id, packet: 'b 2', expect: { packet: '2' } },
    ]);
  });

  it('offers a name from the Area and Incharge most passes share; one handed over already gets the next number', () => {
    const x = (n: number, area: string, incharge: string) => pass('mobile-pandal', 100 + n, { area, incharge });
    const list = [x(1, 'SIRSA', 'CHIMAN LAL'), x(2, 'SIRSA', 'CHIMAN LAL'), x(3, 'HISAR', 'RAM')];
    expect(suggestTag(list, packetsOf(all), all)).toBe('SIRSA - CHIMAN LAL');
    expect(suggestTag([x(4, '', '')], packetsOf(all), all)).toBe('11');
    const open = pass('bike-pandal', 50, { packet: 'SIRSA - CHIMAN LAL' });
    expect(suggestTag(list, packetsOf([...all, open]), all)).toBe('SIRSA - CHIMAN LAL'); // still to hand over: they join it
    const gone = { ...open, given_at: '2026-11-24T12:00:00Z' };
    expect(suggestTag(list, packetsOf([...all, gone]), all)).toBe('SIRSA - CHIMAN LAL 2');
  });
});
