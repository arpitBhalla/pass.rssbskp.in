'use client';

export interface Font {
  family: string;
  weight: number;
}

/** Text measurements per 1 unit of font size. `left` / `right`: where the ink starts / ends, from the text's origin. */
interface Metrics {
  advance: number;
  left: number;
  right: number;
}

let ctx: CanvasRenderingContext2D | null | undefined;
const metricsCache = new Map<string, Metrics>();
const capCache = new Map<string, number>();

function canvas(font: Font): CanvasRenderingContext2D | null {
  if (ctx === undefined) ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (ctx) ctx.font = `${font.weight} 100px ${font.family}`;
  return ctx;
}

function metrics(text: string, font: Font): Metrics {
  const key = `${font.family}|${font.weight}|${text}`;
  let m = metricsCache.get(key);
  if (!m) {
    const c = canvas(font);
    if (!c) return { advance: text.length * 0.55, left: 0, right: text.length * 0.55 };
    const t = c.measureText(text);
    m = { advance: t.width / 100, left: -t.actualBoundingBoxLeft / 100, right: t.actualBoundingBoxRight / 100 };
    metricsCache.set(key, m);
  }
  return m;
}

/** Height of a capital letter as a share of the font size: text is sized by cap height, as measured on the templates. */
function capRatio(font: Font): number {
  const key = `${font.family}|${font.weight}`;
  let r = capCache.get(key);
  if (r === undefined) {
    const c = canvas(font);
    r = (c && c.measureText('H').actualBoundingBoxAscent / 100) || 0.72;
    capCache.set(key, r);
  }
  return r;
}

/** Loads the card fonts before anything is measured, then drops measurements taken with stand-in fonts. */
export async function loadFonts(fonts: Font[]): Promise<void> {
  if (typeof document === 'undefined') return;
  await Promise.all(fonts.map((f) => document.fonts.load(`${f.weight} 20px ${f.family}`, 'RSB0a')));
  await document.fonts.ready;
  metricsCache.clear();
  capCache.clear();
}

/** One line of SVG text: draw at `x` with `size`, exactly `length` wide (textLength, spacingAndGlyphs). */
export interface Placed {
  x: number;
  size: number;
  length: number;
}

/** Horizontal scale that makes `text` (at cap height `cap`) exactly `inkWidth` wide: the template's lettering width. */
export function scaleFor(text: string, font: Font, cap: number, inkWidth: number): number {
  const m = metrics(text, font);
  const w = (m.right - m.left) * (cap / capRatio(font));
  return w > 0 ? inkWidth / w : 1;
}

/**
 * Lays out a line by its cap height. `align` places the ink (not the advance box) at `x`. `scale`
 * stretches horizontally (from `scaleFor`). A line wider than `max` shrinks, down to 75%, then is squeezed.
 */
export function layLine(
  text: string, font: Font, cap: number,
  o: { x: number; align?: 'start' | 'middle' | 'end'; scale?: number; max?: number },
): Placed {
  const m = metrics(text, font);
  let size = cap / capRatio(font);
  let s = o.scale ?? 1;
  let ink = (m.right - m.left) * size * s;
  if (o.max && ink > o.max) {
    const f = o.max / ink;
    if (f >= 0.75) size *= f;
    else {
      size *= 0.75;
      s *= f / 0.75;
    }
    ink = o.max;
  }
  const inkStart = o.align === 'middle' ? o.x - ink / 2 : o.align === 'end' ? o.x - ink : o.x;
  return { x: inkStart - m.left * size * s, size, length: m.advance * size * s };
}

/** Static template text: its ink spans exactly x0 → x1 with cap height `cap`. */
export function placeText(text: string, font: Font, cap: number, x0: number, x1: number): Placed {
  return layLine(text, font, cap, { x: x0, scale: scaleFor(text, font, cap, x1 - x0) });
}
