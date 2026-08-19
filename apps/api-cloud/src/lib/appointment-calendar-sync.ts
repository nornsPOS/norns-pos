/**
 * appointment-calendar-sync — mirrors every appointment (storefront/phone
 * booking, POS, and the future WhatsApp bot) into the shop's Google Calendar,
 * so the calendar is the single place where all appointments appear: the POS
 * Werkstatt → Kalender, and the owner's own phone Google Calendar.
 *
 * Discipline: the mirror is BEST-EFFORT. It runs AFTER the booking transaction
 * has committed and NEVER throws into the booking path — a Google outage must
 * not fail a real booking. Failures are logged; the appointment keeps a NULL
 * `google_event_id` and can be back-filled later.
 *
 * Direction: appointments table → Google Calendar (one-way). Owner edits made
 * directly in Google show in the POS Kalender card (which reads Google live);
 * POS-side status/reschedule/cancel propagate to the Google event here.
 */

import { sql } from 'drizzle-orm';

import {
  type CalendarEventInput,
  calendarConfigured,
  createEvent,
  deleteEvent,
  updateEvent,
} from './google-calendar.js';

const TYPE_LABEL: Record<string, string> = {
  VIEWING: 'Besichtigung',
  BUYBACK_EVAL: 'Ankauf-Bewertung',
  CONSULTATION: 'Beratung',
  PICKUP: 'Abholung',
};

const SOURCE_LABEL: Record<string, string> = {
  WEB: 'Online-Buchung',
  POS: 'Kasse',
  WHATSAPP: 'WhatsApp-Bot',
  whatsapp_bot: 'WhatsApp-Bot',
  storefront: 'Online-Buchung',
  pos: 'Kasse',
};

export interface AppointmentEventInput {
  type: 'VIEWING' | 'BUYBACK_EVAL' | 'CONSULTATION' | 'PICKUP';
  startIso: string;
  durationMinutes: number;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  source?: string | null;
}

/** Pure mapper: appointment → Google Calendar event payload (German labels). */
export function buildAppointmentEvent(input: AppointmentEventInput): CalendarEventInput {
  const label = TYPE_LABEL[input.type] ?? input.type;
  const summary = input.name ? `${label} – ${input.name}` : label;
  const end = new Date(
    new Date(input.startIso).getTime() + input.durationMinutes * 60_000,
  ).toISOString();

  const lines: string[] = [];
  if (input.phone) lines.push(`Telefon: ${input.phone}`);
  if (input.email) lines.push(`E-Mail: ${input.email}`);
  if (input.notes) lines.push(`Notiz: ${input.notes}`);
  if (input.source) lines.push(`Quelle: ${SOURCE_LABEL[input.source] ?? input.source}`);

  return {
    summary,
    start: input.startIso,
    end,
    allDay: false,
    ...(lines.length > 0 ? { description: lines.join('\n') } : {}),
  };
}

// ── Best-effort mirror operations ──────────────────────────────────────────
// All swallow errors (never throw into the booking path) and no-op when the
// calendar is not configured.

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}
interface LoggerLike {
  error(obj: unknown, msg?: string): void;
}

/** Create a Google event for a freshly-booked appointment and store its id. */
export async function mirrorAppointmentCreate(
  db: DbLike,
  log: LoggerLike,
  appointmentId: string,
  input: AppointmentEventInput,
): Promise<void> {
  if (!calendarConfigured()) return;
  try {
    const ev = await createEvent(buildAppointmentEvent(input));
    await db.execute(
      sql`UPDATE appointments SET google_event_id = ${ev.id} WHERE id = ${appointmentId}::uuid`,
    );
  } catch (err) {
    log.error({ err, appointmentId }, 'calendar mirror: create failed');
  }
}

/** Update the linked Google event (e.g. notes/time change). No-op without an id. */
export async function mirrorAppointmentUpdate(
  log: LoggerLike,
  googleEventId: string | null,
  input: AppointmentEventInput,
): Promise<void> {
  if (!calendarConfigured() || !googleEventId) return;
  try {
    await updateEvent(googleEventId, buildAppointmentEvent(input));
  } catch (err) {
    log.error({ err, googleEventId }, 'calendar mirror: update failed');
  }
}

/** Delete the linked Google event (cancellation) and clear the stored id. */
export async function mirrorAppointmentDelete(
  db: DbLike,
  log: LoggerLike,
  appointmentId: string,
  googleEventId: string | null,
): Promise<void> {
  if (!calendarConfigured() || !googleEventId) return;
  try {
    await deleteEvent(googleEventId);
    await db.execute(
      sql`UPDATE appointments SET google_event_id = NULL WHERE id = ${appointmentId}::uuid`,
    );
  } catch (err) {
    log.error({ err, googleEventId }, 'calendar mirror: delete failed');
  }
}

/**
 * Reschedule: move the existing Google event to the new time and hand its id to
 * the clone row (the original is marked RESCHEDULED). If the original had no
 * event yet, create a fresh one for the clone.
 */
export async function mirrorAppointmentReschedule(
  db: DbLike,
  log: LoggerLike,
  oldAppointmentId: string,
  oldGoogleEventId: string | null,
  newAppointmentId: string,
  input: AppointmentEventInput,
): Promise<void> {
  if (!calendarConfigured()) return;
  try {
    let eventId = oldGoogleEventId;
    if (eventId) {
      await updateEvent(eventId, buildAppointmentEvent(input));
    } else {
      const ev = await createEvent(buildAppointmentEvent(input));
      eventId = ev.id;
    }
    await db.execute(
      sql`UPDATE appointments SET google_event_id = ${eventId} WHERE id = ${newAppointmentId}::uuid`,
    );
    if (oldGoogleEventId) {
      await db.execute(
        sql`UPDATE appointments SET google_event_id = NULL WHERE id = ${oldAppointmentId}::uuid`,
      );
    }
  } catch (err) {
    log.error({ err, oldAppointmentId, newAppointmentId }, 'calendar mirror: reschedule failed');
  }
}
