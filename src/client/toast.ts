'use client';
import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** Shows a message at the bottom of the screen. Errors stay longer. */
export function toast(text: string, kind: Toast['kind'] = 'ok') {
  current = { id: ++seq, text, kind };
  clearTimeout(timer);
  timer = setTimeout(() => { current = null; emit(); }, kind === 'error' ? 9000 : 5000);
  emit();
}

export function dismissToast() {
  current = null;
  emit();
}

export const useToast = () =>
  useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => void listeners.delete(fn); },
    () => current,
    () => null,
  );
