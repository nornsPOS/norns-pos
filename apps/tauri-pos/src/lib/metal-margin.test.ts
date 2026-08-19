/**
 * metal-margin — pure preview of the server's Ankauf derivation.
 *
 * The SERVER is the source of truth: `ankauf = ROUND(avg10d × (1 − margin), 4)`
 * (routes/metal-prices.ts, NUMERIC, half-away-from-zero). This mirrors it so the
 * margin editor can show the effect live AS YOU TYPE — the authoritative value
 * still comes from the server refetch after save. Money stays a string.
 *
 * 19.08.2026: die Marge kommt als PROZENT-ZEICHENKETTE (der rohe Feldinhalt),
 * und die Rechnung laeuft in BigInt — exakt wie SQL, ohne Gleitkomma, ohne
 * den alten 1e-9-Schubs.
 */
import { describe, expect, it } from 'vitest';

import { deriveAnkaufPerGram, formatPerGram } from './metal-margin.js';

describe('deriveAnkaufPerGram', () => {
  it('applies (1 − margin) and rounds to 4dp like the server', () => {
    expect(deriveAnkaufPerGram('100.0000', '10')).toBe('90.0000');
    expect(deriveAnkaufPerGram('0.5000', '10')).toBe('0.4500');
  });

  it('matches the SQL ROUND(…,4) on a fractional margin', () => {
    // 65.4321 × 0.875 = 57.2530875 → 4dp → 57.2531
    expect(deriveAnkaufPerGram('65.4321', '12.5')).toBe('57.2531');
  });

  it('rounds halves away from zero (server NUMERIC ROUND)', () => {
    // 1.00005 × (1 − 0) = 1.00005 → 4dp → 1.0001
    expect(deriveAnkaufPerGram('1.00005', '0')).toBe('1.0001');
  });

  it('trifft echte Haelften EXAKT — beweisbar, nicht per Epsilon-Argument', () => {
    // 8.2015 × 0.9 = 7.38135 — eine echte Haelfte auf der 4. Stelle.
    //
    // EHRLICH GEMESSEN (19.08.2026, node): die alte Gleitkomma-Fassung traf
    // diesen Fall AUCH richtig — sogar ohne ihren 1e-9-Schubs, weil die
    // Multiplikation selbst auf die darstellbare 73813.5 rundet. Es gibt
    // keinen nachgewiesenen Fall, in dem die alte Vorschau je falsch stand.
    // Der Gewinn von BigInt ist nicht ein reparierter Fehler, sondern dass
    // die Richtigkeit nicht mehr von einer Epsilon-Abschaetzung ABHAENGT,
    // die bei jeder Aenderung der Stellenzahl neu zu fuehren waere.
    expect(deriveAnkaufPerGram('8.2015', '10')).toBe('7.3814');
    // Gegenprobe, dass keine Nicht-Haelfte hochgezogen wird:
    // 8.2014 × 0.9 = 7.38126 → 7.3813.
    expect(deriveAnkaufPerGram('8.2014', '10')).toBe('7.3813');
  });

  it('0% margin = the base; 100% margin = zero', () => {
    expect(deriveAnkaufPerGram('100', '0')).toBe('100.0000');
    expect(deriveAnkaufPerGram('100', '100')).toBe('0.0000');
  });

  it('null / non-numeric base → null (no fabricated number)', () => {
    expect(deriveAnkaufPerGram(null, '10')).toBeNull();
    expect(deriveAnkaufPerGram('', '10')).toBeNull();
    expect(deriveAnkaufPerGram('abc', '10')).toBeNull();
  });

  it('leere / unlesbare / negative Marge → null', () => {
    expect(deriveAnkaufPerGram('100', '')).toBeNull();
    expect(deriveAnkaufPerGram('100', 'zehn')).toBeNull();
    expect(deriveAnkaufPerGram('100', null)).toBeNull();
    // Eine negative Marge ist keine Marge — kein erfundener Aufschlag.
    expect(deriveAnkaufPerGram('100', '-5')).toBeNull();
  });
});

describe('formatPerGram', () => {
  it('formats a decimal string as German €/g', () => {
    expect(formatPerGram('90.0000')).toBe('90,00 €/g');
    expect(formatPerGram('57.2531')).toBe('57,2531 €/g');
  });

  it('null renders a hyphen placeholder (house style: no em dash)', () => {
    expect(formatPerGram(null)).toBe('-');
  });
});
