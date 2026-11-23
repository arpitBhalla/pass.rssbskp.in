import 'server-only';
import { z } from 'zod';
import { ACTIONS, MAX_BATCH, MAX_SERIAL, PASS_TYPES } from '@/shared/types';
import { backupError } from '../backup';
import { passCodes } from '../gate';
import { applyChange, deletePasses, listChanges, syncSince, undoChange } from '../passes';
import { authedProcedure, router } from '../trpc';

const text = z.string().max(500).optional();
const values = z.object({ name: text, dept: text, area: text, phone: text, vehicle: text, vehicle_no: text, incharge: text, issued_to: text }).strict();
/** Yes / no details to tick or untick (FLAGS). */
const flags = z.object({ ferry: z.boolean().optional(), rtb3: z.boolean().optional() }).strict().optional();

/** See `Resendable`. */
const requestId = z.string().min(8).max(64).optional();

const applyInput = z.object({
  requestId,
  next: z.boolean().optional(),
  action: z.enum(ACTIONS),
  summary: z.string().trim().min(1).max(300),
  set: z.array(z.object({
    id: z.number().int().positive(),
    values: values.optional(),
    printed: z.boolean().optional(),
    given: z.boolean().optional(),
    claim: z.boolean().optional(),
    flags,
    expect: values.extend({ printed: z.boolean().optional(), given: z.boolean().optional(), flags }),
  })).max(MAX_BATCH).optional(),
  create: z.array(z.object({
    type: z.enum(PASS_TYPES),
    serial: z.number().int().min(1).max(MAX_SERIAL),
    values,
    printed: z.boolean().optional(),
    given: z.boolean().optional(),
    flags,
  })).max(MAX_BATCH).optional(),
});

export const passesRouter = router({
  /** What changed since version `since`. Every desk calls this every few seconds. */
  sync: authedProcedure
    .input(z.object({ since: z.number().int().min(0) }))
    .query(async ({ ctx, input }) => ({ ...(await syncSince(ctx.db, input.since)), backupError: backupError() })),

  // Not "apply": tRPC reserves apply, call and then.
  /** QR codes for passes about to be printed (makes the signing key on the first print). */
  codes: authedProcedure
    .input(z.object({ type: z.enum(PASS_TYPES), serials: z.array(z.number().int().min(1).max(MAX_SERIAL)).min(1).max(MAX_BATCH) }))
    .mutation(({ ctx, input }) => passCodes(ctx.db, ctx.user.id, input.type, input.serials)),

  save: authedProcedure.input(applyInput).mutation(({ ctx, input }) => applyChange(ctx.db, ctx.user.id, input)),

  /** Deletes passes (not printed ones); Undo puts them back. */
  remove: authedProcedure
    .input(z.object({
      requestId,
      summary: z.string().trim().min(1).max(300),
      items: z.array(z.object({ id: z.number().int().positive(), rev: z.number().int().min(0) })).min(1).max(MAX_BATCH),
    }))
    .mutation(({ ctx, input }) => deletePasses(ctx.db, ctx.user.id, input)),

  undo: authedProcedure
    .input(z.object({ changeId: z.number().int().positive(), requestId }))
    .mutation(({ ctx, input }) => undoChange(ctx.db, ctx.user.id, input.changeId, input.requestId)),

  history: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(1000).default(300) }))
    .query(({ ctx, input }) => listChanges(ctx.db, input.limit)),
});
