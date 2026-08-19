/**
 * tse_clients — TSE/TSS certificate expiry tracking (KassenSichV, #I-1).
 *
 * One row per Fiskaly TSS (technical security system). The `tse_cert_checker`
 * worker job queries the Fiskaly SIGN DE V2 API daily, records the certificate's
 * `cert_valid_to`, and — when the certificate is within 30 days of expiry — emits
 * the critical `alert.tse_cert_expiry` ledger event (an expired TSE certificate
 * invalidates the register's legality). `alert_sent_at` throttles the alert to at
 * most once per 24h.
 *
 * See migration 0043_tse_clients.sql.
 */

import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';

export const tseClients = pgTable(
  'tse_clients',
  {
    id: primaryKey(),
    /** Fiskaly TSS id — one row per technical security system. */
    tssId: text('tss_id').notNull(),
    description: text('description'),
    /** Certificate validity end (from Fiskaly). */
    certValidTo: timestamp('cert_valid_to', { withTimezone: true }).notNull(),
    /** When the checker last refreshed this row from Fiskaly. */
    lastChecked: timestamp('last_checked', { withTimezone: true }),
    /** When the most recent expiry alert was emitted. */
    alertSentAt: timestamp('alert_sent_at', { withTimezone: true }),
    /**
     * The cert-expiry escalation tier (T-30/T-7/T-1/expired) most recently
     * alerted on; NULL = never alerted. Drives escalation-only re-alerting
     * (migration 0049). See apps/worker/src/lib/cert-expiry-tier.ts.
     */
    lastAlertTier: text('last_alert_tier'),
    ...timestamps(),
  },
  (table) => ({
    tssIdUq: uniqueIndex('tse_clients_tss_id_uq').on(table.tssId),
  }),
);

export type TseClientRow = typeof tseClients.$inferSelect;
export type NewTseClientRow = typeof tseClients.$inferInsert;
