/**
 * hallmarks — visual stamp → (metal, fineness) lookup.
 *
 * Vision OCR (intake pipeline, ADR-0015) reads a hallmark stamp like
 * "585" or "925" and queries this table by (metal, stamp). Disambiguation
 * by metal is required because `999` appears on gold (Feingold), silver
 * (Feinsilber) AND platinum (Feinplatin).
 *
 * Standards:
 *   Gold      — DIN 17760: 333, 585, 750, 916, 999
 *   Silver    — DIN 17742: 800, 835, 925, 950, 999
 *   Platinum  — DIN 17745: 850, 900, 950, 999
 *   Palladium —            500, 950, 999
 *
 * READ-ONLY for the app role (Basel Day-3 directive).
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';

export const hallmarks = pgTable(
  'hallmarks',
  {
    id: primaryKey(),
    stamp: text('stamp').notNull(), // '333', '585', '925', etc.
    metal: text('metal').notNull(), // 'gold' | 'silver' | 'platinum' | 'palladium'
    finenessPer1000: smallint('fineness_per_1000').notNull(),
    finenessDecimal: numeric('fineness_decimal', { precision: 5, scale: 4 }).notNull(),
    descriptionDe: text('description_de').notNull(),
    descriptionEn: text('description_en').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (table) => ({
    metalStampUq: unique('hallmarks_metal_stamp_uq').on(table.metal, table.stamp),
    metalDomain: check(
      'hallmarks_metal_check',
      sql`${table.metal} IN ('gold', 'silver', 'platinum', 'palladium')`,
    ),
    finenessRange: check(
      'hallmarks_fineness_range',
      sql`${table.finenessPer1000} BETWEEN 1 AND 1000`,
    ),
    decimalRange: check(
      'hallmarks_decimal_range',
      sql`${table.finenessDecimal} > 0 AND ${table.finenessDecimal} <= 1.0000`,
    ),
    decimalMatchesPerMille: check(
      'hallmarks_decimal_matches_per_mille',
      sql`ABS(${table.finenessDecimal} - (${table.finenessPer1000}::numeric / 1000)) < 0.00005`,
    ),
    metalIdx: index('hallmarks_metal_idx').on(table.metal).where(sql`${table.active} = TRUE`),
    stampIdx: index('hallmarks_stamp_idx').on(table.stamp).where(sql`${table.active} = TRUE`),
  }),
);

export type Hallmark = typeof hallmarks.$inferSelect;
export type NewHallmark = typeof hallmarks.$inferInsert;
