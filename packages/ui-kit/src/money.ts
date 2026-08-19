/**
 * money — exact integer-cents → decimal-string conversion for display.
 *
 * Money is NEVER floated. `centsToEur` turns integer cents (the wire shape the
 * API sends, e.g. `123456`) into the dot-decimal STRING that `<MoneyAmount
 * valueEur>` consumes (`"1234.56"`), which then renders the German
 * `1.234,56 €`. The split is done on bigint, so there is no `cents / 100`
 * float step and no `toFixed` rounding drift — `centsToEur(123456) === "1234.56"`
 * for every magnitude, including values past `Number.MAX_SAFE_INTEGER` when a
 * bigint is passed.
 *
 * Mirrors `fromCents` in apps/tauri-pos/src/lib/money-core.ts (same contract),
 * kept here so the control-desktop / ui-kit consumers don't reach across apps.
 */

/**
 * Integer cents → dot-decimal EUR string (`123456` → `"1234.56"`).
 *
 * Accepts a `number` (must be a safe integer) or a `bigint`. The result always
 * carries exactly two fractional digits and a leading `-` for negatives.
 */
export function centsToEur(cents: number | bigint): string {
  let value: bigint;
  if (typeof cents === 'bigint') {
    value = cents;
  } else {
    if (!Number.isInteger(cents)) {
      throw new Error(`centsToEur: expected integer cents, got ${cents}`);
    }
    value = BigInt(cents);
  }

  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}
