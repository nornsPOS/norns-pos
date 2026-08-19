/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  NEUN ERFUNDENE DATEINAMEN LIEFEN JAHRELANG GRÜN DURCH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `dsfinvk-export.test.ts` schreibt die erwarteten Dateinamen als Zeichenketten
 * in den Test selbst — `'bon_kopf.csv'`, `'bon_pos_preise.csv'` und so weiter —
 * und vergleicht die Kopfzeilen mit `toContain` gegen dieselben Bezeichner,
 * die der Erzeuger schreibt.
 *
 * **Links und rechts steht dasselbe Wort, und beide stammen aus derselben
 * Feder.** 392 Zeilen Test, und keine einzige fragt eine FREMDE Stelle, ob es
 * `bon_kopf.csv` überhaupt gibt.
 *
 * Der Test prüft echte Dinge — Vorzeichen, Rundung, ZIP-Struktur. Bei DIESEM
 * Fehler ist er blind, und blind bleibt er, solange die Erwartung aus derselben
 * Feder stammt wie der Erzeuger.
 *
 * ── Woher die Erwartung jetzt kommt ──────────────────────────────────────
 *
 * Aus dem amtlichen Prüfstück: `tes../../src/fiskal/dsfinvk-2.4/index.xml`,
 * unverändert aus dem BZSt-Paket, mit Prüfsumme. Es beschreibt alle 20
 * Tabellen maschinenlesbar — Dateiname, IDEA-Name, Spalten, Reihenfolge, Typ
 * und Länge.
 *
 * **Diese Datei nennt keinen einzigen Dateinamen und keinen Feldnamen selbst.**
 * Was sie erwartet, liest sie aus dem Prüfstück.
 *
 * Rechtsgrundlage: § 146a AO in Verbindung mit der KassenSichV; DSFinV-K 2.4,
 * bekanntgegeben mit BMF-Schreiben vom 12.01.2024, IV D 2 – S 0316-a/19/10007:004.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { formeDaten } from '../../src/lib/dsfinvk-daten.js';
import { baueAlleDateien } from '../../src/lib/dsfinvk-dateien.js';
import type { DsfinvkBundleInput } from '../../src/lib/dsfinvk-export.js';
import { kopfzeile, leseTaxonomie } from '../../src/lib/dsfinvk-taxonomie.js';
import { leseStammdaten } from '../../src/lib/haendler-stammdaten.js';

const pruefstueck = (name: string): string =>
  readFileSync(new URL(`../../src/fiskal/dsfinvk-2.4/${name}`, import.meta.url), 'utf8');

const INDEX_XML = pruefstueck('index.xml');
const TAXONOMIE = leseTaxonomie(INDEX_XML);

/**
 * ⚠️ ZUERST: ist das Prüfstück noch das amtliche?
 *
 * Ein „angepasstes" Prüfstück misst nichts mehr. Wer die Datei anfasst, um
 * einen Test grün zu bekommen, hat den Sinn der ganzen Übung zerstört —
 * deshalb steht die Prüfsumme hier und nicht in einer Anleitung.
 */
describe('⛔ das Prüfstück ist unverändert amtlich', () => {
  const summe = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

  it('index.xml trägt die Prüfsumme aus dem BZSt-Paket', () => {
    expect(summe(INDEX_XML)).toBe(
      'd0b1fed31a50dc6370d7a54528034a1e0ac2f982f82e3c0a9250a15c64c85160',
    );
  });

  it('und die DTD ebenso', () => {
    expect(summe(pruefstueck('gdpdu-01-09-2004.dtd'))).toBe(
      'af3d4c5a19e991f2d8c53995bc708680bbd7ff9326fde539c55b7e2c63f848a2',
    );
  });
});

describe('der Leser holt die Norm wirklich heraus', () => {
  it('zwanzig Tabellen, wie die Norm sie kennt', () => {
    expect(TAXONOMIE).toHaveLength(20);
  });

  it('jede trägt einen Dateinamen, einen IDEA-Namen und Spalten', () => {
    for (const t of TAXONOMIE) {
      expect(t.datei, 'Tabelle ohne Dateiname').toMatch(/\.csv$/);
      expect(t.ideaName.length, `${t.datei} ohne IDEA-Namen`).toBeGreaterThan(0);
      expect(t.spalten.length, `${t.datei} ohne Spalten`).toBeGreaterThan(0);
    }
  });

  it('zusammen 219 Spalten', () => {
    // Die Zahl steht nicht im Erzeuger, sie fällt aus dem Prüfstück. Sie hier
    // festzunageln fängt einen Leser, der still Spalten verschluckt.
    //
    // ⚠️ Der Rechercheteil dieses Hauses nannte 438. Das ist die DOPPELTE
    // Zahl — nachgezählt sowohl mit diesem Leser als auch unabhängig mit
    // einem zweiten Werkzeug: es sind 219. Die Zahlen JE TABELLE des Berichts
    // stimmen dagegen (transactions.csv 23, lines.csv 21); nur die Summe war
    // doppelt gezählt. Ein Bericht ist eine Quelle, kein Beweis.
    const n = TAXONOMIE.reduce((s, t) => s + t.spalten.length, 0);
    expect(n).toBe(219);
  });

  it('und die Grösse der grossen Tabellen stimmt mit der Norm', () => {
    // Gegenprobe zu der falschen Summe oben: die Einzelzahlen sind belegt.
    const je = (d: string) => TAXONOMIE.find((t) => t.datei === d)?.spalten.length;
    expect(je('transactions.csv')).toBe(23);
    expect(je('lines.csv')).toBe(21);
    expect(je('subitems.csv')).toBe(17);
    expect(je('cashpointclosing.csv')).toBe(16);
  });

  it('⚠️ und das Dezimalzeichen ist das KOMMA', () => {
    // Der Erzeuger schreibt heute Punkte. Die amtliche index.xml beschreibt
    // damit unsere eigenen Zahlen falsch — jeden Betrag im ganzen Paket.
    for (const t of TAXONOMIE) {
      expect(t.format.dezimalzeichen, `${t.datei}`).toBe(',');
    }
  });

  it('der Schlüssel ist DREITEILIG in jeder Tabelle', () => {
    // Z_KASSE_ID, Z_ERSTELLUNG, Z_NR. Heute fehlt der mittlere überall
    // ausser in einer Datei.
    for (const t of TAXONOMIE) {
      const ersteDrei = t.spalten.slice(0, 3).map((s) => s.name);
      expect(ersteDrei, `${t.datei}`).toEqual(['Z_KASSE_ID', 'Z_ERSTELLUNG', 'Z_NR']);
    }
  });
});

// ── Was der Erzeuger heute liefert ────────────────────────────────────────

const eingabe: DsfinvkBundleInput = {
  businessDay: '2026-06-08',
  closing: {
    zNr: '42',
    finalizedAt: '2026-06-08T20:00:00.000Z',
    grossVerkaufEur: '1000.00',
    grossAnkaufEur: '0.00',
    netVerkaufEur: '840.34',
    netAnkaufEur: '0.00',
    vatByTreatment: { STANDARD_19: '159.66' },
    paymentsByMethod: { CASH: '1000.00' },
    cashCountedEur: '1000.00',
  },
  cashRegister: { id: 'KASSE-1', serialNumber: 'SN-1', brand: 'Norns', model: 'Tresen' },
  receipts: [],
};

// ⚠️ Gemessen wird der Weg, den die ROUTE geht — nicht der alte Erzeuger.
// Sonst prüfte diese Datei etwas, das Roman nie zu sehen bekommt.
const erzeugt = baueAlleDateien(
  TAXONOMIE,
  formeDaten(eingabe, {
    // Die Entscheidung des Steuerberaters zum Ankauf von Privat. Sie steht hier
    // ausdruecklich, weil ein Ankaufstag sonst gar nicht exportierbar ist — und
    // genau das soll in den Pruefungen sichtbar sein.
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
    eigeneUstSchluessel: { MARGIN_25A: '1001', REVERSE_CHARGE_13B: '1002' },
    kassenSeriennummer: 'KS-0001',
    taxonomieVersion: '2.4',
    softwareVersion: '1.0.0',
  }),
);
const amtlicheNamen = new Set(TAXONOMIE.map((t) => t.datei));

describe('⛔ DER BEFUND, gegen das amtliche Prüfstück gemessen', () => {
  it('welche erzeugten Namen kennt die Taxonomie NICHT', () => {
    const fremd = erzeugt
      .map((d) => d.name.split('/').pop() ?? d.name)
      .filter((n) => n.endsWith('.csv'))
      .filter((n) => !amtlicheNamen.has(n));
    // ⚠️ Dieser Wert ist der Befund, nicht das Ziel. Er MUSS auf 0 fallen,
    // während die Dateien umgebaut werden. Solange er über 0 steht, ist das
    // Paket für ein Prüfwerkzeug nicht auswertbar: es sucht nach Namen.
    expect(fremd, `nicht-amtliche Dateinamen: ${fremd.join(', ')}`).toEqual([]);
  });

  it('welche amtlichen Dateien FEHLEN', () => {
    const da = new Set(erzeugt.map((d) => d.name.split('/').pop() ?? d.name));
    const fehlend = [...amtlicheNamen].filter((n) => !da.has(n));
    expect(fehlend, `fehlende amtliche Dateien: ${fehlend.join(', ')}`).toEqual([]);
  });
});

describe('⛔ und jede Kopfzeile Feld für Feld', () => {
  for (const t of TAXONOMIE) {
    it(`${t.datei} trägt die amtlichen Spalten in amtlicher Reihenfolge`, () => {
      const datei = erzeugt.find((d) => (d.name.split('/').pop() ?? d.name) === t.datei);
      expect(datei, `${t.datei} wird gar nicht erzeugt`).toBeDefined();
      const ist = (datei!.content.split('\r\n')[0] ?? '').replace(/^﻿/, '');
      expect(ist, `${t.datei}: Kopfzeile weicht ab`).toBe(kopfzeile(t));
    });
  }
});
