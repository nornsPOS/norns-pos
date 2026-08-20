/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Steuersatz hängt am TAG — auch in der Kasse
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 (Basels Prüfbericht) ────────────────────────
 *
 * `cart-math.ts` trug die Sätze als feste Zahlen: `19n/119n`, `7n/107n` und
 * die Zeichenketten `'0.1900'`, `'0.0700'`. Am Tag einer Gesetzesänderung
 * hätte die Kasse den neuen Satz nicht buchen können.
 *
 * Dass das kein Gedankenspiel ist: Deutschland hat den Regelsatz 2020 für ein
 * halbes Jahr auf 16 gesenkt (ermässigt auf 5). § 147 AO verlangt zehn Jahre
 * Aufbewahrung — von 2026 aus liegt dieses Halbjahr mitten in der Frist.
 *
 * ── WAS DIESER WÄCHTER HÄLT ────────────────────────────────────────────────
 *
 *   1. Die Kasse rechnet mit dem Satz des TAGES.
 *   2. Sie schreibt denselben Satz in `appliedVatRate`, den sie gerechnet hat.
 *   3. Und sie rechnet DASSELBE wie der Motor — sonst weist er ihren eigenen
 *      Beleg ab.
 */

import { describe, expect, it } from 'vitest';

import { computeLineMath, harmonisiereUstJeSatz } from './cart-math.js';

describe('⛔ Die Kasse rechnet mit dem Satz des Tages', () => {
  const zeile = (tag: string, code: 'STANDARD_19' | 'REDUCED_7' = 'STANDARD_19') =>
    computeLineMath({
      taxTreatmentCode: code,
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
      tag,
    });

  it('heute: 19 Prozent aus 119,00 sind 19,00', () => {
    const m = zeile('2026-08-20');
    expect(m.lineVatCents).toBe(1900n);
    expect(m.appliedVatRate).toBe('0.1900');
  });

  it('⛔ im Corona-Halbjahr 2020: 16 Prozent, und der Satz steht auch so im Beleg', () => {
    const m = zeile('2020-09-01');
    // 119,00 brutto bei 16 % → 119,00 × 16/116 = 16,41
    expect(m.lineVatCents).toBe(1641n);
    expect(m.appliedVatRate).toBe('0.1600');
    expect(m.lineSubtotalCents + m.lineVatCents).toBe(m.lineTotalCents);
  });

  it('⛔ der ermässigte Satz ebenso: 7 heute, 5 im Halbjahr', () => {
    expect(zeile('2026-08-20', 'REDUCED_7').appliedVatRate).toBe('0.0700');
    expect(zeile('2020-09-01', 'REDUCED_7').appliedVatRate).toBe('0.0500');
  });

  it('⛔ § 25a besteuert die Marge mit dem REGELSATZ des Tages', () => {
    const heute = computeLineMath({
      taxTreatmentCode: 'MARGIN_25A',
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
      tag: '2026-08-20',
    });
    const damals = computeLineMath({
      taxTreatmentCode: 'MARGIN_25A',
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
      tag: '2020-09-01',
    });
    expect(heute.lineVatCents).toBe(1900n);
    expect(damals.lineVatCents).toBe(1641n);
    // Der Satz bleibt `null`: bei § 25a liegt die Steuer nicht auf dem Entgelt.
    expect(heute.appliedVatRate).toBeNull();
    expect(damals.appliedVatRate).toBeNull();
  });

  it('ohne Tagesangabe gilt heute — und das ist der einzige Fall der Kasse', () => {
    const ohne = computeLineMath({
      taxTreatmentCode: 'STANDARD_19',
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
    });
    expect(ohne.appliedVatRate).toBe(zeile('2026-08-20').appliedVatRate);
  });
});

describe('⛔ Die Belegharmonisierung kann JEDEN Satz', () => {
  it('⛔ auch 16 Prozent — vorher fiel sie dort stillschweigend aus', () => {
    /*
     * Beim Umbau gefunden: die Harmonisierung unterschied auf GENAU zwei
     * Zeichenketten ('0.1900', '0.0700') und liess alles andere aus. Bei
     * einem Beleg mit 16 Prozent wäre die Steuer je Zeile einzeln gerundet
     * geblieben; die Belegsumme hätte um einen Cent danebengelegen, und der
     * Riegel des Motors hätte den eigenen Beleg der Kasse abgewiesen.
     */
    const zeilen = [
      computeLineMath({
        taxTreatmentCode: 'STANDARD_19',
        listPriceEur: '1.04',
        acquisitionCostEur: '0.00',
        tag: '2020-09-01',
      }),
      computeLineMath({
        taxTreatmentCode: 'STANDARD_19',
        listPriceEur: '1.04',
        acquisitionCostEur: '0.00',
        tag: '2020-09-01',
      }),
    ];
    const einzeln = zeilen.reduce((a, z) => a + z.lineVatCents, 0n);
    const harmonisiert = harmonisiereUstJeSatz(zeilen).reduce((a, z) => a + z.lineVatCents, 0n);

    // Zwei Zeilen zu 1,04: je Zeile 14 Cent (zusammen 28), als BELEG
    // gerechnet 2,08 × 16/116 = 28,69 → 29. Der eine Cent ist genau der
    // Unterschied, den § 14 Abs. 4 Nr. 8 UStG dem Beleg zuspricht.
    const summeBrutto = zeilen.reduce((a, z) => a + z.lineTotalCents, 0n);
    expect(summeBrutto).toBe(208n);
    expect(einzeln, 'sonst beweist diese Probe nichts').toBe(28n);
    expect(harmonisiert, 'die Belegsumme muss die massgebliche sein').toBe(29n);
  });

  it('19 Prozent verhält sich unverändert wie vorher', () => {
    const zeilen = [
      computeLineMath({
        taxTreatmentCode: 'STANDARD_19',
        listPriceEur: '3.10',
        acquisitionCostEur: '0.00',
        tag: '2026-08-20',
      }),
      computeLineMath({
        taxTreatmentCode: 'STANDARD_19',
        listPriceEur: '3.10',
        acquisitionCostEur: '0.00',
        tag: '2026-08-20',
      }),
    ];
    const summe = harmonisiereUstJeSatz(zeilen).reduce((a, z) => a + z.lineVatCents, 0n);
    // 6,20 brutto bei 19 % → 99 Cent.
    expect(summe).toBe(99n);
  });
});
