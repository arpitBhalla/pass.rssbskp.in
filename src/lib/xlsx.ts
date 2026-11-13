/**
 * A small .xlsx (Excel workbook) writer: one worksheet per sheet, every cell text (so serials and phone
 * numbers keep their leading zeros), a bold header row that stays in view when scrolling. An .xlsx is a
 * zip of XML files, compressed with the browser's own deflate (CompressionStream).
 */
export interface WorkbookSheet {
  /** Tab name: at most 31 characters, none of []:*?/\ */
  name: string;
  /** The first row is the header. */
  rows: string[][];
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// XML can't hold most control characters at all.
// oxlint-disable-next-line no-control-regex -- removing control characters is the point
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 0 → A, 25 → Z, 26 → AA. */
const column = (i: number): string => (i < 26 ? '' : column(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26));

function sheetXml({ rows }: WorkbookSheet): string {
  const widths = (rows[0] ?? []).map((_, x) => Math.min(40, Math.max(6, ...rows.map((r) => (r[x] ?? '').length + 2))));
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const data = rows.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => (v === ''
    ? ''
    : `<c r="${column(x)}${y + 1}" t="inlineStr"${y === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join('')}</row>`).join('');
  return `${XML_HEAD}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData></worksheet>`;
}

/** The workbook as .xlsx file contents. */
export async function workbook(sheets: WorkbookSheet[]): Promise<Uint8Array<ArrayBuffer>> {
  const n = sheets.length;
  const files: [string, string][] = [
    ['[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'],
    ['_rels/.rels', `${XML_HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>`
      + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', `${XML_HEAD}<Relationships xmlns="${PKG_REL}">`
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `${XML_HEAD}<styleSheet xmlns="${MAIN}">`
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>'],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  const enc = new TextEncoder();
  return zip(files.map(([name, text]) => ({ name, data: enc.encode(text) })));
}

/* ---------- zip ---------- */

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = (1 << 5) | 1; // 1 Jan 1980: file times don't matter here

async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zip(files: { name: string; data: Uint8Array<ArrayBuffer> }[]): Promise<Uint8Array<ArrayBuffer>> {
  const enc = new TextEncoder();
  const entries = await Promise.all(files.map(async (f) => ({
    path: enc.encode(f.name), crc: crc32(f.data), size: f.data.length, data: await deflate(f.data),
  })));
  const localSize = entries.reduce((s, e) => s + 30 + e.path.length + e.data.length, 0);
  const centralSize = entries.reduce((s, e) => s + 46 + e.path.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(at);
    v.setUint32(at, 0x04034b50, true);
    v.setUint16(at + 4, 20, true); // version needed
    v.setUint16(at + 6, 0x0800, true); // names are UTF-8
    v.setUint16(at + 8, 8, true); // deflate
    v.setUint16(at + 10, 0, true);
    v.setUint16(at + 12, DOS_DATE, true);
    v.setUint32(at + 14, e.crc, true);
    v.setUint32(at + 18, e.data.length, true);
    v.setUint32(at + 22, e.size, true);
    v.setUint16(at + 26, e.path.length, true);
    v.setUint16(at + 28, 0, true);
    out.set(e.path, at + 30);
    out.set(e.data, at + 30 + e.path.length);
    at += 30 + e.path.length + e.data.length;
  }
  const central = at;
  entries.forEach((e, i) => {
    v.setUint32(at, 0x02014b50, true);
    v.setUint16(at + 4, 20, true); // made by
    v.setUint16(at + 6, 20, true); // needed
    v.setUint16(at + 8, 0x0800, true);
    v.setUint16(at + 10, 8, true);
    v.setUint16(at + 12, 0, true);
    v.setUint16(at + 14, DOS_DATE, true);
    v.setUint32(at + 16, e.crc, true);
    v.setUint32(at + 20, e.data.length, true);
    v.setUint32(at + 24, e.size, true);
    v.setUint16(at + 28, e.path.length, true);
    // extra, comment, disk, internal and external attributes: 0
    v.setUint32(at + 42, offsets[i], true);
    out.set(e.path, at + 46);
    at += 46 + e.path.length;
  });
  v.setUint32(at, 0x06054b50, true);
  v.setUint16(at + 8, entries.length, true);
  v.setUint16(at + 10, entries.length, true);
  v.setUint32(at + 12, at - central, true);
  v.setUint32(at + 16, central, true);
  return out;
}
