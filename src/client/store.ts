'use client';
import { useSyncExternalStore } from 'react';
import { PASS_TYPES, type Pass, type PassType } from '@/shared/types';

export interface Status {
  /** First sync finished. */
  loaded: boolean;
  /** Server reachable on the last sync. */
  online: boolean;
  backupError: string;
  /** This browser tab's last change, if it can be undone. */
  undo: { changeId: number; summary: string } | null;
}

type Counts = Record<PassType, number>;
const EMPTY: Pass[] = [];

/**
 * All passes, kept in sync with the server. Each sheet's array is rebuilt only when one of its
 * passes changes, so components that read a sheet re-render only when that sheet changes.
 */
class PassStore {
  private byType = new Map<PassType, Map<number, Pass>>(PASS_TYPES.map((t) => [t, new Map()]));
  private typeOf = new Map<number, PassType>();
  private sheets = new Map<PassType, Pass[]>();
  private all: Pass[] | null = null;
  private counts: Counts | null = null;
  private listeners = new Set<() => void>();
  private undoStack: { changeId: number; summary: string }[] = [];
  /** Database version this browser has caught up to. */
  rev = 0;
  status: Status = { loaded: false, online: true, backupError: '', undo: null };
  /** Set by the sync loop: fetch changes now. */
  resync: () => void = () => {};

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Applies rows from the server; ignores any older than what's already here. */
  merge(rows: Pass[], deleted: readonly ({ id: number; rev: number } | number)[] = []) {
    const dirty = new Set<PassType>();
    for (const d of deleted) {
      const id = typeof d === 'number' ? d : d.id;
      const t = this.typeOf.get(id);
      const p = t && this.byType.get(t)!.get(id);
      if (!p || (typeof d !== 'number' && p.rev > d.rev)) continue;
      this.byType.get(t)!.delete(id);
      this.typeOf.delete(id);
      dirty.add(t);
    }
    for (const r of rows) {
      const t = this.typeOf.get(r.id);
      const p = t && this.byType.get(t)!.get(r.id);
      if (p && p.rev > r.rev) continue;
      if (t && t !== r.type) { this.byType.get(t)!.delete(r.id); dirty.add(t); }
      this.byType.get(r.type)!.set(r.id, r);
      this.typeOf.set(r.id, r.type);
      dirty.add(r.type);
    }
    if (!dirty.size) return;
    for (const t of dirty) this.sheets.delete(t);
    this.all = null;
    this.counts = null;
    this.emit();
  }

  /** The database was replaced: forget everything. */
  clear() {
    for (const m of this.byType.values()) m.clear();
    this.typeOf.clear();
    this.sheets.clear();
    this.all = null;
    this.counts = null;
    this.undoStack = [];
    this.rev = 0;
    this.setStatus({ undo: null });
  }

  getSheet(type: PassType): Pass[] {
    let s = this.sheets.get(type);
    if (!s) {
      s = [...this.byType.get(type)!.values()].sort((a, b) => a.serial - b.serial);
      this.sheets.set(type, s);
    }
    return s;
  }

  getAll = (): Pass[] => (this.all ??= PASS_TYPES.flatMap((t) => this.getSheet(t)));

  getCounts = (): Counts =>
    (this.counts ??= Object.fromEntries(PASS_TYPES.map((t) => [t, this.byType.get(t)!.size])) as Counts);

  setStatus(patch: Partial<Status>) {
    const next = { ...this.status, ...patch };
    if ((Object.keys(patch) as (keyof Status)[]).every((k) => next[k] === this.status[k])) return;
    this.status = next;
    this.emit();
  }

  pushUndo(changeId: number, summary: string) {
    this.undoStack = [...this.undoStack.slice(-49), { changeId, summary }];
    this.setStatus({ undo: this.undoStack.at(-1)! });
  }
  /** Drops one change from the undo list (it was undone some other way, e.g. from History). */
  forgetUndo(changeId: number) {
    this.undoStack = this.undoStack.filter((u) => u.changeId !== changeId);
    this.setStatus({ undo: this.undoStack.at(-1) ?? null });
  }
}

export const store = new PassStore();

const serverEmpty = () => EMPTY;
export const useSheet = (type: PassType) => useSyncExternalStore(store.subscribe, () => store.getSheet(type), serverEmpty);
export const useAllPasses = () => useSyncExternalStore(store.subscribe, store.getAll, serverEmpty);
export const useCounts = () => useSyncExternalStore(store.subscribe, store.getCounts, store.getCounts);
export const useStatus = () => useSyncExternalStore(store.subscribe, () => store.status, () => store.status);
