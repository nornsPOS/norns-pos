/**
 * product_photo_workflow_events — append-only audit trail of every
 * product_photos.workflow_state transition (migration 0022).
 *
 * NEVER DELETE. The forensic surface for Owner reviews ("show me every
 * step Photo X went through, by whom, in order").
 *
 * Insertion is idempotent at the application layer (route writes the event
 * inside the same TX as the photo UPDATE) — there is no UPSERT here, and a
 * no-op transition (from_state == to_state) is refused by CHECK.
 */

import { sql } from 'drizzle-orm';
import { bigserial, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from '../auth/users.js';
import { photoWorkflowState } from './enums.js';
import { productPhotos } from './productPhotos.js';

export const productPhotoWorkflowEvents = pgTable(
  'product_photo_workflow_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    productPhotoId: uuid('product_photo_id')
      .notNull()
      .references(() => productPhotos.id),
    /** NULL for the initial INSERT into product_photos (no prior state). */
    fromState: photoWorkflowState('from_state'),
    toState: photoWorkflowState('to_state').notNull(),
    changedByUserId: uuid('changed_by_user_id')
      .notNull()
      .references(() => users.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    photoIdx: index('photo_workflow_events_photo_idx').on(
      table.productPhotoId,
      table.createdAt.desc(),
    ),
    stateChange: check(
      'photo_workflow_events_state_change',
      sql`${table.fromState} IS NULL OR ${table.fromState} <> ${table.toState}`,
    ),
  }),
);

export type ProductPhotoWorkflowEvent = typeof productPhotoWorkflowEvents.$inferSelect;
export type NewProductPhotoWorkflowEvent = typeof productPhotoWorkflowEvents.$inferInsert;
