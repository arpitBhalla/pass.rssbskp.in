'use client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTRPC } from './trpc';

/** User id → name, for "Added by". Includes users since made inactive. */
export function useUserNames(): Map<number, string> {
  const trpc = useTRPC();
  const q = useQuery({ ...trpc.users.list.queryOptions(), staleTime: 5 * 60_000 });
  return useMemo(() => new Map((q.data ?? []).map((u) => [u.id, u.name])), [q.data]);
}

/** Names of the users who added these passes (one each), e.g. "Ramesh" or "Ramesh, Gurmeet". */
export const addedBy = (ids: number[], names: Map<number, string>) =>
  [...new Set(ids)].map((id) => names.get(id) ?? '').filter(Boolean).join(', ');
