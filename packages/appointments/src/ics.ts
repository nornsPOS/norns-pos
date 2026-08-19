/**
 * iCalendar (.ics) generation for appointment confirmation emails (ADR-0020 §10).
 *
 * Times are emitted as UTC instants (…Z), which every calendar client renders in
 * the viewer's local zone — correct for an absolute appointment time. Pure.
 */

import type { IcsAppointment } from './types.js';

const PRODID = '-//Warehouse14//EN';
const LOCATION = 'warehouse14, Rosenstraße 40, 73614 Schorndorf';

/** Format a Date as an iCalendar UTC timestamp: YYYYMMDDTHHMMSSZ. */
export function formatIcsTimestamp(date: Date): string {
  const iso = date.toISOString(); // 2026-05-29T14:00:00.000Z
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** Escape TEXT values per RFC 5545 (backslash, comma, semicolon, newline). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Build the full VCALENDAR string for one appointment. */
export function buildIcsEvent(appt: IcsAppointment, now: Date = new Date()): string {
  const summary = escapeIcsText(`Warehouse14 - ${appt.appointmentType} appointment`);
  const description = escapeIcsText(
    appt.description ?? 'Ihr Termin bei Warehouse14. Wir freuen uns auf Sie.',
  );
  const lines = [
    'BEGIN:VCALENDAR',
    `PRODID:${PRODID}`,
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:appt-${appt.id}@warehouse14.de`,
    `DTSTAMP:${formatIcsTimestamp(now)}`,
    `DTSTART:${formatIcsTimestamp(appt.startsAt)}`,
    `DTEND:${formatIcsTimestamp(appt.endsAt)}`,
    `SUMMARY:${summary}`,
    `LOCATION:${escapeIcsText(LOCATION)}`,
    `DESCRIPTION:${description}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // RFC 5545 line terminator is CRLF.
  return `${lines.join('\r\n')}\r\n`;
}
