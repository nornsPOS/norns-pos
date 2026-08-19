/**
 * appointment_linked_products — many-to-many for VIEWING appointments.
 *
 * INSERT-only by app discipline. The AFTER INSERT trigger automatically
 * creates a SOFT hold in product_viewing_holds for VIEWING appointments
 * (per ADR-0016 §6 contract).
 */

import {
  primaryKey as drizzlePrimaryKey,
  index,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../auth/users.js';
import { products } from '../products/products.js';
import { appointments } from './appointments.js';

export const appointmentLinkedProducts = pgTable(
  'appointment_linked_products',
  {
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedByUserId: uuid('added_by_user_id').references(() => users.id),
  },
  (table) => ({
    pk: drizzlePrimaryKey({ columns: [table.appointmentId, table.productId] }),
    productIdx: index('appointment_linked_products_product_idx').on(table.productId),
  }),
);

export type AppointmentLinkedProduct = typeof appointmentLinkedProducts.$inferSelect;
export type NewAppointmentLinkedProduct = typeof appointmentLinkedProducts.$inferInsert;
