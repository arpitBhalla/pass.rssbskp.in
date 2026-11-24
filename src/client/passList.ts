'use client';
import { useSyncExternalStore } from 'react';
import { isPassType, MAX_SERIAL, type PassType } from '@/shared/types';

/** A pass by its sheet and serial. */
export interface PassItem { type: PassType; serial: number }

const NONE: readonly PassItem[] = [];
const keyOf = (x: PassItem) => `${x.type}:${x.serial}`;

/**
 * A list of passes kept in this browser (localStorage under `key`), each once, in the order added: a reload or a
 * second tab keeps it. The print queue (printQueue.ts) and the passes scanned for a packet (Packets page).
 */
export function passList(key: string) {
  /** Read from localStorage once (on first use in the browser), then kept here and written back on each change. */
  let items: readonly PassItem[] | null = null;
  const listeners = new Set<() => void>();

  /** What's saved, keeping only well-formed entries, each once. */
  function load(): readonly PassItem[] {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      if (!Array.isArray(raw)) return NONE;
      const seen = new Set<string>();
      return raw.flatMap((x): PassItem[] => {
        const { type, serial } = (x ?? {}) as Partial<PassItem>;
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

  function update(next: readonly PassItem[]) {
    items = next;
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode or full: kept on this page only */ }
    for (const fn of listeners) fn();
  }

  function subscribe(fn: () => void) {
    listeners.add(fn);
    // Another tab of this browser changed the list: show it here too.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key && e.key !== null) return;
      items = load();
      fn();
    };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
  }

  return {
    get,
    subscribe,
    /** Adds these, each once. Returns how many weren't in it already. */
    add(add: readonly PassItem[]): number {
      const now = get();
      const have = new Set(now.map(keyOf));
      const fresh: PassItem[] = [];
      for (const { type, serial } of add) {
        if (have.has(keyOf({ type, serial }))) continue;
        have.add(keyOf({ type, serial }));
        fresh.push({ type, serial });
      }
      if (fresh.length) update([...now, ...fresh]);
      return fresh.length;
    },
    remove(gone: readonly PassItem[]) {
      const now = get();
      const out = new Set(gone.map(keyOf));
      const next = now.filter((x) => !out.has(keyOf(x)));
      if (next.length !== now.length) update(next);
    },
    clear() {
      if (get().length) update(NONE);
    },
    /** The list, kept up to date in a component. */
    use: () => useSyncExternalStore(subscribe, get, () => NONE),
  };
}
