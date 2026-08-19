/**
 * Europe/Berlin display formatting (ADR-0020 constraint: all scheduling
 * displays in Europe/Berlin). Pure — uses the platform Intl/zoneinfo, which is
 * DST-correct.
 */

export const BERLIN_TZ = 'Europe/Berlin';

/** Berlin-local business day as YYYY-MM-DD (DST-correct). */
export function berlinBusinessDay(date: Date): string {
  // en-CA yields ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Berlin-local wall-clock time as HH:MM (24h). */
export function berlinTimeHm(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Human label e.g. "Fr., 29.05.2026, 14:00" in Berlin time. */
export function berlinLabel(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN_TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
