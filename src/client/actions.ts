'use client';
import { useCallback, useEffect } from 'react';
import { blankPass } from '@/lib/passes';
import { type ApplyRequest, type ApplyResult, cleanText, type DeleteRequest, type DeleteResult, type Pass, type PassType, type Values } from '@/shared/types';
import { store } from './store';
import { toast } from './toast';
import { errorMessage, isConflict, isUnauthorized, useTRPCClient } from './trpc';

const ACTIVE_MS = 5000;
const HIDDEN_MS = 15000;

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
        const r = await client.passes.sync.query({ since: store.rev });
        if (r.reset) store.clear();
        store.merge(r.rows, r.deleted);
        store.rev = r.rev;
        store.setStatus({ loaded: true, online: true, backupError: r.backupError });
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
    // Closing the tab while changes are still being sent would lose them: ask first.
    const leaving = (e: BeforeUnloadEvent) => { if (waiting) e.preventDefault(); };
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
// A change shows on screen at once and goes to the server in the background. Changes are sent one
// at a time, in the order they were made, so a quick second click can't overtake the first. If the
// server refuses one, it comes off the screen again and the message says why.

let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
function inOrder<T>(job: () => Promise<T>): Promise<T> {
  waiting++;
  store.setStatus({ saving: true });
  const run = queue.then(job);
  const done = () => { if (--waiting === 0) store.setStatus({ saving: false }); };
  queue = run.then(done, done);
  return run;
}

/** Passes this tab added show with a made-up id (below any blank row's) until the server gives the real one. */
let nextTemp = -1_000_000;
const realIds = new Map<number, number>();
const realId = (id: number) => (id < 0 ? realIds.get(id) : id);
/** Each pass's rev after this tab last saved it: a Delete planned before that save still applies. */
const ownRev = new Map<number, number>();

const clean = (v: Values = {}): Values => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanText(x ?? '')]));

/** The passes as they will be once `req` is saved. */
function preview(req: ApplyRequest) {
  const now = new Date().toISOString();
  const rows: Pass[] = [];
  for (const op of req.set ?? []) {
    const p = store.get(op.id);
    if (!p) continue;
    const q: Pass = { ...p, ...clean(op.values), updated_by: store.me };
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

/** Saving and undoing. Errors are shown as a toast; on a conflict the sheet refreshes at once. */
export function useActions() {
  const client = useTRPCClient();

  /** Saves a change: on screen now, on the server in the background. Resolves when the server answers (null if refused). */
  const apply = useCallback(
    (req: ApplyRequest, opts: { toast?: string | false } = {}): Promise<ApplyResult | null> => {
      const { rows, added } = preview(req);
      const shown = store.show(rows);
      return inOrder(async () => {
        // Changes to passes added a moment ago go to their real ids; skip any whose adding failed.
        const set = (req.set ?? []).flatMap((op) => { const id = realId(op.id); return id === undefined ? [] : [{ ...op, id }]; });
        if (!set.length && !req.create?.length) {
          store.settle(shown);
          return null;
        }
        try {
          const r = await client.passes.save.mutate({ ...req, set });
          store.merge(r.rows);
          store.settle(shown);
          for (const a of added) {
            const row = r.rows.find((x) => x.type === a.type && x.serial === a.serial);
            if (row) { realIds.set(a.id, row.id); store.rename(a.id, row.id); }
          }
          for (const row of r.rows) ownRev.set(row.id, row.rev);
          store.pushUndo(r.changeId, req.summary);
          if (opts.toast !== false) toast(opts.toast ?? req.summary);
          return r;
        } catch (e) {
          store.settle(shown);
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
      const shown = store.show([], req.items.map((i) => i.id));
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
          return null;
        }
        try {
          const r = await client.passes.remove.mutate({ ...req, items });
          store.merge([], r.deleted);
          store.settle(shown);
          store.pushUndo(r.changeId, req.summary);
          toast(req.summary);
          return r;
        } catch (e) {
          store.settle(shown);
          toast(errorMessage(e), 'error');
          if (isConflict(e)) store.resync();
          return null;
        }
      });
    },
    [client],
  );

  /** Undoes a change (default: this tab's last one, after any changes still being sent). */
  const undo = useCallback(
    (changeId?: number): Promise<boolean> =>
      inOrder(async () => {
        const target = changeId ?? store.status.undo?.changeId;
        if (!target) return false;
        try {
          const r = await client.passes.undo.mutate({ changeId: target });
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
      }),
    [client],
  );

  return { apply, remove, undo };
}
