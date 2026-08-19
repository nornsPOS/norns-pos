/**
 * Runtime validation at the trust boundary.
 *
 * `request<T>()` casts raw JSON straight to `T` (`return res.data as T`) with ZERO
 * checking — so every money/fiscal field in the control-desktop + storefront is a
 * compile-time fiction. A malformed payload (a non-integer cents, a missing
 * field) flows untouched into render, where `centsToEur` on a non-integer throws
 * and blanks the screen.
 *
 * Parse the raw payload through a TypeBox schema HERE: on success the result is
 * the real, validated type; on failure we LOG at the seam and return `null` so
 * the caller degrades gracefully (shows an error, retries) and NEVER forwards
 * malformed data. Mirrors the discipline `parseLedgerEvent` already proves.
 */

import { type Static, type TSchema, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/** Integer cents — the canonical money representation on the wire (no float, no string). */
export const Cents = Type.Integer();

/** Decimal-string money with exactly two fraction digits: "1234.50", "-0.05". */
export const DecimalMoney = Type.String({ pattern: '^-?\\d+\\.\\d{2}$' });

/**
 * Validate `raw` against `schema`. Returns the typed value, or `null` (after
 * logging the first error with its JSON path) when it does not match. Never
 * throws — a bad payload must degrade, not crash render.
 */
export function parseResponse<S extends TSchema>(
  schema: S,
  raw: unknown,
  label: string,
): Static<S> | null {
  if (Value.Check(schema, raw)) return raw as Static<S>;
  const first = [...Value.Errors(schema, raw)][0];
  // eslint-disable-next-line no-console -- boundary diagnostics, intentionally loud
  console.error(
    `api-client: response for "${label}" failed validation`,
    first ? `${String(first.path)}: ${first.message}` : '(shape mismatch)',
  );
  return null;
}
