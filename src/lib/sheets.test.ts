import { describe, expect, it } from 'vitest';
import { CARD_SIZE, MARGIN, PAPERS, sheetPlan } from './sheets';

const LAYOUTS = ['mobile', 'bike', 'vehicle', 'gate', 'helpline'] as const;

describe('sheetPlan', () => {
  it('fits 72 Mobile, 8 Bike, 4 Sewa / Tractor and 6 gate passes on A3; 91, 9, 4 and 9 on A3+; 32, 4, 2 and 2 on A4', () => {
    const counts = (paper: (typeof PAPERS)[number]) => LAYOUTS.map((l) => sheetPlan(paper, l).perSheet);
    expect(counts('a3')).toEqual([72, 8, 4, 6, 4]);
    expect(counts('a3plus')).toEqual([91, 9, 4, 9, 4]);
    expect(counts('a4')).toEqual([32, 4, 2, 2, 2]);
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

  it('keeps every pass inside the margin, touching, never overlapping, centred, with a cut along every edge and none across a pass', () => {
    for (const paper of PAPERS) {
      for (const layout of LAYOUTS) {
        const s = sheetPlan(paper, layout);
        const c = CARD_SIZE[layout];
        const rects = s.slots.map((o) => ({ x: o.x, y: o.y, w: o.turn ? c.h : c.w, h: o.turn ? c.w : c.h }));
        const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
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
