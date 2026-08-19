/**
 * Transactions domain client. Mirrors the backend schemas exactly.
 *
 *   finalize(body) — POST /api/transactions/finalize   (Verkauf, Day 13)
 *   ankauf(body)   — POST /api/transactions/ankauf     (Day 8)
 *
 * The two routes are deliberately separate (see ADR `day8-domain-decision.md`
 * §15.2). Verkauf releases RESERVED → SOLD via inventory-lock; Ankauf
 * creates products in the same DB transaction as the Ankauf transaction.
 * Different write semantics → different routes → different schemas.
 *
 * Math helpers for the V1 Verkauf client live in
 * `apps/tauri-pos/src/lib/cart-math.ts`. Ankauf math helpers live in
 * `apps/tauri-pos/src/lib/intake-math.ts`.
 */

import type { ApiClient } from '../client.js';
import type { TaxTreatmentCode } from './products.js';

export type TransactionDirection = 'VERKAUF' | 'ANKAUF';

export type PaymentMethod =
  | 'CASH'
  | 'ZVT_CARD'
  | 'SUMUP'
  | 'MOLLIE'
  | 'STRIPE'
  | 'EBAY'
  | 'BANK_TRANSFER'
  | 'VOUCHER'
  // 26.07.2026 (Wanderung 0120): Kartenzahlung ueber den Stripe-Leser im
  // Laden. Eigener Wert — ZVT_CARD bleibt daneben, STRIPE gehoert dem Shop.
  | 'STRIPE_TERMINAL';

export interface FinalizeLineItem {
  productId: string;
  reservationSessionId: string;
  lineSubtotalEur: string;
  lineVatEur: string;
  lineTotalEur: string;
  appliedTaxTreatmentCode: TaxTreatmentCode;
  appliedVatRate: string | null;
  acquisitionCostEurSnapshot: string | null;
  marginEur: string | null;
  /** Rabatt — GoBD-reported separately. Line money fields are already net of it. */
  lineDiscountEur?: string;
  /** Required by the DB CHECK whenever lineDiscountEur > 0. */
  lineDiscountReason?: string | null;
  displayOrder?: number;
}

export interface FinalizePayment {
  paymentMethod: PaymentMethod;
  amountEur: string;
  externalRef?: string;
  zvtTerminalId?: string;
  zvtReceiptNumber?: string;
  zvtCardBrand?: string;
  zvtCardPanMasked?: string;
  molliePaymentId?: string;
}

export interface FinalizeBody {
  direction: TransactionDirection;
  customerId: string | null;
  subtotalEur: string;
  vatEur: string;
  totalEur: string;
  taxTreatmentCode: TaxTreatmentCode;
  items: FinalizeLineItem[];
  payments: FinalizePayment[];
  /**
   * §19.2 C-4 — UUIDv4 generated client-side once per Bezahlen dialog
   * open. Sent UNCHANGED on every retry. The server's partial UNIQUE
   * INDEX guarantees at-most-once finalize: a lost-response retry
   * returns the original transaction row, not a duplicate.
   */
  idempotencyKey: string;
  stornoOfTransactionId?: string;
  notesInternal?: string;
  /**
   * Abholung einer Web-Reservierung (0099). Ist das gesetzt, finalisiert der
   * Server die web-gehaltenen Stücke (deren `reserved_by_user_id` NULL ist,
   * geschützt nur über den `reservationSessionId` je Position) und knüpft den
   * Warenkorb im selben BEGIN an diesen Beleg: `carts.status = CONVERTED`,
   * `pickup_stage = ABGEHOLT`, `collected_at = now()`. Steht die Bestellung
   * nicht mehr auf RESERVED, bricht der Server mit 409 ab, statt einen Beleg
   * auf eine tote Bestellung zu buchen. Fehlt das Feld, ist es ein ganz
   * normaler Kassenverkauf. Maximal 32 Zeichen (Server-Schema).
   */
  webOrderNumber?: string;
  /**
   * Die vom GERAET erfasste Vorgangszeit (0118), ISO 8601 mit Zeitzone.
   *
   * ⚠️ Sie muss ZUM ZEITPUNKT DES KASSIERENS festgehalten werden und in
   * derselben versiegelten Anfrage stehen, die vor dem Netz auf Platte geht.
   * Sonst traegt ein nachgespielter Vorgang wieder die Zeit des Nachspielens
   * — und landet im Z-Bon des falschen Tages.
   */
  erfasstAm?: string;
  /**
   * Der WAHRE Vorgangsbeginn (19.08.2026): wann das ERSTE Stueck in den Korb
   * kam, aus der Vorgangs-Uhr der Kasse. § 6 Satz 1 Nr. 2 KassenSichV will
   * Beginn UND Ende des Vorgangs; ohne dieses Feld waren beide identisch.
   * Optional: Wiederanlauf und Web-Abholung kennen den Beginn nicht.
   */
  vorgangBegonnenAm?: string;
  /**
   * Die Schicht, auf der WIRKLICH kassiert wurde (0118).
   *
   * Ohne sie sucht der Server sich zum Zeitpunkt des Eingangs „irgendeine
   * offene Schicht dieses Geraets" — beim Nachspielen also die falsche. Der
   * Server weist eine Schicht ab, die nicht zu diesem Geraet gehoert.
   */
  shiftId?: string;
}

export interface FinalizeResponse {
  id: string;
  receiptLocator: string;
  finalizedAt: string;
  ledgerEventId: number;
  direction: TransactionDirection;
  totalEur: string;
  storno: boolean;
  /** Die vom Geraet erfasste Vorgangszeit, so wie der Server sie aufzeichnete. */
  erfasstAm?: string | null;
  /**
   * Gesetzt, wenn der Kassentag dieses Vorgangs beim Eingang schon
   * abgeschlossen war. Der Vorgang ist dann auf dem LAUFENDEN Tag gebucht und
   * dieses Feld traegt den Tag, zu dem er gehoert. Die Kasse muss das zeigen.
   */
  nachtragBezugstag?: string | null;
  // 15.08.2026: hier stand `ohneTse`, die Ermahnung der geloeschten
  // Gnadenfrist von zehn Belegen. Ohne Sicherungseinrichtung weist der
  // Motor jeden Verkauf ab; es entsteht kein Beleg, der sie tragen koennte.
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/transactions/recent — last-24h VERKAUF sales for a late storno
// ────────────────────────────────────────────────────────────────────────

/** One recent VERKAUF sale (newest first, last 24h, capped at 30). */
export interface RecentTransactionItem {
  id: string;
  receiptLocator: string;
  totalEur: string;
  finalizedAt: string;
  /** TRUE when this row IS a storno reversal of an earlier sale. */
  isStorno: boolean;
  /** TRUE when this sale has already been reversed by a later storno. */
  alreadyStornoed: boolean;
}

export interface RecentTransactionsResponse {
  items: RecentTransactionItem[];
}

// ────────────────────────────────────────────────────────────────────────
// Ankauf — POST /api/transactions/ankauf (Day 8 dedicated route)
// ────────────────────────────────────────────────────────────────────────

export type AnkaufPayoutMethod = 'CASH' | 'BANK_TRANSFER';

export type AnkaufItemType =
  | 'gold_jewelry'
  | 'gold_coin'
  | 'gold_bar'
  | 'silver_jewelry'
  | 'silver_coin'
  | 'silver_bar'
  | 'platinum_jewelry'
  | 'platinum_coin'
  | 'platinum_bar'
  | 'antique'
  | 'watch'
  | 'other';

export type AnkaufMetal = 'gold' | 'silver' | 'platinum' | 'palladium';

export type AnkaufCondition =
  | 'NEW'
  | 'USED_EXCELLENT'
  | 'USED_GOOD'
  | 'USED_FAIR'
  | 'ANTIQUE_RESTORED'
  | 'ANTIQUE_AS_FOUND';

export interface AnkaufLineItem {
  sku: string;
  barcode?: string;
  itemType: AnkaufItemType;
  metal?: AnkaufMetal;
  karatCode?: string;
  finenessDecimal?: string;
  weightGrams?: string;
  hallmarkStamps?: string[];
  /** 0143: Seriennummer und Gravur des Stuecks (GwG). */
  seriennummer?: string;
  gravur?: string;
  condition: AnkaufCondition;
  taxTreatmentCode: TaxTreatmentCode;
  name: string;
  descriptionDe?: string;
  listPriceEur: string;
  /** The actual cash paid for this item. Becomes acquisition_cost_eur. */
  negotiatedPriceEur: string;
  /** TRUE → AVAILABLE on insert; FALSE → DRAFT (photo workflow first). */
  publishImmediately?: boolean;
  /** Optional client-side correlation id for matching the response back. */
  clientReferenceId?: string;
}

export interface AnkaufBody {
  /** REQUIRED. Database CHECK refuses null for ANKAUF. */
  customerId: string;
  payoutMethod: AnkaufPayoutMethod;
  /** REQUIRED when payoutMethod = BANK_TRANSFER; refused for CASH. */
  payoutExternalRef?: string;
  totalEur: string;
  notesInternal?: string;
  items: AnkaufLineItem[];
  /**
   * §19.2 C-4 — UUIDv4 generated client-side once per Ankauf-Bezahlen dialog
   * open. Sent UNCHANGED on every retry (double-click, step-up cancel-resume,
   * lost-response retry). The server persists it on `transactions` and the
   * partial UNIQUE INDEX (`transactions_idempotency_key_uniq`, migration 0028)
   * guarantees at-most-once: a duplicate returns the original Ankauf row, not a
   * second payout. Optional for back-compat with older clients (server treats
   * absence as "no dedup", pre-V1 behaviour).
   */
  idempotencyKey?: string;
}

export interface AnkaufResponseProduct {
  id: string;
  sku: string;
  status: 'DRAFT' | 'AVAILABLE';
  clientReferenceId: string | null;
}

export interface AnkaufResponse {
  transactionId: string;
  receiptLocator: string;
  finalizedAt: string;
  ledgerEventId: number;
  totalEur: string;
  payoutMethod: AnkaufPayoutMethod;
  createdProducts: AnkaufResponseProduct[];
}

// ────────────────────────────────────────────────────────────────────────
// TSE signature persistence — POST /api/transactions/:id/tse-signature
//
// GoBD / BSI TR-03153: the Fiskaly SIGN DE V2 signature must be recorded
// server-side, linked to the transaction. The POS calls this right after a
// successful finalize + TSE FINISH. Idempotent — one signature row per
// transaction; a duplicate returns the existing row with `created: false`.
// ────────────────────────────────────────────────────────────────────────

export interface TseSignatureBody {
  /** Fiskaly TSS module id (the signing TSS). */
  fiskalyTssId: string;
  /** Fiskaly client id (the POS register registered with the TSS). */
  fiskalyClientId: string;
  /** Fiskaly's TRANSACTION uuid, when the bridge surfaces it. */
  fiskalyTransactionId?: string;
  /** Monotonic per-TSS transaction number — decimal STRING (bigint-safe). */
  fiskalyTransactionNumber: string;
  /** Base64 signature value (printed on the receipt). */
  signatureValue: string;
  /** Monotonic per-TSS signature counter — decimal STRING (bigint-safe). */
  signatureCounter: string;
  /** Signature algorithm, e.g. 'ecdsa-plain-SHA256'. */
  signatureAlgorithm?: string;
  /**
   * Seriennummer der Sicherungseinrichtung — `TSE_SERIAL` in der `tse.csv`
   * des DSFinV-K-Auszugs. Ohne sie kann ein Prüfer eine Signatur keiner
   * Sicherungseinrichtung zuordnen.
   */
  tssSerialNumber?: string;
  /**
   * Öffentlicher Schlüssel der Sicherungseinrichtung (Base64) —
   * `TSE_PUBLIC_KEY`. Ohne ihn ist jede Signatur für einen Prüfer eine
   * Zeichenkette ohne Beweiswert.
   */
  signaturePublicKey?: string;
  /** KassenSichV process classification. */
  processType?: string;
  /** Receipt-ready QR code payload (BSI TR-03151). */
  qrCodeData?: string;
  /** When the TSE TRANSACTION started (Fiskaly-reported, ISO-8601). */
  tseStartTime?: string;
  /** When the TSE TRANSACTION finalized / was signed (Fiskaly-reported, ISO-8601). */
  tseEndTime?: string;
}

export interface TseSignatureResponse {
  /** ID of the tse_signatures evidence row. */
  id: string;
  /** The fiscal transaction the signature belongs to. */
  transactionId: string;
  /** TRUE when this POST created the row; FALSE on an idempotent no-op. */
  created: boolean;
  /** When the signature was recorded server-side (ISO-8601). */
  recordedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

export const transactionsApi = {
  finalize(client: ApiClient, body: FinalizeBody): Promise<FinalizeResponse> {
    // Fiscal ownership (ADR-0044 §4): forward the caller's key via meta.custom —
    // identical to `ankauf` below — so the sealed outbox row + Idempotency-Key
    // header carry the SAME key the body does. Without this the offline-queue
    // auto-generates a DIFFERENT key, and a queued-then-replayed finalize would
    // not dedup against the body's key (the direct-offline-enqueue asymmetry).
    return client.request<FinalizeResponse>('POST', '/api/transactions/finalize', body, {
      ...(body.idempotencyKey
        ? { custom: { idempotencyKey: body.idempotencyKey, gobdRelevant: true } }
        : {}),
    });
  },
  /**
   * Recent VERKAUF sales (last 24h, newest first, capped) so a mistaken ring
   * can be stornoed after the post-finalize screen was dismissed. CASHIER/ADMIN,
   * read-only — the storno itself is a separate step-up'd route.
   */
  recent(client: ApiClient): Promise<RecentTransactionsResponse> {
    return client.request<RecentTransactionsResponse>('GET', '/api/transactions/recent');
  },
  /**
   * Durably persist the KassenSichV TSE signature for a finalized transaction
   * (GoBD / BSI TR-03153). Idempotent — safe to retry.
   */
  recordTseSignature(
    client: ApiClient,
    transactionId: string,
    body: TseSignatureBody,
  ): Promise<TseSignatureResponse> {
    /*
     * ── ⛔ EIN STABILER SCHLUESSEL, SONST WAECHST DER AUSGANGSKORB ──────────
     *
     * DER BEFUND (Tiefenjagd 11.08.2026): dieser Aufruf reichte kein `custom`
     * weiter. Jeder gescheiterte Versuch bekam damit einen FRISCHEN
     * Idempotenzschluessel und legte eine EIGENE Zeile in den Ausgangskorb.
     * Gemessen mit echtem Klienten, echtem Mittelstueck und totem Transport:
     * 39 Versuche (das ist, was die echte Verzoegerungsstaffel in acht Stunden
     * ergibt) → 39 Zeilen, 39 verschiedene Schluessel.
     *
     * ── WARUM NICHT `skipOfflineQueue` ────────────────────────────────────
     *
     * Das waere der naheliegende Griff und er ist FALSCH: gemessen bleiben
     * dann null Zeilen. Der Ausgangskorb ist hier ein zweiter dauerhafter
     * Zustellweg fuer dieselbe idempotente Aufzeichnung; wer ihn abschaltet,
     * nimmt ein Netz weg, statt Muell zu vermeiden.
     *
     * ── WARUM DER STABILE SCHLUESSEL BEIDES LOEST ─────────────────────────
     *
     * `outbox_mutations.idempotency_key` ist UNIQUE und der Speicher schreibt
     * mit `INSERT OR IGNORE` (`outbox-store.ts`). Derselbe Schluessel heisst
     * also: EINE Zeile, egal wie oft es klingelt — und der zweite Zustellweg
     * bleibt bestehen. Gemessen: 39 Versuche → 1 Zeile; zehn Belege → zehn.
     *
     * Je Vorgang gibt es genau EIN Aufzeichnungs-Bein (der Server haelt
     * `tse_signatures_unique_per_transaction`), deshalb ist die Vorgangs-
     * kennung der richtige und einzige Bestandteil des Schluessels.
     *
     * ⚠️ Der Schluessel steht hier im WRAPPER und nicht an den vier
     * Aufrufstellen: eine fuenfte erbt den Schutz, ohne dass jemand daran
     * denken muss. Dieselbe Form benutzen `finalize` und `ankauf` darunter.
     */
    return client.request<TseSignatureResponse>(
      'POST',
      `/api/transactions/${transactionId}/tse-signature`,
      body,
      { custom: { idempotencyKey: `tse-sig:${transactionId}` } },
    );
  },
  ankauf(client: ApiClient, body: AnkaufBody): Promise<AnkaufResponse> {
    // Fiscal ownership (ADR-0044 §4): when the caller supplies an idempotency
    // key, hand it to the offline-queue middleware via meta.custom so the
    // sealed outbox row + Idempotency-Key header carry the SAME key the body
    // does — a queued-then-replayed Ankauf dedups against the original.
    return client.request<AnkaufResponse>('POST', '/api/transactions/ankauf', body, {
      ...(body.idempotencyKey
        ? { custom: { idempotencyKey: body.idempotencyKey, gobdRelevant: true } }
        : {}),
    });
  },
};
