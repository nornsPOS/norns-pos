/**
 * Shared German display labels for a product's lifecycle status.
 *
 * Single source for every operator-facing surface (Lager table, product
 * sheet, intake drafts). If a label ever needs to differ per surface,
 * branch HERE — not at the call site — so the surfaces stay drift-free.
 */

import type { ProductListRow } from '@norns/api-client';

export type ProductStatus = ProductListRow['status'];

export const PRODUCT_STATUS_LABEL: Readonly<Record<ProductStatus, string>> = Object.freeze({
  DRAFT: 'Entwurf',
  AVAILABLE: 'Verfügbar',
  RESERVED: 'Reserviert',
  SOLD: 'Verkauft',
});

export const PRODUCT_STATUS_COLOR: Readonly<Record<ProductStatus, string>> = Object.freeze({
  // AVAILABLE = sage (positive). Gold is decorative-only (§10.2), never a text colour.
  DRAFT: 'var(--w14-ink-faded)',
  AVAILABLE: 'var(--w14-verdigris)',
  RESERVED: 'var(--w14-ink-aged)',
  SOLD: 'var(--w14-ink-faded)',
});
