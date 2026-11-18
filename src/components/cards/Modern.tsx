import type { Font } from '@/client/measure';
import { legible } from '@/fonts';
import type { CardData } from '@/lib/passes';
import { type Field, TYPE_INFO } from '@/shared/types';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import { RssbLogo } from './rssbLogo';
import { T, widthOf } from './v2kit';
import { drawHeight, stretchY, VW } from './vehicleBox';

/**
 * Design round 11 "Modern & simple" (../passes-design-v2/cards/r11-modern), the owner's pick on
 * 2026-11-15 for two passes: Sewa Vehicle in its `band` style (the kind word white on a colour band,
 * edge to edge; shown on the design site as R12 · Colour band) and Tractor Trolley in its `plain` style
 * (the kind word in the colour over a colour rule; shown as R13 · Headings · masthead). One typeface,
 * Atkinson Hyperlegible Next, in three weights; labels small in sentence case, values bold capitals.
 * Changed from the design at the owner's ask: the real RSSB logo, larger, for the RS/SB mark (the name
 * and zone beside it larger to match), and "Vehicle pass" and the month larger, a smaller QR code, the Reg. no.
 * large in a plate centred between the Sr. no. and a narrower signature, and on Sewa Vehicle the kind word centred on its band. Sewa 204 × 145 mm, Tractor 232 × 158, drawn on 150 × drawHeight (vehicleBox.ts; laid out on
 * 150 × 100, the y's through Y).
 */

const face = legible.style.fontFamily;
const REG: Font = { family: face, weight: 400 };
const BOLD: Font = { family: face, weight: 700 };
const HEAVY: Font = { family: face, weight: 800 };
/** Loaded (and measured with) before any pass is drawn: see useCardFonts. */
export const MODERN_FONTS = [REG, BOLD, HEAVY];

const INK = '#231f20';
const WHITE = '#fff';
const mm = (n: number) => Math.round(n * 1000) / 1000;
const upper = (v: string) => v.trim().toUpperCase();
const serialText = (serial: number, digits: number) => String(serial).padStart(digits, '0');
/** "NOV - 2026" prints as "NOV – 2026". */
const tagText = (tag: string) => upper(tag).replace(/\s*-\s*/g, ' – ');

/** The kind word without "PASS". */
const kindOf = (title: string) => title.replace(/ PASS$/, '');

/** The logo in every vehicle pass's heading: 15 tall, the artwork's shape (525 × 644). */
export const ORG_LOGO = { w: (15 * 525) / 644, h: 15 };

/**
 * Every vehicle pass's heading, one size on all six (the owner, 2026-11-15: "font same in all, same as
 * sewa", "same height of logo"): the RSSB logo, and beside it "RSSB SIKANDERPUR (MC)" in bold over
 * "Zone-III". (x, y): the logo's top left; `max`: the most the name may run, from its start.
 */
export function OrgHead({ x, y, max }: { x: number; y: number; max: number }) {
  const tx = x + ORG_LOGO.w + 3.2;
  const cap = 4.6;
  return (
    <g>
      <RssbLogo x0={x} y0={y} x1={x + ORG_LOGO.w} y1={y + ORG_LOGO.h} color={INK} />
      <T t="RSSB SIKANDERPUR (MC)" f={BOLD} cap={cap} x={tx} y={y + 6.4} max={max} fill={INK} />
      <T t="Zone-III" f={REG} cap={2.6} x={tx} y={y + 12.6} fill={INK} />
    </g>
  );
}

export type ModernStyle = 'plain' | 'band';

/*
 * Every kind word (SEWA VEHICLE, TRACTOR TROLLEY, E-RICKSHAW, ADMINISTRATION…): Atkinson Hyperlegible Next 800 as
 * it is, PLAIN_GAP mm more space between the letters, as large as it fits (the owner, 2026-11-16; a squeezed,
 * spaced-out version on Sewa Vehicle that day looked like another font and was undone).
 */
const PLAIN_GAP = 0.6;

/** The largest cap height up to `cap` at which every one of `texts`, drawn as KindWord draws it, is at most `max` long. */
export const kindCap = (texts: string[], cap: number, max: number) =>
  Math.min(cap, ...texts.map((t) => (10 * (max - PLAIN_GAP * (t.length - 1))) / widthOf(t, HEAVY, 10)));

/** A kind word centred on `x` (or from it, `align` start); kindCap sizes it. */
export function KindWord({ t, cap, x, y, max, align = 'middle', fill }: {
  t: string; cap: number; x: number; y: number; max: number; align?: 'start' | 'middle'; fill: string;
}) {
  return <T t={t} f={HEAVY} cap={cap} x={x} y={y} align={align} track={PLAIN_GAP} max={max} fill={fill} />;
}

/**
 * Sewa Vehicle's kind word: white on a colour band edge to edge, in the space from `top` to `bottom`, at most
 * `cap` tall and `x1 - x0` long, centred on the band both ways (the owner, 2026-11-15).
 */
function BandKind({ t, x0, x1, top, bottom, cap, color }: { t: string; x0: number; x1: number; top: number; bottom: number; cap: number; color: string }) {
  const c = kindCap([t], Math.min(cap, (bottom - top) / 1.9), x1 - x0);
  const pill = c * 1.9;
  return (
    <g>
      <rect y={mm((top + bottom) / 2 - pill / 2)} width={VW} height={mm(pill)} fill={color} />
      <KindWord t={t} cap={c} x={(x0 + x1) / 2} y={(top + bottom) / 2 + c / 2} max={x1 - x0} fill={WHITE} />
    </g>
  );
}

type Row = (keyof CardData & Field)[];
/** Reg. no. is not a row: it prints large in its plate (RegPlate). */
const ROWS: Row[] = [['name'], ['vehicle'], ['area', 'dept']];
/** Area and Dept. half each (Dept. had 40 %, so a long one, CONSTRUCTION, printed smaller; the owner, 2026-11-15). */
const SPLIT = [[1], [1], [0.5, 0.5]];
const LABEL: Partial<Record<Field, string>> = { name: 'Name', dept: 'Dept.', area: 'Area', vehicle: 'Vehicle', vehicle_no: 'Reg. no.' };

/** A label, then a line to write on (or the printed value on it), one row after another. `ys`: each row's line. */
function Fields({ p, x0, x1, ys, lw, label, value, gutter }: {
  p: CardData; x0: number; x1: number; ys: number[]; lw: number; label: number; value: number; gutter: number;
}) {
  const base = Math.max(0.5, value * 0.26);
  return (
    <g>
      {ROWS.map((row, i) => {
        const y = ys[i];
        const room = x1 - x0 - gutter * (row.length - 1);
        return row.map((k, j) => {
          const x = x0 + SPLIT[i].slice(0, j).reduce((a, b) => a + b * room + gutter, 0);
          const cw = SPLIT[i][j] * room;
          return (
            <g key={k}>
              <T t={LABEL[k] ?? k} f={REG} cap={label} x={x} y={y - base} max={lw - 0.8} />
              <rect x={mm(x + lw)} y={y} width={mm(cw - lw)} height={0.18} fill={INK} />
              <T t={upper(p[k])} f={BOLD} cap={value} x={x + lw + 0.6} y={y - base} max={cw - lw - 1} />
            </g>
          );
        });
      })}
    </g>
  );
}

/**
 * The Reg. no. as large as it fits, in a white number plate with a black border, "Reg. no." small in its
 * top left corner (`label`: its cap height; 0 for none, the number centred in the plate); empty on a blank pass, to write in. (the owner, 2026-11-15: "improve reg no, increase size")
 * Sewa Vehicle, Tractor Trolley, VIP and Gate 1 & 12 Entry passes.
 */
export function RegPlate({ v, x0, x1, top, bottom, label = 1.8 }: { v: string; x0: number; x1: number; top: number; bottom: number; label?: number }) {
  const t = upper(v);
  const [a, b] = [label ? top + 2.6 + label : top + 1.4, bottom - 1.4];
  const tall = b - a;
  const max = x1 - x0 - 5;
  const cap = t ? Math.min(tall, (tall * max) / widthOf(t, HEAVY, tall)) : tall;
  return (
    <g>
      <rect x={x0} y={mm(top)} width={mm(x1 - x0)} height={mm(bottom - top)} rx={1.6} fill={WHITE} stroke={INK} strokeWidth={0.5} />
      {label > 0 && <T t="Reg. no." f={REG} cap={label} x={x0 + 2} y={top + 1.6 + label} />}
      {t && <T t={t} f={HEAVY} cap={cap} x={(x0 + x1) / 2} y={(a + b) / 2 + cap / 2} align="middle" max={max} />}
    </g>
  );
}

/** Sewa Vehicle (`band`) and Tractor Trolley (`plain`) passes. */
export function ModernVehicle({ p, texts, code, style }: CardProps & { style: ModernStyle }) {
  const { title, color } = TYPE_INFO[p.type];
  const ink = color.band;
  const [x0, x1] = [7, 143];
  /** Sewa Vehicle 204 × 145, Tractor Trolley 232 × 158: the drawing takes the pass's shape. */
  const h = drawHeight(TYPE_INFO[p.type].layout);
  const Y = stretchY(5, 96, h);
  const tag = tagText(texts.tag);
  const qr = 15;
  /** The signature's width. */
  const sw = 26;
  const plate = { x0: VW / 2 - 40, x1: VW / 2 + 40, top: Y(77.6), bottom: Y(94.5) };
  const kind = kindOf(title);
  /*
   * Tractor Trolley's word (`plain`), in the colour, where it was (between Y(27.2) and Y(48.4)); "Vehicle pass"
   * and the green rule under the word moved so the gaps over and under "Vehicle pass" and under the word all
   * match (the owner, 2026-11-16: the rule had come close to the Name line).
   */
  const plain = style === 'plain';
  const rule = 0.9;
  const kcap = kindCap([kind], Math.min(11, (Y(48.4) - Y(29.4) - rule) / 1.6), x1 - x0);
  const kbase = (Y(27.2) + Y(48.4) - rule) / 2 + kcap / 2;
  const gap = (kbase - kcap - (Y(7) + qr) - 3.2) / 2;
  const lineY = plain ? Y(7) + qr + gap + 3.2 : Y(27.2);
  const sigH = plain ? 7.6 : 15;
  /** The serial's cap height, and its baseline: its middle level with the plate's. */
  const scap = 10;
  const serialY = (plate.top + plate.bottom) / 2 + scap / 2;
  return (
    <>
      <rect width={VW} height={h} fill={WHITE} />
      <OrgHead x={x0} y={Y(6.5)} max={x1 - qr - 6 - (x0 + ORG_LOGO.w + 3.2)} />
      {/* A smaller QR code (15, was 20), at the owner's ask. */}
      {code && <Qr text={code} x={x1 - qr} y={Y(7)} size={qr} pad={0} />}
      {/* "Vehicle pass", the kind word and the fields 4.2 higher (a smaller gap under the heading; the owner, 2026-11-16), the room going to the Sr. no. and plate. */}
      <T t="Vehicle pass" f={BOLD} cap={3.2} x={x0} y={lineY} />
      <T t={tag} f={BOLD} cap={3.2} x={x1} y={lineY} align="end" />
      {/* The kind word as large as it fits (the owner, 2026-11-16; KindWord). */}
      {plain ? (
        <g>
          <KindWord t={kind} cap={kcap} x={VW / 2} y={kbase} max={x1 - x0} fill={ink} />
          <rect x={x0} y={mm(kbase + gap)} width={mm(x1 - x0)} height={rule} fill={ink} />
        </g>
      ) : <BandKind t={kind} x0={x0} x1={x1} top={Y(29.4)} bottom={Y(48.4)} cap={11} color={ink} />}
      <Fields p={p} x0={x0} x1={x1} ys={[56.4, 65.4, 74.4].map(Y)} lw={14.5} label={2.2} value={4} gutter={7} />
      {/* The plate centred on the pass, 80 wide and taller (68 before 2026-11-16), no "Reg. no." in it (the owner, 2026-11-16); the signature 26 wide to make room. */}
      <RegPlate v={p.vehicle_no} x0={plate.x0} x1={plate.x1} top={plate.top} bottom={plate.bottom} label={0} />
      {/* The serial larger, its middle level with the plate's (the owner, 2026-11-16), "Sr. no." over it, level with the plate's top; digits narrowed to 92 % to fit before the plate. */}
      <T t="Sr. no." f={REG} cap={2.4} x={x0} y={plate.top + 2.4} />
      <T t={serialText(p.serial, 3)} f={HEAVY} cap={scap} scale={0.92} x={x0} y={serialY} max={plate.x0 - 4.5 - x0} />
      {/* Sewa Vehicle's signature larger, 15 tall, down to just under the Area / Dept. line (the owner, 2026-11-18); Tractor Trolley's 7.6. */}
      {texts.signature && (
        <image href={texts.signature} x={x1 - sw} y={mm(Y(90.6) - sigH - 0.3)} width={sw} height={sigH} preserveAspectRatio="xMidYMax meet" />
      )}
      <rect x={x1 - sw} y={Y(90.6)} width={sw} height={0.18} fill={INK} />
      <T t="Auth. signatory" f={REG} cap={1.6} x={x1 - sw / 2} y={Y(90.6) + 1.6 * 1.9} align="middle" max={sw} />
    </>
  );
}
