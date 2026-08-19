/**
 * product_categories — M:N join between products and categories.
 *
 * Composite PK = (product_id, category_id). `is_primary` partial UNIQUE
 * (`product_categories_one_primary_uq WHERE is_primary = TRUE`) enforces
 * exactly one primary category per product at the DB level.
 *
 * ON DELETE CASCADE on the product side — when a product row is hard-
 * deleted (rare; archived_at is the soft path), its category memberships
 * disappear with it. ON DELETE RESTRICT on the category side prevents
 * accidental orphaning of products.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { products } from '../products/products.js';
import { categories } from './categories.js';

export const productCategories = pgTable(
  'product_categories',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),

    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.productId, table.categoryId] }),
    categoryIdx: index('product_categories_category_idx').on(table.categoryId),
    onePrimaryUq: uniqueIndex('product_categories_one_primary_uq')
      .on(table.productId)
      .where(sql`is_primary = TRUE`),
  }),
);

export type ProductCategory = typeof productCategories.$inferSelect;
export type NewProductCategory = typeof productCategories.$inferInsert;
