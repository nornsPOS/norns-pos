/**
 * Ein Bon wird ABGELESEN, nicht kopiert. Jeder Fall hier ist eine Art, wie ein
 * Mensch am Tresen eine Belegnummer wirklich eingibt.
 */
import { describe, expect, it } from 'vitest';

import { type BelegZeile, belegLeerMeldung, belegTrifft, filtereBelege } from './belegsuche.js';

const A: BelegZeile = {
  receiptLocator: 'B-2026-0042',
  totalEur: '119.00',
  finalizedAt: '2026-07-25T09:12:00Z',
};
const B: BelegZeile = {
  receiptLocator: 'B-2026-0107',
  totalEur: '512.50',
  finalizedAt: '2026-07-25T11:40:00Z',
};
const ALLE = [A, B];

describe('belegTrifft', () => {
  it('findet den Beleg, wie er gedruckt ist', () => {
    expect(belegTrifft(A, 'B-2026-0042')).toBe(true);
  });

  it('findet ihn ohne Bindestriche und in jeder Schreibweise', () => {
    expect(belegTrifft(A, 'b20260042')).toBe(true);
    expect(belegTrifft(A, 'B 2026 0042')).toBe(true);
  });

  it('findet ihn an den letzten Stellen — so wird abgelesen', () => {
    expect(belegTrifft(A, '0042')).toBe(true);
    expect(belegTrifft(A, '42')).toBe(true);
    expect(belegTrifft(B, '107')).toBe(true);
  });

  it('findet ihn am Betrag, an den sich Menschen erinnern', () => {
    expect(belegTrifft(A, '119')).toBe(true);
    expect(belegTrifft(B, '512,50')).toBe(true);
  });

  it('trifft NICHT auf einen fremden Beleg', () => {
    expect(belegTrifft(A, '0107')).toBe(false);
    expect(belegTrifft(B, '119')).toBe(false);
  });

  it('gibt bei leerer Suche jede Zeile frei', () => {
    expect(belegTrifft(A, '')).toBe(true);
    expect(belegTrifft(A, '   ')).toBe(true);
  });
});

describe('filtereBelege', () => {
  it('dampft auf die Treffer ein', () => {
    expect(filtereBelege(ALLE, '0042')).toEqual([A]);
    expect(filtereBelege(ALLE, '512')).toEqual([B]);
  });

  it('gibt bei leerer Suche ALLES zurück', () => {
    expect(filtereBelege(ALLE, '')).toEqual(ALLE);
  });

  it('verengt bei mehreren Wörtern', () => {
    expect(filtereBelege(ALLE, '2026 119')).toEqual([A]);
    expect(filtereBelege(ALLE, '0042 512')).toEqual([]);
  });
});

describe('belegLeerMeldung', () => {
  it('behauptet NIE, es gäbe keine Verkäufe, wenn nur die Suche nichts trifft', () => {
    const m = belegLeerMeldung('xyz', 8);
    expect(m).toContain('Zu „xyz" nichts gefunden');
    expect(m).toContain('8 Verkäufe liegen');
    expect(m).not.toBe('Keine Verkäufe in den letzten 24 Stunden.');
  });

  it('sagt ohne Suche die schlichte Wahrheit', () => {
    expect(belegLeerMeldung('', 0)).toBe('Keine Verkäufe in den letzten 24 Stunden.');
  });

  it('beugt die Einzahl richtig', () => {
    expect(belegLeerMeldung('xyz', 1)).toContain('Ein Verkauf liegt');
  });
});
