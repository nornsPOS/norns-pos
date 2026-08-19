/**
 * Infra retry — failure mode (B). Conservative defaults:
 *
 *   - GET / HEAD only by default. Mutations require explicit
 *     `meta.custom.idempotent === true` (Phase 3 will set this automatically
 *     when an idempotency key is injected).
 *   - Full-jitter exponential backoff (AWS-style):
 *       delay = random(0, min(maxDelay, baseDelay * 2^(attempt-1)))
 *   - Honors `Retry-After` if the terminal extracted one onto
 *     `ApiError.details.retryAfterMs`. Uses max(jittered, retryAfter).
 *   - Excludes STEP_UP_REQUIRED and ApiCircuitOpenError explicitly. Step-up
 *     sits ABOVE retry in production, so retry will never see
 *     STEP_UP_REQUIRED under normal ordering — the exclusion is
 *     defense-in-depth in case the chain is reordered.
 *   - Warehouse14-specific non-retryable codes: PIN_LOCKED, SANCTIONS_BLOCK,
 *     CLOSING_DAY_FINALIZED, STORNO_OF_STORNO, PRODUCT_NOT_RESERVABLE,
 *     DEVICE_NOT_AUTHORIZED — all are semantic, retrying produces the same
 *     answer (and PIN_LOCKED retries would worsen the lock state).
 *   - Aborts immediately on caller signal — never sleeps through a cancel.
 */

import { ApiCircuitOpenError, ApiError, ApiNetworkError } from '../errors.js';
import type { Middleware, MiddlewareRequest, MiddlewareResponse } from '../middleware.js';
import type { ApiErrorCode } from '../types.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown, req: MiddlewareRequest) => boolean;
  /** For deterministic tests. */
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const NON_RETRYABLE_CODES: ReadonlySet<ApiErrorCode> = new Set([
  'STEP_UP_REQUIRED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'PIN_LOCKED',
  'SANCTIONS_BLOCK',
  'CLOSING_DAY_FINALIZED',
  'STORNO_OF_STORNO',
  'PRODUCT_NOT_RESERVABLE',
  'DEVICE_NOT_AUTHORIZED',
]);

const RETRYABLE_HTTP_STATUS: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

const defaultIsRetryable = (err: unknown, req: MiddlewareRequest): boolean => {
  const idempotent =
    req.method === 'GET' || req.method === 'HEAD' || req.meta.custom?.idempotent === true;
  if (!idempotent) return false;

  if (err instanceof ApiCircuitOpenError) return false;
  if (err instanceof ApiNetworkError) return true;
  if (err instanceof ApiError) {
    if (NON_RETRYABLE_CODES.has(err.code)) return false;
    return RETRYABLE_HTTP_STATUS.has(err.httpStatus);
  }
  return false;
};

function computeBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
  retryAfterMs: number | undefined,
): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jittered = Math.floor(random() * cap);
  return retryAfterMs !== undefined ? Math.max(jittered, retryAfterMs) : jittered;
}

function extractRetryAfterMs(err: unknown): number | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const d = err.details;
  if (d && typeof d === 'object' && 'retryAfterMs' in d) {
    const v = (d as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return undefined;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function retryMiddleware(opts: RetryOptions = {}): Middleware {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  const maxDelayMs = opts.maxDelayMs ?? 4_000;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;
  const random = opts.random ?? Math.random;
  const sleep = opts.sleep ?? defaultSleep;

  return async (req, next): Promise<MiddlewareResponse> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      req.meta.attempt = attempt;
      try {
        return await next(req);
      } catch (err) {
        lastErr = err;
        if (req.signal.aborted) throw err;
        if (attempt >= maxAttempts) throw err;
        if (!isRetryable(err, req)) throw err;
        const delay = computeBackoffMs(
          attempt,
          baseDelayMs,
          maxDelayMs,
          random,
          extractRetryAfterMs(err),
        );
        await sleep(delay, req.signal);
      }
    }
    throw lastErr;
  };
}
