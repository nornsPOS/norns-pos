/**
 * discount-math — percentage → EUR and the invoice-discount distribution.
 * It's MONEY: bigint-cents, HALF_EVEN, capped (never > base / never negative),
 * and the distribution is Σ-EXACT (no rounding drift). Lives in cart-math so it
 * reuses the same roundHalfEven; the per-line tax math (computeLineMath) is NOT
 * reimplemented — the discount only feeds it as discountEur.
 */
import { describe, expect, it } from 'vitest';

import { distributeInvoiceDiscount, percentToEur } from './cart-math.js';

const sum = (a: readonly bigint[]): bigint => a.reduce((x, y) => x + y, 0n);

describe('percentToEur', () => {
  it('10% of €10,00 = €1,00; fractional %; HALF_EVEN to the cent', () => {
    expect(percentToEur(1000n, 10)).toBe(100n);
    expect(percentToEur(1000n, 12.5)).toBe(125n);
    expect(percentToEur(333n, 10)).toBe(33n); // 0,333 → 0,33
  });

  it('caps at the base and is never negative', () => {
    expect(percentToEur(1000n, 200)).toBe(1000n); // >100% capped to base
    expect(percentToEur(1000n, 100)).toBe(1000n);
    expect(percentToEur(1000n, 0)).toBe(0n);
    expect(percentToEur(1000n, -5)).toBe(0n);
    expect(percentToEur(0n, 10)).toBe(0n);
  });
});

describe('distributeInvoiceDiscount (Σ-EXACT, capped)', () => {
  it('even split', () => {
    expect(distributeInvoiceDiscount([1000n, 1000n], 200n)).toEqual([100n, 100n]);
  });

  it('rounding remainder → largest-remainder; Σ stays exact', () => {
    const r = distributeInvoiceDiscount([333n, 333n, 334n], 100n);
    expect(sum(r)).toBe(100n);
    expect(r).toEqual([33n, 33n, 34n]);
  });

  it('zero discount → all zero; over-cap → equals total base, Σ exact', () => {
    expect(distributeInvoiceDiscount([1000n, 1000n], 0n)).toEqual([0n, 0n]);
    const cap = distributeInvoiceDiscount([1000n, 1000n], 5000n);
    expect(cap).toEqual([1000n, 1000n]);
    expect(sum(cap)).toBe(2000n);
  });

  it('single line absorbs the whole discount', () => {
    expect(distributeInvoiceDiscount([1000n], 137n)).toEqual([137n]);
  });

  it('no share ever exceeds its own line base; Σ exact', () => {
    const bases = [100n, 900n];
    const r = distributeInvoiceDiscount(bases, 950n);
    r.forEach((s, i) => expect(s <= (bases[i] as bigint)).toBe(true));
    expect(sum(r)).toBe(950n);
  });
});
