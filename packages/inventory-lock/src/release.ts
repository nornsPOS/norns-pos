/**
 * Release a reservation back to AVAILABLE.
 *
 * Called when:
 *   • storefront Mollie checkout abandoned / payment failed
 *   • eBay Best Offer rejected
 *   • POS cart cleared
 *   • admin manual release
 *
 * Ownership guards (memory.md §19.2 C-1 fix):
 *   • `status = 'RESERVED'`                                   — must be reserved
 *   • `reserved_by_session_id = ${sessionId}`                 — same checkout session
 *   • `reserved_by_user_id IS NOT DISTINCT FROM ${userId}`    — same operator
 *
 * `IS NOT DISTINCT FROM` treats NULL = NULL, so a STOREFRONT guest /
 * worker autoRelease can pass `userId: null` against a guest row. A
 * logged-in cashier MUST pass their actor id — closes the same
 * cross-cashier exploit that the finalize fix closes.
 *
 * Auto-release of expired reservations is a SEPARATE flow
 * (`autoReleaseExpired`) keyed by `reservation_expires_at < now()`, not
 * by session id — it bypasses the ownership guards by design.
 */

import type { AnyDb } from '@norns/db/client';
import { sql } from 'drizzle-orm';

import { ReservationOwnershipError } from './errors.js';
import type { ReleaseInput } from './types.js';

export async function release(db: AnyDb, input: ReleaseInput): Promise<void> {
  const { productId, sessionId, userId } = input;

  const result = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    UPDATE products
       SET status                 = 'AVAILABLE',
           reserved_by_channel    = NULL,
           reserved_by_session_id = NULL,
           reserved_by_user_id    = NULL,
           reserved_at            = NULL,
           reservation_expires_at = NULL
     WHERE id                     = ${productId}::uuid
       AND status                 = 'RESERVED'
       AND reserved_by_session_id = ${sessionId}::uuid
       AND reserved_by_user_id    IS NOT DISTINCT FROM ${userId}::uuid
   RETURNING id
  `);

  if (result.length === 0) {
    throw new ReservationOwnershipError(productId);
  }
}
