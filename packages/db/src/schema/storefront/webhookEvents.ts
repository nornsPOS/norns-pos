/**
 * webhook_events — idempotency + audit for every provider webhook (Day 19).
 *
 * UNIQUE (provider, provider_event_id) refuses duplicate deliveries.
 * Closes Phase 1.5 backlog item I-3.
 */

import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    rawBody: text('raw_body').notNull(),
    payload: jsonb('payload').notNull(),
    signatureVerified: boolean('signature_verified').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    providerEventUq: uniqueIndex('webhook_events_provider_event_uq').on(
      table.provider,
      table.providerEventId,
    ),
    unprocessedIdx: index('webhook_events_unprocessed_idx')
      .on(table.provider, table.receivedAt.desc())
      .where(sql`${table.processedAt} IS NULL`),
    payloadIsObject: check(
      'webhook_events_payload_is_object',
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
  }),
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
