/**
 * categories — 2-level hierarchical taxonomy (migration 0025, Day 13).
 *
 * Self-referencing FK (`parent_id`) with a BEFORE INSERT/UPDATE trigger
 * (`enforce_no_grandparent_category`) capping the depth at 2. ON DELETE
 * RESTRICT both ways — categories don't disappear silently while products
 * reference them.
 *
 * Updatable from the app role on every column except `id`. Slug uniqueness
 * is global (no per-language slugs in V1; the same slug serves both
 * languages — names diverge, URLs don't).
 */

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';

export const categories = pgTable(
  'categories',
  {
    id: primaryKey(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),

    slug: text('slug').notNull(),
    nameDe: text('name_de').notNull(),
    nameEn: text('name_en'),
    descriptionDe: text('description_de'),
    descriptionEn: text('description_en'),

    schemaOrgType: text('schema_org_type'),

    displayOrder: integer('display_order').notNull().default(0),
    hiddenFromStorefront: boolean('hidden_from_storefront').notNull().default(false),

    ...timestamps(),
  },
  (table) => ({
    slugUq: uniqueIndex('categories_slug_uq').on(table.slug),
    parentIdx: index('categories_parent_idx').on(table.parentId),
    displayOrderIdx: index('categories_display_order_idx').on(
      table.parentId,
      table.displayOrder,
      table.nameDe,
    ),

    slugFormat: check('categories_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    noSelfParent: check('categories_no_self_parent', sql`${table.id} <> ${table.parentId}`),
  }),
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
