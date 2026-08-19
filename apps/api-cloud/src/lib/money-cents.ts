/**
 * money-cents — sign-correct integer-cent ⇄ decimal-string conversion for the
 * fiscal + drawer money paths.
 *
 * BigInt division and modulo KEEP the sign on BOTH operands, so the naive
 * `` `${c / 100n}.${c % 100n}` `` formatting yields `"-1.-50"` for −150 cents and
 * `"0.-5"` for −5. A negative expected drawer is the NORMAL case for an
 * Ankauf-heavy gold-buying shift (cash paid out for gold exceeds cash sales +
 * float), so that malformed string landed straight in `shifts.system_expected_eur`
 * and corrupted the Kassensturz variance. Every cents⇆string conversion in the
 * money paths goes through here.
 */

/** Decimal string ("1234.5", "-0.05", null) → integer cents. Tolerates a sign. */
export function toCents(x: string | null | undefined): bigint {
  const v = (x ?? '0').trim() || '0';
  const neg = v.startsWith('-');
  const [whole, frac = '00'] = v.replace('-', '').split('.') as [string, string?];
  const c = BigInt(whole || '0') * 100n + BigInt((frac ?? '00').padEnd(2, '0').slice(0, 2));
  return neg ? -c : c;
}

/** Integer cents → canonical two-decimal string, sign on the WHOLE value. */
export function fromCents(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}
