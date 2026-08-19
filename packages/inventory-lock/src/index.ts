/**
 * @norns/inventory-lock
 *
 * The single discipline boundary for `products.status` mutations.
 *
 * Atomic reservation per ADR-0016 §2. Postgres row-level locking guarantees
 * exactly-one-winner. No Redlock. No 2PC. No optimistic version columns.
 *
 * Surface:
 *   reserve()              AVAILABLE → RESERVED (race-safe)
 *   release()              RESERVED  → AVAILABLE (session-id-guarded)
 *   finalize()             RESERVED  → SOLD (session-id-guarded)
 *   autoReleaseExpired()   sweeps expired STOREFRONT/EBAY reservations
 *   autoReleaseStalePos()  reclaims abandoned TTL-less POS holds (P1.4 backstop)
 *
 * CI must lint for direct UPDATEs on products.status outside this package
 * (Phase 1.5 task). Until then, code review is the gate.
 */

export { reserve } from './reserve.js';
export { release } from './release.js';
export { finalize, finalizeViele } from './finalize.js';
export { autoReleaseExpired } from './autoReleaseExpired.js';
export {
  autoReleaseStalePos,
  type AutoReleaseStalePosOptions,
} from './autoReleaseStalePos.js';

export {
  InventoryLockError,
  ReservationOwnershipError,
  InvalidStateForFinalize,
} from './errors.js';

export type {
  Channel,
  Reservation,
  ReserveInput,
  ReserveResult,
  ReleaseInput,
  ReleaseReason,
  FinalizeInput,
} from './types.js';
