/**
 * Per-bucket circuit breaker — failure mode (B) endpoint flaps.
 *
 * Two states: CLOSED, OPEN. After OPEN cooldown elapses, the next attempt
 * acts as an implicit probe — success closes, failure re-opens. No explicit
 * HALF_OPEN state: at Warehouse14 POS scale (single shop, <1 rps client-
 * side) the implicit probe is simpler to reason about and indistinguishable
 * in behaviour.
 *
 * What counts as a "failure" for state purposes is intentionally narrow:
 *   - ApiNetworkError (any)
 *   - ApiError with httpStatus 429 or 5xx
 *
 * 4xx-auth (UNAUTHORIZED, FORBIDDEN, STEP_UP_REQUIRED) and 4xx-client
 * (VALIDATION_ERROR, CONFLICT, NOT_FOUND, PIN_LOCKED, SANCTIONS_BLOCK) are
 * NOT counted — they reflect client state, not endpoint distress, and
 * counting them would let a mis-PIN'd cashier flip the circuit for a
 * perfectly healthy endpoint.
 *
 * Bucketing is by `meta.routeTemplate` (e.g. `/ankauf/:id`) so that a string
 * of failures on one customer doesn't open the circuit for all customers.
 */

import { ApiCircuitOpenError, ApiError, ApiNetworkError } from '../errors.js';
import type { Middleware, MiddlewareRequest, MiddlewareResponse } from '../middleware.js';

export interface CircuitOptions {
  threshold?: number;
  cooldownMs?: number;
  bucketOf?: (req: MiddlewareRequest) => string;
  isFailure?: (err: unknown) => boolean;
  /** Injected for deterministic tests. */
  now?: () => number;
}

interface Closed {
  readonly kind: 'closed';
  readonly failures: number;
}
interface Open {
  readonly kind: 'open';
  readonly openedAt: number;
  readonly failures: number;
}
type BucketState = Closed | Open;

const defaultBucketOf = (req: MiddlewareRequest): string =>
  `${req.method} ${req.meta.routeTemplate ?? req.path}`;

const defaultIsFailure = (err: unknown): boolean => {
  if (err instanceof ApiCircuitOpenError) return false;
  if (err instanceof ApiNetworkError) return true;
  if (err instanceof ApiError) {
    return err.httpStatus === 429 || (err.httpStatus >= 500 && err.httpStatus < 600);
  }
  return false;
};

export function circuitBreakerMiddleware(opts: CircuitOptions = {}): Middleware {
  const threshold = opts.threshold ?? 5;
  const cooldownMs = opts.cooldownMs ?? 30_000;
  const bucketOf = opts.bucketOf ?? defaultBucketOf;
  const isFailure = opts.isFailure ?? defaultIsFailure;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, BucketState>();

  return async (req, next): Promise<MiddlewareResponse> => {
    const bucket = bucketOf(req);
    const current: BucketState = buckets.get(bucket) ?? { kind: 'closed', failures: 0 };

    if (current.kind === 'open') {
      const elapsed = now() - current.openedAt;
      if (elapsed < cooldownMs) {
        throw new ApiCircuitOpenError(bucket, current.openedAt, cooldownMs - elapsed);
      }
      // Cooldown elapsed — fall through; this attempt is the probe.
    }

    try {
      const res = await next(req);
      buckets.set(bucket, { kind: 'closed', failures: 0 });
      return res;
    } catch (err) {
      if (!isFailure(err)) throw err;
      const prevFailures = current.failures;
      const failures = prevFailures + 1;
      if (failures >= threshold) {
        buckets.set(bucket, { kind: 'open', openedAt: now(), failures });
      } else {
        buckets.set(bucket, { kind: 'closed', failures });
      }
      throw err;
    }
  };
}
