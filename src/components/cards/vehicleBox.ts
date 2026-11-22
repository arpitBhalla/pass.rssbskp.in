import { CARD_SIZE } from '@/lib/sheets';
import type { Layout } from '@/shared/types';

/**
 * The 150 × 100 mm vehicle passes changed size on 2026-11-15 (the owner's choice): Sewa Vehicle and
 * Tractor Trolley to half an A4 sheet, 204 × 145 mm; the gate passes (Gate 3 Entry, Gate 1 & 11, VIP,
 * Admin) to 151 × 103, 6 to an A3. Their drawings keep their 150 mm width and take the new shape
 * (150 × VH, 150 × GH), then print w / 150 times as big. Type, logos and codes keep their size on the
 * drawing; the height it gains goes into the gaps between them (stretchY).
 */
export const VW = 150;
/** The drawing's height: Sewa Vehicle and Tractor Trolley (150 × 106.6). */
export const VH = (VW * CARD_SIZE.vehicle.h) / CARD_SIZE.vehicle.w;
/** The drawing's height: the gate passes (150 × 102.3). */
export const GH = (VW * CARD_SIZE.gate.h) / CARD_SIZE.gate.w;
/** The drawing's height for a layout: 150 wide, the pass's shape (Sewa Vehicle 150 × 106.6; Tractor Trolley and the helpline passes 150 × 102.2). */
export const drawHeight = (layout: Layout) => (VW * CARD_SIZE[layout].h) / CARD_SIZE[layout].w;

/**
 * A y on the old 150 × 100 drawing, on one `h` tall: above `a` where it was, below `b` moved down by the
 * whole extra height, in between spread evenly.
 */
export const stretchY = (a: number, b: number, h = VH) => (y: number) => {
  const extra = h - 100;
  return Math.round((y <= a ? y : y >= b ? y + extra : a + ((y - a) * (b - a + extra)) / (b - a)) * 1000) / 1000;
};

/** How far an element of fixed size centred at `y` moves. */
export const shiftOf = (Y: (y: number) => number, y: number) => Y(y) - y;
