import { crc32 as nodeCrc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { blankPass } from './passes';
import { exportWorkbook, planImport } from './csv';
import { crc32, workbook } from './xlsx';
import { PASS_TYPES, type Pass, type PassType } from '@/shared/types';

/** Reads a zip of deflated files: name → text, checking each file's size and CRC. */
function unzip(z: Uint8Array): Map<string, string> {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const eocd = z.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const files = new Map<string, string>();
  let at = v.getUint32(eocd + 16, true);
  for (let i = 0; i < v.getUint16(eocd + 10, true); i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const nameLen = v.getUint16(at + 28, true);
    const name = new TextDecoder().decode(z.subarray(at + 46, at + 46 + nameLen));
    const local = v.getUint32(at + 42, true);
    expect(v.getUint16(local + 8, true)).toBe(8);
    const start = local + 30 + v.getUint16(local + 26, true);
    const data = new Uint8Array(inflateRawSync(z.subarray(start, start + v.getUint32(local + 18, true))));
    expect(data.length).toBe(v.getUint32(local + 22, true));
    expect(crc32(data)).toBe(v.getUint32(at + 16, true));
    expect(nodeCrc32(data)).toBe(v.getUint32(at + 16, true));
    files.set(name, new TextDecoder().decode(data));
    at += 46 + nameLen;
  }
  return files;
}

const pass = (type: PassType, serial: number, v: Partial<Pass> = {}): Pass =>
  ({ ...blankPass(type, serial), id: serial, created_at: '2026-11-12T10:00:00Z', ...v });

describe('Excel workbook export', () => {
  it('is a zip of the workbook parts, with correct checksums', async () => {
    const files = unzip(await workbook([{ name: 'A', rows: [['x']] }, { name: 'B', rows: [['y']] }]));
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="B" sheetId="2" r:id="rId2"/>');
  });

  it('has a tab per sheet; serials and phones stay text; special characters are escaped', async () => {
    const sheets = Object.fromEntries(PASS_TYPES.map((t) => [t, []])) as unknown as Record<PassType, Pass[]>;
    sheets['mobile-pandal'] = [pass('mobile-pandal', 7, { name: 'Kaur & <Singh>', phone: '+919876543210', incharge: 'Ramesh', given_at: '2026-11-12T11:00:00Z' })];
    sheets['bav-entry'] = [pass('bav-entry', 12, { vehicle_no: 'DL 8C 0012' })];
    const files = unzip(await exportWorkbook(sheets));
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="BAV Parking" sheetId="8" r:id="rId8"/>');
    const mp = files.get('xl/worksheets/sheet1.xml')!;
    expect(mp).toContain('<t xml:space="preserve">0007</t>');
    expect(mp).toContain('<t xml:space="preserve">+919876543210</t>');
    expect(mp).toContain('Kaur &amp; &lt;Singh&gt;');
    expect(mp).toContain('<t xml:space="preserve">Given</t>'); // header
    expect(mp).toMatch(/r="H2" t="inlineStr"><is><t xml:space="preserve">Yes</); // Given column, ticked
    expect(files.get('xl/worksheets/sheet8.xml')).toContain('DL 8C 0012');
  });
});

describe('BAV Entry renamed to BAV Parking', () => {
  it('still imports a CSV whose Pass type says BAV Entry', () => {
    const plan = planImport([], 'bav-entry', 'Sr. No.,Pass type,Name\n0001,BAV Entry,Harpreet\n0002,BAV Parking,Gurmeet\n');
    expect(plan.error).toBe('');
    expect(plan.create.map((c) => c.serial)).toEqual([1, 2]);
    expect(plan.otherSheet + plan.unknownSheet).toBe(0);
  });
});
