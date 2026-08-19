/**
 * Last-good read cache — the memory that lets the Owner OS keep showing real
 * numbers when the LAN drops mid-glance.
 *
 * The live-data layer (`useQuery`) already does stale-while-revalidate, but its
 * last-good data lives ONLY in that component's React state: navigate away and
 * back, or cold-start the app, and the surface is blank until the cloud answers
 * again. In a shop with a patchy LAN that means a dashboard that goes empty the
 * moment you switch tabs offline. This module is the durable shoulder under
 * `useQuery`: every SUCCESSFUL read snapshots its payload here, keyed by the
 * query's stable `key`, and a remount (or a cold start, once an adapter is
 * installed) can SEED from that snapshot while the real refetch runs underneath.
 *
 * Design mirrors `preferences.ts` / `onboarding.ts` / `celebrationStore.ts` to
 * the letter — an in-memory, `useSyncExternalStore`-friendly store with ZERO
 * required dependencies, plus an OPTIONAL async persistence adapter the app may
 * install once at start to survive cold starts. Without an adapter the cache is
 * session-scoped (survives remounts, not process death) — the same graceful
 * degradation as the session + onboarding stores. Persistence is fire-and-forget;
 * a storage failure never throws into the UI.
 *
 * Honesty rule (absolute): a cached value is NOT a fabricated number. It is a
 * real response from a real endpoint, captured at a real `cachedAt` instant.
 * What makes it honest is that we NEVER let it masquerade as live — every read
 * carries its `cachedAt`, and the staleness helpers below let a surface mark it
 * „Stand vor … " so the operator always knows whether they're looking at now or
 * at the last time we reached the cloud. The cache holds reads only; a mutation
 * (a sale, an Ankauf, a status change) is NEVER cached here.
 */
import { useSyncExternalStore } from "react"

/** An async key→string store the app may install (e.g. wrapping AsyncStorage). */
export interface ReadCachePersistence {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  /**
   * OPTIONAL: enumerate the keys this adapter currently holds (already
   * unprefixed — the cache adds/strips `STORAGE_PREFIX` itself). When present,
   * a full `clearCachedRead()` (sign-out) can purge the on-disk snapshots too,
   * so a new actor never inherits the previous one's persisted figures. Without
   * it the full clear still wipes memory; disk entries are then overwritten on
   * the next write of each key (the prior degraded behaviour, made explicit).
   */
  keys?: () => Promise<readonly string[]>
}

/** One cached read: the real payload plus the instant the cloud delivered it. */
export interface CachedEntry<T> {
  /** The exact response captured on a successful read. Never fabricated. */
  data: T
  /** `Date.now()` at capture — the source of every „Stand vor … " marker. */
  cachedAt: number
}

/**
 * How long a cached read is considered worth seeding from at all. Past this we
 * still keep it (a refetch may confirm it), but a surface may choose to suppress
 * a snapshot this old rather than show numbers from another shift. Generous by
 * default — being slightly stale beats blank, and the marker keeps it honest.
 */
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24h

/**
 * The age past which a cached read is „stale" and a surface should visibly say
 * so (the StaleBadge flips tone). Below this we still show the „Stand vor … "
 * timestamp, but calmly — it's recent enough to trust at a glance.
 */
export const DEFAULT_STALE_AFTER_MS = 60 * 1000 // 60s

/** Cap on distinct keys retained, so a long session can't grow unbounded. */
const MAX_ENTRIES = 200

const STORAGE_PREFIX = "w14.readcache."

// Module-level singleton — one cache per app process.
const entries = new Map<string, CachedEntry<unknown>>()
// Insertion/refresh order for cheap LRU-ish eviction (most-recent at the end).
const order: string[] = []
const listeners = new Set<() => void>()
let persistence: ReadCachePersistence | null = null

function emit(): void {
  for (const l of listeners) l()
}

function touchOrder(key: string): void {
  const i = order.indexOf(key)
  if (i !== -1) order.splice(i, 1)
  order.push(key)
  // Evict the least-recently-written entries past the cap.
  while (order.length > MAX_ENTRIES) {
    const evicted = order.shift()
    if (evicted != null) {
      entries.delete(evicted)
      // Best-effort drop from disk too; never blocks, never throws.
      if (persistence) void persistence.setItem(STORAGE_PREFIX + evicted, "").catch(() => {})
    }
  }
}

/**
 * Install a persistence adapter and (lazily) let cold-started reads hydrate from
 * it. Safe to call once at app start; without it the cache is session-scoped.
 * We do NOT eagerly slurp the whole store here — keys are hydrated on demand via
 * `hydrate(key)` so startup stays cheap and we only touch what a surface asks
 * for. Installing is itself side-effect-free beyond wiring the adapter.
 */
export function installReadCachePersistence(adapter: ReadCachePersistence): void {
  persistence = adapter
}

/**
 * Pull a single key from disk into memory if we don't already have it (and the
 * blob parses + is within `maxAgeMs`). Returns the hydrated entry, or null. A
 * read hook calls this once on mount so a cold-started surface can show its last
 * good data. Failures are swallowed — a bad blob just means no seed.
 */
export async function hydrate<T>(
  key: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<CachedEntry<T> | null> {
  const existing = entries.get(key) as CachedEntry<T> | undefined
  if (existing) return existing
  if (!persistence) return null
  try {
    const raw = await persistence.getItem(STORAGE_PREFIX + key)
    if (raw == null || raw === "") return null
    const parsed = JSON.parse(raw) as Partial<CachedEntry<T>>
    if (
      parsed == null ||
      typeof parsed.cachedAt !== "number" ||
      !Number.isFinite(parsed.cachedAt) ||
      !("data" in parsed)
    ) {
      return null
    }
    if (Date.now() - parsed.cachedAt > maxAgeMs) return null
    const entry: CachedEntry<T> = { data: parsed.data as T, cachedAt: parsed.cachedAt }
    entries.set(key, entry)
    touchOrder(key)
    emit()
    return entry
  } catch {
    // Read/parse failed — no seed; the live fetch will fill the surface.
    return null
  }
}

/**
 * Record a successful read. Call this ONLY on a real 2xx payload — never on an
 * error, never on a mutation. Overwrites any prior snapshot for the key with the
 * fresh data + a new `cachedAt`. Persistence is fire-and-forget.
 */
export function setCachedRead<T>(key: string, data: T): void {
  const entry: CachedEntry<T> = { data, cachedAt: Date.now() }
  entries.set(key, entry)
  touchOrder(key)
  emit()
  if (persistence) {
    try {
      const p = persistence.setItem(STORAGE_PREFIX + key, JSON.stringify(entry))
      if (p && typeof p.then === "function") p.then(undefined, () => {})
    } catch {
      // Serialize/store threw synchronously — keep the in-memory snapshot, stay quiet.
    }
  }
}

/** The current snapshot for a key (real data + cachedAt), or null. Pure read. */
export function getCachedRead<T>(key: string): CachedEntry<T> | null {
  return (entries.get(key) as CachedEntry<T> | undefined) ?? null
}

/** Drop one key (or the whole cache) — used on sign-out so a new actor starts clean. */
export function clearCachedRead(key?: string): void {
  if (key == null) {
    entries.clear()
    order.length = 0
  } else {
    entries.delete(key)
    const i = order.indexOf(key)
    if (i !== -1) order.splice(i, 1)
  }
  emit()
  if (persistence) {
    if (key == null) {
      // Full wipe (sign-out): purge the on-disk snapshots too so a new actor
      // never inherits the previous one's persisted figures. If the adapter can
      // enumerate its keys we blank each; if it can't, we fall back to the prior
      // degraded behaviour (disk entries are overwritten on each key's next
      // write). Best-effort + fire-and-forget — a storage failure never throws.
      const p = persistence
      if (p.keys) {
        void p
          .keys()
          .then((all) => {
            for (const k of all) void p.setItem(STORAGE_PREFIX + k, "").catch(() => {})
          })
          .catch(() => {})
      }
    } else {
      void persistence.setItem(STORAGE_PREFIX + key, "").catch(() => {})
    }
  }
}

// ── Staleness helpers (the honesty layer) ─────────────────────────────────────

/** Age of a cached entry in ms, or null if there is no entry. */
export function cacheAge(key: string, now: number = Date.now()): number | null {
  const e = entries.get(key)
  return e ? Math.max(0, now - e.cachedAt) : null
}

/**
 * True when a cached entry exists AND is older than `staleAfterMs`. A surface
 * uses this to flip a StaleBadge from calm („Stand vor 12 s") to a warm „veraltet"
 * tone — never to hide the value, only to be honest about its age.
 */
export function isStale(
  cachedAt: number | null,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
  now: number = Date.now(),
): boolean {
  if (cachedAt == null) return false
  return now - cachedAt >= staleAfterMs
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Reactive view of a single key's snapshot for a screen. Re-renders when that
 * key is (re)written. Returns the same `CachedEntry | null` the imperative
 * getter does, so a surface can read it with `useSyncExternalStore` semantics.
 */
export function useCachedRead<T>(key: string | null): CachedEntry<T> | null {
  return useSyncExternalStore(
    subscribe,
    () => (key ? ((entries.get(key) as CachedEntry<T> | undefined) ?? null) : null),
    () => (key ? ((entries.get(key) as CachedEntry<T> | undefined) ?? null) : null),
  )
}

/** TEST/DEV only — wipe the in-memory cache (does not touch persistence). */
export function resetReadCacheForTest(): void {
  entries.clear()
  order.length = 0
  persistence = null
  emit()
}
