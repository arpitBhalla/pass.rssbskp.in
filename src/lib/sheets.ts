import type { Layout } from '@/shared/types';

/**
 * Pass sizes in mm (per A3 / A3+ / A4 sheet: Mobile 72 / 91 / 32, Bike 8 / 9 / 4, Sewa Vehicle 4 / 4 / 2,
 * the gate passes 6 / 9 / 2, Tractor Trolley and the Free Helpline Sewa passes 2 / 4 / 1).
 */
export const CARD_SIZE: Record<Layout, { w: number; h: number }> = {
  mobile: { w: 36, h: 45 },
  /** The largest that fits 4 to an A4 sheet (2 × 2, turned, inside MARGIN). */
  bike: { w: 145, h: 99 },
  /**
   * Sewa Vehicle: half an A4 sheet, the largest that fits 2 to an A4 inside MARGIN (150 × 100 until
   * 2026-11-15; Tractor Trolley too until 2026-11-16).
   */
  vehicle: { w: 204, h: 145 },
  /**
   * Gate 3 Entry, Gate 1 & 11, VIP and Admin: the largest of the Bike pass's shape that fits 6 to an A3
   * (4 upright, 2 turned beside them; the owner, 2026-11-15; 145 × 99, 8 to an A3, before that).
   */
  gate: { w: 151, h: 103 },
  /**
   * Tractor Trolley, E-Rickshaw, Eco and Metro: the owner asked for 232 wide (2026-11-17), printed on A3+
   * with 5 mm of margin and 2 mm between the passes (MARGINS, GAP); 158 high is the most that then puts 4
   * on an A3+ (2 × 2, turned). 2 to an A3, one over the other. (204 × 145, 4 to an A3, until then.)
   */
  large: { w: 232, h: 158 },
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
/** More for some passes: the large ones keep 5 mm (the owner, 2026-11-17). */
const MARGINS: Partial<Record<Layout, number>> = { large: 5 };
export const marginOf = (layout: Layout) => MARGINS[layout] ?? MARGIN;

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
 * Space between passes on a sheet, in mm, by layout and paper: none (they touch, one cut separates two) but
 * for the large passes, 2 mm apart on every paper (the owner, 2026-11-17).
 */
const GAP: Partial<Record<Layout, Partial<Record<Paper, number>>>> = { large: { a3: 2, a3plus: 2, a4: 2 } };

/**
 * Where each pass goes on one sheet. The passes touch, so one cut separates two (or stand GAP apart, two
 * cuts between them), and keep their margin (marginOf) from the paper's edge. A main block all one way round; if a strip of
 * paper is left beside or below it, a second block fills it with passes turned the other way, touching the first (cut the line between
 * the two blocks first, then each block), except for ONE_WAY passes. Whatever fits most; a single
 * block when that fits as many. The whole is centred on the sheet.
 */
export function sheetPlan(paper: Paper, layout: Layout): SheetPlan {
  const p = PAPER[paper];
  const gap = GAP[layout]?.[paper] ?? 0;
  /** Each pass with the gap after it, in room that much bigger: n passes fit when n × (size + gap) ≤ room + gap. */
  const card = { w: CARD_SIZE[layout].w + gap, h: CARD_SIZE[layout].h + gap };
  const margin = marginOf(layout);
  const [W, H] = [p.w - 2 * margin + gap, p.h - 2 * margin + gap];

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

  /** A block's size on paper: its spots less the gap after the last. */
  const [mainW, mainH] = [main.cols * main.w - gap, main.rows * main.h - gap];
  const [stripW, stripH] = strip ? [strip.cols * strip.w - gap, strip.rows * strip.h - gap] : [0, 0];
  const right = side === 'right';
  const [boxW, boxH] = !strip ? [mainW, mainH] : right ? [mainW + gap + stripW, Math.max(mainH, stripH)] : [Math.max(mainW, stripW), mainH + gap + stripH];
  const left = (p.w - boxW) / 2;
  const top = (p.h - boxH) / 2;
  // Each block, and how far its cut lines reach: out to the paper's edge, but not into the other block.
  const [xb, yb] = [left + mainW + gap, top + mainH + gap];
  const blocks = [{ g: main, x: left, y: top, across: [0, strip && right ? xb : p.w], down: [0, strip && !right ? yb : p.h] }];
  if (strip) blocks.push(right
    ? { g: strip, x: xb, y: top, across: [xb, p.w], down: [0, p.h] }
    : { g: strip, x: left, y: yb, across: [0, p.w], down: [yb, p.h] });

  const slots: SheetPlan['slots'] = [];
  const cuts = new Map<string, SheetPlan['cuts'][number]>();
  const cut = (x1: number, y1: number, x2: number, y2: number) => cuts.set([x1, y1, x2, y2].map((n) => n.toFixed(3)).join(' '), { x1, y1, x2, y2 });
  for (const { g, x, y, across, down } of blocks) {
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) slots.push({ x: x + c * g.w, y: y + r * g.h, turn: g.turn });
    // Along both edges of every column and row (one line where passes touch).
    for (let c = 0; c < g.cols; c++) for (const cx of [x + c * g.w, x + (c + 1) * g.w - gap]) cut(cx, down[0], cx, down[1]);
    for (let r = 0; r < g.rows; r++) for (const cy of [y + r * g.h, y + (r + 1) * g.h - gap]) cut(across[0], cy, across[1], cy);
  }
  return { paper: { w: p.w, h: p.h }, perSheet: slots.length, slots, cuts: [...cuts.values()] };
}
