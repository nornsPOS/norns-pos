/**
 * split-payment — Phase C1 cash+card split math.
 *
 * It's MONEY: integer-cent only, Σ-EXACT (cash + card === amount, no drift),
 * partial-cash-only (zero/full is single-method, not a split), over-tender
 * rejected, German-comma input tolerated, garbage rejected.
 */
import { describe, expect, it } from 'vitest';

import { computeSplitPayment } from './split-payment.js';

describe('computeSplitPayment', () => {
  it('exact split: €100,00 total, €60,00 cash → €40,00 card', () => {
    const r = computeSplitPayment(10000n, '60.00');
    expect(r.valid).toBe(true);
    expect(r.cashCents).toBe(6000n);
    expect(r.cardCents).toBe(4000n);
    expect(r.cashCents + r.cardCents).toBe(10000n);
  });

  it('odd-cent split sums EXACTLY (no rounding drift): €99,99, €33,33 cash', () => {
    const r = computeSplitPayment(9999n, '33.33');
    expect(r.valid).toBe(true);
    expect(r.cashCents).toBe(3333n);
    expect(r.cardCents).toBe(6666n);
    expect(r.cashCents + r.cardCents).toBe(9999n);
  });

  it('German comma input "50,00" is parsed', () => {
    const r = computeSplitPayment(10000n, '50,00');
    expect(r.valid).toBe(true);
    expect(r.cashCents).toBe(5000n);
    expect(r.cardCents).toBe(5000n);
  });

  it('over-tender rejected: cash €120,00 on a €100,00 total', () => {
    const r = computeSplitPayment(10000n, '120.00');
    expect(r.valid).toBe(false);
    expect(r.cashCents).toBe(0n);
    expect(r.cardCents).toBe(0n);
  });

  it('full cash rejected (single method, not a split): €100,00 cash on €100,00', () => {
    expect(computeSplitPayment(10000n, '100.00').valid).toBe(false);
  });

  it('zero cash rejected (single method, not a split): €0,00 on €100,00', () => {
    expect(computeSplitPayment(10000n, '0.00').valid).toBe(false);
    expect(computeSplitPayment(10000n, '0').valid).toBe(false);
  });

  it('empty / garbage cash string rejected', () => {
    expect(computeSplitPayment(10000n, '').valid).toBe(false);
    expect(computeSplitPayment(10000n, 'abc').valid).toBe(false);
    expect(computeSplitPayment(10000n, '12,3,4').valid).toBe(false);
  });

  it('amount ≤ 0 rejected (nothing to split)', () => {
    expect(computeSplitPayment(0n, '5.00').valid).toBe(false);
    expect(computeSplitPayment(-100n, '5.00').valid).toBe(false);
  });

  it('one-cent split: €0,02 total, €0,01 cash → €0,01 card', () => {
    const r = computeSplitPayment(2n, '0.01');
    expect(r.valid).toBe(true);
    expect(r.cashCents).toBe(1n);
    expect(r.cardCents).toBe(1n);
  });
});
