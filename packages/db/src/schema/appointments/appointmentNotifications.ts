/**
 * appointment_notifications — the reminder/confirmation outbox (ADR-0020 §3, §7).
 *
 * Booking schedules rows here (T-24h, T-2h, T-30min, confirmation); the worker
 * sweep dispatches anything with `scheduled_for <= now() AND sent_at IS NULL`.
 * Created in migration 0038 (omitted from 0012's appointment core).
 */

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryKey } from '../_shared/columns.js';
import { appointments } from './appointments.js';

export const APPOINTMENT_NOTIFICATION_TYPES = [
  'booking_confirmation',
  'reminder_24h',
  'reminder_2h',
  'reminder_30min',
  'no_show_followup',
  'rescheduled',
  'cancelled',
] as const;
export type AppointmentNotificationType = (typeof APPOINTMENT_NOTIFICATION_TYPES)[number];

export const APPOINTMENT_NOTIFICATION_CHANNELS = ['whatsapp', 'email', 'sse', 'sms'] as const;
export type AppointmentNotificationChannel = (typeof APPOINTMENT_NOTIFICATION_CHANNELS)[number];

export const appointmentNotifications = pgTable(
  'appointment_notifications',
  {
    id: primaryKey(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id),
    notificationType: text('notification_type').$type<AppointmentNotificationType>().notNull(),
    channel: text('channel').$type<AppointmentNotificationChannel>().notNull(),
    recipient: text('recipient').notNull(),
    templateId: text('template_id'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveryStatus: text('delivery_status'),
    externalRef: text('external_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    scheduledIdx: index('idx_appt_notif_scheduled')
      .on(table.scheduledFor)
      .where(sql`${table.sentAt} IS NULL`),
    appointmentIdx: index('idx_appt_notif_appointment').on(table.appointmentId),
    typeDomain: check(
      'appt_notif_type_domain',
      sql`${table.notificationType} IN ('booking_confirmation','reminder_24h','reminder_2h','reminder_30min','no_show_followup','rescheduled','cancelled')`,
    ),
    channelDomain: check(
      'appt_notif_channel_domain',
      sql`${table.channel} IN ('whatsapp','email','sse','sms')`,
    ),
    sentHasStatus: check(
      'appt_notif_sent_has_status',
      sql`${table.sentAt} IS NULL OR ${table.deliveryStatus} IS NOT NULL`,
    ),
  }),
);

export type AppointmentNotification = typeof appointmentNotifications.$inferSelect;
export type NewAppointmentNotification = typeof appointmentNotifications.$inferInsert;
