import Decimal from 'decimal.js';
import { MoneyError } from './errors.js';
import type { Currency, MoneyInput } from './types.js';

// ─── Global Decimal.js configuration ────────────────────────────────
//
// HALF_EVEN (banker's rounding) is the conventional choice for German
// tax and accounting software: it avoids the systematic upward bias
// of HALF_UP over large samples, which matters for VAT calculations.
//
// Precision 30 leaves ample headroom for intermediate calculations
// (e.g. percentage VAT applied to large totals) before final rounding.
//
// `toExpNeg/Pos` keep numbers in fixed-point string form across the
// full range Warehouse14 realistically handles (sub-cent up to billions).
Decimal.set({
  precision: 30,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -30,
  toExpPos: 30,
});

const CURRENCY_DECIMALS: Record<Currency, number> = {
  EUR: 2,
};

/**
 * Convert a `MoneyInput` to a Decimal.
 * - `bigint` is stringified (decimal.js does not accept bigint directly).
 * - `number` is stringified to dodge JS float artifacts at the boundary
 *   (callers should still prefer string inputs for clarity).
 * - `string` is passed through.
 */
function toDecimal(input: MoneyInput): Decimal {
  if (typeof input === 'string') return new Decimal(input);
  return new Decimal(input.toString());
}

/**
 * Immutable monetary value.
 *
 * Why this exists:
 * - JS `number` cannot represent `0.1 + 0.2` exactly. Money does.
 * - Currency is tracked in the type — `eur.add(usd)` is a compile-time concept and
 *   a runtime guard.
 * - Storno (reversal) requires `negate()`. We give it a name.
 * - Banker's rounding (HALF_EVEN) is the German tax norm.
 *
 * Database mapping:
 * - Store as `numeric(18, 2)` in PostgreSQL.
 * - Write via `.toString()` (e.g. `'1999.99'`).
 * - Read via `Money.parse(row.amount_cents_or_whatever)`.
 *
 * Always immutable: every operation returns a new instance.
 */
export class Money {
  readonly #amount: Decimal;
  readonly #currency: Currency;

  private constructor(amount: Decimal, currency: Currency) {
    this.#amount = amount;
    this.#currency = currency;
  }

  // ─── Factories ────────────────────────────────────────────────────

  /**
   * Construct from string (preferred), number, or bigint (minor units).
   *
   * @example
   * Money.of('1999.99');          // €1999.99
   * Money.of(199999n);            // €1999.99 (from minor units / cents)
   * Money.of('0.01');             // €0.01
   */
  static of(input: MoneyInput, currency: Currency = 'EUR'): Money {
    if (typeof input === 'bigint') {
      const decimals = CURRENCY_DECIMALS[currency];
      const divisor = new Decimal(10).pow(decimals);
      return new Money(new Decimal(input.toString()).dividedBy(divisor), currency);
    }
    try {
      const decimal = toDecimal(input);
      if (!decimal.isFinite()) {
        throw new MoneyError(`Invalid money input: ${String(input)}`);
      }
      return new Money(decimal, currency);
    } catch (err) {
      if (err instanceof MoneyError) throw err;
      throw new MoneyError(`Invalid money input: ${String(input)}`);
    }
  }

  /** Zero value of the given currency. */
  static zero(currency: Currency = 'EUR'): Money {
    return new Money(new Decimal(0), currency);
  }

  /** Parse a serialized string (typically from DB). Always exact, never lossy. */
  static parse(serialized: string, currency: Currency = 'EUR'): Money {
    return Money.of(serialized, currency);
  }

  // ─── Accessors ────────────────────────────────────────────────────

  get currency(): Currency {
    return this.#currency;
  }

  /**
   * String representation with exactly N decimals — safe for DB writes.
   *
   * @example Money.of('1999.9').toString()   // '1999.90'
   */
  toString(): string {
    return this.#amount.toFixed(CURRENCY_DECIMALS[this.#currency]);
  }

  /**
   * Minor units as bigint (cents for EUR).
   *
   * Useful for:
   * - TSE signature payloads that demand integers
   * - DB rows that store amounts as `bigint cents`
   *
   * @example Money.of('1999.99').toMinorUnits()  // 199999n
   */
  toMinorUnits(): bigint {
    const decimals = CURRENCY_DECIMALS[this.#currency];
    const multiplier = new Decimal(10).pow(decimals);
    return BigInt(this.#amount.times(multiplier).toFixed(0));
  }

  /**
   * Locale-aware, human-friendly display. **Never** use for storage.
   *
   * @example Money.of('1999.99').format()  // '1.999,99 €'  (de-DE)
   */
  format(locale = 'de-DE'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.#currency,
    }).format(this.#amount.toNumber());
  }

  // ─── Predicates ───────────────────────────────────────────────────

  isZero(): boolean {
    return this.#amount.isZero();
  }

  /** True for strictly positive amounts; zero is neither positive nor negative. */
  isPositive(): boolean {
    return this.#amount.isPositive() && !this.#amount.isZero();
  }

  isNegative(): boolean {
    return this.#amount.isNegative();
  }

  // ─── Comparisons (currency-checked) ───────────────────────────────

  equals(other: Money): boolean {
    return this.#sameCurrency(other) && this.#amount.equals(other.#amount);
  }

  greaterThan(other: Money): boolean {
    this.#assertSameCurrency(other);
    return this.#amount.greaterThan(other.#amount);
  }

  greaterThanOrEqual(other: Money): boolean {
    this.#assertSameCurrency(other);
    return this.#amount.greaterThanOrEqualTo(other.#amount);
  }

  lessThan(other: Money): boolean {
    this.#assertSameCurrency(other);
    return this.#amount.lessThan(other.#amount);
  }

  lessThanOrEqual(other: Money): boolean {
    this.#assertSameCurrency(other);
    return this.#amount.lessThanOrEqualTo(other.#amount);
  }

  // ─── Arithmetic (immutable) ───────────────────────────────────────

  add(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#amount.plus(other.#amount), this.#currency);
  }

  subtract(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#amount.minus(other.#amount), this.#currency);
  }

  /**
   * Multiply by a scalar (e.g. VAT rate `0.19`, quantity `3`).
   * Note: multiplying by another Money makes no economic sense — we accept only scalars.
   */
  multiply(factor: MoneyInput): Money {
    return new Money(this.#amount.times(toDecimal(factor)), this.#currency);
  }

  /** Divide by a scalar. Throws on division by zero. */
  divide(divisor: MoneyInput): Money {
    const d = toDecimal(divisor);
    if (d.isZero()) throw new MoneyError('Division by zero');
    return new Money(this.#amount.dividedBy(d), this.#currency);
  }

  /**
   * Flip the sign. **Essential** for Storno entries (GoBD: never delete, always offset).
   *
   * @example
   *   const sale = Money.of('1999.00');
   *   const reversal = sale.negate();        // -1999.00
   *   sale.add(reversal).isZero();           // true — books balance
   */
  negate(): Money {
    return new Money(this.#amount.negated(), this.#currency);
  }

  /** Absolute value. */
  abs(): Money {
    return new Money(this.#amount.abs(), this.#currency);
  }

  // ─── Rounding & allocation ────────────────────────────────────────

  /**
   * Round to the currency's natural precision (2 dp for EUR) using
   * banker's rounding (HALF_EVEN) — the German tax/accounting norm.
   *
   * Arithmetic deliberately keeps full precision; call `round()` at the exact
   * moment a value becomes a *bookable* amount: an invoice line, a VAT figure,
   * a ledger row. Centralising rounding here prevents the inconsistent,
   * scattered rounding that corrupts fiscal totals.
   *
   * @example Money.of('79.831932').round().toString()  // '79.83'
   */
  round(): Money {
    const decimals = CURRENCY_DECIMALS[this.#currency];
    return new Money(this.#amount.toDecimalPlaces(decimals), this.#currency);
  }

  /**
   * Split this amount across buckets weighted by `weights`, with **no lost or
   * invented sub-units**: the parts always sum back to `this.round()` exactly.
   *
   * Works in integer minor units with the largest-remainder method; leftover
   * cents go to the largest fractional remainders first (deterministic ties by
   * index). Essential for invoices (distributing a rounded total across lines)
   * and §25a margin splits, where €0.01 drift is a compliance defect.
   *
   * Weights may be any non-negative `MoneyInput` (e.g. line totals as strings).
   *
   * @example
   *   Money.of('10.00').allocate([1, 1, 1]).map((m) => m.toString());
   *   // ['3.34', '3.33', '3.33']  — sums to 10.00
   */
  allocate(weights: ReadonlyArray<MoneyInput>): Money[] {
    if (weights.length === 0) {
      throw new MoneyError('allocate requires at least one weight');
    }
    const w = weights.map((x) => toDecimal(x));
    if (w.some((d) => !d.isFinite() || d.isNegative())) {
      throw new MoneyError('allocate weights must be finite and non-negative');
    }
    const totalW = w.reduce((acc, d) => acc.plus(d), new Decimal(0));
    if (totalW.lessThanOrEqualTo(0)) {
      throw new MoneyError('allocate weights must sum to a positive value');
    }

    const decimals = CURRENCY_DECIMALS[this.#currency];
    const scale = new Decimal(10).pow(decimals);
    // Total expressed as integer minor units, rounded to currency precision.
    const totalMinor = this.#amount.times(scale).toDecimalPlaces(0);

    const parts = w.map((d) => {
      const share = totalMinor.times(d).dividedBy(totalW);
      const floor = share.floor();
      return { floor, frac: share.minus(floor) };
    });

    const allocated = parts.reduce((acc, p) => acc.plus(p.floor), new Decimal(0));
    const remainder = totalMinor.minus(allocated).toNumber(); // integer in [0, count)

    // Hand the leftover minor units to the largest fractional remainders.
    const winners = new Set(
      parts
        .map((p, i) => ({ i, frac: p.frac }))
        .sort((a, b) => {
          const cmp = b.frac.comparedTo(a.frac);
          return cmp !== 0 ? cmp : a.i - b.i;
        })
        .slice(0, remainder)
        .map((entry) => entry.i),
    );

    return parts.map((p, i) => {
      const minor = winners.has(i) ? p.floor.plus(1) : p.floor;
      return new Money(minor.dividedBy(scale), this.#currency);
    });
  }

  /**
   * Even split into `n` parts, penny-safe. Convenience wrapper over `allocate`.
   *
   * @example Money.of('10.00').split(3).map((m) => m.toString());  // 3.34, 3.33, 3.33
   */
  split(n: number): Money[] {
    if (!Number.isInteger(n) || n <= 0) {
      throw new MoneyError('split count must be a positive integer');
    }
    return this.allocate(new Array<number>(n).fill(1));
  }

  // ─── Private guards ───────────────────────────────────────────────

  #sameCurrency(other: Money): boolean {
    return this.#currency === other.#currency;
  }

  #assertSameCurrency(other: Money): void {
    if (!this.#sameCurrency(other)) {
      throw new MoneyError(`Currency mismatch: ${this.#currency} vs ${other.#currency}`);
    }
  }
}
