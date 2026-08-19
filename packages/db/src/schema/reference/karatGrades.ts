/**
 * karat_grades — gold-only karat → fineness lookup (DIN 17760).
 *
 * Used by:
 *   • intake pipeline (ADR-0015): when Vision reports `karat_visible`,
 *     this is the canonical decimal fineness for price calculations.
 *   • pricing engine: gold weight × fineness_decimal × LBMA spot → spot value.
 *
 * Fineness is stored in BOTH forms — `fineness_per_1000` (integer, German
 * hallmark convention) and `fineness_decimal` (NUMERIC(5,4), for arithmetic).
 * A DB-level CHECK enforces consistency between them.
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
  timestamp,
} from 'drizzle-orm/pg-core';

export const karatGrades = pgTable(
  'karat_grades',
  {
    code: text('code').primaryKey(), // '8K', '14K', '18K', '22K', '24K'
    karatValue: smallint('karat_value').notNull().unique(), // 8, 14, 18, 22, 24
    finenessPer1000: smallint('fineness_per_1000').notNull().unique(), // 333, 585, 750, 916, 999
    finenessDecimal: numeric('fineness_decimal', { precision: 5, scale: 4 }).notNull().unique(), // 0.3330, 0.5850, 0.7500, 0.9160, 0.9990
    hallmarkStamp: text('hallmark_stamp').notNull().unique(), // '333', '585', etc.
    displayLabelDe: text('display_label_de').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeFormat: check('karat_grades_code_format', sql`${table.code} ~ '^[0-9]{1,2}K$'`),
    valueRange: check('karat_grades_value_range', sql`${table.karatValue} BETWEEN 1 AND 24`),
    finenessRange: check(
      'karat_grades_fineness_range',
      sql`${table.finenessPer1000} BETWEEN 1 AND 999`,
    ),
    decimalRange: check(
      'karat_grades_decimal_range',
      sql`${table.finenessDecimal} > 0 AND ${table.finenessDecimal} <= 1.0000`,
    ),
    decimalMatchesPerMille: check(
      'karat_grades_decimal_matches_per_mille',
      sql`ABS(${table.finenessDecimal} - (${table.finenessPer1000}::numeric / 1000)) < 0.00005`,
    ),
    activeIdx: index('karat_grades_active_idx')
      .on(table.karatValue)
      .where(sql`${table.active} = TRUE`),
  }),
);

export type KaratGrade = typeof karatGrades.$inferSelect;
export type NewKaratGrade = typeof karatGrades.$inferInsert;
