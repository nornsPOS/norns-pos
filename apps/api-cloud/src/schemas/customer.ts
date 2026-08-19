/**
 * TypeBox schemas for Customer Management (Day 17).
 *
 *   POST   /api/customers                   — create with encrypted PII
 *   GET    /api/customers/:id               — read with decrypted PII (ADMIN)
 *   GET    /api/customers/:id/products      — Ankauf history
 *   GET    /api/customers/:id/transactions  — sales history
 *
 * PII discipline (Day 12b RED LINE): the PUT body carries plaintext; the
 * route layer wraps every encrypt/decrypt inside `withPii(...)`. The
 * connection returns to the pool with no `warehouse14.pii_key` set.
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString } from './money.js';

const Iso2Lang = Type.Union([Type.Literal('de'), Type.Literal('en'), Type.Literal('ar')]);

// Mirrors the live `kyc_status` Postgres enum exactly (see customer-list.ts and
// packages/api-client customers.ts). The lifecycle is
// PENDING → CAPTURED (Ausweis erfasst) → VERIFIED (geprüft), with EXPIRED/REJECTED
// as terminal states. The earlier COMPLETED/FAILED pair never existed in the DB;
// listing it here made Fastify's response serializer reject every CAPTURED/
// VERIFIED/REJECTED customer with a 500, taking down the whole Kunde detail screen.
const KycStatus = Type.Union([
  Type.Literal('NOT_REQUIRED'),
  Type.Literal('PENDING'),
  Type.Literal('CAPTURED'),
  Type.Literal('VERIFIED'),
  Type.Literal('EXPIRED'),
  Type.Literal('REJECTED'),
]);

// ────────────────────────────────────────────────────────────────────────
// POST /api/customers
// ────────────────────────────────────────────────────────────────────────

export const CreateCustomerBody = Type.Object({
  fullName: Type.String({ minLength: 1, maxLength: 256 }),
  dateOfBirth: Type.Optional(Type.String({ format: 'date', description: 'ISO YYYY-MM-DD' })),
  email: Type.Optional(Type.String({ format: 'email', maxLength: 320 })),
  phone: Type.Optional(Type.String({ minLength: 4, maxLength: 32 })),
  address: Type.Optional(Type.String({ maxLength: 1024 })),
  notes: Type.Optional(Type.String({ maxLength: 4096 })),
  preferredLanguage: Type.Optional(Iso2Lang),
  vatId: Type.Optional(Type.String({ minLength: 4, maxLength: 32 })),
  customerTags: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 32 })),
  /** Years to retain post-last-activity (GDPR Art. 5). Defaults to 5y. */
  retentionYears: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 5 })),
});
export type CreateCustomerBody = Static<typeof CreateCustomerBody>;

export const CreateCustomerResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  customerNumber: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});
export type CreateCustomerResponse = Static<typeof CreateCustomerResponse>;

// ────────────────────────────────────────────────────────────────────────
// PUT /api/customers/:id — Day 10 additive
//
// Step-up REQUIRED when the customer's kyc_verified_at IS NOT NULL (the
// Owner has previously stamped this customer; rewriting PII could mask
// a sanctions match or alter the audit chain). Enforced server-side.
// ────────────────────────────────────────────────────────────────────────

export const UpdateCustomerBody = Type.Object({
  fullName: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  dateOfBirth: Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),
  email: Type.Optional(Type.Union([Type.String({ format: 'email', maxLength: 320 }), Type.Null()])),
  phone: Type.Optional(Type.Union([Type.String({ minLength: 4, maxLength: 32 }), Type.Null()])),
  address: Type.Optional(Type.Union([Type.String({ maxLength: 1024 }), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
  vatId: Type.Optional(Type.Union([Type.String({ minLength: 4, maxLength: 32 }), Type.Null()])),
  preferredLanguage: Type.Optional(Iso2Lang),
  customerTags: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 32 })),
});
export type UpdateCustomerBody = Static<typeof UpdateCustomerBody>;

export const UpdateCustomerResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  /** Field names that actually changed — for audit_log + UI confirmation toast. */
  changedFields: Type.Array(Type.String()),
  /** True when the route required + checked step-up (customer was KYC-verified). */
  stepUpEnforced: Type.Boolean(),
});
export type UpdateCustomerResponse = Static<typeof UpdateCustomerResponse>;

// ────────────────────────────────────────────────────────────────────────
// GET /api/customers/:id
// ────────────────────────────────────────────────────────────────────────

const CustomerTrustLevel = Type.Union([
  Type.Literal('NEW'),
  Type.Literal('VERIFIED'),
  Type.Literal('VIP'),
  Type.Literal('SUSPICIOUS'),
  Type.Literal('BANNED'),
]);

export const CustomerDetailResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  customerNumber: Type.String(),
  fullName: Type.String(),
  dateOfBirth: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  email: Type.Union([Type.String(), Type.Null()]),
  phone: Type.Union([Type.String(), Type.Null()]),
  address: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  vatId: Type.Union([Type.String(), Type.Null()]),
  preferredLanguage: Iso2Lang,
  customerTags: Type.Array(Type.String()),
  kycStatus: KycStatus,
  kycCompletedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** Day-26 column: Owner's eyeball-verification stamp. Surfaced by the
   *  Day-8 Ankauf surface for the GwG-threshold gate. */
  kycVerifiedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** Day-26 column: operator-set business-trust level. */
  trustLevel: CustomerTrustLevel,
  sanctionsMatch: Type.Boolean(),
  pepMatch: Type.Boolean(),
  cumulativeSpendEur: DecimalString,
  cumulativeAnkaufEur: DecimalString,
  cumulativeDebtEur: DecimalString,
  /**
   * §10 GwG aggregation context: the sum of this customer's ANKAUF buys inside
   * the configured rolling window (the smurfing window), so the POS KYC gate can
   * require ID when the running window crosses the threshold even if the current
   * buy is under it. `priorAnkaufEur` excludes the cart being built now.
   */
  gwgRollingAnkauf: Type.Object({
    windowDays: Type.Integer(),
    priorAnkaufEur: DecimalString,
  }),
  retentionUntil: Type.String({ format: 'date' }),
  createdAt: Type.String({ format: 'date-time' }),
  /**
   * How this customer came to exist — derived from the linked storefront
   * `shoppers` row (if any): GOOGLE (Google sign-in), EMAIL (online e-mail
   * sign-up), or IN_STORE (created at the counter, no online account).
   * `online` is true whenever a shopper row exists (a self-service webshop
   * account), regardless of method.
   */
  registration: Type.Object({
    method: Type.Union([
      Type.Literal('GOOGLE'),
      Type.Literal('EMAIL'),
      Type.Literal('IN_STORE'),
    ]),
    online: Type.Boolean(),
  }),
  /**
   * Gesetzt, wenn dieser Datensatz ein Grabstein ist: das Konto wurde gelöscht
   * (DSGVO Art. 17), die personenbezogenen Daten sind fort, die Kundennummer
   * und der Fiskalbezug bleiben nach § 147 AO erhalten. Nur sichtbar, wenn das
   * Personal ausdrücklich `includeDeleted` anfragt; sonst ist die Zeile wie
   * bisher nicht auffindbar. So sieht der Laden „dieses Konto wurde gelöscht",
   * statt dass die Zeile spurlos verschwindet.
   */
  deletedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /**
   * WER die Löschung veranlasst hat (0103). CUSTOMER heisst: der Mensch hat
   * sein Konto SELBST gelöscht, das war seine Entscheidung. STAFF heisst: wir
   * haben es getan, und das ist unsere Handlung, die nachweisbar sein muss
   * (DSGVO Art. 5 Abs. 2). NULL solange nichts gelöscht wurde.
   *
   * Ohne dieses Feld sähen beide Fälle in der Akte gleich aus, und die Fläche
   * müsste raten oder schweigen.
   */
  erasureInitiatedBy: Type.Union([
    Type.Literal('CUSTOMER'),
    Type.Literal('STAFF'),
    Type.Null(),
  ]),
});
export type CustomerDetailResponse = Static<typeof CustomerDetailResponse>;

// ────────────────────────────────────────────────────────────────────────
// GET /api/customers/:id/products — Ankauf history (products we bought from)
// ────────────────────────────────────────────────────────────────────────

export const CustomerProductRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  sku: Type.String(),
  status: Type.String(),
  name: Type.String(),
  acquisitionCostEur: DecimalString,
  listPriceEur: DecimalString,
  createdAt: Type.String({ format: 'date-time' }),
  soldAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});
export type CustomerProductRow = Static<typeof CustomerProductRow>;

export const CustomerProductsResponse = Type.Object({
  items: Type.Array(CustomerProductRow),
  /**
   * 15.08.2026 (0.6.0 Spur E): Gesamtzahl ÜBER dem 500er-Deckel der Liste.
   * Die Kundenakte las `total` seit jeher — der Motor sandte es nie, und
   * Fastify hätte es ohne diese Schemazeile ohnehin still gestrichen. Die
   * Kachel zeigte darum „0 Stücke" über echten Zeilen.
   */
  total: Type.Integer(),
});
export type CustomerProductsResponse = Static<typeof CustomerProductsResponse>;

// ────────────────────────────────────────────────────────────────────────
// GET /api/customers/:id/transactions — sales history
// ────────────────────────────────────────────────────────────────────────

export const CustomerTransactionRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  direction: Type.Union([Type.Literal('VERKAUF'), Type.Literal('ANKAUF')]),
  totalEur: DecimalString,
  taxTreatmentCode: Type.String(),
  receiptLocator: Type.String(),
  /** Where the order came from — Kasse (POS), Onlineshop (WEB), eBay, Telefon. */
  salesChannel: Type.Union([
    Type.Literal('POS'),
    Type.Literal('WEB'),
    Type.Literal('EBAY'),
    Type.Literal('PHONE'),
  ]),
  finalizedAt: Type.String({ format: 'date-time' }),
  stornoOfTransactionId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
});
export type CustomerTransactionRow = Static<typeof CustomerTransactionRow>;

export const CustomerTransactionsResponse = Type.Object({
  items: Type.Array(CustomerTransactionRow),
  /** Gesamtzahl ÜBER dem 200er-Deckel — siehe CustomerProductsResponse. */
  total: Type.Integer(),
});
export type CustomerTransactionsResponse = Static<typeof CustomerTransactionsResponse>;
