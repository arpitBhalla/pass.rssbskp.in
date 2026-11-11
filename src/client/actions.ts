'use client';
import { useCallback, useEffect } from 'react';
import type { ApplyRequest, ApplyResult } from '@/shared/types';
import { store } from './store';
import { toast } from './toast';
import { errorMessage, isConflict, isUnauthorized, useTRPCClient } from './trpc';

const ACTIVE_MS = 2000;
const HIDDEN_MS = 15000;

/** Keeps the store in step with the server: every 2 s while the tab is visible, 15 s when hidden. */
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
    void tick();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [client]);
}

/** Saving and undoing. Errors are shown as a toast; on a conflict the sheet refreshes at once. */
export function useActions() {
  const client = useTRPCClient();

  const apply = useCallback(
    async (req: ApplyRequest, opts: { toast?: string | false } = {}): Promise<ApplyResult | null> => {
      try {
        const r = await client.passes.save.mutate(req);
        store.merge(r.rows);
        store.pushUndo(r.changeId, req.summary);
        if (opts.toast !== false) toast(opts.toast ?? req.summary);
        return r;
      } catch (e) {
        toast(errorMessage(e), 'error');
        if (isConflict(e)) store.resync();
        return null;
      }
    },
    [client],
  );

  /** Undoes a change (default: this tab's last one). */
  const undo = useCallback(
    async (changeId?: number): Promise<boolean> => {
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
    },
    [client],
  );

  return { apply, undo };
}
