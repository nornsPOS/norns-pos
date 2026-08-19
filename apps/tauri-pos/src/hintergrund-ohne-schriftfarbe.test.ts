/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EIN HINTERGRUND OHNE SCHRIFTFARBE IST WEISS AUF WEISS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ─────────────────────────────────────────────
 *
 * Basel wählte im Gerätemanager eine Waage aus und sah im Feld weisse Schrift
 * auf hellem Grund. Nachgemessen war es kein Einzelfall, sondern SECHS Mal
 * dieselbe Zeile in derselben Datei:
 *
 *     backgroundColor: 'var(--w14-parchment-1)',
 *     // und KEIN color
 *
 * Pergament ist hell. Die Schriftfarbe erbt der Browser vom Elternteil, und im
 * dunklen Modus ist die hell. Hell auf hell.
 *
 * ── WARUM DER BAUSATZ ES RICHTIG MACHT ────────────────────────────────────
 *
 * `baseControlStyle` in `@norns/ui-kit` setzt beide IMMER zusammen:
 *
 *     background: 'var(--w14-parchment-3)',
 *     color: 'var(--w14-ink)',
 *
 * Wer den Baustein abschreibt, nimmt oft den Hintergrund mit und lässt die
 * Schrift liegen: sie fällt beim Abschreiben nicht auf, weil sie im hellen
 * Modus zufällig stimmt.
 *
 * ── ⚠️ UND MEINE EIGENE MESSUNG HATTE EIN FENSTER ─────────────────────────
 *
 * Mein erster Zählweg las nur Stilobjekte, die IM Tag stehen. Drei der sechs
 * standen in einer gemeinsamen Hilfsfunktion `selectStyle()`, und die sah er
 * nicht. Gemeldet hatte ich drei, es waren sechs.
 *
 * Deshalb misst dieser Wächter die DATEI, nicht das Tag: jede Stelle, die eine
 * Hintergrundfarbe setzt, muss in ihrem Stilobjekt auch eine Schriftfarbe
 * setzen, egal ob das Objekt im Tag steht oder aus einer Funktion kommt.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WURZEL = dirname(fileURLToPath(import.meta.url));

/**
 * Kommentare weg: ein Beispiel in Prosa ist kein Gebrauch.
 *
 * ⚠️ DIE ZEILENUMBRÜCHE BLEIBEN STEHEN. Der erste Entwurf ersetzte einen
 * Blockkommentar durch EIN Leerzeichen und zog damit alle seine Zeilen
 * zusammen. Die gemeldeten Zeilennummern zeigten danach auf ganz andere
 * Stellen der Datei, und wer dem Befund folgte, landete im Nichts. Ein
 * Wächter, der auf die falsche Zeile zeigt, ist schlimmer als einer, der
 * schweigt: er kostet die Zeit, die er sparen sollte.
 */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (s: string): string => s.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_treffer, davor: string) => davor);
}

function alleFlaechen(): Array<{ name: string; quelle: string }> {
  const gefunden: Array<{ name: string; quelle: string }> = [];
  const fege = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const pfad = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) {
        fege(pfad);
        continue;
      }
      if (!/\.tsx$/.test(eintrag.name) || /\.test\.tsx$/.test(eintrag.name)) continue;
      gefunden.push({ name: pfad.slice(WURZEL.length + 1), quelle: ohneKommentare(readFileSync(pfad, 'utf8')) });
    }
  };
  fege(WURZEL);
  return gefunden;
}

/**
 * ⚠️ NUR EINGABEFELDER, UND WARUM DIE VERENGUNG RICHTIG IST.
 *
 * Der erste Entwurf mass JEDES Stilobjekt mit einer Hintergrundfarbe. Gemessen
 * waren das 181 Stellen in der ganzen Kasse. Das ist nicht die Klasse: die
 * allermeisten sind schmückende Flächen (Karten, Balken, Trennstriche,
 * Messuhren in `zielkarte/instruments.tsx`), die gar keinen Text tragen. Ein
 * Wächter mit 181 Dauertreffern wird weggeschaut, und dann verdeckt er den
 * echten Fund.
 *
 * Der Fehler, den Basel gefunden hat, hat eine engere Gestalt: ein
 * EINGABEFELD, in dem Text steht, den ein Mensch lesen und tippen muss. Genau
 * dort löst der Bausatz es bereits richtig, und genau dort ist eine
 * abgeschriebene Hintergrundfarbe ohne Schriftfarbe ein Fehler.
 *
 * Gemessen wird deshalb: `<input>`, `<select>` und `<textarea>` in ROHER Form,
 * also ohne den Bausatz. Deren Stil, egal ob er im Tag steht oder aus einer
 * Hilfsfunktion derselben Datei kommt.
 */
const ROHES_FELD = /<(input|select|textarea)\b/g;

/** Der Attributblock eines Tags, mit Klammerzählung statt am ersten `>`. */
function tagBlock(quelle: string, ab: number): string {
  let i = ab;
  let tiefe = 0;
  while (i < quelle.length) {
    const c = quelle[i];
    if (c === '{' || c === '(') tiefe++;
    else if (c === '}' || c === ')') tiefe--;
    else if (c === '>' && tiefe === 0) break;
    i++;
  }
  return quelle.slice(ab, i);
}

/**
 * Der Stil eines rohen Feldes: was im Tag steht, PLUS der Rumpf jeder
 * Hilfsfunktion derselben Datei, die im Tag als Stil aufgerufen wird.
 *
 * Ohne den zweiten Teil bleibt genau die Hälfte des Befunds unsichtbar: drei
 * der sechs kaputten Felder im Gerätemanager holten ihren Stil aus einem
 * gemeinsamen `selectStyle()`, und meine erste Messung sah sie nicht.
 */
function stilEinesFeldes(quelle: string, block: string): string {
  let stil = block;
  for (const m of block.matchAll(/style=\{\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    const def = new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\}`).exec(quelle);
    if (def) stil += `\n${def[0]}`;
  }
  return stil;
}

const SETZT_HINTERGRUND = /\b(?:backgroundColor|background)\s*:/;
const SETZT_SCHRIFT = /(?<![a-zA-Z])color\s*:/;

describe('⛔ Ein rohes Eingabefeld mit Hintergrund nennt auch die Schriftfarbe', () => {
  const flaechen = alleFlaechen();

  it('es gibt überhaupt Flächen zu messen', () => {
    // „null ist nicht grün": fände der Fegezug nichts, wäre alles unten
    // trivial erfüllt. Am 13.08.2026 waren es über 100.
    expect(flaechen.length).toBeGreaterThan(50);
  });

  it('⛔ kein rohes Feld setzt eine Hintergrundfarbe ohne Schriftfarbe', () => {
    const verstoesse: string[] = [];
    for (const { name, quelle } of flaechen) {
      for (const m of quelle.matchAll(ROHES_FELD)) {
        const block = tagBlock(quelle, m.index ?? 0);
        const stil = stilEinesFeldes(quelle, block);
        if (!SETZT_HINTERGRUND.test(stil)) continue;
        // `backgroundColor` trägt selbst das Wort „Color". Erst entfernen,
        // dann nach einer echten Schriftfarbe suchen.
        const ohneBg = stil
          .replace(/\bbackgroundColor\s*:/g, 'BG:')
          .replace(/\bbackground\s*:/g, 'BG:');
        if (SETZT_SCHRIFT.test(ohneBg)) continue;
        verstoesse.push(`${name}:${quelle.slice(0, m.index ?? 0).split('\n').length}  <${m[1]}>`);
      }
    }
    expect(
      verstoesse,
      'Diese Eingabefelder setzen eine Hintergrundfarbe und KEINE ' +
        'Schriftfarbe. Die Schrift erbt dann vom Elternteil, und im dunklen ' +
        'Modus ist die hell: helle Schrift auf hellem Grund, das Feld sieht ' +
        'leer aus. Genau das hat Basel am 13.08.2026 an der Waage gesehen. ' +
        'Richtig ist `Input`, `Select` oder `Textarea` aus ' +
        '`@norns/ui-kit`: dort setzt `baseControlStyle` beide immer als ' +
        'PAAR. Wer ein rohes Feld wirklich braucht, schreibt die Schriftfarbe ' +
        'daneben.',
    ).toEqual([]);
  });
});
