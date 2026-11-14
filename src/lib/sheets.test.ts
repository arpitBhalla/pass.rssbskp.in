import { describe, expect, it } from 'vitest';
import { CARD_SIZE, MARGIN, PAPERS, sheetPlan } from './sheets';

describe('sheetPlan', () => {
  it('fits 45 Mobile, 21 Bike and 9 vehicle passes on A3+; 16, 8 and 2 on A4', () => {
    const counts = (paper: 'a3plus' | 'a4') => (['mobile', 'bike', 'vehicle'] as const).map((l) => sheetPlan(paper, l).perSheet);
    expect(counts('a3plus')).toEqual([45, 21, 9]);
    expect(counts('a4')).toEqual([16, 8, 2]);
  });

  it('puts the passes edge to edge, inside the margin, centred, with a cut line on every edge', () => {
    for (const paper of PAPERS) {
      for (const layout of ['mobile', 'bike', 'vehicle'] as const) {
        const s = sheetPlan(paper, layout);
        const c = CARD_SIZE[layout];
        const [w, h] = s.turn ? [c.h, c.w] : [c.w, c.h];
        const { xs, ys } = s.cuts;
        expect(xs[0]).toBeGreaterThanOrEqual(MARGIN);
        expect(ys[0]).toBeGreaterThanOrEqual(MARGIN);
        expect(s.paper.w - xs.at(-1)!).toBeCloseTo(xs[0]);
        expect(s.paper.h - ys.at(-1)!).toBeCloseTo(ys[0]);
        expect((xs.length - 1) * (ys.length - 1)).toBe(s.perSheet);
        for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(w);
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(h);
        for (const slot of s.slots) {
          expect(xs.some((x) => Math.abs(x - slot.x) < 1e-9) && xs.some((x) => Math.abs(x - slot.x - w) < 1e-9)).toBe(true);
          expect(ys.some((y) => Math.abs(y - slot.y) < 1e-9) && ys.some((y) => Math.abs(y - slot.y - h) < 1e-9)).toBe(true);
        }
      }
    }
  });
});
