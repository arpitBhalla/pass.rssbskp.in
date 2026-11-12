import 'server-only';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { currentKeys, makeKeys } from '../qr';
import { adminProcedure, authedProcedure, router } from '../trpc';

const SIGNATURE = 'signature';
/** Text printed on passes, set once for everyone. */
const TEXTS = { tag: 'tag' } as const;
const DEFAULTS = { tag: 'NOV - 2026' };

export const settingsRouter = router({
  get: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.selectFrom('settings').select(['key', 'value'])
      .where('key', 'in', [SIGNATURE, TEXTS.tag]).execute();
    const value = (k: string) => rows.find((r) => r.key === k)?.value;
    return {
      signature: value(SIGNATURE) ?? '',
      /** Every pass: the tag in the tab at the bottom, e.g. "NOV - 2026". */
      tag: value(TEXTS.tag) ?? DEFAULTS.tag,
    };
  }),

  /** The key that signs the QR codes: its short id, and since when (null before the first print). */
  qrKey: authedProcedure.query(async ({ ctx }) => {
    const k = await currentKeys(ctx.db);
    return k && { fingerprint: k.fingerprint, since: k.since };
  }),

  /** A new signing key (admin). Every pass printed before it then checks as NOT VALID. */
  newKey: adminProcedure.mutation(async ({ ctx }) => {
    const k = await makeKeys(ctx.db, ctx.user.id, true);
    return { fingerprint: k.fingerprint, since: k.since };
  }),

  /** One-time setup (admin): the tag. */
  setText: adminProcedure
    .input(z.object({ key: z.enum(['tag']), value: z.string().trim().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const key = TEXTS[input.key];
      if (input.value.length > 60) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Keep it under 60 characters.' });
      }
      await ctx.db
        .insertInto('settings')
        .values({ key, value: input.value, updated_by: ctx.user.id })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: input.value, updated_by: ctx.user.id, updated_at: new Date() }))
        .execute();
      return { ok: true };
    }),

  /** The signature printed on every pass ('' removes it). Shared by all desks. */
  setSignature: adminProcedure
    .input(z.object({
      signature: z.string().max(4_000_000).refine(
        (s) => s === '' || /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(s),
        'Use a PNG, JPEG, WebP or SVG image.',
      ),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insertInto('settings')
        .values({ key: SIGNATURE, value: input.signature, updated_by: ctx.user.id })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: input.signature, updated_by: ctx.user.id, updated_at: new Date() }))
        .execute();
      return { ok: true };
    }),
});
