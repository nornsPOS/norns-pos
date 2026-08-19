/**
 * Native PG enums for the Smart Appointment System.
 *
 * Created in migration 0012_appointments.sql.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const appointmentType = pgEnum('appointment_type', [
  'VIEWING',
  'BUYBACK_EVAL',
  'CONSULTATION',
  'PICKUP',
]);

export const appointmentStatus = pgEnum('appointment_status', [
  'SCHEDULED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
  'RESCHEDULED',
]);
