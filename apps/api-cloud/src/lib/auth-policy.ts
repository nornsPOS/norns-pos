/**
 * Auth policy primitives — typed errors + route helpers.
 *
 * The route layer calls `requireAuth(req)`, `requireRole(req, 'ADMIN')`,
 * `requireOwner(req)`, `requireStepUp(req, { maxAgeMinutes })`. Each throws
 * a typed DomainError when the precondition fails; the error-handler plugin
 * from Day 11 maps it to the right HTTP status + stable error code.
 *
 * Basel Day-12b directive: step-up window = 10 minutes for sensitive actions.
 */

import type { FastifyRequest } from 'fastify';

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import type { Actor, ActorRole, ActorWithSession } from './actor.js';

/** Default step-up freshness window for sensitive actions (ADR-0022 §4c + Basel directive). */
export const STEP_UP_WINDOW_MINUTES = 10;

/**
 * ⚠️ 08.08.2026 — EIN LÄNGERES FENSTER WURDE ERWOGEN UND VERWORFEN.
 *
 * Gemessen: `requireStepUp` nimmt seit jeher ein `maxAgeMinutes`, und von
 * 17 Aufrufstellen setzt es KEINE. Der Regler ist gebaut und nirgends
 * angeschlossen — für sich genommen die Hauskrankheit „gebaut und nie
 * angeschlossen".
 *
 * Ein Ausmesser schlug daraufhin vor, die verwaltenden Türen (Personal
 * anlegen und deaktivieren, Kassencode löschen, Stück löschen) auf ein
 * längeres Fenster zu setzen: reine Reibung, kein Schutz.
 *
 * Der Umbau wurde gemacht und WIEDER ZURÜCKGENOMMEN. Basel hat am
 * 05.08.2026 bereits entschieden, welche Handlungen den Code verlangen, und
 * genau diese vier stehen mit eigener Begründung auf seiner Liste:
 * „Macht über andere: wer darf handeln, und womit." Der Wächter
 * `code-nur-fuer-unwiderrufliches.guard` hat den Umbau rot gemacht.
 *
 * Der Regler bleibt deshalb ungenutzt. Das ist hier kein vergessenes Bauteil,
 * sondern eine Entscheidung: es gibt zurzeit keine Tür, die ihn verdient.
 */

/**
 * Tolerated negative skew between the API process clock and the clock that
 * stamped `last_pin_step_up_at`. That timestamp is written by the DB (`now()`
 * on PIN step-up) and is NEVER client-supplied, so a value a few seconds in the
 * "future" relative to the API host can only mean clock drift between the two
 * machines — not tampering. Without this, a fresh step-up is falsely rejected
 * whenever the auth DB runs marginally ahead of the API. Standard leeway, the
 * same idea as JWT `nbf`/`iat` validators. The upper bound (real freshness) is
 * unchanged, so a genuinely stale step-up is still rejected.
 */
export const STEP_UP_CLOCK_SKEW_MS = 60_000;

// ────────────────────────────────────────────────────────────────────────
// Typed errors — picked up by plugins/error-handler.ts.
// ────────────────────────────────────────────────────────────────────────

export class UnauthorizedError extends DomainError {
  public readonly httpStatus = 401;
  public readonly code: ApiErrorCode = 'UNAUTHORIZED';
}

export class ForbiddenError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'FORBIDDEN';
}

export class StepUpRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'STEP_UP_REQUIRED';
  public readonly windowMinutes: number;
  public constructor(windowMinutes: number) {
    super(`PIN step-up required (within last ${windowMinutes} minutes)`);
    this.windowMinutes = windowMinutes;
  }
}

export class PinLockedError extends DomainError {
  public readonly httpStatus = 423;
  public readonly code: ApiErrorCode = 'PIN_LOCKED';
  public readonly lockedUntil: Date;
  public constructor(lockedUntil: Date) {
    super(`PIN locked until ${lockedUntil.toISOString()} — Full Login required to unlock`);
    this.lockedUntil = lockedUntil;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Request decorations — populated by the auth plugin.
// ────────────────────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    /** `null` on unauthenticated / public routes. */
    actor: Actor | null;
    /** `null` on unauthenticated / public routes. */
    session: ActorWithSession | null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Guards.
// ────────────────────────────────────────────────────────────────────────

/** Throws if no actor — i.e. the request is not authenticated. */
export function requireAuth(req: FastifyRequest): asserts req is FastifyRequest & {
  actor: Actor;
  session: ActorWithSession;
} {
  if (!req.actor || !req.session) {
    throw new UnauthorizedError('Authentication required');
  }
}

/** Requires that the actor has one of the listed roles. */
export function requireRole(req: FastifyRequest, ...roles: ActorRole[]): void {
  requireAuth(req);
  if (!roles.includes(req.actor.role)) {
    throw new ForbiddenError(
      `Role required: ${roles.join(' | ')}; actor role is ${req.actor.role}`,
    );
  }
}

/**
 * Requires that the actor is the Owner. Combines `requireAuth` + the
 * `is_owner` bit. Used for the rare Owner-only routes (manual ledger
 * rollover, manual KYC purge initiation, etc.).
 */
/*
 * ⚠️ `asserts` und nicht `void` (21.08.2026). Die Prüfung stellt fest, dass
 * `req.actor` da IST — schrieb man das nicht in die Form, müsste jeder
 * Aufrufer danach `req.actor` erneut auf null prüfen oder mit einem Griff wie
 * `req.actor as unknown as { id: string }` daran vorbei. Genau so ein Griff
 * steht in `auth-pin.ts`; er ist heute nicht mehr nötig.
 */
export function requireOwner(req: FastifyRequest): asserts req is FastifyRequest & {
  actor: Actor;
  session: ActorWithSession;
} {
  requireAuth(req);
  if (!req.actor.isOwner) {
    throw new ForbiddenError('Owner-only operation');
  }
}

/**
 * Requires that the current session has a PIN step-up within the last
 * `maxAgeMinutes` (default 10). On failure, throws a StepUpRequiredError
 * which the front-end catches and shows the PIN prompt.
 *
 * Basel directive (Day 12b): step-up validity = 10 minutes maximum.
 */
export function requireStepUp(
  req: FastifyRequest,
  opts: { maxAgeMinutes?: number; now?: Date } = {},
): void {
  const window = opts.maxAgeMinutes ?? STEP_UP_WINDOW_MINUTES;
  const now = opts.now ?? new Date();

  requireAuth(req);
  const last = req.session.lastPinStepUpAt;
  if (!last) {
    throw new StepUpRequiredError(window);
  }
  const ageMs = now.getTime() - last.getTime();
  if (ageMs < -STEP_UP_CLOCK_SKEW_MS || ageMs > window * 60_000) {
    throw new StepUpRequiredError(window);
  }
}

/**
 * Composed helper: Owner-only + step-up fresh. Common pattern for
 * destructive single-actor operations.
 */
export function requireOwnerStepUp(req: FastifyRequest): asserts req is FastifyRequest & {
  actor: Actor;
  session: ActorWithSession;
} {
  requireOwner(req);
  requireStepUp(req);
}
