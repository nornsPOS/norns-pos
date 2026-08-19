/**
 * The middleware contract every cross-cutting concern (telemetry, dedup,
 * retry, circuit breaker, offline queue, step-up) implements. Pure types —
 * no runtime dependencies, no React, no Tauri. Safe to share with backend
 * test harnesses.
 *
 * Layer order in production (see ADR-0043, locked):
 *
 *   caller
 *     → step-up               # UX replay on STEP_UP_REQUIRED, single shot
 *       → offline-queue       # (Phase 3) durable enqueue on network failure
 *         → retry             # infra retry on idempotent + retryable
 *           → telemetry       # per-attempt audit, includes CIRCUIT_OPEN refusals
 *             → circuit       # per-bucket health; fast-fails in cooldown
 *               → dedup       # coalesce concurrent identical GETs
 *                 → terminal fetch
 */

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestMeta {
  /** Set by the telemetry middleware on first pass; propagated by retries. */
  traceId?: string;
  /** 1 on first attempt, incremented by retry middleware. */
  attempt: number;
  /** `performance.now()` captured at the public `request()` entry. */
  startedAt: number;
  /** Opt out of in-flight dedup for an idempotent GET that *should* refetch. */
  dedup?: boolean;
  /**
   * Per-ATTEMPT network timeout in ms; the terminal composes it with the caller
   * signal for each fetch. Deliberately NOT baked into `signal`: time spent
   * awaiting the step-up PIN dialog or sleeping between retries must never count
   * against the network window (a slow PIN entry used to abort the replay).
   */
  timeoutMs?: number;
  /** Normalized route template for telemetry (e.g. `/ankauf/:id`). */
  routeTemplate?: string;
  /**
   * Free slot for downstream concerns without polluting the typed surface.
   * Recognized keys:
   *   skipStepUp        — session-probe / replay loop pass-through
   *   stepUpReplay      — set by step-up after PIN; prevents re-prompt loop
   *   skipOfflineQueue  — Phase 3: replay loop sets this to avoid recursion
   *   idempotencyKey    — Phase 3: caller-supplied or middleware-generated
   *   idempotent        — explicit opt-in to retry on mutations
   *   gobdRelevant      — Phase 3: classify into 10y vs 30d retention
   */
  custom?: Record<string, unknown>;
  /**
   * Success-body handling: `'text'` returns the raw body unparsed (CSV
   * downloads); `'arraybuffer'` returns raw bytes (binary downloads, e.g. the
   * private KYC image).
   */
  responseType?: 'json' | 'text' | 'arraybuffer';
}

export interface MiddlewareRequest {
  readonly method: HttpMethod;
  /** Fully-resolved URL (baseUrl + path). */
  readonly url: string;
  /** Original path as the caller passed it. */
  readonly path: string;
  /** Mutable. Middleware MAY add headers (e.g. trace, idempotency-key). */
  headers: Record<string, string>;
  /** Not yet stringified. Middleware MAY rewrite (e.g. signing). */
  body: unknown;
  /**
   * The CALLER's abort signal only (never aborts unless the caller cancels).
   * The per-attempt timeout is composed with it inside the terminal per fetch
   * (see `meta.timeoutMs`) — so PIN dialogs and retry sleeps don't burn it.
   */
  readonly signal: AbortSignal;
  readonly meta: RequestMeta;
}

export interface MiddlewareResponse {
  readonly data: unknown;
  readonly status: number;
  readonly headers: Headers;
  /** Server-issued, from `x-request-id` response header. */
  readonly requestId: string | null;
  /** Client-issued, mirror of `meta.traceId`. */
  readonly traceId: string | null;
}

export type Next = (req: MiddlewareRequest) => Promise<MiddlewareResponse>;
export type Middleware = (req: MiddlewareRequest, next: Next) => Promise<MiddlewareResponse>;

/**
 * Onion composition: `compose([A, B, C], terminal)` produces a Next that
 * executes `A( B( C( terminal ) ) )`. Order in the array == order of entry.
 *
 * Audit invariant: the production middleware array is exported as a single
 * const in `apps/tauri-pos/src/lib/api-context.tsx` and asserted in a CI
 * smoke test (ADR-0043 Action Item).
 */
export function compose(middlewares: readonly Middleware[], terminal: Next): Next {
  return middlewares.reduceRight<Next>((next, mw) => (req) => mw(req, next), terminal);
}
