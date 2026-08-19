/**
 * product-publish — the pure decision for the "Neues Produkt" dialog.
 *
 * Creation always lands as DRAFT server-side; the dialog optionally publishes
 * (PUT status=AVAILABLE) so the article is sellable at the Kasse right away.
 * This module isolates the *decision* — publish vs. keep-draft — so it can be
 * unit-tested without a component/DOM harness, and so the €0 guard lives in one
 * place: a non-positive list price must NEVER be auto-published (an AVAILABLE
 * article with a 0,00 € price would be sellable for free).
 */

import { normalizeDecimal } from './decimal.js';

/**
 * True only when `listPriceEur` is a strictly-positive amount.
 *
 * No float math on money (memory.md money rule): a normalized dot-decimal is
 * positive iff it contains at least one non-zero digit. "0" / "0,00" / "0.00" /
 * "" → false; "0,01" / "10,20" / "150,00" → true.
 */
export function isPositivePrice(listPriceEur: string): boolean {
  return /[1-9]/.test(normalizeDecimal(listPriceEur));
}

export type PublishDecision =
  /** publish requested AND price > 0 → flip DRAFT → AVAILABLE. */
  | { kind: 'publish' }
  /** publish not requested → leave it as a DRAFT (intake/photo path). */
  | { kind: 'draft' }
  /** publish requested but price ≤ 0 → refuse, keep DRAFT, distinct reason. */
  | { kind: 'draft-no-price' };

/** Decide what to do after a product is created, given the operator's intent. */
export function decidePublish(input: {
  publishNow: boolean;
  listPriceEur: string;
}): PublishDecision {
  if (!input.publishNow) return { kind: 'draft' };
  return isPositivePrice(input.listPriceEur) ? { kind: 'publish' } : { kind: 'draft-no-price' };
}
