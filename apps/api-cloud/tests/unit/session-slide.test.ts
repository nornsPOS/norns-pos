/**
 * Die gleitende Erneuerung darf nicht bei jedem Request schreiben, sondern erst,
 * wenn die Sitzung mindestens einen Takt ihrer Lebenszeit verbraucht hat —
 * sonst wird „rolling" zur Schreib-Lawine.
 */
import { describe, expect, it } from 'vitest';

import { SESSION_SLIDE_GAP_MS, shouldSlide } from '../../src/lib/session-ttl.js';

const TTL = 8 * 60 * 60_000; // 8 Std.

describe('shouldSlide', () => {
  it('erneuert NICHT direkt nach der Ausgabe (frische Sitzung)', () => {
    const now = Date.UTC(2026, 6, 24, 12, 0, 0);
    const expiresAt = new Date(now + TTL); // voll frisch
    expect(shouldSlide(expiresAt, TTL, now)) .toBe(false);
  });

  it('erneuert NICHT, solange weniger als ein Takt verbraucht ist', () => {
    const now = Date.UTC(2026, 6, 24, 12, 0, 0);
    // Erst wenige Minuten alt (weniger als der Gap).
    const expiresAt = new Date(now + TTL - (SESSION_SLIDE_GAP_MS - 60_000));
    expect(shouldSlide(expiresAt, TTL, now)).toBe(false);
  });

  it('erneuert, sobald mehr als ein Takt verbraucht ist', () => {
    const now = Date.UTC(2026, 6, 24, 12, 0, 0);
    const expiresAt = new Date(now + TTL - (SESSION_SLIDE_GAP_MS + 60_000));
    expect(shouldSlide(expiresAt, TTL, now)).toBe(true);
  });

  it('erneuert eine fast abgelaufene Sitzung', () => {
    const now = Date.UTC(2026, 6, 24, 12, 0, 0);
    const expiresAt = new Date(now + 60_000); // noch 1 Min.
    expect(shouldSlide(expiresAt, TTL, now)).toBe(true);
  });
});
