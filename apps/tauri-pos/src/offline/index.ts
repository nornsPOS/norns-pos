/**
 * warehouse14 desktop — offline resilience (ported from apps/mobile).
 *
 * The pieces that keep the till trustworthy on a patchy shop LAN, built ON TOP
 * of the live-data layer (TanStack Query) rather than replacing it:
 *
 *   read-cache     — durable last-good snapshots of successful reads, keyed by
 *                    cache key, with honest staleness metadata. Reads only.
 *   useCachedQuery — TanStack useQuery that seeds from + writes to the read cache
 *                    and reports cachedAt / fromCache / isStale.
 *   retry-policy   — the pure classifier: which writes may auto-retry (idempotent,
 *                    non-fiscal) and which must NEVER (fiscal / money-movement).
 *   StaleBadge     — the „Stand vor … / veraltet" marker beside cached values.
 *   OfflineNotice  — the inline offline note above cached data.
 *
 * Honesty rule: a cached value is a REAL prior response shown with its age, never
 * fabricated; a fiscal/money mutation is never queued or auto-fired here.
 */
export {
  installReadCachePersistence,
  hydrate,
  setCachedRead,
  getCachedRead,
  clearCachedRead,
  cacheAge,
  isStale,
  useCachedRead,
  resetReadCacheForTest,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_STALE_AFTER_MS,
  type ReadCachePersistence,
  type CachedEntry,
} from './read-cache.js';

export {
  useCachedQuery,
  type CachedQueryOptions,
  type CachedQueryResult,
} from './useCachedQuery.js';

export {
  classifyRetry,
  isSafeToRetry,
  isFiscalMutation,
  isFiscalPath,
  isTransientTransportError,
  describeRetryDecision,
  FISCAL_PATH_PREFIXES,
  type RetryDecision,
  type RetryCandidate,
} from './retry-policy.js';

export {
  useSafeRetry,
  type SafeRetryOptions,
  type SafeRetryResult,
} from './useSafeRetry.js';

export { StaleBadge, type StaleBadgeProps } from './StaleBadge.js';
export { OfflineNotice, type OfflineNoticeProps } from './OfflineNotice.js';
