/**
 * Currencies supported by Warehouse14.
 *
 * Phase 0: EUR only.
 * Future phases may add CHF, USD — but every operation MUST remain currency-typed
 * to prevent silent cross-currency arithmetic bugs.
 */
export type Currency = 'EUR';

/**
 * Accepted input formats for constructing Money.
 *
 * - `string`: preferred for safety, e.g. `'1999.99'`. No precision loss.
 * - `number`: tolerated but discouraged — JS floats lose precision beyond ~15 digits.
 *   Internally converted via `.toString()` so usually fine, but prefer string in code.
 * - `bigint`: minor units (cents), e.g. `199999n` for €1999.99.
 *   Useful for DB rows that already store integers, and for TSE signature hashing.
 */
export type MoneyInput = string | number | bigint;
