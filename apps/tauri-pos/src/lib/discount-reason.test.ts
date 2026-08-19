import { describe, expect, it } from 'vitest';

import {
  MIN_DISCOUNT_REASON_LEN,
  discountReasonShortfall,
  isDiscountReasonValid,
} from './discount-reason.js';

describe('discount reason validity (mirrors the backend/DB rule: ≥3 trimmed chars)', () => {
  it('rejects empty / whitespace-only', () => {
    expect(isDiscountReasonValid('')).toBe(false);
    expect(isDiscountReasonValid('   ')).toBe(false);
  });

  it('rejects fewer than the minimum (trimmed)', () => {
    expect(isDiscountReasonValid('ab')).toBe(false);
    expect(isDiscountReasonValid(' a ')).toBe(false); // trims to 1
  });

  it('accepts exactly the minimum (3 trimmed chars)', () => {
    expect(isDiscountReasonValid('abc')).toBe(true);
    expect(isDiscountReasonValid('  abc  ')).toBe(true);
  });

  it('accepts longer reasons', () => {
    expect(isDiscountReasonValid('Stammkunde')).toBe(true);
  });

  it('shortfall counts the characters still needed (0 once valid)', () => {
    expect(discountReasonShortfall('')).toBe(3);
    expect(discountReasonShortfall('a')).toBe(2);
    expect(discountReasonShortfall(' ab ')).toBe(1);
    expect(discountReasonShortfall('abc')).toBe(0);
    expect(discountReasonShortfall('abcd')).toBe(0);
  });

  it('exposes the minimum as a constant (3)', () => {
    expect(MIN_DISCOUNT_REASON_LEN).toBe(3);
  });
});
