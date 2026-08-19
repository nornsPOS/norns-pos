/**
 * audit_log — non-fiscal who-when-what.
 *
 * For login/logout, role changes, settings updates, AML alerts. No hash chain
 * (the chain is for fiscal evidence; security events have a different threat
 * model). Append-only via grants — app has SELECT + INSERT only.
 */

import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
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

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    eventType: text('event_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    deviceId: uuid('device_id').references(() => devices.id),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventTypeIdx: index('audit_log_event_type_created_at_idx').on(
      table.eventType,
      table.createdAt.desc(),
    ),
    actorIdx: index('audit_log_actor_created_at_idx')
      .on(table.actorUserId, table.createdAt.desc())
      .where(sql`${table.actorUserId} IS NOT NULL`),
    payloadObject: check(
      'audit_log_payload_object',
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
  }),
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
