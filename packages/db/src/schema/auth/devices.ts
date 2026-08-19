/**
 * devices — mTLS-paired terminals + Control Desktop instances.
 *
 * Every device that authenticates to the API holds an X.509 client cert
 * issued by step-ca (ADR-0014 §2). The Caddy mTLS layer extracts the cert's
 * serial and the API guard maps it to a row here (ADR-0014 §3).
 *
 * Updatable columns from the app role (per migration 0004 §9):
 *   • status (active → revoked / expired)
 *   • last_seen_at, last_seen_ip
 *   • notes, hostname
 *   • updated_at (via trigger)
 *
 * NOT updatable:
 *   • cert_serial, cert_issued_at, cert_expires_at — cert lifecycle is owned
 *     by step-ca + admin
 *   • paired_by_user_id, paired_at — pairing event is the moment of identity
 *     establishment; mutating later would corrupt the audit trail
 *
 * NEVER DELETE: device audit trail is permanent; decommissioned devices
 * transition to status='revoked'.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { deviceClass, deviceStatus } from './enums.js';
import { users } from './users.js';

export const devices = pgTable(
  'devices',
  {
    id: primaryKey(),

    deviceClass: deviceClass('device_class').notNull(),
    hostname: text('hostname'),

    certSerial: text('cert_serial').notNull(),
    certIssuedAt: timestamp('cert_issued_at', { withTimezone: true }).notNull(),
    certExpiresAt: timestamp('cert_expires_at', { withTimezone: true }).notNull(),

    status: deviceStatus('status').notNull().default('active'),

    pairedByUserId: uuid('paired_by_user_id')
      .notNull()
      .references(() => users.id),
    pairedAt: timestamp('paired_at', { withTimezone: true }).notNull().defaultNow(),

    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSeenIp: inet('last_seen_ip'),

    notes: text('notes'),

    ...timestamps(),
  },
  (table) => ({
    certSerialUq: uniqueIndex('devices_cert_serial_uq').on(table.certSerial),
    statusClassIdx: index('devices_status_class_idx').on(table.status, table.deviceClass),
    expiringSoonIdx: index('devices_expiring_soon_idx')
      .on(table.certExpiresAt)
      .where(sql`${table.status} = 'active'`),
    certValidityRange: check(
      'devices_cert_validity_range',
      sql`${table.certExpiresAt} > ${table.certIssuedAt}`,
    ),
  }),
);

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
