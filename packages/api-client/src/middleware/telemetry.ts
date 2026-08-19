/**
 * Telemetry middleware — failure mode (C) auditor traceability.
 *
 * Responsibilities:
 *   - Generate a client trace ID and inject it as `X-Client-Trace-Id`
 *     outbound. This closes the gap where the client previously only *read*
 *     `x-request-id` from the response; the audit chain now starts at the
 *     cashier's keystroke (or the Owner's Live-Ops click from home).
 *   - Record start / success / error events through a pluggable Sink. The
 *     Sink interface is intentionally narrow so the Tauri side can later
 *     persist failed mutations to a local SQLite forensic ring-buffer for
 *     GoBD §146 reconstruction.
 *   - Capture exact wall-clock duration via `performance.now()`.
 *   - Preserve and propagate an upstream trace ID if one was supplied
 *     (used by retry middleware — same trace, attempt++).
 *   - Recognize `ApiCircuitOpenError` as a distinct event kind so audit
 *     reflects "we refused to make this call" rather than a generic error.
 */

import { ApiCircuitOpenError, ApiError, ApiNetworkError } from '../errors.js';
import type { Middleware, MiddlewareRequest, MiddlewareResponse } from '../middleware.js';

export interface TelemetryStartEvent {
  readonly traceId: string;
  readonly method: string;
  readonly path: string;
  readonly routeTemplate: string;
  readonly attempt: number;
  readonly startedAtMs: number;
}

export interface TelemetrySuccessEvent extends TelemetryStartEvent {
  readonly status: number;
  readonly requestId: string | null;
  readonly durationMs: number;
}

export interface TelemetryErrorEvent extends TelemetryStartEvent {
  readonly durationMs: number;
  readonly kind: 'api' | 'network' | 'circuit' | 'unknown';
  readonly code: string | null;
  readonly httpStatus: number | null;
  readonly requestId: string | null;
  readonly errorMessage: string;
}

export interface TelemetrySink {
  onStart(evt: TelemetryStartEvent): void;
  onSuccess(evt: TelemetrySuccessEvent): void;
  onError(evt: TelemetryErrorEvent): void;
}

export interface TelemetryOptions {
  sink: TelemetrySink;
  /** Override for tests / non-browser runtimes. */
  generateTraceId?: () => string;
  /** Defaults to `x-client-trace-id`. */
  headerName?: string;
  /**
   * Map a raw URL path to a stable label like `/ankauf/:id`. Returning `null`
   * falls back to `req.path`. Keep PII out of telemetry by normalizing here —
   * the auditor doesn't need the customer ID; the route template suffices.
   */
  routeTemplateOf?: (req: MiddlewareRequest) => string | null;
}

const defaultGenerateTraceId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export function telemetryMiddleware(opts: TelemetryOptions): Middleware {
  const headerName = (opts.headerName ?? 'x-client-trace-id').toLowerCase();
  const genId = opts.generateTraceId ?? defaultGenerateTraceId;
  const routeOf = opts.routeTemplateOf ?? ((r) => r.meta.routeTemplate ?? null);

  return async (req, next): Promise<MiddlewareResponse> => {
    const traceId = req.meta.traceId ?? genId();
    req.meta.traceId = traceId;
    req.headers[headerName] = traceId;

    const routeTemplate = routeOf(req) ?? req.path;
    const startedAtMs = performance.now();
    const base: TelemetryStartEvent = {
      traceId,
      method: req.method,
      path: req.path,
      routeTemplate,
      attempt: req.meta.attempt,
      startedAtMs,
    };

    opts.sink.onStart(base);

    try {
      const res = await next(req);
      opts.sink.onSuccess({
        ...base,
        status: res.status,
        requestId: res.requestId,
        durationMs: performance.now() - startedAtMs,
      });
      return { ...res, traceId };
    } catch (err) {
      opts.sink.onError({
        ...base,
        durationMs: performance.now() - startedAtMs,
        ...classifyError(err),
      });
      throw err;
    }
  };
}

function classifyError(err: unknown): {
  kind: 'api' | 'network' | 'circuit' | 'unknown';
  code: string | null;
  httpStatus: number | null;
  requestId: string | null;
  errorMessage: string;
} {
  if (err instanceof ApiError) {
    return {
      kind: 'api',
      code: err.code,
      httpStatus: err.httpStatus,
      requestId: err.requestId,
      errorMessage: err.message,
    };
  }
  if (err instanceof ApiNetworkError) {
    return {
      kind: 'network',
      code: null,
      httpStatus: null,
      requestId: null,
      errorMessage: err.message,
    };
  }
  if (err instanceof ApiCircuitOpenError) {
    return {
      kind: 'circuit',
      code: 'CIRCUIT_OPEN',
      httpStatus: null,
      requestId: null,
      errorMessage: err.message,
    };
  }
  return {
    kind: 'unknown',
    code: null,
    httpStatus: null,
    requestId: null,
    errorMessage: err instanceof Error ? err.message : String(err),
  };
}
