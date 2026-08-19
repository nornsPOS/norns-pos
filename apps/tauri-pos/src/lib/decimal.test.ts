import { describe, expect, it } from 'vitest';

import {
  formatEur,
  formatGrams,
  germanMoneyToDot,
  isMoneyInput,
  isWeightInput,
  normalizeDecimal,
} from './decimal.js';

describe('germanMoneyToDot — "." = thousands, "," = decimal (the appraisal bug)', () => {
  it('keeps a thousands amount whole (was "1.500" → "1.50")', () => {
    expect(germanMoneyToDot('1.500')).toBe('1500');
    expect(germanMoneyToDot('1.500,50')).toBe('1500.50');
    expect(germanMoneyToDot('12.345,67')).toBe('12345.67');
  });
  it('handles plain + comma-decimal', () => {
    expect(germanMoneyToDot('1500')).toBe('1500');
    expect(germanMoneyToDot('1500,50')).toBe('1500.50');
    expect(germanMoneyToDot('7,95')).toBe('7.95');
  });
});

describe('formatGrams', () => {
  it('strips trailing zeros (the bug: 300 g showed as 300,0000)', () => {
    expect(formatGrams('300.0000')).toBe('300');
  });
  it('keeps real 3-dp gold weight with a German comma', () => {
    expect(formatGrams('7.965')).toBe('7,965');
  });
  it('trims to the significant fraction', () => {
    expect(formatGrams('12.50')).toBe('12,5');
  });
  it('empty/garbage → empty', () => {
    expect(formatGrams('')).toBe('');
    expect(formatGrams(null)).toBe('');
    expect(formatGrams('abc')).toBe('');
  });
});

describe('formatEur', () => {
  it('always 2 decimals, German comma', () => {
    expect(formatEur('300.00')).toBe('300,00');
    expect(formatEur('300')).toBe('300,00');
  });
  it('adds the thousands dot', () => {
    expect(formatEur('1234.5')).toBe('1.234,50');
  });
  it('empty/garbage → empty', () => {
    expect(formatEur('')).toBe('');
    expect(formatEur(null)).toBe('');
  });
});

describe('isWeightInput (3-dp, not 2)', () => {
  it('accepts a real gold weight the 2-dp money validator rejected', () => {
    expect(isWeightInput('7,965')).toBe(true);
    expect(isWeightInput('300')).toBe(true);
  });
  it('truncates a 4th fraction digit (consistent with money), rejects garbage', () => {
    expect(isWeightInput('7,9651')).toBe(true); // normalized to 7,965 then accepted
    expect(isWeightInput('abc')).toBe(false);
    expect(isWeightInput('')).toBe(false);
  });
});

describe('⛔ Ein getipptes Minus wird abgewiesen, nicht begradigt (19.08.2026)', () => {
  /*
   * Der Fund der boeswilligen Pruefung: `vereinheitlicheTrenner` warf das
   * Minus als Fremdzeichen weg, aus '-50' wurde '50', und isMoneyInput gab
   * gruen. An der Rabattzeile wurde daraus ein 50-EUR-Rabatt.
   */
  it('isMoneyInput sagt NEIN zu jeder Schreibweise des Minus', () => {
    for (const roh of ['-50', '−50', '– 50', '-0', '-0,01', '-1.234,56']) {
      expect(isMoneyInput(roh), `${roh} ging durch`).toBe(false);
    }
  });

  it('das Gewicht ebenso — eine negative Grammzahl gibt es nicht', () => {
    expect(isWeightInput('-12,345')).toBe(false);
  });

  it('positive Eingaben bleiben unberuehrt', () => {
    expect(isMoneyInput('50')).toBe(true);
    expect(isMoneyInput('1.234,56')).toBe(true);
    expect(normalizeDecimal('1.234,56')).toBe('1234.56');
  });
});
