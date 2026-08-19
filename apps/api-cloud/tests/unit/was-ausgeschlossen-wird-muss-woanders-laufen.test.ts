/**
 * ════════════════════════════════════════════════════════════════════════
 *  WAS EIN TESTSKRIPT AUSSCHLIESST, MUSS EIN TOR AUFFANGEN
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Drei Pakete schliessen in ihrem `test`-Skript Mappen aus. Das ist an sich
 * richtig: Integrationsstrecken brauchen Docker und Postgres und gehoeren
 * nicht in den schnellen Lauf. Falsch wird es, wenn NIEMAND sie danach faehrt.
 *
 *     apps/api-cloud   schliesst tests/integration aus
 *                      → aufgefangen von `fiskal-gate.yml` (push auf main,
 *                        kein continue-on-error). RICHTIG.
 *
 *     apps/worker      schliesst tests/integration aus
 *                      → aufgefangen von NIEMANDEM. Vier Dateien. Gemessen:
 *                        3 von 4 rot.
 *
 *     packages/db      schliesst tests/audit, tests/inventory-lock und
 *                      tests/migrations aus
 *                      → nur `db-suites.yml`, und das hat keinen push-
 *                        Ausloeser und traegt `continue-on-error`. 42 Dateien.
 *                        Gemessen: 17 von 43 rot.
 *
 * Zusammen sind das 46 Pruefdateien, die keinen einzigen Lauf aufhalten
 * koennen. Darunter die Bestandssperre, also der Riegel, der zwei Kassen
 * daran hindert, dasselbe Stueck Gold zu verkaufen. Der ist gesund und am
 * KOPF gemessen (21 von 21 gruen), und trotzdem stumm.
 *
 * ── WARUM DIESER WAECHTER EINE SPERRKLINKE IST UND KEIN ROTES TOR ──────────
 *
 * Weil die beiden Auslassungen NICHT an einem Tag zu schliessen sind: die
 * roten Dateien muessen erst einzeln eingeordnet werden (bei `packages/db` ist
 * das geschehen, Ergebnis: kein echter Defekt, die Tests frieren das Schema
 * bei Wanderung 9 ein). Ein Waechter, der sofort rot wird, waere entweder ein
 * Dauerrot, das man wegschaut, oder er zwaenge zu einem uebereilten Fix.
 *
 * Dieses Haus kennt dafuer die Sperrklinke (siehe
 * `scripts/doku-tote-verweise.txt`): der Altbestand steht NAMENTLICH da, mit
 * Datum und Messung, und er darf nur SCHRUMPFEN. Jede NEUE Auslassung wird
 * sofort rot.
 *
 * ⚠️ Wer hier etwas eintraegt, statt es zu beheben, macht genau den Fehler,
 * gegen den es diese Datei gibt. Die Liste ist ein Schuldschein, kein Ablass.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '../../../..');

/**
 * Der Altbestand vom 13.08.2026, namentlich und mit Messung.
 *
 * Schluessel ist `<paket> :: <ausgeschlossene Mappe>`. Er darf nur kuerzer
 * werden. Wer eine Zeile entfernt, weil das Tor jetzt steht, macht diesen
 * Waechter staerker; wer eine hinzufuegt, schwaecht ihn.
 */
const BEKANNTE_AUSLASSUNGEN: Record<string, string> = {
  'packages/db :: **/tests/audit/**':
    'Eine Datei. Nur `db-suites.yml`, das keinen push-Ausloeser hat und ' +
    '`continue-on-error` traegt.',
  'packages/db :: **/tests/inventory-lock/**':
    'Eine Datei, und sie ist GESUND: am Kopf gemessen (applyMigrations 9999), ' +
    '21 von 21 gruen. Sie bewacht den Riegel gegen den Doppelverkauf desselben ' +
    'Stuecks und kann trotzdem nichts aufhalten. Der billigste Gewinn dieser ' +
    'ganzen Liste.',
  'packages/db :: **/tests/migrations/**':
    '40 Dateien. Gemessen am 13.08.2026: 17 von 43 rot, adversarisch ' +
    'eingeordnet, KEIN echter Defekt. Sie frieren das Schema bei Wanderung 9 ' +
    'ein und fahren es mit Code vom Kopf an.',
};

/** Jedes Paket im Arbeitsbereich, gefegt statt aufgezaehlt. */
function allePakete(): Array<{ name: string; testSkript: string }> {
  const gefunden: Array<{ name: string; testSkript: string }> = [];
  for (const bereich of ['apps', 'packages']) {
    const wurzel = join(WURZEL, bereich);
    for (const eintrag of readdirSync(wurzel, { withFileTypes: true })) {
      if (!eintrag.isDirectory()) continue;
      const weg = join(wurzel, eintrag.name, 'package.json');
      let roh: string;
      try {
        roh = readFileSync(weg, 'utf8');
      } catch {
        continue;
      }
      const paket = JSON.parse(roh) as { scripts?: Record<string, string> };
      gefunden.push({
        name: `${bereich}/${eintrag.name}`,
        testSkript: paket.scripts?.test ?? '',
      });
    }
  }
  return gefunden;
}

/** Was der schnelle Lauf eines Pakets ausdruecklich weglaesst. */
function ausgeschlosseneMappen(testSkript: string): string[] {
  return [...testSkript.matchAll(/--exclude\s+'([^']+)'/g)].map((m) => m[1] as string);
}

/** Der Text aller Fliessbaender zusammen, um darin nach dem Auffangen zu suchen. */
function alleFliessbaender(): string {
  const ordner = join(WURZEL, '.github/workflows');
  return readdirSync(ordner)
    .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
    .map((n) => readFileSync(join(ordner, n), 'utf8'))
    .join('\n');
}

describe('⛔ Was ein Testskript ausschliesst, muss ein Tor auffangen', () => {
  const pakete = allePakete();
  const fliessbaender = alleFliessbaender();

  it('es gibt ueberhaupt Pakete zu messen', () => {
    // Ein Waechter ohne Messpunkt ist still gruen.
    expect(pakete.length, 'Kein einziges Paket gefunden.').toBeGreaterThan(5);
  });

  it('⛔ keine NEUE Auslassung ohne Tor', () => {
    const neue: string[] = [];
    for (const paket of pakete) {
      for (const mappe of ausgeschlosseneMappen(paket.testSkript)) {
        const schluessel = `${paket.name} :: ${mappe}`;
        if (schluessel in BEKANNTE_AUSLASSUNGEN) continue;

        // Faengt ein Fliessband es auf? Gemessen am NAMEN des Pakets
        // zusammen mit einem Laufbefehl fuer die Mappe, nicht an einer
        // Vermutung. `api-cloud` faellt hier heraus, weil `fiskal-gate.yml`
        // `vitest run -c vitest.integration.config.ts` in diesem Paket faehrt.
        const kurz = paket.name.split('/')[1] as string;
        const aufgefangen =
          new RegExp(`@norns/${kurz}[^\\n]*test:integration`).test(fliessbaender) ||
          new RegExp(`--filter @norns/${kurz}[^\\n]*vitest run`).test(fliessbaender) ||
          (paket.name === 'apps/api-cloud' &&
            /vitest\.integration\.config\.ts/.test(fliessbaender));

        if (!aufgefangen) neue.push(schluessel);
      }
    }

    expect(
      neue,
      'Hier schliesst ein Testskript eine Mappe aus, und KEIN Fliessband faehrt ' +
        'sie danach. Die Tests darin laufen dann nirgends: sie werden nie rot, ' +
        'und ein gruener Lauf meldet trotzdem einen Riegel, den niemand geprueft ' +
        'hat. Entweder ein Tor dafuer bauen, oder den Ausschluss entfernen. Der ' +
        'Altbestand steht namentlich in `BEKANNTE_AUSLASSUNGEN` in dieser Datei ' +
        'und darf nur SCHRUMPFEN, nicht wachsen.',
    ).toEqual([]);
  });

  it('⚠️ und der Altbestand ist noch echt (kein Eintrag fuer etwas, das es nicht mehr gibt)', () => {
    // Ein Schuldschein fuer eine Schuld, die getilgt ist, verdeckt den Blick
    // auf die uebrigen. Und er laesst die Liste laenger aussehen, als sie ist.
    const vorhanden = new Set<string>();
    for (const paket of pakete) {
      for (const mappe of ausgeschlosseneMappen(paket.testSkript)) {
        vorhanden.add(`${paket.name} :: ${mappe}`);
      }
    }
    const veraltet = Object.keys(BEKANNTE_AUSLASSUNGEN).filter((k) => !vorhanden.has(k));
    expect(
      veraltet,
      'Diese Eintraege in `BEKANNTE_AUSLASSUNGEN` beschreiben einen Ausschluss, ' +
        'den es nicht mehr gibt. Wenn das Tor jetzt steht: schoen, bitte die ' +
        'Zeile loeschen. Die Sperrklinke soll SCHRUMPFEN.',
    ).toEqual([]);
  });
});
