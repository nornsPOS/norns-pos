/**
 * appraisals/ — Bewertungs-/Expertisen-Modul (Day 22, migration 0020).
 *
 * Pre-Ankauf valuation workflow for estates / Konvolute. The route layer
 * runs pro-rata cost allocation at ACCEPTED so §25a margin tax stays correct
 * per item across a lump-sum buyback.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../auth/users.js';
import { customers } from '../customers/customers.js';
import { itemType } from '../products/enums.js';
import { productCondition } from '../products/enums.js';
import { products } from '../products/products.js';
import { karatGrades } from '../reference/karatGrades.js';
import { transactions } from '../transactions/transactions.js';

export const appraisalStatus = pgEnum('appraisal_status', [
  'DRAFT',
  'COMPLETED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
]);

export const appraisals = pgTable(
  'appraisals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    appraisedByUserId: uuid('appraised_by_user_id')
      .notNull()
      .references(() => users.id),

    status: appraisalStatus('status').notNull().default('DRAFT'),

    totalAppraisedEur: numeric('total_appraised_eur', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    totalOfferedEur: numeric('total_offered_eur', { precision: 18, scale: 2 }),
    customerExpectationEur: numeric('customer_expectation_eur', { precision: 18, scale: 2 }),

    ankaufTransactionId: uuid('ankauf_transaction_id').references(() => transactions.id),

    notes: text('notes'),

    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().default(sql`now()`),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    customerIdx: index('appraisals_customer_idx').on(table.customerId, table.openedAt.desc()),
    statusOpenedIdx: index('appraisals_status_opened_idx').on(table.status, table.openedAt.desc()),
    ankaufTxIdx: uniqueIndex('appraisals_ankauf_tx_idx')
      .on(table.ankaufTransactionId)
      .where(sql`${table.ankaufTransactionId} IS NOT NULL`),

    completedHasTimestamp: check(
      'appraisals_completed_has_timestamp',
      sql`${table.status} NOT IN ('COMPLETED', 'ACCEPTED', 'REJECTED') OR ${table.completedAt} IS NOT NULL`,
    ),
    acceptedHasEvidence: check(
      'appraisals_accepted_has_evidence',
      sql`${table.status} <> 'ACCEPTED' OR (
        ${table.acceptedAt} IS NOT NULL AND
        ${table.ankaufTransactionId} IS NOT NULL AND
        ${table.totalOfferedEur} IS NOT NULL
      )`,
    ),
    rejectedHasTimestamp: check(
      'appraisals_rejected_has_timestamp',
      sql`${table.status} <> 'REJECTED' OR ${table.rejectedAt} IS NOT NULL`,
    ),
    rejectedHasReason: check(
      'appraisals_rejected_has_reason',
      sql`${table.status} <> 'REJECTED' OR ${table.rejectionReason} IS NOT NULL`,
    ),
  }),
);

export type Appraisal = typeof appraisals.$inferSelect;
export type NewAppraisal = typeof appraisals.$inferInsert;

export const appraisalItems = pgTable(
  'appraisal_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    appraisalId: uuid('appraisal_id')
      .notNull()
      .references(() => appraisals.id),
    sequenceInLot: integer('sequence_in_lot').notNull().default(0),

    name: text('name').notNull(),
    description: text('description'),
    itemType: itemType('item_type').notNull(),
    metal: text('metal'),
    karatCode: text('karat_code').references(() => karatGrades.code),
    finenessDecimal: numeric('fineness_decimal', { precision: 5, scale: 4 }),
    weightGrams: numeric('weight_grams', { precision: 10, scale: 4 }),
    condition: productCondition('condition'),
    hallmarkStamps: text('hallmark_stamps').array().notNull().default(sql`'{}'`),

    /** 0143: bei der Bewertung abgelesene Seriennummer. NULL: traegt keine. */
    seriennummer: text('seriennummer'),
    /** 0143: Gravur woertlich (Widmung, Initialen). NULL: keine. */
    gravur: text('gravur'),

    individualAppraisedEur: numeric('individual_appraised_eur', {
      precision: 18,
      scale: 2,
    }).notNull(),

    photoR2Keys: text('photo_r2_keys').array().notNull().default(sql`'{}'`),
    notes: text('notes'),

    productId: uuid('product_id').references(() => products.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    appraisalIdx: index('appraisal_items_appraisal_idx').on(table.appraisalId, table.sequenceInLot),
    productIdx: index('appraisal_items_product_idx')
      .on(table.productId)
      .where(sql`${table.productId} IS NOT NULL`),
  }),
);

export type AppraisalItem = typeof appraisalItems.$inferSelect;
export type NewAppraisalItem = typeof appraisalItems.$inferInsert;
