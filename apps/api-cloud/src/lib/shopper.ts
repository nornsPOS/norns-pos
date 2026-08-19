/**
 * Shopper context — the B2C counterpart to `Actor` (staff).
 *
 * The auth model deliberately keeps the two surfaces DISJOINT:
 *   • Staff routes consume `req.actor` populated from the `warehouse14.session`
 *     cookie via the staff auth plugin (better-auth / PIN login).
 *   • Storefront routes consume `req.shopper` populated from the
 *     `warehouse14.shopper_session` cookie via the storefront-session plugin.
 *
 * Mixing the two — e.g. a staff cookie giving access to /api/storefront/cart —
 * is impossible by construction: different cookie name, different plugin.
 */

import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';

import type { AppDb } from '@norns/db/client';
import { shopperSessions, shoppers } from '@norns/db/schema';

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

/** The shape attached to `req.shopper`. Mirrors `Actor` for ergonomics. */
export interface Shopper {
  id: string;
  customerId: string;
  /**
   * Whether the shopper's email is verified. PII (email/phone/address)
   * is decrypted on-demand via withPii in the route, not eagerly here.
   */
  emailVerified: boolean;
  preferredLanguage: 'de' | 'en' | 'ar';
  /** True when locked_until is in the future. */
  locked: boolean;
  /** Guest shopper (0085) — synthetic identity minted on the first cart action. */
  isGuest: boolean;
}

export interface ShopperSessionRow {
  id: string;
  token: string;
  expiresAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    shopper?: Shopper | undefined;
    shopperSession?: ShopperSessionRow | undefined;
  }
}

export class UnauthorizedShopperError extends DomainError {
  public readonly httpStatus = 401;
  public readonly code: ApiErrorCode = 'UNAUTHORIZED';
}

export class ShopperLockedError extends DomainError {
  public readonly httpStatus = 423;
  public readonly code: ApiErrorCode = 'PIN_LOCKED';
}

/**
 * Asserts that the request has an authenticated shopper attached.
 * Throws UnauthorizedShopperError → 401 UNAUTHORIZED otherwise.
 * Throws ShopperLockedError → 423 PIN_LOCKED if the shopper is currently
 * brute-force-locked.
 */
export function requireShopper(req: FastifyRequest): asserts req is FastifyRequest & {
  shopper: Shopper;
  shopperSession: ShopperSessionRow;
} {
  if (!req.shopper || !req.shopperSession) {
    throw new UnauthorizedShopperError('Shopper authentication required.');
  }
  if (req.shopper.locked) {
    throw new ShopperLockedError('Shopper account is locked. Please reset your password.');
  }
}

/**
 * Resolve a shopper by session token. Returns null if no row, or if the
 * session is expired, or if the shopper is soft-deleted.
 */
export async function loadShopperBySession(
  db: AppDb,
  token: string,
): Promise<{ shopper: Shopper; session: ShopperSessionRow } | null> {
  const rows = await db
    .select({
      sessionId: shopperSessions.id,
      sessionToken: shopperSessions.token,
      sessionExpires: shopperSessions.expiresAt,
      shopperId: shoppers.id,
      customerId: shoppers.customerId,
      emailVerifiedAt: shoppers.emailVerifiedAt,
      preferredLanguage: shoppers.preferredLanguage,
      lockedUntil: shoppers.lockedUntil,
      isGuest: shoppers.isGuest,
    })
    .from(shopperSessions)
    .innerJoin(shoppers, eq(shoppers.id, shopperSessions.shopperId))
    .where(
      // Widerrufene Sitzungen (0106) fallen hier heraus — der Stempel tötet die
      // Sitzung beim nächsten Request, ohne die Zeile zu löschen.
      drizzleSql`${shopperSessions.token} = ${token}
                 AND ${shopperSessions.expiresAt} > now()
                 AND ${shopperSessions.revokedAt} IS NULL
                 AND ${shoppers.softDeletedAt} IS NULL`,
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const now = new Date();
  const locked = !!(row.lockedUntil && row.lockedUntil > now);

  return {
    shopper: {
      id: row.shopperId,
      customerId: row.customerId,
      emailVerified: row.emailVerifiedAt !== null,
      preferredLanguage: (row.preferredLanguage as 'de' | 'en' | 'ar') ?? 'de',
      locked,
      isGuest: row.isGuest,
    },
    session: {
      id: row.sessionId,
      token: row.sessionToken,
      expiresAt: row.sessionExpires,
    },
  };
}
