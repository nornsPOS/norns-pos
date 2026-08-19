/**
 * metal-tick — pure formatting behind the metal-price ticker cell (UX §3.A).
 * No facade: the Δ sign/tone is computed from real current-vs-prior; German
 * comma in, German comma out. The view consumes this; it owns no React.
 */
import { describe, expect, it } from 'vitest';

import { formatMetalTick } from './metal-tick.js';

describe('formatMetalTick', () => {
  it('up → verdigris tone with a + delta, German-comma price', () => {
    const t = formatMetalTick('62.50', '60.00');
    expect(t.tone).toBe('up');
    expect(t.price).toBe('62,50');
    expect(t.deltaLabel.startsWith('+')).toBe(true);
  });

  it('down → wax-red tone with a − delta', () => {
    const t = formatMetalTick('58.00', '60.00');
    expect(t.tone).toBe('down');
    expect(t.deltaLabel.includes('−')).toBe(true);
    expect(t.price).toBe('58,00');
  });

  /**
   * ⚠️ 04.08.2026: HIER STAND EIN SATZ, DER DEN FEHLER BESCHUETZTE.
   *
   * Er hiess „tolerating German-comma inputs" und reichte `'58,00'` herein.
   * Um das zu koennen, musste die Zerlegung RATEN, und genau dieses Raten
   * machte aus dem Goldkurs `113.8664` die Zahl `1138664`. Auf Basels Schirm
   * stand daraufhin GOLD 1138664,00 €/g.
   *
   * Nachgezaehlt, bevor der Satz fiel: `formatMetalTick` hat genau ZWEI
   * Aufrufer, beide im Kursstreifen, beide mit `currentPricePerGramEur` und
   * `avg10dPricePerGramEur`. Die kommen aus einer SQL-Funktion als
   * `numeric`, also IMMER mit Punkt. Ein deutsches Komma hat dort nie
   * angeklopft.
   *
   * Der Satz sicherte also eine Faehigkeit, die niemand braucht, und diese
   * Faehigkeit war der Defekt. Ein Waechter, der eine Umsetzung festnagelt
   * statt einer Eigenschaft, kann genau so teuer werden.
   *
   * Er steht jetzt umgedreht da.
   */
  it('⛔ ein deutsches Komma ist KEINE Motorzahl und wird nicht geraten', () => {
    const t = formatMetalTick('58,00', '60,00');
    expect(t.price, 'ein Komma wurde geraten statt abgewiesen').toBe('-');
  });

  it('flat → neutral tone when current equals prior', () => {
    expect(formatMetalTick('60.00', '60.00').tone).toBe('flat');
  });

  it('missing / zero prior → neutral, no divide-by-zero, no delta label', () => {
    expect(formatMetalTick('60.00', null).tone).toBe('flat');
    expect(formatMetalTick('60.00', null).deltaLabel).toBe('');
    expect(formatMetalTick('60.00', '0').tone).toBe('flat');
  });

  it('missing current renders a hyphen placeholder price, neutral tone', () => {
    const t = formatMetalTick(null, '60.00');
    expect(t.price).toBe('-');
    expect(t.tone).toBe('flat');
  });
});
