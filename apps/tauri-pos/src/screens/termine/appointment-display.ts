/**
 * appointment-display — pure presentation + transition logic for the Termine
 * scheduling cockpit. No React, no IO: everything here is unit-testable.
 *
 * The transition graph MIRRORS the DB trigger
 * `appointments_validate_transition()` (packages/db/migrations/0012, §9):
 *
 *   SCHEDULED   → CONFIRMED | CHECKED_IN | CANCELLED | NO_SHOW   (+RESCHEDULED via clone)
 *   CONFIRMED   → CHECKED_IN | CANCELLED | NO_SHOW               (+RESCHEDULED via clone)
 *   CHECKED_IN  → IN_PROGRESS | COMPLETED | CANCELLED
 *   IN_PROGRESS → COMPLETED
 *   COMPLETED / NO_SHOW / CANCELLED / RESCHEDULED — terminal.
 *
 * Rescheduling is NOT a PATCH status — it goes through
 * POST /api/appointments/:id/reschedule (clone + chain). The DB locks
 * scheduling fields after check-in, so dragging is only offered for
 * SCHEDULED / CONFIRMED.
 */

import type {
  AppointmentListItem,
  AppointmentPatchStatus,
  AppointmentStatus,
  AppointmentType,
} from '@norns/api-client';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from '@norns/api-client';

// ────────────────────────────────────────────────────────────────────────
// Colour coding by type (calendar chips + rail dots + drawer badge)
// gold = Ankauf-Bewertung · olive = Besichtigung · ink = Beratung · terra = Abholung
// ────────────────────────────────────────────────────────────────────────

export interface AppointmentTypeColor {
  /** Solid fill of the calendar chip. */
  bg: string;
  /** Border (slightly darker than the fill). */
  border: string;
  /** Text on the fill — all four fills are dark enough for white. */
  text: string;
}

export const APPOINTMENT_TYPE_COLORS: Readonly<Record<AppointmentType, AppointmentTypeColor>> = {
  BUYBACK_EVAL: { bg: '#7e6228', border: '#6a5120', text: '#faf8f2' }, // brass
  VIEWING: { bg: '#46583f', border: '#37452f', text: '#faf8f2' }, // forest/olive
  CONSULTATION: { bg: '#45413a', border: '#332f2a', text: '#faf8f2' }, // warm ink
  PICKUP: { bg: '#b8442b', border: '#943720', text: '#faf8f2' }, // terracotta
};

// ────────────────────────────────────────────────────────────────────────
// Transition graph (client mirror of the DB trigger)
// ────────────────────────────────────────────────────────────────────────

export const ALLOWED_APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentPatchStatus[]>
> = {
  SCHEDULED: ['CONFIRMED', 'CHECKED_IN', 'NO_SHOW', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'NO_SHOW', 'CANCELLED'],
  CHECKED_IN: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  NO_SHOW: [],
  CANCELLED: [],
  RESCHEDULED: [],
};

/** German action labels for the transition buttons (imperative, operator-facing). */
export const TRANSITION_ACTION_LABELS: Readonly<Record<AppointmentPatchStatus, string>> = {
  CONFIRMED: 'Bestätigen',
  CHECKED_IN: 'Einchecken',
  IN_PROGRESS: 'Beginnen',
  COMPLETED: 'Abschließen',
  NO_SHOW: 'Nicht erschienen',
  CANCELLED: 'Stornieren',
};

/**
 * The single most useful next step for the Heute rail's one-tap button.
 * SCHEDULED → Bestätigen, CONFIRMED → Einchecken, then Beginnen/Abschließen.
 */
export function nextActionFor(status: AppointmentStatus): AppointmentPatchStatus | null {
  switch (status) {
    case 'SCHEDULED':
      return 'CONFIRMED';
    case 'CONFIRMED':
      return 'CHECKED_IN';
    case 'CHECKED_IN':
      return 'IN_PROGRESS';
    case 'IN_PROGRESS':
      return 'COMPLETED';
    default:
      return null;
  }
}

/** Scheduling fields are mutable only before check-in (DB trigger §9). */
export function canReschedule(status: AppointmentStatus): boolean {
  return status === 'SCHEDULED' || status === 'CONFIRMED';
}

// ────────────────────────────────────────────────────────────────────────
// FullCalendar event mapping
// ────────────────────────────────────────────────────────────────────────

/** The minimal EventInput shape we feed FullCalendar (kept lib-free for tests). */
export interface CalendarEventShape {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  /** Drag enabled only while scheduling fields are still mutable. */
  startEditable: boolean;
  durationEditable: false;
}

export function toCalendarEvents(appts: readonly AppointmentListItem[]): CalendarEventShape[] {
  return appts.map((a) => {
    const color = APPOINTMENT_TYPE_COLORS[a.appointment_type];
    return {
      id: a.id,
      title: `${APPOINTMENT_TYPE_LABELS[a.appointment_type] ?? a.appointment_type} · ${
        APPOINTMENT_STATUS_LABELS[a.status] ?? a.status
      }`,
      // postgres `timestamptz::text` is "YYYY-MM-DD HH:mm:ss+TZ" (space, not
      // ISO "T") — normalise to a strict ISO instant for FullCalendar.
      start: new Date(a.starts_at).toISOString(),
      end: new Date(a.ends_at).toISOString(),
      backgroundColor: color.bg,
      borderColor: color.border,
      textColor: color.text,
      startEditable: canReschedule(a.status),
      durationEditable: false,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────
// Europe/Berlin day helpers (the shop clock, independent of the OS zone)
// ────────────────────────────────────────────────────────────────────────

const berlinDayFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const berlinTimeFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
});

/** ISO instant → Berlin-local calendar day key `YYYY-MM-DD`. */
export function berlinDayKey(iso: string | Date): string {
  return berlinDayFmt.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** ISO instant → Berlin wall-clock `HH:mm`. */
export function berlinTime(iso: string | Date): string {
  return berlinTimeFmt.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/**
 * The Heute rail: today's (Berlin) non-terminal appointments that have not
 * ended yet, soonest first.
 */
export function todaysUpcoming(
  appts: readonly AppointmentListItem[],
  now: Date,
): AppointmentListItem[] {
  const today = berlinDayKey(now);
  return appts
    .filter(
      (a) =>
        berlinDayKey(a.starts_at) === today &&
        ALLOWED_APPOINTMENT_TRANSITIONS[a.status].length > 0 &&
        new Date(a.ends_at).getTime() >= now.getTime(),
    )
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
}
