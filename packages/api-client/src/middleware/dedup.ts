/**
 * In-flight dedup middleware — failure mode (D) fan-out waste.
 *
 * Coalesces concurrent identical GETs onto a single underlying request.
 * Particularly valuable in the Warehouse14 Live-Ops dashboard, where the
 * Owner's Control Desktop can have four panels subscribed to the same
 * `/dashboard/summary` or `/metal-prices/current` endpoint.
 *
 * Invariants (deliberately conservative — POS reads are cheap, correctness
 * is not):
 *   1. Only methods declared idempotent are eligible. Default: GET only.
 *      Callers MAY opt out per-request via `meta.dedup = false`.
 *      POST/PATCH/PUT/DELETE are NEVER deduped here. (Idempotency keys for
 *      mutations are a Phase 3 concern — different mechanism.)
 *   2. Joiner abort is refcounted: the underlying ("master") request is
 *      aborted ONLY when every joined caller has aborted. A single caller
 *      losing interest must NOT cancel work the other panels still need.
 *   3. The map entry is deleted the instant the master settles. Late joiners
 *      after settle get a fresh request. No stale-cache hazards — this is
 *      coalescing, not caching.
 *
 * SWR-style caching (TTL-bound) is a deliberately separate concern and stays
 * out of scope here.
 */

import type { Middleware, MiddlewareRequest, MiddlewareResponse, Next } from '../middleware.js';

export interface DedupOptions {
  shouldDedup?: (req: MiddlewareRequest) => boolean;
  keyFn?: (req: MiddlewareRequest) => string;
}

interface InflightEntry {
  refCount: number;
  master: AbortController;
  promise: Promise<MiddlewareResponse>;
}

const isIdempotent = (req: MiddlewareRequest): boolean =>
  req.method === 'GET' && req.meta.dedup !== false;

const defaultKey = (req: MiddlewareRequest): string => `${req.method} ${req.url}`;

export function inflightDedupMiddleware(opts: DedupOptions = {}): Middleware {
  const inflight = new Map<string, InflightEntry>();
  const shouldDedup = opts.shouldDedup ?? isIdempotent;
  const keyFn = opts.keyFn ?? defaultKey;

  return async (req, next): Promise<MiddlewareResponse> => {
    if (!shouldDedup(req)) return next(req);

    const key = keyFn(req);
    const existing = inflight.get(key);
    if (existing) {
      existing.refCount++;
      return join(existing, req.signal);
    }

    const master = new AbortController();
    const entry: InflightEntry = {
      refCount: 1,
      master,
      promise: runMaster(req, next, master, () => inflight.delete(key)),
    };
    inflight.set(key, entry);
    return join(entry, req.signal);
  };
}

async function runMaster(
  req: MiddlewareRequest,
  next: Next,
  master: AbortController,
  onSettle: () => void,
): Promise<MiddlewareResponse> {
  // Decouple master from caller signal — joiners control liveness via
  // refcount, not directly. Otherwise one caller's abort would cancel the
  // call that all the others are still waiting for.
  const masterReq: MiddlewareRequest = { ...req, signal: master.signal };
  try {
    return await next(masterReq);
  } finally {
    onSettle();
  }
}

function join(entry: InflightEntry, callerSignal: AbortSignal): Promise<MiddlewareResponse> {
  if (callerSignal.aborted) {
    decrement(entry, callerSignal.reason);
    return Promise.reject(callerSignal.reason ?? new Error('aborted'));
  }
  const onAbort = (): void => decrement(entry, callerSignal.reason);
  callerSignal.addEventListener('abort', onAbort, { once: true });
  return entry.promise.finally(() => callerSignal.removeEventListener('abort', onAbort));
}

function decrement(entry: InflightEntry, reason: unknown): void {
  entry.refCount--;
  if (entry.refCount <= 0 && !entry.master.signal.aborted) {
    entry.master.abort(reason);
  }
}
