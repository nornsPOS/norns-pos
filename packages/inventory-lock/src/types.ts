/**
 * Public types for @norns/inventory-lock.
 *
 * Keep this surface minimal — each new field on a Reservation type is one more
 * thing every caller must understand. Only widen when a real consumer needs it.
 */

export type Channel = 'POS' | 'STOREFRONT' | 'EBAY' | 'WEB_RESERVATION';

/** Snapshot of a successful reservation, returned by `reserve()`. */
export interface Reservation {
  productId: string;
  channel: Channel;
  sessionId: string;
  userId: string | null;
  reservedAt: Date;
  /** `null` for POS reservations (held indefinitely). */
  expiresAt: Date | null;
}

/** Input shape for `reserve()`. */
export interface ReserveInput {
  productId: string;
  channel: Channel;
  /** UUID for traceability. Generate one fresh per checkout attempt. */
  sessionId: string;
  /**
   * Internal user (cashier for POS, customer account for STOREFRONT if logged
   * in). `null` for guest checkout and eBay (no internal user).
   */
  userId?: string | null;
}

/** Outcome of `reserve()`. `null` means the race was lost. */
export type ReserveResult = Reservation | null;

/** Input shape for `release()`. */
export interface ReleaseInput {
  productId: string;
  /** Must match `reserved_by_session_id` on the row — guards against
   *  cross-session release. */
  sessionId: string;
  /**
   * MUST match `reserved_by_user_id` on the row (§19.2 C-1 fix).
   *
   * `null` is accepted ONLY against rows where reserved_by_user_id IS NULL
   * (STOREFRONT guest, EBAY, worker auto-release). A logged-in cashier MUST
   * pass their actor id. The SQL uses `IS NOT DISTINCT FROM` so NULL = NULL.
   *
   * Closes the "stale-cart cross-cashier" exploit: Cashier B can no longer
   * call release/finalize on a reservation that Cashier A made.
   */
  userId: string | null;
  reason: ReleaseReason;
}

export type ReleaseReason =
  | 'storefront_checkout_abandoned'
  | 'storefront_payment_failed'
  /** Customer cancelled their RESERVED pickup order from the shop app (0087). */
  | 'storefront_cancelled_by_customer'
  | 'ebay_offer_rejected'
  | 'pos_cart_cleared'
  | 'admin_manual_release';

/** Input shape for `finalize()` — moves RESERVED → SOLD. */
export interface FinalizeInput {
  productId: string;
  sessionId: string;
  /**
   * MUST match `reserved_by_user_id` on the row (§19.2 C-1 fix).
   *
   * Same semantics as `ReleaseInput.userId` — see that doc-comment.
   * A finalize from a different operator than the one who reserved is
   * the worst form of the bug: the goods transition to SOLD under the
   * wrong cashier_user_id on the transaction row, corrupting the
   * KassenSichV operator-of-record.
   */
  userId: string | null;
}
