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

/* ---------------- passes of several sizes on one sheet (the print queue) ---------------- */

/** One printed paper sheet: card `i` (of the cards printed) at x, y, turned a quarter when `turn`. */
export interface PagePlan {
  paper: { w: number; h: number };
  items: { i: number; x: number; y: number; turn: boolean }[];
  cuts: SheetPlan['cuts'];
}

interface Rect { x: number; y: number; w: number; h: number }
/** A pass's spot on a sheet of several sizes: the pass and the gap after it (GAP), all one way round. */
interface Cell { layout: Layout; w: number; h: number; gap: number }
interface Placed { layout: Layout; x: number; y: number }

const capOf = (r: Rect, c: Cell) => fits(r.w, c.w) * fits(r.h, c.h);
const cardArea = (l: Layout) => CARD_SIZE[l].w * CARD_SIZE[l].h;

/**
 * The ways to cut what's left of R once a bw × bh block sits in its top-left corner: across first (at the
 * block's foot, or lower so the strip under the cut holds whole rows of a size still to place), or down
 * first (likewise). Each way is the rectangles it leaves; all straight cuts, so the sheet cuts edge to edge.
 */
function waysToCut(R: Rect, bw: number, bh: number, cells: Cell[]): Rect[][] {
  const ts = new Map<string, number>([[bh.toFixed(3), bh]]);
  const ss = new Map<string, number>([[bw.toFixed(3), bw]]);
  for (const c of cells) {
    for (let k = 0, t = R.h; t >= bh - 1e-9; t = R.h - ++k * c.h) ts.set(Math.max(t, bh).toFixed(3), Math.max(t, bh));
    for (let k = 0, s = R.w; s >= bw - 1e-9; s = R.w - ++k * c.w) ss.set(Math.max(s, bw).toFixed(3), Math.max(s, bw));
  }
  const some = (rs: Rect[]) => rs.filter((r) => r.w > 1e-6 && r.h > 1e-6);
  return [
    ...[...ts.values()].map((t) => some([
      { x: R.x, y: R.y + bh, w: bw, h: t - bh }, { x: R.x + bw, y: R.y, w: R.w - bw, h: t }, { x: R.x, y: R.y + t, w: R.w, h: R.h - t },
    ])),
    ...[...ss.values()].map((s) => some([
      { x: R.x + bw, y: R.y, w: s - bw, h: bh }, { x: R.x, y: R.y + bh, w: s, h: R.h - bh }, { x: R.x + s, y: R.y, w: R.w - s, h: R.h },
    ])),
  ];
}

/**
 * Fills the free rectangles with the passes still to place (`left`, by layout, counted down), in the order of
 * `cells` (biggest first): a block of one size goes in the corner of the rectangle that holds most of them, and
 * the rest of that rectangle is cut in two. With `look`, every way to cut is tried by filling on without
 * looking ahead, and the one that then places the most (by area) is taken; otherwise the one leaving the
 * biggest rectangle.
 */
function fill(start: Rect[], left: Map<Layout, number>, cells: Cell[], look: boolean): Placed[] {
  const out: Placed[] = [];
  let free = [...start];
  for (const [ci, c] of cells.entries()) {
    while ((left.get(c.layout) ?? 0) > 0) {
      let at = -1;
      for (const [r, R] of free.entries()) {
        const cap = capOf(R, c);
        const best = at < 0 ? 0 : capOf(free[at], c);
        if (cap > best || (cap > 0 && cap === best && R.w * R.h < free[at].w * free[at].h)) at = r;
      }
      if (at < 0) break;
      const R = free[at];
      const n = Math.min(left.get(c.layout)!, capOf(R, c));
      const cols = Math.min(fits(R.w, c.w), n);
      const rows = Math.ceil(n / cols);
      for (let k = 0; k < n; k++) out.push({ layout: c.layout, x: R.x + (k % cols) * c.w, y: R.y + Math.floor(k / cols) * c.h });
      left.set(c.layout, left.get(c.layout)! - n);
      const rest = free.filter((_, r) => r !== at);
      const inLast = n - (rows - 1) * cols; // the last row's empty end is free too
      if (inLast < cols) rest.push({ x: R.x + inLast * c.w, y: R.y + (rows - 1) * c.h, w: (cols - inLast) * c.w, h: c.h });
      const todo = cells.slice(ci).filter((x) => (left.get(x.layout) ?? 0) > 0);
      const ways = waysToCut(R, cols * c.w, rows * c.h, look ? todo : []);
      const score = (way: Rect[]) => (look
        ? fill([...rest, ...way], new Map(left), todo, false).reduce((a, p) => a + cardArea(p.layout), 0)
        : Math.max(0, ...way.map((r) => r.w * r.h)));
      let pick = ways[0];
      for (const way of ways) if (score(way) > score(pick) + 1e-6) pick = way;
      free = [...rest, ...pick];
    }
  }
  return out;
}

/** Sheets of passes of several sizes, all one way round (`turn`: all turned a quarter); null if one doesn't fit. */
function packMixed(paper: Paper, counts: Map<Layout, number>, turn: boolean): Placed[][] | null {
  const p = PAPER[paper];
  const layouts = [...counts.keys()];
  const gapOf = (l: Layout) => GAP[l]?.[paper] ?? 0;
  const cells: Cell[] = layouts
    .map((l) => {
      const { w, h } = CARD_SIZE[l];
      return { layout: l, w: (turn ? h : w) + gapOf(l), h: (turn ? w : h) + gapOf(l), gap: gapOf(l) };
    })
    .sort((a, b) => cardArea(b.layout) - cardArea(a.layout));
  const left = new Map(counts);
  const pages: Placed[][] = [];
  while ([...left.values()].some((n) => n > 0)) {
    // The margin (and room for the gap after the last pass) of the sizes still to place: 5 mm only while large passes are left.
    const now = layouts.filter((l) => left.get(l)! > 0);
    const [m, g] = [Math.max(...now.map(marginOf)), Math.max(...now.map(gapOf))];
    const page = fill([{ x: m, y: m, w: p.w - 2 * m + g, h: p.h - 2 * m + g }], left, cells.filter((c) => now.includes(c.layout)), true);
    if (!page.length) return null;
    pages.push(page);
  }
  return pages;
}

/** Cut lines along every edge of every pass, out to the paper's edge but stopping before they'd cross a pass. */
export function cutLines(rects: Rect[], paper: { w: number; h: number }): SheetPlan['cuts'] {
  const e = 1e-6;
  const lines = new Map<string, { at: number; down: boolean; spans: [number, number][] }>();
  const add = (down: boolean, at: number, a: number, b: number) => {
    const key = `${down ? 'x' : 'y'}${at.toFixed(3)}`;
    if (!lines.has(key)) lines.set(key, { at, down, spans: [] });
    lines.get(key)!.spans.push([a, b]);
  };
  for (const r of rects) {
    for (const x of [r.x, r.x + r.w]) {
      let [a, b] = [0, paper.h];
      for (const o of rects) {
        if (!(o.x < x - e && o.x + o.w > x + e)) continue;
        if (o.y + o.h <= r.y + e) a = Math.max(a, o.y + o.h);
        else if (o.y >= r.y + r.h - e) b = Math.min(b, o.y);
      }
      add(true, x, a, b);
    }
    for (const y of [r.y, r.y + r.h]) {
      let [a, b] = [0, paper.w];
      for (const o of rects) {
        if (!(o.y < y - e && o.y + o.h > y + e)) continue;
        if (o.x + o.w <= r.x + e) a = Math.max(a, o.x + o.w);
        else if (o.x >= r.x + r.w - e) b = Math.min(b, o.x);
      }
      add(false, y, a, b);
    }
  }
  const cuts: SheetPlan['cuts'] = [];
  for (const { at, down, spans } of lines.values()) {
    spans.sort((s, t) => s[0] - t[0]);
    let [a, b] = spans[0];
    const push = () => cuts.push(down ? { x1: at, y1: a, x2: at, y2: b } : { x1: a, y1: at, x2: b, y2: at });
    for (const [s, t] of spans.slice(1)) {
      if (s <= b + e) b = Math.max(b, t);
      else { push(); [a, b] = [s, t]; }
    }
    push();
  }
  return cuts;
}

/**
 * The paper sheets for these cards (`layouts[i]`: card i's size). One size: its usual sheets (sheetPlan).
 * Several (the print queue): each size's full sheets as usual, then what's left of every size shares sheets,
 * the biggest passes first and the smaller ones in the space left, every pass one way round (the owner,
 * 2026-11-22: "it should be in same direction"), when that takes no more sheets than printing them apart.
 */
export function pagesFor(paper: Paper, layouts: readonly Layout[]): PagePlan[] {
  const byLayout = new Map<Layout, number[]>();
  layouts.forEach((l, i) => byLayout.set(l, [...(byLayout.get(l) ?? []), i]));
  const usual = (l: Layout, idx: number[]): PagePlan[] => {
    const plan = sheetPlan(paper, l);
    const out: PagePlan[] = [];
    for (let k = 0; k < idx.length; k += plan.perSheet) {
      out.push({ paper: plan.paper, items: idx.slice(k, k + plan.perSheet).map((i, j) => ({ i, ...plan.slots[j] })), cuts: plan.cuts });
    }
    return out;
  };
  const full: PagePlan[] = [];
  const rest = new Map<Layout, number[]>();
  for (const [l, idx] of byLayout) {
    const per = sheetPlan(paper, l).perSheet;
    const k = Math.floor(idx.length / per) * per;
    full.push(...usual(l, idx.slice(0, k)));
    if (k < idx.length) rest.set(l, idx.slice(k));
  }
  const apart = [...rest].flatMap(([l, idx]) => usual(l, idx));
  if (rest.size < 2) return [...full, ...apart];

  const counts = new Map([...rest].map(([l, idx]) => [l, idx.length]));
  let best: { turn: boolean; pages: Placed[][] } | null = null;
  for (const turn of [false, true]) {
    const pages = packMixed(paper, counts, turn);
    if (pages && (!best || pages.length < best.pages.length)) best = { turn, pages };
  }
  if (!best || best.pages.length > apart.length) return [...full, ...apart];

  const p = PAPER[paper];
  const next = new Map([...rest].map(([l, idx]) => [l, [...idx]]));
  const mixed = best.pages.flatMap((placed): PagePlan[] => {
    // A sheet left with passes of one size gets that size's usual layout.
    const sizes = new Set(placed.map((o) => o.layout));
    if (sizes.size === 1) {
      const [l] = sizes;
      return usual(l, next.get(l)!.splice(0, placed.length));
    }
    const rects = placed.map((o) => {
      const { w, h } = CARD_SIZE[o.layout];
      return { ...o, w: best.turn ? h : w, h: best.turn ? w : h };
    });
    // Centred on the sheet.
    const [x0, x1] = [Math.min(...rects.map((r) => r.x)), Math.max(...rects.map((r) => r.x + r.w))];
    const [y0, y1] = [Math.min(...rects.map((r) => r.y)), Math.max(...rects.map((r) => r.y + r.h))];
    const [dx, dy] = [(p.w - (x1 - x0)) / 2 - x0, (p.h - (y1 - y0)) / 2 - y0];
    const moved = rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
    return [{
      paper: { w: p.w, h: p.h },
      items: moved.map((r) => ({ i: next.get(r.layout)!.shift()!, x: r.x, y: r.y, turn: best.turn })),
      cuts: cutLines(moved, p),
    }];
  });
  return [...full, ...mixed];
}
