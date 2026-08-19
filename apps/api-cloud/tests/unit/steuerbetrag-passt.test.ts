/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER RIEGEL PRÜFTE EIN WORT, NICHT DIE WIRKUNG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der § 13b-Riegel feuert auf die Zeichenkette `REVERSE_CHARGE_13B`. Es gab
 * aber weder CHECK noch Trigger noch eine Zeile in `validateTransactionMath`,
 * die `vat_eur` an den Steuerschlüssel bindet.
 *
 * Wer 19 Prozent sparen wollte, sendete also nicht § 13b, sondern:
 *
 *     STANDARD_19 · Satz 0,1900 · Entgelt 100,00 · Steuer 0,00
 *
 * Kopf und Zeilen stimmten überein, die Summe ging auf, der Riegel feuerte
 * nie. Er schloss eine von mindestens drei Türen zum selben Raum — und
 * ausgerechnet die einzige, die einen Kunden verlangt.
 */

import { describe, expect, it } from 'vitest';

import { pruefeSteuerbetrag, type Steuerzeile } from '../../src/lib/steuerbetrag-passt.js';

const zeile = (ueber: Partial<Steuerzeile>): Steuerzeile => ({
  appliedTaxTreatmentCode: 'STANDARD_19',
  appliedVatRate: '0.1900',
  lineSubtotalEur: '100.00',
  lineVatEur: '19.00',
  ...ueber,
});

describe('⛔ DIE UMGEHUNG, die es bis zum 26.07.2026 gab', () => {
  it('STANDARD_19 mit NULL Steuer wird abgelehnt', () => {
    const b = pruefeSteuerbetrag(zeile({ lineVatEur: '0.00' }), 0);
    expect(b, 'die Umgehung steht wieder offen').not.toBeNull();
    expect(b?.field).toBe('items[0].lineVatEur');
  });

  it('und jede andere zu niedrige Steuer ebenso', () => {
    for (const zu_wenig of ['1.00', '9.50', '18.00']) {
      expect(pruefeSteuerbetrag(zeile({ lineVatEur: zu_wenig }), 0), zu_wenig).not.toBeNull();
    }
  });

  it('auch zu VIEL wird abgelehnt — § 14c bestraft den zu hohen Ausweis', () => {
    expect(pruefeSteuerbetrag(zeile({ lineVatEur: '25.00' }), 0)).not.toBeNull();
  });

  it('ein falscher Satz zum Schluessel wird abgelehnt', () => {
    const b = pruefeSteuerbetrag(zeile({ appliedVatRate: '0.0700', lineVatEur: '7.00' }), 0);
    expect(b?.field).toBe('items[0].appliedVatRate');
  });

  it('REVERSE_CHARGE_13B mit Steuer ist ein Widerspruch in sich', () => {
    // Die Steuerschuld geht auf den Leistungsempfaenger ueber. Weist der
    // Verkaeufer trotzdem etwas aus, schuldet er es nach § 14c zusaetzlich.
    const b = pruefeSteuerbetrag(
      zeile({ appliedTaxTreatmentCode: 'REVERSE_CHARGE_13B', appliedVatRate: '0.0000', lineVatEur: '19.00' }),
      0,
    );
    expect(b).not.toBeNull();
  });

  it('eine Sonderregelung mit einem Satz auf dem Entgelt ebenso', () => {
    const b = pruefeSteuerbetrag(
      zeile({ appliedTaxTreatmentCode: 'MARGIN_25A', appliedVatRate: '0.1900' }),
      0,
    );
    expect(b?.field).toBe('items[0].appliedVatRate');
  });
});

describe('✅ was WEITERHIN durchgehen MUSS', () => {
  it('der normale Verkauf', () => {
    expect(pruefeSteuerbetrag(zeile({}), 0)).toBeNull();
  });

  it('⚠️ die Rundung je Zeile, an der Produktion gemessen', () => {
    // Der wirksame Satz der 26 echten STANDARD_19-Zeilen schwankt zwischen
    // 0,1899 und 0,1901. Ohne den Spielraum von einem Cent stuende ein
    // legitimer Verkauf still — und ein Riegel, der legitime Vorgaenge
    // blockiert, wird abgeschaltet.
    // `as const`, damit die Paare als Tupel gelten — sonst macht der
    // Typpruefer aus jedem Element `string | undefined`, und die Testdatei
    // faellt aus der Typpruefung (das Tor aus tests-werden-nicht-typgeprueft).
    for (const [entgelt, steuer] of [
      ['33.33', '6.33'],
      ['66.67', '12.67'],
      ['0.05', '0.01'],
    ] as const) {
      expect(pruefeSteuerbetrag(zeile({ lineSubtotalEur: entgelt, lineVatEur: steuer }), 0),
        `${entgelt}/${steuer}`).toBeNull();
    }
  });

  it('⚠️ die zwei echten STANDARD_19-Zeilen mit 0,00 EUR Entgelt', () => {
    // Auf der Produktion nachgesehen, BEVOR die Regel geschrieben wurde: zwei
    // Zeilen tragen null Steuer, beide mit Entgelt 0,00. Die Tuer war offen,
    // aber niemand ist hindurchgegangen. Ohne diese Messung haette die Regel
    // zwei echte Belege fuer ungueltig erklaert.
    expect(pruefeSteuerbetrag(zeile({ lineSubtotalEur: '0.00', lineVatEur: '0.00' }), 0)).toBeNull();
  });

  it('§ 25a: die Steuer liegt auf der MARGE, nicht auf dem Entgelt', () => {
    // 63 von 92 echten Zeilen. Der wirksame Satz schwankt dort ueber die ganze
    // Spanne von 0,0000 bis 0,1908 — eine Regel „Steuer = Entgelt x Satz" waere
    // hier bei zwei Dritteln aller Zeilen sofort falsch.
    for (const steuer of ['0.00', '3.19', '19.08']) {
      expect(
        pruefeSteuerbetrag(
          zeile({ appliedTaxTreatmentCode: 'MARGIN_25A', appliedVatRate: null, lineVatEur: steuer }),
          0,
        ),
        steuer,
      ).toBeNull();
    }
  });

  it('Anlagegold ist steuerfrei', () => {
    expect(
      pruefeSteuerbetrag(
        zeile({ appliedTaxTreatmentCode: 'INVESTMENT_GOLD_25C', appliedVatRate: null, lineVatEur: '0.00' }),
        0,
      ),
    ).toBeNull();
  });

  it('der ermaessigte Satz', () => {
    expect(
      pruefeSteuerbetrag(
        zeile({ appliedTaxTreatmentCode: 'REDUCED_7', appliedVatRate: '0.0700', lineVatEur: '7.00' }),
        0,
      ),
    ).toBeNull();
  });

  it('eine Zeile ohne Schluessel bleibt unbehelligt', () => {
    // Aeltere Aufrufer schicken ihn nicht. Sie duerfen nicht ploetzlich
    // scheitern — das Schema und die Datenbank fangen sie an anderer Stelle.
    expect(pruefeSteuerbetrag(zeile({ appliedTaxTreatmentCode: null }), 0)).toBeNull();
  });

  it('ein STORNO traegt negative Betraege und muss durchgehen', () => {
    // Der Trigger `transactions_validate_storno` erzwingt exakt die
    // Negation des Originals. Wuerde der Riegel hier anschlagen, waere kein
    // Storno mehr moeglich.
    expect(
      pruefeSteuerbetrag(zeile({ lineSubtotalEur: '-100.00', lineVatEur: '-19.00' }), 0),
    ).toBeNull();
  });
});

describe('der Riegel haengt wirklich im Rechenweg', () => {
  it('validateTransactionMath ruft ihn an', async () => {
    const q = (await import('node:fs')).readFileSync(
      new URL('../../src/lib/transaction-math.ts', import.meta.url),
      'utf8',
    );
    // Auf den AUFRUF pruefen, nicht auf den Namen: ein Waechter, der den
    // Import zaehlt, bewacht die Importliste.
    expect(/(?<!as\s)\bpruefeSteuerbetrag\s*\(/.test(q), 'der Rechenweg ruft den Riegel nicht').toBe(
      true,
    );
  });
});
