'use client';
import { CARD_SIZE } from '@/lib/sheets';
import { type Field, type PassType, TYPE_INFO } from '@/shared/types';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import {
  A6, A7, BIG, C900, GREY, kindOf, mm, MONO, Monogram, ORG, ROZHA, type Row, serialText, T, tagText, upper, VEHICLE_ROWS, WHITE, widthOf,
} from './v2kit';

/**
 * Design v2 "Ticket" (round 7), the Gate 3 - VIP pass: a dotted perforation splits the pass into a body
 * (masthead, kind word, fields) and a stub (QR, serial, tag), like an admission ticket. The perforation
 * ends in punched holes and carries a line of microtext. As picked (selected.html, 2026-11-14): the kind
 * word in Roboto Condensed Black at 87 % width with no bar under it, and the serial in black Big
 * Shoulders, 26 % wide, a little lower than in round 7.
 */

/** Small capitals, tracked: labels, the zone line, captions. */
const caps = (cap: number) => cap * 0.14;

/** The pass's colour, and the width of fine colour lines (thicker for grey and orange, which office printers break into dots). */
function inkOf(t: PassType): { color: string; line: number } {
  const { name, band } = TYPE_INFO[t].color;
  return { color: name === 'Grey' ? '#5f6062' : band, line: name === 'Grey' || name === 'Orange' ? 0.3 : 0.25 };
}

/** The monogram (`w` wide) and beside it "RSSB SIKANDERPUR (MC)" over a tracked line, the two centred on the monogram. */
function Masthead({ x, y, w, cap, max, sub, subCap }: { x: number; y: number; w: number; cap: number; max: number; sub: string; subCap: number }) {
  const h = w * 1.2;
  const tx = x + w + w * 0.28;
  const block = cap + subCap * 1.5 + subCap;
  const top = y + (h - block) / 2;
  return (
    <g>
      <Monogram x={x} y={y} w={w} />
      <T t={ORG} f={ROZHA} cap={cap} x={tx} y={top + cap} max={max} />
      <T t={upper(sub)} f={A7} cap={subCap} x={tx} y={top + block} track={caps(subCap)} fill={GREY} max={max} />
    </g>
  );
}

/** A line of colour dots from (x, y1) to (x, y2), with a punched hole beyond each end. */
function Perforation({ x, y1, y2, h, color }: { x: number; y1: number; y2: number; h: number; color: string }) {
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth={0.55} strokeLinecap="round" strokeDasharray="0 1.5" />
      <circle cx={x} cy={3.4} r={0.95} fill="none" stroke={color} strokeWidth={0.3} />
      <circle cx={x} cy={h - 3.4} r={0.95} fill="none" stroke={color} strokeWidth={0.3} />
    </g>
  );
}

/** Microtext running up the perforation: the venue and the tag, repeated `len` mm. */
function Micro({ x, y, len, tag, color }: { x: number; y: number; len: number; tag: string; color: string }) {
  const unit = `${ORG} · ZONE-III · ${tagText(tag)} · `;
  const n = Math.max(1, Math.floor(len / widthOf(unit, A6, 0.75)));
  const t = unit.repeat(n).trim().replace(/·$/, '').trim();
  /* about 0.75 mm capitals, sized to run the whole length */
  const cap = Math.min(0.9, 0.75 * len / widthOf(t, A6, 0.75));
  return (
    <g transform={`rotate(-90 ${mm(x)} ${mm(y)})`}>
      <T t={t} f={A6} cap={cap} x={x} y={y} max={len} fill={color} />
    </g>
  );
}

/** An outlined pill around the tag ("NOV – 2026"), centred on (x, cy). */
function TagPill({ t, x, cy, cap, color, line }: { t: string; x: number; cy: number; cap: number; color: string; line: number }) {
  if (!t.trim()) return null;
  const h = cap * 2.3;
  const w = widthOf(t, A7, cap, caps(cap)) + h * 1.1;
  return (
    <g>
      <rect x={x - w / 2} y={cy - h / 2} width={w} height={h} rx={h / 2} fill="none" stroke={color} strokeWidth={line + 0.1} />
      <T t={t} f={A7} cap={cap} x={x} y={cy + cap / 2} align="middle" track={caps(cap)} fill={color} />
    </g>
  );
}

/** The signature image over a black rule (`y`), "Authorised Signatory" under it. */
function SignOff({ href, x0, x1, y, h, cap }: { href: string; x0: number; x1: number; y: number; h: number; cap: number }) {
  return (
    <g>
      {href && <image href={href} x={x0} y={y - h - 0.2} width={x1 - x0} height={h} preserveAspectRatio="xMidYMax meet" />}
      <rect x={x0} y={y - 0.09} width={x1 - x0} height={0.18} fill="#000" />
      <T t="AUTHORISED SIGNATORY" f={A6} cap={cap} x={(x0 + x1) / 2} y={y + cap + 1.1} align="middle" track={caps(cap)} fill={GREY} max={x1 - x0} />
    </g>
  );
}

const LABEL: Partial<Record<Field, string>> = {
  name: 'NAME', dept: 'DEPT.', area: 'AREA', phone: 'PHONE', vehicle: 'VEHICLE', vehicle_no: 'REG. NO.',
};

/**
 * Fields as a ruled form: a small tracked label above each value, the value on a fine black rule.
 * Values in a column share one size (shrinking to fit, not below 80 %; past that only the long one shrinks).
 * Reg. No. and phone are in Martian Mono.
 */
function Fields({ p, rows, x0, x1, ys, label, value, gutter, split }: {
  p: CardProps['p']; rows: Row[]; x0: number; x1: number; ys: number[]; label: number; value: number; gutter: number; split: number[][];
}) {
  const fontOf = (k: Field) => (k === 'phone' || k === 'vehicle_no' ? MONO : A6);
  const cells = rows.flatMap((row, i) => {
    const room = x1 - x0 - gutter * (row.length - 1);
    const shares = split[i];
    return row.map((k, j) => {
      const cx = x0 + shares.slice(0, j).reduce((a, b) => a + b * room + gutter, 0);
      return { k, j, y: ys[i], cx, end: cx + shares[j] * room, v: upper(p[k]) };
    });
  });
  const cols = Math.max(...rows.map((r) => r.length));
  const capOf = Array.from({ length: cols }, (_, j) => Math.max(value * 0.8, Math.min(value, ...cells.filter((c) => c.j === j && c.v)
    .map((c) => value * (c.end - c.cx - 0.3) / widthOf(c.v, fontOf(c.k), value)))));
  const ruleY = (y: number) => y + Math.max(0.8, value * 0.32);
  return (
    <g>
      {cells.map(({ k, j, y, cx, end, v }) => (
        <g key={k}>
          <T t={LABEL[k] ?? k} f={A7} cap={label} x={cx} y={y - value - label * 0.9} track={caps(label)} fill={GREY} />
          <rect x={cx} y={ruleY(y) - 0.08} width={end - cx} height={0.16} fill="#000" />
          {v && <T t={v} f={fontOf(k)} cap={fontOf(k) === A6 ? capOf[j] : Math.min(capOf[j], value * 0.86)} x={cx} y={y} max={end - cx - 0.3} />}
        </g>
      ))}
    </g>
  );
}

/** 150 × 100 mm; the stub is the right 40 mm. */
export function TicketVehicle({ p, texts, code }: CardProps) {
  const { w, h } = CARD_SIZE.vehicle;
  const { color, line } = inkOf(p.type);
  const x = 110;
  const mid = 126.5;
  return (
    <>
      <rect width={w} height={h} fill={WHITE} />
      <Masthead x={7} y={7} w={11} cap={3.8} max={82} sub="Zone-III" subCap={1.9} />
      <T t="VEHICLE PASS" f={A7} cap={2} x={7} y={29.6} track={caps(2)} fill={GREY} />
      <T t={kindOf(p.type)} f={C900} cap={10.34} scale={0.87} x={7} y={44.2} max={97} fill={color} />
      <Fields p={p} rows={VEHICLE_ROWS} x0={7} x1={104} ys={[59, 71.5, 84]} label={1.7} value={3.6} gutter={6}
        split={[[1], [0.56, 0.44], [0.56, 0.44]]} />
      <Micro x={x - 1.8} y={93.6} len={87.2} tag={texts.tag} color={color} />
      <Perforation x={x} y1={6.4} y2={93.6} h={h} color={color} />
      {code && <Qr text={code} x={mid - 10} y={8} size={20} pad={0} />}
      <T t="SR. NO." f={A7} cap={1.6} x={mid} y={38.24} align="middle" track={caps(1.6)} fill={GREY} />
      <T t={serialText(p.serial, 3)} f={BIG} cap={10.6} scale={1.257} x={mid} y={52} align="middle" max={25} />
      <TagPill t={tagText(texts.tag)} x={mid} cy={58.6} cap={1.8} color={color} line={line} />
      <SignOff href={texts.signature} x0={114} x1={139} y={88} h={9} cap={1.2} />
    </>
  );
}
