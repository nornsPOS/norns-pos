/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DAS PAKET MUSS IN SICH STIMMEN, NICHT NUR JEDE DATEI FÜR SICH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Zwanzig formal richtige Dateien ergeben noch keinen brauchbaren
 * Datenträger. Ein Prüfer rechnet QUER: Positionen gegen den Belegkopf,
 * Zahlarten gegen die Belegsumme, jeder Schlüssel gegen seinen Stammsatz.
 *
 * Genau diese Querrechnung prüft diese Datei — und zwar über ein Paket, das
 * durch den echten Erzeuger gelaufen ist, nicht über ausgedachte Zeilen.
 *
 * ── Am ganzen Monatslauf gemessen (28.07.2026) ──────────────────────────
 *
 *     22 Pakete, 73 Belege, 76 Positionen, 72 Signaturen
 *     0 verwaiste Schlüssel, 0 Summenabweichungen
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { formeDaten, type MenschlicheAngaben } from '../../src/lib/dsfinvk-daten.js';
import { baueAlleDateien } from '../../src/lib/dsfinvk-dateien.js';
import type { DsfinvkBundleInput } from '../../src/lib/dsfinvk-export.js';
import { leseTaxonomie } from '../../src/lib/dsfinvk-taxonomie.js';
import { leseStammdaten } from '../../src/lib/haendler-stammdaten.js';

const TAX = leseTaxonomie(
  readFileSync(new URL('../../src/fiskal/dsfinvk-2.4/index.xml', import.meta.url), 'utf8'),
);

const MENSCH: MenschlicheAngaben = {
  // Die Entscheidung des Steuerberaters zum Ankauf von Privat. Sie steht hier
  // ausdruecklich, weil ein Ankaufstag sonst gar nicht exportierbar ist — und
  // genau das soll in den Pruefungen sichtbar sein.
  gvTypAnkauf: 'Auszahlung',
  stammdaten: leseStammdaten({
    'shop.legal_name': 'Muster e. K.', 'shop.street': 'Musterstraße 1',
    'shop.postal_code': '73614', 'shop.city': 'Schorndorf',
    'shop.country_code': 'DEU', 'shop.tax_number': '12345/67890',
  }),
  eigeneUstSchluessel: { MARGIN_25A: '1001' },
  eigeneUstSaetze: { MARGIN_25A: '19.00' },
  kassenSeriennummer: 'KS-1', taxonomieVersion: '2.4', softwareVersion: '1.0',
};

/** Ein Tag mit drei Belegen: § 25a, 19 %, und ein Storno mit Verweis. */
const TAG: DsfinvkBundleInput = {
  businessDay: '2026-06-19',
  closing: {
    zNr: '15', finalizedAt: '2026-06-19T20:00:00.000Z',
    grossVerkaufEur: '389.00', grossAnkaufEur: '500.00',
    netVerkaufEur: '366.81', netAnkaufEur: '500.00',
    vatByTreatment: { MARGIN_25A: '3.19', STANDARD_19: '19.00' },
    // ⚠️ Diese Aufstellung ist VERKAUFSREIN — so schreibt sie der Abschluss
    // heute. Genau daraus entstand der Befund „ein Paket, drei verschiedene
    // Zahlen fuer die Barzahlungen desselben Tages". Sie bleibt hier
    // absichtlich stehen: die Summendateien duerfen sich NICHT auf sie
    // stuetzen, sondern auf die Belege.
    paymentsByMethod: { CASH: '270.00', ZVT_CARD: '119.00' },
    cashCountedEur: '470.00',
  },
  cashRegister: { id: 'POS-1', serialNumber: 'SN-1', brand: 'Norns', model: 'Tresen' },
  receipts: [
    {
      transactionId: 'a1', receiptLocator: 'RCP-2026-000294', direction: 'VERKAUF',
      finalizedAt: '2026-06-19T10:00:00.000Z', taxTreatmentCode: 'MARGIN_25A',
      subtotalEur: '266.81', vatEur: '3.19', totalEur: '270.00',
      cashierUserId: 'u1', customerId: null, isStorno: false,
      lines: [{ lineNumber: 1, productName: 'Goldmünze', quantity: '1',
        appliedTaxTreatmentCode: 'MARGIN_25A', appliedVatRate: null,
        lineSubtotalEur: '266.81', lineVatEur: '3.19', lineTotalEur: '270.00' }],
      payments: [{ paymentMethod: 'CASH', amountEur: '270.00' }],
      tse: { fiskalyTransactionNumber: '1', signatureCounter: '1', signatureValue: 'AA',
        signatureAlgorithm: 'ecdsa-plain-SHA256', fiskalyTssId: 'tss-1',
        processType: 'Kassenbeleg-V1', tseStartTime: '2026-06-19T10:00:00.000Z',
        tseEndTime: '2026-06-19T10:00:01.000Z' },
    },
    {
      transactionId: 'a2', receiptLocator: 'RCP-2026-000295', direction: 'VERKAUF',
      finalizedAt: '2026-06-19T10:30:00.000Z', taxTreatmentCode: 'MARGIN_25A',
      subtotalEur: '-266.81', vatEur: '-3.19', totalEur: '-270.00',
      cashierUserId: 'u1', customerId: null, isStorno: true,
      stornoVon: { bonId: 'RCP-2026-000294', zNr: '15', erstellung: '2026-06-19T20:00:00.000Z' },
      lines: [{ lineNumber: 1, productName: 'Goldmünze', quantity: '1',
        appliedTaxTreatmentCode: 'MARGIN_25A', appliedVatRate: null,
        lineSubtotalEur: '-266.81', lineVatEur: '-3.19', lineTotalEur: '-270.00' }],
      payments: [{ paymentMethod: 'CASH', amountEur: '-270.00' }],
      tse: { fiskalyTransactionNumber: '2', signatureCounter: '2', signatureValue: 'BB',
        signatureAlgorithm: 'ecdsa-plain-SHA256', fiskalyTssId: 'tss-1',
        processType: 'Kassenbeleg-V1', tseStartTime: '2026-06-19T10:30:00.000Z',
        tseEndTime: '2026-06-19T10:30:01.000Z' },
    },
    {
      transactionId: 'a3', receiptLocator: 'RCP-2026-000296', direction: 'VERKAUF',
      finalizedAt: '2026-06-19T14:00:00.000Z', taxTreatmentCode: 'STANDARD_19',
      subtotalEur: '100.00', vatEur: '19.00', totalEur: '119.00',
      cashierUserId: 'u1', customerId: null, isStorno: false,
      lines: [{ lineNumber: 1, productName: 'Reinigungsset', quantity: '1',
        appliedTaxTreatmentCode: 'STANDARD_19', appliedVatRate: '0.1900',
        lineSubtotalEur: '100.00', lineVatEur: '19.00', lineTotalEur: '119.00' }],
      payments: [{ paymentMethod: 'ZVT_CARD', amountEur: '119.00' }],
      tse: { fiskalyTransactionNumber: '3', signatureCounter: '3', signatureValue: 'CC',
        signatureAlgorithm: 'ecdsa-plain-SHA256', fiskalyTssId: 'tss-1',
        processType: 'Kassenbeleg-V1', tseStartTime: '2026-06-19T14:00:00.000Z',
        tseEndTime: '2026-06-19T14:00:01.000Z' },
    },
    /**
     * ⚠️ DER ANKAUF, DEN DIESE VORLAGE BIS ZUM 06.08.2026 NICHT KANNTE.
     *
     * Alle drei Belege oben sind VERKAUF. Die Querrechnungen dieser Datei
     * waren deshalb gruen, ohne je die Richtung zu pruefen — und genau dort
     * lagen acht Befunde der Tiefenpruefung vom 05.08.2026.
     *
     * Ein Edelmetallhaendler kauft. Geld VERLAESST die Lade: 500,00 EUR bar
     * an einen Privatverkaeufer, § 25a, kein Vorsteuerabzug, also 0,00 USt.
     */
    {
      transactionId: 'a4', receiptLocator: 'RCP-2026-000297', direction: 'ANKAUF',
      finalizedAt: '2026-06-19T16:00:00.000Z', taxTreatmentCode: 'MARGIN_25A',
      subtotalEur: '500.00', vatEur: '0.00', totalEur: '500.00',
      cashierUserId: 'u1', customerId: 'k1', isStorno: false,
      lines: [{ lineNumber: 1, productName: 'Altgold 585', quantity: '1',
        appliedTaxTreatmentCode: 'MARGIN_25A', appliedVatRate: null,
        lineSubtotalEur: '500.00', lineVatEur: '0.00', lineTotalEur: '500.00' }],
      payments: [{ paymentMethod: 'CASH', amountEur: '500.00' }],
      tse: { fiskalyTransactionNumber: '4', signatureCounter: '4', signatureValue: 'DD',
        signatureAlgorithm: 'ecdsa-plain-SHA256', fiskalyTssId: 'tss-1',
        processType: 'Kassenbeleg-V1', tseStartTime: '2026-06-19T16:00:00.000Z',
        tseEndTime: '2026-06-19T16:00:01.000Z' },
    },
  ],
};

const paket = (): Record<string, Record<string, string>[]> => {
  const dateien = baueAlleDateien(TAX, formeDaten(TAG, MENSCH));
  const raus: Record<string, Record<string, string>[]> = {};
  for (const d of dateien) {
    const z = d.content.split('\r\n').filter((x) => x !== '');
    const kopf = (z[0] ?? '').split(';');
    raus[d.name] = z.slice(1).map((x) => Object.fromEntries(x.split(';').map((w, i) => [kopf[i]!, w])));
  }
  return raus;
};

const cent = (s: string): number =>
  Math.round(Number((s || '0').replace(/\./g, '').replace(',', '.')) * 100);

describe('⛔ jeder Schlüssel zeigt auf etwas, das es gibt', () => {
  const p = paket();
  const bons = new Set(p['transactions.csv']!.map((r) => r['BON_ID']!));

  for (const datei of [
    'lines.csv', 'lines_vat.csv', 'transactions_vat.csv',
    'datapayment.csv', 'transactions_tse.csv', 'references.csv',
  ]) {
    it(`${datei} hat keine verwaiste BON_ID`, () => {
      const verwaist = p[datei]!.filter((r) => !bons.has(r['BON_ID']!));
      expect(verwaist.map((r) => r['BON_ID']), datei).toEqual([]);
    });
  }

  it('jede TSE_ID hat einen Stammsatz in tse.csv', () => {
    const stamm = new Set(p['tse.csv']!.map((r) => r['TSE_ID']!));
    for (const r of p['transactions_tse.csv']!) {
      expect(stamm.has(r['TSE_ID']!), `TSE_ID ${r['TSE_ID']} ohne Stammsatz`).toBe(true);
    }
  });

  it('jeder UST_SCHLUESSEL hat einen Stammsatz in vat.csv', () => {
    const stamm = new Set(p['vat.csv']!.map((r) => r['UST_SCHLUESSEL']!));
    for (const r of p['lines_vat.csv']!) {
      expect(stamm.has(r['UST_SCHLUESSEL']!), `${r['UST_SCHLUESSEL']} ohne Stammsatz`).toBe(true);
    }
  });

  it('⛔ und kein Schlüssel mit Steuer wird als 0,00 % ausgewiesen', () => {
    const saetze = new Map(p['vat.csv']!.map((r) => [r['UST_SCHLUESSEL']!, r['UST_SATZ']!]));
    for (const r of p['lines_vat.csv']!) {
      if (cent(r['POS_UST']!) === 0) continue;
      expect(
        saetze.get(r['UST_SCHLUESSEL']!),
        `Schlüssel ${r['UST_SCHLUESSEL']} trägt Steuer, vat.csv sagt 0,00 %`,
      ).not.toBe('0,00');
    }
  });
});

describe('⛔ die Querrechnung, die ein Prüfer als erstes macht', () => {
  const p = paket();

  for (const r of p['transactions.csv']!) {
    const b = r['BON_ID']!;
    const kopf = cent(r['UMS_BRUTTO']!);

    it(`${b}: Positionen, Zahlungen und Steuersätze ergeben den Belegkopf`, () => {
      const pos = p['lines_vat.csv']!.filter((x) => x['BON_ID'] === b)
        .reduce((s, x) => s + cent(x['POS_BRUTTO']!), 0);
      const zahl = p['datapayment.csv']!.filter((x) => x['BON_ID'] === b)
        .reduce((s, x) => s + cent(x['ZAHLWAEH_BETRAG']!), 0);
      const jeSatz = p['transactions_vat.csv']!.filter((x) => x['BON_ID'] === b)
        .reduce((s, x) => s + cent(x['BON_BRUTTO']!), 0);
      expect(pos, 'Positionen').toBe(kopf);
      expect(zahl, 'Zahlungen').toBe(kopf);
      expect(jeSatz, 'je Steuersatz').toBe(kopf);
    });
  }

  it('⚠️ und der Storno hebt seinen Urbeleg auf null auf', () => {
    const summe = p['transactions.csv']!
      .filter((r) => r['BON_ID'] === 'RCP-2026-000294' || r['BON_ID'] === 'RCP-2026-000295')
      .reduce((s, r) => s + cent(r['UMS_BRUTTO']!), 0);
    expect(summe).toBe(0);
  });

  it('⛔ der Storno VERWEIST auf seinen Urbeleg', () => {
    const ref = p['references.csv']!;
    expect(ref, 'kein Verweis').toHaveLength(1);
    expect(ref[0]!['BON_ID']).toBe('RCP-2026-000295');
    expect(ref[0]!['REF_BON_ID']).toBe('RCP-2026-000294');
    expect(ref[0]!['REF_TYP']).toBe('Transaktion');
    expect(ref[0]!['POS_ZEILE'], 'der Verweis geht vom Bonkopf aus').toBe('');
  });

  it('und beide Belege sind vom Typ „Beleg", nur mit Storno-Kennzeichen', () => {
    const beide = p['transactions.csv']!.filter((r) =>
      ['RCP-2026-000294', 'RCP-2026-000295'].includes(r['BON_ID']!));
    expect(beide.map((r) => r['BON_TYP'])).toEqual(['Beleg', 'Beleg']);
    expect(beide.map((r) => r['BON_STORNO'])).toEqual(['0', '1']);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⛔ DIE TAGESSUMMEN MÜSSEN AUS DERSELBEN QUELLE KOMMEN
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 05.08.2026 ───────────────────────────────────────────
 *
 * Der Abschlusskopf, `payment.csv` und `cash_per_currency.csv` wurden aus
 * `closing.paymentsByMethod` gebildet — einer Aufstellung, die den ANKAUF
 * nicht kennt. Die Einzelaufzeichnung `datapayment.csv` dagegen kannte ihn.
 *
 * Gemessen: EIN Paket, DREI verschiedene Zahlen für die Barzahlungen
 * desselben Tages. Ein Prüfer stellt genau diese drei gegeneinander.
 *
 * Diese Rechnungen sind kein Feinschliff. Sie sind der Grund, warum ein
 * Datenträger angenommen oder beanstandet wird.
 */
describe('⛔ ein Paket, EINE Zahl je Frage', () => {
  const p = paket();
  const cent = (v: string): number => Math.round(Number((v ?? '0').replace(',', '.')) * 100);
  const summe = (zeilen: Record<string, string>[], feld: string): number =>
    zeilen.reduce((a, r) => a + cent(r[feld] ?? '0'), 0);

  it('je Zahlart: die Summe der Einzelzahlungen ist der Betrag in payment.csv', () => {
    const einzeln = new Map<string, number>();
    for (const z of p['datapayment.csv'] ?? []) {
      const name = z['ZAHLART_NAME'] ?? '';
      einzeln.set(name, (einzeln.get(name) ?? 0) + cent(z['BASISWAEH_BETRAG'] ?? z['ZAHLWAEH_BETRAG'] ?? '0'));
    }
    for (const zeile of p['payment.csv'] ?? []) {
      const name = zeile['ZAHLART_NAME'] ?? '';
      expect(cent(zeile['Z_ZAHLART_BETRAG'] ?? '0'), `Zahlart ${name}`).toBe(einzeln.get(name) ?? 0);
    }
    // Und keine Zahlart darf FEHLEN: eine, die nur einzeln vorkommt, wäre in
    // der Tagesaufstellung unsichtbar.
    const inSumme = new Set((p['payment.csv'] ?? []).map((z) => z['ZAHLART_NAME']));
    for (const name of einzeln.keys()) {
      expect(inSumme.has(name), `Zahlart ${name} fehlt in payment.csv`).toBe(true);
    }
  });

  it('die Summe aller Zahlarten ist Z_SE_ZAHLUNGEN im Abschluss', () => {
    const abschluss = (p['cashpointclosing.csv'] ?? [])[0] ?? {};
    expect(cent(abschluss['Z_SE_ZAHLUNGEN'] ?? '0')).toBe(summe(p['payment.csv'] ?? [], 'Z_ZAHLART_BETRAG'));
  });

  it('⛔ Z_SE_BARZAHLUNGEN ist die Summe der BAREN Einzelzahlungen', () => {
    const bar = (p['datapayment.csv'] ?? []).filter((z) => (z['ZAHLART_TYP'] ?? '') === 'Bar');
    const abschluss = (p['cashpointclosing.csv'] ?? [])[0] ?? {};
    // Der Tag: 270,00 bar ein, 270,00 storniert, 500,00 bar aus → −500,00.
    expect(summe(bar, 'BASISWAEH_BETRAG')).toBe(-50000);
    expect(cent(abschluss['Z_SE_BARZAHLUNGEN'] ?? '0')).toBe(-50000);
  });

  it('cash_per_currency traegt die Barzahlungen, nicht den gezaehlten Bestand', () => {
    const zeilen = p['cash_per_currency.csv'] ?? [];
    // ⚠️ ERST prüfen, dass es die Spalte gibt. Der erste Entwurf dieses Tests
    // las `ZAHLART_BETRAG`; die Spalte heisst `ZAHLART_BETRAG_WAEH`. Eine
    // fehlende Spalte ergibt hier still eine Null, und bei einer erwarteten
    // Null wäre der Test grün gewesen, ohne je etwas zu messen.
    expect(zeilen.length, 'cash_per_currency ist leer').toBeGreaterThan(0);
    expect(Object.keys(zeilen[0] ?? {}), 'Spalte fehlt').toContain('ZAHLART_BETRAG_WAEH');

    const bar = (p['datapayment.csv'] ?? []).filter((z) => (z['ZAHLART_TYP'] ?? '') === 'Bar');
    expect(summe(zeilen, 'ZAHLART_BETRAG_WAEH')).toBe(summe(bar, 'BASISWAEH_BETRAG'));
  });

  it('⛔ die Geschaeftsvorfaelle ergeben denselben Umsatz wie die Belege', () => {
    expect(summe(p['businesscases.csv'] ?? [], 'Z_UMS_BRUTTO')).toBe(
      summe(p['transactions.csv'] ?? [], 'UMS_BRUTTO'),
    );
  });

  it('⛔ und der Ankauf steht als AUSZAHLUNG darin, nicht als Umsatz', () => {
    const auszahlung = (p['businesscases.csv'] ?? []).filter((z) => (z['GV_TYP'] ?? '') !== 'Umsatz');
    expect(auszahlung.length, 'keine Auszahlungszeile fuer den Ankauf').toBeGreaterThan(0);
    expect(summe(auszahlung, 'Z_UMS_BRUTTO')).toBe(-50000);
  });
});
