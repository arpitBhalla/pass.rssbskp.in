'use client';
import { type LostPlan, ranges } from '@/lib/passes';
import { type PassType, TYPE_INFO } from '@/shared/types';
import { useActions } from './actions';
import { toast } from './toast';

/**
 * Marking printed passes LOST, with a duplicate of each (same details, at the end of the sheet, to print) or without, and
 * adding a duplicate later to a lost pass that has none (the owner, 2026-11-24). Each is one change in History: Undo takes it back.
 */
export function useLost() {
  const { apply } = useActions();
  const markLost = async (type: PassType, lost: LostPlan, withCopies: boolean) => {
    if (!lost.set.length) return;
    const s = lost.set.length === 1 ? '' : 's';
    const r = await apply(
      {
        action: 'lost', next: withCopies, summary: `Marked ${TYPE_INFO[type].label} ${ranges(lost.serials)} LOST${withCopies ? `; duplicate${s} added` : ''}`,
        set: lost.set, ...(withCopies && { create: lost.create }),
      },
      { toast: false },
    );
    if (!r) return;
    if (!withCopies) { toast(`${ranges(lost.serials)} marked LOST. No duplicate${s}: select ${s ? 'them' : 'it'} in the sheet and Add duplicate if needed.`); return; }
    const made = r.rows.filter((p) => r.created.includes(p.id)).map((p) => p.serial);
    toast(`${ranges(lost.serials)} marked LOST. Duplicate${s} added as ${ranges(made)}: print ${s ? 'them' : 'it'} and hand over.`);
  };
  const addCopies = async (type: PassType, lost: LostPlan) => {
    if (!lost.again.length) return;
    const s = lost.again.length === 1 ? '' : 's';
    const r = await apply(
      { action: 'lost', next: true, summary: `Duplicate${s} of lost ${TYPE_INFO[type].label} ${ranges(lost.againSerials)} added`, create: lost.again },
      { toast: false },
    );
    if (!r) return;
    const made = r.rows.filter((p) => r.created.includes(p.id)).map((p) => p.serial);
    toast(`Duplicate${s} of ${ranges(lost.againSerials)} added as ${ranges(made)}: print ${s ? 'them' : 'it'} and hand over.`);
  };
  return { markLost, addCopies };
}
