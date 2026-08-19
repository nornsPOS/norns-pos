/**
 * Typed errors for inventory-lock operations.
 *
 * Each error class carries the minimum context the caller needs to decide
 * what to surface. No stack traces are stripped — the caller's logger
 * decides log levels.
 */

export class InventoryLockError extends Error {
  override readonly name = 'InventoryLockError';
}

/**
 * `release()` or `finalize()` was called with a session_id that does not
 * match the row's `reserved_by_session_id`. Either the row is not reserved,
 * or another channel won. The caller should re-fetch state.
 */
export class ReservationOwnershipError extends InventoryLockError {
  constructor(productId: string) {
    super(
      `inventory-lock: ownership mismatch for product ${productId} — ` +
        `the reservation does not belong to the supplied session.`,
    );
  }
}

/**
 * `finalize()` requires the product to be in 'RESERVED' state. If it is
 * already SOLD (or never was reserved), this fires.
 */
export class InvalidStateForFinalize extends InventoryLockError {
  constructor(productId: string, currentStatus: string) {
    super(
      `inventory-lock: cannot finalize product ${productId} — current status is ${currentStatus}, ` +
        `expected RESERVED.`,
    );
  }
}
