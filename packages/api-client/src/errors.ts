/**
 * Stable error class for every non-2xx response. The backend always returns
 *
 *   { error: { code: ApiErrorCode, message, requestId, details? } }
 *
 * — we parse that shape and surface it as a typed exception. Front-end code
 * inspects `err.code` (not HTTP status) to decide UX behaviour:
 *
 *   STEP_UP_REQUIRED   → open PIN modal
 *   DEVICE_NOT_AUTHORIZED → log out + clear cookies
 *   VALIDATION_ERROR   → show inline form errors
 *   RATE_LIMITED       → show throttle banner
 */

import type { ApiErrorCode } from './types.js';

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly httpStatus: number;
  public readonly requestId: string | null;
  public readonly details: unknown;
  /**
   * WO es passiert ist, z. B. `NORNS-BARGELD-OHNE-SCHICHT`.
   *
   * ⚠️ `code` allein benennt nur die ART: 194 Fehlerklassen des Motors
   * fallen auf 20 Codes zusammen, 139 davon auf drei. Diese Kennung ist
   * die einzige, mit der ein Mensch am Telefon die STELLE benennen kann.
   *
   * `null`, wenn die Antwort sie nicht trug (ältere Fassung des Motors).
   */
  public readonly stelle: string | null;

  constructor(opts: {
    code: ApiErrorCode;
    message: string;
    httpStatus: number;
    requestId?: string | null;
    details?: unknown;
    stelle?: string | null;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.requestId = opts.requestId ?? null;
    this.details = opts.details;
    this.stelle = opts.stelle ?? null;
  }
}

/** Surfaces network-level failures (DNS, connection refused, timeout). */
export class ApiNetworkError extends Error {
  public override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ApiNetworkError';
    this.cause = cause;
  }
}

/**
 * Thrown by `circuitBreakerMiddleware` when an endpoint's failure rate has
 * exceeded the configured threshold and we're inside the cooldown window.
 *
 * Deliberately NOT an `ApiError` subclass: there's no real HTTP response and
 * no real status code. The UI should surface a degraded-service banner
 * ("Cloud-API momentan nicht erreichbar — versuche in {N}s wieder") rather
 * than the generic API error toast.
 *
 * The retry middleware MUST NOT retry this error — see middleware/retry.ts.
 */
export class ApiCircuitOpenError extends Error {
  public readonly bucket: string;
  public readonly openedAt: number;
  public readonly retryAfterMs: number;

  constructor(bucket: string, openedAt: number, retryAfterMs: number) {
    super(`circuit open for ${bucket} (retry after ${retryAfterMs}ms)`);
    this.name = 'ApiCircuitOpenError';
    this.bucket = bucket;
    this.openedAt = openedAt;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown by `offlineQueueMiddleware` (ADR-0044 §8) when a mutation could not
 * reach the cloud and has instead been durably persisted to the local
 * outbox for later replay.
 *
 * Semantically this is a **success** from the UI's point of view: the
 * operator's intent is safe and will sync. The catching screen should
 * advance its optimistic state and render a calm "Im Offline-Modus
 * gespeichert — Synchronisierung läuft" badge, NOT an error toast.
 *
 * `cause` carries the underlying transport failure (`ApiNetworkError` or
 * `ApiCircuitOpenError`) when the enqueue happened after a failed attempt;
 * it is `undefined` when the device was already known-offline at send time.
 */
export class ApiOfflineQueuedError extends Error {
  public readonly idempotencyKey: string;
  public readonly enqueuedAt: number;
  public override readonly cause: unknown;

  constructor(idempotencyKey: string, enqueuedAt: number, cause?: unknown) {
    super(`mutation queued offline (idempotency-key ${idempotencyKey})`);
    this.name = 'ApiOfflineQueuedError';
    this.idempotencyKey = idempotencyKey;
    this.enqueuedAt = enqueuedAt;
    this.cause = cause;
  }
}

/**
 * Raised by the outbox replay loop (ADR-0044 §6/§8) when a replayed mutation
 * diverges from server state and CANNOT be auto-resolved — e.g. a Storno
 * against an already-closed Tagesabschluss (`CLOSING_DAY_FINALIZED`), an
 * Ankauf whose metal price moved beyond tolerance (`STATE_DIVERGED`/`CONFLICT`),
 * the same idempotency key replayed with a different body, or a customer
 * sanctioned during the offline window (`SANCTIONS_BLOCK`).
 *
 * This HALTS the queue at the offending row. Per ADR-0044 §8 it is NOT thrown
 * back to the original caller (who already received `ApiOfflineQueuedError`
 * and moved on) — the replay loop surfaces it via an event so the Owner can
 * resolve it in the Compliance Inbox (ADR-0045).
 */
export class ApiOutboxConflictError extends Error {
  public readonly idempotencyKey: string;
  /** The backend `ApiErrorCode` (or `'UNKNOWN'`) that classified this halt. */
  public readonly serverCode: string;
  public readonly serverDetails: unknown;

  constructor(opts: {
    idempotencyKey: string;
    serverCode: string;
    serverDetails?: unknown;
    message?: string;
  }) {
    super(opts.message ?? `outbox replay conflict (${opts.serverCode}) for ${opts.idempotencyKey}`);
    this.name = 'ApiOutboxConflictError';
    this.idempotencyKey = opts.idempotencyKey;
    this.serverCode = opts.serverCode;
    this.serverDetails = opts.serverDetails;
  }
}
