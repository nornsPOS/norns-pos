import { describe, expect, it } from 'vitest';

import {
  type NotificationType,
  computeReminderSchedule,
  whatsappReminderMode,
} from '../src/index.js';

describe('whatsappReminderMode (24h window)', () => {
  const now = new Date('2026-05-29T12:00:00Z');
  it('free-form when the customer messaged within 24h', () => {
    expect(whatsappReminderMode(new Date('2026-05-29T11:00:00Z'), now)).toBe('freeform');
    expect(whatsappReminderMode(new Date('2026-05-28T12:00:01Z'), now)).toBe('freeform');
  });
  it('template when outside the 24h window or never messaged', () => {
    expect(whatsappReminderMode(new Date('2026-05-28T11:59:59Z'), now)).toBe('template');
    expect(whatsappReminderMode(null, now)).toBe('template');
  });
});

describe('computeReminderSchedule', () => {
  const now = new Date('2026-05-29T08:00:00Z');
  const startsAt = new Date('2026-05-31T10:00:00Z'); // ~2 days out

  function types(rows: { notificationType: NotificationType }[]): NotificationType[] {
    return rows.map((r) => r.notificationType);
  }

  it('schedules the full cadence when email + phone are present', () => {
    const rows = computeReminderSchedule({
      startsAt,
      recipientEmail: 'k@example.de',
      recipientPhone: '+491700000000',
      now,
    });
    const t = types(rows);
    expect(t.filter((x) => x === 'booking_confirmation')).toHaveLength(2); // email + whatsapp
    expect(t).toContain('reminder_24h');
    expect(t).toContain('reminder_2h');
    expect(t).toContain('reminder_30min');

    const sse = rows.find((r) => r.notificationType === 'reminder_30min');
    expect(sse?.channel).toBe('sse');
    expect(sse?.recipient).toBe('pos');
    expect(sse?.scheduledFor.getTime()).toBe(startsAt.getTime() - 30 * 60 * 1000);

    const t2 = rows.find((r) => r.notificationType === 'reminder_2h');
    expect(t2?.channel).toBe('whatsapp');
    expect(t2?.templateId).toBe('reminder_2h_v1');
  });

  it('skips WhatsApp rows when there is no phone', () => {
    const rows = computeReminderSchedule({ startsAt, recipientEmail: 'k@example.de', now });
    expect(rows.every((r) => r.channel !== 'whatsapp')).toBe(true);
    // Email confirmation + email 24h + sse 30min.
    expect(types(rows)).toEqual(['booking_confirmation', 'reminder_24h', 'reminder_30min']);
  });

  it('drops reminder offsets already in the past', () => {
    const soon = new Date(now.getTime() + 90 * 60 * 1000); // 90 min away
    const rows = computeReminderSchedule({ startsAt: soon, recipientPhone: '+491700000000', now });
    // T-24h and T-2h are in the past; only the immediate confirmation + T-30min remain.
    expect(types(rows)).toEqual(['booking_confirmation', 'reminder_30min']);
  });
});
