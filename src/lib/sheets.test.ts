import { describe, expect, it } from 'vitest';
import { CARD_SIZE, PAPERS, sheetPlan } from './sheets';

describe('sheetPlan', () => {
  it('fits 25 Mobile, 25 Bike and 9 vehicle passes on A3+, and the A4 counts as before', () => {
    expect(sheetPlan('a3plus', 'mobile').perSheet).toBe(25);
    expect(sheetPlan('a3plus', 'bike').perSheet).toBe(25);
    expect(sheetPlan('a3plus', 'vehicle').perSheet).toBe(9);
    expect([sheetPlan('a4', 'mobile').perSheet, sheetPlan('a4', 'bike').perSheet, sheetPlan('a4', 'vehicle').perSheet]).toEqual([9, 8, 2]);
  });

  it('keeps every pass on the sheet with at least 5 mm to the edge, none overlapping', () => {
    for (const paper of PAPERS) {
      for (const layout of ['mobile', 'bike', 'vehicle'] as const) {
        const s = sheetPlan(paper, layout);
        const c = CARD_SIZE[layout];
        const [w, h] = s.turn ? [c.h, c.w] : [c.w, c.h];
        for (const [i, a] of s.slots.entries()) {
          expect(a.x).toBeGreaterThanOrEqual(5);
          expect(a.y).toBeGreaterThanOrEqual(5);
          expect(a.x + w).toBeLessThanOrEqual(s.paper.w - 5);
          expect(a.y + h).toBeLessThanOrEqual(s.paper.h - 5);
          for (const b of s.slots.slice(i + 1)) {
            const apart = b.x >= a.x + w - 1e-9 || a.x >= b.x + w - 1e-9 || b.y >= a.y + h - 1e-9 || a.y >= b.y + h - 1e-9;
            expect(apart).toBe(true);
          }
        }
      }
    }
  });
});
