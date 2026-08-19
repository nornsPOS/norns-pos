/**
 * document_attachments — PDFs / images / scans pinned to ONE business
 * entity (migration 0023, Day 25).
 *
 * Bytes live in R2 (ADR-0005). DB carries the R2 key + minimal metadata
 * + a polymorphic link enforced by CHECK to point at exactly ONE of:
 *   customer / product / transaction / appraisal.
 *
 * Category-specific link discipline (enforced in SQL):
 *   AUSWEIS       ⇒ customer_id NOT NULL
 *   VERSANDBELEG  ⇒ transaction_id NOT NULL
 *   EXPERTISE     ⇒ appraisal_id OR product_id NOT NULL
 *   ANKAUFBELEG   ⇒ customer_id OR transaction_id NOT NULL
 *   RECHNUNG      ⇒ customer_id OR transaction_id NOT NULL
 *   ZERTIFIKAT    ⇒ any link (least restrictive)
 *
 * Soft-delete via archived_at — never hard-delete (evidentiary).
 */

import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryKey } from '../_shared/columns.js';
import { appraisals } from '../appraisals/index.js';
import { users } from '../auth/users.js';
import { customers } from '../customers/customers.js';
import { products } from '../products/products.js';
import { transactions } from '../transactions/transactions.js';
import { documentCategory } from './enums.js';

export const documentAttachments = pgTable(
  'document_attachments',
  {
    id: primaryKey(),
    category: documentCategory('category').notNull(),

    r2Key: text('r2_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    sha256Hex: text('sha256_hex'),

    customerId: uuid('customer_id').references(() => customers.id),
    productId: uuid('product_id').references(() => products.id),
    transactionId: uuid('transaction_id').references(() => transactions.id),
    appraisalId: uuid('appraisal_id').references(() => appraisals.id),

    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id),
    notes: text('notes'),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    customerIdx: index('document_attachments_customer_idx')
      .on(table.customerId, table.category, table.createdAt.desc())
      .where(sql`${table.customerId} IS NOT NULL AND ${table.archivedAt} IS NULL`),
    productIdx: index('document_attachments_product_idx')
      .on(table.productId, table.category, table.createdAt.desc())
      .where(sql`${table.productId} IS NOT NULL AND ${table.archivedAt} IS NULL`),
    transactionIdx: index('document_attachments_transaction_idx')
      .on(table.transactionId, table.category, table.createdAt.desc())
      .where(sql`${table.transactionId} IS NOT NULL AND ${table.archivedAt} IS NULL`),
    appraisalIdx: index('document_attachments_appraisal_idx')
      .on(table.appraisalId, table.category, table.createdAt.desc())
      .where(sql`${table.appraisalId} IS NOT NULL AND ${table.archivedAt} IS NULL`),
    categoryIdx: index('document_attachments_category_idx')
      .on(table.category, table.createdAt.desc())
      .where(sql`${table.archivedAt} IS NULL`),

    r2KeyLength: check(
      'document_attachments_r2_key_length',
      sql`length(${table.r2Key}) BETWEEN 1 AND 1024`,
    ),
    fileNameLength: check(
      'document_attachments_file_name_length',
      sql`length(${table.fileName}) BETWEEN 1 AND 255`,
    ),
    mimeTypeLength: check(
      'document_attachments_mime_type_length',
      sql`length(${table.mimeType}) BETWEEN 1 AND 255`,
    ),
    sizePositive: check('document_attachments_size_positive', sql`${table.sizeBytes} > 0`),
    sha256Format: check(
      'document_attachments_sha256_format',
      sql`${table.sha256Hex} IS NULL OR length(${table.sha256Hex}) = 64`,
    ),

    exactlyOneLink: check(
      'document_attachments_exactly_one_link',
      sql`(
        (${table.customerId} IS NOT NULL)::int
        + (${table.productId} IS NOT NULL)::int
        + (${table.transactionId} IS NOT NULL)::int
        + (${table.appraisalId} IS NOT NULL)::int
      ) = 1`,
    ),
    ausweisIsCustomer: check(
      'document_attachments_ausweis_is_customer',
      sql`${table.category} <> 'AUSWEIS' OR ${table.customerId} IS NOT NULL`,
    ),
    versandbelegIsTransaction: check(
      'document_attachments_versandbeleg_is_transaction',
      sql`${table.category} <> 'VERSANDBELEG' OR ${table.transactionId} IS NOT NULL`,
    ),
    expertiseLink: check(
      'document_attachments_expertise_link',
      sql`${table.category} <> 'EXPERTISE'
          OR (${table.appraisalId} IS NOT NULL OR ${table.productId} IS NOT NULL)`,
    ),
    ankaufbelegLink: check(
      'document_attachments_ankaufbeleg_link',
      sql`${table.category} <> 'ANKAUFBELEG'
          OR (${table.customerId} IS NOT NULL OR ${table.transactionId} IS NOT NULL)`,
    ),
    rechnungLink: check(
      'document_attachments_rechnung_link',
      sql`${table.category} <> 'RECHNUNG'
          OR (${table.customerId} IS NOT NULL OR ${table.transactionId} IS NOT NULL)`,
    ),
  }),
);

export type DocumentAttachment = typeof documentAttachments.$inferSelect;
export type NewDocumentAttachment = typeof documentAttachments.$inferInsert;
