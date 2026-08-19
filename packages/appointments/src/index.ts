/**
 * @norns/appointments — the deterministic, I/O-free core of the Smart
 * Appointment System (ADR-0020):
 *   • buildIcsEvent           — calendar export for confirmation emails,
 *   • whatsappReminderMode    — 24h-window template/free-form decision,
 *   • computeReminderSchedule — the T-24h/T-2h/T-30min cadence,
 *   • isPastGrace             — no-show grace decision,
 *   • Europe/Berlin display helpers.
 *
 * The routes/worker inject DB + transports around these pure functions.
 */

export * from './types.js';
export * from './ics.js';
export * from './reminders.js';
export * from './grace.js';
export * from './berlin.js';
