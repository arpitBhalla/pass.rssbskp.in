'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useActions } from '@/client/actions';
import { useTRPC } from '@/client/trpc';
import { btn } from './ui';

const ACTION_LABEL: Record<string, string> = {
  give: 'Give', given: 'Given', edit: 'Edit', paste: 'Paste', print: 'Print', import: 'Import', pack: 'Packet', delete: 'Delete', undo: 'Undo',
};

/** Every change, newest first, with who made it. Any change can be undone if nothing touched those passes since. */
export function HistoryScreen() {
  const trpc = useTRPC();
  const history = useQuery({ ...trpc.passes.history.queryOptions({ limit: 300 }), refetchInterval: 5000, staleTime: 0 });
  const { undo } = useActions();
  const [busy, setBusy] = useState<number | null>(null);

  const run = async (id: number) => {
    setBusy(id);
    await undo(id);
    await history.refetch();
    setBusy(null);
  };

  const cell = 'border-b border-border px-2 py-1.5 align-top';
  return (
    <div className="min-w-0 flex-1 overflow-auto bg-background p-4">
      <h1 className="mb-1 font-condensed text-[20px] font-bold">History</h1>
      <p className="mb-3 text-[13px] text-muted-foreground">The last 300 changes, newest first. Undo works until those passes are changed again.</p>
      {history.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {history.data?.length === 0 && <p className="text-muted-foreground">No changes yet.</p>}
      {!!history.data?.length && (
        <table className="w-full border-separate border-spacing-0 text-[15px]">
          <thead className="sticky top-0 bg-panel text-left font-condensed text-[14.5px] text-foreground/70">
            <tr>
              <th className={cell}>When</th>
              <th className={cell}>Who</th>
              <th className={cell}>What</th>
              <th className={cell}>Change</th>
              <th className={`${cell} text-right`}>Passes</th>
              <th className={cell} />
            </tr>
          </thead>
          <tbody>
            {history.data.map((c) => (
              <tr key={c.id} className={c.undone_at ? 'text-muted-foreground line-through decoration-muted-foreground/50' : ''}>
                <td className={`${cell} whitespace-nowrap tabular-nums`}>{new Date(c.done_at).toLocaleString()}</td>
                <td className={`${cell} whitespace-nowrap`}>{c.done_by}</td>
                <td className={cell}>{ACTION_LABEL[c.action] ?? c.action}</td>
                <td className={cell}>
                  {c.summary}
                  {c.undone_at && <span className="ml-2 text-xs no-underline">(undone by {c.undone_by}, {new Date(c.undone_at).toLocaleString()})</span>}
                </td>
                <td className={`${cell} text-right tabular-nums`}>{c.count}</td>
                <td className={`${cell} text-right`}>
                  {!c.undone_at && c.action !== 'undo' && (
                    <button className={`${btn} !h-7 !px-2 !text-[13px]`} disabled={busy !== null} onClick={() => void run(c.id)}>
                      {busy === c.id ? '…' : 'Undo'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
