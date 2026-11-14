'use client';
import { CARD_SIZE } from '@/lib/sheets';
import { type Field, TYPE_INFO } from '@/shared/types';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import {
  BIG, C700, C800, C900, GREY, kindOf, LEGIBLE, mm, Monogram, ORG, ROZHA, S600, S700, serialText, T, upper, VEHICLE_ROWS, WHITE, widthOf,
} from './v2kit';

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
      <Caption t="Auth. Signatory" at={[119.538, 91.8, 2.375, 14.92]} />
    </g>
  );
}

const LABEL: Partial<Record<Field, string>> = {
  name: 'Name', dept: 'Dept.', area: 'Area', phone: 'Phone', vehicle: 'Vehicle', vehicle_no: 'Reg. No.',
};

/** Rows of fields (label at the left, value on a colour line); a row of two splits the width with 6 mm between. `ys`: each row's line. */
function Fields({ p, ys, x0, x1, lw, cap, color }: {
  p: CardProps['p']; ys: number[]; x0: number; x1: number; lw: number; cap: number; color: string;
}) {
  const gap = 6;
  return (
    <g>
      {VEHICLE_ROWS.map((row, i) => {
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

/** The two lines at one cap height (up to `cap`, each fitting `max`), 1.3 × cap apart; `y`: the last line's baseline. */
function TwoLines({ x, y, cap, max, color }: { x: number; y: number; cap: number; max: number; color: string }) {
  const c = Math.min(cap, ...BAV_LINES.map((l) => cap * (max / widthOf(l, C900, cap))));
  return <g>{BAV_LINES.map((l, i) => <T key={l} t={l} f={C900} cap={c} x={x} y={y - (BAV_LINES.length - 1 - i) * c * 1.3} max={max} fill={color} />)}</g>;
}

/** 150 × 100 mm. Gate 1 & 12 Entry: the parking sign and two lines instead of "VEHICLE PASS" over the kind word. */
export function RailVehicle({ p, texts, code }: CardProps) {
  const c = TYPE_INFO[p.type].color.band;
  const { w, h } = CARD_SIZE.vehicle;
  const bav = p.type === 'bav-entry';
  return (
    <>
      <rect width={w} height={h} fill={WHITE} />
      <rect width={w} height={4.5} fill={c} />
      <rect y={h - 3.5} width={w} height={3.5} fill={c} />
      <Monogram x={6} y={8.6} w={10.5} />
      <T t={ORG} f={ROZHA} cap={4} x={20.5} y={14} max={100} />
      <Caption t="ZONE-III" at={[20.27, 19.6, 2.5, 17.15]} tracked />
      {code && <Qr text={code} x={129} y={8.5} size={15} pad={0} />}
      {bav
        ? <ParkingTile x={6} y={26.5} size={16} color={c} />
        : <Caption t="VEHICLE PASS" at={[25.507, 29.4, 2.5, 25.95]} weight={S700} tracked />}
      <Pill t={texts.tag} x={144} cy={28.4} h={4.6} cap={2.3} color={c} />
      {bav
        ? <TwoLines x={25.3} y={42.4} cap={6.2} max={118} color={c} />
        : <T t={kindOf(p.type)} f={C900} cap={10.5} x={25.3} y={42.4} max={118} fill={c} />}
      <Fields p={p} ys={[54.5, 65, 75.5]} x0={6} x1={144} lw={16} cap={4.2} color={c} />
      <Caption t="Sr. No." at={[5.938, 83.6, 2.5, 7.637]} />
      <T t={serialText(p.serial, 3)} f={BIG} cap={9} scale={1.075} x={5.76} y={93.4} max={30} />
      <SignOff href={texts.signature} x0={110} x1={144} y={88.6} h={8.4} line={c} />
    </>
  );
}
