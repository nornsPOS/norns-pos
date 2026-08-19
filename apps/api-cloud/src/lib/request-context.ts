/**
 * Per-request context propagated via AsyncLocalStorage.
 *
 * Two responsibilities:
 *   1. Make actor + device + request-id reachable from any depth without
 *      threading them through every function signature.
 *   2. Carry the per-request PII key — the *single* place where the API
 *      tier decides which encryption key downstream queries will use.
 *
 * The PII key is INTENTIONALLY in the context rather than read from env at
 * the query site, because Phase 1.5 will derive per-shop / per-tenant keys
 * from a KMS lookup at request entry. Code that consumes the key today via
 * `currentPiiKey()` will continue to work unchanged when that lands.
 *
 * Safety guarantees:
 *   • `als.run(ctx, fn)` is the ONLY way to enter a scope; there is no
 *     `als.enterWith` exposed here — leaving the scope is automatic.
 *   • `currentContext()` returns `null` outside a scope, never the empty
 *     object — callers must handle the public-route case explicitly.
 *   • The key is never logged. Pino's serializers do not reach into this
 *     module's exports.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Authenticated user id, or null on a public route. */
  actorId: string | null;
  /** mTLS-paired device id, or null in tests / public routes. */
  deviceId: string | null;
  /** Same as `req.id` — UUID v4. */
  requestId: string;
  /**
   * The PII encryption key for this request's encrypted-column operations.
   * V1: copied from env.NORNS_PII_KEY at request entry.
   * V2: derived per-shop from KMS.
   */
  piiKey: string;
}

const als = new AsyncLocalStorage<RequestContext>();

/** Run `fn` inside a fresh request scope. Returns whatever `fn` returns. */
export function runInRequestScope<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Read the active context. Returns `null` outside any request scope. */
export function currentContext(): RequestContext | null {
  return als.getStore() ?? null;
}

/**
 * Convenience getter for the PII key. Throws if called outside a request
 * scope — refusing to silently fall back to env. The caller must either be
 * inside a request OR must use `withPiiKey` from `@norns/db` explicitly.
 */
export function currentPiiKey(): string {
  const ctx = als.getStore();
  if (!ctx) {
    throw new Error(
      'currentPiiKey() called outside a request scope. ' +
        'Wrap your code in runInRequestScope(...) or use @norns/db withPiiKey() directly.',
    );
  }
  return ctx.piiKey;
}

/**
 * Convenience getter for the current actor id. Returns `null` on public
 * routes that have no authenticated actor.
 */
export function currentActorId(): string | null {
  return als.getStore()?.actorId ?? null;
}
