/**
 * Die zwanzig Dateien entstehen aus der Norm.
 *
 * Diese Prüfung hält den neuen Erzeuger gegen dieselbe amtliche `index.xml`,
 * die auch das Prüfwerkzeug liest. Sie nennt keinen Dateinamen und keinen
 * Feldnamen selbst.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { baueAlleDateien, type Daten } from '../../src/lib/dsfinvk-dateien.js';
import { kopfzeile, leseTaxonomie } from '../../src/lib/dsfinvk-taxonomie.js';

const TAX = leseTaxonomie(
  readFileSync(new URL('../../src/fiskal/dsfinvk-2.4/index.xml', import.meta.url), 'utf8'),
);

const leer: Daten = {
  kopf: { kasseId: 'KASSE-1', erstellung: '2026-06-08T20:00:00Z', zNr: '42' },
  abschluss: {
    buchungstag: '2026-06-08', taxonomieVersion: undefined,
    startId: undefined, endeId: undefined,
    name: undefined, strasse: undefined, plz: undefined, ort: undefined,
    land: undefined, stnr: undefined, ustId: undefined,
    summeZahlungen: '1000.00', summeBarzahlungen: '1000.00',
  },
  belege: [], positionen: [], positionsUst: [], belegUst: [], referenzen: [],
  preisfindung: [],
  zahlungen: [], tse: [], geschaeftsvorfaelle: [], zahlartSummen: [],
  kassenlade: [],
  kasse: { brand: 'Norns', modell: 'Tresen', seriennummer: undefined,
           swBrand: 'warehouse14', swVersion: '1.0', basiswaehrung: 'EUR',
           umrechnung: undefined },
  ort: { name: undefined, strasse: undefined, plz: undefined, ort: undefined,
         land: undefined, stnr: undefined, ustId: undefined },
  ustSchluessel: [], tseStamm: [],
};

const dateien = baueAlleDateien(TAX, leer);

describe('⛔ ALLE zwanzig, mit amtlichem Namen', () => {
  it('zwanzig Dateien', () => {
    expect(dateien).toHaveLength(20);
  });

  it('jeder Name steht so in der Norm', () => {
    const amtlich = new Set(TAX.map((t) => t.datei));
    for (const d of dateien) expect(amtlich.has(d.name), d.name).toBe(true);
  });

  it('und keine amtliche fehlt', () => {
    const da = new Set(dateien.map((d) => d.name));
    const fehlend = TAX.map((t) => t.datei).filter((n) => !da.has(n));
    expect(fehlend, `fehlend: ${fehlend.join(', ')}`).toEqual([]);
  });
});

describe('⛔ und jede Kopfzeile Feld für Feld', () => {
  for (const t of TAX) {
    it(`${t.datei}`, () => {
      const d = dateien.find((x) => x.name === t.datei);
      expect(d, `${t.datei} fehlt`).toBeDefined();
      expect(d!.content.split('\r\n')[0]).toBe(kopfzeile(t));
    });
  }
});

describe('was ohne Daten herauskommt', () => {
  it('eine Kopfzeile und sonst nichts — kein erfundener Inhalt', () => {
    const leerDatei = dateien.find((d) => d.name === 'lines.csv')!;
    expect(leerDatei.content.split('\r\n').filter((z) => z !== '')).toHaveLength(1);
  });

  it('⚠️ der Abschluss steht da, mit LEEREN Stammdatenfeldern', () => {
    // Genau das ist die ehrliche Aussage: die Datei gibt es, die Angaben zum
    // Steuerpflichtigen fehlen, und man SIEHT es.
    const c = dateien.find((d) => d.name === 'cashpointclosing.csv')!;
    const zeile = c.content.split('\r\n')[1] ?? '';
    const felder = zeile.split(';');
    const spalten = TAX.find((t) => t.datei === 'cashpointclosing.csv')!.spalten.map((s) => s.name);
    expect(felder[spalten.indexOf('NAME')]).toBe('');
    expect(felder[spalten.indexOf('LAND')]).toBe('');
    // Und was DA ist, steht drin.
    expect(felder[spalten.indexOf('Z_NR')]).toBe('42');
    expect(felder[spalten.indexOf('Z_SE_ZAHLUNGEN')]).toBe('1000,00');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE LEERFÜLLUNG HOB DEN WÄCHTER AUF, DEN SIE SCHÜTZEN SOLLTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `baueTabelle` WIRFT, wenn eine Spalte keine Festlegung hat — das ist die
 * zentrale Zusage dieser Umstellung: „eine Spalte ohne Festlegung ist ein
 * Fehler, kein leeres Feld."
 *
 * `baueAlleDateien` füllte aber JEDE Tabelle vorher auf. Damit kam die
 * Funktion auf diesem Weg NIE mit einer Lücke in Berührung, und wer eine
 * Zeile aus einer Zuordnung löschte, bekam die Spalte still leer.
 *
 * Ein Wächter, den der Aufrufer entwaffnet, bewacht nichts.
 */
describe('⛔ eine Tabelle MIT Zeilen duldet keine unbenannte Spalte', () => {
  const mitZeilen: Daten = {
    ...leer,
    belege: [{
      bonId: 'RCP-1', bonNr: '1', bonTyp: 'Beleg', bonStorno: false,
      bonStart: '2026-06-08T10:00:00Z', bonEnde: '2026-06-08T10:00:00Z',
      bedienerId: 'u1', umsatzBrutto: '119.00', kundeId: null, notiz: null,
    }],
  };

  it('mit vollständiger Zuordnung geht es durch', () => {
    expect(() => baueAlleDateien(TAX, mitZeilen)).not.toThrow();
  });

  it('⛔ fehlt EINE Spalte, wirft es — statt sie leer zu lassen', async () => {
    const { zuordnungen } = await import('../../src/lib/dsfinvk-dateien.js');
    const z = zuordnungen(mitZeilen);
    const eintrag = z['transactions.csv']!;
    const ohneEine = { ...eintrag.map } as Record<string, unknown>;
    delete ohneEine['UMS_BRUTTO'];

    const { baueTabelle } = await import('../../src/lib/dsfinvk-bauplan.js');
    const t = TAX.find((x) => x.datei === 'transactions.csv')!;
    expect(() =>
      baueTabelle(t, eintrag.zeilen as never[], ohneEine as never),
    ).toThrow(/UMS_BRUTTO/);
  });

  it('eine ZEILENLOSE Tabelle darf weiter nur die Kopfzeile tragen', () => {
    // Für sie gibt es keine Werte, und die Kopfzeile muss trotzdem stimmen.
    const dateien = baueAlleDateien(TAX, leer);
    const pa = dateien.find((d) => d.name === 'pa.csv')!;
    expect(pa.content.split('\r\n').filter((z) => z !== '')).toHaveLength(1);
  });
});

/**
 * ⚠️ Als `referenzen` für die Stornoverweise dazukam, fehlte das Feld in
 * dieser Vorlage. Der Bau starb mit „Cannot read properties of undefined
 * (reading 'length')" — ohne zu sagen, welche der zwanzig Tabellen gemeint
 * war. Der Bauplan nennt sie jetzt beim Namen.
 */
describe('⛔ eine fehlende Zeilenliste wird beim NAMEN genannt', () => {
  it('sagt, WELCHE Tabelle keine Liste hat', () => {
    const ohneReferenzen = { ...leer, referenzen: undefined } as unknown as typeof leer;
    expect(() => baueAlleDateien(TAX, ohneReferenzen)).toThrow(
      /die Zuordnung für \S+\.csv hält keine Zeilenliste \(bekommen: undefined\)/,
    );
  });

  it('nennt auch eine fehlende TABELLE beim Namen', () => {
    // ⚠️ Hier stand `as never`. `never` hat keine Eigenschaften und lässt sich
    // nicht ausbreiten; die Typprüfung der Tests war dadurch rot und damit aus.
    expect(() => baueAlleDateien([...TAX, { ...TAX[0]!, datei: 'erfunden.csv' }], leer))
      .toThrow(/für die amtliche Tabelle erfunden\.csv gibt es keine Zuordnung/);
  });
});
