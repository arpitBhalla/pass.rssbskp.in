'use client';
import { type Field, type PassType, TYPE_INFO } from '@/shared/types';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import {
  A6, A7, BIG, GREY, kindOf, MONO, type Row, serialText, T, tagText, upper, WHITE, widthOf,
} from './v2kit';
import { KindWord, kindCap, ORG_LOGO, OrgHead, RegPlate } from './Modern';
import { GH, stretchY, VW } from './vehicleBox';

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

/** Name and Vehicle only, as on Gate 3 Entry (the owner, 2026-11-15); the Reg. No. prints in its plate (RegPlate). */
const PLATE_ROWS: Row[] = [['name'], ['vehicle']];

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

/** 151 × 103 mm, drawn on 150 × GH (vehicleBox.ts; laid out on 150 × 100, the y's through Y); the stub is the right 40. */
export function TicketVehicle({ p, texts, code }: CardProps) {
  const [w, h] = [VW, GH];
  const Y = stretchY(6.4, 93.6, GH);
  const { color, line } = inkOf(p.type);
  const x = 110;
  /** A strip of the pass colour down the right edge, 4 wide (the owner, 2026-11-15); the stub's things centred in what is left. */
  const strip = 4;
  const mid = (x + w - strip) / 2;
  return (
    <>
      <rect width={w} height={h} fill={WHITE} />
      <rect x={w - strip} width={strip} height={h} fill={color} />
      <OrgHead x={7} y={7} max={x - 3 - (7 + ORG_LOGO.w + 3.2)} />
      <T t="VEHICLE PASS" f={A7} cap={2} x={7} y={Y(29.6)} track={caps(2)} fill={GREY} />
      {/* GATE 3 ENTRY in Atkinson 800, a little extra letter space, as large as fits before the stub (the owner, 2026-11-16; was Roboto Condensed). */}
      <KindWord t={kindOf(p.type)} cap={kindCap([kindOf(p.type)], 10.34, 99)} x={7} y={Y(44.2)} max={99} align="start" fill={color} />
      {/* Name and Vehicle (no Area or Dept.); the Reg. No. large in a plate centred under them. */}
      <Fields p={p} rows={PLATE_ROWS} x0={7} x1={104} ys={[59, 72].map(Y)} label={1.9} value={4.4} gutter={6}
        split={[[1], [1]]} />
      <RegPlate v={p.vehicle_no} x0={55.5 - 38} x1={55.5 + 38} top={Y(80)} bottom={Y(93.6)} />
      <Perforation x={x} y1={Y(6.4)} y2={Y(93.6)} h={h} color={color} />
      {code && <Qr text={code} x={mid - 10} y={Y(8)} size={20} pad={0} />}
      <T t="SR. NO." f={A7} cap={1.6} x={mid} y={Y(38.24)} align="middle" track={caps(1.6)} fill={GREY} />
      <T t={serialText(p.serial, 3)} f={BIG} cap={10.6} scale={1.257} x={mid} y={Y(52)} align="middle" max={25} />
      <TagPill t={tagText(texts.tag)} x={mid} cy={Y(58.6)} cap={1.8} color={color} line={line} />
      {/* The signature larger, 18 tall on a 30 line (9 on 25 before; the owner, 2026-11-18). */}
      <SignOff href={texts.signature} x0={mid - 15} x1={mid + 15} y={Y(88)} h={18} cap={1.2} />
    </>
  );
}
