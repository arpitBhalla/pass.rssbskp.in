'use client';
import { useSyncExternalStore } from 'react';
import { isPassType, MAX_SERIAL, type PassType } from '@/shared/types';

/**
 * The print queue: passes waiting to be printed, kept in this browser (localStorage) since 2026-11-23, so a
 * reload or a second tab keeps it (the owner; it was this tab's memory only). Nothing is lost if it is cleared:
 * the passes stay unprinted in the register. Passes of the same size print together on one paper sheet (Mobile
 * Pandal with Non Pandal, the car passes, …), so a sheet fills sooner; printed all together, passes of different
 * sizes share sheets too (pagesFor in lib/sheets.ts).
 */
export interface QueueItem { type: PassType; serial: number }

const KEY = 'passes.printQueue';
const NONE: readonly QueueItem[] = [];
/** Read from localStorage once (on first use in the browser), then kept here and written back on each change. */
let items: readonly QueueItem[] | null = null;
const listeners = new Set<() => void>();
const keyOf = (x: QueueItem) => `${x.type}:${x.serial}`;

/** What's saved, keeping only well-formed entries, each once. */
function load(): readonly QueueItem[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return NONE;
    const seen = new Set<string>();
    return raw.flatMap((x): QueueItem[] => {
      const { type, serial } = (x ?? {}) as Partial<QueueItem>;
      if (!isPassType(type) || !Number.isInteger(serial) || serial! < 1 || serial! > MAX_SERIAL) return [];
      const k = keyOf({ type, serial: serial! });
      if (seen.has(k)) return [];
      seen.add(k);
      return [{ type, serial: serial! }];
    });
  } catch {
    return NONE; // unreadable, or no storage (private mode): start empty
  }
}
const get = () => (items ??= load());

function update(next: readonly QueueItem[]) {
  items = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode or full: kept on this page only */ }
  for (const fn of listeners) fn();
}

export const printQueue = {
  get,
  subscribe(fn: () => void) {
    listeners.add(fn);
    // Another tab of this browser changed the queue: show it here too.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY && e.key !== null) return;
      items = load();
      fn();
    };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
  },
  /** Adds these, each once. Returns how many weren't in it already. */
  add(add: readonly QueueItem[]): number {
    const now = get();
    const have = new Set(now.map(keyOf));
    const fresh: QueueItem[] = [];
    for (const { type, serial } of add) {
      if (have.has(keyOf({ type, serial }))) continue;
      have.add(keyOf({ type, serial }));
      fresh.push({ type, serial });
    }
    if (fresh.length) update([...now, ...fresh]);
    return fresh.length;
  },
  remove(gone: readonly QueueItem[]) {
    const now = get();
    const out = new Set(gone.map(keyOf));
    const next = now.filter((x) => !out.has(keyOf(x)));
    if (next.length !== now.length) update(next);
  },
};

export const usePrintQueue = () => useSyncExternalStore(printQueue.subscribe, printQueue.get, () => NONE);
