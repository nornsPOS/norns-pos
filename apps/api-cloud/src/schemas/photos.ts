/**
 * TypeBox schemas for the photo-workflow API surface (Phase 2 Day 2,
 * closing the route gap from Day 24 migration 0022).
 *
 * State machine: FOTOGRAFIERT → BEARBEITET → FREIGESTELLT → ZUGEORDNET → FUER_EBAY_BEREIT
 * Only neighbour-states are accepted (no jumps); the route's transition
 * table is the single source of truth and `product_photo_workflow_events`
 * is the append-only audit trail.
 */

import { type Static, Type } from '@sinclair/typebox';

const PHOTO_WORKFLOW_STATE = Type.Union([
  Type.Literal('FOTOGRAFIERT'),
  Type.Literal('BEARBEITET'),
  Type.Literal('FREIGESTELLT'),
  Type.Literal('ZUGEORDNET'),
  Type.Literal('FUER_EBAY_BEREIT'),
]);

const PHOTO_SOURCE = Type.Union([
  Type.Literal('intake'),
  Type.Literal('admin_upload'),
  Type.Literal('storefront_user'),
  Type.Literal('photographer'),
  Type.Literal('phone_intake'),
]);

// ────────────────────────────────────────────────────────────────────────
// POST /api/photos — register a photo after R2 upload
// ────────────────────────────────────────────────────────────────────────

export const CreatePhotoBody = Type.Object({
  r2Key: Type.String({ minLength: 1, maxLength: 1024 }),
  /** Optional — only set when the photo is born already-assigned (rare). */
  productId: Type.Optional(Type.String({ format: 'uuid' })),
  source: Type.Optional(PHOTO_SOURCE),
  altTextDe: Type.Optional(Type.String({ maxLength: 500 })),
  altTextEn: Type.Optional(Type.String({ maxLength: 500 })),
});

export const PhotoRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  productId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  r2Key: Type.String(),
  /** 'local' = served by this api from disk; 'r2' = legacy Cloudflare R2. */
  storageKind: Type.Optional(Type.Union([Type.Literal('local'), Type.Literal('r2')])),
  /** Public URL the POS / storefront renders the photo from. */
  publicUrl: Type.Optional(Type.String()),
  /** Compressed thumbnail URL (local-store rows only). */
  thumbUrl: Type.Optional(Type.String()),
  /** MAIN image dimensions + compressed size (local-store rows). */
  width: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  sizeBytes: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  r2KeyBgRemoved: Type.Union([Type.String(), Type.Null()]),
  displayOrder: Type.Integer(),
  isPrimary: Type.Boolean(),
  source: PHOTO_SOURCE,
  altTextDe: Type.Union([Type.String(), Type.Null()]),
  altTextEn: Type.Union([Type.String(), Type.Null()]),
  workflowState: PHOTO_WORKFLOW_STATE,
  workflowChangedAt: Type.String({ format: 'date-time' }),
  workflowChangedByUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/photos/:id/workflow-state
// ────────────────────────────────────────────────────────────────────────

export const PhotoIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const TransitionPhotoStateBody = Type.Object({
  toState: PHOTO_WORKFLOW_STATE,
  /**
   * Required when transitioning to FREIGESTELLT (we need the background-
   * removed R2 key for the CHECK constraint to be satisfied). Optional
   * otherwise.
   */
  r2KeyBgRemoved: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  /**
   * Required when transitioning to ZUGEORDNET (the photo must be assigned
   * to a product). Ignored at later states (already assigned).
   */
  productId: Type.Optional(Type.String({ format: 'uuid' })),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/products/:id/photos?workflow_state=
// ────────────────────────────────────────────────────────────────────────

export const ProductPhotosQuery = Type.Object({
  workflowState: Type.Optional(PHOTO_WORKFLOW_STATE),
});

export const ProductPhotosResponse = Type.Object({
  items: Type.Array(PhotoRow),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/photos/unassigned — orphan photos pre-ZUGEORDNET
// ────────────────────────────────────────────────────────────────────────

export const UnassignedPhotosQuery = Type.Object({
  workflowState: Type.Optional(PHOTO_WORKFLOW_STATE),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const UnassignedPhotosResponse = Type.Object({
  items: Type.Array(PhotoRow),
  total: Type.Integer(),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/photos/usage — local store gauge for the owner
// ────────────────────────────────────────────────────────────────────────

export const PhotoStoreUsageResponse = Type.Object({
  /** Bytes currently used by the local store (SUM of MAIN webp sizes). */
  usedBytes: Type.Integer(),
  /** Hard cap (PHOTO_STORE_MAX_BYTES). */
  maxBytes: Type.Integer(),
  /** Number of local-store photos. */
  count: Type.Integer(),
});

export type TCreatePhotoBody = Static<typeof CreatePhotoBody>;
export type TPhotoIdParams = Static<typeof PhotoIdParams>;
export type TTransitionPhotoStateBody = Static<typeof TransitionPhotoStateBody>;
export type TProductPhotosQuery = Static<typeof ProductPhotosQuery>;
export type TUnassignedPhotosQuery = Static<typeof UnassignedPhotosQuery>;

// ────────────────────────────────────────────────────────────────────────
// State-machine table (single source of truth)
// ────────────────────────────────────────────────────────────────────────

export const ALLOWED_PHOTO_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  FOTOGRAFIERT: ['BEARBEITET'],
  BEARBEITET: ['FREIGESTELLT', 'FOTOGRAFIERT'], // step-back permitted
  FREIGESTELLT: ['ZUGEORDNET', 'BEARBEITET'],
  ZUGEORDNET: ['FUER_EBAY_BEREIT', 'FREIGESTELLT'],
  FUER_EBAY_BEREIT: ['ZUGEORDNET'], // un-publish path
};
