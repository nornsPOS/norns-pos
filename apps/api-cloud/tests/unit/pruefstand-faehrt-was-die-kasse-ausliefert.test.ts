/**
 * ════════════════════════════════════════════════════════════════════════
 *  DER PRUEFSTAND MUSS FAHREN, WAS DIE KASSE AUSLIEFERT
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Drei Laufzeiten, drei verschiedene Fassungen:
 *
 *     .nvmrc (Pruefstand + CI)      20.18.0
 *     der Entwicklerrechner         24.15.0
 *     WAS DIE KASSE MITLIEFERT      22.14.0   ← der Beipack IST ein
 *                                               umbenanntes node
 *
 * Sieben Pruefdateien der Kasse laden `node:sqlite`. Das gibt es ab Node 22.5.
 * Auf dem Entwicklerrechner (24) laufen sie, auf dem Fliessband (20) stirbt
 * jede mit `ERR_UNKNOWN_BUILTIN_MODULE`, und weil CI ohnehin seit Tagen rot
 * war, ist es niemandem aufgefallen. Am 11.08.2026 waren es DREI solche
 * Dateien; die Zahl waechst, solange der Lauf sie nie einsammelt.
 *
 * ── WARUM DIE FASSUNG DER AUSGELIEFERTEN GILT ──────────────────────────────
 *
 * Der Prueflauf soll den Zustand messen, in dem das Programm beim Haendler
 * laeuft. Laeuft er auf einer aelteren Laufzeit, prueft er ein Programm, das
 * es nicht gibt: er meldet Fehler, die im Betrieb keine sind, und uebersieht
 * welche, die es sind. Hausklasse „der Pruefstand macht denselben Fehler",
 * nur andersherum.
 *
 * ── WAS DIESER WAECHTER MISST ──────────────────────────────────────────────
 *
 * Dass `.nvmrc` GENAU die Fassung nennt, die das Freigabe-Fliessband in das
 * Buendel legt. Gelesen werden beide Orte, nicht abgeschrieben: waechst der
 * Beipack auf eine neue Fassung, wird dieser Waechter rot, bis der Pruefstand
 * mitzieht.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '../../../..');

/** Die Fassung, die der Pruefstand und jedes Tor fahren. */
function nvmrcFassung(): string {
  return readFileSync(join(WURZEL, '.nvmrc'), 'utf8').trim();
}

/**
 * Die Fassungen, die das Freigabe-Fliessband wirklich herunterlaedt.
 *
 * Absichtlich aus der Datei gelesen und nicht hier eingetragen: eine zweite
 * Stelle waere eine zweite Wahrheit, und genau daraus ist der Befund
 * entstanden.
 */
function ausgelieferteFassungen(): string[] {
  const yml = readFileSync(join(WURZEL, '.github/workflows/release.yml'), 'utf8');
  const treffer = [...yml.matchAll(/node-v(\d+\.\d+\.\d+)/g)].map((m) => m[1] as string);
  return [...new Set(treffer)];
}

/**
 * ALLE Fliessbaender, gefegt statt aufgezaehlt.
 *
 * ⚠️ Hier stand eine Namensliste mit zwei Eintraegen (`ci.yml`,
 * `release.yml`), und sie war am selben Tag schon blind: `fiskal-gate.yml`
 * und `db-suites.yml` schrieben beide `node-version: '20'` fest, und der
 * Waechter sah es nie. Das Fiskaltor ist dabei das WICHTIGSTE Tor im Baum,
 * es faehrt auf jeden Push die ganze Steuerkette gegen ein echtes Postgres,
 * und es tat das auf einer Laufzeit, die die Kasse gar nicht mitliefert.
 *
 * Hausklasse „ein Waechter mit Namensliste wird blind": sie erfasst nur, was
 * jemand eingetragen hat, und ein neues Fliessband traegt niemand nach.
 */
function alleFliessbaender(): string[] {
  const ordner = join(WURZEL, '.github/workflows');
  return readdirSync(ordner)
    .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
    .map((n) => `.github/workflows/${n}`)
    .sort();
}

/**
 * Jede Stelle, die eine Node-Fassung als ZAHL festschreibt statt `.nvmrc` zu
 * lesen.
 *
 * Absichtlich strukturell und nicht als Zahlenvergleich: waere hier nur
 * geprueft, ob die Zahl stimmt, koennte sie beim naechsten Anheben von `.nvmrc`
 * wieder auseinanderlaufen und muesste erneut von Hand nachgezogen werden. Wer
 * `node-version-file: .nvmrc` schreibt, KANN nicht mehr driften.
 */
function festgeschriebeneFassungen(): Array<{ datei: string; zeile: number; text: string }> {
  const treffer: Array<{ datei: string; zeile: number; text: string }> = [];
  for (const datei of alleFliessbaender()) {
    const zeilen = readFileSync(join(WURZEL, datei), 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      // `node-version-file:` ist der gewollte Fall und darf nicht mittreffen.
      if (/^\s*node-version\s*:/.test(z)) {
        treffer.push({ datei, zeile: i + 1, text: z.trim() });
      }
    });
  }
  return treffer;
}

describe('⛔ Der Pruefstand faehrt dieselbe Laufzeit wie die ausgelieferte Kasse', () => {
  it('die Freigabe legt ueberhaupt eine Laufzeit ins Buendel', () => {
    // Ein Waechter ohne Messpunkt ist still gruen. Findet er nichts mehr,
    // wurde der Laeufer umgebaut, dann gehoert er mit umgebaut.
    expect(
      ausgelieferteFassungen().length,
      'In `release.yml` steht kein `node-vX.Y.Z` mehr. Entweder liefert die ' +
        'Kasse ihre Laufzeit nicht mehr selbst mit, oder der Laeufer heisst ' +
        'anders, beides muss hier nachgezogen werden.',
    ).toBeGreaterThan(0);
  });

  it('sie legt GENAU EINE Fassung ins Buendel, nicht zwei', () => {
    // Zwei Fassungen im selben Buendel hiessen: zwei Plattformen laufen auf
    // verschiedenen Laufzeiten, und ein Fehler zeigt sich nur auf einer.
    const fassungen = ausgelieferteFassungen();
    expect(
      fassungen,
      `Die Freigabe laedt mehrere Node-Fassungen: ${fassungen.join(', ')}. ` +
        'Dann kann `.nvmrc` gar nicht zu allen passen.',
    ).toHaveLength(1);
  });

  it('⛔ kein Fliessband schreibt eine Node-Fassung als Zahl fest', () => {
    // ── DER ZWEITE BEFUND VOM 13.08.2026 ────────────────────────────────────
    //
    // Der Waechter darueber verglich `.nvmrc` mit dem Beipack und war gruen.
    // In derselben Datei stand aber `node-version: '20'`: die Freigabe BAUTE
    // das ausgelieferte Programm mit einer dritten Laufzeit, gegen die niemand
    // geprueft hatte. Der erste Waechter suchte nur nach `node-vX.Y.Z` und sah
    // die Zeile nie. Hausklasse „der halbe Fix an derselben Ampel".
    //
    // Gemessen wird deshalb die STRUKTUR, nicht die Zahl: wer `.nvmrc` liest,
    // kann gar nicht mehr abdriften.
    const feste = festgeschriebeneFassungen();
    expect(
      feste.map((f) => `${f.datei}:${f.zeile}  ${f.text}`),
      'Hier steht eine Node-Fassung als Zahl statt `node-version-file: .nvmrc`. ' +
        'Eine zweite Stelle mit derselben Angabe ist eine zweite Wahrheit, und ' +
        'sie laeuft frueher oder spaeter auseinander. Am 13.08.2026 baute die ' +
        'Freigabe damit das AUSGELIEFERTE Programm auf Node 20, waehrend die ' +
        'Kasse Node 22.14.0 mitliefert und der Pruefstand eine dritte Fassung ' +
        'fuhr. Bitte `node-version-file: .nvmrc` benutzen.',
    ).toEqual([]);
  });

  it('⛔ `.nvmrc` nennt genau diese Fassung', () => {
    const geliefert = ausgelieferteFassungen()[0];
    expect(
      nvmrcFassung(),
      `\`.nvmrc\` steht auf ${nvmrcFassung()}, die Kasse liefert aber ` +
        `Node ${geliefert} mit. Dann prueft jeder Lauf ein Programm, das es ` +
        'im Betrieb nicht gibt: er meldet Fehler, die dort keine sind, und ' +
        'uebersieht welche, die es sind. Genau daran starben am 13.08.2026 ' +
        'sieben Pruefdateien der Kasse mit `No such built-in module: ' +
        'node:sqlite`, das gibt es erst ab Node 22.5.',
    ).toBe(geliefert);
  });
});
