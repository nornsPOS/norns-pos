/**
 * money-core — the single canonical home for the bigint-cents money primitives.
 *
 * Previously `roundHalfEven`, `toCents` and `fromCents` were copy-pasted
 * verbatim into cart-math.ts, intake-math.ts and bewertung-math.ts. They are
 * now defined ONCE here and re-exported from those modules, so every existing
 * import site keeps working unchanged.
 *
 * Discipline (server-mirroring, memory.md #41):
 *   - cents are ALWAYS bigint — no JS Number / parseFloat / toFixed arithmetic.
 *   - rounding is HALF_EVEN (banker's rounding), ties to even.
 *   - money strings tolerate the German decimal comma ("50,00").
 *
 * The server (`apps/api-cloud/src/lib/transaction-math.ts`) re-validates every
 * number with Decimal.js, so anything produced here must match those rules.
 */

import { normalizeDecimal } from './decimal.js';

// ────────────────────────────────────────────────────────────────────────
// Cent <-> decimal-string conversion
// ────────────────────────────────────────────────────────────────────────

export function toCents(input: string): bigint {
  // Tolerate the German decimal comma ("10,20") anywhere a price string flows.
  const eur = input.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(eur)) {
    throw new Error(`toCents: invalid decimal string "${input}"`);
  }
  const sign = eur.startsWith('-') ? -1n : 1n;
  const abs = eur.startsWith('-') ? eur.slice(1) : eur;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || '0'));
}

/**
 * Cent-Betrag aus dem, was ein MENSCH getippt hat.
 *
 * ── DER FUND VOM 02.08.2026 ────────────────────────────────────────────────
 *
 * `toCents` bekam beides: kanonische Werte aus der Datenbank UND rohe
 * Tastenanschläge. Seine Nachsicht war ein einzelnes `replace(',', '.')`, und
 * das reichte für keinen der wirklichen Fälle. Gemessen:
 *
 *   getippt        toCents(roh)            richtig wäre
 *   ───────        ────────────            ────────────
 *   1.999          199 Cent                199900 Cent   ⚠️ tausendfach zu wenig
 *   1.999,99       WIRFT                   199999 Cent   ⚠️ Absturz beim Zeichnen
 *   ١٩٩٫٩٩         WIRFT                   19999 Cent
 *   1 999,99       WIRFT                   199999 Cent
 *
 * Und in jedem dieser Fälle sagte das Feld daneben „gültig". Das Rabattfeld
 * im Warenkorb ruft `toCents` MITTEN IM ZEICHNEN und ohne Auffangnetz: ein
 * Tausenderpunkt mit Komma nimmt dem Kassierer die Verkaufsfläche weg,
 * während der Kunde davorsteht.
 *
 * ── DIE TRENNUNG ───────────────────────────────────────────────────────────
 *
 * Der eigentliche Fehler war nicht die Nachsicht, sondern dass EINE Funktion
 * zwei Rollen hatte. Deshalb jetzt zwei:
 *
 *   `toCents(kanonisch)`      streng. Für Werte aus der Datenbank und aus
 *                             `fromCents`. Wirft, wenn etwas anderes kommt —
 *                             und das SOLL es, denn dort wäre ein krummer
 *                             Wert ein Fehler im Haus.
 *   `centsAusEingabe(roh)`    nachsichtig. Für alles, was ein Mensch tippt.
 *                             Gibt `null` statt zu werfen, damit eine Fläche
 *                             nie mitten im Zeichnen zerbricht.
 */
export function centsAusEingabe(raw: string): bigint | null {
  const kanonisch = normalizeDecimal(raw ?? '', 2);
  if (kanonisch === '') return null;
  try {
    return toCents(kanonisch);
  } catch {
    return null;
  }
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────
// Banker's rounding (HALF_EVEN) on integer-cent ratios.
//
//   roundHalfEven(num, den) → bigint cents
//
// Plain (num / den) truncates toward zero, which is correct ~50% of the time.
// We add the half-up adjustment, then flip ties to even.
// ────────────────────────────────────────────────────────────────────────

export function roundHalfEven(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error('roundHalfEven: division by zero');
  const negative = num < 0n !== den < 0n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;

  const q = absNum / absDen;
  const r = absNum % absDen;
  const twice = r * 2n;

  let result: bigint;
  if (twice < absDen) result = q;
  else if (twice > absDen) result = q + 1n;
  else result = q % 2n === 0n ? q : q + 1n; // tie → even

  return negative ? -result : result;
}
