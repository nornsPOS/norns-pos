/**
 * TypeBox schemas for POST /api/transactions/ankauf — Day-8 additive.
 *
 * This is the dedicated Ankauf write path. The existing Verkauf
 * `POST /api/transactions/finalize` calls `inventoryFinalize()` (RESERVED →
 * SOLD) for every line — that has no meaning for Ankauf, where the
 * products are CREATED in the same transaction. Keeping the routes
 * separate preserves Verkauf invariants and avoids a union-typed line schema.
 *
 * Request body shape:
 *   • header — customerId (REQUIRED by DB CHECK), payoutMethod, total + audit notes
 *   • items[] — one entry per item being bought, each carrying enough fields
 *     to INSERT a products row and the negotiated cash price (= the
 *     product's acquisition_cost_eur AND the transaction_items line_total)
 *
 * Server enforces:
 *   • sanctions hard-block (BEFORE INSERT trigger, migration 0013 C-2)
 *   • Ankauf-requires-customer (CHECK, migration 0013 C-1)
 *   • closing-day refusal (BEFORE INSERT trigger, migration 0013 C-3)
 *   • balance equality at COMMIT (CONSTRAINT TRIGGER, migration 0016)
 *   • Σ items.negotiatedPriceEur === header.totalEur (client-side math echo)
 *   • requireStepUp when totalEur ≥ TRANSACTION_STEP_UP_THRESHOLD_EUR
 *   • requireRole('ADMIN', 'CASHIER')
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString, WeightString } from './money.js';
import { CreateProductBody as ProductCreateFields } from './product.js';

// ────────────────────────────────────────────────────────────────────────
// Payout method — V1 ships CASH + BANK_TRANSFER (matches transaction_payments
// enum). ZVT card / SumUp are nonsensical for Ankauf (we PAY OUT, not in)
// and are deliberately omitted.
// ────────────────────────────────────────────────────────────────────────

export const AnkaufPayoutMethod = Type.Union(
  [Type.Literal('CASH'), Type.Literal('BANK_TRANSFER')],
  { description: 'Cash drawer outflow OR bank-transfer outflow.' },
);
export type AnkaufPayoutMethod = Static<typeof AnkaufPayoutMethod>;

// ────────────────────────────────────────────────────────────────────────
// Per-line — embeds the CreateProductBody fields the operator captures at
// intake, plus negotiated price. The Ankauf route inserts a `products` row
// with these fields and a `transaction_items` row with line_total_eur =
// negotiatedPriceEur.
//
// Intake-locked fields the operator does NOT set per line (route fills them):
//   • acquiredFromCustomerId  — comes from header.customerId
//   • status                  — derived from publishImmediately
//   • acquisitionCostEur      — = negotiatedPriceEur (mirrored by the route)
// ────────────────────────────────────────────────────────────────────────

export const AnkaufLineItem = Type.Object({
  // Inventory shape — every field the operator captures + intake-lockable
  sku: Type.String({ minLength: 1, maxLength: 64 }),
  barcode: Type.Optional(Type.String({ maxLength: 64 })),
  itemType: ProductCreateFields.properties.itemType,
  metal: Type.Optional(ProductCreateFields.properties.metal),
  karatCode: Type.Optional(Type.String({ maxLength: 16 })),
  finenessDecimal: Type.Optional(ProductCreateFields.properties.finenessDecimal),
  weightGrams: Type.Optional(WeightString),
  hallmarkStamps: Type.Array(Type.String({ maxLength: 64 }), { default: [], maxItems: 16 }),
  /** 0143: Seriennummer (GwG-Zuordnung des Stuecks, Uhr: Gehaeuse oder Werk). */
  seriennummer: Type.Optional(Type.String({ maxLength: 64 })),
  /** 0143: Gravur woertlich. */
  gravur: Type.Optional(Type.String({ maxLength: 256 })),
  condition: ProductCreateFields.properties.condition,
  taxTreatmentCode: ProductCreateFields.properties.taxTreatmentCode,
  name: Type.String({ minLength: 1, maxLength: 256 }),
  descriptionDe: Type.Optional(Type.String({ maxLength: 8192 })),
  listPriceEur: DecimalString,

  /** The actual cash price the operator paid. Becomes the product's
   *  acquisition_cost_eur and the transaction_item's line_total. */
  negotiatedPriceEur: DecimalString,

  /**
   * TRUE → product lands as `status='AVAILABLE'` with `published_at=now()`.
   * FALSE → product lands as `status='DRAFT'` for later publish (e.g. after
   * photo workflow). Operator-controlled per item.
   */
  publishImmediately: Type.Boolean({ default: true }),

  /** Optional client-supplied UUID for idempotency / matching to UI store. */
  clientReferenceId: Type.Optional(Type.String({ format: 'uuid' })),
});
export type AnkaufLineItem = Static<typeof AnkaufLineItem>;

// ────────────────────────────────────────────────────────────────────────
// Header / body
// ────────────────────────────────────────────────────────────────────────

export const AnkaufBody = Type.Object({
  /** REQUIRED. Sanctions + KYC depend on this. Database CHECK refuses null. */
  customerId: Type.String({ format: 'uuid' }),

  /** Cash outflow OR bank-transfer outflow. */
  payoutMethod: AnkaufPayoutMethod,

  /** External reference for bank-transfer payouts (transfer number, etc.).
   *  REQUIRED when payoutMethod = BANK_TRANSFER, refused otherwise (route-level). */
  payoutExternalRef: Type.Optional(Type.String({ maxLength: 256 })),

  /** Σ items.negotiatedPriceEur — client declares, server re-verifies. */
  totalEur: DecimalString,

  /** Free-text operator note. Persisted in transactions.notes_internal. */
  notesInternal: Type.Optional(Type.String({ maxLength: 1024 })),

  /**
   * §19.2 C-4 — client-supplied UUID for at-most-once Ankauf. Persisted on
   * `transactions.idempotency_key`; the partial UNIQUE INDEX
   * (`transactions_idempotency_key_uniq`, migration 0028) makes a duplicate
   * POST return the original payout instead of booking a second one. Optional
   * for back-compat — absent ⇒ no dedup (pre-V1 behaviour).
   */
  idempotencyKey: Type.Optional(Type.String({ format: 'uuid' })),

  items: Type.Array(AnkaufLineItem, { minItems: 1, maxItems: 100 }),
});
export type AnkaufBody = Static<typeof AnkaufBody>;

// ────────────────────────────────────────────────────────────────────────
// Response
// ────────────────────────────────────────────────────────────────────────

export const AnkaufResponse = Type.Object({
  transactionId: Type.String({ format: 'uuid' }),
  receiptLocator: Type.String(),
  finalizedAt: Type.String({ format: 'date-time' }),
  ledgerEventId: Type.Integer({ description: 'monotonic id of the emitted ledger_events row.' }),
  totalEur: DecimalString,
  payoutMethod: AnkaufPayoutMethod,

  /** The freshly-created product rows, in the same order the items arrived. */
  createdProducts: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      sku: Type.String(),
      status: Type.Union([Type.Literal('DRAFT'), Type.Literal('AVAILABLE')]),
      /** Echo the optional clientReferenceId so the client can match to its store entry. */
      clientReferenceId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    }),
  ),
});
export type AnkaufResponse = Static<typeof AnkaufResponse>;
