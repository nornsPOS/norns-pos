import { describe, expect, it } from 'vitest';

import { DEFAULT_NO_SHOW_GRACE_MINUTES, graceDeadline, isPastGrace } from '../src/index.js';

describe('no-show grace', () => {
  const startsAt = new Date('2026-05-29T10:00:00Z');

  it('default grace is 30 minutes', () => {
    expect(DEFAULT_NO_SHOW_GRACE_MINUTES).toBe(30);
    expect(graceDeadline(startsAt).getTime()).toBe(startsAt.getTime() + 30 * 60 * 1000);
  });

  it('isPastGrace flips only after the grace window elapses', () => {
    expect(isPastGrace(startsAt, 30, new Date('2026-05-29T10:29:59Z'))).toBe(false);
    expect(isPastGrace(startsAt, 30, new Date('2026-05-29T10:30:00Z'))).toBe(false); // boundary: not yet past
    expect(isPastGrace(startsAt, 30, new Date('2026-05-29T10:30:01Z'))).toBe(true);
  });

  it('honors a custom grace window', () => {
    expect(isPastGrace(startsAt, 15, new Date('2026-05-29T10:16:00Z'))).toBe(true);
    expect(isPastGrace(startsAt, 60, new Date('2026-05-29T10:45:00Z'))).toBe(false);
  });
});
