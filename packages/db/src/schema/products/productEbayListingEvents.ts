/**
 * product_ebay_listing_events — append-only audit trail of every
 * products.ebay_state transition (migration 0022).
 *
 * Source distinguishes OWNER manual flips from EBAY_WEBHOOK pushes (Phase
 * 1.5) and WORKER reconciler updates (#36). SYSTEM is reserved for trigger-
 * driven internal transitions (currently none, kept for forward compat).
 *
 * NEVER DELETE. The forensic surface for resolving conflicts ("eBay says
 * VERKAUFT, cashier says SOLD — who flipped what when?").
 */

import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../auth/users.js';
import { ebayListingState } from './enums.js';
import { products } from './products.js';

export const productEbayListingEvents = pgTable(
  'product_ebay_listing_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** NULL when the product is being listed for the first time. */
    fromState: ebayListingState('from_state'),
    toState: ebayListingState('to_state').notNull(),
    /** Required when source = 'OWNER'. CHECK enforces this. */
    changedByUserId: uuid('changed_by_user_id').references(() => users.id),
    /** 'OWNER' | 'EBAY_WEBHOOK' | 'WORKER' | 'SYSTEM' — enforced by CHECK. */
    changedBySource: text('changed_by_source').notNull(),
    /** Optional eBay order id for VERKAUFT and subsequent rows. */
    ebayOrderId: text('ebay_order_id'),
    notes: text('notes'),
    /** Raw provider envelope when source = 'EBAY_WEBHOOK', metadata otherwise. */
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    productIdx: index('ebay_events_product_idx').on(table.productId, table.createdAt.desc()),
    orderIdx: index('ebay_events_order_idx')
      .on(table.ebayOrderId)
      .where(sql`${table.ebayOrderId} IS NOT NULL`),

    stateChange: check(
      'ebay_events_state_change',
      sql`${table.fromState} IS NULL OR ${table.fromState} <> ${table.toState}`,
    ),
    knownSource: check(
      'ebay_events_known_source',
      sql`${table.changedBySource} IN ('OWNER','EBAY_WEBHOOK','WORKER','SYSTEM')`,
    ),
    ownerHasUser: check(
      'ebay_events_owner_has_user',
      sql`${table.changedBySource} <> 'OWNER' OR ${table.changedByUserId} IS NOT NULL`,
    ),
    payloadIsObject: check(
      'ebay_events_payload_object',
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
  }),
);

export type ProductEbayListingEvent = typeof productEbayListingEvents.$inferSelect;
export type NewProductEbayListingEvent = typeof productEbayListingEvents.$inferInsert;
