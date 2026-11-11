'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { toast } from '@/client/toast';
import { errorMessage, useTRPC } from '@/client/trpc';
import type { User } from '@/shared/types';
import { useMe } from './AppShell';
import { btn, btnPrimary, card, input, label } from './ui';

const EMPTY = { name: '', username: '', password: '', is_admin: false };

/** Admin only: add people, reset passwords, turn admin on/off, deactivate. */
export function UsersScreen() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const me = useMe();
  const users = useQuery(trpc.users.list.queryOptions());
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.users.list.queryKey() });
  const [f, setF] = useState(EMPTY);

  const create = useMutation(trpc.users.create.mutationOptions({
    onSuccess: () => { toast(`Added ${f.name}`); setF(EMPTY); void refresh(); },
  }));
  const update = useMutation(trpc.users.update.mutationOptions({
    onSuccess: () => { toast('Saved'); void refresh(); },
    onError: (e) => toast(errorMessage(e), 'error'),
  }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(f);
  };
  const resetPassword = (u: User) => {
    const password = window.prompt(`New password for ${u.name} (at least 6 characters):`);
    if (password) update.mutate({ id: u.id, password });
  };

  const cell = 'border-b border-border px-2 py-1.5';
  return (
    <div className="min-w-0 flex-1 space-y-4 overflow-auto bg-background p-4">
      <h1 className="font-condensed text-[20px] font-bold">Users</h1>
      <form onSubmit={submit} className={`${card} flex max-w-4xl flex-wrap items-end gap-3 p-3`}>
        <label className={`${label} w-44`}>Name<input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className={`${label} w-36`}>Username<input className={input} value={f.username} autoCapitalize="none" onChange={(e) => setF({ ...f, username: e.target.value })} required /></label>
        <label className={`${label} w-36`}>Password<input className={input} type="password" autoComplete="new-password" minLength={6} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
        <label className="flex items-center gap-1.5 pb-2 text-[13px]">
          <input type="checkbox" className="accent-primary" checked={f.is_admin} onChange={(e) => setF({ ...f, is_admin: e.target.checked })} /> Admin
        </label>
        <button className={btnPrimary} disabled={create.isPending}>Add user</button>
        {create.error && <p className="w-full text-red-700">{errorMessage(create.error)}</p>}
      </form>

      <table className="w-full max-w-4xl border-separate border-spacing-0 text-[13px]">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className={cell}>Name</th>
            <th className={cell}>Username</th>
            <th className={cell}>Admin</th>
            <th className={cell}>Active</th>
            <th className={cell} />
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'text-muted-foreground'}>
              <td className={cell}>{u.name}{u.id === me.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</td>
              <td className={cell}>{u.username}</td>
              <td className={cell}>
                <input type="checkbox" className="accent-primary" checked={u.is_admin} disabled={u.id === me.id} onChange={(e) => update.mutate({ id: u.id, is_admin: e.target.checked })} />
              </td>
              <td className={cell}>
                <input type="checkbox" className="accent-primary" checked={u.active} disabled={u.id === me.id} onChange={(e) => update.mutate({ id: u.id, active: e.target.checked })} title="Untick to stop this person logging in (their past changes keep their name)" />
              </td>
              <td className={`${cell} text-right`}>
                <button className={`${btn} !px-2 !py-0.5 !text-xs`} onClick={() => resetPassword(u)}>Reset password</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
