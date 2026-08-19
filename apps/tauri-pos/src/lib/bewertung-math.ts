/**
 * bewertung-math — Schmelzwert hint + integer-cents totals.
 *
 * Live "Schmelzwert" hint per item:
 *
 *   schmelzwert_eur = weight_grams × fineness_decimal × price_per_gram_eur
 *
 * Everything lifted into integer space (4-decimal scaling) so we stay
 * bigint-only — no Number arithmetic in the price path. Matches the
 * server-side discipline of memory.md #41 (HALF_EVEN rounding) and
 * #69 (metal-prices engine).
 *
 * Returns null when any required input is missing — the UI degrades
 * gracefully and just omits the hint.
 */

// The bigint-cents primitives live in one canonical module (money-core).
// bewertung-math re-exports toCents / fromCents so its public API is unchanged.
import { fromCents, roundHalfEven, toCents } from './money-core.js';

export { fromCents, toCents };

function parseScaled(s: string, decimals: number): bigint {
  // Tolerate the German comma decimal the operator types ("7,965"). A lone dot
  // stays the decimal point (weight/fineness/price-per-gram are small, never
  // thousands); when a comma is present, dots are thousands ("1.234,5"→"1234.5").
  const t = s.trim();
  const v = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`invalid decimal "${s}"`);
  const [whole = '0', frac = ''] = v.split('.');
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || '0');
}

export interface SchmelzwertInput {
  metal: 'gold' | 'silver' | 'platinum' | 'palladium' | null | undefined;
  weightGrams: string | null | undefined;
  finenessDecimal: string | null | undefined;
  pricePerGramEur: string | null | undefined;
}

/**
 * Compute the per-item Schmelzwert hint. Returns null when any input is
 * missing or malformed (UI shows no hint). All-integer math:
 *
 *   weight_scaled  = weight  × 10_000          (4-decimal scale)
 *   fineness_scaled= fineness × 10_000
 *   price_scaled   = price   × 10_000
 *   result_in_cents = round_half_even(
 *     weight_scaled × fineness_scaled × price_scaled / (10_000^3 / 100)
 *   )
 *
 * The denominator `1e12 / 100 = 1e10` lands the result in cents.
 */
export function computeSchmelzwertEur(input: SchmelzwertInput): string | null {
  if (
    input.metal === null ||
    input.metal === undefined ||
    input.weightGrams === null ||
    input.weightGrams === undefined ||
    input.weightGrams.length === 0 ||
    input.finenessDecimal === null ||
    input.finenessDecimal === undefined ||
    input.finenessDecimal.length === 0 ||
    input.pricePerGramEur === null ||
    input.pricePerGramEur === undefined ||
    input.pricePerGramEur.length === 0
  ) {
    return null;
  }
  let weightScaled: bigint;
  let finenessScaled: bigint;
  let priceScaled: bigint;
  try {
    weightScaled = parseScaled(input.weightGrams, 4);
    finenessScaled = parseScaled(input.finenessDecimal, 4);
    priceScaled = parseScaled(input.pricePerGramEur, 4);
  } catch {
    return null;
  }
  const numerator = weightScaled * finenessScaled * priceScaled;
  const denominator = 10_000n * 10_000n * 100n;
  const cents = roundHalfEven(numerator, denominator);
  return fromCents(cents);
}

/** Sum of negotiated/offered values, bigint-cents safe. */
export function sumItemCents(values: readonly string[]): bigint {
  let total = 0n;
  for (const v of values) total += toCents(v);
  return total;
}
