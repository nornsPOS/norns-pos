import { describe, expect, it } from 'vitest';
import { fromCents, roundHalfEven, toCents } from './money-core.js';

// ─────────────────────────────────────────────────────────────────────────
// money-core — the single canonical home for the bigint-cents primitives that
// were previously copy-pasted into cart-math / intake-math / bewertung-math.
//
// These tests PIN the exact pre-consolidation behaviour so the extraction is
// provably behaviour-identical. Every assertion below held for at least one of
// the three original verbatim copies.
// ─────────────────────────────────────────────────────────────────────────

describe('roundHalfEven', () => {
  it('rounds below the halfway point down (toward zero of the quotient)', () => {
    // 10/4 = 2.5 is a tie; 9/4 = 2.25 → 2
    expect(roundHalfEven(9n, 4n)).toBe(2n);
    // 11/4 = 2.75 → 3
    expect(roundHalfEven(11n, 4n)).toBe(3n);
  });

  it('rounds exact ties to the EVEN neighbour (banker’s rounding)', () => {
    // 2.5 → 2 (down to even)
    expect(roundHalfEven(5n, 2n)).toBe(2n);
    // 3.5 → 4 (up to even)
    expect(roundHalfEven(7n, 2n)).toBe(4n);
    // 0.5 → 0 (even)
    expect(roundHalfEven(1n, 2n)).toBe(0n);
    // 1.5 → 2 (even)
    expect(roundHalfEven(3n, 2n)).toBe(2n);
    // 4.5 → 4 (down to even)
    expect(roundHalfEven(9n, 2n)).toBe(4n);
    // 5.5 → 6 (up to even)
    expect(roundHalfEven(11n, 2n)).toBe(6n);
  });

  it('handles the canonical VAT extraction ratio (×19/119) exactly', () => {
    // 100.00 EUR gross = 10000 cents → vat = 10000*19/119 = 1596.638… → 1597
    expect(roundHalfEven(10000n * 19n, 119n)).toBe(1597n);
    // 119.00 EUR gross = 11900 cents → vat = exactly 1900
    expect(roundHalfEven(11900n * 19n, 119n)).toBe(1900n);
  });

  it('is sign-symmetric: round(-n,d) === -round(n,d) on ties and non-ties', () => {
    expect(roundHalfEven(-5n, 2n)).toBe(-2n); // -2.5 → -2 (even)
    expect(roundHalfEven(-7n, 2n)).toBe(-4n); // -3.5 → -4 (even)
    expect(roundHalfEven(-11n, 4n)).toBe(-3n); // -2.75 → -3
    // negative denominator behaves like a flipped sign
    expect(roundHalfEven(5n, -2n)).toBe(-2n);
    expect(roundHalfEven(-5n, -2n)).toBe(2n);
  });

  it('returns 0 for a zero numerator', () => {
    expect(roundHalfEven(0n, 7n)).toBe(0n);
  });

  it('throws on division by zero', () => {
    expect(() => roundHalfEven(1n, 0n)).toThrow(/division by zero/);
  });

  it('stays exact on very large bigint operands', () => {
    // 1e30 / 3 — far beyond Number precision; tie-free, just truncates.
    const num = 10n ** 30n;
    expect(roundHalfEven(num, 3n)).toBe(num / 3n); // exact floor (remainder < half)
    // construct an exact .5 tie at huge scale: (2k+1)/2 → even
    expect(roundHalfEven(2n * 10n ** 20n + 1n, 2n)).toBe(10n ** 20n); // x.5 down to even
    expect(roundHalfEven(2n * 10n ** 20n + 3n, 2n)).toBe(10n ** 20n + 2n); // up to even
  });
});

describe('toCents', () => {
  it('parses a plain dot-decimal to bigint cents', () => {
    expect(toCents('10.20')).toBe(1020n);
    expect(toCents('0.01')).toBe(1n);
    expect(toCents('0')).toBe(0n);
    expect(toCents('100')).toBe(10000n);
  });

  it('tolerates the German decimal comma', () => {
    // cart-math’s canonical behaviour: "50,00" is a valid money string.
    expect(toCents('50,00')).toBe(5000n);
    expect(toCents('10,2')).toBe(1020n);
    expect(toCents('0,01')).toBe(1n);
  });

  it('truncates extra fraction digits to two places (no rounding here)', () => {
    expect(toCents('1.239')).toBe(123n);
    expect(toCents('1.2')).toBe(120n);
  });

  it('handles negative amounts', () => {
    expect(toCents('-5.50')).toBe(-550n);
    expect(toCents('-0.01')).toBe(-1n);
  });

  it('parses very large amounts without precision loss', () => {
    expect(toCents('99999999999.99')).toBe(9999999999999n);
  });

  it('throws on a non-decimal string', () => {
    expect(() => toCents('abc')).toThrow(/invalid decimal/);
    expect(() => toCents('1.2.3')).toThrow(/invalid decimal/);
    expect(() => toCents('')).toThrow(/invalid decimal/);
  });
});

describe('fromCents', () => {
  it('formats positive cents as a dot-decimal with two fraction digits', () => {
    expect(fromCents(1020n)).toBe('10.20');
    expect(fromCents(1n)).toBe('0.01');
    expect(fromCents(0n)).toBe('0.00');
    expect(fromCents(10000n)).toBe('100.00');
  });

  it('formats negative cents with a leading minus', () => {
    expect(fromCents(-550n)).toBe('-5.50');
    expect(fromCents(-1n)).toBe('-0.01');
  });

  it('formats very large cents without precision loss', () => {
    expect(fromCents(9999999999999n)).toBe('99999999999.99');
  });

  it('round-trips with toCents for canonical money strings', () => {
    for (const s of ['0.00', '0.01', '10.20', '100.00', '-5.50', '99999999999.99']) {
      expect(fromCents(toCents(s))).toBe(s);
    }
  });
});
