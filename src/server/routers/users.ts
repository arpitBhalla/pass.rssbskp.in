import 'server-only';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { forgetUser, hashPassword } from '../auth';
import { adminProcedure, authedProcedure, router } from '../trpc';

export const newUserInput = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,40}$/, 'Username: 2–40 letters, digits, dot, dash or underscore'),
  password: z.string().min(6, 'Password: at least 6 characters').max(200),
  is_admin: z.boolean().default(false),
});

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === '23505';

export const usersRouter = router({
  /** Everyone (for names in History). Inactive users are included so old changes still show who made them. */
  list: authedProcedure.query(({ ctx }) =>
    ctx.db.selectFrom('users').select(['id', 'username', 'name', 'is_admin', 'active']).orderBy('name').execute(),
  ),

  create: adminProcedure.input(newUserInput).mutation(async ({ ctx, input }) => {
    const password_hash = await hashPassword(input.password);
    try {
      await ctx.db
        .insertInto('users')
        .values({ name: input.name, username: input.username, is_admin: input.is_admin, password_hash, created_by: ctx.user.id })
        .execute();
    } catch (e) {
      if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: `Username "${input.username}" is taken.` });
      throw e;
    }
    return { ok: true };
  }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().trim().min(1).max(80).optional(),
      is_admin: z.boolean().optional(),
      active: z.boolean().optional(),
      password: z.string().min(6, 'Password: at least 6 characters').max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id && (input.active === false || input.is_admin === false)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "You can't remove your own admin rights or deactivate yourself." });
      }
      const { id, password, ...rest } = input;
      const patch = { ...rest, ...(password ? { password_hash: await hashPassword(password) } : {}) };
      if (!Object.keys(patch).length) return { ok: true };
      await ctx.db.updateTable('users').set(patch).where('id', '=', id).execute();
      if (input.active === false || password) await ctx.db.deleteFrom('sessions').where('user_id', '=', id).execute(); // log them out
      forgetUser(id);
      return { ok: true };
    }),
});
