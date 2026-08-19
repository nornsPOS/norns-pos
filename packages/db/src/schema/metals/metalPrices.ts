/**
 * metal_prices — append-only Edelmetallkurs history (migration 0021).
 *
 * Workflow:
 *   1. UPDATE the existing CURRENT row (valid_to IS NULL) → SET valid_to = now()
 *   2. INSERT a new row with valid_to = NULL
 * Both in the same transaction. A partial UNIQUE index on (metal) WHERE
 * valid_to IS NULL guarantees exactly one CURRENT row per metal.
 *
 * NEVER DELETE — forensic audit + DSFinV-K context.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../auth/users.js';
import { workerJobRuns } from '../worker/workerJobRuns.js';
import { metalPriceSource } from './enums.js';

export const metalPrices = pgTable(
  'metal_prices',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),

    metal: text('metal').notNull(),
    pricePerGramEur: numeric('price_per_gram_eur', { precision: 15, scale: 4 }).notNull(),
    source: metalPriceSource('source').notNull(),

    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().default(sql`now()`),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().default(sql`now()`),
    validTo: timestamp('valid_to', { withTimezone: true }),

    sourcePayload: jsonb('source_payload').notNull().default(sql`'{}'::jsonb`),

    /** When source = MANUAL: who + why. NULL otherwise. */
    manualOverrideByUserId: uuid('manual_override_by_user_id').references(() => users.id),
    manualOverrideReason: text('manual_override_reason'),

    /** When source = LBMA / XAUEUR_VENDOR: which worker_job_runs row produced this. */
    fetchedByJobRunId: bigint('fetched_by_job_run_id', { mode: 'bigint' }).references(
      () => workerJobRuns.id,
    ),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    /** Exactly one CURRENT row per metal. */
    oneCurrentPerMetalUq: uniqueIndex('metal_prices_one_current_per_metal_uq')
      .on(table.metal)
      .where(sql`${table.validTo} IS NULL`),

    metalValidFromIdx: index('metal_prices_metal_validfrom_idx').on(
      table.metal,
      table.validFrom.desc(),
    ),
    sourceFetchedIdx: index('metal_prices_source_fetched_idx').on(
      table.source,
      table.fetchedAt.desc(),
    ),

    metalDomain: check(
      'metal_prices_metal_check',
      sql`${table.metal} IN ('gold','silver','platinum','palladium')`,
    ),
    pricePositive: check(
      'metal_prices_price_per_gram_eur_check',
      sql`${table.pricePerGramEur} > 0`,
    ),
    validRange: check(
      'metal_prices_valid_range',
      sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),
    manualEvidence: check(
      'metal_prices_manual_evidence',
      sql`${table.source} <> 'MANUAL' OR (
        ${table.manualOverrideByUserId} IS NOT NULL AND ${table.manualOverrideReason} IS NOT NULL
      )`,
    ),
    payloadIsObject: check(
      'metal_prices_payload_object',
      sql`jsonb_typeof(${table.sourcePayload}) = 'object'`,
    ),
  }),
);

export type MetalPrice = typeof metalPrices.$inferSelect;
export type NewMetalPrice = typeof metalPrices.$inferInsert;

/**
 * Whitelist of metals supported by the engine.
 * Single source of truth for clients building drop-downs / validation.
 */
export const METAL_KIND = ['gold', 'silver', 'platinum', 'palladium'] as const;
export type MetalKind = (typeof METAL_KIND)[number];
