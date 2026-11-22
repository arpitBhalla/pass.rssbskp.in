'use client';
import { useSyncExternalStore } from 'react';
import { type Hide, HIDES } from '@/lib/passes';

/** The kinds of rows this desk hides (none unless changed), for every sheet, remembered in this browser. */
const KEY = 'passes.hide';
const NOTHING: readonly Hide[] = [];
const listeners = new Set<() => void>();
let chosen: readonly Hide[] | null = null;

function read(): readonly Hide[] {
  if (chosen) return chosen;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    chosen = Array.isArray(v) ? HIDES.filter((h) => v.includes(h)) : NOTHING;
  } catch {
    chosen = NOTHING;
  }
  return chosen;
}

export function setHide(hide: readonly Hide[]) {
  chosen = HIDES.filter((h) => hide.includes(h));
  try { localStorage.setItem(KEY, JSON.stringify(chosen)); } catch { /* private mode: just this page */ }
  listeners.forEach((l) => l());
}

export function useHide(): readonly Hide[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    read,
    () => NOTHING,
  );
}
