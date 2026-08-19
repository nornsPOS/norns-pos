/**
 * Actor model — who is making this request, at the API tier.
 *
 * Decoupled from better-auth's `user` object because:
 *   • we add `isOwner` (the Day-12a flag with its own access semantics)
 *   • we add `lastPinStepUpAt` (Day-12a step-up bookkeeping on `sessions`)
 *   • we expose only the columns the route layer needs — no PII, no email.
 */

import { and, eq, isNull } from 'drizzle-orm';

import type { AppDb } from '@norns/db/client';
import { apiKeys, sessions, users } from '@norns/db/schema';

export type ActorRole = 'ADMIN' | 'CASHIER' | 'READONLY';

export interface Actor {
  id: string;
  role: ActorRole;
  isOwner: boolean;
  preferredLanguage: 'de' | 'en' | 'ar';
  /**
   * Set ONLY when the request authenticated with an API key (Track E). Carries
   * the `api_keys.id` for per-key rate-limiting + audit. `id` still points at a
   * real `users.id` (the key's creator) so audit FKs and ownership joins hold;
   * `isOwner` is always false for a key, so owner-only operations are refused.
   */
  apiKeyId?: string;
}

export interface ActorWithSession {
  actor: Actor;
  sessionId: string;
  /**
   * Most-recent PIN step-up timestamp on THIS session, or null if the user
   * has never stepped up on this session. Compared against the step-up
   * window in `requireStepUp()`.
   */
  lastPinStepUpAt: Date | null;
  sessionExpiresAt: Date;
  /**
   * The device this session was bound to at login (`sessions.device_id`), or
   * null. The auth preHandler compares it to the presenting `req.deviceId`
   * (0106 device-to-token binding): if BOTH are set and they differ, the token
   * is being replayed from a foreign device and is refused. Null on either side
   * = no binding to enforce (the pre-mTLS bypass path leaves it permissive).
   */
  sessionDeviceId: string | null;
}

/**
 * Load the actor + session bundle by session id.
 *
 * Skips soft-deleted users so a tombstoned account cannot reactivate by
 * presenting an old cookie. Returns null on miss; caller treats as 401.
 */
export async function loadActorBySession(
  db: AppDb,
  sessionId: string,
): Promise<ActorWithSession | null> {
  const rows = await db
    .select({
      userId: users.id,
      role: users.role,
      isOwner: users.isOwner,
      preferredLanguage: users.preferredLanguage,
      sessionId: sessions.id,
      lastPinStepUpAt: sessions.lastPinStepUpAt,
      sessionExpiresAt: sessions.expiresAt,
      sessionDeviceId: sessions.deviceId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    // Live session (0089: not explicitly revoked) belonging to a live user.
    .where(
      and(
        eq(sessions.id, sessionId),
        isNull(sessions.revokedAt),
        isNull(users.softDeletedAt),
      ),
    )
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    actor: {
      id: r.userId,
      role: r.role as ActorRole,
      isOwner: r.isOwner,
      preferredLanguage: r.preferredLanguage as 'de' | 'en' | 'ar',
    },
    sessionId: r.sessionId,
    lastPinStepUpAt: r.lastPinStepUpAt,
    sessionExpiresAt: r.sessionExpiresAt,
    sessionDeviceId: r.sessionDeviceId,
  };
}

/** Resolved API-key principal (Track E). */
export interface ApiKeyPrincipal {
  actor: Actor;
  /** Hard block on all mutations when true. */
  readOnly: boolean;
  /** Effective session expiry for the synthetic session (key expiry, or far future). */
  sessionExpiresAt: Date;
  /** Last-used stamp, for throttling the write-back. */
  lastUsedAt: Date | null;
}

/** Ten years out — the synthetic-session expiry for a key that never expires. */
const NON_EXPIRING = () => new Date(Date.now() + 10 * 365 * 24 * 60 * 60_000);

/**
 * Resolve an API key by its SHA-256 hash to a non-interactive principal.
 *
 * Returns null (→ 401) when the key is unknown, revoked, expired, or its owner
 * is soft-deleted. The actor's `id` is the key creator's `users.id` (audit FKs
 * hold), `isOwner` is forced false (owner-only ops refused), and `apiKeyId`
 * carries the key id for per-key rate-limiting + audit.
 */
export async function loadActorByApiKey(
  db: AppDb,
  tokenHash: string,
): Promise<ApiKeyPrincipal | null> {
  const rows = await db
    .select({
      keyId: apiKeys.id,
      role: apiKeys.role,
      readOnly: apiKeys.readOnly,
      ownerId: apiKeys.createdByUserId,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      lastUsedAt: apiKeys.lastUsedAt,
      ownerPref: users.preferredLanguage,
      ownerDeletedAt: users.softDeletedAt,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.createdByUserId))
    .where(eq(apiKeys.tokenHash, tokenHash))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  if (r.revokedAt) return null;
  if (r.ownerDeletedAt) return null;
  if (r.expiresAt && r.expiresAt.getTime() < Date.now()) return null;

  return {
    actor: {
      id: r.ownerId,
      role: r.role as ActorRole,
      isOwner: false,
      preferredLanguage: r.ownerPref as 'de' | 'en' | 'ar',
      apiKeyId: r.keyId,
    },
    readOnly: r.readOnly,
    sessionExpiresAt: r.expiresAt ?? NON_EXPIRING(),
    lastUsedAt: r.lastUsedAt,
  };
}
