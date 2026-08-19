/**
 * Atomic reservation — the heart of double-sale prevention (ADR-0016 §2).
 *
 * One SQL statement. Postgres' row-level locking guarantees exactly-one-winner
 * across all concurrent callers, regardless of channel. The loser gets `null`
 * back and chooses how to respond (POS shows a banner, storefront shows
 * "just sold", eBay calls endItem).
 *
 * No SELECT-then-UPDATE window. No optimistic version columns. No Redlock.
 * Just the discipline:
 *
 *   UPDATE products
 *      SET status = 'RESERVED', …
 *    WHERE id = $productId
 *      AND status = 'AVAILABLE'   ← the only race protection we need
 *   RETURNING …
 *
 * Per-channel TTL is computed inline so the DB's clock — not the app's — is
 * the source of `reservation_expires_at`.
 */

import type { AnyDb } from '@norns/db/client';
import { sql } from 'drizzle-orm';

import type { Channel, Reservation, ReserveInput, ReserveResult } from './types.js';

type ReservationRow = {
  id: string;
  reserved_by_channel: Channel;
  reserved_by_session_id: string;
  reserved_by_user_id: string | null;
  // drizzle's db.execute() returns timestamptz columns as raw strings, not Date.
  reserved_at: Date | string;
  reservation_expires_at: Date | string | null;
} & Record<string, unknown>;

export async function reserve(db: AnyDb, input: ReserveInput): Promise<ReserveResult> {
  const { productId, channel, sessionId, userId = null } = input;

  // Single statement. The WHERE clause is the race guard.
  // CASE inside SET keeps the TTL DB-clocked.
  const result = await db.execute<ReservationRow>(sql`
    UPDATE products
       SET status                 = 'RESERVED',
           reserved_by_channel    = ${channel}::reservation_channel,
           reserved_by_session_id = ${sessionId}::uuid,
           reserved_by_user_id    = ${userId}::uuid,
           reserved_at            = now(),
           reservation_expires_at = CASE ${channel}::reservation_channel
             WHEN 'POS'             THEN NULL
             WHEN 'STOREFRONT'      THEN now() + INTERVAL '15 minutes'
             WHEN 'EBAY'            THEN now() + INTERVAL '10 minutes'
             WHEN 'WEB_RESERVATION' THEN now() + INTERVAL '3 days'
           END
     WHERE id     = ${productId}::uuid
       AND status = 'AVAILABLE'
   RETURNING id,
             reserved_by_channel,
             reserved_by_session_id,
             reserved_by_user_id,
             reserved_at,
             reservation_expires_at
  `);

  const row = result[0];
  if (!row) return null;

  return rowToReservation(row);
}

// drizzle's db.execute() hands back timestamptz as a raw string, not a Date — so
// coerce here to honour the Reservation contract (reservedAt/expiresAt: Date).
// Without this, the reserve route's `result.reservedAt.toISOString()` throws a
// TypeError (HTTP 500) AFTER the row has already committed to RESERVED, which
// strands the product (client sees 500, retry sees "already reserved").
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function rowToReservation(row: ReservationRow): Reservation {
  return {
    productId: row.id,
    channel: row.reserved_by_channel,
    sessionId: row.reserved_by_session_id,
    userId: row.reserved_by_user_id,
    reservedAt: toDate(row.reserved_at),
    expiresAt: row.reservation_expires_at == null ? null : toDate(row.reservation_expires_at),
  };
}
