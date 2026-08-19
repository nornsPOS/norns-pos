/**
 * TypeBox schemas for the Edelmetall-Kursmodul (Day 23).
 *
 * Exposes two surfaces:
 *   • metal_prices  — read current, read history, manual override (Owner)
 *   • product valuation — schmelzwert + collector_premium + total
 *
 * Prices on the wire are JSON strings (same convention as money.ts).
 * Metal precision is NUMERIC(15,4); valuation totals are NUMERIC(18,2).
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString } from './money.js';

const METAL_ENUM = Type.Union([
  Type.Literal('gold'),
  Type.Literal('silver'),
  Type.Literal('platinum'),
  Type.Literal('palladium'),
]);

/**
 * Die Herkunft einer Kurszeile. MUSS Wert für Wert dem Datenbanktyp
 * `metal_price_source` entsprechen (`packages/db/src/schema/metals/enums.ts`).
 *
 * ⚠️ 31.07.2026, am laufenden Motor gemessen: `SPOT_VENDOR` fehlte hier.
 * Wanderung 0129 hatte den Wert der Datenbank hinzugefügt, der Kursdienst
 * schrieb ihn in jede Zeile — und dann brach Fastify beim VERPACKEN der
 * Antwort ab:
 *
 *   TypeError: The value of '#/properties/prices/items/properties/source'
 *   does not match schema definition.
 *
 * Ergebnis: `GET /api/metal-prices/current` antwortete auf jeder frischen
 * Kasse mit 500. Der Händler sah keinen Goldpreis, sondern einen Fehler —
 * auf genau der Fläche, die sein Vertrauen tragen soll. `/rates` daneben
 * lief weiter, weil dessen Schema die Herkunft gar nicht mitschickt; die
 * halbe Grünfärbung war der Grund, warum es niemandem auffiel.
 *
 * Wer hier einen Wert ergänzt, ergänzt ihn auch im Drizzle-Schema und im
 * Klienten. Der Wächter daneben zählt nach.
 */
const SOURCE_ENUM = Type.Union([
  Type.Literal('LBMA'),
  Type.Literal('XAUEUR_VENDOR'),
  Type.Literal('SPOT_VENDOR'),
  Type.Literal('MANUAL'),
  Type.Literal('INTERNAL_ESTIMATE'),
]);

/**
 * NUMERIC(15,4)-shaped string: up to 11 digits + optional `.dddd`.
 * Matches metal_prices.price_per_gram_eur exactly.
 */
const PricePerGramString = Type.String({
  pattern: '^\\d{1,11}(\\.\\d{1,4})?$',
  examples: ['62.5000', '0.7500', '29.4500'],
  description: 'Price per gram in EUR, NUMERIC(15,4) compatible.',
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/metal-prices/current — all 4 metals' CURRENT row
// ────────────────────────────────────────────────────────────────────────

export const CurrentMetalPrice = Type.Object({
  metal: METAL_ENUM,
  pricePerGramEur: Type.Union([PricePerGramString, Type.Null()], {
    description: 'NULL when no row has ever been recorded for this metal.',
  }),
  source: Type.Union([SOURCE_ENUM, Type.Null()]),
  fetchedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  validFrom: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

export const CurrentMetalPricesResponse = Type.Object({
  prices: Type.Array(CurrentMetalPrice),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/metal-prices/history — paged
// ────────────────────────────────────────────────────────────────────────

export const MetalPriceHistoryQuery = Type.Object({
  metal: Type.Optional(METAL_ENUM),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const MetalPriceHistoryRow = Type.Object({
  id: Type.String({ description: 'bigserial as decimal string' }),
  metal: METAL_ENUM,
  pricePerGramEur: PricePerGramString,
  source: SOURCE_ENUM,
  validFrom: Type.String({ format: 'date-time' }),
  validTo: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  fetchedAt: Type.String({ format: 'date-time' }),
  manualOverrideByUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  manualOverrideReason: Type.Union([Type.String(), Type.Null()]),
});

export const MetalPriceHistoryResponse = Type.Object({
  items: Type.Array(MetalPriceHistoryRow),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/metal-prices — Owner manual override
// ────────────────────────────────────────────────────────────────────────

export const ManualOverrideBody = Type.Object(
  {
    metal: METAL_ENUM,
    pricePerGramEur: PricePerGramString,
    reason: Type.String({
      minLength: 8,
      maxLength: 500,
      description:
        'Mandatory human-readable justification (≥ 8 chars). Persisted to ' +
        'metal_prices.manual_override_reason + audit_log payload.',
    }),
  },
  {
    /*
     * ⛔ 11.08.2026: OHNE DIESE ZEILE ERREICHT EIN GEISTERFELD DEN HANDLER.
     *
     * Gemessen mit echtem Fastify und genau diesem Schema: ein Rumpf mit einem
     * vierten, nirgends erklärten Schlüssel kam mit Status 200 durch, und
     * `Object.keys(req.body)` zeigte ihn. Genau so ist die tote Notbremse
     * `confirmOutlier` entstanden — ein Feld, das die Route las, das aber in
     * keinem Vertrag stand und das kein Klient je senden konnte.
     *
     * Mit `additionalProperties: false` entfernt Fastify den Schlüssel VOR dem
     * Handler (gemessen: weiterhin Status 200, Feld weg). Kein Klient bricht,
     * und die nächste Notbremse kann gar nicht erst still entstehen.
     */
    additionalProperties: false,
  },
);

export const ManualOverrideResponse = Type.Object({
  metal: METAL_ENUM,
  pricePerGramEur: PricePerGramString,
  source: Type.Literal('MANUAL'),
  validFrom: Type.String({ format: 'date-time' }),
  previousPricePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/metal-prices/rates — per-metal pricing (current + 10d avg + Ankauf)
// ────────────────────────────────────────────────────────────────────────

export const MetalRate = Type.Object({
  metal: METAL_ENUM,
  /** CURRENT row price per gram. NULL when no row exists yet. */
  currentPricePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
  /** Time-weighted 10-day average. NULL when no in-window coverage. */
  avg10dPricePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
  /**
   * Ankauf (buy) rate = avg10d × (1 − safetyMarginPct).
   *
   * NULL, wenn kein Durchschnitt vorliegt ODER der Kurs ZU ALT ist (`stale`).
   * Der Satz wird in der Kasse ungefragt ins Preisfeld vorgeschrieben; ein
   * Vorschlag aus einem sieben Tage alten Kurs ist bares Geld in die falsche
   * Richtung. NULL heisst hier ausdrücklich: rechne selbst.
   */
  ankaufRatePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
  /**
   * Verkauf (sell) melt baseline per gram = current spot. The full item-level
   * suggested ask (Schmelzwert + Sammleraufschlag) is per-product — see
   * GET /api/products/:id/valuation.
   */
  verkaufBasePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
  /** Per-metal Ankauf safety margin in effect for THIS metal (0.10 = 10%). */
  safetyMarginPct: Type.Number(),
  /**
   * ⚠️ DIESE DREI FELDER MUESSEN HIER STEHEN, SONST GIBT ES SIE NICHT.
   *
   * Fastify entfernt aus der Antwort still alles, was das Antwortschema nicht
   * kennt. Genau diese Falle ist in diesem Haus schon zugeschlagen: die eine
   * ehrliche Angabe, derentwegen der Code geschrieben wurde, verschwand
   * lautlos zwischen Route und Aufrufer.
   *
   * Bis zum 26.07.2026 gab diese Antwort KEINEN Zeitstempel. Gold stand vom
   * 05.06. bis 13.06. auf einem Kurs, 172,8 Stunden, und niemand konnte es
   * merken. Der Kursraum färbte seinen Punkt nach dem Erfolg des ABRUFS und
   * meldete „live", während die Kachel darunter „zuletzt 05.06." trug.
   */
  /** Wann dieser Kurs gültig wurde (ISO). NULL, wenn es keinen gibt. */
  asOf: Type.Union([Type.String(), Type.Null()]),
  /** Alter in Stunden, eine Nachkommastelle. NULL, wenn kein Kurs vorliegt. */
  ageHours: Type.Union([Type.Number(), Type.Null()]),
  /** Zu alt für eine Empfehlung. Dann ist `ankaufRatePerGramEur` NULL. */
  stale: Type.Boolean(),
});

export const MetalRatesResponse = Type.Object({
  /**
   * Default/global Ankauf safety margin (0.10 = 10%). Per-metal overrides are
   * returned on each rate's `safetyMarginPct`. Owner-editable (Phase A3).
   */
  safetyMarginPct: Type.Number(),
  /** Averaging window in days (10). */
  windowDays: Type.Integer(),
  rates: Type.Array(MetalRate),
});

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/metal-prices/margin — Owner sets the Ankauf safety margin
// ────────────────────────────────────────────────────────────────────────

export const MarginBody = Type.Object({
  /**
   * Metal this margin applies to. Omit to set the global/default margin used
   * by any metal without its own override.
   */
  metal: Type.Optional(METAL_ENUM),
  /** Safety margin as a fraction: 0.12 = 12%. Range [0, 0.50] (max 50% discount). */
  marginPct: Type.Number({
    minimum: 0,
    maximum: 0.5,
    description: 'Ankauf safety margin fraction. 0.10 = 10%. Buy rate = avg10d × (1 − marginPct).',
  }),
});

export const MarginResponse = Type.Object({
  metal: Type.Union([METAL_ENUM, Type.Null()]),
  marginPct: Type.Number(),
});

export type TMarginBody = Static<typeof MarginBody>;

/**
 * Der VERKAUFSaufschlag, den der Händler selbst setzt.
 *
 * ⚠️ ANTEIL, NICHT PROZENT — genau wie `MarginBody` daneben. 0.12 sind
 * zwölf Prozent. Zwei Einheiten im selben System wären ein Preisfehler um
 * den Faktor hundert, und zwar still.
 *
 * Die Obergrenze ist 1 (hundert Prozent Aufschlag). Wer „12" statt „0.12"
 * eintippt, wird hier schon abgewiesen und nicht erst in der Rechnung.
 */
export const VerkaufsaufschlagBody = Type.Object({
  /** Metall. Weglassen setzt den globalen Wert für alle ohne eigene Ausnahme. */
  metal: Type.Optional(METAL_ENUM),
  aufschlagAnteil: Type.Number({
    minimum: 0,
    maximum: 1,
    description:
      'Verkaufsaufschlag als ANTEIL. 0.12 = 12 Prozent. Verkaufspreis = ' +
      'Feingewicht × Tageskurs × (1 + aufschlagAnteil).',
  }),
});
export type TVerkaufsaufschlagBody = Static<typeof VerkaufsaufschlagBody>;

/** Der Stand aller vier Aufschläge plus des globalen Werts. */
export const VerkaufsaufschlagResponse = Type.Object({
  global: Type.String(),
  gold: Type.String(),
  silver: Type.String(),
  platinum: Type.String(),
  palladium: Type.String(),
});
export type TVerkaufsaufschlagResponse = Static<typeof VerkaufsaufschlagResponse>;

// ────────────────────────────────────────────────────────────────────────
// GET /api/products/:id/valuation
// ────────────────────────────────────────────────────────────────────────

export const ProductValuationParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const ProductValuationResponse = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  metal: Type.Union([METAL_ENUM, Type.Null()]),
  weightGrams: Type.Union([Type.String(), Type.Null()]),
  finenessDecimal: Type.Union([Type.String(), Type.Null()]),
  feingewichtGrams: Type.Union([Type.String(), Type.Null()]),
  currentPricePerGramEur: Type.Union([PricePerGramString, Type.Null()]),
  /** Schmelzwert = feingewicht × current_price. NULL when any operand is missing. */
  schmelzwertEur: Type.Union([DecimalString, Type.Null()]),
  collectorPremiumEur: Type.Union([DecimalString, Type.Null()]),
  /** schmelzwert + collector_premium. NULL when either is missing. */
  suggestedAskPriceEur: Type.Union([DecimalString, Type.Null()]),
  listPriceEur: DecimalString,
  /** list_price − schmelzwert. NULL when schmelzwert is unknown. */
  marginOverScrapEur: Type.Union([DecimalString, Type.Null()]),
  /** When the current price was first recorded (valid_from of the CURRENT row). */
  pricedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

// ────────────────────────────────────────────────────────────────────────
// Static type re-exports
// ────────────────────────────────────────────────────────────────────────

export type TMetalPriceHistoryQuery = Static<typeof MetalPriceHistoryQuery>;
export type TManualOverrideBody = Static<typeof ManualOverrideBody>;
export type TProductValuationParams = Static<typeof ProductValuationParams>;
