'use client';
import { useSyncExternalStore } from 'react';
import { PASS_TYPES, type Pass, type PassType } from '@/shared/types';

/**
 * A change this tab made, for Undo. `before`: the passes it changed, as they were; `hide`: the
 * passes it added. Pushed the moment the change is made; `changeId` arrives when the server saves it.
 */
export interface UndoEntry {
  type: PassType;
  summary: string;
  changeId: number | null;
  before: Pass[];
  hide: number[];
  /** Being undone right now. */
  undoing?: boolean;
}

export interface Status {
  /** First sync finished. */
  loaded: boolean;
  /** Server reachable on the last sync. */
  online: boolean;
  backupError: string;
  /** This tab's changes that can be undone, oldest first (all sheets; each sheet undoes its own). */
  undo: readonly UndoEntry[];
  /** Changes are on screen that the server hasn't confirmed yet. */
  saving: boolean;
}

type Counts = Record<PassType, number>;
const EMPTY: Pass[] = [];

/** Changes this tab made that the server hasn't confirmed yet: shown on top of the server's copy. */
interface Overlay {
  rows: Map<number, Pass>;
  hide: Set<number>;
}

/**
 * All passes, kept in sync with the server. Each sheet's array is rebuilt only when one of its
 * passes changes, so components that read a sheet re-render only when that sheet changes.
 * Unsaved changes (`show`) sit on top of the server's copy until they are saved or refused (`settle`),
 * so the screen changes the moment something is clicked and a sync meanwhile can't undo it.
 */
export class PassStore {
  private byType = new Map<PassType, Map<number, Pass>>(PASS_TYPES.map((t) => [t, new Map()]));
  private typeOf = new Map<number, PassType>();
  private sheets = new Map<PassType, Pass[]>();
  private all: Pass[] | null = null;
  private counts: Counts | null = null;
  private listeners = new Set<() => void>();
  private overlays = new Map<number, Overlay>(); // in the order they were made
  private nextOverlay = 1;
  /** The logged-in user's id, for passes this tab adds before the server answers. */
  me = 0;
  /** Database version this browser has caught up to. */
  rev = 0;
  status: Status = { loaded: false, online: true, backupError: '', undo: [], saving: false };
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

  /** Rebuilds these sheets on next read and tells the components. */
  private touch(types: Iterable<PassType | undefined>) {
    for (const t of types) if (t) this.sheets.delete(t);
    this.all = null;
    this.counts = null;
    this.emit();
  }

  /** The server's copy of a pass. */
  saved(id: number): Pass | undefined {
    const t = this.typeOf.get(id);
    return t && this.byType.get(t)!.get(id);
  }

  /** A pass as shown: the server's copy with this tab's unsaved changes on top. */
  get(id: number): Pass | undefined {
    const layers = [...this.overlays.values()];
    for (let i = layers.length - 1; i >= 0; i--) {
      if (layers[i].hide.has(id)) return undefined;
      const r = layers[i].rows.get(id);
      if (r) return r;
    }
    return this.saved(id);
  }

  /** Shows changed (or new) passes, and hides deleted ones, before the server has them. Returns a handle for `settle`. */
  show(rows: Pass[], hide: number[] = []): number {
    const handle = this.nextOverlay++;
    const types = [...rows.map((r) => r.type), ...hide.map((id) => this.get(id)?.type)];
    this.overlays.set(handle, { rows: new Map(rows.map((r) => [r.id, r])), hide: new Set(hide) });
    this.touch(types);
    return handle;
  }

  /** Takes unsaved changes off the screen: they were saved (and merged) or refused. */
  settle(handle: number) {
    const o = this.overlays.get(handle);
    if (!o) return;
    this.overlays.delete(handle);
    // Looked up after removing the layer: a pass it hid is visible again.
    this.touch([...[...o.rows.values()].map((r) => r.type), ...[...o.hide].map((id) => this.get(id)?.type)]);
  }

  /** A pass this tab added got its real id: unsaved changes made to it since follow it. */
  rename(tempId: number, realId: number) {
    let type: PassType | undefined;
    for (const o of this.overlays.values()) {
      const r = o.rows.get(tempId);
      if (r) {
        o.rows.delete(tempId);
        o.rows.set(realId, { ...r, id: realId });
        type = r.type;
      }
      if (o.hide.delete(tempId)) o.hide.add(realId);
    }
    if (type) this.touch([type]);
  }

  /** The database was replaced: forget everything. */
  clear() {
    for (const m of this.byType.values()) m.clear();
    this.typeOf.clear();
    this.sheets.clear();
    this.all = null;
    this.counts = null;
    this.rev = 0;
    this.setStatus({ undo: [] });
  }

  getSheet(type: PassType): Pass[] {
    let s = this.sheets.get(type);
    if (!s) {
      let m = this.byType.get(type)!;
      if (this.overlays.size) {
        m = new Map(m);
        for (const o of this.overlays.values()) {
          for (const id of o.hide) m.delete(id);
          for (const r of o.rows.values()) if (r.type === type) m.set(r.id, r);
        }
      }
      s = [...m.values()].sort((a, b) => a.serial - b.serial);
      this.sheets.set(type, s);
    }
    return s;
  }

  getAll = (): Pass[] => (this.all ??= PASS_TYPES.flatMap((t) => this.getSheet(t)));

  getCounts = (): Counts =>
    (this.counts ??= Object.fromEntries(PASS_TYPES.map((t) => [t, this.getSheet(t).length])) as Counts);

  setStatus(patch: Partial<Status>) {
    const next = { ...this.status, ...patch };
    if ((Object.keys(patch) as (keyof Status)[]).every((k) => next[k] === this.status[k])) return;
    this.status = next;
    this.emit();
  }

  /** Adds a change to the undo list (the last 50 are kept). Returns it, to fill in or drop later. */
  pushUndo(entry: UndoEntry): UndoEntry {
    this.setStatus({ undo: [...this.status.undo.slice(-49), entry] });
    return entry;
  }
  /** An entry was changed in place: tell the components. */
  touchUndo() {
    this.setStatus({ undo: [...this.status.undo] });
  }
  dropUndo(entry: UndoEntry) {
    this.setStatus({ undo: this.status.undo.filter((u) => u !== entry) });
  }
  /** Drops one change from the undo list (it was undone some other way, e.g. from History). */
  forgetUndo(changeId: number) {
    this.setStatus({ undo: this.status.undo.filter((u) => u.changeId !== changeId) });
  }
  /** What Undo in this sheet would undo: this tab's last change there not already being undone. */
  lastUndo(type: PassType): UndoEntry | undefined {
    return this.status.undo.findLast((u) => u.type === type && !u.undoing);
  }
}

export const store = new PassStore();

const serverEmpty = () => EMPTY;
export const useSheet = (type: PassType) => useSyncExternalStore(store.subscribe, () => store.getSheet(type), serverEmpty);
export const useAllPasses = () => useSyncExternalStore(store.subscribe, store.getAll, serverEmpty);
export const useCounts = () => useSyncExternalStore(store.subscribe, store.getCounts, store.getCounts);
export const useStatus = () => useSyncExternalStore(store.subscribe, () => store.status, () => store.status);
