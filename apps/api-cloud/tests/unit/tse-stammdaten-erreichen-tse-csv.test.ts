/**
 * ════════════════════════════════════════════════════════════════════════
 *  DER ERZEUGER: eine mitgelieferte Seriennummer landet wirklich in tse.csv
 * ════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ WAS DIESE DATEI MISST — UND WAS NICHT.
 *
 * Gemessen wird ausschliesslich der ERZEUGER, also `formeDaten` und
 * `baueAlleDateien`: nennt ein Beleg eine Seriennummer und einen öffentlichen
 * Schlüssel, stehen sie in `TSE_SERIAL` und `TSE_PUBLIC_KEY`; nennt er keine,
 * bleiben die Spalten leer statt erfunden.
 *
 * ⛔ Die beiden Werte in dieser Datei kommen aus DIESER DATEI. Sie beweisen
 * deshalb NICHT, dass im Betrieb je eine Seriennummer ankommt — am 13.08.2026
 * gemessen tut sie das nicht, denn die Kette dorthin ist an vier Stellen
 * offen (aufgezählt an `DsfinvkTseInput` in `src/lib/dsfinvk-export.ts`).
 *
 * Den LEBENDEN Weg messen zwei andere Wächter, und die sind heute rot:
 *     tests/unit/tse-stammdaten-lebender-weg.test.ts
 *     tests/integration/tse-seriennummer-erreicht-das-pruefpaket.test.ts
 *
 * ── WARUM DER ERZEUGER TROTZDEM SEINEN EIGENEN WÄCHTER BRAUCHT ─────────
 *
 * Weil er die Stelle ist, an der eine erfundene Angabe entstünde. Die
 * Sicherungseinrichtung legt jeder fertigen Signatur ihre Seriennummer und
 * ihren öffentlichen Schlüssel bei; die Brücke der Kasse liest beide
 * ausdrücklich aus der Antwort heraus:
 *
 *     apps/tauri-pos/src-tauri/src/commands/tse.rs:338
 *         signature_public_key: pflicht_text(sig, "public_key", …)
 *     apps/tauri-pos/src-tauri/src/commands/tse.rs:339
 *         tss_serial_number:    pflicht_text(&parsed, "tss_serial_number", …)
 *
 * Kommen sie eines Tages hier an, muss jedes Gerät SEINE eigene Nummer
 * bekommen, und ein Schweigen muss ein leeres Feld bleiben. Genau das ist
 * unten festgehalten.
 *
 * ⚠️ Die Gegenrichtung wird deshalb genauso festgehalten: was NIEMAND liefert
 * (Zertifikat, Zeitformat), bleibt leer. Eine erfundene Seriennummer wäre
 * schlimmer als eine fehlende — sie wäre eine unwahre Angabe in einem
 * amtlichen Auszug.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { formeDaten, type MenschlicheAngaben } from '../../src/lib/dsfinvk-daten.js';
import { baueAlleDateien } from '../../src/lib/dsfinvk-dateien.js';
import type { DsfinvkBundleInput, DsfinvkReceiptInput } from '../../src/lib/dsfinvk-export.js';
import { leseTaxonomie } from '../../src/lib/dsfinvk-taxonomie.js';
import { leseStammdaten } from '../../src/lib/haendler-stammdaten.js';

const TAX = leseTaxonomie(
  readFileSync(new URL('../../src/fiskal/dsfinvk-2.4/index.xml', import.meta.url), 'utf8'),
);

/**
 * PRÜFWERTE in der Gestalt, die eine Swissbit und eine Wolken-TSE nennen.
 * ⛔ Sie stammen aus dieser Datei, nicht aus einem Gerät und nicht aus der
 * Datenbank — siehe die Vorbemerkung ganz oben.
 */
const SERIENNUMMER = '5E4B1C9A00000042';
const SCHLUESSEL = 'BFDlqXQm9Zk3TbCiAoYh6nP2sWvE1uJr0LxMd4gK8fA';

const mensch = (
  tseStammdaten?: MenschlicheAngaben['tseStammdaten'],
): MenschlicheAngaben => ({
  gvTypAnkauf: 'Auszahlung',
  stammdaten: leseStammdaten({
    'shop.legal_name': 'Muster Edelmetallhandel e. K.',
    'shop.street': 'Musterstraße 1',
    'shop.postal_code': '73614',
    'shop.city': 'Schorndorf',
    'shop.country_code': 'DEU',
    'shop.tax_number': '12345/67890',
    'shop.vat_id': 'DE343451090',
  }),
  eigeneUstSchluessel: { MARGIN_25A: '1001' },
  kassenSeriennummer: 'KS-0001',
  taxonomieVersion: '2.4',
  softwareVersion: '1.0.0',
  ...(tseStammdaten ? { tseStammdaten } : {}),
});

const BELEG: DsfinvkReceiptInput = {
  transactionId: 'aaaaaaaa-0000-0000-0000-000000000001',
  receiptLocator: 'RCP-2026-000049',
  direction: 'VERKAUF',
  finalizedAt: '2026-06-01T10:00:00.000Z',
  taxTreatmentCode: 'MARGIN_25A',
  subtotalEur: '266.81',
  vatEur: '3.19',
  totalEur: '270.00',
  cashierUserId: 'user-1',
  customerId: null,
  isStorno: false,
  lines: [
    {
      lineNumber: 1,
      productName: 'Goldmünze Krügerrand',
      quantity: '1',
      appliedTaxTreatmentCode: 'MARGIN_25A',
      appliedVatRate: null,
      lineSubtotalEur: '266.81',
      lineVatEur: '3.19',
      lineTotalEur: '270.00',
    },
  ],
  payments: [{ paymentMethod: 'CASH', amountEur: '270.00' }],
  tse: {
    fiskalyTransactionNumber: '1',
    signatureCounter: '1',
    signatureValue: 'MEUCIE8Q',
    signatureAlgorithm: 'ecdsa-plain-SHA256',
    fiskalyTssId: 'tss-1',
    processType: 'Kassenbeleg-V1',
    tseStartTime: '2026-06-01T10:00:00.000Z',
    tseEndTime: '2026-06-01T10:00:01.000Z',
    tssSerialNumber: SERIENNUMMER,
    signaturePublicKey: SCHLUESSEL,
  },
};

/** Ein zweiter Beleg, wahlweise mit anderer Signaturbeigabe. */
const zweiterBeleg = (tse: Partial<NonNullable<DsfinvkReceiptInput['tse']>>): DsfinvkReceiptInput => ({
  ...BELEG,
  transactionId: 'aaaaaaaa-0000-0000-0000-000000000002',
  receiptLocator: 'RCP-2026-000050',
  tse: {
    ...(BELEG.tse as NonNullable<DsfinvkReceiptInput['tse']>),
    fiskalyTransactionNumber: '2',
    signatureCounter: '2',
    ...tse,
  },
});

const bundle = (receipts: DsfinvkReceiptInput[]): DsfinvkBundleInput => ({
  businessDay: '2026-06-01',
  closing: {
    zNr: '1',
    finalizedAt: '2026-06-01T20:00:00.000Z',
    grossVerkaufEur: '540.00',
    grossAnkaufEur: '0.00',
    netVerkaufEur: '533.62',
    netAnkaufEur: '0.00',
    vatByTreatment: { MARGIN_25A: '6.38' },
    paymentsByMethod: { CASH: '540.00' },
    cashCountedEur: '540.00',
  },
  cashRegister: { id: 'KASSE-1', serialNumber: 'SN-1', brand: 'Norns', model: 'Tresen' },
  receipts,
});

const spalte = (name: string): number => {
  const tabelle = TAX.find((t) => t.datei === 'tse.csv');
  if (!tabelle) throw new Error('tse.csv fehlt in der Taxonomie');
  const i = tabelle.spalten.findIndex((s) => s.name === name);
  if (i < 0) throw new Error(`Spalte ${name} fehlt`);
  return i;
};

/** Die Zeilen von `tse.csv` als Spaltenlisten, ohne Kopfzeile. */
function stammZeilen(
  receipts: DsfinvkReceiptInput[],
  angaben: MenschlicheAngaben = mensch(),
): string[][] {
  const dateien = baueAlleDateien(TAX, formeDaten(bundle(receipts), angaben));
  const datei = dateien.find((d) => d.name === 'tse.csv');
  if (!datei) throw new Error('tse.csv fehlt im Paket');
  return datei.content
    .split('\r\n')
    .slice(1)
    .filter((z) => z.trim().length > 0)
    .map((z) => z.split(';').map((f) => f.replace(/^"|"$/g, '')));
}

describe('Nennt ein Beleg die Stammangaben, trägt der Erzeuger sie ein', () => {
  it('die Seriennummer der Sicherungseinrichtung steht in TSE_SERIAL', () => {
    const [zeile] = stammZeilen([BELEG]);
    expect(zeile?.[spalte('TSE_SERIAL')]).toBe(SERIENNUMMER);
  });

  it('der öffentliche Schlüssel steht in TSE_PUBLIC_KEY', () => {
    const [zeile] = stammZeilen([BELEG]);
    expect(zeile?.[spalte('TSE_PUBLIC_KEY')]).toBe(SCHLUESSEL);
  });

  it('⚠️ und die Signaturzeile zeigt auf GENAU diesen Stammsatz', () => {
    /**
     * Der eigentliche Zweck der Datei. Eine Seriennummer in einer Zeile, auf
     * die keine Signatur verweist, hilft einem Prüfer nicht.
     */
    const dateien = baueAlleDateien(TAX, formeDaten(bundle([BELEG]), mensch()));
    const stamm = stammZeilen([BELEG])[0];
    const spaltenTx = TAX.find((t) => t.datei === 'transactions_tse.csv')!.spalten.map(
      (s) => s.name,
    );
    const tx = (
      dateien.find((d) => d.name === 'transactions_tse.csv')!.content.split('\r\n')[1] ?? ''
    ).split(';');
    expect(tx[spaltenTx.indexOf('TSE_ID')]).toBe(stamm?.[spalte('TSE_ID')]);
  });
});

describe('Mehrere Belege, mehrere Geräte', () => {
  it('zwei Belege derselben TSE ergeben EINEN Stammsatz', () => {
    const zeilen = stammZeilen([BELEG, zweiterBeleg({})]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.[spalte('TSE_SERIAL')]).toBe(SERIENNUMMER);
  });

  it('⚠️ zwei GERÄTE bekommen jedes SEINE eigene Seriennummer', () => {
    /**
     * Der Fehler, der hier lauert: eine einzige gemerkte Seriennummer für
     * alle Geräte. Dann trüge das zweite Gerät die Nummer des ersten — eine
     * falsche Angabe, und zwar eine, die plausibel aussieht.
     */
    const zweitgeraet = zweiterBeleg({
      fiskalyTssId: 'tss-2',
      tssSerialNumber: '7A0099BB00000007',
      signaturePublicKey: 'ZWEITES-GERAET-SCHLUESSEL',
    });
    const zeilen = stammZeilen([BELEG, zweitgeraet]);
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]?.[spalte('TSE_SERIAL')]).toBe(SERIENNUMMER);
    expect(zeilen[1]?.[spalte('TSE_SERIAL')]).toBe('7A0099BB00000007');
    expect(zeilen[1]?.[spalte('TSE_PUBLIC_KEY')]).toBe('ZWEITES-GERAET-SCHLUESSEL');
  });
});

describe('⚠️ Was niemand nennt, wird nicht erfunden', () => {
  it('ohne Beigabe an der Signatur bleiben beide Spalten LEER', () => {
    const ohne = zweiterBeleg({ tssSerialNumber: null, signaturePublicKey: null });
    const zeilen = stammZeilen([{ ...ohne, transactionId: BELEG.transactionId }]);
    expect(zeilen[0]?.[spalte('TSE_SERIAL')]).toBe('');
    expect(zeilen[0]?.[spalte('TSE_PUBLIC_KEY')]).toBe('');
  });

  it('eine Angabe aus lauter Leerzeichen zählt NICHT als Angabe', () => {
    /**
     * Eine Zeichenkette aus Leerzeichen sähe in der Datei aus wie ein leeres
     * Feld, wäre aber technisch „gesetzt". Wer sie durchliesse, könnte später
     * nicht mehr unterscheiden, ob das Gerät geschwiegen hat oder ob jemand
     * einen leeren Wert aufgezeichnet hat.
     */
    const leer = zweiterBeleg({ tssSerialNumber: '   ', signaturePublicKey: '\t' });
    const zeilen = stammZeilen([{ ...leer, transactionId: BELEG.transactionId }]);
    expect(zeilen[0]?.[spalte('TSE_SERIAL')]).toBe('');
    expect(zeilen[0]?.[spalte('TSE_PUBLIC_KEY')]).toBe('');
  });

  it('Zertifikat und Zeitformat bleiben leer — die liefert die Brücke nicht', () => {
    const [zeile] = stammZeilen([BELEG]);
    for (const f of ['TSE_ZERTIFIKAT_I', 'TSE_ZERTIFIKAT_II', 'TSE_ZEITFORMAT']) {
      expect(zeile?.[spalte(f)], f).toBe('');
    }
  });
});

describe('Die Rangfolge: gemessen vor eingetragen', () => {
  it('schweigt die Signatur, greift die eingetragene Angabe', () => {
    const ohne = zweiterBeleg({ tssSerialNumber: null, signaturePublicKey: null });
    const zeilen = stammZeilen(
      [{ ...ohne, transactionId: BELEG.transactionId }],
      mensch({ 'tss-1': { seriennummer: 'VON-HAND', publicKey: 'SCHLUESSEL-VON-HAND' } }),
    );
    expect(zeilen[0]?.[spalte('TSE_SERIAL')]).toBe('VON-HAND');
    expect(zeilen[0]?.[spalte('TSE_PUBLIC_KEY')]).toBe('SCHLUESSEL-VON-HAND');
  });

  it('⚠️ nennt die Signatur einen Wert, gewinnt ER — das Gerät weiss es besser', () => {
    const zeilen = stammZeilen(
      [BELEG],
      mensch({ 'tss-1': { seriennummer: 'VON-HAND', publicKey: 'SCHLUESSEL-VON-HAND' } }),
    );
    expect(zeilen[0]?.[spalte('TSE_SERIAL')]).toBe(SERIENNUMMER);
    expect(zeilen[0]?.[spalte('TSE_PUBLIC_KEY')]).toBe(SCHLUESSEL);
  });
});

describe('Die Grenzen der Norm', () => {
  it('Seriennummer und Schlüssel bleiben in den Längen der index.xml', () => {
    /**
     * Die amtliche Beschreibung setzt `TSE_SERIAL` auf 68 und
     * `TSE_PUBLIC_KEY` auf 512 Zeichen. Ein Prüfwerkzeug liest die Datei mit
     * genau dieser Beschreibung ein.
     */
    const tabelle = TAX.find((t) => t.datei === 'tse.csv')!;
    const grenze = (name: string): number =>
      tabelle.spalten.find((s) => s.name === name)?.laenge ?? 0;
    expect(grenze('TSE_SERIAL')).toBe(68);
    expect(grenze('TSE_PUBLIC_KEY')).toBe(512);

    const [zeile] = stammZeilen([BELEG]);
    expect((zeile?.[spalte('TSE_SERIAL')] ?? '').length).toBeLessThanOrEqual(68);
    expect((zeile?.[spalte('TSE_PUBLIC_KEY')] ?? '').length).toBeLessThanOrEqual(512);
  });
});
