'use client';
import { useCallback, useEffect } from 'react';
import { blankPass, ranges } from '@/lib/passes';
import {
  type ApplyRequest, type ApplyResult, cleanField, type DeleteRequest, type DeleteResult, type Field, fmtSerial, type Pass, type PassType, TYPE_INFO, type Values,
} from '@/shared/types';
import { FIRST_TEMP_ID, store, type UndoEntry } from './store';
import { toast } from './toast';
import { errorMessage, isConflict, isUnauthorized, useTRPCClient, worthSendingAgain } from './trpc';

const ACTIVE_MS = 5000;
const HIDDEN_MS = 15000;
/** No answer after this long: the request is given up (a save is sent again, a sync tried at the next one). */
const TIMEOUT_MS = 30_000;
/** A change not saved after this long: the connection bar says saving is slow. */
const SLOW_MS = 4000;

/* ----- one request at a time ----- */
// This tab sends its requests to the server one at a time, in order: saves in the order they were made
// (a quick second click can't overtake the first), syncs in between. So a sync never brings back a pass
// this tab is still saving before the save's answer says which pass it is: it would show twice.
let line: Promise<unknown> = Promise.resolve();
function inLine<T>(job: () => Promise<T>): Promise<T> {
  const run = line.then(job);
  line = run.catch(() => {});
  return run;
}

/** Keeps the store in step with the server: every 5 s while the tab is visible, 15 s when hidden. */
export function useSyncLoop() {
  const client = useTRPCClient();
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, document.hidden ? HIDDEN_MS : ACTIVE_MS);
    };
    async function tick() {
      if (busy) return;
      busy = true;
      try {
        await inLine(async () => {
          const r = await client.passes.sync.query({ since: store.rev }, { signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (r.reset) store.clear();
          store.merge(r.rows, r.deleted);
          store.rev = r.rev;
          store.setStatus({ loaded: true, online: true, backupError: r.backupError });
        });
      } catch (e) {
        if (isUnauthorized(e)) return void window.location.assign('/login');
        store.setStatus({ online: false });
      } finally {
        busy = false;
        schedule();
      }
    }
    store.resync = () => { if (!busy) { clearTimeout(timer); void tick(); } };
    const wake = () => { if (!document.hidden) store.resync(); };
    // Closing the tab while changes are still being sent would lose them: the browser asks first.
    const leaving = (e: BeforeUnloadEvent) => {
      if (!unsaved.length) return;
      e.preventDefault();
      e.returnValue = ''; // older browsers ask only when this is set
    };
    void tick();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('beforeunload', leaving);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('beforeunload', leaving);
    };
  }, [client]);
}

/* ----- saving in the background ----- */
// A change shows on screen at once and goes to the server in the background (in line, see above). If
// the connection drops it is sent again until the server answers; if the server refuses it, it comes
// off the screen again and the message says why.

/** When each change not saved yet was made, oldest first. */
const unsaved: number[] = [];
let slowTimer: ReturnType<typeof setTimeout> | undefined;
/** Saving is slow once the oldest unsaved change is SLOW_MS old. */
function watchSlow() {
  clearTimeout(slowTimer);
  const left = unsaved.length ? unsaved[0] + SLOW_MS - Date.now() : Infinity;
  store.setStatus({ slow: left <= 0 });
  if (left > 0 && left < Infinity) slowTimer = setTimeout(watchSlow, left);
}
function inOrder<T>(job: () => Promise<T>): Promise<T> {
  unsaved.push(Date.now());
  store.setStatus({ saving: true, unsaved: unsaved.length });
  if (unsaved.length === 1) watchSlow();
  const run = inLine(job);
  const done = () => {
    unsaved.shift();
    store.setStatus({ saving: unsaved.length > 0, unsaved: unsaved.length });
    watchSlow();
  };
  void run.then(done, done);
  return run;
}

/**
 * Sends a save, delete or undo. No answer (the connection dropped, or nothing within TIMEOUT_MS): sent
 * again, every few seconds, until the server answers. The request carries the same code each time,
 * so the server makes the change once however often it arrives (see `Resendable`).
 */
async function send<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await call(AbortSignal.timeout(TIMEOUT_MS));
      store.setStatus({ retrying: false });
      return r;
    } catch (e) {
      if (!worthSendingAgain(e, attempt)) {
        store.setStatus({ retrying: false });
        throw e;
      }
      store.setStatus({ retrying: true });
      await new Promise((ok) => setTimeout(ok, Math.min(attempt, 5) * 1000));
    }
  }
}

/** A code for one request, the same each time it is sent (crypto.randomUUID needs https; this doesn't). */
const newRequestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Passes this tab added show with a made-up id (below any blank row's) until the server gives the real one. */
let nextTemp = FIRST_TEMP_ID;
const realIds = new Map<number, number>();
const realId = (id: number) => (id < 0 ? realIds.get(id) : id);
/** Each pass's rev after this tab last saved it: a Delete planned before that save still applies. */
const ownRev = new Map<number, number>();

const clean = (v: Values = {}): Values => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanField(k as Field, x ?? '')]));

/** The server saved a change: Undo can now send its number. Passes added meanwhile have their real ids. */
function saved(entry: UndoEntry, changeId: number) {
  entry.changeId = changeId;
  entry.before = entry.before.map((p) => ({ ...p, id: realId(p.id) ?? p.id }));
  entry.hide = entry.hide.map((id) => realId(id) ?? id);
  store.touchUndo();
}

/** The passes as they will be once `req` is saved. */
function preview(req: ApplyRequest) {
  const now = new Date().toISOString();
  const rows: Pass[] = [];
  for (const op of req.set ?? []) {
    const p = store.get(op.id);
    if (!p) continue;
    const q: Pass = { ...p, ...clean(op.values), updated_by: store.me, ...(op.claim && { created_by: store.me }) };
    if (op.printed !== undefined) q.printed_at = op.printed ? (p.printed_at ?? now) : null;
    if (op.given !== undefined) q.given_at = op.given ? (p.given_at ?? now) : null;
    rows.push(q);
  }
  const added: { id: number; type: PassType; serial: number }[] = [];
  for (const c of req.create ?? []) {
    const id = nextTemp--;
    rows.push({
      ...blankPass(c.type, c.serial), ...clean(c.values), id,
      printed_at: c.printed ? now : null, given_at: c.given ? now : null, created_at: now, created_by: store.me, updated_by: store.me,
    });
    added.push({ id, type: c.type, serial: c.serial });
  }
  return { rows, added };
}

/**
 * New passes typed or pasted as the next ones whose serials another desk took meanwhile were saved
 * after the last pass (`ApplyRequest.next`): "Sewa Vehicle 0002 was just taken by another desk, so
 * Navneet Gumber is saved as 0003." Empty if none moved.
 */
function movedNote(added: { id: number; type: PassType; serial: number }[], r: ApplyResult): { note: string; to: number[] } {
  const byId = new Map(r.rows.map((p) => [p.id, p]));
  const moves = added.flatMap((a, i) => {
    const p = byId.get(r.created[i]);
    return p && p.serial !== a.serial ? [{ from: a.serial, p }] : [];
  });
  if (!moves.length) return { note: '', to: [] };
  const label = TYPE_INFO[moves[0].p.type].label;
  const to = moves.map((m) => m.p.serial);
  const note = moves.length === 1
    ? `${label} ${fmtSerial(moves[0].from)} was just taken by another desk, so ${moves[0].p.name || 'this pass'} is saved as ${fmtSerial(to[0])}.`
    : `${label} ${ranges(moves.map((m) => m.from))} were just taken by another desk, so these passes are saved as ${ranges(to)}.`;
  return { note, to };
}

/** Saving and undoing. Errors are shown as a toast; on a conflict the sheet refreshes at once. */
export function useActions() {
  const client = useTRPCClient();

  /** Saves a change: on screen now, on the server in the background. Resolves when the server answers (null if refused). */
  const apply = useCallback(
    (req: ApplyRequest, opts: { toast?: string | false } = {}): Promise<ApplyResult | null> => {
      const before = (req.set ?? []).flatMap((op) => store.get(op.id) ?? []);
      const { rows, added } = preview(req);
      const shown = store.show(rows);
      const entry = rows.length ? store.pushUndo({ type: rows[0].type, summary: req.summary, changeId: null, before, hide: added.map((a) => a.id) }) : null;
      const requestId = newRequestId();
      return inOrder(async () => {
        // Changes to passes added a moment ago go to their real ids; skip any whose adding failed.
        const set = (req.set ?? []).flatMap((op) => { const id = realId(op.id); return id === undefined ? [] : [{ ...op, id }]; });
        if (!set.length && !req.create?.length) {
          store.settle(shown);
          if (entry) store.dropUndo(entry);
          return null;
        }
        try {
          const r = await send((signal) => client.passes.save.mutate({ ...req, set, requestId }, { signal }));
          store.merge(r.rows);
          store.settle(shown);
          added.forEach((a, i) => {
            const id = r.created[i];
            if (id !== undefined) { realIds.set(a.id, id); store.rename(a.id, id); }
          });
          for (const row of r.rows) ownRev.set(row.id, row.rev);
          const moved = movedNote(added, r);
          if (entry) {
            if (moved.note) entry.summary += ` (saved as ${ranges(moved.to)})`;
            saved(entry, r.changeId);
          }
          if (moved.note) toast(moved.note);
          else if (opts.toast !== false) toast(opts.toast ?? req.summary);
          return r;
        } catch (e) {
          store.settle(shown);
          if (entry) store.dropUndo(entry);
          toast(errorMessage(e), 'error');
          if (isConflict(e)) store.resync();
          return null;
        }
      });
    },
    [client],
  );

  /** Deletes passes: gone from the screen now, from the server in the background. */
  const remove = useCallback(
    (req: DeleteRequest): Promise<DeleteResult | null> => {
      const before = req.items.flatMap((i) => store.get(i.id) ?? []);
      const shown = store.show([], req.items.map((i) => i.id));
      const entry = before.length ? store.pushUndo({ type: before[0].type, summary: req.summary, changeId: null, before, hide: [] }) : null;
      const requestId = newRequestId();
      return inOrder(async () => {
        const items = req.items.flatMap((i) => {
          const id = realId(i.id);
          if (id === undefined) return [];
          // Changed since only by this tab's own save (e.g. ticked a moment ago): delete that version.
          const saved = store.saved(id);
          return [{ id, rev: saved && ownRev.get(id) === saved.rev ? saved.rev : i.rev }];
        });
        if (!items.length) {
          store.settle(shown);
          if (entry) store.dropUndo(entry);
          return null;
        }
        try {
          const r = await send((signal) => client.passes.remove.mutate({ ...req, items, requestId }, { signal }));
          store.merge([], r.deleted);
          store.settle(shown);
          if (entry) saved(entry, r.changeId);
          toast(req.summary);
          return r;
        } catch (e) {
          store.settle(shown);
          if (entry) store.dropUndo(entry);
          toast(errorMessage(e), 'error');
          if (isConflict(e)) store.resync();
          return null;
        }
      });
    },
    [client],
  );

  /**
   * Undoes one of this tab's changes: off the screen at once, on the server in the background (after
   * any changes still being sent, the change itself included). If the server refuses, it comes back.
   */
  const undoEntry = useCallback(
    (e: UndoEntry): Promise<boolean> => {
      e.undoing = true;
      store.touchUndo();
      const shown = store.show(e.before, e.hide);
      const requestId = newRequestId();
      return inOrder(async () => {
        if (e.changeId === null) { // its save was refused, so there is nothing to undo
          store.settle(shown);
          store.dropUndo(e);
          return false;
        }
        try {
          const changeId = e.changeId;
          const r = await send((signal) => client.passes.undo.mutate({ changeId, requestId }, { signal }));
          store.merge(r.rows, r.deleted);
          store.settle(shown);
          store.dropUndo(e);
          toast(`↶ Undone: ${r.summary}`);
          return true;
        } catch (err) {
          store.settle(shown);
          const final = isConflict(err) || /already undone|no longer exists|cannot be undone/.test(errorMessage(err));
          if (final) store.dropUndo(e); // can't be undone any more
          else { e.undoing = false; store.touchUndo(); } // e.g. offline: can be tried again
          toast(errorMessage(err), 'error');
          if (isConflict(err)) store.resync();
          return false;
        }
      });
    },
    [client],
  );

  /** Undo in a sheet: this tab's last change there. */
  const undoLast = useCallback((type: PassType): Promise<boolean> => {
    const e = store.lastUndo(type);
    return e ? undoEntry(e) : Promise.resolve(false);
  }, [undoEntry]);

  /** Undoes a change by its number (History, "Didn't print? Undo"): at once if this tab made it. */
  const undo = useCallback(
    (changeId: number): Promise<boolean> => {
      const mine = store.status.undo.find((u) => u.changeId === changeId && !u.undoing);
      if (mine) return undoEntry(mine);
      const requestId = newRequestId();
      return inOrder(async () => {
        const target = changeId;
        try {
          const r = await send((signal) => client.passes.undo.mutate({ changeId: target, requestId }, { signal }));
          store.merge(r.rows, r.deleted);
          store.forgetUndo(target);
          toast(`↶ Undone: ${r.summary}`);
          return true;
        } catch (e) {
          if (!isConflict(e) && !/already undone|no longer exists/.test(errorMessage(e))) {
            toast(errorMessage(e), 'error');
            return false;
          }
          store.forgetUndo(target); // can't be undone any more
          toast(errorMessage(e), 'error');
          store.resync();
          return false;
        }
      });
    },
    [client, undoEntry],
  );

  return { apply, remove, undo, undoLast };
}
