/**
 * tax_treatment_codes — German tax treatment categories (BMF-derived).
 *
 * Lookup table chosen over PG enum so BMF can add categories via migration
 * row INSERT, no ALTER TYPE required (ADR-0008 §4).
 *
 * READ-ONLY for the app role (Basel Day-3 directive 2026-05-24). Reference
 * updates land via migration only.
 *
 * Seeded codes (migration 0005):
 *   • MARGIN_25A          — §25a UStG (per-margin scheme, rate NULL)
 *   • INVESTMENT_GOLD_25C — §25c UStG (VAT-exempt, rate 0.0000)
 *   • STANDARD_19         — §12 Abs. 1 UStG (rate 0.1900)
 *   • REDUCED_7           — §12 Abs. 2 UStG (rate 0.0700)
 */

import { sql } from 'drizzle-orm';
import { boolean, check, index, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const taxTreatmentCodes = pgTable(
  'tax_treatment_codes',
  {
    code: text('code').primaryKey(),
    descriptionDe: text('description_de').notNull(),
    descriptionEn: text('description_en').notNull(),

    /**
     * Scalar VAT rate applied to gross sale (0.1900 → 19%).
     * `null` → per-margin scheme (§25a) — the checkout pipeline calls the
     *           margin calculator instead of applying a flat rate.
     * `0`    → exempt (§25c investment gold).
     */
    effectiveVatRate: numeric('effective_vat_rate', { precision: 5, scale: 4 }),
    legalReference: text('legal_reference').notNull(),

    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rateRange: check(
      'tax_treatment_codes_rate_range',
      sql`${table.effectiveVatRate} IS NULL OR (${table.effectiveVatRate} >= 0.0000 AND ${table.effectiveVatRate} <= 1.0000)`,
    ),
    codeFormat: check('tax_treatment_codes_code_format', sql`${table.code} ~ '^[A-Z][A-Z0-9_]*$'`),
    activeIdx: index('tax_treatment_codes_active_idx')
      .on(table.active)
      .where(sql`${table.active} = TRUE`),
  }),
);

export type TaxTreatmentCode = typeof taxTreatmentCodes.$inferSelect;
export type NewTaxTreatmentCode = typeof taxTreatmentCodes.$inferInsert;
