/**
 * Was der Mensch am Tresen tippt, muss ankommen.
 *
 * ── DIE DREI FUNDE VOM 02.08.2026 ──────────────────────────────────────────
 *
 * Basel meldete zwei Dinge: er könne beim Verkaufen und Ankaufen kein Komma in
 * den Preis tippen, und ein Stück lasse sich nicht ins Lager aufnehmen.
 * Gemessen an der damaligen Zerlegung, mit echten Tastenfolgen:
 *
 *   eingetippt      wurde daraus     galt als gültig
 *   ──────────      ────────────     ───────────────
 *   1.999,99        1.99             JA      ⚠️ 1.999,99 € wurde zu 1,99 €
 *   199٫99          19999            JA      ⚠️ arabisches Komma verschluckt
 *   ١٩٩٫٩٩          (leer)           nein    ⚠️ Feld blieb leer
 *
 * Die dritte Zeile IST das gemeldete Erlebnis: das Feld bleibt leer, der
 * Speichern-Knopf bleibt grau, das Stück wird nicht angelegt. Beide Meldungen
 * hatten eine Wurzel.
 *
 * Die ERSTE Zeile ist die teuerste und war still: der Betrag wurde durch
 * tausend geteilt UND als gültig gemeldet. Der alte Kopfkommentar kannte den
 * Fehler sogar und verwies auf eine zweite, richtige Funktion. Gerufen wurde
 * die richtige von genau EINER Fläche von acht.
 *
 * ── WAS DIESER WÄCHTER SCHÜTZT ────────────────────────────────────────────
 *
 * Nicht die Umsetzung, sondern die Eigenschaft: was ein Mensch mit einer
 * deutschen ODER arabischen Tastatur tippt, kommt als derselbe Betrag an. Und
 * zwar über die EINE Zerlegung, die alle Flächen rufen.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatEur, isMoneyInput, isWeightInput, normalizeDecimal } from './decimal.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const FENSTER = resolve(HIER, '..');

describe('Geld, wie ein Mensch es tippt', () => {
  /** roh → kanonisch. Die Tabelle IST die Zusicherung. */
  const GELD: ReadonlyArray<readonly [string, string, string]> = [
    ['199,99', '199.99', 'deutsches Komma'],
    ['199.99', '199.99', 'Punkt als Dezimalzeichen'],
    ['1.999,99', '1999.99', '⚠️ Tausenderpunkt: wurde früher zu 1.99'],
    ['1,999.99', '1999.99', 'englische Schreibweise'],
    ['1.234.567,89', '1234567.89', 'zwei Tausenderpunkte'],
    ['1.999', '1999', 'nur Tausenderpunkt, keine Nachkommastellen'],
    ['1.500', '1500', 'derselbe Fall, runde Summe'],
    ['199٫99', '199.99', '⚠️ arabisches Dezimalzeichen U+066B'],
    ['١٩٩٫٩٩', '199.99', '⚠️ arabisch-indische Ziffern'],
    ['۱۹۹٫۹۹', '199.99', '⚠️ persische Ziffern'],
    ['1 999,99', '1999.99', 'Leerzeichen als Tausender'],
    ["1'999.99", '1999.99', 'Schweizer Hochkomma'],
    [',50', '0.50', 'ohne führende Null'],
    ['199,999', '199.99', 'dritte Stelle wird abgeschnitten, nicht gerundet'],
    ['199,99 €', '199.99', 'mit Währungszeichen'],
    ['', '', 'leer bleibt leer'],
  ];

  for (const [roh, soll, was] of GELD) {
    it(`„${roh}" wird ${soll === '' ? 'leer' : soll} (${was})`, () => {
      expect(normalizeDecimal(roh, 2)).toBe(soll);
    });
  }

  it('⛔ und jeder dieser Beträge gilt auch als GÜLTIG', () => {
    // Ohne diesen Satz könnte die Zerlegung richtig rechnen und der
    // Speichern-Knopf trotzdem grau bleiben. Genau das war Basels zweite
    // Meldung.
    for (const [roh, soll] of GELD) {
      if (soll === '') continue;
      expect(isMoneyInput(roh), `„${roh}" wird abgewiesen`).toBe(true);
    }
  });

  it('⛔ 1.999,99 € bleibt 1.999,99 € und wird nicht 1,99 €', () => {
    // Der teuerste Einzelfall, deshalb noch einmal für sich, mit der ANZEIGE.
    const kanonisch = normalizeDecimal('1.999,99', 2);
    expect(kanonisch).toBe('1999.99');
    expect(Number(kanonisch)).toBeGreaterThan(1000);
    expect(formatEur(kanonisch)).toBe('1.999,99');
  });

  it('während des Tippens ist noch nichts gültig', () => {
    // Ein Knopf, der schon nach dem Komma freigibt, speichert halbe Beträge.
    for (const halb of ['199,', '', '.', ',', '€']) {
      expect(isMoneyInput(halb), `„${halb}" darf nicht gültig sein`).toBe(false);
    }
  });

  it('das Gewicht behält drei Nachkommastellen', () => {
    expect(normalizeDecimal('7,965', 3)).toBe('7.965');
    expect(normalizeDecimal('7.965', 3)).toBe('7.965');
    expect(normalizeDecimal('١٢٫٥', 3)).toBe('12.5');
    expect(isWeightInput('7,965')).toBe(true);
    // Und als GELD wären drei Stellen abgeschnitten, nicht gerundet.
    expect(normalizeDecimal('7,965', 2)).toBe('7.96');
  });

  /**
   * ⚠️ Die eine Zweideutigkeit, ausdrücklich festgehalten.
   *
   * Beim GEWICHT ist `1.500` 1,5 g und nicht 1500 g: an der Goldwaage wiegt
   * ein Stück selten anderthalb Kilo, und `7.965` ist die übliche Schreibweise.
   * Wer Kilogramm meint, tippt `1500`. Das steht hier, damit die Entscheidung
   * sichtbar ist und nicht eines Tages als Fehler „berichtigt" wird.
   */
  it('die Zweideutigkeit beim Gewicht ist gewollt und festgehalten', () => {
    // Die Zeichenkette behält, was getippt wurde; als ZAHL ist sie 1,5.
    expect(normalizeDecimal('1.500', 3)).toBe('1.500');
    expect(Number(normalizeDecimal('1.500', 3))).toBe(1.5);
    expect(normalizeDecimal('1500', 3)).toBe('1500');
    // Beim GELD gilt die andere Auslegung, und das ist der Unterschied.
    expect(normalizeDecimal('1.500', 2)).toBe('1500');
  });
});

describe('Es gibt nur EINE Zerlegung', () => {
  function alleQuellen(wurzel: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(wurzel)) {
      if (name === 'node_modules') continue;
      const p = join(wurzel, name);
      if (statSync(p).isDirectory()) out.push(...alleQuellen(p));
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }

  /**
   * ⚠️ DER EIGENTLICHE SATZ.
   *
   * Der Fehler war nicht, dass eine Zerlegung falsch war. Er war, dass es ZWEI
   * gab und sieben von acht Flächen die falsche riefen. Wer eine dritte baut,
   * wird hier rot.
   */
  it('⛔ keine Fläche baut sich eine EIGENE Geldzerlegung', () => {
    const verdaechtig: string[] = [];
    for (const pfad of alleQuellen(FENSTER)) {
      if (pfad.endsWith('/lib/decimal.ts')) continue;
      const roh = readFileSync(pfad, 'utf8');
      const ohneKommentare = roh
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      // Das Erkennungszeichen einer eigenen Zerlegung: eine Zeichenklasse, die
      // Ziffern ZUSAMMEN MIT einem Dezimaltrennzeichen filtert.
      //
      // ⚠️ Der erste Anlauf verlangte nur `[^\d…]` und traf damit
      // `ReceiptPreview.tsx`, das aus „19 %" die Zahl 19 holt. Das ist keine
      // Geldzerlegung, sondern eine Prozentangabe. Ein Wächter, der Unschuldige
      // meldet, wird abgeschaltet, also muss mindestens ein Punkt oder Komma in
      // der Klasse stehen.
      if (/replace\(\s*\/\[\^\\d[^\]]*[.,][^\]]*\]\/[gimsuy]*\s*,/.test(ohneKommentare)) {
        verdaechtig.push(pfad.slice(FENSTER.length + 1));
      }
    }
    expect(
      verdaechtig,
      'Diese Dateien filtern Ziffern, Punkt und Komma selbst. Genau so entstand ' +
        'die zweite Zerlegung, die 1.999,99 zu 1,99 machte. Bitte ' +
        '`normalizeDecimal` aus lib/decimal.ts rufen.',
    ).toEqual([]);
  });

  it('die Suche findet überhaupt Dateien', () => {
    // Ohne diesen Satz wäre der obige auf einer leeren Liste grün.
    expect(alleQuellen(FENSTER).length).toBeGreaterThan(100);
  });
});
