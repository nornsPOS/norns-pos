/**
 * Shared display labels for `TaxTreatmentCode`.
 *
 * Single source for every operator-facing surface (cart row, checkout
 * dialog, error toasts). If a label ever needs to be translated or
 * abbreviated differently per surface, branch HERE — not at the call
 * site. That way the surfaces stay drift-free.
 */

import type { TaxTreatmentCode } from '@norns/api-client';

export const TAX_TREATMENT_LABEL: Readonly<Record<TaxTreatmentCode, string>> = Object.freeze({
  STANDARD_19: '19 %',
  REDUCED_7: '7 %',
  MARGIN_25A: '§ 25a',
  INVESTMENT_GOLD_25C: '§ 25c',
  REVERSE_CHARGE_13B: '§ 13b',
  MIXED: 'Mischung',
});
