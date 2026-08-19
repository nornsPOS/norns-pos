/**
 * appointment-display unit tests — the client transition graph MUST mirror the
 * DB trigger `appointments_validate_transition()` (0012 §9) or the UI offers
 * buttons the server rejects.
 */

import { describe, expect, it } from 'vitest';

import type { AppointmentListItem } from '@norns/api-client';

import {
  ALLOWED_APPOINTMENT_TRANSITIONS,
  APPOINTMENT_TYPE_COLORS,
  TRANSITION_ACTION_LABELS,
  berlinDayKey,
  berlinTime,
  canReschedule,
  nextActionFor,
  toCalendarEvents,
  todaysUpcoming,
} from './appointment-display.js';

function appt(over: Partial<AppointmentListItem>): AppointmentListItem {
  return {
    id: 'a1',
    appointment_type: 'VIEWING',
    status: 'SCHEDULED',
    starts_at: '2026-06-10T08:00:00+00:00',
    ends_at: '2026-06-10T08:30:00+00:00',
    duration_minutes: 30,
    staff_user_id: 's1',
    customer_id: null,
    linked_product_ids: [],
    ...over,
  };
}

describe('transition graph (mirror of DB trigger 0012 §9)', () => {
  it('matches the trigger graph exactly', () => {
    expect(ALLOWED_APPOINTMENT_TRANSITIONS.SCHEDULED).toEqual([
      'CONFIRMED',
      'CHECKED_IN',
      'NO_SHOW',
      'CANCELLED',
    ]);
    expect(ALLOWED_APPOINTMENT_TRANSITIONS.CONFIRMED).toEqual([
      'CHECKED_IN',
      'NO_SHOW',
      'CANCELLED',
    ]);
    expect(ALLOWED_APPOINTMENT_TRANSITIONS.CHECKED_IN).toEqual([
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
    ]);
    expect(ALLOWED_APPOINTMENT_TRANSITIONS.IN_PROGRESS).toEqual(['COMPLETED']);
  });

  it('terminal states allow nothing', () => {
    for (const s of ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED'] as const) {
      expect(ALLOWED_APPOINTMENT_TRANSITIONS[s]).toEqual([]);
      expect(nextActionFor(s)).toBeNull();
    }
  });

  it('every offered transition carries a German action label', () => {
    for (const targets of Object.values(ALLOWED_APPOINTMENT_TRANSITIONS)) {
      for (const t of targets) {
        expect(TRANSITION_ACTION_LABELS[t]).toBeTruthy();
      }
    }
  });

  it('one-tap rail action follows the happy path', () => {
    expect(nextActionFor('SCHEDULED')).toBe('CONFIRMED');
    expect(nextActionFor('CONFIRMED')).toBe('CHECKED_IN');
    expect(nextActionFor('CHECKED_IN')).toBe('IN_PROGRESS');
    expect(nextActionFor('IN_PROGRESS')).toBe('COMPLETED');
  });

  it('drag-reschedule only while scheduling fields are mutable (pre check-in)', () => {
    expect(canReschedule('SCHEDULED')).toBe(true);
    expect(canReschedule('CONFIRMED')).toBe(true);
    expect(canReschedule('CHECKED_IN')).toBe(false);
    expect(canReschedule('IN_PROGRESS')).toBe(false);
    expect(canReschedule('COMPLETED')).toBe(false);
    expect(canReschedule('CANCELLED')).toBe(false);
  });
});

describe('type colour coding', () => {
  it('covers all four types with the briefed palette roles', () => {
    // brass=Ankauf, forest=Besichtigung, warm ink=Beratung, terra=Abholung
    expect(APPOINTMENT_TYPE_COLORS.BUYBACK_EVAL.bg).toBe('#7e6228');
    expect(APPOINTMENT_TYPE_COLORS.VIEWING.bg).toBe('#46583f');
    expect(APPOINTMENT_TYPE_COLORS.CONSULTATION.bg).toBe('#45413a');
    expect(APPOINTMENT_TYPE_COLORS.PICKUP.bg).toBe('#b8442b');
    for (const c of Object.values(APPOINTMENT_TYPE_COLORS)) {
      expect(c.text).toBe('#faf8f2');
      expect(c.border).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('toCalendarEvents', () => {
  it('maps fields, German title, colours and per-status drag flag', () => {
    const events = toCalendarEvents([
      appt({
        id: 'e1',
        appointment_type: 'BUYBACK_EVAL',
        status: 'CONFIRMED',
        // postgres ::text shape (space, short offset) must normalise too
        starts_at: '2026-06-10 08:00:00+00',
        ends_at: '2026-06-10 08:30:00+00',
      }),
      appt({ id: 'e2', appointment_type: 'PICKUP', status: 'CHECKED_IN' }),
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: 'e1',
      title: 'Ankauf-Bewertung · Bestätigt',
      start: '2026-06-10T08:00:00.000Z',
      end: '2026-06-10T08:30:00.000Z',
      backgroundColor: '#7e6228',
      startEditable: true,
      durationEditable: false,
    });
    expect(events[1]).toMatchObject({
      id: 'e2',
      title: 'Abholung · Eingecheckt',
      backgroundColor: '#b8442b',
      startEditable: false,
    });
  });
});

describe('Europe/Berlin helpers', () => {
  it('berlinDayKey converts UTC instants to the Berlin calendar day (CEST)', () => {
    // 22:30 UTC on the 9th is 00:30 on the 10th in Berlin summer time.
    expect(berlinDayKey('2026-06-09T22:30:00Z')).toBe('2026-06-10');
    expect(berlinDayKey('2026-06-09T21:59:00Z')).toBe('2026-06-09');
    // Winter (CET, +01:00): 23:30 UTC on Jan 1 is 00:30 Jan 2 in Berlin.
    expect(berlinDayKey('2026-01-01T23:30:00Z')).toBe('2026-01-02');
  });

  it('berlinTime renders the Berlin wall clock', () => {
    expect(berlinTime('2026-06-10T08:00:00Z')).toBe('10:00');
    expect(berlinTime('2026-01-10T08:00:00Z')).toBe('09:00');
  });
});

describe('todaysUpcoming (Heute rail)', () => {
  const now = new Date('2026-06-10T09:00:00Z'); // 11:00 Berlin

  it('keeps only today, not-yet-ended, actionable appointments — sorted', () => {
    const rows = todaysUpcoming(
      [
        appt({ id: 'later', starts_at: '2026-06-10T14:00:00Z', ends_at: '2026-06-10T14:30:00Z' }),
        appt({ id: 'soon', starts_at: '2026-06-10T10:00:00Z', ends_at: '2026-06-10T10:30:00Z' }),
        // Already ended this morning → out.
        appt({ id: 'over', starts_at: '2026-06-10T06:00:00Z', ends_at: '2026-06-10T06:30:00Z' }),
        // Tomorrow → out.
        appt({ id: 'tmrw', starts_at: '2026-06-11T10:00:00Z', ends_at: '2026-06-11T10:30:00Z' }),
        // Terminal status → out.
        appt({
          id: 'done',
          status: 'COMPLETED',
          starts_at: '2026-06-10T12:00:00Z',
          ends_at: '2026-06-10T12:30:00Z',
        }),
      ],
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(['soon', 'later']);
  });

  it('keeps a running appointment until it ends', () => {
    const rows = todaysUpcoming(
      [
        appt({
          id: 'run',
          status: 'IN_PROGRESS',
          starts_at: '2026-06-10T08:45:00Z',
          ends_at: '2026-06-10T09:15:00Z',
        }),
      ],
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(['run']);
  });
});
