'use client';
import { useSyncExternalStore } from 'react';
import { type Paper, PAPERS } from '@/lib/sheets';

/** The paper this desk prints on (A3 unless changed), remembered in this browser. */
const KEY = 'passes.paper';
const listeners = new Set<() => void>();
let chosen: Paper | null = null;

function read(): Paper {
  if (chosen) return chosen;
  try {
    const v = localStorage.getItem(KEY);
    return PAPERS.includes(v as Paper) ? (v as Paper) : 'a3';
  } catch {
    return 'a3';
  }
}

export function setPaper(p: Paper) {
  chosen = p;
  try { localStorage.setItem(KEY, p); } catch { /* private mode: just this page */ }
  listeners.forEach((l) => l());
}

export function usePaper(): Paper {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    read,
    () => 'a3',
  );
}
