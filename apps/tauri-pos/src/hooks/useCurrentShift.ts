/**
 * useCurrentShift — TanStack wrapper for /api/shifts/current.
 *
 * Returns `null` when no shift is open on the calling device. Cached for
 * 10s; aggressive refresh because the operator may open/close from another
 * action (e.g. the dashboard footer).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { type ShiftView, shifts as shiftsApi } from '@norns/api-client';

import { useApiClient } from '../lib/api-context.js';
import { dashboardQueryKey } from './useDashboardSummary.js';

export const currentShiftQueryKey = ['shifts', 'current'] as const;

export interface UseCurrentShiftResult {
  data: ShiftView | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
  /** Invalidates both this query + the dashboard summary (counters depend on shift). */
  invalidateShiftScope: () => Promise<void>;
}

export function useCurrentShift(): UseCurrentShiftResult {
  const api = useApiClient();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: currentShiftQueryKey,
    queryFn: () => shiftsApi.getCurrent(api),
    staleTime: 10_000,
    refetchInterval: 30_000,
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
    invalidateShiftScope: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
      ]);
    },
  };
}
