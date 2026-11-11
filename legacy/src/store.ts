import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pass, PrintSettings } from './types';
import { normalize, sortPasses } from './lib/passes';

const STORAGE_KEY = 'pass-register-v1';
const MAX_UNDO = 50;

function load(): Pass[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return sortPasses(data.map(normalize).filter((p): p is Pass => p !== null));
  } catch {
    return [];
  }
}

interface State {
  passes: Pass[];
  undo: Pass[][];
}

/** The pass register, saved to this browser's localStorage, with undo. */
export function usePassStore() {
  const [state, setState] = useState<State>(() => ({ passes: load(), undo: [] }));
  const [saveError, setSaveError] = useState('');
  const latest = useRef(state); // so several changes in a row each build on the previous one

  const apply = useCallback((next: State) => {
    latest.current = next;
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.passes));
      setSaveError('');
    } catch (e) {
      setSaveError(`Could not save in this browser (${(e as Error).message}). Export to Excel now to keep your work.`);
    }
  }, []);

  // If the register is open in two tabs, pick up changes made in the other one.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      latest.current = { passes: load(), undo: [] };
      setState(latest.current);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Applies a change; records an undo step only if something actually changed. */
  const commit = useCallback((fn: (prev: Pass[]) => Pass[]) => {
    const s = latest.current;
    const next = fn(s.passes);
    if (next !== s.passes) apply({ passes: next, undo: [...s.undo.slice(-(MAX_UNDO - 1)), s.passes] });
  }, [apply]);

  const undo = useCallback(() => {
    const s = latest.current;
    if (s.undo.length) apply({ passes: s.undo[s.undo.length - 1], undo: s.undo.slice(0, -1) });
  }, [apply]);

  return { passes: state.passes, canUndo: state.undo.length > 0, commit, undo, saveError };
}

const SETTINGS_KEY = 'pass-print-settings-v1';
const DEFAULT_SETTINGS: PrintSettings = { zone: 'inside', event: '', validTill: '', signature: '' };

/** Print options (zone, event text, valid till, signature), remembered in this browser. */
export function usePrintSettings() {
  const [settings, setSettings] = useState<PrintSettings>(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const update = (patch: Partial<PrintSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage full: keep for this session only */ }
  };
  return [settings, update] as const;
}
