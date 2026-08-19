/**
 * TypeBox schemas for the POS inventory endpoints (Day 15).
 *
 *   POST /api/inventory/reserve   — AVAILABLE → RESERVED (race-safe)
 *   POST /api/inventory/release   — RESERVED  → AVAILABLE (session-id-guarded)
 *
 * Wire surface mirrors `@norns/inventory-lock` types but with strict
 * shapes for Ajv to enforce on the request boundary. The route layer
 * forwards validated bodies into the package.
 */

import { type Static, Type } from '@sinclair/typebox';

// ────────────────────────────────────────────────────────────────────────
// Channel — Day 15 exposes POS only via this API. Storefront + eBay live
// in their own services (server-to-server, separate auth).
// ────────────────────────────────────────────────────────────────────────

const ChannelEnum = Type.Union([
  Type.Literal('POS'),
  Type.Literal('STOREFRONT'),
  Type.Literal('EBAY'),
]);

// ────────────────────────────────────────────────────────────────────────
// Release reason — mirrors @norns/inventory-lock ReleaseReason.
// ────────────────────────────────────────────────────────────────────────

const ReleaseReasonEnum = Type.Union([
  Type.Literal('storefront_checkout_abandoned'),
  Type.Literal('storefront_payment_failed'),
  Type.Literal('ebay_offer_rejected'),
  Type.Literal('pos_cart_cleared'),
  Type.Literal('admin_manual_release'),
]);

// ────────────────────────────────────────────────────────────────────────
// POST /api/inventory/reserve
// ────────────────────────────────────────────────────────────────────────

export const ReserveBody = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  channel: ChannelEnum,
  /**
   * Caller-generated UUID for traceability + idempotency. The same sessionId
   * must be supplied on the matching release()/finalize() call.
   */
  sessionId: Type.String({ format: 'uuid' }),
});
export type ReserveBody = Static<typeof ReserveBody>;

export const ReserveResponse = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  channel: ChannelEnum,
  sessionId: Type.String({ format: 'uuid' }),
  userId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  reservedAt: Type.String({ format: 'date-time' }),
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});
export type ReserveResponse = Static<typeof ReserveResponse>;

// ────────────────────────────────────────────────────────────────────────
// POST /api/inventory/release
// ────────────────────────────────────────────────────────────────────────

export const ReleaseBody = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  /** Must match `reserved_by_session_id` on the row — guards cross-session release. */
  sessionId: Type.String({ format: 'uuid' }),
  reason: ReleaseReasonEnum,
});
export type ReleaseBody = Static<typeof ReleaseBody>;

export const ReleaseResponse = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  releasedAt: Type.String({ format: 'date-time' }),
  reason: ReleaseReasonEnum,
});
export type ReleaseResponse = Static<typeof ReleaseResponse>;

// ────────────────────────────────────────────────────────────────────────
// POST /api/inventory/release/batch — teardown-survivable batch release.
//
// Fired from the POS `beforeunload` via navigator.sendBeacon, which cannot set
// headers, so the session token rides in the body as `accessToken` (P1.4). One
// transaction releases every item; a per-item ownership mismatch is reported in
// `failedProductIds`, never aborting the rest. `maxItems` caps abuse + keeps the
// fetch-keepalive fallback under its 64KB body limit.
// ────────────────────────────────────────────────────────────────────────

const ReleaseBatchItem = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  sessionId: Type.String({ format: 'uuid' }),
});

export const ReleaseBatchBody = Type.Object({
  items: Type.Array(ReleaseBatchItem, { minItems: 1, maxItems: 64 }),
  reason: ReleaseReasonEnum,
  /** Session token for sendBeacon (no Authorization header possible). */
  accessToken: Type.Optional(Type.String({ minLength: 1 })),
});
export type ReleaseBatchBody = Static<typeof ReleaseBatchBody>;

export const ReleaseBatchResponse = Type.Object({
  releasedProductIds: Type.Array(Type.String({ format: 'uuid' })),
  failedProductIds: Type.Array(Type.String({ format: 'uuid' })),
});
export type ReleaseBatchResponse = Static<typeof ReleaseBatchResponse>;
