/**
 * Der Bauplan: Kopfzeile aus der Norm, Werte aus der Zuordnung.
 *
 * Diese Prüfungen sichern das WERKZEUG, mit dem die zwanzig Dateien entstehen.
 * Ein Fehler hier trüge sich in jede einzelne fort.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { baueTabelle, zahl } from '../../src/lib/dsfinvk-bauplan.js';
import { leseTaxonomie } from '../../src/lib/dsfinvk-taxonomie.js';

const TAX = leseTaxonomie(
  readFileSync(new URL('../../src/fiskal/dsfinvk-2.4/index.xml', import.meta.url), 'utf8'),
);
const linesVat = TAX.find((t) => t.datei === 'lines_vat.csv')!;

describe('⚠️ die Zahl trägt ein KOMMA', () => {
  it('so verlangt es die Norm, und so liest das Prüfwerkzeug', () => {
    // Der alte Erzeuger schrieb Punkte — damit beschrieb die mitgelieferte
    // index.xml jeden Betrag des Pakets falsch.
    expect(zahl('1234.5', 2)).toBe('1234,50');
    expect(zahl('0.005', 5)).toBe('0,00500');
    expect(zahl(-7.1, 2)).toBe('-7,10');
  });

  it('ganze Zahlen bekommen kein Komma', () => {
    expect(zahl('42', 0)).toBe('42');
  });

  it('⛔ und ein leerer Wert bleibt LEER, nicht null', () => {
    // Eine Null in einem Betragsfeld ist eine Aussage („nichts eingenommen"),
    // kein Fehlen.
    expect(zahl(null, 2)).toBe('');
    expect(zahl(undefined, 2)).toBe('');
    expect(zahl('', 2)).toBe('');
    expect(zahl('keine Zahl', 2)).toBe('');
  });
});

describe('die Kopfzeile kann nicht mehr falsch sein', () => {
  it('sie fällt aus der Norm, nicht aus dem Erzeuger', () => {
    const csv = baueTabelle(linesVat, [], Object.fromEntries(
      linesVat.spalten.map((s) => [s.name, () => undefined]),
    ));
    expect(csv.split('\r\n')[0]).toBe(
      'Z_KASSE_ID;Z_ERSTELLUNG;Z_NR;BON_ID;POS_ZEILE;UST_SCHLUESSEL;POS_BRUTTO;POS_NETTO;POS_UST',
    );
  });

  it('⛔ eine Spalte OHNE Festlegung ist ein Fehler, kein leeres Feld', () => {
    // Genau der Zustand, den diese Umstellung beendet: eine Spalte, die
    // niemand füllt und die niemand vermisst.
    expect(() => baueTabelle(linesVat, [], { Z_KASSE_ID: () => 'x' })).toThrow(
      /nicht festgelegt, woher ihr Wert kommt/,
    );
  });

  it('und die Meldung nennt JEDE fehlende Spalte', () => {
    try {
      baueTabelle(linesVat, [], { Z_KASSE_ID: () => 'x' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('POS_ZEILE');
      expect((e as Error).message).toContain('UST_SCHLUESSEL');
    }
  });
});

describe('die Datenzeilen', () => {
  const zuordnung = Object.fromEntries(
    linesVat.spalten.map((s) => [s.name, (z: { n: number }) => `${s.name}-${z.n}`]),
  );

  it('stehen in der Reihenfolge der Norm', () => {
    const csv = baueTabelle(linesVat, [{ n: 1 }], zuordnung);
    expect(csv.split('\r\n')[1]).toBe(
      'Z_KASSE_ID-1;Z_ERSTELLUNG-1;Z_NR-1;BON_ID-1;POS_ZEILE-1;UST_SCHLUESSEL-1;POS_BRUTTO-1;POS_NETTO-1;POS_UST-1',
    );
  });

  it('CRLF am Zeilenende, wie die Norm sagt', () => {
    const csv = baueTabelle(linesVat, [{ n: 1 }], zuordnung);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.includes('\n\n')).toBe(false);
  });

  it('⚠️ ein Feld mit Trennzeichen wird eingefasst', () => {
    // Sonst zerfiele die Zeile beim Einlesen, und der Prüfer sähe eine andere
    // Spaltenzahl als die Beschreibung verspricht.
    const csv = baueTabelle(linesVat, [{ n: 1 }], {
      ...zuordnung,
      Z_KASSE_ID: () => 'a;b',
    });
    expect(csv.split('\r\n')[1]?.startsWith('"a;b";')).toBe(true);
  });

  it('und ein Anführungszeichen im Feld wird verdoppelt', () => {
    const csv = baueTabelle(linesVat, [{ n: 1 }], {
      ...zuordnung,
      Z_KASSE_ID: () => 'a"b',
    });
    expect(csv.split('\r\n')[1]?.startsWith('"a""b";')).toBe(true);
  });

  it('eine ausdrücklich unbekannte Spalte bleibt leer', () => {
    const csv = baueTabelle(linesVat, [{ n: 1 }], { ...zuordnung, POS_UST: () => undefined });
    expect(csv.split('\r\n')[1]?.endsWith(';')).toBe(true);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE FELDLÄNGE WURDE GELESEN UND WEGGEWORFEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die `index.xml` nennt zu jedem Textfeld eine `MaxLength`. Das Prüfwerkzeug
 * liest dieselbe Datei aus demselben ZIP und weist den Datenträger wegen einer
 * Feldüberlänge zurück.
 *
 * `ARTIKELTEXT` fasst 60 Zeichen. Ein Schmuckname mit Punzenbeschreibung
 * sprengt das ohne Weiteres.
 */
describe('⛔ die Feldlänge der Norm', () => {
  const lines = TAX.find((t) => t.datei === 'lines.csv')!;
  const alleLeer = Object.fromEntries(lines.spalten.map((s) => [s.name, () => undefined]));

  it('ein zu langer Artikeltext wird gekürzt', () => {
    // ⚠️ Die Grenze kommt aus der NORM, nicht aus meinem Kopf: der erste
    // Entwurf nahm 60 an und prüfte mit 200 Zeichen — ARTIKELTEXT fasst
    // aber 255, und der Text ging unversehrt durch.
    const lang = 'A'.repeat(400);
    const csv = baueTabelle(lines, [{}], { ...alleLeer, ARTIKELTEXT: () => lang });
    const spalten = lines.spalten.map((s) => s.name);
    const feld = (csv.split('\r\n')[1] ?? '').split(';')[spalten.indexOf('ARTIKELTEXT')] ?? '';
    const grenze = lines.spalten.find((s) => s.name === 'ARTIKELTEXT')!.laenge!;
    expect(feld.length).toBe(grenze);
    expect(grenze).toBeLessThan(400);
  });

  it('ein kurzer Text bleibt unangetastet', () => {
    const csv = baueTabelle(lines, [{}], { ...alleLeer, ARTIKELTEXT: () => 'Goldmünze' });
    expect(csv).toContain('Goldmünze');
  });

  it('⛔ eine ZAHL wird NICHT gekürzt', () => {
    // Eine gekürzte Zahl wäre eine Fälschung: sie ist entweder darstellbar
    // oder der Wert gehört nicht dorthin.
    const csv = baueTabelle(lines, [{}], { ...alleLeer, STK_BR: () => '123456789012345,00000' });
    expect(csv).toContain('123456789012345,00000');
  });
});
