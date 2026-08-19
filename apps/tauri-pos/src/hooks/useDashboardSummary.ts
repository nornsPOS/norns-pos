/**
 * useDashboardSummary — TanStack Query wrapper around `/api/dashboard/summary`.
 *
 * Cache policy:
 *   • staleTime: 15s — within the first 15s after a fetch the data is
 *     considered fresh; no extra fetch on remount.
 *   • refetchInterval: 60s — slow background poll as a safety net in case
 *     an SSE event was missed (unlikely; defence in depth).
 *   • refetchOnWindowFocus: false — operator may switch apps a lot.
 *   • Invalidation: see `useLedgerStream` — SSE events that affect any
 *     dashboard tile invalidate this query (debounced 400 ms).
 *
 * The exported `dashboardQueryKey` is the SHARED cache key; the SSE hook
 * imports it so we never have two routes pointing at slightly-different
 * keys and missing the invalidation.
 */

import { useQuery } from '@tanstack/react-query';

import { type DashboardSummary, dashboard } from '@norns/api-client';

import { useApiClient } from '../lib/api-context.js';

/** Shared cache key — DO NOT inline this string anywhere else. */
export const dashboardQueryKey = ['dashboard', 'summary'] as const;

export interface UseDashboardSummaryResult {
  data: DashboardSummary | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

export function useDashboardSummary(): UseDashboardSummaryResult {
  const api = useApiClient();

  const q = useQuery({
    queryKey: dashboardQueryKey,
    queryFn: () => dashboard.summary(api),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    data: q.data,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}
