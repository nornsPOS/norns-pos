import { describe, expect, it } from 'vitest';

import { fromCents, toCents } from '../../src/lib/money-cents.js';

describe('fromCents — the negative-drawer bug (was "-1.-50")', () => {
  it('formats negative cents with the sign on the whole value', () => {
    expect(fromCents(-150n)).toBe('-1.50');
    expect(fromCents(-5n)).toBe('-0.05');
    expect(fromCents(-100n)).toBe('-1.00');
    expect(fromCents(-1234_56n)).toBe('-1234.56');
  });
  it('positive + zero unchanged', () => {
    expect(fromCents(150n)).toBe('1.50');
    expect(fromCents(5n)).toBe('0.05');
    expect(fromCents(0n)).toBe('0.00');
  });
});

describe('toCents', () => {
  it('parses negatives, nulls, bare ints', () => {
    expect(toCents('-1.50')).toBe(-150n);
    expect(toCents('-0.05')).toBe(-5n);
    expect(toCents(null)).toBe(0n);
    expect(toCents('42')).toBe(4200n);
  });
});

describe('round-trip', () => {
  it('fromCents∘toCents is identity for canonical strings', () => {
    for (const s of ['0.00', '1.50', '-1.50', '-0.05', '1234.56', '-1234.56']) {
      expect(fromCents(toCents(s))).toBe(s);
    }
  });
});
