/**
 * Metal-prices domain client — Edelmetall-Kursmodul (Day 23).
 *
 *   current()                 — GET   /api/metal-prices/current
 *   history(query)            — GET   /api/metal-prices/history
 *   rates()                   — GET   /api/metal-prices/rates
 *   override(body)            — POST  /api/metal-prices         (Owner + step-up)
 *   updateMargin(body)        — PATCH /api/metal-prices/margin  (Owner + step-up)
 *
 * Prices on the wire are JSON-safe NUMERIC(15,4) decimal strings.
 */

import type { ApiClient } from '../client.js';

/** Die Körner, in denen der Verlauf verdichtet wird. */
export type Kornstufe = '5min' | 'stunde' | 'tag' | 'woche';

/** Eine Kerze des Verlaufs. Beträge als Zeichenketten, nie als Gleitkomma. */
export interface Kurskerze {
  t: string;
  o: string;
  h: string;
  l: string;
  c: string;
  /** Wie viele Messpunkte in diesem Korn lagen. */
  n: number;
}

export interface Kursverlauf {
  metal: string;
  korn: Kornstufe;
  kerzen: Kurskerze[];
}

export type MetalKind = 'gold' | 'silver' | 'platinum' | 'palladium';
/**
 * Die Herkunft einer Kurszeile. Wert für Wert der Datenbanktyp
 * `metal_price_source`.
 *
 * `SPOT_VENDOR` kam mit Wanderung 0129 dazu: ein Anbieter-Spotkurs,
 * umgerechnet mit dem EZB-Referenzkurs. Er ist seither die Herkunft JEDER
 * automatisch geholten Zeile — `LBMA` darf ohne IBA-Lizenz nicht mehr
 * behauptet werden.
 */
export type MetalPriceSource =
  | 'LBMA'
  | 'XAUEUR_VENDOR'
  | 'SPOT_VENDOR'
  | 'MANUAL'
  | 'INTERNAL_ESTIMATE';

export const METAL_KIND_ORDER: readonly MetalKind[] = ['gold', 'silver', 'platinum', 'palladium'];

export interface CurrentMetalPrice {
  metal: MetalKind;
  /** Decimal string (15,4). null when no row has ever been recorded. */
  pricePerGramEur: string | null;
  source: MetalPriceSource | null;
  fetchedAt: string | null;
  validFrom: string | null;
}

export interface CurrentMetalPricesResponse {
  prices: CurrentMetalPrice[];
}

export interface MetalPriceHistoryRow {
  /** bigserial as decimal string. */
  id: string;
  metal: MetalKind;
  pricePerGramEur: string;
  source: MetalPriceSource;
  validFrom: string;
  validTo: string | null;
  fetchedAt: string;
  manualOverrideByUserId: string | null;
  manualOverrideReason: string | null;
}

export interface MetalPriceHistoryQuery {
  metal?: MetalKind;
  limit?: number;
  offset?: number;
}

export interface MetalPriceHistoryResponse {
  items: MetalPriceHistoryRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ManualOverrideBody {
  metal: MetalKind;
  /** Decimal string (15,4). */
  pricePerGramEur: string;
  /** ≥ 8 chars. Persisted to metal_prices.manual_override_reason + audit. */
  reason: string;
}

export interface ManualOverrideResponse {
  metal: MetalKind;
  pricePerGramEur: string;
  source: 'MANUAL';
  validFrom: string;
  previousPricePerGramEur: string | null;
}

/** One metal's pricing row from GET /api/metal-prices/rates. */
export interface MetalRate {
  metal: MetalKind;
  /** Current spot per gram (melt). null when no row yet. */
  currentPricePerGramEur: string | null;
  /** Time-weighted 10-day average per gram. null when no in-window coverage. */
  avg10dPricePerGramEur: string | null;
  /** Buy rate = avg10d × (1 − safetyMarginPct). null when avg is null. */
  ankaufRatePerGramEur: string | null;
  /** Sell melt baseline per gram (= current spot). null when no row yet. */
  verkaufBasePerGramEur: string | null;
  /** Per-metal Ankauf safety margin in effect for THIS metal (0.10 = 10%). */
  safetyMarginPct: number;

  // ── DAS ALTER DES KURSES, UND WARUM ES HIER GEFEHLT HAT ──────────────────
  //
  // ⚠️ 31.07.2026: die Route liefert diese drei Felder seit jeher
  // (`apps/api-cloud/src/routes/metal-prices.ts`, um Zeile 303). Diese
  // Schnittstelle kannte sie NICHT, also gab es sie für die Kasse nicht — und
  // ein sieben Tage alter Kurs erschien dem Händler als selbstbewusste Zahl,
  // ohne ein einziges Zeichen, dass er alt ist.
  //
  // Bei einem Altgoldankauf ist das kein Schönheitsfehler: der Ankaufpreis ist
  // Kurs mal Feingehalt mal Gewicht. Ein alter Kurs zahlt bei JEDEM Ankauf
  // falsch, und immer in dieselbe Richtung.

  /** Wann dieser Kurs gültig wurde. Null, wenn es noch keinen gibt. */
  asOf: string | null;
  /** Alter in Stunden. Daraus baut die Fläche „Stand …" und die Farbe. */
  ageHours: number | null;
  /**
   * Zu alt für eine Empfehlung. Ist das wahr, ist `ankaufRatePerGramEur`
   * bereits `null` — der Server verweigert den Vorschlag, statt mit einem
   * alten Kurs zu rechnen.
   */
  stale: boolean;
}

export interface MetalRatesResponse {
  /** Ankauf safety margin fraction in effect (0.10 = 10%). */
  safetyMarginPct: number;
  /** Averaging window in days (10). */
  windowDays: number;
  rates: MetalRate[];
}

export interface UpdateMarginBody {
  /** Metal to set. Omit for the global/default margin. */
  metal?: MetalKind;
  /** Safety margin fraction in [0, 0.5]. 0.12 = 12%. */
  marginPct: number;
}

export interface UpdateMarginResponse {
  metal: MetalKind | null;
  marginPct: number;
}

function buildQuery(q: MetalPriceHistoryQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const metalPricesApi = {
  current(client: ApiClient): Promise<CurrentMetalPricesResponse> {
    return client.request<CurrentMetalPricesResponse>('GET', '/api/metal-prices/current');
  },
  /**
   * Der Verlauf als KERZEN über ein Zeitfenster (21.08.2026).
   *
   * ⚠️ `history` gibt ZEILEN und deckelt bei 200. Bei fünf Minuten
   * Schreibtakt sind das 16,7 Stunden — für alles jenseits eines halben
   * Tages ist dieser Weg hier der richtige. Er lässt die Datenbank
   * verdichten und trägt echte Hochs und Tiefs.
   */
  verlauf(
    client: ApiClient,
    query: { metal: string; von: string; bis?: string; korn: Kornstufe },
  ): Promise<Kursverlauf> {
    const p = new URLSearchParams({ metal: query.metal, von: query.von, korn: query.korn });
    if (query.bis !== undefined) p.set('bis', query.bis);
    return client.request<Kursverlauf>('GET', `/api/metal-prices/verlauf?${p.toString()}`);
  },
  history(
    client: ApiClient,
    query: MetalPriceHistoryQuery = {},
  ): Promise<MetalPriceHistoryResponse> {
    return client.request<MetalPriceHistoryResponse>(
      'GET',
      `/api/metal-prices/history${buildQuery(query)}`,
    );
  },
  rates(client: ApiClient): Promise<MetalRatesResponse> {
    return client.request<MetalRatesResponse>('GET', '/api/metal-prices/rates');
  },
  override(client: ApiClient, body: ManualOverrideBody): Promise<ManualOverrideResponse> {
    return client.request<ManualOverrideResponse>('POST', '/api/metal-prices', body);
  },
  updateMargin(client: ApiClient, body: UpdateMarginBody): Promise<UpdateMarginResponse> {
    return client.request<UpdateMarginResponse>('PATCH', '/api/metal-prices/margin', body);
  },

  /**
   * Der VERKAUFSaufschlag je Metall — was gerade gilt.
   *
   * Basels Entscheidung vom 05.08.2026: der Verkaufspreis eines
   * Metallstücks wird gerechnet, Feingewicht × Tageskurs + Aufschlag. Der
   * Aufschlag gehört ihm; er setzt ihn in den Einstellungen.
   */
  leseVerkaufsaufschlag(client: ApiClient): Promise<Verkaufsaufschlag> {
    return client.request<Verkaufsaufschlag>('GET', '/api/metal-prices/verkaufsaufschlag');
  },

  /**
   * Den Verkaufsaufschlag setzen. Nur der Inhaber, mit Nachbestätigung.
   *
   * ⚠️ ANTEIL, NICHT PROZENT: 0.12 sind zwölf Prozent. Der Server weist
   * alles über 1 mit 400 ab — wer „12" tippt, bekommt keinen zehnfachen
   * Preis, sondern einen Fehler.
   */
  setzeVerkaufsaufschlag(
    client: ApiClient,
    body: VerkaufsaufschlagBody,
  ): Promise<Verkaufsaufschlag> {
    return client.request<Verkaufsaufschlag>(
      'PATCH',
      '/api/metal-prices/verkaufsaufschlag',
      body,
    );
  },
};

/** Der Stand aller Aufschläge. Anteile als Zeichenkette, nie als Fliesskomma. */
export interface Verkaufsaufschlag {
  global: string;
  gold: string;
  silver: string;
  platinum: string;
  palladium: string;
}

export interface VerkaufsaufschlagBody {
  /** Weglassen setzt den globalen Wert für alle Metalle ohne eigene Ausnahme. */
  metal?: MetalKind;
  /** ANTEIL in [0, 1]. 0.12 sind zwölf Prozent. */
  aufschlagAnteil: number;
}
