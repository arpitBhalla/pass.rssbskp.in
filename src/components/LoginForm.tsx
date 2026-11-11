'use client';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage, useTRPC } from '@/client/trpc';
import { btnPrimary, input, label } from './ui';

/** Log in; on the very first run, create the first (admin) user instead. */
export function LoginForm({ setup, next = '/' }: { setup: boolean; next?: string }) {
  const trpc = useTRPC();
  const [f, setF] = useState({ name: '', username: '', password: '' });
  const done = { onSuccess: () => window.location.assign(next) };
  const login = useMutation(trpc.auth.login.mutationOptions(done));
  const create = useMutation(trpc.auth.setup.mutationOptions(done));
  const m = setup ? create : login;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (setup) create.mutate(f);
    else login.mutate({ username: f.username, password: f.password });
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));

  return (
    <main className="min-h-dvh bg-background">
      <div className="h-11 bg-primary" />
      <form onSubmit={submit} className="mx-auto mt-[12vh] w-full max-w-[22rem] space-y-4 px-6">
        <div>
          <h1 className="font-condensed text-[28px] font-bold leading-tight">RSSB SKP Pass Register</h1>
          <p className="mt-1 text-muted-foreground">
            {setup ? 'First run: create the admin user. You can add the others after.' : 'Log in to continue.'}
          </p>
        </div>
        {setup && (
          <label className={label}>Your name<input className={input} value={f.name} onChange={set('name')} required autoFocus /></label>
        )}
        <label className={label}>
          Username
          <input className={input} value={f.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" required autoFocus={!setup} />
        </label>
        <label className={label}>
          Password
          <input className={input} type="password" value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 6 : undefined} />
        </label>
        {m.error && <p role="alert" className="rounded-[3px] border-l-4 border-destructive bg-red-50 px-3 py-2 text-destructive">{errorMessage(m.error)}</p>}
        <button className={`${btnPrimary} !h-10 w-full`} disabled={m.isPending}>{setup ? 'Create admin & continue' : 'Log in'}</button>
      </form>
    </main>
  );
}
