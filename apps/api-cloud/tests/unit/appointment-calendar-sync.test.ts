import { describe, expect, it } from 'vitest';

import { buildAppointmentEvent } from '../../src/lib/appointment-calendar-sync.js';

describe('buildAppointmentEvent', () => {
  it('maps the appointment type to a German summary with the contact name', () => {
    const ev = buildAppointmentEvent({
      type: 'VIEWING',
      startIso: '2026-06-20T10:00:00.000Z',
      durationMinutes: 30,
      name: 'Max Mustermann',
    });
    expect(ev.summary).toBe('Besichtigung – Max Mustermann');
  });

  it('falls back to just the German label when no name is given', () => {
    const ev = buildAppointmentEvent({
      type: 'BUYBACK_EVAL',
      startIso: '2026-06-20T10:00:00.000Z',
      durationMinutes: 30,
    });
    expect(ev.summary).toBe('Ankauf-Bewertung');
  });

  it('computes end = start + durationMinutes as ISO', () => {
    const ev = buildAppointmentEvent({
      type: 'CONSULTATION',
      startIso: '2026-06-20T10:00:00.000Z',
      durationMinutes: 45,
    });
    expect(ev.start).toBe('2026-06-20T10:00:00.000Z');
    expect(ev.end).toBe('2026-06-20T10:45:00.000Z');
  });

  it('includes phone, email, notes and a source label in the description when present', () => {
    const ev = buildAppointmentEvent({
      type: 'PICKUP',
      startIso: '2026-06-20T10:00:00.000Z',
      durationMinutes: 30,
      name: 'Erika',
      phone: '+49 170 1234567',
      email: 'erika@example.com',
      notes: 'Bringt Goldkette mit',
      source: 'WEB',
    });
    expect(ev.description).toContain('+49 170 1234567');
    expect(ev.description).toContain('erika@example.com');
    expect(ev.description).toContain('Bringt Goldkette mit');
    expect(ev.description).toContain('Online-Buchung');
  });

  it('omits absent contact lines (no empty labels)', () => {
    const ev = buildAppointmentEvent({
      type: 'VIEWING',
      startIso: '2026-06-20T10:00:00.000Z',
      durationMinutes: 30,
      name: 'Max',
    });
    expect(ev.description ?? '').not.toContain('Telefon');
    expect(ev.description ?? '').not.toContain('E-Mail');
  });

  it('is not all-day', () => {
    const ev = buildAppointmentEvent({
      type: 'VIEWING',
      startIso: '2026-06-20T10:00:00.000Z',
      durationMinutes: 30,
    });
    expect(ev.allDay).toBeFalsy();
  });
});
