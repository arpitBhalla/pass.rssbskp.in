'use client';
import { type Font, inkWidth, layLine, placeText } from '@/client/measure';
import { archivoSemi, bigShoulders, condensed, humanist, legible, martianMono, rozha } from '@/fonts';
import type { CardData } from '@/lib/passes';
import { type Field, type PassType, TYPE_INFO } from '@/shared/types';

/**
 * Parts shared by the design v2 passes (from ../passes-design-v2, chosen on 2026-11-14): the Rozha One
 * masthead and RS/SB monogram (round 6), the text primitive, the fonts and what each pass says.
 * Gate 3 - VIP prints as the Ticket (round 7), Admin as the Rail (round 6 A); see Ticket.tsx, Rail.tsx.
 */

export const INK = '#000';
export const WHITE = '#fff';
/** Labels and captions. */
export const GREY = '#58595b';

/** Rozha One: "RSSB SIKANDERPUR (MC)" and the monogram letters. */
export const ROZHA: Font = { family: rozha.style.fontFamily, weight: 400 };
/** Archivo SemiCondensed: the Ticket's labels (700) and values (600). */
export const A6: Font = { family: archivoSemi.style.fontFamily, weight: 600 };
export const A7: Font = { family: archivoSemi.style.fontFamily, weight: 700 };
/** Martian Mono: phone and Reg. No. on the Ticket (slashed zero, every digit one width). */
export const MONO: Font = { family: martianMono.style.fontFamily, weight: 600 };
/** Big Shoulders Display: the serial on both passes. */
export const BIG: Font = { family: bigShoulders.style.fontFamily, weight: 800 };
const cond = (weight: number): Font => ({ family: condensed.style.fontFamily, weight });
const sans = (weight: number): Font => ({ family: humanist.style.fontFamily, weight });
/** Roboto Condensed: the kind word on both passes (900), the Rail's values (700) and tag (800). */
export const C700 = cond(700);
export const C800 = cond(800);
export const C900 = cond(900);
/** Source Sans 3: the Rail's labels and captions. */
export const S600 = sans(600);
export const S700 = sans(700);
/** Atkinson Hyperlegible Next: phone and Reg. No. on the Rail (0/O, 1/I never alike). */
export const LEGIBLE: Font = { family: legible.style.fontFamily, weight: 700 };

export const V2_FONTS = [ROZHA, A6, A7, MONO, BIG, C700, C800, C900, S600, S700, LEGIBLE];

export const mm = (n: number) => Math.round(n * 1000) / 1000;
export const upper = (v: string) => v.trim().toUpperCase();
export const serialText = (serial: number, digits: number) => String(serial).padStart(digits, '0');
/** "NOV - 2026" prints as "NOV – 2026", the dash between thin spaces. */
export const tagText = (tag: string) => upper(tag).replace(/\s*-\s*/g, ' – ');

export const ORG = 'RSSB SIKANDERPUR (MC)';
/** The big word: the pass's name without "PASS" ("GATE 3 – VIP", "ADMIN"). */
export const kindOf = (t: PassType) => TYPE_INFO[t].title.replace(/ PASS$/, '').replace(/\s+-\s+/g, ' – ');

export type Row = (keyof CardData & Field)[];
/** Vehicle passes, two fields to a row. */
export const VEHICLE_ROWS: Row[] = [['name'], ['vehicle', 'vehicle_no'], ['area', 'dept']];

type Align = 'start' | 'middle' | 'end';

/**
 * One line of text, sized by its cap height `cap`, ink placed at `x` by `align` (tracked lines are
 * centred by their ink, without the last letter's spacing). `track`: extra mm between letters.
 * `scale`: wider (> 1) or narrower lettering. Longer than `max` mm: shrinks. Spaces are non-breaking so SVG keeps them.
 */
export function T({ t, f, cap, x, y, align = 'start', max, track = 0, scale, fill = INK }: {
  t: string; f: Font; cap: number; x: number; y: number; align?: Align; max?: number; track?: number; scale?: number; fill?: string;
}) {
  if (!t) return null;
  const extra = track * (t.length - 1);
  const p = layLine(t, f, cap, { x, align, scale, max: max === undefined ? undefined : max - extra });
  const shift = align === 'middle' ? -extra / 2 : align === 'end' ? -extra : 0;
  return (
    <text x={mm(p.x + shift)} y={mm(y)} fontSize={mm(p.size)} textLength={mm(p.length + extra)}
      lengthAdjust={track ? 'spacing' : 'spacingAndGlyphs'} style={{ fontFamily: f.family, fontWeight: f.weight }} fill={fill}>
      {t.replace(/ /g, ' ')}
    </text>
  );
}

/** How wide `t` prints (ink), with `track`. */
export const widthOf = (t: string, f: Font, cap: number, track = 0) => inkWidth(t, f, cap) + track * (t.length - 1);

/** The RS/SB monogram, `w` wide and 1.2 w tall: black box with white Rozha letters in a thin black frame. */
export function Monogram({ x, y, w }: { x: number; y: number; w: number }) {
  const h = w * 1.2;
  const s = w * 0.032;
  const i = w * 0.088;
  const letters = (t: string, base: number) => {
    const p = placeText(t, ROZHA, w * 0.3, x + w * 0.22, x + w * 0.78);
    return <text x={mm(p.x)} y={mm(y + h * base)} fontSize={mm(p.size)} textLength={mm(p.length)} lengthAdjust="spacingAndGlyphs"
      style={{ fontFamily: ROZHA.family }} fill={WHITE}>{t}</text>;
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
