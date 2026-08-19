/**
 * belegtext_templates — append-only history of receipt/invoice legal texts
 * (migration 0024, Day 26).
 *
 * Workflow:
 *   1. UPDATE the existing CURRENT row (valid_to IS NULL) → SET valid_to = now()
 *   2. INSERT a new row with valid_to = NULL
 * Both in the same transaction. A partial UNIQUE index on
 * (kind, language) WHERE valid_to IS NULL guarantees exactly one CURRENT
 * row per (kind, language).
 *
 * NEVER DELETE — Finanzamt may audit which legal text printed on which
 * historical receipt.
 */

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryKey } from '../_shared/columns.js';
import { users } from '../auth/users.js';
import { belegtextKind } from './enums.js';

export const belegtextTemplates = pgTable(
  'belegtext_templates',
  {
    id: primaryKey(),
    kind: belegtextKind('kind').notNull(),
    language: text('language').notNull().default('de'),

    bodyText: text('body_text').notNull(),

    /** Versioning interval [valid_from, valid_to). valid_to IS NULL ⇒ CURRENT. */
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().default(sql`now()`),
    validTo: timestamp('valid_to', { withTimezone: true }),

    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    /** Exactly one CURRENT row per (kind, language). */
    oneCurrentPerKindLangUq: uniqueIndex('belegtext_one_current_per_kind_lang_uq')
      .on(table.kind, table.language)
      .where(sql`${table.validTo} IS NULL`),

    kindLanguageValidFromIdx: index('belegtext_kind_language_validfrom_idx').on(
      table.kind,
      table.language,
      table.validFrom.desc(),
    ),

    bodyLength: check('belegtext_body_length', sql`length(${table.bodyText}) BETWEEN 1 AND 4000`),
    languageFormat: check(
      'belegtext_language_format',
      sql`${table.language} ~ '^[a-z]{2}(-[A-Z]{2})?$'`,
    ),
    validRange: check(
      'belegtext_valid_range',
      sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),
  }),
);

export type BelegtextTemplate = typeof belegtextTemplates.$inferSelect;
export type NewBelegtextTemplate = typeof belegtextTemplates.$inferInsert;
