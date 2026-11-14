'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { type ReactNode, useState } from 'react';
import type { AppRouter } from '@/server/routers/_app';

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } }),
  );
  const [trpcClient] = useState(() => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/api/trpc' })] }));
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  );
}

/** A message a person can act on, for any error from a tRPC call. */
export function errorMessage(e: unknown): string {
  if (e instanceof TRPCClientError) {
    if (!e.data && /fetch|network|load failed|abort|timed? ?out/i.test(e.message)) return "Can't reach the server: check the connection and try again.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Whether a save that failed is sent again (with the same request code, so it is never saved twice).
 * Always when no answer came: the connection dropped or timed out. A few times when the server (or
 * something in between, answering with a page that isn't the app's) failed. Never when the server
 * answered: it refused the change, and says why.
 */
export function worthSendingAgain(e: unknown, attempt: number): boolean {
  if (!(e instanceof TRPCClientError)) return false;
  const code: string | undefined = e.data?.code;
  if (code) return code === 'INTERNAL_SERVER_ERROR' && attempt < 4;
  return e.cause instanceof SyntaxError ? attempt < 4 : true;
}

export const isUnauthorized = (e: unknown) => e instanceof TRPCClientError && e.data?.code === 'UNAUTHORIZED';
export const isConflict = (e: unknown) => e instanceof TRPCClientError && e.data?.code === 'CONFLICT';
