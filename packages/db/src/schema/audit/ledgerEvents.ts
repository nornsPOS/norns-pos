/**
 * ledger_events — the tamper-evident journal.
 *
 * Every fiscally-relevant state change in Warehouse14 writes a row here. The
 * SHA-256 hash chain is maintained by a SECURITY DEFINER trigger owned by
 * warehouse14_security (migration 0008). The app role can SELECT and INSERT
 * (column-restricted: id / prev_hash / row_hash / created_at are computed by
 * the DB), never UPDATE or DELETE.
 *
 * Writes go through `@norns/audit`'s `emit()` helper. Verification via
 * `verify_ledger_chain()` SQL function exposed by the same package.
 */

import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  customType,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { devices } from '../auth/devices.js';
import { users } from '../auth/users.js';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

export const ledgerEvents = pgTable(
  'ledger_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),

    eventType: text('event_type').notNull(),
    entityTable: text('entity_table').notNull(),
    entityId: uuid('entity_id').notNull(),

    actorUserId: uuid('actor_user_id').references(() => users.id),
    deviceId: uuid('device_id').references(() => devices.id),
    ipAddress: inet('ip_address'),

    payload: jsonb('payload').notNull(),

    // The chain — trigger-computed, app cannot write
    prevHash: bytea('prev_hash').notNull(),
    rowHash: bytea('row_hash').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entityIdx: index('ledger_events_entity_idx').on(table.entityTable, table.entityId),
    eventTypeIdx: index('ledger_events_event_type_idx').on(table.eventType, table.id.desc()),
    actorIdx: index('ledger_events_actor_idx')
      .on(table.actorUserId, table.id.desc())
      .where(sql`${table.actorUserId} IS NOT NULL`),
    // 0145 (19.08.2026): das Journal filtert ROHE `created_at`-Zeitstempel;
    // der Ausdrucksindex auf berlin_business_day(created_at) aus 0008 bedient
    // diesen Vergleich nicht — jede Anfrage las die ganze Tabelle, und
    // ledger_events waechst am schnellsten von allen.
    createdAtIdx: index('ledger_events_created_at_idx').on(table.createdAt),
    prevHashLength: check(
      'ledger_events_prev_hash_length',
      sql`octet_length(${table.prevHash}) = 32`,
    ),
    rowHashLength: check('ledger_events_row_hash_length', sql`octet_length(${table.rowHash}) = 32`),
    payloadObject: check(
      'ledger_events_payload_object',
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
  }),
);

export type LedgerEvent = typeof ledgerEvents.$inferSelect;
export type NewLedgerEvent = typeof ledgerEvents.$inferInsert;
