/**
 * @norns/auth-pin — unit tests.
 *
 * The package is pure functions + a wrapper around @node-rs/argon2. Tests run
 * in-process; no testcontainers needed.
 */

import { describe, expect, it } from 'vitest';

import {
  type AttemptState,
  PIN_FAILED_THRESHOLD,
  PIN_LOCKOUT_MINUTES,
  PinPolicy,
  decideAttemptOutcome,
  hashPin,
  verifyPin,
} from '../src/index.js';

describe('PinPolicy.validate', () => {
  it('accepts a well-formed non-blacklisted PIN', () => {
    expect(PinPolicy.validate('583927', { enforceBlacklist: true })).toBeNull();
  });

  it('rejects wrong length (too short / too long)', () => {
    expect(PinPolicy.validate('123', { enforceBlacklist: true })).toMatchObject({
      code: 'WRONG_LENGTH',
    });
    expect(PinPolicy.validate('12345', { enforceBlacklist: true })).toMatchObject({
      code: 'WRONG_LENGTH',
    });
    expect(PinPolicy.validate('1234567890123', { enforceBlacklist: true })).toMatchObject({
      code: 'WRONG_LENGTH',
    });
    expect(PinPolicy.validate('', { enforceBlacklist: true })).toMatchObject({
      code: 'WRONG_LENGTH',
    });
  });

  it('rejects non-numeric', () => {
    expect(PinPolicy.validate('12a456', { enforceBlacklist: true })).toMatchObject({
      code: 'NON_NUMERIC',
    });
    expect(PinPolicy.validate('abcdef', { enforceBlacklist: true })).toMatchObject({
      code: 'NON_NUMERIC',
    });
    expect(PinPolicy.validate('12-456', { enforceBlacklist: true })).toMatchObject({
      code: 'NON_NUMERIC',
    });
  });

  it.each(['000000', '111111', '999999', '123456', '456789', '987654', '543210'])(
    'rejects blacklisted PIN %s when enforceBlacklist=true',
    (pin) => {
      expect(PinPolicy.validate(pin, { enforceBlacklist: true })).toMatchObject({
        code: 'BLACKLISTED',
      });
    },
  );

  it('accepts blacklisted PIN 000000 when enforceBlacklist=false (dev mode)', () => {
    expect(PinPolicy.validate('000000', { enforceBlacklist: false })).toBeNull();
  });

  it('blacklist getter is non-empty', () => {
    expect(PinPolicy.blacklist.length).toBeGreaterThan(20);
  });
});

describe('hashPin + verifyPin', () => {
  it('hashed PIN round-trips through verify', async () => {
    const hashed = await hashPin('5839');
    expect(hashed).toMatch(/^\$argon2id\$/);
    expect(await verifyPin('5839', hashed)).toBe(true);
  });

  it('verify returns false for a different PIN', async () => {
    const hashed = await hashPin('5839');
    expect(await verifyPin('5840', hashed)).toBe(false);
  });

  it('verify returns false for a malformed stored hash (does not throw)', async () => {
    expect(await verifyPin('5839', 'not-an-argon-hash')).toBe(false);
    expect(await verifyPin('5839', '')).toBe(false);
  });

  it('two hashes of the same PIN differ (salt is random)', async () => {
    const a = await hashPin('5839');
    const b = await hashPin('5839');
    expect(a).not.toBe(b);
    // …but both verify.
    expect(await verifyPin('5839', a)).toBe(true);
    expect(await verifyPin('5839', b)).toBe(true);
  });
});

describe('decideAttemptOutcome — state machine', () => {
  const now = new Date('2026-05-25T12:00:00Z');

  function freshState(overrides: Partial<AttemptState> = {}): AttemptState {
    return { failedAttempts: 0, lockedUntil: null, ...overrides };
  }

  it('correct PIN on fresh state → success, counter reset', () => {
    const out = decideAttemptOutcome({ state: freshState(), now, pinCorrect: true });
    expect(out.kind).toBe('success');
    if (out.kind === 'success') {
      expect(out.newState).toEqual({ failedAttempts: 0, lockedUntil: null });
    }
  });

  it('wrong PIN on fresh state → failed, counter=1', () => {
    const out = decideAttemptOutcome({ state: freshState(), now, pinCorrect: false });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.newState.failedAttempts).toBe(1);
      expect(out.newState.lockedUntil).toBeNull();
    }
  });

  it('wrong PIN at threshold-1 → failed_now_locked, locked +30min', () => {
    const state = freshState({ failedAttempts: PIN_FAILED_THRESHOLD - 1 });
    const out = decideAttemptOutcome({ state, now, pinCorrect: false });
    expect(out.kind).toBe('failed_now_locked');
    if (out.kind === 'failed_now_locked') {
      expect(out.newState.failedAttempts).toBe(PIN_FAILED_THRESHOLD);
      expect(out.newState.lockedUntil).toEqual(
        new Date(now.getTime() + PIN_LOCKOUT_MINUTES * 60_000),
      );
      expect(out.auditEventType).toBe('auth.pin_locked');
    }
  });

  it('correct PIN while currently locked → already_locked (does not even verify)', () => {
    const state = freshState({
      failedAttempts: 5,
      lockedUntil: new Date(now.getTime() + 10 * 60_000),
    });
    const out = decideAttemptOutcome({ state, now, pinCorrect: true });
    expect(out.kind).toBe('already_locked');
    if (out.kind === 'already_locked') {
      expect(out.until).toEqual(state.lockedUntil);
    }
  });

  it('correct PIN after lockout expired → success, lock cleared', () => {
    const state = freshState({
      failedAttempts: 5,
      lockedUntil: new Date(now.getTime() - 60_000), // expired 1 min ago
    });
    const out = decideAttemptOutcome({ state, now, pinCorrect: true });
    expect(out.kind).toBe('success');
    if (out.kind === 'success') {
      expect(out.newState).toEqual({ failedAttempts: 0, lockedUntil: null });
    }
  });

  it('wrong PIN after lockout expired → resets to 1 (fresh budget), no immediate re-lock', () => {
    const state = freshState({
      failedAttempts: 5,
      lockedUntil: new Date(now.getTime() - 60_000),
    });
    const out = decideAttemptOutcome({ state, now, pinCorrect: false });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.newState.failedAttempts).toBe(1);
      expect(out.newState.lockedUntil).toBeNull();
    }
  });
});
