/**
 * belegtext_kind — discriminator for receipt/invoice legal-text blocks
 * (migration 0024, Day 26).
 *
 * The first four mirror tax_treatment_codes; the last four are universal
 * blocks rendered on every receipt regardless of tax treatment.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const belegtextKind = pgEnum('belegtext_kind', [
  'MARGIN_25A', // §25a Differenzbesteuerung
  'STANDARD_19', // §12 Abs. 1 UStG (19%)
  'REDUCED_7', // §12 Abs. 2 UStG (7%)
  'INVESTMENT_GOLD_25C', // §25c UStG (Anlagegold)
  'KLEINUNTERNEHMER_19', // §19 UStG small-business exemption (future)
  'ANKAUFBELEG_DECLARATION', // GwG § 8 identity-recording declaration
  'GENERIC_HEADER',
  'GENERIC_FOOTER',
  'REVERSE_CHARGE_13B',
]);

/**
 * Mapping from tax_treatment_codes.code to belegtext_kind enum values.
 * Single source of truth for both the resolver SQL function and the route
 * validators.
 */
export const TAX_TREATMENT_TO_BELEGTEXT_KIND = {
  MARGIN_25A: 'MARGIN_25A',
  STANDARD_19: 'STANDARD_19',
  REDUCED_7: 'REDUCED_7',
  INVESTMENT_GOLD_25C: 'INVESTMENT_GOLD_25C',
  REVERSE_CHARGE_13B: 'REVERSE_CHARGE_13B',
} as const;
