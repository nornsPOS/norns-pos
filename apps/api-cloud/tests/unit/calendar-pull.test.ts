import { describe, expect, it } from 'vitest';

import { decidePullAction } from '../../src/lib/calendar-pull.js';

const ev = (over: Partial<Parameters<typeof decidePullAction>[0]> = {}) => ({
  id: 'evt1',
  status: 'confirmed',
  startIso: '2026-06-20T10:00:00.000Z',
  endIso: '2026-06-20T10:30:00.000Z',
  summary: 'Besichtigung – Max',
  description: 'Telefon: 123',
  created: '2026-06-13T00:00:00.000Z',
  ...over,
});

const appt = (over: Record<string, unknown> = {}) => ({
  id: 'appt1',
  status: 'SCHEDULED',
  startsAt: '2026-06-20T10:00:00.000Z',
  durationMinutes: 30,
  ...over,
});

describe('decidePullAction', () => {
  it('cancels the matched appointment when the Google event was deleted', () => {
    expect(decidePullAction(ev({ status: 'cancelled' }), appt(), false)).toEqual({
      kind: 'cancel',
      appointmentId: 'appt1',
    });
  });

  it('skips a cancelled event with no matching appointment', () => {
    expect(decidePullAction(ev({ status: 'cancelled' }), null, false)).toEqual({ kind: 'skip' });
  });

  it('skips a cancelled event whose appointment is already terminal', () => {
    expect(
      decidePullAction(ev({ status: 'cancelled' }), appt({ status: 'COMPLETED' }), false),
    ).toEqual({ kind: 'skip' });
  });

  it('skips when the matched appointment already has the same time', () => {
    expect(decidePullAction(ev(), appt(), false)).toEqual({ kind: 'skip' });
  });

  it('reschedules the appointment when the Google event time changed', () => {
    const e = ev({ startIso: '2026-06-20T14:00:00.000Z', endIso: '2026-06-20T15:00:00.000Z' });
    expect(decidePullAction(e, appt(), false)).toEqual({
      kind: 'reschedule',
      appointmentId: 'appt1',
      startIso: '2026-06-20T14:00:00.000Z',
      durationMinutes: 60,
    });
  });

  it('does not touch a terminal appointment even if the event time differs', () => {
    const e = ev({ startIso: '2026-06-20T14:00:00.000Z', endIso: '2026-06-20T15:00:00.000Z' });
    expect(decidePullAction(e, appt({ status: 'CANCELLED' }), false)).toEqual({ kind: 'skip' });
  });

  it('imports a brand-new Google-created event as an appointment', () => {
    const a = decidePullAction(ev(), null, false);
    expect(a.kind).toBe('import');
    if (a.kind === 'import') {
      expect(a.startIso).toBe('2026-06-20T10:00:00.000Z');
      expect(a.durationMinutes).toBe(30);
      expect(a.title).toBe('Besichtigung – Max');
    }
  });

  it('skips importing when an unlinked appointment already exists at that slot (race guard)', () => {
    expect(decidePullAction(ev(), null, true)).toEqual({ kind: 'skip' });
  });

  it('skips all-day / malformed events with no start or end', () => {
    expect(decidePullAction(ev({ startIso: null, endIso: null }), null, false)).toEqual({
      kind: 'skip',
    });
  });
});
