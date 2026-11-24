'use client';
import { type Field, layoutOf, RTB3_BAND, TYPE_INFO } from '@/shared/types';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import {
  BIG, C700, C800, C900, Dup, GREY, kindOf, LEGIBLE, mm, type Row, S600, S700, serialText, T, upper, WHITE, widthOf,
} from './v2kit';
import { HEAVY, KindWord, kindCap, ORG_LOGO, OrgHead, plateCap, REG, RegPlate } from './Modern';
import { drawHeight, GH, stretchY, VW } from './vehicleBox';

/**
 * Design v2 "Rail" (round 6 A, Rozha masthead), the Admin and Gate 1 & 11 Entry (BAV Parking) passes: thin colour bars at the top and bottom
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

/** How long Pill draws `t`, `h` tall with `cap` letters. */
const pillWidth = (t: string, h: number, cap: number) => (t.trim() ? widthOf(upper(t), C800, cap, cap * 0.08) + h * 1.1 : 0);

/** A solid rounded pill with white text, `h` tall, centred on `cy`, ending at `x`. */
function Pill({ t, x, cy, h, cap, color }: { t: string; x: number; cy: number; h: number; cap: number; color: string }) {
  if (!t.trim()) return null;
  const text = upper(t);
  const track = cap * 0.08;
  const w = pillWidth(t, h, cap);
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

/** Gate 1 & 11 Entry: Name, then Area and Dept. (no Vehicle since 2026-11-23, the owner); Behind RTB 3: Name only, under a NAAMDAAN band. The Reg. No. in its plate (RegPlate). */
const PLATE_ROWS: Row[] = [['name'], ['area', 'dept']];
/** Admin: Name and Vehicle, no Area or Dept. (the owner, 2026-11-15); the Reg. No. in its plate too. */
const ADMIN_ROWS: Row[] = [['name'], ['vehicle']];

const LABEL: Partial<Record<Field, string>> = {
  name: 'Name', dept: 'Dept.', area: 'Area', phone: 'Phone', vehicle: 'Vehicle', vehicle_no: 'Reg. No.',
};

/**
 * Rows of fields (label at the left, value on a colour line); a row of two splits the width with 6 mm between. `ys`: each row's line.
 * `above`: each label small over its value instead, the value and its line taking the whole width (Gate 1 & 11, the owner, 2026-11-23).
 */
function Fields({ p, rows, ys, x0, x1, lw, cap, color, above = false }: {
  p: CardProps['p']; rows: Row[]; ys: number[]; x0: number; x1: number; lw: number; cap: number; color: string; above?: boolean;
}) {
  const gap = 6;
  return (
    <g>
      {rows.map((row, i) => {
        const w = (x1 - x0 - gap * (row.length - 1)) / row.length;
        return row.map((k, j) => {
          const x = x0 + j * (w + gap);
          const r0 = above ? x : x + lw;
          const y = ys[i];
          /** The value's baseline; with `above`, the label's sits 1.3 mm over the value's capitals. */
          const vy = y - Math.max(0.8, cap * 0.24);
          return (
            <g key={k}>
              <Caption t={LABEL[k] ?? k} at={[mm(x + (LABEL_AT[k]?.[0] ?? 0)), above ? mm(vy - cap - 1.3) : y - 0.45, 2.625, LABEL_AT[k]?.[1] ?? 6]} />
              <rect x={r0} y={y} width={mm(x + w - r0)} height={0.2} fill={color} />
              <T t={upper(p[k])} f={k === 'phone' || k === 'vehicle_no' ? LEGIBLE : C700} cap={cap} x={above ? r0 : r0 + 0.9}
                y={vy} max={x + w - r0 - 1.4} />
            </g>
          );
        });
      })}
    </g>
  );
}

/**
 * The parking sign of Gate 1 & 11 Entry passes, `size` mm square at (x, y): a white "P" on a white-edged
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

/**
 * Gate 1 & 11 passes print two lines of one size and colour where other passes print the kind word: the gate,
 * ENTRY GATE NO. 1 & 11 (was GATE 1 & 11 ENTRY), then where to park, BAV PARKING or, with Behind RTB 3 ticked,
 * PARKING BEHIND RTB 3, laid out apart (RailVehicle) with no parking sign (the owner, 2026-11-23).
 */
const BAV_GATE = 'ENTRY GATE NO. 1 & 11';
const RTB3 = 'PARKING BEHIND RTB 3';
const bavLines = (p: CardProps['p']) => [BAV_GATE, p.meta?.rtb3 ? RTB3 : 'BAV PARKING'];

/** The two lines' cap height: up to `cap`, each line fitting `max`; the same for both places to park. */
const twoLinesCap = (cap: number, max: number) =>
  Math.min(cap, ...[BAV_GATE, 'BAV PARKING', RTB3].map((l) => cap * (max / widthOf(l, C900, cap))));

/** The two lines at cap height `c`, 1.3 × c apart; `y`: the last line's baseline. Their ink is 2.3 × c tall. */
function TwoLines({ lines, x, y, c, max, color }: { lines: string[]; x: number; y: number; c: number; max: number; color: string }) {
  return <g>{lines.map((l, i) => <T key={l} t={l} f={C900} cap={c} x={x} y={y - (lines.length - 1 - i) * c * 1.3} max={max} fill={color} />)}</g>;
}

/**
 * 151 × 103 mm, drawn on 150 × GH (vehicleBox.ts; laid out on 150 × 100, the y's through Y). Gate 1 & 11
 * Entry: the parking sign and two lines instead of "VEHICLE PASS" over the kind word. Admin: "VEHICLE PASS"
 * larger, from the left margin like the logo and fields; the kind word taller but narrower (80 %), centred on the pass, as on
 * Sewa Vehicle (the owner, 2026-11-15).
 */
export function RailVehicle({ p, texts, code }: CardProps) {
  const c = p.type === 'bav-entry' && p.meta?.rtb3 ? RTB3_BAND : TYPE_INFO[p.type].color.band;
  const [w, h] = [VW, GH];
  const Y = stretchY(5, 96.5, GH);
  const bav = p.type === 'bav-entry';
  const rtb3 = bav && !!p.meta?.rtb3;
  /** Gate 1 & 11 Entry: the two lines' cap height, and the parking sign as tall as they are (cap top of the first to the baseline of the second). */
  const bc = bav ? twoLinesCap(6.2, 118) : 0;
  const kindWord = p.type === 'admin' ? 'ADMINISTRATION' : kindOf(p.type);
  /**
   * Behind RTB 3 (the owner, 2026-11-23: "ENTRY then NAAMDAAN then PARKING in center", the month elsewhere "and center it",
   * "improve it further"): ENTRY GATE NO. 1 & 11, the NAAMDAAN band, PARKING BEHIND RTB 3, then the Name. The two lines
   * centred in NAAMDAAN's type, Atkinson 800, each as large as makes it 116 wide, so they square up as a block; NAAMDAAN 7.2
   * tall, larger than they are, on a band 1.7 × that. Within the block, gaps 0.7 × those around it (the QR code's foot to the
   * first line, the second line to the Name, the Name's line to the plate's top); the Name row is 11.4 tall, its label's top
   * to its line (Fields: 2.6 label, 1.3, 6 value, 1.44). The month moves up beside Zone-III, in its type, no colour
   * ("no color"), a thin rule between them.
   */
  const fit = (t: string) => (10 * 116) / widthOf(t, HEAVY, 10);
  const [gc, pc, nc] = [fit(BAV_GATE), fit(RTB3), 7.2];
  const band = 1.7 * nc;
  const top = Y(8.5) + 15;
  const inner = (Y(80) - top - gc - band - pc - 11.4) / (2 + 3 / 0.7);
  const gap = inner / 0.7;
  const gateBase = top + gap + gc;
  const parkBase = gateBase + inner + band + inner + pc;
  /** Zone-III's start, baseline and end in OrgHead; the month 4.4 after it on that line, a rule midway. */
  const zone = { x: 6 + ORG_LOGO.w + 3.2, y: 7 + 12.6, end: 6 + ORG_LOGO.w + 3.2 + widthOf('Zone-III', REG, 2.6) };
  const nameLine = rtb3 ? Y(80) - gap : Y(59);
  return (
    <>
      <rect width={w} height={h} fill={WHITE} />
      {/* Behind RTB 3: no bars top and bottom (the owner, 2026-11-23). */}
      {!rtb3 && <rect width={w} height={4.5} fill={c} />}
      {!rtb3 && <rect y={h - 3.5} width={w} height={3.5} fill={c} />}
      <OrgHead x={6} y={7} max={129 - 4 - (6 + ORG_LOGO.w + 3.2)} />
      {code && <Qr text={code} x={129} y={Y(8.5)} size={15} pad={0} />}
      {bav
        ? !rtb3 && <ParkingTile x={6} y={Y(42.4) - 2.3 * bc} size={2.3 * bc} color={c} />
        : <Caption t="VEHICLE PASS" at={[6, Y(29.4), 3.4, 25.95 * (3.4 / 2.5)]} weight={S700} tracked />}
      {rtb3 ? texts.tag.trim() && (
        <>
          <rect x={zone.end + 2.1} y={zone.y - 2.9} width={0.2} height={3.2} fill={GREY} />
          <T t={upper(texts.tag)} f={REG} cap={2.6} x={zone.end + 4.4} y={zone.y} />
        </>
      ) : <Pill t={texts.tag} x={144} cy={Y(28.4)} h={4.6} cap={2.3} color={c} />}
      {rtb3 && <T t={BAV_GATE} f={HEAVY} cap={gc} x={VW / 2} y={gateBase} align="middle" max={138} fill={c} />}
      {rtb3 && <T t={RTB3} f={HEAVY} cap={pc} x={VW / 2} y={parkBase} align="middle" max={138} fill={c} />}
      {bav
        ? !rtb3 && <TwoLines lines={bavLines(p)} x={25.3} y={Y(42.4)} c={bc} max={118} color={c} />
        /* Admin: ADMINISTRATION in Atkinson 800, a little extra letter space, as large as fits the pass (the owner, 2026-11-16; was Roboto Condensed). */
        : <KindWord t={kindWord} cap={kindCap([kindWord], 12, 138)} x={VW / 2} y={Y(45)} max={138} fill={c} />}
      {/* lw 11 (was 16): the values start closer to their labels (owner, 2026-11-15: "reduce gap"). */}
      {/* Admin: two rows, so the values larger (5.6, was 4.2; the owner, 2026-11-15). */}
      {/* Gate 1 & 11: each label over its value, two rows, so the values larger (6, was 4.2; the owner, 2026-11-23). */}
      {/* Behind RTB 3: no Area or Dept.; NAAMDAAN (so spelt, whatever the Dept. says) white on a band of the pass colour edge to edge, as FERRY SEWA on Gate 3 Hospital, above the Name (the owner, 2026-11-23). */}
      <Fields p={p} rows={bav ? (rtb3 ? [['name']] : PLATE_ROWS) : ADMIN_ROWS} ys={bav ? [nameLine, Y(73.5)] : [Y(57.5), Y(70)]} x0={6} x1={144} lw={11}
        cap={bav ? 6 : 5.6} color={c} above={bav} />
      {rtb3 && <WordBand t="NAAMDAAN" cap={nc} mid={gateBase + inner + band / 2} color={c} h={band} />}
      <Caption t="Sr. No." at={[5.938, Y(83.6), 2.5, 7.637]} />
      <Dup p={p} x={5.938 + 7.637 + 1.6} y={Y(83.6) - 0.4} cap={1.6} />
      <T t={serialText(p.serial, 3)} f={BIG} cap={9} scale={1.075} x={5.76} y={Y(93.4)} max={30} />
      {/* The Reg. No. large in a plate centred on the pass, the signature 30 wide (was 34) to make room; Admin's 16 tall, Gate 1 & 11's 11.5, just under its Area / Dept. line (8.4 before; the owner, 2026-11-18). */}
      <RegPlate v={p.vehicle_no} x0={VW / 2 - 34} x1={VW / 2 + 34} top={Y(80)} bottom={Y(94)} />
      <SignOff href={texts.signature} x0={114} x1={144} y={Y(88.6)} h={bav ? 11.5 : 16} line={c} />
    </>
  );
}

/** Gate 3 Hospital's title in two lines, as Gate 1 & 11's, and their cap height (the pass is wider: larger). */
const HOSPITAL_LINES = ['ENTRY GATE NO. 3', 'HOSPITAL'];
const HOSPITAL_CAP = 8;

/** The Gate 3 sign of Gate 3 Hospital passes, `size` mm square at (x, y): a "3" on a white disc, on a tile of the pass colour (design round 2). */
function GateTile({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  const pad = size * 0.1;
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={mm(size * 0.12)} fill={color} />
      <g transform={`translate(${x + pad} ${y + pad}) scale(${(size - 2 * pad) / 24})`}>
        <circle cx={12} cy={12} r={11.5} fill={WHITE} />
        <text x={12} y={18.3} fontSize={17.5} textAnchor="middle" style={{ fontFamily: LEGIBLE.family, fontWeight: 800 }} fill={color}>3</text>
      </g>
    </g>
  );
}

/** SEWA VEHICLE's cap height on the Sewa Vehicle pass (BandKind in Modern.tsx: x 7 to 143, Y(29.4) to Y(48.4)), in the 150-wide drawing. */
const YV = stretchY(5, 96, drawHeight('vehicle'));
const SEWA_VEHICLE_CAP = kindCap(['SEWA VEHICLE'], Math.min(11, (YV(48.4) - YV(29.4)) / 1.9), 143 - 7);

const FERRY = 'FERRY SEWA';
/**
 * FERRY SEWA's cap height: as SEWA VEHICLE's, the Ferry Sewa pass being 204 × 145 like Sewa Vehicle (layoutOf), fitting 4.5 from
 * each edge; its band (FerryBand) is 1.9 × that tall, as SEWA VEHICLE's.
 */
const FERRY_CAP = kindCap([FERRY], SEWA_VEHICLE_CAP, VW - 9);

/**
 * FERRY SEWA as SEWA VEHICLE prints on the Sewa Vehicle pass: white on a band of the pass colour edge to edge, the same
 * type, size and band (the owner, 2026-11-23: "same size as SEWA VEHICLE"), from `top` to `bottom`.
 */
function FerryBand({ top, bottom, color }: { top: number; bottom: number; color: string }) {
  return <WordBand t={FERRY} cap={FERRY_CAP} mid={(top + bottom) / 2} color={color} />;
}

/** A word in white, `cap` tall, on a band of `color` edge to edge, `h` (1.9 × `cap`) tall, centred on `mid`; the word fits 4.5 from each edge. */
function WordBand({ t, cap, mid, color, h = 1.9 * cap }: { t: string; cap: number; mid: number; color: string; h?: number }) {
  const c = kindCap([t], cap, VW - 9);
  const half = h / 2;
  return (
    <g>
      <rect y={mm(mid - half)} width={VW} height={mm(2 * half)} fill={color} />
      <KindWord t={t} cap={c} x={VW / 2} y={mid + c / 2} max={VW - 9} fill={WHITE} />
    </g>
  );
}

/**
 * Ferry Sewa's foot, `top` to `bottom`, as Sewa Vehicle's and in its one typeface, Atkinson Hyperlegible Next (the owner, 2026-11-23:
 * "change font family, alignment"): the Sr. No. and the Reg. No. (in its plate, no label) the same size on one baseline, the
 * signature line on it too, "Sr. No." level with the plate's top. The plate 80 wide in the middle of the pass, as Sewa Vehicle's
 * (the owner, 2026-11-23: "this should be center of page"); the serial at the left, the signature at the right.
 */
function FerryFoot({ p, top, bottom, line }: { p: CardProps['p']; top: number; bottom: number; line: string }) {
  const [x0, sig] = [6, 121];
  const serial = serialText(p.serial, 3);
  const plate = { x0: VW / 2 - 40, x1: VW / 2 + 40 };
  // The serial as large as the Reg. No. in the plate, at most 9; a blank pass: sized for a usual Reg. No.
  const cap = plateCap(p.vehicle_no || 'HR-00XX-0000', plate.x0, plate.x1, top + 1.4, bottom - 1.4, 9);
  const base = (top + bottom) / 2 + cap / 2;
  return (
    <g>
      <T t="Sr. No." f={REG} cap={2.4} x={x0} y={top + 2.4} />
      <Dup p={p} x={x0 + widthOf('Sr. No.', REG, 2.4) + 1.6} y={top + 2.4} cap={1.6} />
      <T t={serial} f={HEAVY} cap={cap} scale={0.92} x={x0} y={base} />
      <RegPlate v={p.vehicle_no} x0={plate.x0} x1={plate.x1} top={top} bottom={bottom} label={0} most={cap} />
      <rect x={sig} y={base} width={mm(144 - sig)} height={0.18} fill={line} />
      <T t="Auth. Signatory" f={REG} cap={1.6} x={(sig + 144) / 2} y={base + 1.6 * 1.9} align="middle" />
    </g>
  );
}

/** Gate 3 Hospital: Name, and the Reg. No. on a row of its own (no Vehicle; the owner, 2026-11-22). */
const HOSPITAL_ROWS: Row[] = [['name'], ['vehicle_no']];

/**
 * Gate 3 Hospital (the owner, 2026-11-22): design round 2 A "Rail" as picked, with the RSSB logo and heading of the
 * other passes (OrgHead), in indigo. The Gate 3 sign beside VEHICLE PASS and the title; VEHICLE PASS joined to the tag by a rail. With Ferry Sewa
 * ticked: FERRY SEWA on a band under the title (FerryBand), the Name under it only if there is one, the serial, Reg. No. plate and signature in a row at the foot. The signature line and its label only, no signature image, as on the
 * other Gate 3 passes (2026-11-21). 151 × 103 mm; with Ferry Sewa 204 × 145 since 2026-11-23 (layoutOf), drawn 150 wide in the pass's shape.
 */
export function RailHospital({ p, texts, code }: CardProps) {
  const c = TYPE_INFO[p.type].color.band;
  const [w, h] = [VW, drawHeight(layoutOf(p))];
  const Y = stretchY(5, 96.5, h);
  const ferry = !!p.meta?.ferry;
  /**
   * Ferry Sewa: FERRY SEWA's band under the title, as SEWA VEHICLE's on Sewa Vehicle; the foot (FerryFoot) as far from it as from the
   * bottom edge. The Name under the band when there is one, and none when it is blank (the owner, 2026-11-23: "there's name for ferry
   * sewa as well, if not do not show the field"): in the middle with no label or line ("name can be in center, no need of label"), in
   * the foot's type; the band a little higher and the foot a little shorter to make room.
   */
  const named = ferry && !!p.name.trim();
  const band = { top: Y(42.4) + (named ? 3.5 : 6.5), bottom: Y(42.4) + (named ? 3.5 : 6.5) + 1.9 * FERRY_CAP };
  const nameY = band.bottom + 10.5;
  const gap = (h - band.bottom - 20) / 2;
  const foot = named ? { top: nameY + 4.5, bottom: h - 4 } : { top: band.bottom + gap, bottom: band.bottom + gap + 20 };
  /**
   * As on Gate 1 & 11 (the owner, 2026-11-23: "this can't be improved?"): the Gate 3 sign as tall as the two lines ENTRY GATE NO. 3 /
   * HOSPITAL beside it (cap top of the first to the baseline of the second), the tag at the right level with the first line; was
   * VEHICLE PASS and the tag on a rail over one long line.
   */
  const hc = HOSPITAL_CAP;
  const tile = 2.3 * hc;
  /** A strip of the pass colour down the left edge, 4 wide as Gate 3 - VIP's on the right (the owner, 2026-11-23: "add a left strip"); not with Ferry Sewa's band. */
  const strip = ferry ? 0 : 4;
  const x0 = 6 + strip;
  return (
    <>
      {/* No colour bars at the top and bottom edges (the owner, 2026-11-23: "remove top and bottom strip"). */}
      <rect width={w} height={h} fill={WHITE} />
      {strip > 0 && <rect width={strip} height={h} fill={c} />}
      <OrgHead x={x0} y={7} max={129 - 4 - (x0 + ORG_LOGO.w + 3.2)} />
      {code && <Qr text={code} x={129} y={Y(8.5)} size={15} pad={0} />}
      <GateTile x={x0} y={Y(42.4) - tile} size={tile} color={c} />
      <Pill t={texts.tag} x={144} cy={Y(42.4) - tile + hc / 2} h={4.6} cap={2.3} color={c} />
      <TwoLines lines={HOSPITAL_LINES} x={x0 + tile + 4} y={Y(42.4)} c={hc} max={144 - (x0 + tile + 4)} color={c} />
      {ferry ? (
        /* Ferry Sewa (the owner, 2026-11-23): the Name only if there is one; FERRY SEWA's band under the title ("move ferry sewa text to above sno, reg,
           sign"), then one row as on Sewa Vehicle: the Sr. No. large, the Reg. No. in its plate in the middle and the signature. */
        <>
          {named && <T t={upper(p.name)} f={HEAVY} cap={6} x={VW / 2} y={nameY} align="middle" max={138} />}
          <FerryFoot p={p} top={foot.top} bottom={foot.bottom} line={c} />
          <FerryBand top={band.top} bottom={band.bottom} color={c} />
        </>
      ) : (
        <>
          <Fields p={p} rows={HOSPITAL_ROWS} ys={[57.5, 70].map(Y)} x0={x0} x1={144} lw={13} cap={5.6} color={c} />
          <Caption t="Sr. No." at={[x0 - 0.062, Y(83.6), 2.5, 7.637]} />
          <Dup p={p} x={x0 - 0.062 + 7.637 + 1.6} y={Y(83.6) - 0.4} cap={1.6} />
          <T t={serialText(p.serial, 3)} f={BIG} cap={9} scale={1.075} x={x0 - 0.24} y={Y(93.4)} max={30} />
          <SignOff href="" x0={114} x1={144} y={Y(88.6)} h={0} line={c} />
        </>
      )}
    </>
  );
}
