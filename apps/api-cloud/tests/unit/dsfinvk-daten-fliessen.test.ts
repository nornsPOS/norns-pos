/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE WERTE ERREICHEN DIE ZWANZIG DATEIEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bis hierher standen die zwanzig Dateien mit richtigen Kopfzeilen und leeren
 * Zeilen da. Diese Prüfung hält fest, dass die Werte ankommen — und dass sie
 * unterwegs NICHT verändert werden.
 *
 * Der Beleg, den der Kunde in der Hand hielt, und die Zeile im Prüferpaket
 * müssen dieselbe Zahl tragen. Eine Neuberechnung im Export wäre der Weg, auf
 * dem beide auseinanderlaufen.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { formeDaten, type MenschlicheAngaben } from '../../src/lib/dsfinvk-daten.js';
import { baueAlleDateien } from '../../src/lib/dsfinvk-dateien.js';
import type { DsfinvkBundleInput, DsfinvkReceiptInput } from '../../src/lib/dsfinvk-export.js';
import { leseTaxonomie } from '../../src/lib/dsfinvk-taxonomie.js';
import { UST_STAMM_FEST, UstSchluesselOffenError, ustSchluesselFuer, zahlartTypFuer } from '../../src/lib/dsfinvk-schluessel.js';
import { leseStammdaten } from '../../src/lib/haendler-stammdaten.js';

const TAX = leseTaxonomie(
  readFileSync(new URL('../../src/fiskal/dsfinvk-2.4/index.xml', import.meta.url), 'utf8'),
);

const mensch = (
  ust: Record<string, string> = { MARGIN_25A: '1001' },
  // ⚠️ Die Entscheidung des Steuerberaters zum Ankauf von Privat. Sie steht
  // hier ausdrücklich als Angabe der Vorrichtung und nicht als Vorgabe im
  // Erzeuger: ein Wert, den Anhang C nicht kennt, muss auch in den Prüfungen
  // scheitern können.
  gvTypAnkauf: string | null = 'Auszahlung',
): MenschlicheAngaben => ({
  gvTypAnkauf,
  stammdaten: leseStammdaten({
    'shop.legal_name': 'Muster Edelmetallhandel e. K.',
    'shop.street': 'Musterstraße 1',
    'shop.postal_code': '73614',
    'shop.city': 'Schorndorf',
    'shop.country_code': 'DEU',
    'shop.tax_number': '12345/67890',
    'shop.vat_id': 'DE343451090',
  }),
  eigeneUstSchluessel: ust,
  kassenSeriennummer: 'KS-0001',
  taxonomieVersion: '2.4',
  softwareVersion: '1.0.0',
});

/** Eine echte Goldmünze aus dem Monatslauf: VK 270,00, EK 250,00, Marge 20,00. */
const eingabe: DsfinvkBundleInput = {
  businessDay: '2026-06-01',
  closing: {
    zNr: '1',
    finalizedAt: '2026-06-01T20:00:00.000Z',
    grossVerkaufEur: '270.00', grossAnkaufEur: '0.00',
    netVerkaufEur: '266.81', netAnkaufEur: '0.00',
    vatByTreatment: { MARGIN_25A: '3.19' },
    paymentsByMethod: { CASH: '270.00' },
    cashCountedEur: '470.00',
  },
  cashRegister: { id: 'KASSE-1', serialNumber: 'SN-1', brand: 'Norns', model: 'Tresen' },
  receipts: [
    {
      transactionId: 'aaaaaaaa-0000-0000-0000-000000000001',
      receiptLocator: 'RCP-2026-000049',
      direction: 'VERKAUF',
      finalizedAt: '2026-06-01T10:00:00.000Z',
      taxTreatmentCode: 'MARGIN_25A',
      subtotalEur: '266.81', vatEur: '3.19', totalEur: '270.00',
      cashierUserId: 'user-1', customerId: null, isStorno: false,
      lines: [{
        lineNumber: 1, productName: 'Goldmünze Krügerrand', quantity: '1',
        appliedTaxTreatmentCode: 'MARGIN_25A', appliedVatRate: null,
        lineSubtotalEur: '266.81', lineVatEur: '3.19', lineTotalEur: '270.00',
      }],
      payments: [{ paymentMethod: 'CASH', amountEur: '270.00' }],
      tse: {
        fiskalyTransactionNumber: '1', signatureCounter: '1',
        signatureValue: 'MEUCIE8Q', signatureAlgorithm: 'ecdsa-plain-SHA256',
        fiskalyTssId: 'tss-1', processType: 'Kassenbeleg-V1',
        tseStartTime: '2026-06-01T10:00:00.000Z',
        tseEndTime: '2026-06-01T10:00:01.000Z',
        // Was die Sicherungseinrichtung jeder Signatur beilegt. Die Brücke der
        // Kasse liest beide Werte aus der Antwort heraus
        // (`apps/tauri-pos/src-tauri/src/commands/tse.rs:338` und `:339`).
        //
        // ⛔ Hier stehen sie, weil DIESE VORLAGE sie hinschreibt. Im Betrieb
        // kommt heute keiner der beiden Werte an — die Kette ist an vier
        // Stellen offen, aufgezählt an `DsfinvkTseInput` in
        // `src/lib/dsfinvk-export.ts` und gemessen von
        // `tests/unit/tse-stammdaten-lebender-weg.test.ts`.
        tssSerialNumber: '5E4B1C9A00000042',
        signaturePublicKey: 'BGxQ0e7Vd2ZmYWtlUHVibGljS2V5',
      },
    },
  ],
};

/**
 * Der Beleg der Vorlage, mit seinem ECHTEN Typ.
 *
 * ⚠️ Hier stand an fünf Stellen `as never`. Das ist kein Typ, sondern sein
 * Gegenteil: `never` hat keine Eigenschaften, lässt sich deshalb nicht
 * ausbreiten, und `tsc -p tsconfig.tests.json` war seit dem 30.07. rot. Ein
 * roter Torwächter ist ein abgeschalteter Torwächter — und genau dieser hier
 * ist der, der verhindert, dass eine Prüfung mit einem Feld zu wenig
 * durchrutscht.
 *
 * Der Zugriff auf das erste Element ist bewusst einmal behauptet und nicht an
 * jeder Stelle neu: die Vorlage oben hat genau einen Beleg, und wenn das
 * jemand ändert, soll es an EINER Stelle auffallen.
 */
const VORLAGE_BELEG = eingabe.receipts[0] as DsfinvkReceiptInput;

const feld = (datei: string, spalte: string, zeile = 1): string => {
  const dateien = baueAlleDateien(TAX, formeDaten(eingabe, mensch()));
  const d = dateien.find((x) => x.name === datei)!;
  const spalten = TAX.find((t) => t.datei === datei)!.spalten.map((s) => s.name);
  return (d.content.split('\r\n')[zeile] ?? '').split(';')[spalten.indexOf(spalte)] ?? '';
};

/** Cent-Hilfen für die Testtabellen, bewusst getrennt von der Quelle. */
function zuCentProbe(v: string): bigint {
  const [w = '0', f = ''] = v.split('.');
  return BigInt(w) * 100n + BigInt((f + '00').slice(0, 2));
}
function ausCentProbe(c: bigint): string {
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
}

describe('⛔ die Zahl des Belegs ist die Zahl der Datei', () => {
  it('der Bruttoumsatz kommt unverändert an', () => {
    expect(feld('transactions.csv', 'UMS_BRUTTO')).toBe('270,00');
  });

  it('und die Position ebenso, mit fünf Nachkommastellen', () => {
    expect(feld('lines.csv', 'STK_BR')).toBe('270,00000');
  });

  it('⚠️ die Steuer wird NICHT neu gerechnet', () => {
    // 19/119 von 20,00 Marge ist 3,19 — aber die Datei nimmt die
    // GESPEICHERTE Zahl, nicht eine eigene Rechnung.
    expect(feld('lines_vat.csv', 'POS_UST')).toBe('3,19000');
    expect(feld('lines_vat.csv', 'POS_NETTO')).toBe('266,81000');
  });

  it('der Beleg je Steuersatz stimmt mit der Position überein', () => {
    expect(feld('transactions_vat.csv', 'BON_UST')).toBe('3,19000');
    expect(feld('transactions_vat.csv', 'BON_BRUTTO')).toBe('270,00000');
  });
});

describe('die Schlüssel und Typen der Norm', () => {
  it('der Beleg ist ein Beleg, kein Storno', () => {
    expect(feld('transactions.csv', 'BON_TYP')).toBe('Beleg');
    expect(feld('transactions.csv', 'BON_STORNO')).toBe('0');
  });

  it('⚠️ BON_ID und BON_NR sind VERSCHIEDEN', () => {
    // Die Norm trennt sie: BON_ID ist dauerhaft eindeutig, BON_NR nur
    // innerhalb eines Abschlusses. Vorher stand beide Male dasselbe.
    expect(feld('transactions.csv', 'BON_ID')).toBe('RCP-2026-000049');
    expect(feld('transactions.csv', 'BON_NR')).toBe('49');
  });

  it('der Geschäftsvorfall ist Umsatz', () => {
    expect(feld('lines.csv', 'GV_TYP')).toBe('Umsatz');
  });

  it('die Barzahlung ist Bar', () => {
    expect(feld('datapayment.csv', 'ZAHLART_TYP')).toBe('Bar');
    expect(feld('datapayment.csv', 'ZAHLWAEH_BETRAG')).toBe('270,00');
  });

  it('⚠️ und § 25a trägt den Schlüssel des BERATERS, nicht 7', () => {
    expect(feld('lines_vat.csv', 'UST_SCHLUESSEL')).toBe('1001');
  });
});

describe('die TSE-Zeile', () => {
  it('Signatur, Zähler und Zeiten kommen an', () => {
    expect(feld('transactions_tse.csv', 'TSE_TA_SIGZ')).toBe('1');
    expect(feld('transactions_tse.csv', 'TSE_TA_SIG')).toBe('MEUCIE8Q');
    expect(feld('transactions_tse.csv', 'TSE_TA_VORGANGSART')).toBe('Kassenbeleg-V1');
  });
});

describe('der Kassenabschluss', () => {
  it('trägt jetzt die Angaben zum Steuerpflichtigen', () => {
    expect(feld('cashpointclosing.csv', 'NAME')).toBe('Muster Edelmetallhandel e. K.');
    expect(feld('cashpointclosing.csv', 'PLZ')).toBe('73614');
    expect(feld('cashpointclosing.csv', 'LAND')).toBe('DEU');
    expect(feld('cashpointclosing.csv', 'USTID')).toBe('DE343451090');
  });

  it('und den ersten und letzten Beleg', () => {
    expect(feld('cashpointclosing.csv', 'Z_START_ID')).toBe('RCP-2026-000049');
    expect(feld('cashpointclosing.csv', 'Z_ENDE_ID')).toBe('RCP-2026-000049');
  });

  it('cash_per_currency trägt die SUMME DER BARZAHLUNGEN, nicht den gezählten Bestand', () => {
    // 06.08.2026: hier stand der GEZÄHLTE Kassenbestand
    // (`closing.cashCountedEur`, 470,00 in der Vorlage). Die Tiefenprüfung vom
    // 05.08.2026 fand, dass diese Datei zur Zahlartenaufstellung gehört: sie
    // muss mit `Z_SE_BARZAHLUNGEN` auf den Cent zusammenfallen. Der gezählte
    // Bestand beantwortet eine andere Frage und tat das nicht. Die Vorlage
    // trägt genau eine Barzahlung über 270,00, das ist jetzt der Wert hier.
    // Der gezählte Bestand steht weiterhin im Kassenbericht, nur nicht mehr
    // in diesem Paket, siehe den Quelltextkommentar bei `kassenlade`.
    expect(feld('cash_per_currency.csv', 'ZAHLART_BETRAG_WAEH')).toBe('270,00');
  });

  it('⚠️ Brutto und Netto je Geschäftsvorfall kommen aus den Belegpositionen', () => {
    // 06.08.2026: hier stand, der Abschluss führe Brutto und Netto nicht und
    // beide Felder blieben deshalb LEER, eine Rückrechnung aus der Steuer
    // hätte dem Beleg widersprechen können. Die Tiefenprüfung vom 05.08.2026
    // fand die Wurzel woanders: `businesscases.csv` entstand aus
    // `closing.vatByTreatment`, einer Aufstellung, die nur die Steuer je
    // Behandlung führte und den Ankauf nicht kannte. Jetzt entsteht die
    // Datei aus den POSITIONEN DER BELEGE, je Geschäftsvorfalltyp und
    // Steuerschlüssel, derselben Quelle wie `transactions_vat.csv`. Damit
    // stehen Brutto und Netto da, weil der Beleg sie hergibt, keine Lücke
    // und keine Neuberechnung mehr.
    expect(feld('businesscases.csv', 'Z_UMS_BRUTTO')).toBe('270,00000');
    expect(feld('businesscases.csv', 'Z_UMS_NETTO')).toBe('266,81000');
    // ⚠️ FÜNF Nachkommastellen: die index.xml sagt `<Accuracy>5` für diese
    // drei Spalten. Zwei Stellen hiessen, das Paket beschreibt seine eigenen
    // Zahlen falsch.
    expect(feld('businesscases.csv', 'Z_UST')).toBe('3,19000');
  });
});

describe('⛔ ohne die Antwort des Beraters entsteht nichts', () => {
  it('der fehlende § 25a-Schlüssel bricht ab', () => {
    expect(() => formeDaten(eingabe, mensch({}))).toThrow(UstSchluesselOffenError);
  });
});

/**
 * ⚠️ Drei Angriffe blieben beim ersten Versuch GRÜN, weil diese Datei die
 * Fälle gar nicht prüfte. Ein Wächter, der einen Fall nicht kennt, bewacht
 * ihn nicht.
 */
describe('⛔ die Fälle, die der erste Entwurf übersah', () => {
  const ohneStammdaten: MenschlicheAngaben = {
    ...mensch(),
    stammdaten: leseStammdaten({ 'shop.vat_id': 'DE343451090' }),
  };

  const feldMit = (
    e: DsfinvkBundleInput,
    m: MenschlicheAngaben,
    datei: string,
    spalte: string,
    zeile = 1,
  ): string => {
    const dateien = baueAlleDateien(TAX, formeDaten(e, m));
    const d = dateien.find((x) => x.name === datei)!;
    const spalten = TAX.find((t) => t.datei === datei)!.spalten.map((s) => s.name);
    return (d.content.split('\r\n')[zeile] ?? '').split(';')[spalten.indexOf(spalte)] ?? '';
  };

  it('⛔ ein fehlendes Länderkennzeichen wird NICHT zu DEU', () => {
    // Ein Vorgabewert wäre bei einem Mandanten in Österreich oder der Schweiz
    // eine Anschrift, die niemand eingegeben hat.
    expect(feldMit(eingabe, ohneStammdaten, 'cashpointclosing.csv', 'LAND')).toBe('');
    expect(feldMit(eingabe, ohneStammdaten, 'location.csv', 'LOC_LAND')).toBe('');
  });

  it('⛔ ein fehlender Firmenname bleibt leer', () => {
    expect(feldMit(eingabe, ohneStammdaten, 'cashpointclosing.csv', 'NAME')).toBe('');
  });

  it('⛔ ein STORNO trägt „Beleg" und die 1 — nicht AVBelegstorno', () => {
    const storno: DsfinvkBundleInput = {
      ...eingabe,
      receipts: [{ ...eingabe.receipts[0]!, isStorno: true, receiptLocator: 'RCP-2026-000050' }],
    };
    // ⚠️ `Beleg`, nicht `AVBelegstorno`: dieses Haus bucht gegen, und die
    // Norm verbietet AVBelegstorno für TSE-Kassen ausdrücklich. Das
    // Storno-Kennzeichen am Kopf bleibt.
    expect(feldMit(storno, mensch(), 'transactions.csv', 'BON_TYP')).toBe('Beleg');
    expect(feldMit(storno, mensch(), 'transactions.csv', 'BON_STORNO')).toBe('1');
  });

  it('⛔ ein Tag OHNE Barzahlung ergibt KEINE Zeile in cash_per_currency', () => {
    // 06.08.2026: hier stand, ein NICHT gezählter Kassenbestand
    // (`closing.cashCountedEur: null`) erzeuge keine Zeile. Seit
    // `cash_per_currency.csv` die Summe der Barzahlungen trägt statt des
    // gezählten Bestands, entscheidet dieses Feld gar nicht mehr, ob die
    // Zeile entsteht. Ein Tag mit Barzahlung bekommt seine Zeile auch dann,
    // wenn `cashCountedEur` fehlt, siehe der Test daneben. Was jetzt
    // entscheidet: ob überhaupt eine Barzahlung in den Belegen steht.
    const ohneBar: DsfinvkBundleInput = {
      ...eingabe,
      receipts: [{
        ...eingabe.receipts[0]!,
        payments: [{ paymentMethod: 'ZVT_CARD', amountEur: '270.00' }],
      }],
    };
    const dateien = baueAlleDateien(TAX, formeDaten(ohneBar, mensch()));
    const d = dateien.find((x) => x.name === 'cash_per_currency.csv')!;
    expect(d.content.split('\r\n').filter((z) => z !== '')).toHaveLength(1);
  });
});

describe('⛔ P_STORNO bleibt LEER, weil signiert wird', () => {
  it('die Positionen eines Stornos tragen KEINE Positionsstornierung', async () => {
    // Tz. 4.2.3, wörtlich: wer eine zweite Zeile mit negiertem Vorzeichen
    // erstellt, darf P_STORNO gerade NICHT auf „1" setzen — und „sobald die
    // Transaktion in der TSE signiert ist, darf das Feld P_STORNO nicht mehr
    // verwendet werden". Dieses Haus tut beides.
    const storno: DsfinvkBundleInput = {
      ...eingabe,
      receipts: [{ ...eingabe.receipts[0]!, isStorno: true, receiptLocator: 'RCP-2026-000050' }],
    };
    const dateien = baueAlleDateien(TAX, formeDaten(storno, mensch()));
    const d = dateien.find((x) => x.name === 'lines.csv')!;
    const spalten = TAX.find((t) => t.datei === 'lines.csv')!.spalten.map((s) => s.name);
    const zeile = (d.content.split('\r\n')[1] ?? '').split(';');
    expect(zeile[spalten.indexOf('P_STORNO')]).toBe('0');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER STORNO ZEIGTE NIRGENDS AUF SEINEN URBELEG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das Paket sagte, DASS storniert wurde, aber nicht WAS.
 *
 * Tz. 4.2.2 der Norm, wörtlich: „Um einen Bezug zum ursprünglichen Vorgang zu
 * ermöglichen, muss ein Datensatz in der Datei: Bon_Referenzen angelegt
 * werden, der die Referenz zum stornierten Vorgang enthält." Ein MUSS.
 *
 * Die Verknüpfung lag die ganze Zeit in der Datenbank
 * (`storno_of_transaction_id`, Wanderung 0009). Die Exportroute las nur ihre
 * EXISTENZ (`IS NOT NULL AS is_storno`) und warf die Identität weg.
 */
describe('⛔ references.csv: der Verweis auf den Urbeleg', () => {
  const mitVerweis: DsfinvkBundleInput = {
    ...eingabe,
    receipts: [{
      ...eingabe.receipts[0]!,
      receiptLocator: 'RCP-2026-000050',
      isStorno: true,
      stornoVon: {
        bonId: 'RCP-2026-000049',
        zNr: '1',
        erstellung: '2026-06-01T20:00:00.000Z',
      },
    }],
  };

  const refFeld = (spalte: string): string => {
    const dateien = baueAlleDateien(TAX, formeDaten(mitVerweis, mensch()));
    const d = dateien.find((x) => x.name === 'references.csv')!;
    const spalten = TAX.find((t) => t.datei === 'references.csv')!.spalten.map((s) => s.name);
    return (d.content.split('\r\n')[1] ?? '').split(';')[spalten.indexOf(spalte)] ?? '';
  };

  it('die Zeile entsteht', () => {
    const dateien = baueAlleDateien(TAX, formeDaten(mitVerweis, mensch()));
    const d = dateien.find((x) => x.name === 'references.csv')!;
    expect(d.content.split('\r\n').filter((z) => z !== ''), 'kein Verweis').toHaveLength(2);
  });

  it('sie hängt am STORNO, nicht am Urbeleg', () => {
    expect(refFeld('BON_ID')).toBe('RCP-2026-000050');
    expect(refFeld('REF_BON_ID')).toBe('RCP-2026-000049');
  });

  it('⚠️ REF_TYP ist „Transaktion" — der einzige interne Verweis', () => {
    // Die drei anderen Werte zeigen auf Systeme AUSSERHALB der Kasse.
    expect(refFeld('REF_TYP')).toBe('Transaktion');
  });

  it('⚠️ POS_ZEILE bleibt LEER — der Verweis geht vom BONKOPF aus', () => {
    // Die Norm: „Zeilennummer des referenzierenden Vorgangs (nicht bei
    // Verweis aus einem Bonkopf heraus)". Ein Verweis kann strukturell nie
    // auf eine Position zeigen — ein Feld REF_POS_ZEILE gibt es nicht.
    expect(refFeld('POS_ZEILE')).toBe('');
  });

  it('⚠️ REF_NAME bleibt LEER — es gehört nur zu ExterneSonstige', () => {
    expect(refFeld('REF_NAME')).toBe('');
  });

  it('der Abschluss des URBELEGS wird genannt, nicht der eigene', () => {
    // ⚠️ Der Urbeleg kann in einem FRÜHEREN Kassenabschluss liegen — und dann
    // sind die beiden Nummern VERSCHIEDEN. Die erste Fassung prüfte gegen
    // `'1'`, und der eigene Abschluss trug im Beispiel ebenfalls die 1: der
    // Angriff „eigener Abschluss statt Urbeleg" blieb grün.
    const frueher: DsfinvkBundleInput = {
      ...mitVerweis,
      closing: { ...mitVerweis.closing, zNr: '7' },
      receipts: [{
        ...mitVerweis.receipts[0]!,
        stornoVon: { bonId: 'RCP-2026-000049', zNr: '1', erstellung: '2026-06-01T20:00:00.000Z' },
      }],
    };
    const dateien = baueAlleDateien(TAX, formeDaten(frueher, mensch()));
    const d = dateien.find((x) => x.name === 'references.csv')!;
    const spalten = TAX.find((t) => t.datei === 'references.csv')!.spalten.map((s) => s.name);
    const zeile = (d.content.split('\r\n')[1] ?? '').split(';');
    expect(zeile[spalten.indexOf('Z_NR')], 'der eigene Abschluss').toBe('7');
    expect(zeile[spalten.indexOf('REF_Z_NR')], 'der Abschluss des Urbelegs').toBe('1');
    expect(zeile[spalten.indexOf('REF_DATUM')]).toBe('2026-06-01T20:00:00.000Z');
  });

  it('ein gewöhnlicher Beleg erzeugt KEINE Zeile', () => {
    const dateien = baueAlleDateien(TAX, formeDaten(eingabe, mensch()));
    const d = dateien.find((x) => x.name === 'references.csv')!;
    expect(d.content.split('\r\n').filter((z) => z !== '')).toHaveLength(1);
  });
});

/**
 * ⚠️ Der Wächter über die Route: sie muss den Verweis MITLESEN.
 */
describe('die Exportroute liest den Storno-Verweis', () => {
  it('sie holt Beleg, Abschlussnummer und Zeitpunkt des Urbelegs', async () => {
    // ⚠️ 18.08.2026: der Rumpf wohnt in lib/dsfinvk-tag.ts (Prueferpaket
    // als zweiter Rufer); gelesen werden beide Haeuser.
    const fs = await import('node:fs');
    const q =
      fs.readFileSync(new URL('../../src/lib/dsfinvk-tag.ts', import.meta.url), 'utf8') +
      '\n' +
      fs.readFileSync(new URL('../../src/routes/closing-export.ts', import.meta.url), 'utf8');
    // Die Verknüpfung lag immer da; nur ihre IDENTITÄT wurde weggeworfen.
    // ⚠️ Auf die SPALTE prüfen, nicht auf den Alias. `NULL::text AS
    // storno_von_beleg` enthielte den Namen ebenfalls — dieselbe Falle, in
    // die schon der § 25a-Wächter und der Z-Nummer-Wächter gelaufen sind.
    expect(q).toContain('storno_of_transaction_id');
    expect(
      /o\.receipt_locator\s+AS\s+storno_von_beleg/.test(q),
      'der Belegbezeichner des Urbelegs kommt nicht aus der SPALTE',
    ).toBe(true);
    expect(
      /d\.z_nr::text\s+AS\s+storno_von_z_nr/.test(q),
      'die Abschlussnummer des Urbelegs kommt nicht aus der SPALTE',
    ).toBe(true);
    expect(q, 'der Abschluss des Urbelegs wird nicht mitgelesen').toContain('daily_closings d');
    expect(q).toContain('stornoVon:');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  vat.csv WIDERSPRACH lines_vat.csv IM SELBEN PAKET
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Im erzeugten Paket gemessen:
 *
 *     vat.csv        Schlüssel 1001 → 0,00 %
 *     lines_vat.csv  Schlüssel 1001 → 3,19 EUR Umsatzsteuer
 *
 * Die Datei, mit der ein Prüfer die Schlüssel AUFLÖST, sagte „dieser
 * Schlüssel ist null Prozent", während die Belegdatei daneben unter demselben
 * Schlüssel Steuer auswies.
 *
 * Ursache: ein fest eingetragenes `0.00` für jeden Schlüssel des Beraters.
 * § 25a wird mit 19 Prozent auf die MARGE besteuert, nicht mit null.
 *
 * Die Norm nennt § 25a ausdrücklich als Beispiel für die IDs ab 1000: „Ab der
 * ID = 1000 können besondere umsatzsteuerliche Sachverhalte (z. B.
 * Differenzbesteuerung § 25a UStG, Sachverhalte des § 13b UStG) kenntlich
 * gemacht werden." Welcher Prozentsatz dort steht, entscheidet der Berater.
 */
describe('⛔ vat.csv erfindet keinen Steuersatz', () => {
  /**
   * ⚠️ Diese Hilfe suchte die Zeile früher über ihre NUMMER — Zeile 4 war der
   * Schlüssel des Beraters. Das ging nur, solange `vat.csv` eine feste Liste
   * war (1, 2, 5, dann die eigenen). Seit die Liste dem GEBRAUCH folgt, ist
   * die Zeilennummer bedeutungslos: ein Paket ohne § 25a hat dort gar keine
   * vierte Zeile.
   *
   * Sie sucht jetzt über den SCHLÜSSEL. Das ist ohnehin die ehrlichere Frage:
   * „was steht beim Schlüssel 1001" statt „was steht in Zeile 4".
   */
  const satzZeile = (m: MenschlicheAngaben, schluessel: string): Record<string, string> => {
    const dateien = baueAlleDateien(TAX, formeDaten(eingabe, m));
    const spalten = TAX.find((t) => t.datei === 'vat.csv')!.spalten.map((s) => s.name);
    const i = spalten.indexOf('UST_SCHLUESSEL');
    const roh = dateien
      .find((x) => x.name === 'vat.csv')!
      .content.split('\r\n')
      .slice(1)
      .filter(Boolean)
      .map((z) => z.split(';'))
      .find((z) => z[i] === schluessel);
    return Object.fromEntries(spalten.map((n, k) => [n, roh?.[k] ?? '']));
  };

  it('⛔ ohne Angabe des Beraters bleibt der Satz LEER, nicht 0,00', () => {
    // Eine Null ist hier eine AUSSAGE („steuerfrei"), kein Fehlen — und für
    // § 25a ist sie falsch.
    const z = satzZeile(mensch(), '1001');
    expect(z['UST_SCHLUESSEL'], 'der Schlüssel des Beraters steht überhaupt da').toBe('1001');
    expect(z['UST_SATZ']).toBe('');
  });

  it('✅ mit seiner Angabe steht sie drin', () => {
    const m: MenschlicheAngaben = {
      ...mensch(),
      eigeneUstSaetze: { MARGIN_25A: '19.00' },
      eigeneUstBeschreibungen: { MARGIN_25A: 'Differenzbesteuerung § 25a UStG' },
    };
    expect(satzZeile(m, '1001')['UST_SATZ']).toBe('19,00');
    expect(satzZeile(m, '1001')['UST_BESCHR']).toBe('Differenzbesteuerung § 25a UStG');
  });

  it('die festen Sätze stehen wörtlich so, wie Anlage 2 sie führt', () => {
    // ⚠️ Hier stand: Zeile 1 = 19,00, Zeile 2 = 7,00, Zeile 3 = 0,00. Das war
    // die alte, fest verdrahtete Liste — der Test hat die Verdrahtung
    // BEHAUPTET, nicht eine Eigenschaft geprüft. Jetzt wird die Quelle selbst
    // gegen die Anlage gehalten; ob eine Zeile im Paket auftaucht, entscheidet
    // allein, ob ein Vorgang sie benutzt.
    expect(UST_STAMM_FEST['1']).toEqual({
      satz: '19.00', beschreibung: 'Allgemeiner Steuersatz § 12 Abs. 1 UStG',
    });
    expect(UST_STAMM_FEST['2']).toEqual({
      satz: '7.00', beschreibung: 'Ermäßigter Steuersatz § 12 Abs. 2 UStG',
    });
    expect(UST_STAMM_FEST['6']).toEqual({ satz: '0.00', beschreibung: 'Umsatzsteuerfrei' });
    // Und die 5 gehört NICHT dazu: „Nicht Steuerbar" ist kein Sachverhalt
    // dieses Hauses, und sie stand nur da, weil jemand sie einmal hinschrieb.
    expect(UST_STAMM_FEST['5']).toBeUndefined();
  });

  it('⛔ und KEIN Schlüssel wird mit 0,00 ausgewiesen, unter dem Steuer anfällt', () => {
    // Die Gegenprobe über das GANZE Paket: für jeden Schlüssel, unter dem in
    // lines_vat.csv Steuer steht, darf vat.csv nicht null Prozent behaupten.
    const dateien = baueAlleDateien(TAX, formeDaten(eingabe, mensch()));
    const spaltenVat = TAX.find((t) => t.datei === 'vat.csv')!.spalten.map((s) => s.name);
    const spaltenLine = TAX.find((t) => t.datei === 'lines_vat.csv')!.spalten.map((s) => s.name);

    const saetze = new Map<string, string>();
    for (const z of dateien.find((d) => d.name === 'vat.csv')!.content.split('\r\n').slice(1)) {
      if (z.trim() === '') continue;
      const f = z.split(';');
      saetze.set(f[spaltenVat.indexOf('UST_SCHLUESSEL')]!, f[spaltenVat.indexOf('UST_SATZ')]!);
    }

    for (const z of dateien.find((d) => d.name === 'lines_vat.csv')!.content.split('\r\n').slice(1)) {
      if (z.trim() === '') continue;
      const f = z.split(';');
      const schluessel = f[spaltenLine.indexOf('UST_SCHLUESSEL')]!;
      const ust = Number((f[spaltenLine.indexOf('POS_UST')] ?? '0').replace(',', '.'));
      if (ust === 0) continue;
      expect(
        saetze.get(schluessel),
        `Schlüssel ${schluessel} trägt Steuer, aber vat.csv weist ihn als 0,00 % aus`,
      ).not.toBe('0,00');
    }
  });
});

describe('⛔ STK_BR ist der Preis pro Einheit, nicht der Zeilenbetrag', () => {
  it('bei Menge 1 sind beide gleich', () => {
    expect(feld('lines.csv', 'STK_BR')).toBe('270,00000');
    expect(feld('lines.csv', 'MENGE')).toBe('1,000');
  });

  it('⛔ bei Menge 2 steht der HALBE Zeilenbetrag', () => {
    // Die Norm: „(Grund)Preis pro Maßeinheit … Fleisch kostet z. B. 5 € pro
    // 1,5 kg, verkaufte Menge: 2 kg. Preis pro Maßeinheit: 5,00."
    // Vorher stand dort der Zeilenbetrag — bei Menge 2 also der DOPPELTE
    // Preis. Ein latenter Fehler, der genau dann auffällt, wenn niemand mehr
    // daran denkt.
    const zwei: DsfinvkBundleInput = {
      ...eingabe,
      receipts: [{
        ...eingabe.receipts[0]!,
        lines: [{ ...eingabe.receipts[0]!.lines[0]!, quantity: '2' }],
      }],
    };
    const dateien = baueAlleDateien(TAX, formeDaten(zwei, mensch()));
    const spalten = TAX.find((t) => t.datei === 'lines.csv')!.spalten.map((s) => s.name);
    const zeile = (dateien.find((d) => d.name === 'lines.csv')!.content.split('\r\n')[1] ?? '').split(';');
    expect(zeile[spalten.indexOf('STK_BR')]).toBe('135,00000');
  });

  it('eine unbrauchbare Menge lässt den Zeilenbetrag stehen', () => {
    // Eine Division durch null ergäbe `Infinity` — schlimmer als eine
    // ungeteilte Zahl.
    const null_: DsfinvkBundleInput = {
      ...eingabe,
      receipts: [{
        ...eingabe.receipts[0]!,
        lines: [{ ...eingabe.receipts[0]!.lines[0]!, quantity: '0' }],
      }],
    };
    const dateien = baueAlleDateien(TAX, formeDaten(null_, mensch()));
    const spalten = TAX.find((t) => t.datei === 'lines.csv')!.spalten.map((s) => s.name);
    const zeile = (dateien.find((d) => d.name === 'lines.csv')!.content.split('\r\n')[1] ?? '').split(';');
    expect(zeile[spalten.indexOf('STK_BR')]).toBe('270,00000');
  });
});

describe('⛔ tse.csv erklärt die TSE_ID, auf die jede Signatur zeigt', () => {
  it('sie ist nicht mehr leer', () => {
    const dateien = baueAlleDateien(TAX, formeDaten(eingabe, mensch()));
    const d = dateien.find((x) => x.name === 'tse.csv')!;
    expect(d.content.split('\r\n').filter((z) => z !== ''), 'tse.csv ist leer').toHaveLength(2);
  });

  it('⚠️ die TSE_ID ist eine laufende Nummer, keine fiskaly-UUID', () => {
    // Die Norm: TSE_ID „wird nur zur Referenzierung INNERHALB eines
    // Kassenabschlusses verwendet".
    const dateien = baueAlleDateien(TAX, formeDaten(eingabe, mensch()));
    const spaltenTse = TAX.find((t) => t.datei === 'tse.csv')!.spalten.map((s) => s.name);
    const zeile = (dateien.find((d) => d.name === 'tse.csv')!.content.split('\r\n')[1] ?? '').split(';');
    expect(zeile[spaltenTse.indexOf('TSE_ID')]).toBe('1');

    // Und die Signaturzeile zeigt auf DIESELBE Nummer.
    const spaltenTx = TAX.find((t) => t.datei === 'transactions_tse.csv')!.spalten.map((s) => s.name);
    const tx = (dateien.find((d) => d.name === 'transactions_tse.csv')!.content.split('\r\n')[1] ?? '').split(';');
    expect(tx[spaltenTx.indexOf('TSE_ID')]).toBe('1');
  });

  it('der Signaturalgorithmus kommt aus den Belegen', () => {
    const dateien = baueAlleDateien(TAX, formeDaten(eingabe, mensch()));
    const spalten = TAX.find((t) => t.datei === 'tse.csv')!.spalten.map((s) => s.name);
    const zeile = (dateien.find((d) => d.name === 'tse.csv')!.content.split('\r\n')[1] ?? '').split(';');
    expect(zeile[spalten.indexOf('TSE_SIG_ALGO')]).toBe('ecdsa-plain-SHA256');
  });

  /**
   * ⚠️ WAS DIESE PRÜFUNG SAGT — UND WAS NICHT.
   *
   * Sie hiess bis zum 12.08.2026 „und was fehlt, bleibt LEER statt erfunden"
   * und verlangte, dass `TSE_SERIAL`, `TSE_PUBLIC_KEY` und `TSE_ZERTIFIKAT_I`
   * leer sind, weil alle drei vom TSE-Anbieter kämen und „noch nicht im
   * System" lägen.
   *
   * Für zwei der drei ist das zu grob: die Sicherungseinrichtung legt
   * Seriennummer und öffentlichen Schlüssel JEDER Signatur bei, und die
   * Brücke der Kasse liest beide aus
   * (`apps/tauri-pos/src-tauri/src/commands/tse.rs:338` und `:339`). Nennt ein
   * Beleg sie, MUSS der Erzeuger sie eintragen — das hält diese Prüfung fest.
   *
   * ⛔ Sie sagt damit NICHT, dass die Werte im Betrieb ankommen. Sie kommen
   * heute nicht an: die Vorlage oben schreibt beide selbst hin, und der
   * lebende Weg füllt keines der Felder (vier offene Stellen, aufgezählt an
   * `DsfinvkTseInput` in `src/lib/dsfinvk-export.ts`). Gemessen wird das von
   * `tests/unit/tse-stammdaten-lebender-weg.test.ts` und von
   * `tests/integration/tse-seriennummer-erreicht-das-pruefpaket.test.ts`.
   *
   * Für das Zertifikat stimmt die alte Aussage weiter: es liefert niemand.
   * Deshalb wurde sie nicht gelockert, sondern in die eigene Prüfung darunter
   * getrennt — leer ist dort die richtige Antwort. Dass auch Seriennummer und
   * Schlüssel bei Schweigen leer bleiben, hält
   * `tests/unit/tse-stammdaten-erreichen-tse-csv.test.ts` fest.
   */
  it('nennt der Beleg Seriennummer und Schlüssel, stehen sie in der Zeile', () => {
    const dateien = baueAlleDateien(TAX, formeDaten(eingabe, mensch()));
    const spalten = TAX.find((t) => t.datei === 'tse.csv')!.spalten.map((s) => s.name);
    const zeile = (dateien.find((d) => d.name === 'tse.csv')!.content.split('\r\n')[1] ?? '').split(';');
    expect(zeile[spalten.indexOf('TSE_SERIAL')]).toBe('5E4B1C9A00000042');
    expect(zeile[spalten.indexOf('TSE_PUBLIC_KEY')]).toBe('BGxQ0e7Vd2ZmYWtlUHVibGljS2V5');
  });

  it('das Zertifikat liefert niemand — es bleibt LEER statt erfunden', () => {
    const dateien = baueAlleDateien(TAX, formeDaten(eingabe, mensch()));
    const spalten = TAX.find((t) => t.datei === 'tse.csv')!.spalten.map((s) => s.name);
    const zeile = (dateien.find((d) => d.name === 'tse.csv')!.content.split('\r\n')[1] ?? '').split(';');
    for (const f of ['TSE_ZERTIFIKAT_I', 'TSE_ZERTIFIKAT_II']) {
      expect(zeile[spalten.indexOf(f)], f).toBe('');
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER UMSATZBLOCK DES KASSENABSCHLUSSES ENTHIELT KEINEN UMSATZ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `businesscases.csv` ist die Datei, aus der ein Prüfer den TAGESUMSATZ je
 * Steuersatz liest. Sie verlangt drei Beträge: `Z_UMS_BRUTTO`,
 * `Z_UMS_NETTO`, `Z_UST`. Wir konnten nur den dritten füllen, weil
 * `daily_closings` nur die Steuer je Behandlung führte.
 *
 * ⚠️ Und der Rückweg ist verboten. Aus 3,19 EUR bei 19/119 liesse sich
 * 20,00 EUR herleiten — aber bei § 25a ist das die MARGE, nicht der Umsatz.
 * Bei § 25c und § 13b ist die Steuer null; aus null lässt sich nichts
 * herleiten. Und jede Herleitung kann dem Beleg widersprechen.
 *
 * Wanderung 0127 zeichnet den Umsatz beim Festschreiben AUF.
 */
describe('⛔ businesscases.csv trägt den Umsatz je Steuersatz', () => {
  const mitUmsatz: DsfinvkBundleInput = {
    ...eingabe,
    closing: {
      ...eingabe.closing,
      umsatzByTreatment: { MARGIN_25A: { brutto: '270.00', netto: '266.81' } },
    },
  };

  const gv = (e: DsfinvkBundleInput, spalte: string): string => {
    const dateien = baueAlleDateien(TAX, formeDaten(e, mensch()));
    const d = dateien.find((x) => x.name === 'businesscases.csv')!;
    const spalten = TAX.find((t) => t.datei === 'businesscases.csv')!.spalten.map((s) => s.name);
    return (d.content.split('\r\n')[1] ?? '').split(';')[spalten.indexOf(spalte)] ?? '';
  };

  it('Brutto und Netto stehen jetzt drin', () => {
    expect(gv(mitUmsatz, 'Z_UMS_BRUTTO')).toBe('270,00000');
    expect(gv(mitUmsatz, 'Z_UMS_NETTO')).toBe('266,81000');
    expect(gv(mitUmsatz, 'Z_UST')).toBe('3,19000');
  });

  it('⛔ auch ein Abschluss OHNE `umsatzByTreatment` bekommt Brutto und Netto', () => {
    // 06.08.2026: hier stand, ein Abschluss ohne dieses Feld (vor Wanderung
    // 0127) lasse Z_UMS_BRUTTO leer, statt eine Zahl aus der Steuer
    // herzuleiten. Die Tiefenprüfung vom 05.08.2026 fand: `umsatzByTreatment`
    // ist genau wie `closing.vatByTreatment` daneben verkaufsrein und kannte
    // den Ankauf nicht. `businesscases.csv` braucht das Feld deshalb gar
    // nicht mehr, Brutto und Netto entstehen jetzt aus den BELEGZEILEN
    // selbst, derselben Quelle wie `transactions_vat.csv`. `eingabe` trägt
    // kein `umsatzByTreatment` und bekommt die Zahlen trotzdem, weil sie
    // längst aus dem Beleg dieser Vorlage kommen.
    expect(gv(eingabe, 'Z_UMS_BRUTTO')).toBe('270,00000');
    expect(gv(eingabe, 'Z_UMS_NETTO')).toBe('266,81000');
    expect(gv(eingabe, 'Z_UST')).toBe('3,19000');
  });
});

describe('⛔ die Tagessummen werden in ganzen CENT gerechnet', () => {
  it('drei Zahlarten mit krummen Beträgen gehen exakt auf', () => {
    // ⚠️ Der erste Entwurf rechnete `Number(b)` und `toFixed(2)`. In dieser
    // Arithmetik ist `0.1 + 0.2` nicht `0.3` — auf einem Datenträger, den ein
    // Prüfer gegen die Einzelaufzeichnung stellt, ist so ein Cent keine
    // Rundung, sondern eine Abweichung, die er erklärt haben will.
    //
    // ⚠️ 06.08.2026: die krummen Beträge standen hier in
    // `closing.paymentsByMethod`. Seit der Tiefenprüfung vom 05.08.2026 ist
    // diese Aufstellung nicht mehr die Quelle von `Z_SE_ZAHLUNGEN` und
    // `Z_SE_BARZAHLUNGEN`, sie ist verkaufsrein und kannte den Ankauf nicht.
    // Die Tagessumme kommt jetzt aus den ZAHLUNGSZEILEN DER BELEGE. Damit
    // dieser Test WEITER misst, was er messen soll, wandern die krummen
    // Beträge in die `payments` eines Belegs, statt den Erwartungswert
    // anzupassen.
    const krumm: DsfinvkBundleInput = {
      ...eingabe,
      receipts: [{
        ...eingabe.receipts[0]!,
        payments: [
          { paymentMethod: 'CASH', amountEur: '0.10' },
          { paymentMethod: 'ZVT_CARD', amountEur: '0.20' },
          { paymentMethod: 'BANK_TRANSFER', amountEur: '0.10' },
        ],
      }],
    };
    const dateien = baueAlleDateien(TAX, formeDaten(krumm, mensch()));
    const spalten = TAX.find((t) => t.datei === 'cashpointclosing.csv')!.spalten.map((s) => s.name);
    const zeile = (dateien.find((d) => d.name === 'cashpointclosing.csv')!.content.split('\r\n')[1] ?? '').split(';');
    expect(zeile[spalten.indexOf('Z_SE_ZAHLUNGEN')]).toBe('0,40');
    expect(zeile[spalten.indexOf('Z_SE_BARZAHLUNGEN')]).toBe('0,10');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VIER BEFUNDE AUS DEM MONATSLAUF, JEDER GEGEN DEN NORMTEXT GEPRÜFT
 * ═══════════════════════════════════════════════════════════════════════════
 */

const feldAus = (e: DsfinvkBundleInput, datei: string, spalte: string, zeile = 1): string => {
  const dateien = baueAlleDateien(TAX, formeDaten(e, mensch()));
  const d = dateien.find((x) => x.name === datei)!;
  const spalten = TAX.find((t) => t.datei === datei)!.spalten.map((s) => s.name);
  return (d.content.split('\r\n')[zeile] ?? '').split(';')[spalten.indexOf(spalte)] ?? '';
};

describe('⛔ § 25c Anlagegold trägt Schlüssel 6, nicht 5', () => {
  it('6 heisst „Umsatzsteuerfrei", 5 hiesse „Nicht Steuerbar"', () => {
    // Anlage 2 zur DSFinV-K (05.12.2024), wörtlich:
    //     5  0,00 %  Nicht Steuerbar
    //     6  0,00 %  Umsatzsteuerfrei
    // § 25c Abs. 1 UStG: die Lieferung von Anlagegold ist STEUERFREI.
    expect(ustSchluesselFuer('INVESTMENT_GOLD_25C')).toBe('6');
  });

  it('die beiden Regelsätze bleiben, wo sie waren', () => {
    expect(ustSchluesselFuer('STANDARD_19')).toBe('1');
    expect(ustSchluesselFuer('REDUCED_7')).toBe('2');
  });
});

describe('⛔ AGENTUR_ID trägt eine 0, kein leeres Feld', () => {
  it('in lines.csv', () => {
    // Norm, wörtlich: „Sofern der Geschäftsvorfall keiner Agentur zuzuordnen
    // ist, ist das Feld mit einer „0" zu befüllen."
    expect(feldAus(eingabe, 'lines.csv', 'AGENTUR_ID')).toBe('0');
  });
  it('in businesscases.csv', () => {
    expect(feldAus(eingabe, 'businesscases.csv', 'AGENTUR_ID')).toBe('0');
  });
});

describe('⛔ Inzahlungnahme und Anschreiben töten den Export nicht mehr', () => {
  it('TRADE_IN wird „Unbar" — alle Sachverhalte OHNE Bargeldbewegung', () => {
    expect(zahlartTypFuer('TRADE_IN')).toBe('Unbar');
  });
  it('DEBT wird „Keine" — Vorgänge, die mit KEINER Zahlung abschliessen', () => {
    expect(zahlartTypFuer('DEBT')).toBe('Keine');
  });
  it('alle elf Zahlarten der Produktion gehen durch, keine wirft', () => {
    const ausDerProduktion = [
      'CASH', 'ZVT_CARD', 'SUMUP', 'MOLLIE', 'STRIPE', 'EBAY',
      'BANK_TRANSFER', 'VOUCHER', 'TRADE_IN', 'DEBT', 'STRIPE_TERMINAL',
    ];
    for (const m of ausDerProduktion) {
      expect(() => zahlartTypFuer(m), m).not.toThrow();
    }
  });
  it('⛔ eine ERFUNDENE Zahlart wirft weiterhin', () => {
    expect(() => zahlartTypFuer('BITCOIN')).toThrow(/ZAHLART_TYP/);
  });
  it('der genaue Name steht daneben, wie Anhang D es verlangt', () => {
    const mitTrade: DsfinvkBundleInput = {
      ...eingabe,
      receipts: [{ ...VORLAGE_BELEG, payments: [{ paymentMethod: 'TRADE_IN', amountEur: '20.00' }] }],
    };
    expect(feldAus(mitTrade, 'datapayment.csv', 'ZAHLART_TYP')).toBe('Unbar');
    expect(feldAus(mitTrade, 'datapayment.csv', 'ZAHLART_NAME')).toBe('TRADE_IN');
  });
});

describe('⛔ itemamounts.csv erklärt den Preis, wenn ein Rabatt drauf war', () => {
  /** Eine Zeile über 100,00 EUR zu 19 %, auf die 10,00 EUR Rabatt gewährt wurden. */
  const mitRabatt: DsfinvkBundleInput = {
    ...eingabe,
    receipts: [
      {
        ...VORLAGE_BELEG,
        lines: [
          {
            lineNumber: 1,
            productName: 'Silberbarren 100 g',
            quantity: '1',
            appliedTaxTreatmentCode: 'STANDARD_19',
            appliedVatRate: '0.1900', // ⚠️ BRUCH, numeric(5,4) — nicht 19.00
            lineSubtotalEur: '84.03',
            lineVatEur: '15.97',
            lineTotalEur: '100.00',
            lineDiscountEur: '10.00',
            lineDiscountReason: 'Stammkunde',
          },
        ],
      },
    ],
  };

  const zeilen = (e: DsfinvkBundleInput): string[][] => {
    const d = baueAlleDateien(TAX, formeDaten(e, mensch())).find((x) => x.name === 'itemamounts.csv')!;
    return d.content.split('\r\n').slice(1).filter(Boolean).map((z) => z.split(';'));
  };
  const sp = (name: string): number =>
    TAX.find((t) => t.datei === 'itemamounts.csv')!.spalten.findIndex((s) => s.name === name);

  it('ZWEI Zeilen: der Grundpreis und der Abzug', () => {
    // Die Norm: „ZUSÄTZLICH IST DER GRUNDPREIS DER POSITION ANZUGEBEN."
    const z = zeilen(mitRabatt);
    expect(z).toHaveLength(2);
    expect(z[0]?.[sp('TYP')]).toBe('base_amount');
    expect(z[1]?.[sp('TYP')]).toBe('discount');
  });

  it('der Grundpreis ist der Preis VOR dem Nachlass', () => {
    const z = zeilen(mitRabatt);
    expect(z[0]?.[sp('PF_BRUTTO')]).toBe('110,00000');
    expect(z[0]?.[sp('PF_NETTO')]).toBe('92,43000');
    expect(z[0]?.[sp('PF_UST')]).toBe('17,57000');
  });

  it('der Abzug trägt NEGATIVES Vorzeichen, wie die Norm sagt', () => {
    const z = zeilen(mitRabatt);
    expect(z[1]?.[sp('PF_BRUTTO')]).toBe('-10,00000');
    expect(z[1]?.[sp('PF_NETTO')]).toBe('-8,40000');
    expect(z[1]?.[sp('PF_UST')]).toBe('-1,60000');
  });

  it('⛔ Grundpreis minus Abzug ergibt die Zeile — auf den CENT, in allen drei Feldern', () => {
    const z = zeilen(mitRabatt);
    const c = (s: string): number => Math.round(Number(s.replace(',', '.')) * 100);
    for (const f of ['PF_BRUTTO', 'PF_NETTO', 'PF_UST'] as const) {
      expect(c(z[0]?.[sp(f)] ?? '0') + c(z[1]?.[sp(f)] ?? '0'), f).toBe(
        c({ PF_BRUTTO: '100,00', PF_NETTO: '84,03', PF_UST: '15,97' }[f]),
      );
    }
  });

  it('bei einem steuerfreien Satz geht der ganze Abzug ins Netto', () => {
    const gold = JSON.parse(JSON.stringify(mitRabatt)) as DsfinvkBundleInput;
    (gold.receipts[0] as never as { lines: Record<string, string>[] }).lines[0]!['appliedTaxTreatmentCode'] =
      'INVESTMENT_GOLD_25C';
    (gold.receipts[0] as never as { lines: Record<string, string>[] }).lines[0]!['appliedVatRate'] = '0.0000';
    const z = zeilen(gold);
    expect(z[1]?.[sp('PF_NETTO')]).toBe('-10,00000');
    expect(z[1]?.[sp('PF_UST')]).toBe('0,00000');
  });

  it('OHNE Rabatt bleibt die Datei leer — eine Grundpreiszeile allein wäre Rauschen', () => {
    expect(zeilen(eingabe)).toHaveLength(0);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER RABATT BEI § 25a — an ECHTEN Zeilen der Produktion nachgerechnet
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Alle acht rabattierten Zeilen auf `warehouse14` sind § 25a, und alle acht
 * tragen `applied_vat_rate = NULL`. Der Satzweg hätte bei jeder einzelnen eine
 * Steuer von null ergeben. Diese Tabelle ist deshalb keine Erfindung, sondern
 * die Messung — Spalte für Spalte aus der Datenbank abgeschrieben.
 */
describe('⛔ § 25a: der Steueranteil eines Rabatts folgt der MARGE', () => {
  interface Fall {
    readonly was: string;
    readonly brutto: string;
    readonly rabatt: string;
    readonly ek: string;
    readonly ust: string;
    /** Erwarteter Steueranteil des Abzugs, aus der Margendifferenz. */
    readonly abzugUst: string;
  }

  // brutto/rabatt/ust stehen so auf der Produktion; ek = brutto − marge.
  const GEMESSEN: readonly Fall[] = [
    { was: 'Verlustverkauf — Marge 0,00, der Rabatt ändert an der Steuer NICHTS',
      brutto: '0.95',  rabatt: '0.05',  ek: '1.20',  ust: '0.00',  abzugUst: '0.00' },
    { was: 'kleine Marge, voll steuerpflichtig',
      brutto: '1.90',  rabatt: '0.10',  ek: '0.00',  ust: '0.30',  abzugUst: '0.02' },
    { was: 'Marge 18,75 bei 23,75 brutto',
      brutto: '23.75', rabatt: '1.25',  ek: '5.00',  ust: '2.99',  abzugUst: '0.20' },
    { was: 'Marge 80,00 bei 90,00 brutto',
      brutto: '90.00', rabatt: '10.00', ek: '10.00', ust: '12.77', abzugUst: '1.60' },
    { was: 'schmale Marge 2,56 auf 48,26 — hier weicht der Satzweg um einen Cent ab',
      brutto: '48.26', rabatt: '2.54',  ek: '45.70', ust: '0.41',  abzugUst: '0.40' },
  ];

  const bauen = (f: Fall): DsfinvkBundleInput => ({
    ...eingabe,
    receipts: [
      {
        ...VORLAGE_BELEG,
        lines: [
          {
            lineNumber: 1,
            productName: 'Ankaufsware',
            quantity: '1',
            appliedTaxTreatmentCode: 'MARGIN_25A',
            appliedVatRate: null,
            lineSubtotalEur: ausCentProbe(zuCentProbe(f.brutto) - zuCentProbe(f.ust)),
            lineVatEur: f.ust,
            lineTotalEur: f.brutto,
            lineDiscountEur: f.rabatt,
            lineDiscountReason: 'Stammkunde',
            acquisitionCostEurSnapshot: f.ek,
          },
        ],
      },
    ],
  });

  for (const f of GEMESSEN) {
    it(f.was, () => {
      const d = baueAlleDateien(TAX, formeDaten(bauen(f), mensch())).find(
        (x) => x.name === 'itemamounts.csv',
      )!;
      const spalten = TAX.find((t) => t.datei === 'itemamounts.csv')!.spalten.map((s) => s.name);
      const z = d.content.split('\r\n').slice(1).filter(Boolean).map((r) => r.split(';'));
      expect(z, 'Grundpreis und Abzug').toHaveLength(2);
      const ustSp = spalten.indexOf('PF_UST');
      // Bei null trägt die Zahl KEIN Minus — es gibt kein negatives Nichts.
      const sollUst = f.abzugUst === '0.00' ? '0,00000' : `-${f.abzugUst.replace('.', ',')}000`;
      expect(z[1]?.[ustSp]).toBe(sollUst);

      // Und die Schliessung: Grundpreis minus Abzug ist die Zeile.
      const c = (s: string): number => Math.round(Number(s.replace(',', '.')) * 100);
      for (const [name, soll] of [['PF_BRUTTO', f.brutto], ['PF_UST', f.ust]] as const) {
        const i = spalten.indexOf(name);
        expect(c(z[0]?.[i] ?? '0') + c(z[1]?.[i] ?? '0'), name).toBe(Math.round(Number(soll) * 100));
      }
    });
  }

  it('⛔ ohne Einkaufspreis wird NICHTS erfunden — der Abzug bleibt steuerfrei', () => {
    const ohneEk = bauen(GEMESSEN[2] as Fall);
    (ohneEk.receipts[0] as never as { lines: Record<string, unknown>[] }).lines[0]!['acquisitionCostEurSnapshot'] = null;
    const d = baueAlleDateien(TAX, formeDaten(ohneEk, mensch())).find((x) => x.name === 'itemamounts.csv')!;
    const spalten = TAX.find((t) => t.datei === 'itemamounts.csv')!.spalten.map((s) => s.name);
    const z = d.content.split('\r\n')[2]?.split(';') ?? [];
    expect(z[spalten.indexOf('PF_UST')]).toBe('0,00000');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  JEDER SCHLÜSSEL, DER IRGENDWO STEHT, MUSS SICH IN vat.csv AUFLÖSEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ Der Fund, der diesen Wächter erzwungen hat: nach der Berichtigung des
 * Anlagegold-Schlüssels auf 6 stand in `businesscases.csv` ein
 * `UST_SCHLUESSEL=6` — und in `vat.csv`, der Datei, mit der ein Prüfer
 * Schlüssel AUFLÖST, gab es keine 6. Dafür eine 5, die kein Vorgang je
 * benutzt hatte. Die Liste war fest verdrahtet.
 *
 * Dieser Wächter prüft nicht die Zahl 6. Er prüft die EIGENSCHAFT: kein
 * Verweis ohne Ziel. Damit fängt er auch den nächsten Schlüssel, den noch
 * niemand kennt.
 */
describe('⛔ kein toter Verweis in die Steuerstammdaten', () => {
  /** Alle Schlüssel, die in einem Paket vorkommen, je Datei. */
  const gesammelt = (e: DsfinvkBundleInput): { verwendet: Set<string>; erklaert: Set<string> } => {
    const dateien = baueAlleDateien(TAX, formeDaten(e, mensch()));
    const verwendet = new Set<string>();
    const erklaert = new Set<string>();
    for (const t of TAX) {
      const i = t.spalten.findIndex((s) => s.name === 'UST_SCHLUESSEL');
      if (i === -1) continue;
      const d = dateien.find((x) => x.name === t.datei);
      if (!d) continue;
      for (const zeile of d.content.split('\r\n').slice(1).filter(Boolean)) {
        const w = zeile.split(';')[i]?.trim();
        if (!w) continue;
        (t.datei === 'vat.csv' ? erklaert : verwendet).add(w);
      }
    }
    return { verwendet, erklaert };
  };

  const goldUndMarge: DsfinvkBundleInput = {
    ...eingabe,
    receipts: [
      {
        ...VORLAGE_BELEG,
        lines: [
          { lineNumber: 1, productName: 'Anlagegold', quantity: '1',
            appliedTaxTreatmentCode: 'INVESTMENT_GOLD_25C', appliedVatRate: null,
            lineSubtotalEur: '650.00', lineVatEur: '0.00', lineTotalEur: '650.00' },
          { lineNumber: 2, productName: 'Ankaufsware', quantity: '1',
            appliedTaxTreatmentCode: 'MARGIN_25A', appliedVatRate: null,
            lineSubtotalEur: '47.85', lineVatEur: '0.41', lineTotalEur: '48.26' },
        ],
        payments: [{ paymentMethod: 'CASH', amountEur: '698.26' }],
      },
    ],
  };

  it('jeder benutzte Schlüssel steht in vat.csv', () => {
    const { verwendet, erklaert } = gesammelt(goldUndMarge);
    const tot = [...verwendet].filter((s) => !erklaert.has(s));
    expect(tot, `Schlüssel ohne Stammsatz: ${tot.join(', ')}`).toEqual([]);
  });

  it('und Anlagegold steht dort als 6, nicht als 5', () => {
    const { verwendet, erklaert } = gesammelt(goldUndMarge);
    expect(verwendet.has('6'), 'Anlagegold nutzt Schlüssel 6').toBe(true);
    expect(erklaert.has('6'), 'und vat.csv erklärt ihn').toBe(true);
    expect(erklaert.has('5'), 'die 5 steht nicht mehr da, sie wurde nie benutzt').toBe(false);
  });

  it('⛔ und kein Stammsatz OHNE Verwendung — eine Liste, die alles nennt, sagt nichts', () => {
    const { verwendet, erklaert } = gesammelt(goldUndMarge);
    const ueberzaehlig = [...erklaert].filter((s) => !verwendet.has(s));
    expect(ueberzaehlig, `ohne einen einzigen Vorgang: ${ueberzaehlig.join(', ')}`).toEqual([]);
  });

  it('⛔ jeder Schlüssel, der in einem Beleg steht, landet auch in businesscases.csv', () => {
    // 06.08.2026: hier stand die umgekehrte Probe. Sie zielte auf einen
    // dritten Sammler, der `businesscases.csv` damals aus den Tagessummen
    // des Abschlusses (`closing.vatByTreatment` / `umsatzByTreatment`) baute,
    // einer Aufstellung, die von den Belegen ABWEICHEN konnte. Geprüft
    // wurde, dass ein Schlüssel, der NUR dort steht und in keinem Beleg,
    // trotzdem in vat.csv erklärt wird.
    //
    // Diese Richtung ist mit echten Daten nicht mehr erreichbar, aus zwei
    // gemessenen Gründen. Erstens hat die Belegabfrage in
    // `closing-export.ts` KEINE Begrenzung und KEINEN Richtungsfilter
    // (`WHERE berlin_business_day(finalized_at) = businessDay`), sie
    // umfasst immer den ganzen Tag. Zweitens, und seitdem entscheidend,
    // baut `businesscases.csv` sich seit der Tiefenprüfung vom 05.08.2026
    // nicht mehr aus jener separaten Aufstellung, sondern aus `gvSummen`,
    // das WÄHREND der Belegschleife aus denselben Positionen gefüllt wird
    // wie `transactions_vat.csv`. Ein Schlüssel kann dort also gar nicht
    // mehr stehen, ohne auch in einem Beleg zu stehen.
    //
    // Die Absicht bleibt dieselbe, kein toter Verweis in die
    // Steuerstammdaten, nur die Richtung dreht sich um: jetzt wird geprüft,
    // dass jeder in einem Beleg BENUTZTE Schlüssel auch in businesscases.csv
    // landet, nicht nur in vat.csv.
    const dateien = baueAlleDateien(TAX, formeDaten(goldUndMarge, mensch()));
    const spaltenGv = TAX.find((t) => t.datei === 'businesscases.csv')!.spalten.map((s) => s.name);
    const schluesselInGv = new Set(
      dateien
        .find((d) => d.name === 'businesscases.csv')!
        .content.split('\r\n')
        .slice(1)
        .filter(Boolean)
        .map((z) => z.split(';')[spaltenGv.indexOf('UST_SCHLUESSEL')]),
    );
    expect(schluesselInGv.has('6'), 'Anlagegold steht in businesscases.csv').toBe(true);
    expect(schluesselInGv.has('1001'), 'der Beraterschlüssel steht in businesscases.csv').toBe(true);

    const { verwendet, erklaert } = gesammelt(goldUndMarge);
    const tot = [...verwendet].filter((x) => !erklaert.has(x));
    expect(tot, `Schlüssel ohne Stammsatz: ${tot.join(', ')}`).toEqual([]);
  });

  it('die Beschreibung kommt aus Anlage 2, nicht aus dem Bauchgefühl', () => {
    const d = baueAlleDateien(TAX, formeDaten(goldUndMarge, mensch())).find((x) => x.name === 'vat.csv')!;
    const spalten = TAX.find((t) => t.datei === 'vat.csv')!.spalten.map((s) => s.name);
    const zeile = d.content.split('\r\n').slice(1).filter(Boolean)
      .map((z) => z.split(';'))
      .find((z) => z[spalten.indexOf('UST_SCHLUESSEL')] === '6');
    expect(zeile?.[spalten.indexOf('UST_BESCHR')]).toBe('Umsatzsteuerfrei');
    expect(zeile?.[spalten.indexOf('UST_SATZ')]).toBe('0,00');
  });
});

describe('⛔ Der Storno eines Ankaufs gleicht aus, statt zu verdoppeln (19.08.2026)', () => {
  /*
   * ── DER FUND DER BOESWILLIGEN PRUEFUNG ──────────────────────────────────
   *
   * Ein Barankauf ueber 500,00 EUR wird storniert. Der Stornobeleg traegt
   * seine Betraege bereits GESPIEGELT (transactions-storno kehrt sie um, ein
   * CHECK erzwingt es): die Zahlungszeile steht auf −500,00.
   *
   * Die alte Hilfsfunktion `negativ()` machte eine Zahl negativ — war sie es
   * schon, liess sie sie stehen. Der Storno, der den Geldabfluss AUSGLEICHEN
   * soll, verdoppelte ihn damit im Datentraeger. Gleichzeitig rechneten die
   * Tagesvorfaelle mit einer ECHTEN Umkehr (vz = -1n): derselbe Beleg trug in
   * zwei Dateien desselben Pakets zwei Wahrheiten.
   */
  const stornoAnkauf = (): DsfinvkBundleInput => ({
    ...eingabe,
    closing: {
      ...eingabe.closing,
      grossVerkaufEur: '0.00',
      netVerkaufEur: '0.00',
      grossAnkaufEur: '0.00',
      netAnkaufEur: '0.00',
      vatByTreatment: {},
      paymentsByMethod: { CASH: '0.00' },
    },
    receipts: [
      {
        ...VORLAGE_BELEG,
        transactionId: 'aaaaaaaa-0000-0000-0000-0000000000ff',
        receiptLocator: 'RCP-2026-000050',
        direction: 'ANKAUF',
        isStorno: true,
        // Gespiegelt, genau wie der lebende Stornoweg es schreibt.
        subtotalEur: '-500.00',
        vatEur: '0.00',
        totalEur: '-500.00',
        lines: [
          {
            lineNumber: 1,
            productName: 'Altgold 585',
            quantity: '1',
            appliedTaxTreatmentCode: 'MARGIN_25A',
            appliedVatRate: null,
            lineSubtotalEur: '-500.00',
            lineVatEur: '0.00',
            lineTotalEur: '-500.00',
          },
        ],
        payments: [{ paymentMethod: 'CASH', amountEur: '-500.00' }],
      },
    ],
  });

  const feldVon = (
    quelle: DsfinvkBundleInput,
    datei: string,
    spalte: string,
    zeile = 1,
  ): string => {
    const dateien = baueAlleDateien(TAX, formeDaten(quelle, mensch()));
    const d = dateien.find((x) => x.name === datei)!;
    const spalten = TAX.find((x) => x.datei === datei)!.spalten.map((s) => s.name);
    return (d.content.split('\r\n')[zeile] ?? '').split(';')[spalten.indexOf(spalte)] ?? '';
  };

  it('⛔ die Zahlungszeile des Stornos gibt das Geld ZURUECK (+500), nicht noch einmal aus', () => {
    const betrag = feldVon(stornoAnkauf(), 'datapayment.csv', 'ZAHLWAEH_BETRAG');
    // Der Datentraeger schreibt das deutsche Dezimalkomma.
    expect(betrag, 'der Storno verdoppelt den Barabfluss').toBe('500,00');
  });

  it('⛔ Kopfzeile und Tagesvorfall widersprechen sich NICHT mehr', () => {
    const quelle = stornoAnkauf();
    const kopf = feldVon(quelle, 'transactions.csv', 'UMS_BRUTTO');
    const vorfall = feldVon(quelle, 'businesscases.csv', 'Z_UMS_BRUTTO');
    // Beide Wege benutzen jetzt dieselbe Regel: das Vorzeichen wird gedreht.
    // Die Norm fuehrt die Tagesvorfaelle mit fuenf Nachkommastellen; der Kopf
    // mit zweien. Verglichen wird der WERT, nicht die Schreibweise.
    expect(kopf).toBe('500,00');
    expect(Number(vorfall.replace(',', '.'))).toBe(500);
  });
});
