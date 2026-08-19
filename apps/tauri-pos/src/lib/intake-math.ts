/**
 * intake-math — bigint-cents math for the Ankauf cart.
 *
 * Used by the Ankauf surface to keep payout totals exact and to compute the
 * live Schmelzwert hint when the operator has entered metal + fineness +
 * weight and a current metal-price is available.
 *
 * Mirrors the precision discipline of `cart-math.ts` (HALF_EVEN banker's
 * rounding, bigint-cents only, no JS-number arithmetic).
 */

// The bigint-cents primitives live in one canonical module (money-core).
// intake-math re-exports toCents / fromCents so its public API is unchanged.
import { fromCents, roundHalfEven, toCents } from './money-core.js';

export { fromCents, toCents };

/**
 * Tolerate the German comma WITHOUT misreading a plain dot-decimal. A value
 * with a comma is German ("1.234,56" / "0,585") → strip dots, comma → dot. A
 * value with no comma is already a dot-decimal (API rates like "62.4500") →
 * leave it untouched. (Unlike `normalizeDecimal`, which treats "." as a
 * thousands separator and would mangle the API values.)
 */
function commaToDot(s: string): string {
  if (s.includes(',')) return s.replace(/\./g, '').replace(',', '.');
  return s;
}

// ────────────────────────────────────────────────────────────────────────
// Header totals
// ────────────────────────────────────────────────────────────────────────

/**
 * Sum line negotiated prices into a header total.
 * Returns bigint cents — caller converts via `fromCents` for display.
 */
export function sumNegotiatedCents(lines: readonly { negotiatedPriceEur: string }[]): bigint {
  let total = 0n;
  for (const l of lines) {
    total += toCents(l.negotiatedPriceEur);
  }
  return total;
}

// ────────────────────────────────────────────────────────────────────────
// Schmelzwert hint (melt value)
// ────────────────────────────────────────────────────────────────────────

/**
 * Compute the live "Schmelzwert" hint for a single intake item.
 *
 *   schmelzwert = weight_grams × fineness_decimal × current_metal_price_per_gram
 *
 * Returns null when any required input is missing or the metal price is
 * unavailable. The UI degrades gracefully: no number rendered, no error.
 *
 * All math in bigint-cents (per gram, per fineness scaled to integer).
 */
export interface SchmelzwertInput {
  metal: 'gold' | 'silver' | 'platinum' | 'palladium' | null;
  /** Grams in decimal-string (e.g. "31.1035" for 1 troy oz). */
  weightGrams: string | null;
  /** Fineness 0..1 in decimal-string (e.g. "0.9999"). */
  finenessDecimal: string | null;
  /** Decimal-string per-gram price (e.g. "62.4500" for gold @ 62.45 EUR/g). */
  pricePerGramEur: string | null;
}

export function computeSchmelzwertEur(input: SchmelzwertInput): string | null {
  if (input.metal === null) return null;
  if (input.weightGrams === null || input.finenessDecimal === null) return null;
  if (input.pricePerGramEur === null) return null;

  // Scale everything to integers to keep precision:
  //   weightCents      = weight  × 10_000  (4 decimals)
  //   finenessCents    = fineness × 10_000 (4 decimals)
  //   priceCents       = price   × 10_000  (4 decimals)
  //   product (before scaling back) = weightCents × finenessCents × priceCents
  //   that's 10_000^3 = 1e12 too large; we divide by 10_000 × 10_000 × 100
  //   to land in cents (final precision = 2 decimals on EUR).
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

  // result_in_cents = (weight × fineness × price) / (10_000 × 10_000 × 100)
  // because we want cents = EUR × 100, and we've multiplied EUR by 10_000.
  const numerator = weightScaled * finenessScaled * priceScaled;
  const denominator = 10_000n * 10_000n * 100n;
  const cents = roundHalfEven(numerator, denominator);
  return fromCents(cents);
}

function parseScaled(s: string, decimals: number): bigint {
  // Tolerate the German comma (memory.md money rule) before the strict check.
  const n = commaToDot(s);
  if (!/^\d+(\.\d+)?$/.test(n)) throw new Error(`invalid decimal "${s}"`);
  const [whole = '0', frac = ''] = n.split('.');
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || '0');
}

// ────────────────────────────────────────────────────────────────────────
// Estimator helpers (UX P3) — itemType → metal, fineness presets, and the
// suggested buy-price derivation (the buy-rate decision lives here).
// ────────────────────────────────────────────────────────────────────────

export type EstimatorMetal = 'gold' | 'silver' | 'platinum' | 'palladium';

/** Infer the precious metal from an itemType prefix; non-metal types → null. */
export function metalFromItemType(itemType: string): EstimatorMetal | null {
  if (itemType.startsWith('gold')) return 'gold';
  if (itemType.startsWith('silver')) return 'silver';
  if (itemType.startsWith('platinum')) return 'platinum';
  if (itemType.startsWith('palladium')) return 'palladium';
  return null;
}

/** Common hallmark finenesses per metal (per mille) for the quick-pick. */
export const COMMON_FINENESS_PER_MILLE: Record<EstimatorMetal, readonly number[]> = {
  gold: [999, 916, 750, 585, 375],
  silver: [999, 925, 800],
  platinum: [999, 950],
  palladium: [999, 950],
};

/** "585" → "0.585" (the 0..1 decimal the valuation core consumes). */
export function finenessDecimalForPerMille(perMille: number): string {
  return (perMille / 1000).toFixed(3);
}

export interface SuggestedBuyInput {
  metal: EstimatorMetal | null;
  weightGrams: string | null;
  finenessDecimal: string | null;
  /** Per-gram buy rate (margin already baked in). Preferred when present. */
  ankaufRatePerGramEur: string | null;
  /** Per-gram current spot — the gross-melt + the margin-fallback basis. */
  currentRatePerGramEur: string | null;
  /** Safety margin fraction (0.10 = 10%) for the fallback. */
  safetyMarginPct: number;
  /**
   * Der Server hat diesen Kurs als zu alt gekennzeichnet (`stale`). PFLICHTFELD,
   * absichtlich: wer diese Rechnung aufruft, MUSS sich zum Alter äussern. Ein
   * Vorgabewert hiesse, das Alter beim nächsten Umbau wieder zu vergessen.
   */
  kursVeraltet: boolean;
}

export interface SuggestedBuy {
  /** Decimal-string EUR, or null when no rate is available (no fake 0). */
  value: string | null;
  /**
   * Which basis produced the value — surfaced in the UI. „veraltet" heisst:
   * der Kurs ist zu alt, der Server verweigert den Satz, und die Kasse baut
   * ihn NICHT nach.
   */
  basis: 'ankauf' | 'margin' | 'veraltet' | 'none';
}

/**
 * Suggested buy price for a precious-metal item. Prefers the server's
 * `ankaufRatePerGramEur` (margin baked in); falls back to current spot ×
 * (1 − safetyMargin); yields null when neither rate is available.
 *
 * ⚠️ BEFUND (11.08.2026): WAS DER SERVER VERWEIGERT, ERFINDET DIE KASSE NICHT.
 *
 * Ist ein Kurs älter als die Altersgrenze, setzt der Server
 * `ankaufRatePerGramEur` bewusst auf null (`routes/metal-prices.ts` mit
 * `lib/kursalter.ts`, begründet am Vorfall vom Juni: alle vier Metalle standen
 * 172,8 Stunden auf einem Wert, danach sprang Gold um −2,6 und Palladium um
 * +5,4 Prozent). Diese Rechnung fiel genau dann auf den weiter gelieferten,
 * eingefrorenen Spot zurück — und `IntakeList` schrieb das Ergebnis ungefragt
 * ins Feld „Ankaufspreis (an Verkäufer zahlen)", während die Kopfleiste
 * wörtlich „kein Ankaufvorschlag" sagte.
 *
 * Die Altersprüfung steht deshalb VOR jeder Rechnung: die Regel dieser Fläche
 * lautet „ein alter Kurs ergibt nie einen Vorschlag" und hängt nicht davon ab,
 * dass der Server seine eigene Regel fehlerfrei anwendet.
 */
export function suggestedBuyEur(input: SuggestedBuyInput): SuggestedBuy {
  if (input.kursVeraltet) return { value: null, basis: 'veraltet' };

  const common = {
    metal: input.metal,
    weightGrams: input.weightGrams,
    finenessDecimal: input.finenessDecimal,
  };

  if (input.ankaufRatePerGramEur !== null) {
    const v = computeSchmelzwertEur({ ...common, pricePerGramEur: input.ankaufRatePerGramEur });
    if (v !== null) return { value: v, basis: 'ankauf' };
  }

  if (input.currentRatePerGramEur !== null) {
    const melt = computeSchmelzwertEur({ ...common, pricePerGramEur: input.currentRatePerGramEur });
    if (melt !== null) {
      const marginScaled = BigInt(Math.round(input.safetyMarginPct * 10_000));
      const suggested = roundHalfEven(toCents(melt) * (10_000n - marginScaled), 10_000n);
      return { value: fromCents(suggested), basis: 'margin' };
    }
  }

  return { value: null, basis: 'none' };
}

// ────────────────────────────────────────────────────────────────────────
// Die EINE Auskunft, die die Ankauffläche liest
// ────────────────────────────────────────────────────────────────────────

/**
 * Die Kurszeile eines Metalls, so wie der Server sie liefert. Bewusst
 * strukturell beschrieben, damit `MetalRate` aus `@norns/api-client`
 * ohne Umweg passt und dieser reine Rechenkern keine Schnittstelle einführt.
 */
export interface KursZeile {
  ankaufRatePerGramEur: string | null;
  currentPricePerGramEur: string | null;
  /** Aufschlagsminderung DIESES Metalls (0.10 = 10 %). */
  safetyMarginPct: number;
  /** Alter des Kurses in Stunden. Null, wenn es noch keinen gibt. */
  ageHours: number | null;
  /** Zu alt für eine Empfehlung — die Entscheidung des Servers. */
  stale: boolean;
}

export interface AnkaufSchaetzung {
  /** Schmelzwert (brutto) am aktuellen Spot. Null, wenn nicht rechenbar. */
  grossMeltEur: string | null;
  /** Der Ankaufvorschlag samt Herkunft. */
  suggestion: SuggestedBuy;
  /** Der Kurs, aus dem hier gerechnet wurde, ist zu alt. */
  kursVeraltet: boolean;
  /** „Kurs 7 Tage alt" — null, wenn der Server kein Alter mitschickt. */
  kursalterSatz: string | null;
}

/**
 * Wie alt ist der Kurs, in einem Satz? „Kurs 12 Min. alt", „Kurs 3 Std alt",
 * „Kurs 7 Tage alt". Null, wenn kein Alter vorliegt — dann wird nichts
 * behauptet. Eine Staffelung für die ganze Kasse (Kopfleiste UND Ankauf), damit
 * dasselbe Alter nicht an zwei Stellen verschieden heisst.
 */
export function formatKursalter(stunden: number | null): string | null {
  if (stunden === null || !Number.isFinite(stunden)) return null;
  if (stunden < 1) return `Kurs ${Math.max(1, Math.round(stunden * 60))} Min. alt`;
  if (stunden < 48) return `Kurs ${Math.round(stunden)} Std alt`;
  return `Kurs ${Math.round(stunden / 24)} Tage alt`;
}

/**
 * ALLES, was die Ankauffläche über einen Posten wissen muss, aus EINER
 * Kurszeile: Schmelzwert, Vorschlag, Alter.
 *
 * ⚠️ WARUM EINE AUSKUNFT UND NICHT DREI AUFRUFE: die Fläche zog sich bis zum
 * 11.08.2026 zwei Einzelfelder aus der Kurszeile (`ankaufRatePerGramEur`,
 * `currentPricePerGramEur`) und las WEDER `stale` NOCH `ageHours` NOCH `asOf`.
 * Der angezeigte Schmelzwert kam damit aus einem 172,8 Stunden alten Spot,
 * ohne ein Zeichen. Wer die ganze Zeile hereinreicht, kann ihr Alter nicht
 * mehr übersehen — auch beim nächsten Umbau nicht.
 *
 * Die Aufschlagsminderung kommt aus DER ZEILE (je Metall), nicht aus dem Kopf
 * der Antwort: dort stand vorher ein `?? 0`, also im Fehlerfall ein erfundener
 * Aufschlag von null Prozent.
 */
export function ankaufSchaetzung(input: {
  metal: EstimatorMetal | null;
  weightGrams: string | null;
  finenessDecimal: string | null;
  rate: KursZeile | null;
}): AnkaufSchaetzung {
  const common = {
    metal: input.metal,
    weightGrams: input.weightGrams,
    finenessDecimal: input.finenessDecimal,
  };

  if (input.rate === null) {
    return {
      grossMeltEur: null,
      suggestion: { value: null, basis: 'none' },
      kursVeraltet: false,
      kursalterSatz: null,
    };
  }

  const grossMeltEur = computeSchmelzwertEur({
    ...common,
    pricePerGramEur: input.rate.currentPricePerGramEur,
  });

  const suggestion = suggestedBuyEur({
    ...common,
    ankaufRatePerGramEur: input.rate.ankaufRatePerGramEur,
    currentRatePerGramEur: input.rate.currentPricePerGramEur,
    safetyMarginPct: input.rate.safetyMarginPct,
    kursVeraltet: input.rate.stale,
  });

  return {
    grossMeltEur,
    suggestion,
    kursVeraltet: input.rate.stale,
    kursalterSatz: formatKursalter(input.rate.ageHours),
  };
}
