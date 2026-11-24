import 'server-only';
import { TRPCError } from '@trpc/server';
import { sql } from 'kysely';
import { z } from 'zod';
import { createSession, deleteSession, hashPassword, loginBlocked, noteLogin, sessionCookie, verifyPassword } from '../auth';
import { loggedInProcedure, publicProcedure, router } from '../trpc';
import { newUserInput } from './users';

export const authRouter = router({
  /** Who is logged in, and whether the first admin still has to be created. */
  status: publicProcedure.query(async ({ ctx }) => {
    if (ctx.user) return { user: ctx.user, needsSetup: false };
    const any = await ctx.db.selectFrom('users').select('id').limit(1).executeTakeFirst();
    return { user: null, needsSetup: !any };
  }),

  /** First run only: creates the first user, as admin, and logs them in. */
  setup: publicProcedure.input(newUserInput.omit({ is_admin: true, scan_only: true })).mutation(async ({ ctx, input }) => {
    const password_hash = await hashPassword(input.password);
    const id = await ctx.db.transaction().execute(async (trx) => {
      await sql`LOCK TABLE users IN EXCLUSIVE MODE`.execute(trx); // two first-runs at once: only one wins
      if (await trx.selectFrom('users').select('id').limit(1).executeTakeFirst()) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Setup is already done. Please log in.' });
      }
      const row = await trx
        .insertInto('users')
        .values({ username: input.username, name: input.name, password_hash, is_admin: true, created_by: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
    ctx.resHeaders.append('Set-Cookie', sessionCookie(await createSession(ctx.db, id)));
    return { ok: true };
  }),

  login: publicProcedure
    .input(z.object({ username: z.string().trim().toLowerCase().max(40), password: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      if (loginBlocked(input.username)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many wrong passwords. Wait 10 minutes and try again.' });
      }
      const user = await ctx.db
        .selectFrom('users')
        .select(['id', 'password_hash', 'active'])
        .where('username', '=', input.username)
        .executeTakeFirst();
      const ok = !!user && user.active && (await verifyPassword(input.password, user.password_hash));
      noteLogin(input.username, ok);
      if (!ok) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong username or password.' });
      ctx.resHeaders.append('Set-Cookie', sessionCookie(await createSession(ctx.db, user.id)));
      return { ok: true };
    }),

  logout: loggedInProcedure.mutation(async ({ ctx }) => {
    if (ctx.token) await deleteSession(ctx.db, ctx.token);
    ctx.resHeaders.append('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  }),
});
