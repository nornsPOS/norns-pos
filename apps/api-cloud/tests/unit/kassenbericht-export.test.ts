/**
 * Kassenbericht CSV builder — the daily cash report (KassenSichV) downloadable
 * for the Finanzamt / Steuerberater. Pure: it only RE-EXPRESSES the real
 * `daily_closings` row as a labelled German CSV; it never recomputes or
 * fabricates a figure. (No facade: every number here came from the closing.)
 */
import { describe, expect, it } from 'vitest';

import {
  type KassenberichtInput,
  buildKassenberichtCsv,
} from '../../src/lib/kassenbericht-export.js';

function sample(overrides: Partial<KassenberichtInput> = {}): KassenberichtInput {
  return {
    businessDay: '2026-06-06',
    state: 'FINALIZED',
    verkaufCount: 7,
    ankaufCount: 2,
    stornoCount: 1,
    grossVerkaufEur: '1500.00',
    grossAnkaufEur: '300.00',
    netVerkaufEur: '1234.50',
    netAnkaufEur: '280.00',
    // Neu mit Wanderung 0112: der Storno mit BETRAG, nicht nur als Anzahl.
    stornoVerkaufEur: '0.00',
    rueckgabeVerkaufEur: '0.00',
    rueckgabeCount: 0,
    stornoAnkaufEur: '0.00',
    vatByTreatment: { STANDARD_19: '190.00', MARGIN_25A: '12.34' },
    paymentsByMethod: { CASH: '500.00', CARD: '734.50' },
    // Anfangsbestand 200,00 + Bareinnahmen (CASH oben) 500,00 = 700,00 —
    // dieselbe Zahl, die `cashExpectedEur` unten festschreibt. So bleibt die
    // Rechnung unten für den Normalfall STILL (keine Gegenprobe-Zeile), wie
    // vor dem 07.08.2026.
    bargeldbewegungen: [{ direction: 'OPENING_FLOAT', amountEur: '200.00' }],
    ausgabenOhneZahlweg: 0,
    barausgabenEur: '0.00',
    anfangsbestandEur: '200.00',
    barauszahlungAnkaufEur: '0.00',
    cashExpectedEur: '700.00',
    cashCountedEur: '698.00',
    cashVarianceEur: '-2.00',
    tseFinishedCount: 7,
    tsePendingCount: 0,
    tseFailedCount: 0,
    finalizedAt: '2026-06-06T20:05:00.000Z',
    ...overrides,
  };
}

describe('buildKassenberichtCsv', () => {
  it('starts with a titled header line carrying the business day', () => {
    const csv = buildKassenberichtCsv(sample());
    // A German report writes a German date. The ISO form was a machine format
    // that happened to reach a document meant for a Betriebsprüfer.
    expect(csv.split('\r\n')[0]).toBe('Kassenbericht;06.06.2026');
  });

  it('labels the state in plain German', () => {
    expect(buildKassenberichtCsv(sample({ state: 'FINALIZED' }))).toContain('Status;abgeschlossen');
    expect(buildKassenberichtCsv(sample({ state: 'COUNTING' }))).toContain('Status;in Zählung');
  });

  it('emits the real net figures with German comma decimals', () => {
    const csv = buildKassenberichtCsv(sample());
    // Seit dem 26.07.2026 trägt auch das Netto die Angabe vor/nach Storno.
    // Vorher war „Verkauf netto" die EINZIGE Zeile des Umsatzblocks ohne sie,
    // und dann ergab Netto plus Steuer nicht das Brutto darunter.
    expect(csv).toContain('Umsatz;Verkauf netto vor Storno;1234,50 EUR');
    expect(csv).toContain('Umsatz;Ankauf netto vor Storno;280,00 EUR');
  });

  it('der Umsatzblock geht bei Storno auf, Zeile fuer Zeile', () => {
    // Der eigentliche Zweck der Aenderung, und das, was die alte Zusicherung
    // NICHT prüfte: dass die Zahlen zusammenpassen.
    //
    // Brutto vor Storno 1500,00 minus Storno 119,00 = 1381,00 nach Storno.
    // Netto nach Storno = Brutto nach Storno minus Umsatzsteuer, und diese
    // Steuer ist bereits die nach Storno (190,00 + 12,34 = 202,34).
    //   1381,00 - 202,34 = 1178,66
    const csv = buildKassenberichtCsv(sample({ stornoVerkaufEur: '119.00' }));

    expect(csv).toContain('Umsatz;Verkauf brutto vor Storno;1500,00 EUR');
    // 0148: die Schlusszeile rechnet auch die Warenruecknahmen ein und sagt
    // es im Namen — ohne Ruecknahmen ist die Zahl dieselbe wie vorher.
    expect(csv).toContain('Umsatz;Verkauf brutto nach Storno und Rücknahme;1381,00 EUR');
    expect(csv).toContain('Umsatz;Verkauf netto nach Storno;1178,66 EUR');
  });

  it('0148: eine Warenruecknahme steht als eigene Zeile und mindert die Schlusszeile', () => {
    const csv = buildKassenberichtCsv(
      sample({ stornoVerkaufEur: '119.00', rueckgabeVerkaufEur: '-100.00', rueckgabeCount: 1 }),
    );
    expect(csv).toContain('Umsatz;Warenrücknahmen;-100,00 EUR');
    expect(csv).toContain('Belege;Warenrücknahmen;1');
    // 1500 − 119 − 100 = 1281
    expect(csv).toContain('Umsatz;Verkauf brutto nach Storno und Rücknahme;1281,00 EUR');
  });

  it('names each VAT treatment and payment method in German, never as a raw code', () => {
    const csv = buildKassenberichtCsv(sample());
    expect(csv).toContain('Umsatzsteuer;Regelsteuersatz 19 %;190,00 EUR');
    expect(csv).toContain('Umsatzsteuer;Differenzbesteuerung § 25a UStG;12,34 EUR');
    expect(csv).toContain('Zahlungsart;Bar;500,00 EUR');
    // The reader must never meet the enum itself.
    expect(csv).not.toContain('STANDARD_19');
    expect(csv).not.toContain('MARGIN_25A');
  });

  it('shows an unknown code rather than hiding or prettifying it', () => {
    // A silently dropped tax bucket is how a report starts lying. An unmapped
    // code has to be visible so somebody notices and maps it.
    const csv = buildKassenberichtCsv(sample({ vatByTreatment: { WHAT_IS_THIS: '5.00' } }));
    expect(csv).toContain('WHAT_IS_THIS (unbekannter Schlüssel);5,00 EUR');
  });

  it('adds a check total under the VAT rows and under the payment rows', () => {
    // A Prüfer adds the rows up by hand; the report has to state where they land.
    const csv = buildKassenberichtCsv(sample());
    expect(csv).toContain('Umsatzsteuer;Summe;202,34 EUR'); // 190,00 + 12,34
    expect(csv).toContain('Zahlungsart;Summe;1234,50 EUR'); // 500,00 + 734,50
  });

  it('rechnet den Abschnitt Kasse aus Anfangsbestand, Bareinnahmen und Barankauf her (07.08.2026)', () => {
    // Seit `baueKassenrechnung` (`lib/kassenrechnung.ts`) trägt „Kasse" die
    // fortschreibende Rechnung statt der alten drei Zeilen (erwartet,
    // gezählt, Differenz). Die Werte hier: Anfangsbestand 200,00 (siehe
    // `sample()`) + Bareinnahmen 500,00 (CASH aus `paymentsByMethod`) −
    // Barauszahlung Ankauf 0,00 = 700,00 — dieselbe Zahl, die
    // `cashExpectedEur` festschreibt, also OHNE Gegenprobe-Zeile.
    const csv = buildKassenberichtCsv(sample());
    expect(csv).toContain('Kasse;Anfangsbestand (Wechselgeld);200,00 EUR');
    expect(csv).toContain('Kasse;Bareinnahmen;500,00 EUR');
    expect(csv).toContain('Kasse;Barauszahlung Ankauf;0,00 EUR');
    expect(csv).toContain('Kasse;Erwarteter Endbestand;700,00 EUR');
    expect(csv).toContain('Kasse;Gezählter Endbestand;698,00 EUR');
    expect(csv).toContain('Kasse;Differenz;-2,00 EUR');
    // Rechnung und Abschluss stimmen überein, also KEINE Gegenprobe-Zeile.
    expect(csv).not.toContain('Beim Abschluss festgeschrieben');
    expect(csv).not.toContain('Abweichung zur Rechnung oben');
  });

  it('says a missing cash count in words, never as a fabricated 0 and never as a dash', () => {
    const csv = buildKassenberichtCsv(
      sample({ cashExpectedEur: null, cashCountedEur: null, cashVarianceEur: null }),
    );
    expect(csv).toContain('Kasse;Gezählter Endbestand;nicht gezählt');
    expect(csv).not.toContain('Kasse;Gezählter Endbestand;0,00');
    // House style: the long dash is forbidden in any text this shop prints.
    // `baueKassenrechnung` selbst schreibt ihn für eine fehlende Zählung
    // (`kassenrechnung.ts`); `kassenzeile()` in `kassenbericht-export.ts`
    // muss ihn VOR dem Druck ersetzen, sonst bricht genau diese Zusage.
    expect(csv).not.toContain('—');
  });

  it('states the closing time in Berlin local time, not UTC', () => {
    // 20:05Z in June is 22:05 in Berlin. Printing the Z time made a late
    // closing look like it belonged to a different part of the day.
    const csv = buildKassenberichtCsv(sample());
    expect(csv).toContain('06.06.2026, 22:05 Uhr (Ortszeit Berlin)');
    expect(csv).not.toContain('2026-06-06T20:05');
  });

  it('reports TSE health counts', () => {
    const csv = buildKassenberichtCsv(sample({ tseFinishedCount: 7, tseFailedCount: 0 }));
    expect(csv).toContain('TSE;Signiert;7');
    expect(csv).toContain('TSE;Fehlgeschlagen;0');
  });

  it('counts row: Verkäufe / Ankäufe / Stornos', () => {
    const csv = buildKassenberichtCsv(sample());
    expect(csv).toContain('Belege;Verkäufe;7');
    expect(csv).toContain('Belege;Ankäufe;2');
    expect(csv).toContain('Belege;Stornos;1');
  });
});
