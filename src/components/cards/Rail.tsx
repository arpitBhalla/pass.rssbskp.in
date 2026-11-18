'use client';
import { type Field, TYPE_INFO } from '@/shared/types';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import {
  BIG, C700, C800, C900, GREY, kindOf, LEGIBLE, mm, type Row, S600, S700, serialText, T, upper, WHITE, widthOf,
} from './v2kit';
import { KindWord, kindCap, ORG_LOGO, OrgHead, RegPlate } from './Modern';
import { GH, stretchY, VW } from './vehicleBox';

/**
 * Design v2 "Rail" (round 6 A, Rozha masthead), the Admin and Gate 1 & 12 Entry (BAV Parking) passes: thin colour bars at the top and bottom
 * edge (same colour on both, so passes printed edge to edge cut cleanly), the kind word in colour type,
 * the tag as a small solid pill. As picked (selected.html, 2026-11-14): the serial in Big Shoulders.
 */

/**
 * The fixed captions and labels, in Source Sans 3, at the size, width and spacing they had in the
 * design preview when the user picked this pass (the preview drew them in the system font: its name
 * for Source Sans 3 wasn't valid CSS). [x, y, font size, length], in mm; x is where the text starts.
 */
type Spot = [x: number, y: number, size: number, length: number];
function Caption({ t, at, weight = S600, tracked = false }: { t: string; at: Spot; weight?: typeof S600; tracked?: boolean }) {
  const [x, y, size, length] = at;
  return (
    <text x={x} y={y} fontSize={size} textLength={length} lengthAdjust={tracked ? 'spacing' : 'spacingAndGlyphs'}
      style={{ fontFamily: weight.family, fontWeight: weight.weight }} fill={GREY}>{t.replace(/ /g, '\u00a0')}</text>
  );
}
/** Field labels: start (from the cell's left edge) and length; all 2.625 mm type, 0.45 mm over the line. */
const LABEL_AT: Partial<Record<Field, [dx: number, length: number]>> = {
  name: [-0.139, 6.037], vehicle: [-0.013, 7.896], vehicle_no: [-0.14, 9.126], area: [-0.021, 4.934], dept: [-0.139, 5.632],
};

/** A solid rounded pill with white text, `h` tall, centred on `cy`, ending at `x`. */
function Pill({ t, x, cy, h, cap, color }: { t: string; x: number; cy: number; h: number; cap: number; color: string }) {
  if (!t.trim()) return null;
  const text = upper(t);
  const track = cap * 0.08;
  const w = widthOf(text, C800, cap, track) + h * 1.1;
  const x0 = x - w;
  return (
    <g>
      <rect x={mm(x0)} y={mm(cy - h / 2)} width={mm(w)} height={mm(h)} rx={mm(h / 2)} fill={color} />
      <T t={text} f={C800} cap={cap} x={x0 + w / 2} y={cy + cap / 2} align="middle" track={track} fill={WHITE} />
    </g>
  );
}

/** The signature image over its line, "Auth. Signatory" under it. `y`: the line. */
function SignOff({ href, x0, x1, y, h, line }: { href: string; x0: number; x1: number; y: number; h: number; line: string }) {
  return (
    <g>
      {href && <image href={href} x={x0} y={y - h - 0.3} width={x1 - x0} height={h} preserveAspectRatio="xMidYMax meet" />}
      <rect x={x0} y={y} width={mm(x1 - x0)} height={0.18} fill={line} />
      <Caption t="Auth. Signatory" at={[119.538, y + 3.2, 2.375, 14.92]} />
    </g>
  );
}

/** Gate 1 & 12 Entry: Vehicle on a row of its own, the Reg. No. in its plate (RegPlate). */
const PLATE_ROWS: Row[] = [['name'], ['vehicle'], ['area', 'dept']];
/** Admin: Name and Vehicle, no Area or Dept. (the owner, 2026-11-15); the Reg. No. in its plate too. */
const ADMIN_ROWS: Row[] = [['name'], ['vehicle']];

const LABEL: Partial<Record<Field, string>> = {
  name: 'Name', dept: 'Dept.', area: 'Area', phone: 'Phone', vehicle: 'Vehicle', vehicle_no: 'Reg. No.',
};

/** Rows of fields (label at the left, value on a colour line); a row of two splits the width with 6 mm between. `ys`: each row's line. */
function Fields({ p, rows, ys, x0, x1, lw, cap, color }: {
  p: CardProps['p']; rows: Row[]; ys: number[]; x0: number; x1: number; lw: number; cap: number; color: string;
}) {
  const gap = 6;
  return (
    <g>
      {rows.map((row, i) => {
        const w = (x1 - x0 - gap * (row.length - 1)) / row.length;
        return row.map((k, j) => {
          const x = x0 + j * (w + gap);
          const r0 = x + lw;
          const y = ys[i];
          return (
            <g key={k}>
              <Caption t={LABEL[k] ?? k} at={[mm(x + (LABEL_AT[k]?.[0] ?? 0)), y - 0.45, 2.625, LABEL_AT[k]?.[1] ?? 6]} />
              <rect x={r0} y={y} width={mm(x + w - r0)} height={0.2} fill={color} />
              <T t={upper(p[k])} f={k === 'phone' || k === 'vehicle_no' ? LEGIBLE : C700} cap={cap} x={r0 + 0.9}
                y={y - Math.max(0.8, cap * 0.24)} max={x + w - r0 - 1.4} />
            </g>
          );
        });
      })}
    </g>
  );
}

/**
 * The parking sign of Gate 1 & 12 Entry passes, `size` mm square at (x, y): a white "P" on a white-edged
 * tile of the pass colour, drawn in a 24-unit box as in the preview.
 */
function ParkingTile({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  const pad = size * 0.1;
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={mm(size * 0.12)} fill={color} />
      <g transform={`translate(${x + pad} ${y + pad}) scale(${(size - 2 * pad) / 24})`}>
        <rect x={0.5} y={0.5} width={23} height={23} rx={3.2} fill={WHITE} />
        <text x={12.6} y={19.2} fontSize={21} textAnchor="middle" style={{ fontFamily: LEGIBLE.family, fontWeight: 800 }} fill={color}>P</text>
      </g>
    </g>
  );
}

/** Gate 1 & 12 Entry passes print two lines of one size and colour where other passes print the kind word. */
const BAV_LINES = ['GATE 1 & 12 ENTRY', 'BAV PARKING'];

/** The two lines' cap height: up to `cap`, each line fitting `max`. */
const twoLinesCap = (cap: number, max: number) => Math.min(cap, ...BAV_LINES.map((l) => cap * (max / widthOf(l, C900, cap))));

/** The two lines at cap height `c`, 1.3 × c apart; `y`: the last line's baseline. Their ink is 2.3 × c tall. */
function TwoLines({ x, y, c, max, color }: { x: number; y: number; c: number; max: number; color: string }) {
  return <g>{BAV_LINES.map((l, i) => <T key={l} t={l} f={C900} cap={c} x={x} y={y - (BAV_LINES.length - 1 - i) * c * 1.3} max={max} fill={color} />)}</g>;
}

/**
 * 151 × 103 mm, drawn on 150 × GH (vehicleBox.ts; laid out on 150 × 100, the y's through Y). Gate 1 & 12
 * Entry: the parking sign and two lines instead of "VEHICLE PASS" over the kind word. Admin: "VEHICLE PASS"
 * larger, from the left margin like the logo and fields; the kind word taller but narrower (80 %), centred on the pass, as on
 * Sewa Vehicle (the owner, 2026-11-15).
 */
export function RailVehicle({ p, texts, code }: CardProps) {
  const c = TYPE_INFO[p.type].color.band;
  const [w, h] = [VW, GH];
  const Y = stretchY(5, 96.5, GH);
  const bav = p.type === 'bav-entry';
  /** Gate 1 & 12 Entry: the two lines' cap height, and the parking sign as tall as they are (cap top of the first to the baseline of the second). */
  const bc = bav ? twoLinesCap(6.2, 118) : 0;
  const kindWord = p.type === 'admin' ? 'ADMINISTRATION' : kindOf(p.type);
  return (
    <>
      <rect width={w} height={h} fill={WHITE} />
      <rect width={w} height={4.5} fill={c} />
      <rect y={h - 3.5} width={w} height={3.5} fill={c} />
      <OrgHead x={6} y={7} max={129 - 4 - (6 + ORG_LOGO.w + 3.2)} />
      {code && <Qr text={code} x={129} y={Y(8.5)} size={15} pad={0} />}
      {bav
        ? <ParkingTile x={6} y={Y(42.4) - 2.3 * bc} size={2.3 * bc} color={c} />
        : <Caption t="VEHICLE PASS" at={[6, Y(29.4), 3.4, 25.95 * (3.4 / 2.5)]} weight={S700} tracked />}
      <Pill t={texts.tag} x={144} cy={Y(28.4)} h={4.6} cap={2.3} color={c} />
      {bav
        ? <TwoLines x={25.3} y={Y(42.4)} c={bc} max={118} color={c} />
        /* Admin: ADMINISTRATION in Atkinson 800, a little extra letter space, as large as fits the pass (the owner, 2026-11-16; was Roboto Condensed). */
        : <KindWord t={kindWord} cap={kindCap([kindWord], 12, 138)} x={VW / 2} y={Y(45)} max={138} fill={c} />}
      {/* lw 11 (was 16): the values start closer to their labels (owner, 2026-11-15: "reduce gap"). */}
      {/* Admin: two rows, so the values larger (5.6, was 4.2; the owner, 2026-11-15). */}
      <Fields p={p} rows={bav ? PLATE_ROWS : ADMIN_ROWS} ys={(bav ? [54.5, 65, 75.5] : [57.5, 70]).map(Y)} x0={6} x1={144} lw={11}
        cap={bav ? 4.2 : 5.6} color={c} />
      <Caption t="Sr. No." at={[5.938, Y(83.6), 2.5, 7.637]} />
      <T t={serialText(p.serial, 3)} f={BIG} cap={9} scale={1.075} x={5.76} y={Y(93.4)} max={30} />
      {/* The Reg. No. large in a plate centred on the pass, the signature 30 wide (was 34) to make room; Admin's 16 tall (the owner, 2026-11-18). */}
      <RegPlate v={p.vehicle_no} x0={VW / 2 - 34} x1={VW / 2 + 34} top={Y(80)} bottom={Y(94)} />
      <SignOff href={texts.signature} x0={114} x1={144} y={Y(88.6)} h={bav ? 8.4 : 16} line={c} />
    </>
  );
}
