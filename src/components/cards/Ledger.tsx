'use client';
import { type Font, inkWidth, layLine, placeText } from '@/client/measure';
import { barlow, barlowCondensed, barlowSemi, marcellus, plexMono } from '@/fonts';
import type { CardData } from '@/lib/passes';
import { CARD_SIZE } from '@/lib/sheets';
import { type Field, TYPE_INFO } from '@/shared/types';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';

/**
 * Design v2 "Ledger · colour bar" (round 3 of ../passes-design-v2), the Gate 3 Entry pass, as the user
 * picked it on 2026-11-14. Black does the work: everything small is black capitals over a ruled table
 * of fields, and the kind word is white on a solid bar of the pass colour. The QR, serial, gate sign and
 * signature sit on a stub behind a dotted tear line. Gate 3 Entry passes print Name, Vehicle and Reg. No.
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
/** Marcellus: the monogram letters. */
const SERIF = font(marcellus.style.fontFamily, 400);
/** Loaded (and measured with) before any pass is drawn: see useCardFonts. */
export const LEDGER_FONTS = [BC500, BC600, BC700, BC800, BS600, BS800, B800, MONO, SERIF];

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

/** The RS/SB monogram, `w` wide and 1.2 w tall: black box with white letters in a thin black frame. */
function Monogram({ x, y, w }: { x: number; y: number; w: number }) {
  const h = w * 1.2;
  const s = w * 0.032;
  const i = w * 0.088;
  const letters = (t: string, base: number) => {
    const p = placeText(t, SERIF, w * 0.3, x + w * 0.22, x + w * 0.78);
    return <text x={mm(p.x)} y={mm(y + h * base)} fontSize={mm(p.size)} textLength={mm(p.length)} lengthAdjust="spacingAndGlyphs"
      style={{ fontFamily: SERIF.family, fontWeight: 400 }} fill={WHITE}>{t}</text>;
  };
  return (
    <g>
      <rect x={mm(x + s / 2)} y={mm(y + s / 2)} width={mm(w - s)} height={mm(h - s)} fill="none" stroke={INK} strokeWidth={mm(s)} />
      <rect x={mm(x + i)} y={mm(y + i)} width={mm(w - 2 * i)} height={mm(h - 2 * i)} fill={INK} />
      {letters('RS', 0.46)}
      {letters('SB', 0.785)}
    </g>
  );
}

/** "RSSB SIKANDERPUR (MC)": the name in 700, "(MC)" in 500. Shrinks as a whole to fit `max`. */
function OrgName({ x, y, cap, max }: { x: number; y: number; cap: number; max: number }) {
  const [a, b] = ['RSSB SIKANDERPUR', '(MC)'];
  const space = (c: number) => layLine(' ', BC700, c, { x: 0 }).length;
  const total = (c: number) => widthOf(a, BC700, c, c * 0.05) + space(c) + c * 0.05 + widthOf(b, BC500, c, c * 0.05);
  const c = Math.min(cap, cap * (max / total(cap)));
  const tr = c * 0.05;
  return (
    <g>
      <T t={a} f={BC700} cap={c} x={x} y={y} track={tr} />
      <T t={b} f={BC500} cap={c} x={x + widthOf(a, BC700, c, tr) + space(c) + tr} y={y} track={tr} />
    </g>
  );
}

/** The kind word, white on a solid bar of the colour, in the widest Barlow (normal, semi condensed, condensed) that fits. */
function Kind({ t, x0, x1, y, cap, color }: { t: string; x0: number; x1: number; y: number; cap: number; color: string }) {
  const pad = cap * 0.24;
  const max = x1 - x0 - 2 * pad;
  const f = pick(t, [B800, BS800, BC800], cap, max);
  return (
    <g>
      <rect x={x0} y={mm(y - cap - pad)} width={mm(x1 - x0)} height={mm(cap + 2 * pad)} fill={color} />
      <T t={t} f={f} cap={cap} x={x0 + pad} y={y} max={max} fill={WHITE} />
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

type Row = (keyof CardData & Field)[];
const LABEL: Partial<Record<Field, string>> = { name: 'NAME', vehicle: 'VEHICLE', vehicle_no: 'REG. NO.' };
/** Gate 3 Entry passes ask for Name, Vehicle and Reg. No. only; Vehicle gets 55 % of its row. */
const ROWS: Row[] = [['name'], ['vehicle', 'vehicle_no']];
const SPLIT = [[1], [0.55, 0.45]];

function Value({ k, v, x, y, cap, max }: { k: Field; v: string; x: number; y: number; cap: number; max: number }) {
  const t = upper(v);
  if (!t) return null;
  const f = pick(t, k === 'vehicle_no' || k === 'phone' ? [MONO, BS600, BC600] : [BS600, BC600], cap, max);
  return <T t={t} f={f} cap={cap} x={x} y={y} max={max} />;
}

/**
 * Fields as a ruled table: heavier opening and closing rules, a label on each rule's baseline at the
 * left, then the value (printed, or written by hand). Blank and printed passes look the same.
 */
function Fields({ p, x0, x1, top, rules, lw, label, value, base, gutter }: {
  p: CardData; x0: number; x1: number; top: number; rules: number[]; lw: number; label: number; value: number; base: number; gutter: number;
}) {
  return (
    <g>
      <Rule x0={x0} x1={x1} y={top} w={0.35} />
      {ROWS.map((row, i) => {
        const y = rules[i];
        const room = x1 - x0 - gutter * (row.length - 1);
        const shares = SPLIT[i];
        return (
          <g key={row.join()}>
            <Rule x0={x0} x1={x1} y={y} w={i === ROWS.length - 1 ? 0.35 : 0.2} />
            {row.map((k, j) => {
              const cx = x0 + shares.slice(0, j).reduce((a, b) => a + b * room + gutter, 0);
              const cw = shares[j] * room;
              return (
                <g key={k}>
                  <Label t={LABEL[k] ?? k} x={cx} y={y - base} cap={label} max={lw - 1.2} />
                  <rect x={mm(cx + lw)} y={mm(y - 2.5)} width={0.2} height={2.5} fill={INK} />
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

/** 150 × 100 mm. */
export function LedgerVehicle({ p, texts, code }: CardProps) {
  const c = TYPE_INFO[p.type].color.band;
  const [x0, x1] = [7, 113];
  const stub = 133;
  return (
    <>
      <rect width={CARD_SIZE.vehicle.w} height={CARD_SIZE.vehicle.h} fill={WHITE} />
      <Monogram x={x0} y={9.5} w={10} />
      <OrgName x={20.5} y={13.7} cap={4.2} max={x1 - 20.5} />
      <Label t="ZONE-III" x={20.5} y={21.5} cap={2.4} />
      <Rule x0={x0} x1={x1} y={25} />
      <Label t="VEHICLE PASS" x={x0} y={30.4} cap={2.4} />
      <Label t={tagText(texts.tag)} x={x1} y={30.4} cap={2.4} align="end" />
      <Kind t={TYPE_INFO[p.type].title.replace(/ PASS$/, '')} x0={x0} x1={x1} y={44.6} cap={9} color={c} />
      <Fields p={p} x0={x0} x1={x1} top={50} rules={[68, 86]} lw={13.5} label={2.4} value={5.4} base={1.6} gutter={5} />

      <Perforation x={118} y0={9} y1={91} />
      {code && <Qr text={code} x={125.5} y={9.5} size={15} pad={0} />}
      <Serial no={serialText(p.serial, 3)} x={stub} y={44.4} cap={7.5} caption={2.4} captionY={34.6} />
      <GateSign cx={stub} y={53} size={17} />
      <SignOff href={texts.signature} x0={123} x1={143} y={86} h={9.5} cap={1.9} captionY={89.8} />
    </>
  );
}
