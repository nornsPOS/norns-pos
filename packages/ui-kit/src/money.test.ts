/**
 * centsToEur — proves the integer-cents → decimal-string conversion is EXACT
 * (no float / toFixed drift) across representative magnitudes, including a
 * bigint past Number.MAX_SAFE_INTEGER.
 */
import { describe, expect, it } from 'vitest';

import { centsToEur } from './money.js';

describe('centsToEur', () => {
  it('formats representative cents with exactly two fractional digits', () => {
    expect(centsToEur(0)).toBe('0.00');
    expect(centsToEur(5)).toBe('0.05');
    expect(centsToEur(99)).toBe('0.99');
    expect(centsToEur(100)).toBe('1.00');
    expect(centsToEur(123456)).toBe('1234.56');
  });

  it('handles negatives with a leading minus', () => {
    expect(centsToEur(-5)).toBe('-0.05');
    expect(centsToEur(-123456)).toBe('-1234.56');
  });

  it('is exact for a bigint past Number.MAX_SAFE_INTEGER (no float drift)', () => {
    // 9_007_199_254_740_993 cents = 1 past the float-safe integer ceiling.
    expect(centsToEur(9_007_199_254_740_993n)).toBe('90071992547409.93');
  });

  it('rejects non-integer numbers (money must never arrive as a float)', () => {
    expect(() => centsToEur(12.5)).toThrow();
  });
});
