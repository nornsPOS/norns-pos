/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Beleg widerspricht sich nicht selbst
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 ──────────────────────────────────────────────
 *
 * Beim Ausbauen von `BezahlenDialog.tsx` gefunden: die Rechtshinweise nannten
 * den Steuersatz als FESTEN Text.
 *
 *     'Im Preis ist die gesetzliche Umsatzsteuer von 19 % … enthalten.'
 *
 * Am selben Tag hatte ich die Sätze datumsabhängig gemacht. Die RECHNUNG
 * stimmte danach — der Satz DARUNTER auf dem Papier hätte weiter 19
 * behauptet. Bei einem Beleg aus dem Corona-Halbjahr 2020 stünde damit auf
 * demselben Zettel eine Steuer von 16 Prozent und ein Hinweis mit 19.
 *
 * § 14 Abs. 4 UStG verlangt den zutreffenden Steuersatz. Ein Beleg, der sich
 * selbst widerspricht, ist bei einer Kassennachschau kein Schönheitsfehler.
 */

import { describe, expect, it } from 'vitest';

import { steuerhinweiseFuerBeleg } from './steuertexte.js';

describe('⛔ Der Rechtshinweis nennt den Satz des TAGES', () => {
  it('heute: 19 und 7 Prozent', () => {
    expect(steuerhinweiseFuerBeleg(['STANDARD_19'], '2026-08-20')[0]).toContain('19 %');
    expect(steuerhinweiseFuerBeleg(['REDUCED_7'], '2026-08-20')[0]).toContain('7 %');
  });

  it('⛔ im Corona-Halbjahr 2020: 16 und 5 Prozent', () => {
    // Genau der Beleg, auf dem sonst zwei verschiedene Sätze gestanden hätten.
    expect(steuerhinweiseFuerBeleg(['STANDARD_19'], '2020-09-01')[0]).toContain('16 %');
    expect(steuerhinweiseFuerBeleg(['STANDARD_19'], '2020-09-01')[0]).not.toContain('19 %');
    expect(steuerhinweiseFuerBeleg(['REDUCED_7'], '2020-09-01')[0]).toContain('5 %');
  });

  it('nennt weiterhin den Paragrafen', () => {
    expect(steuerhinweiseFuerBeleg(['STANDARD_19'], '2026-08-20')[0]).toContain('§ 12 Abs. 1');
    expect(steuerhinweiseFuerBeleg(['REDUCED_7'], '2026-08-20')[0]).toContain('§ 12 Abs. 2');
  });

  it('⛔ die Sonderregelungen nennen KEINEN Satz — sie hängen an keinem', () => {
    for (const tag of ['2020-09-01', '2026-08-20']) {
      const a = steuerhinweiseFuerBeleg(['MARGIN_25A'], tag)[0]!;
      const g = steuerhinweiseFuerBeleg(['INVESTMENT_GOLD_25C'], tag)[0]!;
      const r = steuerhinweiseFuerBeleg(['REVERSE_CHARGE_13B'], tag)[0]!;
      expect(a).toContain('§ 25a');
      expect(a).not.toMatch(/\d+ %/);
      expect(g).toContain('§ 25c');
      expect(g).not.toMatch(/\d+ %/);
      expect(r).toContain('13b');
      expect(r).not.toMatch(/\d+ %/);
    }
  });

  it('ein Beleg mit mehreren Schlüsseln trägt jeden Hinweis EINMAL', () => {
    const h = steuerhinweiseFuerBeleg(
      ['STANDARD_19', 'MARGIN_25A', 'STANDARD_19'],
      '2026-08-20',
    );
    expect(h).toHaveLength(2);
  });

  it('ein unbekannter Schlüssel erfindet keinen Hinweis', () => {
    expect(steuerhinweiseFuerBeleg(['GIBT_ES_NICHT'], '2026-08-20')).toEqual([]);
    expect(steuerhinweiseFuerBeleg([], '2026-08-20')).toEqual([]);
  });
});
