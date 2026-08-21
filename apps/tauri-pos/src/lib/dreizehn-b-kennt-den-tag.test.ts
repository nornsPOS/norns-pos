/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ § 13b rechnet den Nettobetrag mit dem Satz DES TAGES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 21.08.2026 ──────────────────────────────────────────────
 *
 * Am 20.08. wurden die festen Steuersätze an vier Stellen durch `satzAm` aus
 * `@norns/domain` ersetzt. In `cart-math.ts` hat die Umstellung EINE Zeile
 * übersehen — ausgerechnet die des Reverse-Charge:
 *
 *     const subtotal = roundHalfEven(total * 100n, 119n);
 *
 * Jeder Nachbarfall in derselben Verzweigung fragt `bruttoBruch(satzAm(...))`;
 * nur dieser rechnete weiter mit fest verdrahteten 19 Prozent.
 *
 * ── WARUM DAS BEI § 13b BESONDERS WEHTUT ───────────────────────────────────
 *
 * Beim Reverse-Charge weist der Verkäufer KEINE Steuer aus — der Käufer
 * schuldet sie und rechnet sie sich selbst auf den NETTObetrag. Ist das Netto
 * falsch, ist die Steuerschuld des KÄUFERS falsch, und auf dem Beleg steht
 * keine Steuer, an der man es merken könnte.
 *
 * Im Corona-Halbjahr 2020 (16 statt 19 Prozent) ergäbe das aus einem
 * Bruttobetrag von 1.190,00 EUR ein Netto von 1.000,00 statt 1.025,86 — also
 * 25,86 EUR zu wenig, jeder Beleg still.
 */

import { describe, expect, it } from 'vitest';

import { computeLineMath } from './cart-math.js';

/** Eine § 13b-Zeile mit dem gegebenen Bruttopreis, an einem bestimmten Tag. */
function zeile(bruttoEur: string, tag: string) {
  return computeLineMath({
    taxTreatmentCode: 'REVERSE_CHARGE_13B',
    listPriceEur: bruttoEur,
    acquisitionCostEur: '0.00',
    tag,
  });
}

describe('⛔ § 13b kennt den Tag', () => {
  it('heute (19 %): 1.190,00 brutto ergibt 1.000,00 netto', () => {
    const r = zeile('1190.00', '2026-08-21');
    expect(r.lineSubtotalCents).toBe(100_000n);
    // Beim Reverse-Charge weist der Verkaeufer NIE Steuer aus.
    expect(r.lineVatCents).toBe(0n);
    expect(r.appliedVatRate).toBe('0.0000');
  });

  it('⛔ im Corona-Halbjahr 2020 (16 %): dasselbe Brutto ergibt 1.025,86 netto', () => {
    // 119000 * 100 / 116 = 102586,2… → kaufmaennisch 102586
    const r = zeile('1190.00', '2020-09-01');
    expect(r.lineSubtotalCents).toBe(102_586n);
    expect(r.lineVatCents).toBe(0n);
  });

  it('⛔ und an der Satzgrenze zum 01.01.2021 springt es zurueck', () => {
    expect(zeile('1190.00', '2020-12-31').lineSubtotalCents).toBe(102_586n);
    expect(zeile('1190.00', '2021-01-01').lineSubtotalCents).toBe(100_000n);
  });

  it('das Netto ist zugleich die Zeilensumme — ohne Steuer gibt es nichts daneben', () => {
    const r = zeile('1190.00', '2026-08-21');
    expect(r.lineTotalCents).toBe(r.lineSubtotalCents);
  });
});
