import { describe, expect, it } from 'vitest';
import { MoneyError } from './errors.js';
import { Money } from './money.js';

describe('Money — construction', () => {
  it('creates from string', () => {
    expect(Money.of('1999.99').toString()).toBe('1999.99');
  });

  it('creates from bigint (minor units / cents)', () => {
    expect(Money.of(199999n).toString()).toBe('1999.99');
    expect(Money.of(1n).toString()).toBe('0.01');
    expect(Money.of(0n).toString()).toBe('0.00');
  });

  it('creates from number but goes through string for safety', () => {
    expect(Money.of(100).toString()).toBe('100.00');
  });

  it('throws MoneyError on non-numeric input', () => {
    expect(() => Money.of('not-a-number')).toThrow(MoneyError);
    expect(() => Money.of('1.2.3')).toThrow(MoneyError);
  });

  it('throws MoneyError on Infinity / NaN', () => {
    expect(() => Money.of(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => Money.of(Number.NaN)).toThrow(MoneyError);
  });

  it('zero factory produces "0.00"', () => {
    expect(Money.zero().toString()).toBe('0.00');
    expect(Money.zero().isZero()).toBe(true);
  });

  it('parse round-trips with toString', () => {
    const original = Money.of('12345.67');
    const reparsed = Money.parse(original.toString());
    expect(reparsed.equals(original)).toBe(true);
  });

  it('exposes currency', () => {
    expect(Money.of('1').currency).toBe('EUR');
  });
});

describe('Money — precision (the float trap)', () => {
  it('0.1 + 0.2 === 0.30, not 0.30000000000000004', () => {
    const result = Money.of('0.1').add(Money.of('0.2'));
    expect(result.toString()).toBe('0.30');
  });

  it('handles 15+ significant digits without loss', () => {
    const big = Money.of('123456789012345.99');
    expect(big.toString()).toBe('123456789012345.99');
  });

  it('chained operations stay precise', () => {
    // €0.10 added a hundred times must equal €10.00 exactly
    let total = Money.zero();
    for (let i = 0; i < 100; i++) {
      total = total.add(Money.of('0.10'));
    }
    expect(total.toString()).toBe('10.00');
  });

  it('toMinorUnits returns exact bigint', () => {
    expect(Money.of('1999.99').toMinorUnits()).toBe(199999n);
    expect(Money.of('0.01').toMinorUnits()).toBe(1n);
    expect(Money.of('1000000').toMinorUnits()).toBe(100000000n);
    expect(Money.of('-19.99').toMinorUnits()).toBe(-1999n);
  });

  it('always pads to 2 decimals', () => {
    expect(Money.of('1').toString()).toBe('1.00');
    expect(Money.of('1.5').toString()).toBe('1.50');
    expect(Money.of('1.500').toString()).toBe('1.50');
  });
});

describe('Money — arithmetic', () => {
  it('adds same-currency values', () => {
    expect(Money.of('10.50').add(Money.of('5.25')).toString()).toBe('15.75');
  });

  it('subtracts same-currency values', () => {
    expect(Money.of('10.00').subtract(Money.of('3.50')).toString()).toBe('6.50');
  });

  it('multiplies by string scalar (e.g. VAT rate)', () => {
    expect(Money.of('100.00').multiply('0.19').toString()).toBe('19.00');
  });

  it('multiplies by number scalar', () => {
    expect(Money.of('25.00').multiply(4).toString()).toBe('100.00');
  });

  it('divides by scalar', () => {
    expect(Money.of('100.00').divide(4).toString()).toBe('25.00');
  });

  it('throws on division by zero', () => {
    expect(() => Money.of('100').divide(0)).toThrow(MoneyError);
    expect(() => Money.of('100').divide('0.00')).toThrow(MoneyError);
  });
});

describe('Money — Storno (negate): critical for GoBD append-only ledger', () => {
  it('negate flips sign for cancellation entries', () => {
    const sale = Money.of('1999.00');
    const reversal = sale.negate();
    expect(reversal.toString()).toBe('-1999.00');
    expect(sale.add(reversal).isZero()).toBe(true);
  });

  it('double negate is identity', () => {
    const m = Money.of('42.00');
    expect(m.negate().negate().equals(m)).toBe(true);
  });

  it('abs always returns non-negative', () => {
    expect(Money.of('-100').abs().toString()).toBe('100.00');
    expect(Money.of('100').abs().toString()).toBe('100.00');
    expect(Money.zero().abs().toString()).toBe('0.00');
  });
});

describe('Money — predicates', () => {
  it('isZero distinguishes exact zero', () => {
    expect(Money.zero().isZero()).toBe(true);
    expect(Money.of('0.00').isZero()).toBe(true);
    expect(Money.of('0.01').isZero()).toBe(false);
    expect(Money.of('-0.01').isZero()).toBe(false);
  });

  it('isPositive excludes zero (strictly positive)', () => {
    expect(Money.of('0.01').isPositive()).toBe(true);
    expect(Money.zero().isPositive()).toBe(false);
    expect(Money.of('-1').isPositive()).toBe(false);
  });

  it('isNegative excludes zero', () => {
    expect(Money.of('-0.01').isNegative()).toBe(true);
    expect(Money.zero().isNegative()).toBe(false);
    expect(Money.of('0.01').isNegative()).toBe(false);
  });
});

describe('Money — comparisons', () => {
  it('equals returns true for equal amounts regardless of input format', () => {
    expect(Money.of('10.00').equals(Money.of('10'))).toBe(true);
    expect(Money.of('10.00').equals(Money.of(1000n))).toBe(true);
    expect(Money.of('10.00').equals(Money.of('10.01'))).toBe(false);
  });

  it('greaterThan / greaterThanOrEqual', () => {
    expect(Money.of('10').greaterThan(Money.of('5'))).toBe(true);
    expect(Money.of('10').greaterThan(Money.of('10'))).toBe(false);
    expect(Money.of('10').greaterThanOrEqual(Money.of('10'))).toBe(true);
    expect(Money.of('5').greaterThan(Money.of('10'))).toBe(false);
  });

  it('lessThan / lessThanOrEqual', () => {
    expect(Money.of('5').lessThan(Money.of('10'))).toBe(true);
    expect(Money.of('10').lessThan(Money.of('10'))).toBe(false);
    expect(Money.of('10').lessThanOrEqual(Money.of('10'))).toBe(true);
  });
});

describe('Money — immutability', () => {
  it('arithmetic returns new instances, never mutates', () => {
    const a = Money.of('100');
    const b = a.add(Money.of('50'));

    expect(a.toString()).toBe('100.00');
    expect(b.toString()).toBe('150.00');
    expect(a === b).toBe(false);
  });

  it('negate returns a new instance', () => {
    const a = Money.of('100');
    const b = a.negate();

    expect(a.toString()).toBe('100.00');
    expect(b.toString()).toBe('-100.00');
  });
});

describe('Money — formatting (display only)', () => {
  it('formats as German EUR by default', () => {
    const formatted = Money.of('1999.99').format();
    // Exact whitespace varies by Node ICU version: "1.999,99 €" or "1.999,99\u00A0€"
    expect(formatted).toMatch(/1\.999,99.*€/);
  });

  it('formats with different locale', () => {
    const formatted = Money.of('1999.99').format('en-US');
    expect(formatted).toContain('1,999.99');
  });
});

describe('Money — GwG threshold scenario (€2,000 ID-required rule)', () => {
  const GWG_THRESHOLD = Money.of('2000.00');

  it('identifies anonymous-allowed purchases (< €2,000)', () => {
    expect(Money.of('1999.99').lessThan(GWG_THRESHOLD)).toBe(true);
    expect(Money.of('1500').lessThan(GWG_THRESHOLD)).toBe(true);
  });

  it('identifies ID-required purchases (>= €2,000)', () => {
    expect(Money.of('2000.00').greaterThanOrEqual(GWG_THRESHOLD)).toBe(true);
    expect(Money.of('2000.01').greaterThanOrEqual(GWG_THRESHOLD)).toBe(true);
    expect(Money.of('10000').greaterThanOrEqual(GWG_THRESHOLD)).toBe(true);
  });

  it('exact €2,000.00 boundary requires ID (not below)', () => {
    expect(Money.of('2000.00').lessThan(GWG_THRESHOLD)).toBe(false);
    expect(Money.of('1999.99').greaterThanOrEqual(GWG_THRESHOLD)).toBe(false);
  });
});

describe('Money — §25a UStG margin calculation sanity', () => {
  it('computes positive margin (Verkauf > Einkauf)', () => {
    const sellPrice = Money.of('1500.00');
    const buyPrice = Money.of('1000.00');
    const margin = sellPrice.subtract(buyPrice);
    expect(margin.toString()).toBe('500.00');
    expect(margin.isPositive()).toBe(true);
  });

  it('VAT on margin: 19% von 500€ = 79.83€ herausgerechnet', () => {
    // Per §25a, the VAT must be extracted (herausgerechnet) from the margin.
    // For 19% VAT: net = margin / 1.19, vat = margin - net
    const margin = Money.of('500.00');
    const net = margin.divide('1.19');
    const vat = margin.subtract(net);

    // Arithmetic keeps full precision; rounding is explicit via `round()`.
    // See the dedicated "round" describe block for the exact 79.83 assertion.
    expect(Number.parseFloat(vat.toString())).toBeCloseTo(79.83, 2);
  });

  it('zero margin yields zero VAT', () => {
    const margin = Money.zero();
    const net = margin.divide('1.19');
    const vat = margin.subtract(net);
    expect(vat.isZero()).toBe(true);
  });

  it('negative margin (Verlust) — legitimate scenario', () => {
    // §25a allows for losses; the dealer simply pays no VAT on this item.
    // Engineering note: we don't block negative margins; tax module decides.
    const margin = Money.of('-50.00');
    expect(margin.isNegative()).toBe(true);
  });
});

describe('Money — round (banker’s rounding to currency precision)', () => {
  it('rounds VAT-aus-Differenz to exactly 79.83', () => {
    const margin = Money.of('500.00');
    const vat = margin.subtract(margin.divide('1.19')).round();
    expect(vat.toString()).toBe('79.83');
  });

  it('uses HALF_EVEN (banker’s) rounding, not HALF_UP', () => {
    // .005 ties round to the nearest even cent.
    expect(Money.of('1.005').round().toString()).toBe('1.00'); // 0 is even
    expect(Money.of('1.015').round().toString()).toBe('1.02'); // 2 is even
    expect(Money.of('1.025').round().toString()).toBe('1.02'); // 2 is even
  });

  it('rounds negative amounts symmetrically', () => {
    expect(Money.of('-1.015').round().toString()).toBe('-1.02');
  });

  it('is idempotent and leaves already-round values untouched', () => {
    const r = Money.of('12.34').round();
    expect(r.toString()).toBe('12.34');
    expect(r.round().equals(r)).toBe(true);
  });

  it('returns a new instance (immutable)', () => {
    const a = Money.of('1.005');
    expect(a.round() === a).toBe(false);
    expect(a.toString()).toBe('1.00'); // toString already pads/rounds the display
  });
});

describe('Money — allocate (penny-safe distribution)', () => {
  const sumOf = (parts: Money[]) => parts.reduce((acc, m) => acc.add(m), Money.zero());

  it('splits 10.00 three ways with the leftover cent up front', () => {
    const parts = Money.of('10.00').allocate([1, 1, 1]);
    expect(parts.map((m) => m.toString())).toEqual(['3.34', '3.33', '3.33']);
    expect(sumOf(parts).toString()).toBe('10.00');
  });

  it('distributes proportionally to weights', () => {
    const parts = Money.of('100.00').allocate([70, 30]);
    expect(parts.map((m) => m.toString())).toEqual(['70.00', '30.00']);
  });

  it('never loses or invents a cent (0.01 across 3)', () => {
    const parts = Money.of('0.01').allocate([1, 1, 1]);
    expect(parts.map((m) => m.toString())).toEqual(['0.01', '0.00', '0.00']);
    expect(sumOf(parts).toString()).toBe('0.01');
  });

  it('handles weights given as decimal strings (e.g. line totals)', () => {
    const parts = Money.of('9.99').allocate(['3.33', '3.33', '3.33']);
    expect(sumOf(parts).toString()).toBe('9.99');
  });

  it('a single weight receives the whole amount', () => {
    const parts = Money.of('1999.99').allocate([5]);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.toString()).toBe('1999.99');
  });

  it('zero-weight buckets receive nothing', () => {
    const parts = Money.of('10.00').allocate([1, 0, 1]);
    expect(parts.map((m) => m.toString())).toEqual(['5.00', '0.00', '5.00']);
  });

  it('preserves the sum for negative amounts (Storno splits)', () => {
    const parts = Money.of('-10.00').allocate([1, 1, 1]);
    expect(sumOf(parts).toString()).toBe('-10.00');
  });

  it('rounds sub-cent totals to currency precision before splitting', () => {
    // 10.005 rounds (HALF_EVEN) to 10.00, then splits.
    const parts = Money.of('10.005').allocate([1, 1]);
    expect(sumOf(parts).toString()).toBe('10.00');
  });

  it('throws on empty weights', () => {
    expect(() => Money.of('10').allocate([])).toThrow(MoneyError);
  });

  it('throws on negative weights', () => {
    expect(() => Money.of('10').allocate([1, -1])).toThrow(MoneyError);
  });

  it('throws when all weights are zero', () => {
    expect(() => Money.of('10').allocate([0, 0])).toThrow(MoneyError);
  });
});

describe('Money — split (even, penny-safe)', () => {
  const sumOf = (parts: Money[]) => parts.reduce((acc, m) => acc.add(m), Money.zero());

  it('splits evenly and conserves the total', () => {
    const parts = Money.of('10.00').split(3);
    expect(parts.map((m) => m.toString())).toEqual(['3.34', '3.33', '3.33']);
    expect(sumOf(parts).toString()).toBe('10.00');
  });

  it('split(1) returns the whole amount', () => {
    expect(Money.of('42.42').split(1)[0]?.toString()).toBe('42.42');
  });

  it('throws on non-positive or non-integer counts', () => {
    expect(() => Money.of('10').split(0)).toThrow(MoneyError);
    expect(() => Money.of('10').split(-2)).toThrow(MoneyError);
    expect(() => Money.of('10').split(1.5)).toThrow(MoneyError);
  });
});
