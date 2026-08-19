/**
 * No-show grace logic (ADR-0020 §7-8). Pure. The grace window default is 30 min,
 * configurable via system_settings.appointment.no_show_grace_minutes.
 */

export const DEFAULT_NO_SHOW_GRACE_MINUTES = 30;

/** The instant after which an un-checked-in appointment is a no-show. */
export function graceDeadline(startsAt: Date, graceMinutes = DEFAULT_NO_SHOW_GRACE_MINUTES): Date {
  return new Date(startsAt.getTime() + graceMinutes * 60 * 1000);
}

/** True once the grace window has elapsed without a check-in. */
export function isPastGrace(
  startsAt: Date,
  graceMinutes = DEFAULT_NO_SHOW_GRACE_MINUTES,
  now: Date = new Date(),
): boolean {
  return now.getTime() > graceDeadline(startsAt, graceMinutes).getTime();
}
