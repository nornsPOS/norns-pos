/**
 * TypeBox schemas for POST /api/transactions/finalize.
 *
 * Single source of truth — Fastify uses these for runtime validation,
 * @fastify/swagger publishes them as the OpenAPI 3.1 schema, and
 * `Static<typeof X>` gives the route handler precise compile-time types.
 *
 * The body is intentionally explicit:
 *   • Header totals are required even though they're recomputable from
 *     items — this is the client's declaration of intent, which the API
 *     validates with Decimal.js. Mismatch = client bug = reject.
 *   • Each line carries its `reservation_session_id` (the UUID from a prior
 *     `reserve()`) so the route can call `finalize()` per line.
 *   • Storno is the same endpoint with `storno_of_transaction_id` set and
 *     all money fields negated.
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString, SignedDecimalString, VatRateString } from './money.js';

// ────────────────────────────────────────────────────────────────────────
// Enums (mirror the DB)
// ────────────────────────────────────────────────────────────────────────

export const TransactionDirection = Type.Union([Type.Literal('VERKAUF'), Type.Literal('ANKAUF')], {
  description: 'VERKAUF = we sell to customer; ANKAUF = we buy from customer (ADR-0007).',
});

export const PaymentMethod = Type.Union(
  [
    Type.Literal('CASH'),
    Type.Literal('ZVT_CARD'),
    Type.Literal('SUMUP'),
    Type.Literal('MOLLIE'),
    Type.Literal('STRIPE'),
    Type.Literal('EBAY'),
    Type.Literal('BANK_TRANSFER'),
    Type.Literal('VOUCHER'),
    // 26.07.2026 (migration 0120): Kartenzahlung ueber den Stripe-Leser am
    // Ladentisch. Eigener Wert — ZVT_CARD bleibt daneben bestehen, STRIPE
    // gehoert dem Web-Shop.
    Type.Literal('STRIPE_TERMINAL'),
  ],
  { description: 'Payment channel — per migration 0009 enum (0120: + STRIPE_TERMINAL).' },
);

export const TaxTreatmentCode = Type.Union(
  [
    Type.Literal('MARGIN_25A'),
    Type.Literal('INVESTMENT_GOLD_25C'),
    Type.Literal('STANDARD_19'),
    Type.Literal('REDUCED_7'),
    Type.Literal('MIXED'),
    Type.Literal('REVERSE_CHARGE_13B'),
  ],
  { description: 'BMF tax treatment code (seeded in tax_treatment_codes — migration 0005).' },
);

// ────────────────────────────────────────────────────────────────────────
// Line item
// ────────────────────────────────────────────────────────────────────────

export const FinalizeLineItem = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  reservationSessionId: Type.String({
    format: 'uuid',
    description:
      'Session id from the prior `reserve()` that put this product into RESERVED state. ' +
      'The route calls inventory-lock finalize() with this id; mismatch fails the whole transaction.',
  }),

  // Negative on storno lines.
  lineSubtotalEur: SignedDecimalString,
  lineVatEur: SignedDecimalString,
  lineTotalEur: SignedDecimalString,

  appliedTaxTreatmentCode: TaxTreatmentCode,
  appliedVatRate: Type.Union([VatRateString, Type.Null()], {
    description: 'NULL for §25a margin scheme; otherwise the snapshot of the rate applied at sale.',
  }),

  // §25a margin snapshot — required when applied_tax_treatment_code = MARGIN_25A.
  acquisitionCostEurSnapshot: Type.Union([DecimalString, Type.Null()]),
  marginEur: Type.Union([SignedDecimalString, Type.Null()]),

  /**
   * Rabatt (line discount), GoBD-reported separately (migration 0019). The
   * line money fields above are already NET of this amount — this records HOW
   * MUCH was knocked off so the receipt + DSFinV-K can show it. The DB CHECK
   * `line_discount_eur = 0 OR line_discount_reason IS NOT NULL` requires a
   * reason whenever the discount is non-zero; the route surfaces a clean
   * VALIDATION_ERROR before the DB does.
   */
  lineDiscountEur: Type.Optional(DecimalString),
  lineDiscountReason: Type.Optional(Type.Union([Type.String({ maxLength: 256 }), Type.Null()])),

  displayOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 32767 })),
});
export type FinalizeLineItem = Static<typeof FinalizeLineItem>;

// ────────────────────────────────────────────────────────────────────────
// Payment leg
// ────────────────────────────────────────────────────────────────────────

export const FinalizePayment = Type.Object({
  paymentMethod: PaymentMethod,
  amountEur: SignedDecimalString,
  externalRef: Type.Optional(Type.String({ maxLength: 256 })),
  zvtTerminalId: Type.Optional(Type.String({ maxLength: 64 })),
  zvtReceiptNumber: Type.Optional(Type.String({ maxLength: 64 })),
  zvtCardBrand: Type.Optional(Type.String({ maxLength: 32 })),
  zvtCardPanMasked: Type.Optional(
    Type.String({
      pattern: '^\\*+\\d{4}$',
      description: 'Masked last-4 PAN (e.g. `****1234`). DB CHECK refuses other shapes.',
    }),
  ),
  molliePaymentId: Type.Optional(Type.String({ maxLength: 64 })),
});
export type FinalizePayment = Static<typeof FinalizePayment>;

// ────────────────────────────────────────────────────────────────────────
// Request body
// ────────────────────────────────────────────────────────────────────────

export const FinalizeBody = Type.Object({
  direction: TransactionDirection,

  /**
   * Optional for VERKAUF (walk-in cash sale below KYC threshold).
   * REQUIRED for ANKAUF — enforced by `transactions_ankauf_requires_customer`
   * CHECK constraint (migration 0013 C-1). Sending null here on ANKAUF will
   * fail at the DB, which the error-handler maps to VALIDATION_ERROR.
   */
  customerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),

  // Header money — the client's declaration. Decimal.js validation re-checks
  // against the sum of items + payments.
  subtotalEur: SignedDecimalString,
  vatEur: SignedDecimalString,
  totalEur: SignedDecimalString,
  taxTreatmentCode: TaxTreatmentCode,

  /**
   * Die Rechtshinweise, die auf dem GEDRUCKTEN Beleg stehen.
   *
   * ── 20.08.2026, EIN STILLER FUND ───────────────────────────────────────
   *
   * Die Kasse schickte dieses Feld (und `vatDisclosableEur`) seit jeher mit,
   * und das Schema kannte es NICHT — TypeBox liess es stillschweigend fallen.
   * Der Motor konnte also nie nachsehen, was der Bon wirklich sagt. Solange
   * es nur um Bequemlichkeit ging, war das folgenlos; beim Kleinunternehmer
   * ist es das nicht: sein Beleg MUSS den Hinweis nach § 19 UStG tragen, und
   * ohne dieses Feld kann der Motor das nicht prüfen.
   *
   * Optional, damit eine ältere Kasse weiterverkauft. Die Prüfung im
   * Verkaufsweg greift nur dort, wo der Betrieb wirklich § 19 führt.
   */
  specialSchemeNotices: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 12 })),

  items: Type.Array(FinalizeLineItem, { minItems: 1, maxItems: 200 }),
  payments: Type.Array(FinalizePayment, { minItems: 1, maxItems: 16 }),

  /**
   * §19.2 C-4 — client-supplied idempotency token.
   *
   * The client (BezahlenDialog) generates a UUIDv4 once per Bezahlen
   * dialog open and SENDS THE SAME KEY on every retry attempt. The
   * server's INSERT … ON CONFLICT pattern guarantees at-most-once
   * finalize for a given key — a lost-response retry returns the
   * ORIGINAL transaction row, not a duplicate.
   *
   * Partial UNIQUE INDEX `transactions_idempotency_key_uniq` (migration
   * 0028) is the enforcement layer. NULL is permitted for legacy / non-
   * V1 callers (e.g. webhook handlers, worker jobs), but V1 POS clients
   * MUST set this. Required field — no Type.Optional.
   */
  idempotencyKey: Type.String({
    format: 'uuid',
    description: 'Client-generated UUIDv4. Same key on every retry of the same logical sale.',
  }),

  /**
   * Trockenlauf: alles prüfen, nichts schreiben.
   *
   * ⚠️ Der Grund ist kein Komfort. Beim Kartenweg liegt die Autorisierung VOR
   * dem finalize (`BezahlenDialog.tsx`, `pendingAuthRef`). Wird der Vorgang
   * danach abgelehnt — § 13b, § 10 GwG, § 259 StGB oder ein Rechenfehler —
   * ist die Karte belastet, jeder Wiederholversuch scheitert gleich, und die
   * Kassiererin hat keinen Ausweg. Die Kasse fragt deshalb VOR der
   * Autorisierung, ob dieser Vorgang durchginge.
   *
   * Die Antwort trägt dann `dryRun: true` statt einer Vorgangskennung.
   */
  dryRun: Type.Optional(
    Type.Boolean({ description: 'Run every validation, write nothing. Answers { dryRun: true }.' }),
  ),

  /**
   * Storno linkage. Present when this transaction REVERSES a prior one.
   * The pre-existing `transactions_validate_storno` trigger enforces:
   *   • the referenced row is not itself a storno
   *   • direction matches the original
   *   • magnitudes exactly negate the original
   *   • customer matches
   * Migration 0013 C-5 adds the partial UNIQUE — at most one storno per original.
   */
  stornoOfTransactionId: Type.Optional(Type.String({ format: 'uuid' })),

  /**
   * Die vom GERAET erfasste Vorgangszeit (0118).
   *
   * ⚠️ Der Grund: bis zum 26.07.2026 stand hier nichts, und die Route
   * schrieb `finalized_at` gar nicht — die Spalte fiel auf `DEFAULT now()`.
   * Die Zeit des Vorgangs war damit die Zeit, zu der der SERVER ihn
   * entgegennahm. Ein Verkauf um 17:50 Uhr ohne Netz, der am naechsten
   * Morgen abfloss, erschien im Z-Bon des NAECHSTEN Tages. Fuer ein Geraet,
   * das nachts in der Theke steht, ist das der Normalfall.
   *
   * Nach § 146a AO und der DSFinV-K ist die Kasse die Quelle fuer
   * Vorgangsbeginn und Vorgangsende. Der Wert wird deshalb ZUM ZEITPUNKT
   * DES KASSIERENS festgehalten und faehrt in derselben versiegelten
   * Anfrage mit, die schon vor dem Netz auf Platte geschrieben wird.
   *
   * Ein vom Klienten gelieferter Zeitstempel ist zugleich ein Angriffsweg,
   * deshalb prueft der Server ihn: eine Zeit in der Zukunft wird abgelehnt,
   * eine sehr alte ebenfalls. Die Eingangszeit des Servers wird getrennt
   * daneben aufgezeichnet (`transactions.eingegangen_am`), damit die
   * Verschiebung sichtbar und pruefbar bleibt (§ 146 Abs. 4 AO).
   *
   * OPTIONAL, damit aeltere Kassen weiterlaufen: fehlt der Wert, gilt wie
   * bisher die Serverzeit.
   */
  erfasstAm: Type.Optional(
    Type.String({
      format: 'date-time',
      description:
        'Vom Geraet erfasste Vorgangszeit (ISO 8601 mit Zeitzone). Wird zu finalized_at, ' +
        'solange ihr Kassentag noch offen ist. Zukunft wird abgelehnt.',
    }),
  ),

  /**
   * Der WAHRE Vorgangsbeginn (19.08.2026): wann das ERSTE Stueck in den Korb
   * kam. § 6 Satz 1 Nr. 2 KassenSichV verlangt Beginn UND Ende des Vorgangs
   * auf dem Beleg; bis heute trug BON_START dieselbe Zeit wie BON_ENDE.
   * Optional — Wiederanlauf und Web-Abholung kennen den Beginn nicht, dann
   * gilt ehrlich die Erfassungszeit.
   */
  vorgangBegonnenAm: Type.Optional(
    Type.String({
      format: 'date-time',
      description:
        'Beginn des Vorgangs an der Kasse (erstes Stueck im Korb, ISO 8601). Muss vor ' +
        'der Erfassungszeit oder gleich ihr liegen.',
    }),
  ),

  /**
   * Die Schicht, auf der WIRKLICH kassiert wurde (0118).
   *
   * ⚠️ Bis zum 26.07.2026 suchte die Route sich selbst „irgendeine offene
   * Schicht dieses Geraets" — und zwar ZUM ZEITPUNKT DES NACHSPIELENS. War
   * die Schicht beim Abfliessen bereits geschlossen, hing der Verkauf an der
   * NEUEN Schicht oder an gar keiner, und der Kassensturz der Schicht, in
   * der wirklich kassiert wurde, stimmte nicht.
   *
   * Der Server prueft, dass die Schicht zu DIESEM Geraet gehoert — ein
   * Klient darf sich keine fremde Schicht aussuchen.
   *
   * OPTIONAL: fehlt sie, faellt die Route auf die alte Suche zurueck.
   */
  shiftId: Type.Optional(
    Type.String({
      format: 'uuid',
      description:
        'Die auf dem Geraet offene Schicht zum Zeitpunkt des Kassierens. Muss zum Geraet gehoeren.',
    }),
  ),

  notesInternal: Type.Optional(Type.String({ maxLength: 1024 })),

  /**
   * Abholung einer Web-Reservierung am Tresen (0099).
   *
   * Gesetzt, wenn dieser Verkauf die Ware einer Online-Reservierung übergibt,
   * die der Kunde abholt und hier bezahlt. Dann gilt zweierlei: die reservierten
   * Stücke gehören keinem Kassierer (`reserved_by_user_id` ist NULL), also wird
   * mit `userId: null` finalisiert; und nach dem Beleg wird der Warenkorb an
   * DIESE Transaktion gebunden (CONVERTED, pickup_stage ABGEHOLT, abgeholt am
   * und durch), damit die Reservierung und der Kassenbon EIN Vorgang sind und
   * nicht zwei unverbundene Zeilen.
   */
  webOrderNumber: Type.Optional(Type.String({ maxLength: 32 })),
});
export type FinalizeBody = Static<typeof FinalizeBody>;

// ────────────────────────────────────────────────────────────────────────
// Response
// ────────────────────────────────────────────────────────────────────────

export const FinalizeResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  receiptLocator: Type.String(),
  finalizedAt: Type.String({ format: 'date-time' }),
  ledgerEventId: Type.Integer({
    description: 'monotonically-increasing id of the emitted ledger_events row.',
  }),
  direction: TransactionDirection,
  totalEur: SignedDecimalString,
  storno: Type.Boolean({ description: 'TRUE if this transaction reversed a prior one.' }),

  /**
   * Der Nachtrag, sichtbar an der Kasse (0118).
   *
   * ⚠️ Gesetzt, wenn dieser Vorgang eintraf, NACHDEM sein eigener Kassentag
   * schon abgeschlossen war. Der abgeschlossene Tag bleibt unberuehrt
   * (§ 146 Abs. 4 AO), der Vorgang ist auf dem LAUFENDEN Tag gebucht, und
   * dieses Feld traegt den Tag, zu dem er wirklich gehoert.
   *
   * ⛔ Er darf nicht still in den offenen Tag rutschen — genau das tat er
   * bisher. Die Kasse zeigt den Hinweis, das Tagebuch traegt ihn, und der
   * Inhaber bekommt `alert.nachtrag_eingang`.
   *
   * `null` im Regelfall.
   */
  nachtragBezugstag: Type.Optional(
    Type.Union([Type.String({ format: 'date' }), Type.Null()], {
      description:
        'Der abgeschlossene Kassentag, zu dem dieser nachtraeglich eingegangene Vorgang gehoert.',
    }),
  ),

  /** Die vom Geraet erfasste Vorgangszeit, so wie sie aufgezeichnet wurde. */
  erfasstAm: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),

  /**
   * Die Ermahnung, wenn dieser Beleg OHNE Sicherungseinrichtung entstand
   * (Wanderung 0142, Basels Anweisung vom 13.08.2026).
   *
   * ⚠️ DIESES FELD MUSS IM SCHEMA STEHEN. Fastify entfernt jedes Feld, das
   * die Antwort traegt und das Schema nicht kennt, still und ohne Fehler.
   * Dieses Haus hat genau daran schon einmal einen ehrlichen Hinweis
   * verloren: der Server schickte ihn, die Kasse bekam ihn nie, und an
   * nichts fiel es auf. Der Waechter `zehn-belege-dann-schluss` haelt das
   * Schema deshalb gegen die Route.
   *
   * `null` im Regelfall, also sobald eine TSE eingerichtet ist.
   */
  // 15.08.2026: hier stand der ohneTse-Block der geloeschten Gnadenfrist.
  // Ohne Sicherungseinrichtung entsteht kein Beleg mehr, also auch keine
  // Ermahnung, die mitreisen koennte.
});
export type FinalizeResponse = Static<typeof FinalizeResponse>;

/**
 * Die Antwort des Trockenlaufs.
 *
 * ⚠️ Sie MUSS im Antwortschema stehen. Fastify entfernt aus einer Antwort
 * still alles, was das Schema nicht kennt — und `FinalizeResponse` verlangt
 * `id`, `receiptLocator` und `ledgerEventId`, die es hier gar nicht gibt. Ohne
 * diese Vereinigung wäre der Trockenlauf am EIGENEN Schema gescheitert, und
 * zwar mit einem 500er, der nach einem Serverfehler aussieht.
 */
export const DryRunResponse = Type.Object({
  dryRun: Type.Literal(true),
  wouldSucceed: Type.Literal(true),
});
export type DryRunResponse = Static<typeof DryRunResponse>;

/** Was `POST /finalize` mit 200 beantworten darf. */
export const FinalizeOrDryRunResponse = Type.Union([FinalizeResponse, DryRunResponse]);
