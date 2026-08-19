/**
 * Split payment math (Phase C1) — cash + card in ONE sale.
 *
 * The operator types the CASH amount tendered; the remainder is charged to the
 * card. This module is the single, pure, tested source of truth for that split
 * so neither the dialog nor the receipt can drift.
 *
 * Fiscal discipline (memory.md money rules):
 *   • Integer cents ONLY — never parseFloat/Number/toFixed for arithmetic.
 *   • cashCents + cardCents === amountToSplitCents, EXACTLY (no rounding drift).
 *   • A valid split is a PARTIAL cash payment: 0 < cashCents < amountToSplitCents.
 *     Exactly-zero or full cash is a single-method payment, NOT a split — those
 *     are rejected here so the caller falls back to the plain cash path.
 *   • Over-tender (cashCents > amountToSplitCents) is rejected — a card leg can
 *     never be negative, and change-from-card is nonsensical.
 *   • German comma input ("50,00") is accepted; an unparseable string is invalid.
 */

import { centsAusEingabe } from '../../lib/cart-math.js';
import { isMoneyInput } from '../../lib/decimal.js';

export interface SplitPaymentResult {
  /** Cash leg in integer cents (0 when invalid). */
  cashCents: bigint;
  /** Card leg in integer cents — the exact remainder (0 when invalid). */
  cardCents: bigint;
  /**
   * True only for a genuine cash+card split:
   *   0 < cashCents < amountToSplitCents AND cashCents + cardCents === amount.
   */
  valid: boolean;
}

const INVALID: SplitPaymentResult = { cashCents: 0n, cardCents: 0n, valid: false };

/**
 * Compute the card remainder for a cash+card split.
 *
 * @param amountToSplitCents the amount that must be covered (post-voucher due,
 *   or the gross total when no voucher). MUST be > 0.
 * @param cashTendered the operator-entered cash leg, as a money string
 *   (German comma tolerated, e.g. "50,00").
 */
export function computeSplitPayment(
  amountToSplitCents: bigint,
  cashTendered: string,
): SplitPaymentResult {
  if (amountToSplitCents <= 0n) return INVALID;
  if (!isMoneyInput(cashTendered)) return INVALID;

  const cashCents = centsAusEingabe(cashTendered);
  if (cashCents === null) return INVALID;

  // A split requires a STRICTLY partial cash leg. Zero or full → single method.
  if (cashCents <= 0n || cashCents >= amountToSplitCents) return INVALID;

  const cardCents = amountToSplitCents - cashCents;
  // Belt-and-braces: the remainder must reconstruct the amount exactly.
  if (cashCents + cardCents !== amountToSplitCents) return INVALID;

  return { cashCents, cardCents, valid: true };
}
