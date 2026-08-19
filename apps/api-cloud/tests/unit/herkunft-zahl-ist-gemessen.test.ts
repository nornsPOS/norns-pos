/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE ZAHLEN IM HERKUNFTSNACHWEIS MÜSSEN GEMESSEN SEIN, NICHT ERINNERT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND (09.08.2026, nachgemessen) ──────────────────────────────────
 *
 * `src/fiskal/dsfinvk-2.4/HERKUNFT.md` behauptete in Zeile 34, die amtliche
 * `index.xml` beschreibe "alle 20 Tabellen mit 438 Spalten". Nachgezählt sind
 * es 219. Zweifach belegt, mit Öffnungs- und Schlussmarken:
 *
 *     $ grep -c '<VariableColumn>'  index.xml   ->  219
 *     $ grep -c '</VariableColumn>' index.xml   ->  219
 *
 * 438 ist genau das Doppelte von 219. Die Zahl entstand also durch doppeltes
 * Zählen (Öffnungs- plus Schlussmarke) und wurde danach nie wieder gegen die
 * Datei gehalten. Die Zahl der Tabellen, 20, stimmte dagegen.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ──────────────────────────────────
 *
 * Naheliegend wäre, die 438 einfach durch 219 zu ersetzen und weiterzugehen.
 * Damit stünde in dem Dokument, dessen einziger Zweck NACHPRÜFBARKEIT ist,
 * wieder eine Zahl, die niemand mehr nachrechnet. Tauscht jemand später das
 * amtliche Prüfstück gegen eine neue Fassung aus, veraltet sie erneut still.
 * Ein Herkunftsnachweis, dessen Zahlen aus der Erinnerung stammen, ist im Haus
 * die Klasse "Anzeige liest eine Tabelle, die niemand füllt".
 *
 * ── WAS DIESER WÄCHTER MISST ───────────────────────────────────────────────
 *
 * Er liest BEIDE Seiten frisch von der Platte und vergleicht sie:
 *
 *   1. Die Zahl vor dem Wort "Spalten" in HERKUNFT.md gegen die gezählten
 *      `<VariableColumn>` Marken in index.xml.
 *   2. Die Zahl vor dem Wort "Tabellen" gegen die gezählten `<Table>` Marken.
 *   3. Beide Angaben dürfen in HERKUNFT.md GENAU EINMAL vorkommen. Wächst das
 *      Dokument und nennt die Zahl an zweiter Stelle, wird der Wächter rot
 *      statt sich stumm die falsche Fundstelle auszusuchen. Das ist die Falle
 *      "Wächter misst die Erwähnung statt den Gebrauch", hier von vorne
 *      ausgeschlossen.
 *   4. Öffnungs- und Schlussmarken in index.xml müssen gleich viele sein,
 *      sonst zählt der Wächter selbst falsch.
 *
 * ⚠️ Und er prüft SICH SELBST: die beiden Ausdrücke müssen den historisch
 * echten Fehlersatz erkennen und aus ihm 438 und 20 herausholen. Ohne diesen
 * Schritt wäre ein Tippfehler im Ausdruck ein für immer grüner Wächter, der
 * nichts bewacht.
 *
 * Der Wächter hängt an KEINER Zeilennummer und an keiner Namensliste. Er
 * kennt keine der beiden Zahlen selbst, ausser im Selbsttest.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const lies = (pfad: string): string => readFileSync(new URL(pfad, import.meta.url), 'utf8');

const HERKUNFT = lies('../../src/fiskal/dsfinvk-2.4/HERKUNFT.md');
const INDEX_XML = lies('../../src/fiskal/dsfinvk-2.4/index.xml');

/** Zahl unmittelbar vor dem Wort, in einer Fliesstextzeile. */
const SPALTEN_ANGABE = /(\d+)\s+Spalten/g;
const TABELLEN_ANGABE = /(\d+)\s+Tabellen/g;

/** Marken in der amtlichen `index.xml`, offen und geschlossen getrennt. */
const SPALTE_AUF = /<VariableColumn(?:\s[^>]*)?>/g;
const SPALTE_ZU = /<\/VariableColumn>/g;
const TABELLE_AUF = /<Table(?:\s[^>]*)?>/g;
const TABELLE_ZU = /<\/Table>/g;

const zaehle = (text: string, muster: RegExp): number => text.match(new RegExp(muster))?.length ?? 0;

const alleAngaben = (text: string, muster: RegExp): number[] =>
  [...text.matchAll(new RegExp(muster))].map((t) => Number(t[1]));

describe('HERKUNFT.md nennt gemessene Zahlen, keine erinnerten', () => {
  it('die Ausdrücke erkennen den historisch echten Fehlersatz', () => {
    // Zeile 34 von damals, wörtlich. Fällt einer der Ausdrücke aus, ist dieser
    // Satz sein Prüfstein, und der Wächter kann nicht still grün werden.
    const damals = '`index.xml` beschreibt alle 20 Tabellen mit 438 Spalten maschinenlesbar.**';
    expect(alleAngaben(damals, SPALTEN_ANGABE)).toEqual([438]);
    expect(alleAngaben(damals, TABELLEN_ANGABE)).toEqual([20]);
  });

  it('das amtliche Prüfstück zählt sich selbst widerspruchsfrei', () => {
    expect(zaehle(INDEX_XML, SPALTE_AUF)).toBe(zaehle(INDEX_XML, SPALTE_ZU));
    expect(zaehle(INDEX_XML, TABELLE_AUF)).toBe(zaehle(INDEX_XML, TABELLE_ZU));
  });

  it('die Spaltenzahl steht genau einmal und ist die gezählte', () => {
    const genannt = alleAngaben(HERKUNFT, SPALTEN_ANGABE);
    expect(genannt).toHaveLength(1);
    expect(genannt[0]).toBe(zaehle(INDEX_XML, SPALTE_AUF));
  });

  it('die Tabellenzahl steht genau einmal und ist die gezählte', () => {
    const genannt = alleAngaben(HERKUNFT, TABELLEN_ANGABE);
    expect(genannt).toHaveLength(1);
    expect(genannt[0]).toBe(zaehle(INDEX_XML, TABELLE_AUF));
  });
});
