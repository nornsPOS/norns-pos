/**
 * ════════════════════════════════════════════════════════════════════════
 *  Der Steuersatz-NAME, den die TSE signiert
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── WAS DIESE DATEI BIS ZUM 08.08.2026 FESTGEPINNT HAT ──────────────────
 *
 * Sie prüfte `ustSchluessel('STANDARD_19') === 1` und eine Aufteilung mit
 * `vat_id`. Beides war grün, und beides war das Vokabular der V1-Schnittstelle.
 * Gegen die LIVE-Spezifikation gemessen (`/_spec.json`, HTTP 200) kommt
 * `vat_id` darin NULL Mal vor: das Pflichtfeld heisst `amounts_per_vat_rate`
 * und trägt NAMEN.
 *
 * Ein Test, der das falsche Vokabular festhält, ist schlimmer als kein Test:
 * er meldet den Fehler jeden Tag als behoben.
 */
import { describe, expect, it } from 'vitest';

import { ERLAUBTE_SATZNAMEN, computeAmountsPerVatRate, vatRateName } from './tse-vat.js';

describe('vatRateName — der Name, den die Schnittstelle kennt', () => {
  it('bildet jede Behandlung auf einen erlaubten Namen ab', () => {
    expect(vatRateName('STANDARD_19')).toBe('NORMAL');
    expect(vatRateName('REDUCED_7')).toBe('REDUCED_1');
    // § 25c: Anlagegold ist steuerfrei, der Satz auf das Entgelt ist 0.
    expect(vatRateName('INVESTMENT_GOLD_25C')).toBe('NULL');
    // § 13b: die Steuerschuld geht über, der Verkäufer weist nichts aus.
    expect(vatRateName('REVERSE_CHARGE_13B')).toBe('NULL');
  });

  it('⛔ jeder gelieferte Name steht im enum der Spezifikation', () => {
    // Ohne diesen Satz wäre „7" wieder nur ein Tippfehler entfernt.
    for (const code of [
      'STANDARD_19',
      'REDUCED_7',
      'INVESTMENT_GOLD_25C',
      'REVERSE_CHARGE_13B',
      'MARGIN_25A',
      'MIXED',
    ] as const) {
      const name = vatRateName(code);
      if (name !== null) {
        expect(ERLAUBTE_SATZNAMEN, `${code} liefert einen unbekannten Namen`).toContain(name);
      }
    }
  });

  it('⚠️ § 25a signiert im 0-Prozent-Container — beantwortet am 19.08.2026', () => {
    /**
     * Diese Pruefung verlangte bis heute `null` („offen, nicht raten") und
     * schrieb damit den teureren Fehler fest: das WEGLASSEN. Gemessen: ein
     * Margenverkauf ueber 1.000 EUR bar signierte null Umsatz gegen volle
     * Zahlung — auf ~87 % der Belege. Anhang I S. 116 verlangt
     * Summengleichheit von Umsaetzen und Zahlungen; und Anlage 2 (im Haus
     * zitiert, dsfinvk-schluessel.ts) definiert Signaturcontainer 5 = 0 %
     * ausdruecklich fuer steuerfreie UND nicht steuerbare Umsaetze. Auf dem
     * ENTGELT eines § 25a-Verkaufs liegt kein offener Satz (§ 14a Abs. 6
     * Satz 2 UStG verbietet den Ausweis) — das Brutto gehoert in den
     * 0-Prozent-Container. Die Steuer auf die MARGE erklaert die Ausfuhr,
     * nicht der Signaturcontainer.
     */
    expect(vatRateName('MARGIN_25A')).toBe('NULL');
  });
});

describe('computeAmountsPerVatRate — je Satz gruppieren und summieren', () => {
  it('gruppiert einen gemischten Beleg und summiert das Brutto je Satz', () => {
    const out = computeAmountsPerVatRate([
      { appliedTaxTreatmentCode: 'STANDARD_19', lineTotalCents: 11900 },
      { appliedTaxTreatmentCode: 'REDUCED_7', lineTotalCents: 10700 },
      { appliedTaxTreatmentCode: 'INVESTMENT_GOLD_25C', lineTotalCents: 50000 },
      { appliedTaxTreatmentCode: 'STANDARD_19', lineTotalCents: 100 },
    ]);
    expect(out.buckets).toEqual([
      { vatRate: 'NORMAL', amountCents: 12000 },
      { vatRate: 'REDUCED_1', amountCents: 10700 },
      { vatRate: 'NULL', amountCents: 50000 },
    ]);
    expect(out.ohneSatznamen).toEqual([]);
  });

  it('⚠️ eine Zeile ohne entschiedenen Satz wird GEMELDET, nicht verteilt', () => {
    // Sie still in einen anderen Eimer zu legen, wäre eine falsche Angabe im
    // signierten Rumpf, und niemand sähe sie je wieder. Seit dem 19.08.2026
    // ist der einzige Zeilen-Schluessel ohne Satz MIXED — und der darf auf
    // einer Zeile ohnehin nie stehen (steuerbetrag-passt.ts weist ihn ab).
    const out = computeAmountsPerVatRate([
      { appliedTaxTreatmentCode: 'STANDARD_19', lineTotalCents: 11900 },
      { appliedTaxTreatmentCode: 'MIXED', lineTotalCents: 50000 },
    ]);
    expect(out.buckets).toEqual([{ vatRate: 'NORMAL', amountCents: 11900 }]);
    expect(out.ohneSatznamen).toEqual(['MIXED']);
  });

  it('⛔ ein Margenverkauf summiert ins 0-Prozent, und die Summe stimmt mit der Zahlung', () => {
    // Der Kern von Anhang I S. 116: Σ Umsaetze = Σ Zahlungen. 119,00 zu 19 %
    // plus 500,00 Marge muessen zusammen 619,00 ergeben — nichts faellt weg.
    const out = computeAmountsPerVatRate([
      { appliedTaxTreatmentCode: 'STANDARD_19', lineTotalCents: 11900 },
      { appliedTaxTreatmentCode: 'MARGIN_25A', lineTotalCents: 50000 },
    ]);
    expect(out.ohneSatznamen).toEqual([]);
    const summe = out.buckets.reduce((a, b) => a + b.amountCents, 0);
    expect(summe).toBe(61900);
    expect(out.buckets).toContainEqual({ vatRate: 'NULL', amountCents: 50000 });
  });

  it('⛔ trägt das Vorzeichen des Stornos', () => {
    // Ein Storno ist negativ, und die Spezifikation erlaubt das ausdrücklich.
    const out = computeAmountsPerVatRate([
      { appliedTaxTreatmentCode: 'STANDARD_19', lineTotalCents: -11900 },
    ]);
    expect(out.buckets).toEqual([{ vatRate: 'NORMAL', amountCents: -11900 }]);
  });

  it('die Summe der Eimer ist die Belegsumme, solange jeder Satz entschieden ist', () => {
    const lines = [
      { appliedTaxTreatmentCode: 'STANDARD_19' as const, lineTotalCents: 11900 },
      { appliedTaxTreatmentCode: 'INVESTMENT_GOLD_25C' as const, lineTotalCents: 200000 },
      { appliedTaxTreatmentCode: 'REDUCED_7' as const, lineTotalCents: 4999 },
    ];
    const gesamt = lines.reduce((n, l) => n + l.lineTotalCents, 0);
    const summe = computeAmountsPerVatRate(lines).buckets.reduce((n, e) => n + e.amountCents, 0);
    expect(summe).toBe(gesamt);
  });

  it('ein leerer Beleg ergibt eine leere Aufteilung', () => {
    expect(computeAmountsPerVatRate([])).toEqual({ buckets: [], ohneSatznamen: [] });
  });
});
