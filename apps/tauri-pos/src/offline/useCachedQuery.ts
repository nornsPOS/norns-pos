/**
 * useCachedQuery — TanStack `useQuery`, but it remembers across remounts (and,
 * with a persistence adapter installed, across cold starts) by sitting the
 * durable `read-cache` underneath.
 *
 *   • on mount it SEEDS from the cached snapshot for `cacheKey` (and hydrates it
 *     from disk if an adapter is installed), so the surface paints real numbers
 *     instantly instead of a skeleton,
 *   • every successful fetch WRITES its payload back to the cache,
 *   • it exposes the honesty metadata a surface needs: `cachedAt`, `isStale`,
 *     and `fromCache` (true while showing the seed, before the live fetch lands).
 *
 * Honesty rule: the seed is a REAL prior response, never a guess. While it's on
 * screen, `fromCache` is true and the surface should show a StaleBadge with
 * `cachedAt` so the operator knows it is the last-good value, not live.
 */
import { keepPreviousData as keepPreviousDataFn, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_MAX_AGE_MS,
  DEFAULT_STALE_AFTER_MS,
  getCachedRead,
  hydrate,
  isStale as isStaleAt,
  setCachedRead,
} from './read-cache.js';

export interface CachedQueryOptions<T> {
  /** TanStack query key (identity for the live layer). */
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  /** REQUIRED for caching — the stable key the read snapshot is stored under. */
  cacheKey: string;
  /** Ignore a snapshot older than this before seeding from it. Default 24h. */
  maxAgeMs?: number;
  /** Age past which `isStale` flips true. Default 60s. */
  staleAfterMs?: number;
  enabled?: boolean;
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
  /**
   * For paginated / filtered lists: keep the previous page's rows on screen
   * while the next loads (no flash to empty). Composes with the read-cache seed
   * — the seed still fills the very first (offline) mount.
   */
  keepPreviousData?: boolean;
}

export interface CachedQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The live refetch is in flight (true even while the seed is on screen). */
  isFetching: boolean;
  /** `Date.now()` the shown data was captured — the source of the StaleBadge. */
  cachedAt: number | null;
  /** True while the seed is on screen and the live fetch hasn't landed. */
  fromCache: boolean;
  isStale: boolean;
  refetch: () => void;
}

export function useCachedQuery<T>(options: CachedQueryOptions<T>): CachedQueryResult<T> {
  const {
    queryKey,
    queryFn,
    cacheKey,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    enabled = true,
    staleTime,
    refetchOnWindowFocus,
    keepPreviousData = false,
  } = options;

  const seedFromMemory = (k: string): { data: T; cachedAt: number } | null => {
    const e = getCachedRead<T>(k);
    if (!e) return null;
    if (Date.now() - e.cachedAt > maxAgeMs) return null;
    return e;
  };

  const [seed, setSeed] = useState<{ data: T; cachedAt: number } | null>(() =>
    seedFromMemory(cacheKey),
  );

  // Re-seed on key change + hydrate from disk (if an adapter is installed).
  useEffect(() => {
    let alive = true;
    setSeed(seedFromMemory(cacheKey));
    void hydrate<T>(cacheKey, maxAgeMs).then((e) => {
      if (alive && e) setSeed({ data: e.data, cachedAt: e.cachedAt });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, maxAgeMs]);

  const q = useQuery({
    queryKey,
    queryFn,
    enabled,
    ...(staleTime !== undefined ? { staleTime } : {}),
    ...(refetchOnWindowFocus !== undefined ? { refetchOnWindowFocus } : {}),
    ...(keepPreviousData ? { placeholderData: keepPreviousDataFn } : {}),
  });

  // Write every REAL success back to the durable cache.
  useEffect(() => {
    if (q.isSuccess && q.data !== undefined) {
      setCachedRead(cacheKey, q.data);
    }
  }, [q.isSuccess, q.data, cacheKey]);

  // Merge: show live data the moment it lands, otherwise the last-good seed.
  const showingSeed = q.data == null && seed != null;
  const data = q.data ?? seed?.data;
  const cachedAt = q.data != null ? q.dataUpdatedAt : (seed?.cachedAt ?? null);
  const isStale = useMemo(
    () => isStaleAt(cachedAt, staleAfterMs),
    [cachedAt, staleAfterMs],
  );

  return {
    data,
    // While showing the real seed, we are NOT loading and NOT errored — the
    // operator sees last-good numbers, not a spinner or a red state.
    isLoading: showingSeed ? false : q.isLoading,
    isError: showingSeed ? false : q.isError,
    isFetching: q.isFetching,
    cachedAt,
    fromCache: showingSeed,
    isStale,
    refetch: () => void q.refetch(),
  };
}
