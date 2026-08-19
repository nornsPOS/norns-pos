/**
 * document_category — six German document classes (migration 0023).
 *
 * Category-specific link semantics are enforced by CHECK constraints on
 * document_attachments — see the table comment for the full discipline.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const documentCategory = pgEnum('document_category', [
  'AUSWEIS', // ID document
  'ANKAUFBELEG', // Ankaufbeleg — we are the buyer
  'RECHNUNG', // Rechnung — we are the seller
  'EXPERTISE', // Bewertung / Gutachten
  'ZERTIFIKAT', // Echtheitszertifikat / hallmark certificate
  'VERSANDBELEG', // shipping document
]);

/**
 * Helper: which entity link is required (or permitted) per category.
 * Mirror of the SQL CHECKs — surfaced to TypeScript for route validators.
 */
export const CATEGORY_LINK_REQUIREMENTS = {
  AUSWEIS: { requires: ['customer'] as const, allows: ['customer'] as const },
  ANKAUFBELEG: { requires: [] as const, allows: ['customer', 'transaction'] as const },
  RECHNUNG: { requires: [] as const, allows: ['customer', 'transaction'] as const },
  EXPERTISE: { requires: [] as const, allows: ['appraisal', 'product'] as const },
  ZERTIFIKAT: {
    requires: [] as const,
    allows: ['customer', 'product', 'transaction', 'appraisal'] as const,
  },
  VERSANDBELEG: { requires: ['transaction'] as const, allows: ['transaction'] as const },
} as const;

export type DocumentLinkKind = 'customer' | 'product' | 'transaction' | 'appraisal';
