'use client';
import { type Font, inkWidth, layLine } from '@/client/measure';
import { barlow, barlowCondensed, barlowSemi, plexMono } from '@/fonts';
import type { CardData } from '@/lib/passes';
import { type Field, TYPE_INFO } from '@/shared/types';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import { Dup } from './v2kit';
import { KindWord, kindCap, ORG_LOGO, OrgHead } from './Modern';
import { GH, stretchY, VW } from './vehicleBox';

/**
 * Design v2 "Ledger · colour bar" (round 3 of ../passes-design-v2), the Gate 3 Entry pass, as the user
 * picked it on 2026-11-14. Black does the work: everything small is black capitals over a ruled table
 * of fields, and the kind word is white on a solid bar of the pass colour. The QR, serial, gate sign and
 * signature sit on a stub behind a dotted tear line. Gate 3 Entry passes print Name, Phone and Reg. No.;
 * the Reg. No. large in a number plate under the table (the owner, 2026-11-15: "improve reg no, increase size").
 */

const INK = '#000';
const WHITE = '#fff';

const font = (family: string, weight: number): Font => ({ family, weight });
const COND = barlowCondensed.style.fontFamily;
const SEMI = barlowSemi.style.fontFamily;
const BC500 = font(COND, 500);
const BC600 = font(COND, 600);
const BC700 = font(COND, 700);
const BC800 = font(COND, 800);
const BS600 = font(SEMI, 600);
const BS800 = font(SEMI, 800);
const B800 = font(barlow.style.fontFamily, 800);
/** IBM Plex Mono: serial and Reg. No. (every digit one width, dotted zero). */
const MONO = font(plexMono.style.fontFamily, 600);
/** Loaded (and measured with) before any pass is drawn: see useCardFonts. */
export const LEDGER_FONTS = [BC500, BC600, BC700, BC800, BS600, BS800, B800, MONO];
/** The labels' face (Barlow Condensed 700, set in capitals, tracked +12 %): other passes borrow it. */
export const LABEL_FONT = BC700;

const mm = (n: number) => Math.round(n * 1000) / 1000;
const upper = (v: string) => v.trim().toUpperCase();
const serialText = (serial: number, digits: number) => String(serial).padStart(digits, '0');
/** "NOV - 2026" prints as "NOV – 2026". */
const tagText = (tag: string) => upper(tag).replace(/\s+-\s+/g, ' – ');

/* ---------- text ---------- */

type Align = 'start' | 'middle' | 'end';

/**
 * One line of text, sized by its cap height `cap`, ink placed at `x` by `align`. `track`: extra mm
 * between letters. Longer than `max` mm: shrinks. Spaces are non-breaking so SVG keeps them.
 */
function T({ t, f, cap, x, y, align = 'start', max, track = 0, fill = INK }: {
  t: string; f: Font; cap: number; x: number; y: number; align?: Align; max?: number; track?: number; fill?: string;
}) {
  if (!t) return null;
  const extra = track * (t.length - 1);
  const p = layLine(t, f, cap, { x, align, max: max === undefined ? undefined : max - extra });
  const shift = align === 'middle' ? -extra / 2 : align === 'end' ? -extra : 0;
  return (
    <text x={mm(p.x + shift)} y={mm(y)} fontSize={mm(p.size)} textLength={mm(p.length + extra)}
      lengthAdjust={track ? 'spacing' : 'spacingAndGlyphs'} style={{ fontFamily: f.family, fontWeight: f.weight }} fill={fill}>
      {t.replace(/ /g, '\u00a0')}
    </text>
  );
}

const widthOf = (t: string, f: Font, cap: number, track = 0) => inkWidth(t, f, cap) + track * (t.length - 1);

/** The first (widest) of `fonts` in which `t` fits `max` at this size; else the last, which shrinks. */
const pick = (t: string, fonts: Font[], cap: number, max: number) => fonts.find((f) => widthOf(t, f, cap) <= max) ?? fonts[fonts.length - 1];

/** Small capitals: zone, pass label, tag, field labels, captions. Black, tracked +12%. */
function Label({ t, x, y, cap, align, max }: { t: string; x: number; y: number; cap: number; align?: Align; max?: number }) {
  return <T t={t} f={BC700} cap={cap} x={x} y={y} align={align} max={max} track={cap * 0.12} />;
}

/* ---------- parts ---------- */

/**
 * The kind word, white on a solid bar of the colour from `top` to `bottom`, centred on it both ways (the owner,
 * 2026-11-15; the bar taller on 2026-11-16), in the widest Barlow (normal, semi condensed, condensed) that fits.
 */
function Kind({ t, x0, x1, top, bottom, cap, color }: { t: string; x0: number; x1: number; top: number; bottom: number; cap: number; color: string }) {
  const max = x1 - x0 - cap * 0.5;
  // The font of the Sewa Vehicle heading: Atkinson 800, a little letter space (KindWord; the owner, 2026-11-22; was Barlow 800).
  const c = kindCap([t], cap, max);
  return (
    <g>
      <rect x={x0} y={mm(top)} width={mm(x1 - x0)} height={mm(bottom - top)} fill={color} />
      <KindWord t={t} cap={c} x={(x0 + x1) / 2} y={(top + bottom) / 2 + c / 2} max={max} fill={WHITE} />
    </g>
  );
}

function Rule({ x0, x1, y, w = 0.25 }: { x0: number; x1: number; y: number; w?: number }) {
  return <rect x={x0} y={y} width={mm(x1 - x0)} height={w} fill={INK} />;
}

/** A dotted tear line between the pass and its stub. */
function Perforation({ x, y0, y1 }: { x: number; y0: number; y1: number }) {
  return <line x1={x} y1={y0} x2={x} y2={y1} stroke={INK} strokeWidth={0.22} strokeLinecap="round" strokeDasharray="0 1.2" />;
}

/** The gate sign: a black disc with a white 3, `size` mm square at (cx - size / 2, y). */
function GateSign({ cx, y, size }: { cx: number; y: number; size: number }) {
  return (
    <g transform={`translate(${cx - size / 2} ${y}) scale(${size / 24})`}>
      <circle cx={12} cy={12} r={11.5} fill={INK} />
      <text x={12} y={18.6} fontSize={18.5} textAnchor="middle" style={{ fontFamily: B800.family, fontWeight: 800 }} fill={WHITE}>3</text>
    </g>
  );
}

/** "SR. NO." over the serial in mono digits, centred on `x`. */
function Serial({ no, x, y, cap, caption, captionY }: { no: string; x: number; y: number; cap: number; caption: number; captionY: number }) {
  return (
    <g>
      <Label t="SR. NO." x={x} y={captionY} cap={caption} align="middle" />
      <T t={no} f={MONO} cap={cap} x={x} y={y} align="middle" />
    </g>
  );
}

/** The signature image over its line, "AUTH. SIGNATORY" under it. `y`: the line. */
function SignOff({ href, x0, x1, y, h, cap, captionY }: { href: string; x0: number; x1: number; y: number; h: number; cap: number; captionY: number }) {
  return (
    <g>
      {href && <image href={href} x={x0} y={mm(y - h - 0.3)} width={mm(x1 - x0)} height={h} preserveAspectRatio="xMidYMax meet" />}
      <Rule x0={x0} x1={x1} y={y} w={0.2} />
      <Label t="AUTH. SIGNATORY" x={(x0 + x1) / 2} y={captionY} cap={cap} align="middle" max={x1 - x0} />
    </g>
  );
}

/* ---------- the ledger of fields ---------- */

/**
 * "REG. NO." and the number large in a white number plate with a black border, from `x` to `x1`, `top` to
 * `bottom`; empty on a blank pass, to write in.
 */
function RegPlate({ v, x0, x, x1, top, bottom, label }: { v: string; x0: number; x: number; x1: number; top: number; bottom: number; label: number }) {
  const h = bottom - top;
  const cap = h * 0.56;
  const max = x1 - x - 6;
  const t = upper(v);
  const f = pick(t, [MONO, BS600, BC600], cap, max);
  return (
    <g>
      <Label t="REG. NO." x={x0} y={top + h / 2 + label / 2} cap={label} />
      <rect x={x} y={mm(top)} width={mm(x1 - x)} height={mm(h)} rx={1.6} fill={WHITE} stroke={INK} strokeWidth={0.5} />
      {t && <T t={t} f={f} cap={cap} x={(x + x1) / 2} y={top + h / 2 + cap / 2} align="middle" max={max} />}
    </g>
  );
}

type Row = (keyof CardData & Field)[];
const LABEL: Partial<Record<Field, string>> = { name: 'NAME', phone: 'PHONE', vehicle: 'VEHICLE', vehicle_no: 'REG. NO.' };
/** Gate 3 Entry passes print Name, Phone and Reg. No.: Name and Phone in the table (Phone, not Vehicle: the owner, 2026-11-22), Reg. No. in its plate. */
const ROWS: Row[] = [['name'], ['phone']];
const SPLIT = [[1], [1]];

function Value({ k, v, x, y, cap, max }: { k: Field; v: string; x: number; y: number; cap: number; max: number }) {
  const t = upper(v);
  if (!t) return null;
  const f = pick(t, k === 'vehicle_no' || k === 'phone' ? [MONO, BS600, BC600] : [BS600, BC600], cap, max);
  return <T t={t} f={f} cap={cap} x={x} y={y} max={max} />;
}

/**
 * Fields as lines to write on: a label at the left, then the value (printed, or written by hand) on a
 * hairline, the two on one baseline. Blank and printed passes look the same.
 */
function Fields({ p, x0, x1, rules, lw, label, value, base, gutter }: {
  p: CardData; x0: number; x1: number; rules: number[]; lw: number; label: number; value: number; base: number; gutter: number;
}) {
  return (
    <g>
      {ROWS.map((row, i) => {
        const y = rules[i];
        const room = x1 - x0 - gutter * (row.length - 1);
        const shares = SPLIT[i];
        return (
          <g key={row.join()}>
            <Rule x0={x0 + lw} x1={x1} y={y} w={0.2} />
            {row.map((k, j) => {
              const cx = x0 + shares.slice(0, j).reduce((a, b) => a + b * room + gutter, 0);
              const cw = shares[j] * room;
              return (
                <g key={k}>
                  <Label t={LABEL[k] ?? k} x={cx} y={y - base} cap={label} max={lw - 1.2} />
                  <Value k={k} v={p[k]} x={cx + lw + 1.2} y={y - base} cap={value} max={cw - lw - 1.6} />
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/** 151 × 103 mm, drawn on 150 × GH (vehicleBox.ts; laid out on 150 × 100, the y's through Y). */
export function LedgerVehicle({ p, texts, code }: CardProps) {
  const c = TYPE_INFO[p.type].color.band;
  const [x0, x1] = [7, 113];
  const stub = 133;
  const Y = stretchY(9, 91, GH);
  return (
    <>
      <rect width={VW} height={GH} fill={WHITE} />
      <OrgHead x={x0} y={8.5} max={x1 - (x0 + ORG_LOGO.w + 3.2)} />
      <Rule x0={x0} x1={x1} y={Y(25)} />
      <Label t="VEHICLE PASS" x={x0} y={Y(31)} cap={3} />
      <Label t={tagText(texts.tag)} x={x1} y={Y(31)} cap={3} align="end" />
      {/* The bar 16.5 tall (was 13.3), from just under VEHICLE PASS to above the fields. */}
      <Kind t={TYPE_INFO[p.type].title.replace(/ PASS$/, '')} x0={x0} x1={x1} top={Y(32.6)} bottom={Y(48.6)} cap={9} color={c} />
      <Fields p={p} x0={x0} x1={x1} rules={[60, 71.5].map(Y)} lw={17} label={2.7} value={6} base={1.1} gutter={5} />
      <RegPlate v={p.vehicle_no} x0={x0} x={x0 + 17} x1={x1} top={Y(76)} bottom={Y(89.5)} label={2.7} />

      <Perforation x={118} y0={Y(9)} y1={Y(91)} />
      {code && <Qr text={code} x={125.5} y={Y(9.5)} size={15} pad={0} />}
      <Serial no={serialText(p.serial, 3)} x={stub} y={Y(44.4)} cap={7.5} caption={2.4} captionY={Y(34.6)} />
      <Dup p={p} x={stub} y={Y(30.4)} cap={1.8} align="middle" />
      {/* The 3 a little higher (Y(53) before 2026-11-18) to make room for the signature. */}
      <GateSign cx={stub} y={Y(51.5)} size={17} />
      {/* The line and AUTH. SIGNATORY only, signed by hand: no signature image (the owner, 2026-11-22). */}
      <SignOff href="" x0={stub - 13} x1={stub + 13} y={Y(86)} h={15} cap={1.9} captionY={Y(89.8)} />
    </>
  );
}
