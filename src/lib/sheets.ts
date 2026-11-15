import type { Layout } from '@/shared/types';

/** Pass sizes in mm (per A3 / A3+ / A4 sheet: Mobile 72 / 91 / 32, Bike 16 / 21 / 8, the 150 × 100 mm passes 6 / 9 / 3). */
export const CARD_SIZE: Record<Layout, { w: number; h: number }> = {
  mobile: { w: 36, h: 45 },
  bike: { w: 100, h: 68 },
  vehicle: { w: 150, h: 100 },
};

export type Paper = 'a3' | 'a3plus' | 'a4';
export const PAPERS: Paper[] = ['a3', 'a3plus', 'a4'];

export const PAPER: Record<Paper, { label: string; w: number; h: number; dialog: string }> = {
  a3: { label: 'A3', w: 297, h: 420, dialog: 'paper A3 (297 × 420 mm)' },
  a3plus: { label: 'A3+', w: 329, h: 483, dialog: 'paper A3+ (13 × 19 in, 329 × 483 mm)' },
  a4: { label: 'A4', w: 210, h: 297, dialog: 'paper A4' },
};

/** The least space between the paper's edge and the passes, in mm: printers can't print right to the edge. */
export const MARGIN = 3;

export interface SheetPlan {
  paper: { w: number; h: number };
  perSheet: number;
  /** Each pass's spot, filled in this order: its top-left corner in mm; `turn`: turned a quarter (the spot is h × w). */
  slots: { x: number; y: number; turn: boolean }[];
  /** Cut lines in mm: along every edge of every pass, out to the paper's edge but never across a pass. */
  cuts: { x1: number; y1: number; x2: number; y2: number }[];
}

/** A block of passes all one way round: `cols` × `rows` spots of w × h. */
interface Grid { turn: boolean; w: number; h: number; cols: number; rows: number }
const count = (g: Grid | null) => (g ? g.cols * g.rows : 0);
const fits = (room: number, size: number) => Math.floor(room / size + 1e-9);

/** The most passes that fit in a W × H area all one way round (upright when it's a tie), or null if none. */
function bestGrid(card: { w: number; h: number }, W: number, H: number): Grid | null {
  let best: Grid | null = null;
  for (const turn of [false, true]) {
    const [w, h] = turn ? [card.h, card.w] : [card.w, card.h];
    const g = { turn, w, h, cols: fits(W, w), rows: fits(H, h) };
    if (count(g) > count(best)) best = g;
  }
  return best;
}

/** Mobile passes all face one way on a sheet (the user's choice): no second block of them turned. */
const ONE_WAY: readonly Layout[] = ['mobile'];

/**
 * Where each pass goes on one sheet. The passes touch, so one cut separates two, and keep MARGIN from
 * the paper's edge. A main block all one way round; if a strip of paper is left beside or below it, a
 * second block fills it with passes turned the other way, touching the first (cut the line between
 * the two blocks first, then each block), except for ONE_WAY passes. Whatever fits most; a single
 * block when that fits as many. The whole is centred on the sheet.
 */
export function sheetPlan(paper: Paper, layout: Layout): SheetPlan {
  const p = PAPER[paper];
  const card = CARD_SIZE[layout];
  const [W, H] = [p.w - 2 * MARGIN, p.h - 2 * MARGIN];

  let best: { main: Grid; strip: Grid | null; side: 'right' | 'below' } | null = null;
  const consider = (main: Grid, strip: Grid | null, side: 'right' | 'below') => {
    const n = count(main) + count(strip);
    const bestN = best ? count(best.main) + count(best.strip) : 0;
    if (n > bestN || (best && n === bestN && count(strip) < count(best.strip))) best = { main, strip, side };
  };
  const oneWay = ONE_WAY.includes(layout);
  for (const turn of [false, true]) {
    const [w, h] = turn ? [card.h, card.w] : [card.w, card.h];
    const [maxCols, maxRows] = [fits(W, w), fits(H, h)];
    if (!maxCols || !maxRows) continue;
    if (oneWay) {
      consider({ turn, w, h, cols: maxCols, rows: maxRows }, null, 'right');
      continue;
    }
    for (let cols = maxCols; cols >= 1; cols--) consider({ turn, w, h, cols, rows: maxRows }, bestGrid(card, W - cols * w, H), 'right');
    for (let rows = maxRows; rows >= 1; rows--) consider({ turn, w, h, cols: maxCols, rows }, bestGrid(card, W, H - rows * h), 'below');
  }
  if (!best) throw new Error(`A ${layout} pass doesn't fit on ${p.label}`);
  const { main, strip, side } = best as { main: Grid; strip: Grid | null; side: 'right' | 'below' };

  const [mainW, mainH] = [main.cols * main.w, main.rows * main.h];
  const [stripW, stripH] = strip ? [strip.cols * strip.w, strip.rows * strip.h] : [0, 0];
  const right = side === 'right';
  const [boxW, boxH] = right ? [mainW + stripW, Math.max(mainH, stripH)] : [Math.max(mainW, stripW), mainH + stripH];
  const left = (p.w - boxW) / 2;
  const top = (p.h - boxH) / 2;
  // Each block, and how far its cut lines reach: out to the paper's edge, but not into the other block.
  const [xb, yb] = [left + mainW, top + mainH];
  const blocks = [{ g: main, x: left, y: top, across: [0, strip && right ? xb : p.w], down: [0, strip && !right ? yb : p.h] }];
  if (strip) blocks.push(right
    ? { g: strip, x: xb, y: top, across: [xb, p.w], down: [0, p.h] }
    : { g: strip, x: left, y: yb, across: [0, p.w], down: [yb, p.h] });

  const slots: SheetPlan['slots'] = [];
  const cuts = new Map<string, SheetPlan['cuts'][number]>();
  const cut = (x1: number, y1: number, x2: number, y2: number) => cuts.set([x1, y1, x2, y2].map((n) => n.toFixed(3)).join(' '), { x1, y1, x2, y2 });
  for (const { g, x, y, across, down } of blocks) {
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) slots.push({ x: x + c * g.w, y: y + r * g.h, turn: g.turn });
    for (let c = 0; c <= g.cols; c++) cut(x + c * g.w, down[0], x + c * g.w, down[1]);
    for (let r = 0; r <= g.rows; r++) cut(across[0], y + r * g.h, across[1], y + r * g.h);
  }
  return { paper: { w: p.w, h: p.h }, perSheet: slots.length, slots, cuts: [...cuts.values()] };
}
