import type { Layout } from '@/shared/types';

/** Pass sizes in mm (per A3+ / A4 sheet: Mobile 45 / 16, Bike 21 / 8, the 150 × 100 mm passes 9 / 2). */
export const CARD_SIZE: Record<Layout, { w: number; h: number }> = {
  mobile: { w: 50, h: 60 },
  bike: { w: 100, h: 68 },
  vehicle: { w: 150, h: 100 },
};

export type Paper = 'a3plus' | 'a4';
export const PAPERS: Paper[] = ['a3plus', 'a4'];

export const PAPER: Record<Paper, { label: string; w: number; h: number; dialog: string }> = {
  a3plus: { label: 'A3+', w: 329, h: 483, dialog: 'paper A3+ (13 × 19 in, 329 × 483 mm)' },
  a4: { label: 'A4', w: 210, h: 297, dialog: 'paper A4' },
};

/** The least space between the paper's edge and the passes, in mm: printers can't print right to the edge. */
export const MARGIN = 3;

export interface SheetPlan {
  paper: { w: number; h: number };
  perSheet: number;
  /** Turned a quarter so more fit (the cut pass is the same). */
  turn: boolean;
  /** Top-left corner of each pass's spot on the sheet, in mm (the spot is h × w when turned). */
  slots: { x: number; y: number }[];
  /** Where to cut, in mm: the passes touch, so one cut separates two. */
  cuts: { xs: number[]; ys: number[] };
}

/**
 * Where each pass goes on one sheet: edge to edge (one cut separates two), as many as fit inside the
 * margin, turned if that fits more, and centred.
 */
export function sheetPlan(paper: Paper, layout: Layout): SheetPlan {
  const p = PAPER[paper];
  const card = CARD_SIZE[layout];
  const grid = (turn: boolean) => {
    const [w, h] = turn ? [card.h, card.w] : [card.w, card.h];
    return { turn, w, h, cols: Math.floor((p.w - 2 * MARGIN) / w), rows: Math.floor((p.h - 2 * MARGIN) / h) };
  };
  const [upright, turned] = [grid(false), grid(true)];
  const { turn, w, h, cols, rows } = turned.cols * turned.rows > upright.cols * upright.rows ? turned : upright;
  const left = (p.w - cols * w) / 2;
  const top = (p.h - rows * h) / 2;
  const slots = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push({ x: left + c * w, y: top + r * h });
  const lines = (from: number, n: number, size: number) => Array.from({ length: n + 1 }, (_, i) => from + i * size);
  return { paper: { w: p.w, h: p.h }, perSheet: cols * rows, turn, slots, cuts: { xs: lines(left, cols, w), ys: lines(top, rows, h) } };
}
