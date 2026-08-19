/**
 * useInventoryCounts — live „was ist verfügbar / reserviert / verkauft" on the
 * TanStack data spine (first-load loading, stale-while-revalidate, in-flight
 * de-dupe). The fetcher fans out to three status-filtered product lists
 * (`limit: 1`, so only the real `total` is read — no rows transferred) and
 * assembles an `InventoryCounts`.
 *
 * Honesty rule: `data` is undefined until a real response lands; a surface reads
 * it and shows nothing (or a skeleton) otherwise. `inStock` is derived from the
 * three real totals, never guessed.
 */
import { useQuery } from '@tanstack/react-query';

import { productsApi } from '@norns/api-client';

import { useApiClient } from '../lib/api-context.js';
import { type InventoryCounts, makeInventoryCounts } from '../lib/availability-ui.js';

export interface UseInventoryCountsOptions {
  /** Optional search term so the counts match a filtered catalog. */
  q?: string;
  /** Gate the read. Default true. */
  enabled?: boolean;
}

/**
 * Live per-status inventory counts. Keyed by the (trimmed) search term so each
 * search keeps its own counts and two mounts of the same search share one
 * fan-out.
 */
export function useInventoryCounts(options: UseInventoryCountsOptions = {}): {
  data: InventoryCounts | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const api = useApiClient();
  const term = (options.q ?? '').trim();
  const query = useQuery({
    queryKey: ['inventory', 'counts', term],
    enabled: options.enabled ?? true,
    staleTime: 10_000,
    queryFn: async (): Promise<InventoryCounts> => {
      const base = term.length > 0 ? { q: term } : {};
      const [available, reserved, sold] = await Promise.all([
        productsApi.list(api, { ...base, status: 'AVAILABLE', limit: 1 }),
        productsApi.list(api, { ...base, status: 'RESERVED', limit: 1 }),
        productsApi.list(api, { ...base, status: 'SOLD', limit: 1 }),
      ]);
      return makeInventoryCounts({
        available: available.total,
        reserved: reserved.total,
        sold: sold.total,
      });
    },
  });
  return { data: query.data, isLoading: query.isLoading, isError: query.isError };
}
