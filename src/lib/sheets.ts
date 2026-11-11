import type { Layout } from '@/shared/types';

/** Pass sizes in mm (Mobile: 9 per A4 / 25 per A3+, Bike: 8 / 25, Sewa Vehicle, Tractor Trolley, Gate 3 Entry, BAV Entry: 2 / 9). */
export const CARD_SIZE: Record<Layout, { w: number; h: number }> = {
  mobile: { w: 63.5, h: 88.9 },
  bike: { w: 88, h: 60 },
  vehicle: { w: 150, h: 100 },
};

export type Paper = 'a3plus' | 'a4';
export const PAPERS: Paper[] = ['a3plus', 'a4'];

export const PAPER: Record<Paper, { label: string; w: number; h: number; dialog: string }> = {
  a3plus: { label: 'A3+', w: 329, h: 483, dialog: 'paper A3+ (13 × 19 in, 329 × 483 mm)' },
  a4: { label: 'A4', w: 210, h: 297, dialog: 'paper A4' },
};

/**
 * How passes sit on a sheet. `turn`: turned a quarter so more fit (the cut pass is the same).
 * `gap`: 0 puts passes edge to edge, so one cut separates two (Mobile passes: both edges are the same band).
 */
const GRID: Record<Paper, Record<Layout, { cols: number; rows: number; gap: number; turn: boolean }>> = {
  a3plus: {
    mobile: { cols: 5, rows: 5, gap: 0, turn: false },
    bike: { cols: 5, rows: 5, gap: 4, turn: true },
    vehicle: { cols: 3, rows: 3, gap: 4, turn: true },
  },
  a4: {
    mobile: { cols: 3, rows: 3, gap: 4, turn: false },
    bike: { cols: 2, rows: 4, gap: 4, turn: false },
    vehicle: { cols: 1, rows: 2, gap: 4, turn: false },
  },
};

export interface SheetPlan {
  paper: { w: number; h: number };
  perSheet: number;
  turn: boolean;
  /** Top-left corner of each pass's spot on the sheet, in mm (the spot is h × w when turned). */
  slots: { x: number; y: number }[];
}

/** Where each pass goes on one sheet: the grid, centred. */
export function sheetPlan(paper: Paper, layout: Layout): SheetPlan {
  const { cols, rows, gap, turn } = GRID[paper][layout];
  const card = CARD_SIZE[layout];
  const [w, h] = turn ? [card.h, card.w] : [card.w, card.h];
  const p = PAPER[paper];
  const left = (p.w - cols * w - (cols - 1) * gap) / 2;
  const top = (p.h - rows * h - (rows - 1) * gap) / 2;
  const slots = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push({ x: left + c * (w + gap), y: top + r * (h + gap) });
  return { paper: { w: p.w, h: p.h }, perSheet: cols * rows, turn, slots };
}
