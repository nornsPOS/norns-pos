import { describe, expect, it } from 'vitest';

import { classifyPinAttempt } from '../../src/lib/duress.js';

describe('classifyPinAttempt — duress PIN classification (Decision #37)', () => {
  it('normal POS PIN → correct, not duress', () => {
    expect(classifyPinAttempt({ matchesPos: true, matchesDuress: false })).toEqual({
      pinCorrect: true,
      isDuress: false,
    });
  });

  it('duress PIN → correct (no lockout tick) AND duress (fire the alarm)', () => {
    expect(classifyPinAttempt({ matchesPos: false, matchesDuress: true })).toEqual({
      pinCorrect: true,
      isDuress: true,
    });
  });

  it('wrong PIN → not correct (lockout counter ticks), not duress', () => {
    expect(classifyPinAttempt({ matchesPos: false, matchesDuress: false })).toEqual({
      pinCorrect: false,
      isDuress: false,
    });
  });

  it('both match (DB-impossible) → correct but NOT a false alarm', () => {
    expect(classifyPinAttempt({ matchesPos: true, matchesDuress: true })).toEqual({
      pinCorrect: true,
      isDuress: false,
    });
  });
});
