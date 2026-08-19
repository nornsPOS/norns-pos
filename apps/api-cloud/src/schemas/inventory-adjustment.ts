/**
 * TypeBox schemas for POST /api/products/:id/inventory-adjustment (Day 9).
 *
 * Single endpoint for ALL low-touch inventory mutations the Lager surface
 * performs: physical location change, lost/damaged flagging, recovered-found,
 * free-text operator notes. Every reason writes to `audit_log`; physical
 * relocations also update `products.location_*` columns. Status flips for
 * LOST/DAMAGED land in Phase 1.5 #I-45 (additive enum value); V1 records
 * the audit but leaves `products.status` untouched (see memory.md §13.4).
 */

import { type Static, Type } from '@sinclair/typebox';

export const InventoryAdjustmentReason = Type.Union(
  [
    Type.Literal('LOCATION_CHANGE'),
    Type.Literal('LOST'),
    Type.Literal('DAMAGED'),
    Type.Literal('FOUND'),
    Type.Literal('OPERATOR_NOTE'),
  ],
  {
    description:
      'LOCATION_CHANGE: physical relocation (Tresor → Vitrine). LOST: item missing. ' +
      'DAMAGED: physically broken. FOUND: reverses a prior LOST. OPERATOR_NOTE: ' +
      'narrative observation, no state effect.',
  },
);
export type InventoryAdjustmentReason = Static<typeof InventoryAdjustmentReason>;

export const InventoryAdjustmentBody = Type.Object({
  reason: InventoryAdjustmentReason,
  /** Mandatory operator rationale. Persisted in audit_log forever. */
  notes: Type.String({ minLength: 8, maxLength: 1024 }),
  /** Only meaningful for reason='LOCATION_CHANGE'. */
  locationStorageUnit: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  locationDrawer: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  locationPosition: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});
export type InventoryAdjustmentBody = Static<typeof InventoryAdjustmentBody>;

export const InventoryAdjustmentResponse = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  reason: InventoryAdjustmentReason,
  auditLogId: Type.String({ format: 'uuid' }),
  loggedAt: Type.String({ format: 'date-time' }),
  /** Echoed when LOCATION_CHANGE — the new location after the update. */
  locationStorageUnit: Type.Union([Type.String(), Type.Null()]),
  locationDrawer: Type.Union([Type.String(), Type.Null()]),
  locationPosition: Type.Union([Type.String(), Type.Null()]),
});
export type InventoryAdjustmentResponse = Static<typeof InventoryAdjustmentResponse>;
