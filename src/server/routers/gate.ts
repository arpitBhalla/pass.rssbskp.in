import 'server-only';
import { z } from 'zod';
import { checkPass } from '../gate';
import { loggedInProcedure, router } from '../trpc';

export const gateRouter = router({
  /** Checks a pass's QR code at the gate and records the scan (the /v page calls this). */
  check: loggedInProcedure
    .input(z.object({ code: z.string().max(400) }))
    .mutation(({ ctx, input }) => checkPass(ctx.db, ctx.user.id, input.code)),
});
