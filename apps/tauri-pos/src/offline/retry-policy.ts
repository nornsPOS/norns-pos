/**
 * Safe-retry policy — the rule that decides which writes the app may quietly
 * retry on a flaky network, and which it must NEVER touch without the operator
 * standing right there.
 *
 * The hard line (honesty + fiscal safety, absolute): a money-movement or fiscal
 * mutation — a Verkauf finalize, an Ankauf, a Storno/Return, a cash movement, a
 * Z-Bon / shift-close — is NEVER auto-retried and NEVER silently queued from a
 * read surface. Those go through the server-side TSE/fiscal path, gated behind
 * step-up and an explicit confirm, and the api-client's own offline-queue
 * middleware (with caller-supplied idempotency keys + 10-year GoBD retention)
 * owns their durability. Re-firing one from here — without the cashier's intent
 * captured to disk first — could double-book a sale or mis-time a fiscal record.
 * So this module's job is mostly to say NO loudly and correctly.
 *
 * What IS safe to retry: idempotent, non-fiscal writes whose repetition changes
 * nothing — marking a task done, setting an appointment status, marking a
 * WhatsApp thread handled, toggling a preference. Repeating them lands the same
 * end state, so a transparent retry-on-reconnect is pure UX with no risk.
 *
 * Pure module — no React, no client, no I/O. It classifies a (method, path)
 * pair against the SAME fiscal-prefix source of truth the api-client uses
 * (`isGobdRelevantPath` / `FISCAL_PATH_PREFIXES`), so this app and the data
 * layer can never disagree about what counts as fiscal.
 */
import {
  ApiCircuitOpenError,
  ApiNetworkError,
  FISCAL_PATH_PREFIXES,
  isGobdRelevantPath,
  type HttpMethod,
} from "@norns/api-client"

/**
 * App-level fiscal paths the Owner OS posts to that aren't (yet) in the shared
 * `FISCAL_PATH_PREFIXES`. The mobile daily-closing finalize writes the legal
 * Z-Bon via `POST /api/closings/finalize` (closings.ts), which the upstream
 * prefix list — built around `/api/shifts/close` — doesn't cover. We never edit
 * the shared list from here; instead we LAYER these on top so this app's safety
 * guard is correct even where the upstream list lags. Listing it here also makes
 * the verdict an explicit „fiscal" (not the accidental „not-idempotent"), which
 * is what an auditor reading the reason expects.
 */
const APP_FISCAL_PATH_PREFIXES: readonly string[] = ["/api/closings/finalize"]

function isAppFiscalPath(path: string): boolean {
  return APP_FISCAL_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

/** The full fiscal set this app blocks: the shared prefixes plus the app-level ones. */
export function isFiscalPath(path: string): boolean {
  return isGobdRelevantPath(path) || isAppFiscalPath(path)
}

/** Re-export so a surface can show „warum nicht" without a second import. */
export { FISCAL_PATH_PREFIXES }

/**
 * Why a mutation is or isn't safe to auto-retry — surfaced so the UI can be
 * honest about the reason rather than just enabling/disabling a button.
 */
export type RetryDecision =
  /** Idempotent, non-fiscal — safe to retry transparently on reconnect. */
  | { safe: true }
  /** A fiscal / money-movement write — must be re-confirmed by a human. */
  | { safe: false; reason: "fiscal" }
  /** A non-idempotent write whose repeat could create a duplicate. */
  | { safe: false; reason: "not-idempotent" }
  /** A read — reads aren't „retried" through this path; useQuery refetches. */
  | { safe: false; reason: "read" }

/** A read method never goes through the mutation-retry path. */
function isReadMethod(method: HttpMethod): boolean {
  return method === "GET" || method === "HEAD"
}

/**
 * The shape a caller describes a candidate mutation with. `idempotent` defaults
 * to false — a write is only retried when the call site has affirmatively said
 * „repeating this is harmless" (the same contract the retry middleware uses via
 * `meta.custom.idempotent`). PUT/DELETE on a stable resource are idempotent by
 * REST semantics, but we do not infer it from the verb — the call site asserts
 * it, because only the call site knows the server's actual behaviour.
 */
export interface RetryCandidate {
  method: HttpMethod
  /** The api path the mutation posts to (the `/api/...` form). */
  path: string
  /**
   * The call site's assertion that repeating this exact request lands the same
   * end state. Default false. NEVER honoured for a fiscal path (see below).
   */
  idempotent?: boolean
}

/**
 * The single decision function. Order matters: fiscal is checked FIRST and
 * overrides everything — even an `idempotent: true` flag cannot unlock a fiscal
 * path, because the safety here is about money/tax records, not about whether
 * the HTTP call is technically repeatable.
 */
export function classifyRetry(candidate: RetryCandidate): RetryDecision {
  const { method, path, idempotent = false } = candidate

  if (isReadMethod(method)) return { safe: false, reason: "read" }

  // Fiscal / money-movement — the absolute red line. Never auto-retried.
  if (isFiscalPath(path)) return { safe: false, reason: "fiscal" }

  // Non-fiscal but the caller hasn't vouched that a repeat is harmless.
  if (!idempotent) return { safe: false, reason: "not-idempotent" }

  return { safe: true }
}

/** Convenience: just the boolean a guard wants. */
export function isSafeToRetry(candidate: RetryCandidate): boolean {
  return classifyRetry(candidate).safe
}

/** Convenience: true for the one case that must always be blocked. */
export function isFiscalMutation(method: HttpMethod, path: string): boolean {
  return !isReadMethod(method) && isFiscalPath(path)
}

/**
 * Whether a thrown value is a transient transport failure worth retrying once
 * we're back online. A clean `ApiError` from a reachable server is a real
 * answer (validation, conflict, sanctions) and must NOT be retried — only the
 * wire being down (or a circuit that just closed) qualifies. Mirrors the
 * connection store's `isConnectionError` classification on the read side.
 */
export function isTransientTransportError(error: unknown): boolean {
  return error instanceof ApiNetworkError || error instanceof ApiCircuitOpenError
}

/**
 * A calm German one-liner explaining a decision, for an inline notice. Honest
 * about WHY a write won't auto-retry — especially the fiscal case, where the
 * operator must come back and confirm at the till.
 */
export function describeRetryDecision(decision: RetryDecision): string {
  if (decision.safe) {
    return "Wird automatisch erneut versucht, sobald wieder Verbindung besteht."
  }
  switch (decision.reason) {
    case "fiscal":
      return "Steuerlich relevant bitte am Gerät erneut bestätigen, sobald wieder Verbindung besteht."
    case "not-idempotent":
      return "Diese Aktion wird nicht automatisch wiederholt, um Doppelbuchungen zu vermeiden."
    case "read":
      return "Daten werden automatisch aktualisiert, sobald wieder Verbindung besteht."
  }
}
