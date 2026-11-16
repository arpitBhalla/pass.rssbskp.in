import type { Font } from '@/client/measure';
import { legible } from '@/fonts';
import type { CardData } from '@/lib/passes';
import { type Field, TYPE_INFO } from '@/shared/types';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import { RssbLogo } from './rssbLogo';
import { T, widthOf } from './v2kit';
import { stretchY, VH, VW } from './vehicleBox';

/**
 * Design round 11 "Modern & simple" (../passes-design-v2/cards/r11-modern), the owner's pick on
 * 2026-11-15 for two passes: Sewa Vehicle in its `band` style (the kind word white on a colour band,
 * edge to edge; shown on the design site as R12 · Colour band) and Tractor Trolley in its `plain` style
 * (the kind word in the colour over a colour rule; shown as R13 · Headings · masthead). One typeface,
 * Atkinson Hyperlegible Next, in three weights; labels small in sentence case, values bold capitals.
 * Changed from the design at the owner's ask: the real RSSB logo, larger, for the RS/SB mark (the name
 * and zone beside it larger to match), and "Vehicle pass" and the month larger, a smaller QR code, the Reg. no.
 * large in a plate centred between the Sr. no. and a narrower signature, and on Sewa Vehicle the kind word centred on its band. 204 × 145 mm, drawn on 150 × VH (vehicleBox.ts; laid out on
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
/** The largest cap height up to `cap` at which every one of `texts` fits `max`. */
const capToFit = (texts: string[], f: Font, cap: number, max: number) => Math.min(cap, ...texts.map((t) => cap * (max / widthOf(t, f, cap))));

/** The kind word without "PASS"; both passes' at one size. */
const kindOf = (title: string) => title.replace(/ PASS$/, '');
const KINDS = ['SEWA VEHICLE', 'TRACTOR TROLLEY'];

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

/**
 * The kind word in the space from `top` to `bottom`, from `x0`, at most `cap` tall and `x1 - x0` long.
 * plain: in the colour, a colour rule under it, from x0, the word centred between `above` (the baseline of
 * the line over it) and the rule, so the gaps over and under it match (the owner, 2026-11-15); band: white on
 * a colour band edge to edge, centred on the band both ways (the owner, 2026-11-15).
 */
function Kind({ style, t, x0, x1, top, bottom, above = top, cap, color, rule }: {
  style: ModernStyle; t: string; x0: number; x1: number; top: number; bottom: number; above?: number; cap: number; color: string; rule: number;
}) {
  const band = style === 'band';
  const room = bottom - top;
  const tall = band ? room / 1.9 : (room - rule) / 1.6;
  const c = capToFit(KINDS, HEAVY, Math.min(cap, tall), x1 - x0);
  const base = band ? (top + bottom) / 2 + c / 2 : (above + bottom - rule) / 2 + c / 2;
  const pill = c * 1.9;
  return (
    <g>
      {band && <rect y={mm((top + bottom) / 2 - pill / 2)} width={VW} height={mm(pill)} fill={color} />}
      <T t={t} f={HEAVY} cap={c} x={band ? VW / 2 : x0} y={base} align={band ? 'middle' : 'start'} max={x1 - x0} fill={band ? WHITE : color} />
      {!band && <rect x={x0} y={mm(bottom - rule)} width={mm(x1 - x0)} height={rule} fill={color} />}
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
 * top left corner; empty on a blank pass, to write in. (the owner, 2026-11-15: "improve reg no, increase size")
 * Sewa Vehicle, Tractor Trolley, VIP and Gate 1 & 12 Entry passes.
 */
export function RegPlate({ v, x0, x1, top, bottom }: { v: string; x0: number; x1: number; top: number; bottom: number }) {
  const t = upper(v);
  const [a, b] = [top + 4.4, bottom - 1.4];
  const tall = b - a;
  const max = x1 - x0 - 5;
  const cap = t ? Math.min(tall, (tall * max) / widthOf(t, HEAVY, tall)) : tall;
  return (
    <g>
      <rect x={x0} y={mm(top)} width={mm(x1 - x0)} height={mm(bottom - top)} rx={1.6} fill={WHITE} stroke={INK} strokeWidth={0.5} />
      <T t="Reg. no." f={REG} cap={1.8} x={x0 + 2} y={top + 3.4} />
      {t && <T t={t} f={HEAVY} cap={cap} x={(x0 + x1) / 2} y={(a + b) / 2 + cap / 2} align="middle" max={max} />}
    </g>
  );
}

/** Sewa Vehicle (`band`) and Tractor Trolley (`plain`) passes. */
export function ModernVehicle({ p, texts, code, style }: CardProps & { style: ModernStyle }) {
  const { title, color } = TYPE_INFO[p.type];
  const ink = color.band;
  const [x0, x1] = [7, 143];
  const Y = stretchY(5, 96);
  const tag = tagText(texts.tag);
  const qr = 15;
  /** The signature's width. */
  const sw = 30;
  return (
    <>
      <rect width={VW} height={VH} fill={WHITE} />
      <OrgHead x={x0} y={Y(6.5)} max={x1 - qr - 6 - (x0 + ORG_LOGO.w + 3.2)} />
      {/* A smaller QR code (15, was 20), at the owner's ask. */}
      {code && <Qr text={code} x={x1 - qr} y={Y(7)} size={qr} pad={0} />}
      <T t="Vehicle pass" f={BOLD} cap={3.2} x={x0} y={Y(31.4)} />
      <T t={tag} f={BOLD} cap={3.2} x={x1} y={Y(31.4)} align="end" />
      <Kind style={style} t={kindOf(title)} x0={x0} x1={x1} top={Y(33.6)} bottom={Y(50)} above={Y(31.4)} cap={10} color={ink} rule={0.9} />
      <Fields p={p} x0={x0} x1={x1} ys={[58.5, 68, 77.5].map(Y)} lw={14.5} label={2.2} value={4} gutter={7} />
      {/* The plate centred on the pass, 68 wide; the signature 30 wide (was 40) to make room. */}
      <RegPlate v={p.vehicle_no} x0={VW / 2 - 34} x1={VW / 2 + 34} top={Y(81)} bottom={Y(94.5)} />
      <T t="Sr. no." f={REG} cap={2} x={x0} y={Y(94) - 6 - 2.2} />
      <T t={serialText(p.serial, 3)} f={HEAVY} cap={6} x={x0} y={Y(94)} />
      {texts.signature && (
        <image href={texts.signature} x={x1 - sw} y={mm(Y(90.6) - 7.6 - 0.3)} width={sw} height={7.6} preserveAspectRatio="xMidYMax meet" />
      )}
      <rect x={x1 - sw} y={Y(90.6)} width={sw} height={0.18} fill={INK} />
      <T t="Auth. signatory" f={REG} cap={1.6} x={x1 - sw / 2} y={Y(90.6) + 1.6 * 1.9} align="middle" max={sw} />
    </>
  );
}
