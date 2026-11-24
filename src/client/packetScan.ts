'use client';
import { useSyncExternalStore } from 'react';
import { passList } from './passList';

/**
 * The passes picked for the next packet, kept in this browser until tagged on the Packets page: scanned there, or
 * picked in a sheet with "Add to packet" (the owner, 2026-11-24). A reload or a break loses nothing.
 */
export const packetScan = passList('passes.packetScan');

/** The name typed for the next packet ('' for the one offered), kept in this browser with the list: the Packets page and the Next packet box share it. */
export const packetName = (() => {
  const key = 'passes.packetName';
  let value: string | null = null;
  const listeners = new Set<() => void>();
  const get = () => (value ??= (() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } })());
  const set = (v: string) => {
    value = v;
    try { localStorage.setItem(key, v); } catch { /* kept on this page only */ }
    for (const fn of listeners) fn();
  };
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    const onStorage = (e: StorageEvent) => { if (e.key === key || e.key === null) { value = null; fn(); } };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
  };
  return { get, set, use: () => useSyncExternalStore(subscribe, get, () => '') };
})();
