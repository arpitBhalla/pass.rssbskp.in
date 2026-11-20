'use client';
import { useSyncExternalStore } from 'react';
import type { PassType } from '@/shared/types';

/**
 * The print queue: passes waiting to be printed, kept in this tab's memory only (the owner, 2026-11-20). A
 * reload empties it; nothing is lost, as the passes stay unprinted in the register. Passes of the same size
 * print together on one paper sheet (Mobile Pandal with Non Pandal, the car passes, …), so a sheet fills sooner.
 */
export interface QueueItem { type: PassType; serial: number }

let items: readonly QueueItem[] = [];
const listeners = new Set<() => void>();
const keyOf = (x: QueueItem) => `${x.type}:${x.serial}`;
function update(next: readonly QueueItem[]) {
  items = next;
  for (const fn of listeners) fn();
}

export const printQueue = {
  get: () => items,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** Adds these, each once. Returns how many weren't in it already. */
  add(add: readonly QueueItem[]): number {
    const have = new Set(items.map(keyOf));
    const fresh: QueueItem[] = [];
    for (const { type, serial } of add) {
      if (have.has(keyOf({ type, serial }))) continue;
      have.add(keyOf({ type, serial }));
      fresh.push({ type, serial });
    }
    if (fresh.length) update([...items, ...fresh]);
    return fresh.length;
  },
  remove(gone: readonly QueueItem[]) {
    const out = new Set(gone.map(keyOf));
    const next = items.filter((x) => !out.has(keyOf(x)));
    if (next.length !== items.length) update(next);
  },
};

const NONE: readonly QueueItem[] = [];
export const usePrintQueue = () => useSyncExternalStore(printQueue.subscribe, printQueue.get, () => NONE);
