/**
 * discount-reason — the per-line Rabatt reason validity rule, extracted from the
 * DiscountEditor so it is unit-testable and stays in lock-step with the live
 * inline feedback (counter / "noch N Zeichen" hint).
 *
 * This mirrors the server + DB requirement (a non-empty, meaningful reason); the
 * client check is a UX gate only — the backend re-enforces on apply/finalize.
 * NO money-math here — purely the reason string.
 */

/** Minimum trimmed length for a valid discount reason. */
export const MIN_DISCOUNT_REASON_LEN = 3;

/** True when the reason meets the minimum trimmed length. */
export function isDiscountReasonValid(reason: string): boolean {
  return reason.trim().length >= MIN_DISCOUNT_REASON_LEN;
}

/** Characters still required before the reason becomes valid (0 once valid). */
export function discountReasonShortfall(reason: string): number {
  return Math.max(0, MIN_DISCOUNT_REASON_LEN - reason.trim().length);
}
