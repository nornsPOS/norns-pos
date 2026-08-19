/**
 * Shared types for the deterministic appointment core (ADR-0020).
 */

export const APPOINTMENT_TYPES = ['VIEWING', 'BUYBACK_EVAL', 'CONSULTATION', 'PICKUP'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
  'RESCHEDULED',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Default appointment duration per type (minutes) — used when a booking omits it. */
export const DEFAULT_DURATION_MINUTES: Record<AppointmentType, number> = {
  VIEWING: 30,
  BUYBACK_EVAL: 45,
  CONSULTATION: 30,
  PICKUP: 15,
};

export interface IcsAppointment {
  id: string;
  appointmentType: AppointmentType;
  startsAt: Date;
  endsAt: Date;
  /** Optional free-form description appended to the .ics DESCRIPTION line. */
  description?: string;
}
