import 'server-only';
import { initTRPC, TRPCError } from '@trpc/server';
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { readCookie, SESSION_COOKIE, sessionUser } from './auth';
import { db } from './db';

export async function createContext({ req, resHeaders }: FetchCreateContextFnOptions) {
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
  return { db, req, resHeaders, token, user: await sessionUser(db, token) };
}
type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    // Unexpected errors: log them, but don't send internals to the browser.
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      console.error(error.cause ?? error);
      return { ...shape, message: 'Something went wrong on the server. Please try again.' };
    }
    return shape;
  },
});

export const router = t.router;

/** Mutations must come from this app's own pages (blocks other websites posting with your cookie). */
const sameOrigin = t.middleware(({ ctx, type, next }) => {
  if (type === 'mutation') {
    const origin = ctx.req.headers.get('origin');
    const host = ctx.req.headers.get('host');
    if (origin && host && new URL(origin).host !== host) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-site request blocked.' });
  }
  return next();
});

export const publicProcedure = t.procedure.use(sameOrigin);

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Please log in again.' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.is_admin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only an admin can do that.' });
  return next();
});
