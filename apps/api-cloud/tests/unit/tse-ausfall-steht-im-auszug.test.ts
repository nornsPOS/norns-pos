/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein Beleg ohne Signatur muss im Auszug STEHEN, nicht fehlen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 *     dsfinvk-daten.ts:624   if (r.tse) { … }
 *     dsfinvk-daten.ts:641   tseTaFehler: null      ← die EINZIGE Schreibstelle
 *
 * Fiel die TSE aus, verschwanden die betroffenen Belege lautlos aus
 * `transactions_tse.csv`. Der Auszug sah dann aus wie ein Tag, an dem jeder
 * Beleg sauber signiert wurde.
 *
 * Das ist die gefährlichste Form eines Fehlers in einem Steuerauszug: nicht
 * falsch, sondern **still**. Ein Prüfer kann eine falsche Zahl finden. Eine
 * Zeile, die es nicht gibt, kann er nicht finden.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { formeDaten, type MenschlicheAngaben } from '../../src/lib/dsfinvk-daten.js';
import { baueAlleDateien } from '../../src/lib/dsfinvk-dateien.js';
import type { DsfinvkBundleInput, DsfinvkReceiptInput } from '../../src/lib/dsfinvk-export.js';
import { leseTaxonomie } from '../../src/lib/dsfinvk-taxonomie.js';
import { leseStammdaten } from '../../src/lib/haendler-stammdaten.js';
import {
  TSE_AUSFALL_MAXLAENGE,
  TSE_AUSFALL_VERMERK,
  ausfallVermerk,
} from '../../src/lib/tse-ausfall.js';

const TAX = leseTaxonomie(
  readFileSync(new URL('../../src/fiskal/dsfinvk-2.4/index.xml', import.meta.url), 'utf8'),
);

const mensch = (): MenschlicheAngaben => ({
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
});

const SIGNIERT: DsfinvkReceiptInput = {
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
  },
};

/** Derselbe Beleg, nur war die Sicherungseinrichtung weg. */
const OHNE_SIGNATUR: DsfinvkReceiptInput = {
  ...SIGNIERT,
  transactionId: 'aaaaaaaa-0000-0000-0000-000000000002',
  receiptLocator: 'RCP-2026-000050',
  tse: null,
};

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

/** Die Zeilen von `transactions_tse.csv` als Spaltenlisten, ohne Kopfzeile. */
function tseZeilen(receipts: DsfinvkReceiptInput[]): string[][] {
  const dateien = baueAlleDateien(TAX, formeDaten(bundle(receipts), mensch()));
  const datei = dateien.find((d) => d.name === 'transactions_tse.csv');
  if (!datei) throw new Error('transactions_tse.csv fehlt im Paket');
  return datei.content
    .split('\r\n')
    .slice(1)
    .filter((z) => z.trim().length > 0)
    .map((z) => z.split(';').map((f) => f.replace(/^"|"$/g, '')));
}

const spalte = (name: string): number => {
  const tabelle = TAX.find((t) => t.datei === 'transactions_tse.csv');
  if (!tabelle) throw new Error('transactions_tse.csv fehlt in der Taxonomie');
  const i = tabelle.spalten.findIndex((s) => s.name === name);
  if (i < 0) throw new Error(`Spalte ${name} fehlt`);
  return i;
};

describe('⛔ Der unsignierte Beleg verschwand aus dem Auszug', () => {
  it('ein signierter Beleg bekommt seine Zeile — das war nie das Problem', () => {
    expect(tseZeilen([SIGNIERT])).toHaveLength(1);
  });

  it('⛔ und ein Beleg OHNE Signatur bekommt sie auch', () => {
    /**
     * Der Kern. Vorher: null Zeilen, und der Auszug behauptete damit, den
     * Vorgang habe es nicht gegeben.
     */
    expect(tseZeilen([OHNE_SIGNATUR])).toHaveLength(1);
  });

  it('⛔ zwei Belege, einer ohne Signatur: BEIDE stehen drin', () => {
    const zeilen = tseZeilen([SIGNIERT, OHNE_SIGNATUR]);
    expect(zeilen).toHaveLength(2);
    const bonIds = zeilen.map((z) => z[spalte('BON_ID')]);
    expect(bonIds).toContain('RCP-2026-000049');
    expect(bonIds).toContain('RCP-2026-000050');
  });
});

describe('Die Zeile sagt die Wahrheit über den Ausfall', () => {
  it('⛔ TSE_TA_FEHLER trägt den Vermerk', () => {
    const [zeile] = tseZeilen([OHNE_SIGNATUR]);
    expect(zeile?.[spalte('TSE_TA_FEHLER')]).toBe(TSE_AUSFALL_VERMERK);
  });

  it('⚠️ und ein SIGNIERTER Beleg trägt ihn nicht', () => {
    /**
     * Ein Vermerk auf jeder Zeile wäre kein Vermerk mehr, sondern Rauschen,
     * und der echte Ausfall wäre darin unsichtbar. Dieselbe Wirkung wie eine
     * Lampe, die dauerhaft leuchtet.
     */
    const [zeile] = tseZeilen([SIGNIERT]);
    expect(zeile?.[spalte('TSE_TA_FEHLER')]).toBe('');
  });

  it('⚠️ die Signaturfelder bleiben LEER statt erfunden', () => {
    /**
     * Ein Signaturzähler oder eine Transaktionsnummer, die nie vergeben
     * wurde, wäre eine falsche Angabe in einem Steuerauszug. Klasse
     * „fabricate-when-unconfigured": lieber ein leeres Feld als eine Zahl,
     * die niemand vergeben hat.
     */
    const [zeile] = tseZeilen([OHNE_SIGNATUR]);
    for (const feld of ['TSE_ID', 'TSE_TANR', 'TSE_TA_SIGZ', 'TSE_TA_SIG', 'TSE_TA_START']) {
      expect(zeile?.[spalte(feld)], feld).toBe('');
    }
  });

  it('⚠️ der unsignierte Beleg zieht KEINE TSE in die Gerätestammdaten', () => {
    /**
     * `tse.csv` listet die eingesetzten Sicherungseinrichtungen. Ein Beleg
     * ohne Signatur hat keine benutzt; ihn dort mitzuzählen hiesse, ein Gerät
     * als beteiligt zu melden, das nie angesprochen wurde.
     */
    const dateien = baueAlleDateien(TAX, formeDaten(bundle([OHNE_SIGNATUR]), mensch()));
    const tseStamm = dateien.find((d) => d.name === 'tse.csv');
    const zeilen = (tseStamm?.content ?? '')
      .split('\r\n')
      .slice(1)
      .filter((z) => z.trim().length > 0);
    expect(zeilen).toHaveLength(0);
  });
});

describe('Der Wortlaut hält die amtliche Grenze ein', () => {
  it('⚠️ er passt in die 200 Zeichen aus der index.xml', () => {
    /**
     * Die Grenze steht nicht hier, sie steht in der mitgelieferten amtlichen
     * Beschreibung. Wer den Satz eines Tages verlängert, erfährt es hier und
     * nicht erst beim Prüfer.
     */
    expect([...TSE_AUSFALL_VERMERK].length).toBeLessThanOrEqual(TSE_AUSFALL_MAXLAENGE);
    const feld = TAX.find((t) => t.datei === 'transactions_tse.csv')?.spalten.find(
      (s) => s.name === 'TSE_TA_FEHLER',
    );
    expect(feld?.laenge).toBe(TSE_AUSFALL_MAXLAENGE);
  });

  it('ein zu langer Satz wird an der Wortgrenze gekürzt', () => {
    const lang = `${'Wort '.repeat(80)}Ende`;
    const gekuerzt = ausfallVermerk(lang);
    expect([...gekuerzt].length).toBeLessThanOrEqual(TSE_AUSFALL_MAXLAENGE);
    expect(gekuerzt.endsWith('Wort')).toBe(true);
  });

  it('⚠️ gekürzt wird in ZEICHEN, nicht in UTF-16-Einheiten', () => {
    /**
     * `'𝄞'.length` ist 2, `[...'𝄞'].length` ist 1. Wer in Einheiten zählt,
     * zerschneidet das Zeichen und die Datei trägt ein halbes. Dieselbe
     * Klasse, die bei DATEV die Windows-1252-Prüfung stellte.
     */
    const gekuerzt = ausfallVermerk('𝄞'.repeat(300));
    expect([...gekuerzt].length).toBe(TSE_AUSFALL_MAXLAENGE);
  });

  it('der Vermerk nennt nur Gemessenes, keine Ursache und keine Schuld', () => {
    /**
     * Was in diesem Feld steht, ist eine Erklärung an die Finanzverwaltung.
     * Sie darf beschreiben, was war, und nicht behaupten, warum.
     *
     * ⚠️ 14.08.2026: Hier stand `toMatch(/Nachholung ausstehend/)` — der
     * Wächter PINNTE damit selbst eine Zusage über die Zukunft, die kein
     * Code einlöst (der Motor signiert nicht rückwirkend; nachgereicht wird
     * nur, was die TSE bereits angenommen hat). Ein Vermerk, der Gemessenes
     * nennt, darf keine Nachholung versprechen. Seither verlangt der Wächter
     * das Gegenteil.
     */
    expect(TSE_AUSFALL_VERMERK).toMatch(/nicht erreichbar/);
    expect(TSE_AUSFALL_VERMERK).not.toMatch(/Nachholung/);
    expect(TSE_AUSFALL_VERMERK).toMatch(/vermerkt/);
    expect(TSE_AUSFALL_VERMERK).not.toMatch(/Störung|Defekt|Fehler des|verschuldet|Ausnahme/i);
  });
});
