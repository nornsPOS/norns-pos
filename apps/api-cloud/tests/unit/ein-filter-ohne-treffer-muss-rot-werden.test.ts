/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ EIN TOR, DAS NICHTS TUT UND TROTZDEM GRÜN MELDET
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 14.08.2026 ─────────────────────────────────────────────
 *
 * `pnpm --filter <name> <befehl>` gibt, wenn KEIN Paket auf den Namen passt,
 * eine Zeile aus und beendet sich mit **Rückgabewert 0**:
 *
 *     $ pnpm --filter "@norns/api-cloud..." build
 *     No projects matched the filters in "/Users/basel/norns-pos"
 *     $ echo $?
 *     0
 *
 * Gemessen am 14.08.2026 mit pnpm 9.15.0.
 *
 * Das Fiskaltor `fiskal-gate.yml` fährt DREIZEHN Schritte durch genau diese
 * Tür: die Paketbauten, die Typprüfung, die fiskale Kette und die
 * DATEV-Formatwächter. Bleibt nach einer Umbenennung ein einziger Filtername
 * alt stehen, dann baut das Tor null Pakete, fährt null fiskale Tests, und
 * meldet über dem empfindlichsten Code dieses Hauses **grün**.
 *
 * Kein Mensch sieht das. Ein grünes Häkchen sieht aus wie ein grünes Häkchen.
 *
 * ── WARUM DAS GERADE JETZT ZÄHLT ──────────────────────────────────────────
 *
 * Norns POS wird von warehouse14 getrennt, und dabei werden alle 17 Pakete
 * umbenannt. Das ist genau der Vorgang, der diesen Fehler auslöst. Er wäre
 * still eingetreten, und wir hätten wochenlang auf ein Tor vertraut, das
 * längst nichts mehr prüft.
 *
 * Es ist die Hausklasse „Prüfung, die ohne ihr Werkzeug still besteht".
 *
 * ── DIE HEILUNG ───────────────────────────────────────────────────────────
 *
 * pnpm kennt `--fail-if-no-match`. Gemessen, beide Richtungen:
 *
 *     pnpm --fail-if-no-match --filter "@norns/nichts"  → 1
 *     pnpm --fail-if-no-match --filter "@…/config"      → 0
 *
 * Am 14.08.2026 trug KEINER von 51 gefilterten Aufrufen dieses Haus die
 * Sicherung. Jetzt alle.
 *
 * ── WAS DIESER WÄCHTER MISST, UND WAS ER NICHT MISST ──────────────────────
 *
 * Er hat zwei Hälften, und die Reihenfolge ist Absicht:
 *
 *   1. Eine LEBENDE PROBE. Er ruft das echte `pnpm` in diesem echten
 *      Arbeitsbaum auf und misst den Rückgabewert. Ändert pnpm eines Tages
 *      sein Verhalten, fällt das hier auf und nicht beim Kunden.
 *
 *   2. Eine TEXTPRÜFUNG der Tordateien. Sie liest Text, und Text zu lesen ist
 *      normalerweise kein Beweis. Hier ist es einer, denn diese Dateien SIND
 *      das Ausgelieferte: die Werkbank führt genau diese Zeilen aus, es gibt
 *      keine gebaute Zwischenstufe, in der sie sich noch ändern könnten.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../../../..');

/** Die Dateien, deren Zeilen eine Werkbank oder eine Schale WIRKLICH ausführt. */
const TORDATEIEN = [
  '.github/workflows/ci.yml',
  '.github/workflows/fiskal-gate.yml',
  '.github/workflows/db-suites.yml',
  '.github/workflows/release.yml',
  // 14.08.2026: `infrastructure/ci/release.yml` stand hier und wurde mit der
  // Trennung von warehouse14 GELOESCHT (Server-Fliessband der fremden Firma).
  // Dieser Waechter hat das sofort gemeldet, statt still zu ueberspringen —
  // genau dafuer ist der harte Fehlerzweig da.
  'package.json',
];

/** Ein Name, den es in diesem Arbeitsbaum sicher nicht gibt. */
const GIBT_ES_NICHT = '@norns-pos/dieses-paket-existiert-nicht-14082026';

function pnpmRueckgabe(argumente: string[]): number {
  const lauf = spawnSync('pnpm', argumente, {
    cwd: WURZEL,
    encoding: 'utf8',
    timeout: 120_000,
  });
  // „null ist nicht grün": wenn pnpm gar nicht startet, ist das KEIN Beweis.
  if (lauf.error !== undefined) throw lauf.error;
  if (lauf.status === null) throw new Error('pnpm wurde abgebrochen, kein Rückgabewert');
  return lauf.status;
}

describe('⛔ Ein Filter ohne Treffer muss ROT werden', () => {
  it(
    '⛔ LEBENDE PROBE: ohne Sicherung schweigt pnpm, mit Sicherung fällt es',
    () => {
      /*
       * Das ist der Kern. Kein Textmuster, sondern das echte Werkzeug in
       * diesem echten Arbeitsbaum. Beide Richtungen, sonst beweist die eine
       * nichts über die andere.
       */
      const ohne = pnpmRueckgabe(['--filter', GIBT_ES_NICHT, 'exec', 'node', '-e', '0']);
      expect(
        ohne,
        'pnpm meldet einen leeren Filter nicht mehr still mit 0. Das ist eine ' +
          'gute Nachricht, aber dieser Wächter beschreibt dann eine Lage, die ' +
          'es nicht mehr gibt. Bitte den Kopf dieser Datei berichtigen.',
      ).toBe(0);

      const mit = pnpmRueckgabe([
        '--fail-if-no-match',
        '--filter',
        GIBT_ES_NICHT,
        'exec',
        'node',
        '-e',
        '0',
      ]);
      expect(
        mit,
        '`--fail-if-no-match` schützt NICHT mehr. Damit ist jede Sicherung in ' +
          'unseren Toren wertlos, und ein Tor kann wieder grün melden, ohne ' +
          'etwas getan zu haben.',
      ).not.toBe(0);
    },
    180_000,
  );

  it(
    '⛔ LEBENDE PROBE: und ein Filter, der TRIFFT, bleibt grün',
    () => {
      // Die Gegenprobe. Ohne sie könnte die Sicherung einfach alles rot machen.
      const echterName = JSON.parse(
        readFileSync(join(WURZEL, 'packages/config/package.json'), 'utf8'),
      ).name as string;
      expect(echterName.length, 'packages/config hat keinen Namen').toBeGreaterThan(0);

      const treffer = pnpmRueckgabe([
        '--fail-if-no-match',
        '--filter',
        echterName,
        'exec',
        'node',
        '-e',
        '0',
      ]);
      expect(
        treffer,
        `Die Sicherung macht auch den treffenden Filter "${echterName}" rot. ` +
          'Dann ist sie unbrauchbar und wird beim nächsten roten Tor wieder ' +
          'entfernt.',
      ).toBe(0);
    },
    180_000,
  );

  it('⛔ JEDER gefilterte Aufruf in einem Tor trägt die Sicherung', () => {
    const ungesichert: string[] = [];
    let gesehen = 0;

    for (const datei of TORDATEIEN) {
      const pfad = join(WURZEL, datei);
      let inhalt: string;
      try {
        inhalt = readFileSync(pfad, 'utf8');
      } catch {
        // Eine Tordatei, die es nicht mehr gibt, ist kein stiller Freifahrtschein.
        throw new Error(
          `Die Tordatei ${datei} fehlt. Entweder wurde sie umbenannt, dann ` +
            'gehört sie hier berichtigt, oder gelöscht, dann gehört sie hier raus. ' +
            'Stillschweigend überspringen wäre genau der Fehler, den dieser ' +
            'Wächter verhindern soll.',
        );
      }

      inhalt.split('\n').forEach((zeile, i) => {
        // Nur echte Aufrufe. Ein Kommentar über einen Aufruf ist kein Aufruf.
        const ohneKommentar = zeile.replace(/(^|\s)(#|\/\/).*$/, '');
        if (!/\bpnpm\b[^\n]*--filter\b/.test(ohneKommentar)) return;
        gesehen += 1;
        if (!ohneKommentar.includes('--fail-if-no-match')) {
          ungesichert.push(`${relative(WURZEL, pfad)}:${i + 1}  ${zeile.trim().slice(0, 96)}`);
        }
      });
    }

    // „null ist nicht grün": fände die Suche gar nichts, wäre alles trivial erfüllt.
    expect(
      gesehen,
      'Kein einziger gefilterter pnpm-Aufruf gefunden. Entweder hat sich die ' +
        'Schreibweise geändert, oder dieser Wächter sucht am falschen Ort. ' +
        'So oder so beweist er gerade nichts.',
    ).toBeGreaterThan(20);

    expect(
      ungesichert,
      'Diese Aufrufe laufen ohne `--fail-if-no-match`. Passt ihr Filtername ' +
        'eines Tages auf kein Paket mehr, tun sie NICHTS und melden trotzdem ' +
        'Erfolg. Beim Fiskaltor heisst das: null fiskale Tests gefahren, grünes ' +
        'Häkchen gesetzt.\n',
    ).toEqual([]);
  });

  it('⛔ und jeder gefilterte Aufruf zielt auf ein Skript, DAS ES GIBT', () => {
    /*
     * ── DIE ZWEITE HÄLFTE DERSELBEN LÜGE ────────────────────────────────
     *
     * `--fail-if-no-match` deckt nur den Fall, dass kein PAKET passt.
     * Passt das Paket, fehlt aber das SKRIPT, schweigt pnpm genauso:
     *
     *     $ pnpm --fail-if-no-match --filter @…/config build
     *     None of the selected packages has a "build" script
     *     $ echo $?
     *     0
     *
     * Gemessen am 14.08.2026. Genau so standen ZWEI tote Bauschritte im
     * Haus, einer davon als ERSTE Zeile des Fiskaltors, mit einem Kommentar
     * darüber, der sie für tragend erklärte. Sie taten nie etwas.
     */
    const skripte = new Map<string, Set<string>>();
    for (const ordner of ['apps', 'packages']) {
      const wurzel = join(WURZEL, ordner);
      for (const eintrag of readdirSync(wurzel, { withFileTypes: true })) {
        if (!eintrag.isDirectory()) continue;
        try {
          const pj = JSON.parse(
            readFileSync(join(wurzel, eintrag.name, 'package.json'), 'utf8'),
          ) as { name?: string; scripts?: Record<string, string> };
          if (pj.name !== undefined) skripte.set(pj.name, new Set(Object.keys(pj.scripts ?? {})));
        } catch {
          /* kein Paket in diesem Ordner */
        }
      }
    }
    expect(skripte.size, 'keine Pakete gefunden').toBeGreaterThan(10);

    // `exec`, `run`, `dlx`, `install`, `add` sind pnpm-Befehle, keine Skripte.
    const KEIN_SKRIPT = new Set(['exec', 'run', 'dlx', 'install', 'add', 'why', 'list']);
    const muster = /pnpm\s+(?:--fail-if-no-match\s+)?--filter\s+"?([@\w/.-]+)"?\s+([a-z][a-z0-9:-]*)/g;
    const leerlauf: string[] = [];
    let gezielt = 0;

    for (const datei of TORDATEIEN) {
      readFileSync(join(WURZEL, datei), 'utf8')
        .split('\n')
        .forEach((zeile, i) => {
          const ohneKommentar = zeile.replace(/(^|\s)(#|\/\/).*$/, '');
          for (const t of ohneKommentar.matchAll(muster)) {
            const paket = t[1] ?? '';
            const befehl = t[2] ?? '';
            if (KEIN_SKRIPT.has(befehl)) continue;
            const vorhanden = skripte.get(paket);
            if (vorhanden === undefined) {
              leerlauf.push(`${datei}:${i + 1}  Paket "${paket}" gibt es nicht`);
            } else if (!vorhanden.has(befehl)) {
              leerlauf.push(`${datei}:${i + 1}  ${paket} hat kein Skript "${befehl}"`);
            } else {
              gezielt += 1;
            }
          }
        });
    }

    // „null ist nicht grün".
    expect(gezielt, 'kein einziger treffender Aufruf gefunden').toBeGreaterThan(20);
    expect(
      leerlauf,
      'Diese Zeilen sehen aus wie Arbeitsschritte, tun aber NICHTS und melden ' +
        'trotzdem Erfolg, weil pnpm ein fehlendes Skript still übergeht. Eine ' +
        'solche Zeile stand als erster Bauschritt im Fiskaltor.\n',
    ).toEqual([]);
  });

  it('⛔ und das Fiskaltor ist wirklich dabei, mit allen seinen Schritten', () => {
    /*
     * Der Wächter oben prüft, was in seiner Liste steht. Wäre das Fiskaltor
     * versehentlich nicht in der Liste, bliebe er grün und schützte genau das
     * nicht, wofür er gebaut wurde.
     */
    expect(TORDATEIEN).toContain('.github/workflows/fiskal-gate.yml');
    const tor = readFileSync(join(WURZEL, '.github/workflows/fiskal-gate.yml'), 'utf8');
    const mitFilter = tor.split('\n').filter((z) => /\bpnpm\b[^\n]*--filter\b/.test(z));
    expect(
      mitFilter.length,
      'Das Fiskaltor fährt plötzlich keine gefilterten Schritte mehr. Das kann ' +
        'stimmen, gehört dann aber angesehen.',
    ).toBeGreaterThan(5);
    for (const z of mitFilter) {
      expect(z, `ungesicherter Schritt im FISKALTOR: ${z.trim()}`).toContain('--fail-if-no-match');
    }
  });
});
