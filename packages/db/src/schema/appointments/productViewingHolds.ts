/**
 * product_viewing_holds — soft (or HARD) holds on products tied to an appointment.
 *
 * Consumed by @norns/inventory-lock.reserve() to surface to the cashier
 * (ADR-0016 §6). Created automatically by the AFTER INSERT trigger on
 * appointment_linked_products. NEVER deleted — released via release_at + reason.
 */

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryKey } from '../_shared/columns.js';
import { customers } from '../customers/customers.js';
import { products } from '../products/products.js';
import { appointments } from './appointments.js';

export const productViewingHolds = pgTable(
  'product_viewing_holds',
  {
    id: primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id),
    customerId: uuid('customer_id').references(() => customers.id),
    holdStrength: text('hold_strength').notNull().default('SOFT'),
    holdStartsAt: timestamp('hold_starts_at', { withTimezone: true }).notNull(),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedReason: text('released_reason'),
  },
  (table) => ({
    activeIdx: index('product_viewing_holds_active_idx')
      .on(table.productId, table.holdExpiresAt)
      .where(sql`${table.releasedAt} IS NULL`),
    appointmentIdx: index('product_viewing_holds_appointment_idx').on(table.appointmentId),

    range: check(
      'product_viewing_holds_range',
      sql`${table.holdExpiresAt} > ${table.holdStartsAt}`,
    ),
    strengthDomain: check(
      'product_viewing_holds_strength_domain',
      sql`${table.holdStrength} IN ('SOFT', 'HARD')`,
    ),
    releasedHasReason: check(
      'product_viewing_holds_released_has_reason',
      sql`(${table.releasedAt} IS NULL) = (${table.releasedReason} IS NULL)`,
    ),
  }),
);

export type ProductViewingHold = typeof productViewingHolds.$inferSelect;
export type NewProductViewingHold = typeof productViewingHolds.$inferInsert;
