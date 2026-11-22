import { describe, expect, it } from 'vitest';
import { CARD_SIZE, marginOf, pagesFor, PAPERS, sheetPlan } from './sheets';

const LAYOUTS = ['mobile', 'bike', 'vehicle', 'gate', 'large'] as const;

describe('sheetPlan', () => {
  it('fits 72 Mobile, 8 Bike, 4 Sewa, 6 gate and 2 large passes on A3; 91, 9, 4, 9 and 4 on A3+; 32, 4, 2, 2 and 1 on A4', () => {
    const counts = (paper: (typeof PAPERS)[number]) => LAYOUTS.map((l) => sheetPlan(paper, l).perSheet);
    expect(counts('a3')).toEqual([72, 8, 4, 6, 2]);
    expect(counts('a3plus')).toEqual([91, 9, 4, 9, 4]); // Tractor Trolley and the helpline passes 2 × 2, 232 × 158 (the owner, 2026-11-17)
    expect(counts('a4')).toEqual([32, 4, 2, 2, 1]);
  });

  it('leaves 2 mm between the large passes and touches everywhere else', () => {
    const gaps = (paper: (typeof PAPERS)[number], l: (typeof LAYOUTS)[number]) => {
      const c = CARD_SIZE[l];
      const r = sheetPlan(paper, l).slots.map((o) => ({ x: o.x, y: o.y, w: o.turn ? c.h : c.w, h: o.turn ? c.w : c.h }));
      return new Set(r.flatMap((a) => r.map((b) => Math.max(b.x - a.x - a.w, b.y - a.y - a.h))).filter((g) => g >= -1e-6).map((g) => g.toFixed(3)));
    };
    for (const paper of PAPERS) for (const l of ['bike', 'vehicle', 'gate', 'large'] as const) {
      if (sheetPlan(paper, l).perSheet > 1) expect(Math.min(...[...gaps(paper, l)].map(Number))).toBeCloseTo(l === 'large' ? 2 : 0);
    }
  });

  it('fills a strip left over with passes turned the other way, except Mobile; one block when that fits as many', () => {
    const turns = (paper: (typeof PAPERS)[number], l: (typeof LAYOUTS)[number]) => new Set(sheetPlan(paper, l).slots.map((s) => s.turn)).size;
    for (const paper of PAPERS) expect(turns(paper, 'mobile')).toBe(1); // all one way, even where turned ones would fit
    expect(turns('a3', 'bike')).toBe(1);
    expect(turns('a3', 'gate')).toBe(2); // 151 × 103: 4 upright, 2 turned beside them
    expect(turns('a3plus', 'gate')).toBe(1);
    expect(turns('a3', 'vehicle')).toBe(1); // 204 × 145: four, all turned
    // No pass size today leaves such a strip on A3, so try the vehicle passes' old size, 150 × 100:
    // 4 upright and 2 turned beside them on A3, all one way on A3+.
    const was = CARD_SIZE.vehicle;
    CARD_SIZE.vehicle = { w: 150, h: 100 };
    try {
      expect(turns('a3', 'vehicle')).toBe(2);
      expect(sheetPlan('a3', 'vehicle').perSheet).toBe(6);
      expect(turns('a3plus', 'vehicle')).toBe(1);
    } finally {
      CARD_SIZE.vehicle = was;
    }
  });

  it('keeps every pass inside the margin, never overlapping, centred, with a cut along every edge and none across a pass', () => {
    for (const paper of PAPERS) {
      for (const layout of LAYOUTS) {
        const s = sheetPlan(paper, layout);
        const c = CARD_SIZE[layout];
        const rects = s.slots.map((o) => ({ x: o.x, y: o.y, w: o.turn ? c.h : c.w, h: o.turn ? c.w : c.h }));
        const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
        const MARGIN = marginOf(layout);
        for (const [i, a] of rects.entries()) {
          expect(a.x).toBeGreaterThanOrEqual(MARGIN - 1e-9);
          expect(a.y).toBeGreaterThanOrEqual(MARGIN - 1e-9);
          expect(a.x + a.w).toBeLessThanOrEqual(s.paper.w - MARGIN + 1e-9);
          expect(a.y + a.h).toBeLessThanOrEqual(s.paper.h - MARGIN + 1e-9);
          for (const b of rects.slice(i + 1)) {
            expect(b.x >= a.x + a.w - 1e-6 || a.x >= b.x + b.w - 1e-6 || b.y >= a.y + a.h - 1e-6 || a.y >= b.y + b.h - 1e-6).toBe(true);
          }
          // Every edge is on a cut line that runs its whole length.
          const along = (x1: number, y1: number, x2: number, y2: number) => s.cuts.some((k) => (x1 === x2
            ? eq(k.x1, x1) && eq(k.x2, x1) && k.y1 <= y1 + 1e-6 && k.y2 >= y2 - 1e-6
            : eq(k.y1, y1) && eq(k.y2, y1) && k.x1 <= x1 + 1e-6 && k.x2 >= x2 - 1e-6));
          expect(along(a.x, a.y, a.x, a.y + a.h) && along(a.x + a.w, a.y, a.x + a.w, a.y + a.h)).toBe(true);
          expect(along(a.x, a.y, a.x + a.w, a.y) && along(a.x, a.y + a.h, a.x + a.w, a.y + a.h)).toBe(true);
          // No cut line crosses the inside of a pass.
          for (const k of s.cuts) {
            const crosses = k.x1 === k.x2
              ? k.x1 > a.x + 1e-6 && k.x1 < a.x + a.w - 1e-6 && Math.min(k.y2, a.y + a.h) - Math.max(k.y1, a.y) > 1e-6
              : k.y1 > a.y + 1e-6 && k.y1 < a.y + a.h - 1e-6 && Math.min(k.x2, a.x + a.w) - Math.max(k.x1, a.x) > 1e-6;
            expect(crosses).toBe(false);
          }
        }
        const [x0, x1] = [Math.min(...rects.map((r) => r.x)), Math.max(...rects.map((r) => r.x + r.w))];
        const [y0, y1] = [Math.min(...rects.map((r) => r.y)), Math.max(...rects.map((r) => r.y + r.h))];
        expect(s.paper.w - x1).toBeCloseTo(x0);
        expect(s.paper.h - y1).toBeCloseTo(y0);
      }
    }
  });
});

describe('pagesFor (the print queue: passes of several sizes)', () => {
  type L = (typeof LAYOUTS)[number];
  const cards = (mix: Partial<Record<L, number>>) => Object.entries(mix).flatMap(([l, n]) => Array<L>(n!).fill(l as L));
  const sizes = (layouts: L[], page: ReturnType<typeof pagesFor>[number]) => {
    const n: Partial<Record<L, number>> = {};
    for (const it of page.items) n[layouts[it.i]] = (n[layouts[it.i]] ?? 0) + 1;
    return n;
  };

  it('prints one size on its usual sheets', () => {
    for (const paper of PAPERS) for (const l of LAYOUTS) {
      const plan = sheetPlan(paper, l);
      const pages = pagesFor(paper, Array<L>(plan.perSheet + 1).fill(l));
      expect(pages.map((p) => p.items.length)).toEqual([plan.perSheet, 1]);
      expect(pages[0].items.map(({ x, y, turn }) => ({ x, y, turn }))).toEqual(plan.slots);
    }
  });

  it('puts 1 Sewa Vehicle and 40 Mobile on one A3; with 50 Mobile, 48 of them share its sheet', () => {
    const a = cards({ vehicle: 1, mobile: 40 });
    expect(pagesFor('a3', a).map((p) => sizes(a, p))).toEqual([{ vehicle: 1, mobile: 40 }]);
    const b = cards({ vehicle: 1, mobile: 50 });
    expect(pagesFor('a3', b).map((p) => sizes(b, p))).toEqual([{ vehicle: 1, mobile: 48 }, { mobile: 2 }]);
  });

  it('prints full sheets of a size as usual and mixes what is left; never more sheets than printing apart', () => {
    const c = cards({ vehicle: 1, mobile: 200 });
    const pages = pagesFor('a3', c);
    expect(pages.map((p) => sizes(c, p))).toEqual([{ mobile: 72 }, { mobile: 72 }, { vehicle: 1, mobile: 48 }, { mobile: 8 }]);
    const mixes: Partial<Record<L, number>>[] = [
      { large: 1, vehicle: 3, gate: 5, bike: 7, mobile: 71 }, { large: 1, mobile: 5 }, { gate: 3, mobile: 40 }, { bike: 5, mobile: 20 },
      { large: 3, gate: 2 }, { vehicle: 3, bike: 3, mobile: 100 },
    ];
    for (const paper of PAPERS) for (const mix of mixes) {
      const apart = Object.entries(mix).reduce((n, [l, k]) => n + Math.ceil(k! / sheetPlan(paper, l as L).perSheet), 0);
      expect(pagesFor(paper, cards(mix)).length).toBeLessThanOrEqual(apart);
    }
  });

  it('places every pass once, inside the margin, one way round on a mixed sheet, apart, with cuts along every edge and none across a pass', () => {
    const mixes: Partial<Record<L, number>>[] = [
      { large: 1, vehicle: 3, gate: 5, bike: 7, mobile: 71 }, { large: 1, mobile: 40 }, { vehicle: 2, mobile: 30 }, { gate: 3, bike: 1, mobile: 9 },
    ];
    const e = 1e-6;
    for (const paper of PAPERS) for (const mix of mixes) {
      const layouts = cards(mix);
      const pages = pagesFor(paper, layouts);
      expect(pages.flatMap((p) => p.items.map((it) => it.i)).sort((a, b) => a - b)).toEqual(layouts.map((_, i) => i));
      for (const page of pages) {
        const rects = page.items.map((it) => {
          const c = CARD_SIZE[layouts[it.i]];
          return { l: layouts[it.i], x: it.x, y: it.y, w: it.turn ? c.h : c.w, h: it.turn ? c.w : c.h };
        });
        if (new Set(rects.map((r) => r.l)).size > 1) expect(new Set(page.items.map((it) => it.turn)).size).toBe(1);
        for (const [k, a] of rects.entries()) {
          const m = 3;
          expect(a.x).toBeGreaterThanOrEqual(m - e);
          expect(a.y).toBeGreaterThanOrEqual(m - e);
          expect(a.x + a.w).toBeLessThanOrEqual(page.paper.w - m + e);
          expect(a.y + a.h).toBeLessThanOrEqual(page.paper.h - m + e);
          for (const b of rects.slice(k + 1)) {
            // Apart: touching, or 2 mm when a large pass is one of the two.
            const gap = Math.max(b.x - a.x - a.w, a.x - b.x - b.w, b.y - a.y - a.h, a.y - b.y - b.h);
            expect(gap).toBeGreaterThanOrEqual((a.l === 'large' || b.l === 'large' ? 2 : 0) - e);
          }
          const on = (x1: number, y1: number, x2: number, y2: number) => page.cuts.some((c) => (x1 === x2
            ? Math.abs(c.x1 - x1) < e && Math.abs(c.x2 - x1) < e && c.y1 <= y1 + e && c.y2 >= y2 - e
            : Math.abs(c.y1 - y1) < e && Math.abs(c.y2 - y1) < e && c.x1 <= x1 + e && c.x2 >= x2 - e));
          expect(on(a.x, a.y, a.x, a.y + a.h) && on(a.x + a.w, a.y, a.x + a.w, a.y + a.h)).toBe(true);
          expect(on(a.x, a.y, a.x + a.w, a.y) && on(a.x, a.y + a.h, a.x + a.w, a.y + a.h)).toBe(true);
          for (const c of page.cuts) {
            const crosses = c.x1 === c.x2
              ? c.x1 > a.x + e && c.x1 < a.x + a.w - e && Math.min(c.y2, a.y + a.h) - Math.max(c.y1, a.y) > e
              : c.y1 > a.y + e && c.y1 < a.y + a.h - e && Math.min(c.x2, a.x + a.w) - Math.max(c.x1, a.x) > e;
            expect(crosses).toBe(false);
          }
        }
      }
    }
  });
});
