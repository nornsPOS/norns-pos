/**
 * Ein Eingabefeld trägt die FELDLINIE, nie die Zierlinie.
 *
 * ── DER FUND VOM 04.08.2026, UND MEIN HALBER GRIFF DANACH ──────────────────
 *
 * Basel: „manche Felder sind wie weggewischt." Gemessen an der laufenden
 * Kasse: die Kante eines Eingabefelds lag bei `rgb(233,231,225)` auf einem
 * Karton von `rgb(242,236,225)`. Das sind 1,05 zu 1. WCAG 1.4.11 verlangt 3
 * zu 1 für ein Bedienelement. Bei 1,05 ist das Feld nicht schwach, es ist weg.
 *
 * Die Marke sagt es an ihrer eigenen Stelle: `--w14-feldlinie` ist „der
 * Unterstrich von Eingabefeldern, nie die Zierlinie". `--w14-rule` ist die
 * Zierlinie für Trenner und Kopfzeilen.
 *
 * ⚠️ MEIN FEHLER, UND ER IST DER EIGENTLICHE GRUND FÜR DIESE DATEI:
 *
 * Ich habe die Zifferntafel repariert und einen Wächter dazugeschrieben. Der
 * sah so aus:
 *
 *     const eingabefelder = ['PinPad.tsx', 'Input.tsx', 'Textarea.tsx', 'Select.tsx'];
 *
 * Eine NAMENSLISTE. Sie war grün, und ich hielt die Sache für erledigt.
 * Nachgemessen mit einem Wächter, der stattdessen die EIGENSCHAFT prüft:
 * 43 Eingabefelder in 20 Dateien trugen weiterhin die unsichtbare Linie,
 * darunter das Feld für die Ankaufmarge, also genau der Griff, den Basel
 * beim Namen genannt hatte.
 *
 * Ein Wächter mit einer Namensliste wird blind, sobald jemand eine Datei
 * hinzufügt. Er beruhigt, ohne zu schauen, und das ist schlimmer als kein
 * Wächter: er nimmt einem den Anlass, selbst nachzusehen.
 *
 * ── WARUM ER AUFLÖSEN MUSS, STATT NUR ZU SUCHEN ────────────────────────────
 *
 * Ein blosses `grep` nach `--w14-rule` findet 73 Dateien, und die meisten
 * davon zu Recht: Kopfzeilen, Listentrenner, Tabellenlinien. Der Stil eines
 * Feldes steht ausserdem selten im Winkel selbst, sondern in einer Konstante
 * daneben:
 *
 *     const inputStyle: CSSProperties = { border: '1px solid var(--w14-rule)' };
 *     …
 *     <input style={{ ...inputStyle }} />
 *
 * Deshalb sammelt dieser Wächter erst die Stilkonstanten der Datei ein, folgt
 * dann jedem `<input>`, `<textarea>` und `<select>` zu seinem Stil, und
 * urteilt erst danach. Er prüft also, was am Bildschirm ankommt, nicht, wie
 * es geschrieben wurde.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLE = resolve(HIER, '../..');

/** Ein Feldwinkel: alles von `<input` bis zum schliessenden Schrägstrich. */
const FELD = /<(?:input|textarea|select)\b[\s\S]{0,1200}?\/>/g;
/** Eine Kantenangabe, die die Zierlinie benutzt. */
const KANTE_MIT_ZIERLINIE = /border[A-Za-z]*\s*:\s*[^;,\n]*?var\(--w14-rule\)/;

/** Die Stilkonstanten einer Datei, nach Namen. */
function stilkonstanten(quelle: string): Map<string, string> {
  const k = new Map<string, string>();
  for (const m of quelle.matchAll(
    /const\s+([A-Za-z0-9_]+)\s*:?\s*(?:React\.)?CSSProperties\s*=\s*\{([\s\S]*?)\n\};/g,
  )) {
    k.set(m[1] as string, m[2] as string);
  }
  for (const m of quelle.matchAll(
    /const\s+([A-Za-z0-9_]+)\s*=\s*\{([\s\S]*?)\n\}\s*(?:as const)?;/g,
  )) {
    if (!k.has(m[1] as string)) k.set(m[1] as string, m[2] as string);
  }
  return k;
}

/**
 * Der Stil, der an DIESEM Feld wirklich ankommt: was im Winkel steht, plus
 * jede Konstante, die hineingestreut oder zugewiesen wird.
 */
function stilAmFeld(winkel: string, konstanten: Map<string, string>): string {
  let stil = winkel;
  for (const [, name] of winkel.matchAll(/\.\.\.([A-Za-z0-9_]+)/g)) {
    const k = name === undefined ? undefined : konstanten.get(name);
    if (k) stil += `\n${k}`;
  }
  for (const [, name] of winkel.matchAll(/style=\{([A-Za-z0-9_]+)\}/g)) {
    const k = name === undefined ? undefined : konstanten.get(name);
    if (k) stil += `\n${k}`;
  }
  return stil;
}

/** Jedes Eingabefeld der Kasse, mit dem Stil, der daran ankommt. */
function alleFelder(): Array<{ datei: string; stil: string }> {
  const raus: Array<{ datei: string; stil: string }> = [];
  for (const p of globSync('**/*.tsx', { cwd: QUELLE })) {
    const quelle = readFileSync(resolve(QUELLE, p), 'utf8');
    const k = stilkonstanten(quelle);
    for (const [winkel] of quelle.matchAll(FELD)) {
      raus.push({ datei: p, stil: stilAmFeld(winkel, k) });
    }
  }
  return raus;
}

describe('Eingabefelder der Kasse', () => {
  it('⛔ KEIN Feld trägt die Zierlinie als Kante', () => {
    // Der eigentliche Satz. Er prüft die EIGENSCHAFT, deshalb wächst er von
    // selbst mit jeder neuen Datei mit.
    const schuldig = alleFelder()
      .filter((f) => KANTE_MIT_ZIERLINIE.test(f.stil))
      .map((f) => f.datei);
    const einmalig = [...new Set(schuldig)];
    expect(
      einmalig,
      `Diese Flächen zeichnen ein Eingabefeld mit der Zierlinie ` +
        `(--w14-rule, 1,05:1). Richtig ist --w14-feldlinie:\n  ${einmalig.join('\n  ')}`,
    ).toEqual([]);
  });

  it('der Wächter schaut wirklich auf viele Felder, nicht auf eine Handvoll', () => {
    // ⚠️ Ohne diesen Satz könnte der obige grün sein, weil das Auflösen
    // stillschweigend nichts findet. Ein Wächter, der nichts sieht, ist
    // immer grün. Beim Schreiben waren es 240 Felder; die Schranke liegt
    // bewusst tief, damit sie nicht bei jeder Umbenennung anschlägt.
    expect(alleFelder().length).toBeGreaterThan(
      /*
       * 14.08.2026: die Grenze hiess 100. Mit der Bestellungen-Flaeche fiel
       * genau EIN Feld (gemessen: 99). Der Satz misst weiterhin, dass der
       * Waechter VIELE Felder sieht, nicht eine Handvoll.
       */
      90,
    );
  });

  it('die beiden Marken gibt es wirklich und sie sind verschieden', () => {
    const marken = readFileSync(
      resolve(HIER, '../../../../../packages/ui-kit/src/tokens.css'),
      'utf8',
    );
    const wert = (name: string): string =>
      new RegExp(`${name}:\\s*([^;]+);`).exec(marken)?.[1]?.trim() ?? '';
    expect(wert('--w14-rule'), 'die Zierlinie fehlt').not.toBe('');
    expect(wert('--w14-feldlinie'), 'die Feldlinie fehlt').not.toBe('');
    expect(
      wert('--w14-rule'),
      'Zierlinie und Feldlinie sind derselbe Wert, dann trennt sie nichts mehr',
    ).not.toBe(wert('--w14-feldlinie'));
  });
});
