/**
 * product_photos — per-product photo metadata + 5-stage workflow state.
 *
 * Bytes live in Cloudflare R2 (ADR-0005). The DB carries only the R2 object
 * key + presentation metadata. Photos are media, NOT fiscal records — the
 * app role has DELETE permission here (the photo audit trail is not legally
 * required; the inventory audit trail is).
 *
 * Day-24 (migration 0022) introduced the photo lifecycle:
 *   FOTOGRAFIERT → BEARBEITET → FREIGESTELLT → ZUGEORDNET → FUER_EBAY_BEREIT
 * with two side conditions enforced by DB CHECK:
 *   • workflow_state ≥ ZUGEORDNET  ⇒  product_id IS NOT NULL
 *   • workflow_state ≥ FREIGESTELLT ⇒  r2_key_bg_removed IS NOT NULL
 *
 * Consequence: `product_id` is now NULLABLE — a freshly-shot photo can land
 * without an assigned product yet. The previous "one primary per product"
 * partial UNIQUE is rescoped to non-NULL product_id only.
 *
 * `is_primary = TRUE` is enforced exactly-once-per-product via a partial
 * unique index (rescoped in migration 0022).
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { users } from '../auth/users.js';
import { photoSource, photoWorkflowState } from './enums.js';
import { products } from './products.js';

export const productPhotos = pgTable(
  'product_photos',
  {
    id: primaryKey(),
    /**
     * NULLABLE since migration 0022 — a photo can exist before being assigned
     * to a product. CHECK `product_photos_assigned_state_has_product` enforces
     * that `workflow_state IN ('ZUGEORDNET','FUER_EBAY_BEREIT')` ⇒ NOT NULL.
     */
    productId: uuid('product_id').references(() => products.id),

    r2Key: text('r2_key').notNull(),
    r2KeyBgRemoved: text('r2_key_bg_removed'),

    /**
     * Where the bytes live (migration 0051). `'r2'` = legacy Cloudflare R2
     * (the default keeps every pre-0051 row valid); `'local'` = the
     * server-side local store (compressed WebP under PHOTOS_DIR). For local
     * rows, `r2Key` doubles as the on-disk base id.
     */
    storageKind: text('storage_kind').notNull().default('r2'),
    /** Compressed MAIN webp size — the unit the 20 GiB cap counts. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /** Compressed THUMB webp size (informational). */
    thumbBytes: bigint('thumb_bytes', { mode: 'number' }),
    /** MAIN image pixel dimensions after the ≤1600px resize. */
    width: integer('width'),
    height: integer('height'),
    /** Stored MIME type — always 'image/webp' for the local store. */
    contentType: text('content_type'),

    displayOrder: smallint('display_order').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),

    source: photoSource('source').notNull().default('intake'),
    altTextDe: text('alt_text_de'),
    altTextEn: text('alt_text_en'),

    // Day-24 workflow lifecycle (migration 0022)
    workflowState: photoWorkflowState('workflow_state').notNull().default('FOTOGRAFIERT'),
    workflowChangedAt: timestamp('workflow_changed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    workflowChangedByUserId: uuid('workflow_changed_by_user_id').references(() => users.id),

    ...timestamps(),
  },
  (table) => ({
    productIdIdx: index('product_photos_product_id_idx').on(table.productId, table.displayOrder),
    /** One primary per product — orphans (NULL product_id) are excluded. */
    onePrimaryPerProductUq: uniqueIndex('product_photos_one_primary_per_product_uq')
      .on(table.productId)
      .where(sql`${table.isPrimary} = TRUE AND ${table.productId} IS NOT NULL`),

    workflowStateIdx: index('product_photos_workflow_state_idx').on(
      table.workflowState,
      table.workflowChangedAt.desc(),
    ),
    unassignedIdx: index('product_photos_unassigned_idx')
      .on(table.workflowState, table.createdAt.desc())
      .where(sql`${table.productId} IS NULL`),

    /** Cheap SUM(size_bytes) over the local store for the usage gauge + cap. */
    localSizeIdx: index('product_photos_local_size_idx')
      .on(table.storageKind)
      .where(sql`${table.storageKind} = 'local'`),

    // CHECK constraints landed by migration 0022.
    assignedStateHasProduct: check(
      'product_photos_assigned_state_has_product',
      sql`${table.workflowState} NOT IN ('ZUGEORDNET','FUER_EBAY_BEREIT')
          OR ${table.productId} IS NOT NULL`,
    ),
    bgRemovedStateHasKey: check(
      'product_photos_bg_removed_state_has_key',
      sql`${table.workflowState} NOT IN ('FREIGESTELLT','ZUGEORDNET','FUER_EBAY_BEREIT')
          OR ${table.r2KeyBgRemoved} IS NOT NULL`,
    ),
    orphanNotPrimary: check(
      'product_photos_orphan_not_primary',
      sql`${table.productId} IS NOT NULL OR ${table.isPrimary} = FALSE`,
    ),
    storageKindChk: check(
      'product_photos_storage_kind_chk',
      sql`${table.storageKind} IN ('r2','local')`,
    ),
  }),
);

export type ProductPhoto = typeof productPhotos.$inferSelect;
export type NewProductPhoto = typeof productPhotos.$inferInsert;
