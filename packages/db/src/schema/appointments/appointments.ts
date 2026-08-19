/**
 * appointments — the master scheduling table.
 *
 * 4 types × 8 statuses. State transitions enforced by trigger. NEVER deleted —
 * CANCELLED/NO_SHOW preserved for analytics (future customer-rating model).
 *
 * `ends_at` is GENERATED ALWAYS AS STORED from `starts_at + duration_minutes`.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { users } from '../auth/users.js';
import { customers } from '../customers/customers.js';
import { transactions } from '../transactions/transactions.js';
import { appointmentStatus, appointmentType } from './enums.js';

export const appointments = pgTable(
  'appointments',
  {
    id: primaryKey(),
    shopId: uuid('shop_id'),

    appointmentType: appointmentType('appointment_type').notNull(),
    status: appointmentStatus('status').notNull().default('SCHEDULED'),

    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true })
      .generatedAlwaysAs(sql`starts_at + make_interval(mins => duration_minutes)`)
      .notNull(),

    customerId: uuid('customer_id').references(() => customers.id),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => users.id),
    bookedByUserId: uuid('booked_by_user_id').references(() => users.id),
    bookedVia: text('booked_via').notNull(),

    customerNotes: text('customer_notes'),
    staffNotes: text('staff_notes'),

    // ── Migration 0062: public web booking ────────────────────────────────
    /** Booking origin per the cross-team CONTRACT: 'POS' | 'WEB' | 'WHATSAPP'. */
    source: text('source').notNull().default('POS'),
    /** Walk-in contact fields for bookings without a customer record (source=WEB). */
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),

    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    earlyArrivalMinutes: integer('early_arrival_minutes'),
    inProgressStartedAt: timestamp('in_progress_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    noShowMarkedAt: timestamp('no_show_marked_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),

    rescheduledFromAppointmentId: uuid('rescheduled_from_appointment_id'),
    rescheduledToAppointmentId: uuid('rescheduled_to_appointment_id'),

    linkedTransactionId: uuid('linked_transaction_id').references(() => transactions.id),

    // ── Migration 0064: Google Calendar mirror ────────────────────────────
    /** Id of the mirrored Google Calendar event (NULL until synced; best-effort). */
    googleEventId: text('google_event_id'),

    ...timestamps(),
  },
  (table) => ({
    statusStartsAtIdx: index('appointments_status_starts_at_idx').on(table.status, table.startsAt),
    staffStartsAtIdx: index('appointments_staff_starts_at_idx').on(
      table.staffUserId,
      table.startsAt,
    ),
    customerIdx: index('appointments_customer_idx')
      .on(table.customerId)
      .where(sql`${table.customerId} IS NOT NULL`),
    businessDayIdx: index('appointments_business_day_idx').on(
      table.shopId,
      sql`berlin_business_day(${table.startsAt})`,
    ),
    activeWindowIdx: index('appointments_active_window_idx')
      .on(table.startsAt, table.endsAt)
      .where(sql`${table.status} NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')`),
    // Migration 0070: inbound calendar-pull idempotency — at most one appointment
    // per Google event (NULLs are distinct, so unsynced rows are unaffected).
    googleEventIdUq: uniqueIndex('appointments_google_event_id_uq').on(table.googleEventId),

    durationRange: check(
      'appointments_duration_range',
      sql`${table.durationMinutes} > 0 AND ${table.durationMinutes} <= 480`,
    ),
    bookedViaDomain: check(
      'appointments_booked_via_domain',
      sql`${table.bookedVia} IN ('control_desktop', 'storefront', 'pos', 'whatsapp_bot', 'google_calendar')`,
    ),
    sourceDomain: check(
      'appointments_source_domain',
      sql`${table.source} IN ('POS', 'WEB', 'WHATSAPP', 'GOOGLE')`,
    ),
    checkedInHasMarker: check(
      'appointments_checked_in_has_marker',
      sql`${table.status} NOT IN ('CHECKED_IN', 'IN_PROGRESS', 'COMPLETED') OR ${table.checkedInAt} IS NOT NULL`,
    ),
    inProgressHasMarker: check(
      'appointments_in_progress_has_marker',
      sql`${table.status} <> 'IN_PROGRESS' OR ${table.inProgressStartedAt} IS NOT NULL`,
    ),
    completedHasMarker: check(
      'appointments_completed_has_marker',
      sql`${table.status} <> 'COMPLETED' OR ${table.completedAt} IS NOT NULL`,
    ),
    cancelledHasMarker: check(
      'appointments_cancelled_has_marker',
      sql`${table.status} <> 'CANCELLED' OR ${table.cancelledAt} IS NOT NULL`,
    ),
    noShowHasMarker: check(
      'appointments_no_show_has_marker',
      sql`${table.status} <> 'NO_SHOW' OR ${table.noShowMarkedAt} IS NOT NULL`,
    ),
    rescheduledHasLink: check(
      'appointments_rescheduled_has_link',
      sql`${table.status} <> 'RESCHEDULED' OR ${table.rescheduledToAppointmentId} IS NOT NULL`,
    ),
  }),
);

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
