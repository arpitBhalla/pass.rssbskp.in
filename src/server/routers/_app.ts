import 'server-only';
import { router } from '../trpc';
import { authRouter } from './auth';
import { gateRouter } from './gate';
import { passesRouter } from './passes';
import { settingsRouter } from './settings';
import { usersRouter } from './users';

export const appRouter = router({
  auth: authRouter,
  gate: gateRouter,
  passes: passesRouter,
  settings: settingsRouter,
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
