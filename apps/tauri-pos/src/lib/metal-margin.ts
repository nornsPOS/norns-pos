/**
 * metal-margin — pure preview of the server's Ankauf (buy-rate) derivation.
 *
 * The SERVER owns the authoritative number: routes/metal-prices.ts computes
 * `ankauf = ROUND(avg10d × (1 − margin), 4)` in NUMERIC (half-away-from-zero).
 * This mirrors it so the per-metal margin editor can show the resulting buy
 * price live as the owner types — but the real value always comes from the
 * server `/rates` refetch after save (the client never persists its own price).
 *
 * ── 19.08.2026: KEINE GLEITKOMMAZAHL MEHR, NIRGENDS ────────────────────────
 *
 * Hier stand `Math.round(Math.abs(x) * f + 1e-9)`: eine Gleitkomma-Rundung
 * mit einem Schubs von 1e-9, damit echte Haelften trotz IEEE-754-Drift ueber
 * die Kante fallen. Der Schubs war fuer die gebundenen Eingaben (Basis 4
 * Nachkommastellen, Marge 4 Nachkommastellen) rechnerisch korrekt — die
 * naechste Nicht-Haelfte liegt 1e-6 entfernt, der Drift bei ~1e-11 — aber
 * Basels Pruefliste vom 19.08. hat recht: eine Kasse, deren Steuerpfad in
 * NUMERIC und BigInt-Cents rechnet, traegt in der Vorschau kein Gleitkomma
 * mit Schubs. Jetzt rechnet auch die Vorschau EXAKT: Dezimalzeichenketten
 * werden in skalierte BigInt zerlegt, multipliziert und mit half-away-
 * from-zero GETEILT — Ziffer fuer Ziffer dasselbe Ergebnis wie SQL ROUND,
 * beweisbar ohne Epsilon. Keine neue Bibliothek: BigInt ist eingebaut.
 *
 * Money stays a decimal STRING on the wire; auch die Marge kommt jetzt als
 * STRING herein (der rohe Feldinhalt in Prozent), damit nie ein Float
 * dazwischen liegt.
 */

const DEZIMAL = /^-?\d+(?:\.\d+)?$/;

/** Eine Dezimalzeichenkette exakt zerlegen: Vorzeichen, Ziffern, Stellen. */
function zerlege(text: string): { neg: boolean; wert: bigint; stellen: number } | null {
  const t = text.trim();
  if (!DEZIMAL.test(t)) return null;
  const neg = t.startsWith('-');
  const ohne = neg ? t.slice(1) : t;
  const [ganz, bruch = ''] = ohne.split('.');
  return { neg, wert: BigInt(ganz + bruch), stellen: bruch.length };
}

/** n / d mit half-away-from-zero, beide >= 0, d > 0 — wie SQL ROUND. */
function teileHalbAufwaerts(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return r * 2n >= d ? q + 1n : q;
}

/** Ein 4dp-skaliertes BigInt als "123.4567"-Zeichenkette (mit Vorzeichen). */
function als4dp(neg: boolean, skaliert: bigint): string {
  const s = skaliert.toString().padStart(5, '0');
  const ganz = s.slice(0, -4);
  const bruch = s.slice(-4);
  const vorzeichen = neg && skaliert !== 0n ? '-' : '';
  return `${vorzeichen}${ganz}.${bruch}`;
}

/**
 * Preview the derived Ankauf rate from a per-gram base (€/g as a string) and a
 * margin in PERCENT — as the raw string the owner typed ("10", "12.5",
 * "10,25" is normalised by the caller to a dot). Returns a 4dp decimal
 * string, or null when either side is missing / non-numeric — never a
 * fabricated number.
 *
 * Exakt: ankauf₄dp = round_half_away( B × (10^(sp+2) − P) / 10^(sb+sp−2) )
 * mit B = Basisziffern (Skala sb), P = Prozentziffern (Skala sp).
 */
export function deriveAnkaufPerGram(
  baseEurPerGram: string | null | undefined,
  prozent: string | null | undefined,
): string | null {
  if (baseEurPerGram == null || prozent == null) return null;
  const basis = zerlege(baseEurPerGram);
  const marge = zerlege(prozent);
  if (basis === null || marge === null) return null;
  // Eine negative Marge ist keine Marge; ueber 100 % kippte das Vorzeichen.
  if (marge.neg) return null;

  // Faktor = (10^(sp+2) − P) / 10^(sp+2)  entspricht  (1 − P/100).
  const faktorNenner = 10n ** BigInt(marge.stellen + 2);
  const faktorZaehler = faktorNenner - marge.wert;
  const negativ = basis.neg !== faktorZaehler < 0n;

  const zaehler = (basis.wert < 0n ? -basis.wert : basis.wert)
    * (faktorZaehler < 0n ? -faktorZaehler : faktorZaehler);

  // Zielskala 4: Gesamtskala sb + (sp+2) auf 4 bringen.
  const skalenRest = basis.stellen + marge.stellen + 2 - 4;
  const skaliert =
    skalenRest >= 0
      ? teileHalbAufwaerts(zaehler, 10n ** BigInt(skalenRest))
      : zaehler * 10n ** BigInt(-skalenRest);

  return als4dp(negativ, skaliert);
}

/** Format a per-gram decimal string as German "1.234,5678 €/g" (2–4 dp). */
export function formatPerGram(valueEur: string | null): string {
  if (valueEur == null) return '-';
  const trimmed = valueEur.trim();
  if (!DEZIMAL.test(trimmed)) return '-';
  const n = Number.parseFloat(trimmed);
  return `${n.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} €/g`;
}
