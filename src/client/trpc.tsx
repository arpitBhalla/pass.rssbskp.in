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
    if (!e.data && /fetch|network|load failed/i.test(e.message)) return "Can't reach the server. Nothing was saved: check the connection and try again.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export const isUnauthorized = (e: unknown) => e instanceof TRPCClientError && e.data?.code === 'UNAUTHORIZED';
export const isConflict = (e: unknown) => e instanceof TRPCClientError && e.data?.code === 'CONFLICT';
