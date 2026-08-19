/**
 * TypeBox schemas for GET /api/customers (search + list).
 *
 * Day-8 additive. The frozen Day-17 customers route ships only by-id reads;
 * a search endpoint is added here to power the Day-8 Ankauf customer-lookup
 * UX and the future Tier-1 Kunden surface (Day 10).
 *
 * Projection deliberately omits encrypted PII columns we don't need at list
 * time. Email + phone are exposed only via blind-index match (the query
 * succeeds or fails — we never decrypt the columns of non-matched rows).
 * Full name IS decrypted for matched rows (the operator needs it to confirm
 * "yes this is the customer in front of me"). Decrypt happens inside the
 * `withPii` envelope — same key-management discipline as the by-id route.
 */

import { type Static, Type } from '@sinclair/typebox';

export const CustomerListQuery = Type.Object({
  /**
   * Free-text query. The route attempts these match strategies:
   *   1. exact `email_blind_index = blind_index(q)` if `q` contains `@`
   *   2. if `q` matches `/^[+\d\s().-]{5,}$/`: exact `phone_blind_index =
   *      blind_index(q)` OR partial `customer_number ILIKE` (a typed-out
   *      numeric Kundennummer must resolve, not dead-end on the phone index)
   *   3. else: ILIKE on decrypted full_name OR partial `customer_number ILIKE`
   *      (so `CUST-2026-000006`, `CUST`, `2026` resolve the way the UI promises)
   * Order: indexed matches first, fuzzy second.
   */
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),

  /** Only customers with KYC verified — useful for the Ankauf high-value flow filter. */
  kycVerifiedOnly: Type.Optional(Type.Boolean()),

  /** Only customers NOT marked as sanctions or banned. */
  excludeBlocked: Type.Optional(Type.Boolean()),

  /**
   * Gelöschte Konten MITZEIGEN, durchgestrichen statt verschwunden.
   *
   * Standard ist `false`, und zwar bewusst: die Kundenauswahl beim Verkauf und
   * beim Ankauf ruft dieselbe Liste, und dort darf ein gelöschtes Konto NICHT
   * wählbar sein. Nur die Kundenliste selbst setzt die Flagge, weil dort die
   * Frage „was ist mit diesem Menschen passiert" berechtigt ist.
   *
   * Die Zeile bleibt sowieso erhalten (Anonymisierung, keine Löschung), es
   * ging bisher nur niemandem mehr etwas an. Kundennummer und Umsätze bleiben
   * unangetastet — §147 AO verlangt sie, und ohne sie stimmt keine Auswertung.
   */
  includeErased: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});
export type CustomerListQuery = Static<typeof CustomerListQuery>;

export const CustomerListRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  customerNumber: Type.String(),
  /** Decrypted under withPii — never persisted client-side. */
  fullName: Type.String(),
  /** Status of legal-document KYC (Day-7 enum). */
  kycStatus: Type.Union([
    Type.Literal('NOT_REQUIRED'),
    Type.Literal('PENDING'),
    Type.Literal('CAPTURED'),
    Type.Literal('VERIFIED'),
    Type.Literal('EXPIRED'),
    Type.Literal('REJECTED'),
  ]),
  /** Owner's eyeball-verification timestamp (Day-26 column). */
  kycVerifiedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** Operator-set business-trust level (Day-26 enum). */
  trustLevel: Type.Union([
    Type.Literal('NEW'),
    Type.Literal('VERIFIED'),
    Type.Literal('VIP'),
    Type.Literal('SUSPICIOUS'),
    Type.Literal('BANNED'),
  ]),
  sanctionsMatch: Type.Boolean(),
  /**
   * §15 GwG — politically exposed person. NOT a block like a sanctions hit;
   * the picker shows it so the operator meets the enhanced-due-diligence signal
   * before selecting the customer, not only inside the detail file.
   */
  pepMatch: Type.Boolean(),
  cumulativeAnkaufEur: Type.String(),
  cumulativeSpendEur: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  /** Wann gelöscht wurde, sonst NULL. Trägt den Durchstrich in der Liste. */
  deletedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /**
   * WER gelöscht hat: CUSTOMER heisst, der Mensch hat es selbst getan.
   * Genau das wollte Basel sehen können, statt dass beide Fälle gleich
   * aussehen. NULL solange nichts gelöscht wurde.
   */
  erasureInitiatedBy: Type.Union([
    Type.Literal('CUSTOMER'),
    Type.Literal('STAFF'),
    Type.Null(),
  ]),
});
export type CustomerListRow = Static<typeof CustomerListRow>;

export const CustomerListResponse = Type.Object({
  items: Type.Array(CustomerListRow),
  total: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 1 }),
  offset: Type.Integer({ minimum: 0 }),
  hasMore: Type.Boolean(),
});
export type CustomerListResponse = Static<typeof CustomerListResponse>;
