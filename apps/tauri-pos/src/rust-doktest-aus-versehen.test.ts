/**
 * ════════════════════════════════════════════════════════════════════════
 *  KEIN DOKTEST AUS VERSEHEN
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * `aufsicht.rs` erklärt im Kopfkommentar, was der alte Faden tat, und zitierte
 * dafür eine Zeile aus einer ANDEREN Datei, eingerückt, wie man Zitate setzt:
 *
 *     //!     while empfaenger.recv().is_ok() {}
 *
 * rustdoc liest einen eingerückten Block in einem Doc-Kommentar aber nicht als
 * Zitat, sondern als RUST-CODE und übersetzt ihn. Das Zitat hatte keinen
 * Kontext, in dem `empfaenger` existiert. Ergebnis: der EINZIGE Doktest des
 * ganzen Kistchens war dauerhaft rot, mit
 * „cannot find value `empfaenger` in this scope".
 *
 * Sichtbar wurde er nur auf Windows: nur dort läuft `cargo test` (das Doktests
 * einschliesst). Die Linux-Strecke fährt `cargo check` und sieht Doktests nie.
 * Hausklasse „ein Tor, das rot ist, verdeckt das nächste".
 *
 * ── WARUM DIESER WÄCHTER IN JAVASCRIPT STEHT ───────────────────────────────
 *
 * Weil er dann in der SCHNELLEN Strecke läuft. Ein zweites `cargo test --doc`
 * auf Linux wäre ehrlicher, kostet aber eine volle Übersetzung des Kistchens;
 * dieser Wächter kostet Millisekunden und findet dieselbe Klasse, bevor jemand
 * zwanzig Minuten auf Windows wartet.
 *
 * ── WAS ER MISST, UND WAS ER BEWUSST NICHT MISST ───────────────────────────
 *
 * Gemessen: ein eingerückter Block (vier Leerzeichen oder mehr), der in einem
 * Doc-Kommentar auf eine Leerzeile folgt und NICHT in einem ```-Zaun steht.
 * Genau das macht rustdoc zu einem Doktest.
 *
 * NICHT gemessen: dasselbe innerhalb eines `#[cfg(test)]`-Moduls. rustdoc
 * übersetzt ohne `cfg(test)`, diese Module existieren für ihn also gar nicht.
 * Das ist kein Schlupfloch, sondern der Unterschied zwischen „sieht aus wie"
 * und „ist", und er wurde gemessen: der Baum hat zwei solche Stellen, und
 * `cargo test --doc` zählte trotzdem nur EINEN Doktest.
 *
 * ── GEGENPROBE ─────────────────────────────────────────────────────────────
 *
 * Nach der Reparatur meldet `cargo test --doc` null Doktests, und dieser
 * Wächter null Treffer. Zwei unabhängige Messungen, dieselbe Zahl.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const KISTCHEN = join(HIER, '../src-tauri/src');

function alleRustDateien(wurzel: string): string[] {
  const gefunden: string[] = [];
  const gehen = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const weg = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) {
        if (eintrag.name === 'target') continue;
        gehen(weg);
        continue;
      }
      if (eintrag.name.endsWith('.rs')) gefunden.push(weg);
    }
  };
  gehen(wurzel);
  return gefunden;
}

/**
 * Die Zeilennummern, die innerhalb eines `#[cfg(test)]`-Moduls liegen.
 *
 * Bewusst über Klammernzählung und nicht über einen echten Zerteiler: es geht
 * nur darum, einen Bereich zu erkennen, den rustdoc nachweislich nicht sieht.
 * Zeichenketten mit Klammern darin könnten die Zählung theoretisch stören,
 * deshalb ist das Ergebnis unten gegen `cargo test --doc` gegengeprüft und
 * nicht bloss behauptet.
 */
function pruefmodulZeilen(zeilen: string[]): Set<number> {
  const drin = new Set<number>();
  for (let i = 0; i < zeilen.length; i += 1) {
    if (!/^\s*#\[cfg\(test\)\]/.test(zeilen[i] ?? '')) continue;
    // Die öffnende Klammer des Moduls suchen …
    let j = i;
    while (j < zeilen.length && !(zeilen[j] ?? '').includes('{')) j += 1;
    if (j >= zeilen.length) continue;
    // … und bis zur passenden schliessenden zählen.
    let tiefe = 0;
    let gestartet = false;
    for (let k = j; k < zeilen.length; k += 1) {
      for (const z of zeilen[k] ?? '') {
        if (z === '{') {
          tiefe += 1;
          gestartet = true;
        } else if (z === '}') tiefe -= 1;
      }
      drin.add(k);
      if (gestartet && tiefe === 0) break;
    }
  }
  return drin;
}

type Treffer = { datei: string; zeile: number; text: string };

function versehentlicheDoktests(weg: string): Treffer[] {
  const zeilen = readFileSync(weg, 'utf8').split('\n');
  const imPruefmodul = pruefmodulZeilen(zeilen);
  const treffer: Treffer[] = [];

  let imZaun = false;
  let vorherLeer = false;

  zeilen.forEach((roh, i) => {
    const m = /^\s*\/\/[!/](.*)$/.exec(roh);
    if (m === null) {
      // Der Doc-Block endet, Zaun und Leerzeilengedächtnis zurücksetzen.
      imZaun = false;
      vorherLeer = false;
      return;
    }
    const inhalt = m[1] ?? '';
    if (/^\s*```/.test(inhalt)) {
      imZaun = !imZaun;
      vorherLeer = false;
      return;
    }
    if (imZaun) return;
    if (inhalt.trim() === '') {
      vorherLeer = true;
      return;
    }
    if (vorherLeer && /^ {4,}\S/.test(inhalt) && !imPruefmodul.has(i)) {
      treffer.push({ datei: weg, zeile: i + 1, text: inhalt.trim() });
    }
    vorherLeer = false;
  });

  return treffer;
}

describe('⛔ Kein eingerückter Block in einem Doc-Kommentar wird still zum Doktest', () => {
  const dateien = alleRustDateien(KISTCHEN);

  it('der Messpunkt existiert überhaupt noch', () => {
    // Ein Wächter ohne Messpunkt ist still grün.
    expect(
      dateien.length,
      `Unter \`${KISTCHEN}\` liegt keine einzige \`.rs\`-Datei mehr. ` +
        'Entweder wurde das Kistchen verschoben, dann gehört dieser Wächter ' +
        'mit verschoben, oder er misst ins Leere.',
    ).toBeGreaterThan(0);
  });

  it.each(dateien.map((d) => ({ name: relative(KISTCHEN, d).split('\\').join('/'), weg: d })))(
    '$name',
    ({ weg }) => {
      const treffer = versehentlicheDoktests(weg);
      expect(
        treffer.map((t) => `Zeile ${t.zeile}: ${t.text}`),
        'Ein eingerückter Block in einem Doc-Kommentar ist für rustdoc RUST-CODE, ' +
          'kein Zitat: er wird als Doktest übersetzt und macht `cargo test` rot, ' +
          'sobald darin ein Name steht, den es in diesem Kontext nicht gibt. ' +
          'Gemeint war fast immer ein Zitat, dann gehört ein ```text-Zaun darum. ' +
          'Soll es wirklich ein laufender Doktest sein, dann bitte ein ```-Zaun ' +
          'mit dem Kontext, der ihn übersetzbar macht.',
      ).toEqual([]);
    },
  );
});
