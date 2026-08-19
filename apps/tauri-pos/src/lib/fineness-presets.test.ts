import { describe, expect, it } from 'vitest';

import { finenessPresets, matchesPreset } from './fineness-presets.js';

describe('finenessPresets', () => {
  it('offers the German gold stamps', () => {
    const labels = finenessPresets('gold').map((p) => p.label);
    expect(labels).toEqual(['333', '375', '585', '750', '900', '916', '999']);
  });

  it('keeps karat and fineness in lockstep', () => {
    for (const metal of ['gold', 'silver', 'platinum', 'palladium'] as const) {
      for (const preset of finenessPresets(metal)) {
        const fromLabel = Number.parseInt(preset.label, 10) / 1000;
        expect(Number.parseFloat(preset.finenessDecimal)).toBeCloseTo(fromLabel, 3);
        expect(preset.karatCode).toContain(preset.label);
      }
    }
  });

  it('never proposes a fineness outside zero to one', () => {
    for (const metal of ['gold', 'silver', 'platinum', 'palladium'] as const) {
      for (const preset of finenessPresets(metal)) {
        const n = Number.parseFloat(preset.finenessDecimal);
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(1);
      }
    }
  });

  it('returns nothing when no metal is chosen', () => {
    expect(finenessPresets('')).toEqual([]);
    expect(finenessPresets(null)).toEqual([]);
    expect(finenessPresets(undefined)).toEqual([]);
  });
});

describe('matchesPreset', () => {
  const k585 = { label: '585', karatCode: 'K585', finenessDecimal: '0.585' };

  it('matches the exact pair, case-insensitively on the karat code', () => {
    expect(matchesPreset(k585, 'K585', '0.585')).toBe(true);
    expect(matchesPreset(k585, ' k585 ', '0.5850')).toBe(true);
  });

  it('does not match when only one half agrees', () => {
    expect(matchesPreset(k585, 'K585', '0.750')).toBe(false);
    expect(matchesPreset(k585, 'K750', '0.585')).toBe(false);
  });

  it('does not match empty fields', () => {
    expect(matchesPreset(k585, '', '')).toBe(false);
  });
});
