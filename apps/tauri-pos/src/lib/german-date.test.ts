import { describe, expect, it } from 'vitest';

import { germanDateToIso, isoToGermanDate } from './german-date.js';

describe('germanDateToIso', () => {
  it('converts a typed German birthdate to ISO (the bug: 15.06.1990 was rejected)', () => {
    expect(germanDateToIso('15.06.1990')).toBe('1990-06-15');
  });

  it('pads single-digit day/month', () => {
    expect(germanDateToIso('1.6.1990')).toBe('1990-06-01');
  });

  it('tolerates / and - separators', () => {
    expect(germanDateToIso('15/06/1990')).toBe('1990-06-15');
    expect(germanDateToIso('15-06-1990')).toBe('1990-06-15');
  });

  it('passes an already-ISO date through', () => {
    expect(germanDateToIso('1990-06-15')).toBe('1990-06-15');
  });

  it('rejects impossible dates', () => {
    expect(germanDateToIso('31.02.1990')).toBeNull();
    expect(germanDateToIso('15.13.1990')).toBeNull();
    expect(germanDateToIso('00.06.1990')).toBeNull();
  });

  it('rejects empty / garbage', () => {
    expect(germanDateToIso('')).toBeNull();
    expect(germanDateToIso('   ')).toBeNull();
    expect(germanDateToIso('heute')).toBeNull();
    expect(germanDateToIso('15.06.90')).toBeNull(); // 2-digit year not allowed
  });
});

describe('isoToGermanDate', () => {
  it('renders ISO as TT.MM.JJJJ', () => {
    expect(isoToGermanDate('1990-06-15')).toBe('15.06.1990');
  });
  it('empty/null → empty', () => {
    expect(isoToGermanDate('')).toBe('');
    expect(isoToGermanDate(null)).toBe('');
    expect(isoToGermanDate(undefined)).toBe('');
  });

  it('round-trips with germanDateToIso', () => {
    expect(isoToGermanDate(germanDateToIso('15.06.1990'))).toBe('15.06.1990');
  });
});
