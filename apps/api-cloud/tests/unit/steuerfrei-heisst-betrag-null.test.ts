/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  „KEIN SATZ" HIESS BIS HEUTE „KEIN BETRAG WIRD GEPRÜFT" (19.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `pruefeSteuerbetrag` ist der Riegel, der verhindert, dass ein Klient seine
 * eigene Steuer erklärt. Für STANDARD_19 und REDUCED_7 hält er. Für die drei
 * Schlüssel ohne Satz auf dem Entgelt endete er nach einem Satz:
 *
 *     if (erwarteterSatz === null) { …Satz prüfen…; return null; }
 *
 * Der BETRAG wurde nie angesehen. Für § 25a ist das richtig — dort rechnet
 * `marge-nachrechnen.ts` aus dem hinterlegten Einkaufspreis nach. Für die
 * beiden anderen war es ein offenes Tor:
 *
 *   MIXED   Der Kommentar in `steuerbetrag-passt.ts` sagt seit jeher, MIXED
 *           gehöre auf den Kopf und nicht auf die Zeile. Nur stand das allein
 *           im Kommentar. Das Schema liess ihn auf der Zeile zu, und dort war
 *           er der einzige Schlüssel ganz ohne Betragsprüfung. Eine Zeile über
 *           1.000,00 EUR mit 0,00 Steuer ging glatt durch: die Bilanzgleichung
 *           stimmte, die Summen stimmten, 159,66 EUR fehlten.
 *
 *   § 25c   Anlagegold ist steuerfrei. Wird trotzdem Steuer ausgewiesen,
 *           schuldet der Händler sie nach § 14c Abs. 1 UStG — ohne sie je
 *           kassiert zu haben. Der umgekehrte Schaden, gleiche Ursache.
 *
 * ⚠️ Erwähnung ist nicht Gebrauch. Eine Regel, die nur als Satz im Kommentar
 * steht, ist keine Regel.
 */

import { describe, expect, it } from 'vitest';
import { pruefeSteuerbetrag, type Steuerzeile } from '../../src/lib/steuerbetrag-passt.js';

function zeile(teil: Partial<Steuerzeile>): Steuerzeile {
  return {
    appliedTaxTreatmentCode: 'STANDARD_19',
    appliedVatRate: '0.1900',
    lineSubtotalEur: '100.00',
    lineVatEur: '19.00',
    ...teil,
  } as Steuerzeile;
}

describe('MIXED gehört nicht auf eine Zeile', () => {
  it('lehnt die Zeile ab, statt sie ungeprüft durchzulassen', () => {
    const b = pruefeSteuerbetrag(
      zeile({
        appliedTaxTreatmentCode: 'MIXED',
        appliedVatRate: null,
        lineSubtotalEur: '1000.00',
        lineVatEur: '0.00',
      }),
      0,
    );
    expect(b).not.toBeNull();
    expect(b?.field).toBe('items[0].appliedTaxTreatmentCode');
    expect(b?.actual).toBe('MIXED');
  });
});

describe('§ 25c Anlagegold — steuerfrei heisst Betrag null', () => {
  it('lässt die steuerfreie Zeile durch', () => {
    expect(
      pruefeSteuerbetrag(
        zeile({
          appliedTaxTreatmentCode: 'INVESTMENT_GOLD_25C',
          appliedVatRate: null,
          lineSubtotalEur: '2410.00',
          lineVatEur: '0.00',
        }),
        0,
      ),
    ).toBeNull();
  });

  it('weist ausgewiesene Steuer auf steuerfreier Lieferung zurück', () => {
    const b = pruefeSteuerbetrag(
      zeile({
        appliedTaxTreatmentCode: 'INVESTMENT_GOLD_25C',
        appliedVatRate: null,
        lineSubtotalEur: '2410.00',
        lineVatEur: '384.79',
      }),
      3,
    );
    expect(b).not.toBeNull();
    expect(b?.field).toBe('items[3].lineVatEur');
    expect(b?.message).toContain('14c');
    expect(b?.expected).toBe('0.00');
  });
});

describe('§ 25a bleibt, wie es war', () => {
  // Die Marge wird woanders geprüft, mit der Bestandszeile in der Hand. Diese
  // Prüfung hier darf sie NICHT zusätzlich ablehnen — sonst wäre kein einziger
  // differenzbesteuerter Verkauf mehr möglich.
  it('lässt eine Margenzeile mit Steuer durch', () => {
    expect(
      pruefeSteuerbetrag(
        zeile({
          appliedTaxTreatmentCode: 'MARGIN_25A',
          appliedVatRate: null,
          lineSubtotalEur: '184.03',
          lineVatEur: '15.97',
        }),
        0,
      ),
    ).toBeNull();
  });
});
