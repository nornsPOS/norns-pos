/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ DER KURSHOLER DARF DIE KASSE NICHT ERWÜRGEN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 22.08.2026 ─────────────────────────────────────────────
 *
 * Der Dienst öffnet an SIEBEN Stellen eine Datenbankverbindung. Genau EINE
 * trug eine Zeitgrenze — die Sicherung, und dort steht der gemessene Grund
 * dabei: „Ohne Zeitgrenze hängt `connect()` gegen einen schweigenden
 * Zuhörer."
 *
 * Derselbe Zuhörer sitzt im Kursholer. Der Unterschied ist der Wecker: die
 * Sicherung läuft, wenn der Händler sie drückt, der Kursholer alle FÜNF
 * MINUTEN, den ganzen Tag.
 *
 * Zwei Folgen, und die zweite ist die schlimmere:
 *
 *   1. Jeder hängende Lauf lässt seinen Client stehen. Das `finally`, das ihn
 *      schliesst, wird nie erreicht — dahin kommt nur, wer aus `connect()`
 *      zurückkehrt. `setInterval` legt alle fünf Minuten den nächsten
 *      obendrauf. Am Ende steht `sorry, too many clients already`, und dann
 *      bekommt die KASSE keine Verbindung mehr: der Kursholer hätte den
 *      Verkauf erwürgt.
 *
 *   2. ⚠️ Und die eine Meldung, die dem Händler sagt, dass keine Kurse mehr
 *      kommen, hängt an einem GEWORFENEN Fehler:
 *
 *          catch (fehler) { melde('Kurse nicht erreichbar …') }
 *
 *      Wer hängt, wirft nicht. Bei einem Hänger käme der Satz NIE — die
 *      Kurse frören still ein, und die eigens dafür gebaute Auskunft
 *      schwiege. Das ist die Hausklasse „still statt falsch".
 *
 * ── ⚠️ WAS HIER BEWUSST NICHT GEÄNDERT WURDE ──────────────────────────────
 *
 * Die anderen fünf Stellen ohne Frist liegen alle auf dem STARTWEG (Probe,
 * Schema, Verwaltung, Saat). Sie laufen einmal, und ein Hänger dort ist
 * sichtbar: die Kasse meldet nie `NORNS_BEREIT`, der Händler startet neu.
 * Eine Frist dorthin zu setzen, hiesse einem langsam anlaufenden Postgres
 * eine Grenze zu ziehen, die niemand gemessen hat — das wäre geraten.
 * Gerichtet wurde die Stelle, die WIEDERKEHRT.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const API = resolve(HIER, '../..');
const WURZEL = resolve(API, '../..');

const ABSCHRIFTEN = [
  resolve(API, 'sidecar/norns-sidecar.mjs'),
  resolve(WURZEL, 'apps/tauri-pos/src-tauri/resources/sidecar/norns-sidecar.mjs'),
];
const BUENDEL = resolve(WURZEL, 'apps/tauri-pos/src-tauri/resources/sidecar/start.mjs');

/** Der Rumpf von `kursZiehen`, bis zur ersten Abfrage. */
function kursholerKopf(quelle: string): string {
  const ab = quelle.indexOf('async function kursZiehen(');
  expect(ab, '`kursZiehen` steht nicht mehr im Dienst').toBeGreaterThan(-1);
  return quelle.slice(ab, ab + 2500);
}

describe('⛔ Der Kursholer erwürgt die Kasse nicht', () => {
  it.each(ABSCHRIFTEN)('%s: die wiederkehrende Verbindung hat eine Frist', (pfad) => {
    expect(
      kursholerKopf(readFileSync(pfad, 'utf8')),
      'Die Verbindung des Kursholers hat keine `connectionTimeoutMillis`. ' +
        'Hängt sie, wird das `finally { db.end() }` nie erreicht, der Wecker ' +
        'legt alle fünf Minuten einen weiteren Client obendrauf, und am Ende ' +
        'bekommt die Kasse selbst keine Verbindung mehr.',
    ).toMatch(/connectionTimeoutMillis:\s*[0-9_]+/);
  });

  it.each(ABSCHRIFTEN)('%s: es läuft höchstens ein Kurslauf', (pfad) => {
    const quelle = readFileSync(pfad, 'utf8');
    expect(
      quelle,
      '`setInterval` fragt nicht, ob der vorige Lauf fertig ist. Ohne diesen ' +
        'Riegel stapeln sich hängende Läufe, bis Postgres keine Verbindung ' +
        'mehr vergibt.',
    ).toContain('if (kursLaeuft) return;');
    expect(
      quelle,
      'Der Riegel wird nie zurückgesetzt: nach dem ersten Fehler liefe der ' +
        'Kursholer für immer nicht mehr. Er gehört in ein `finally`.',
    ).toMatch(/finally\s*\{\s*kursLaeuft = false;/);
  });

  it('⛔ und das AUSGELIEFERTE Bündel trägt beides', () => {
    /*
     * Der Dienst ist eine vorgebaute Datei. Wer die Quelle ändert und nicht
     * neu bündelt, ändert an der Kasse GAR NICHTS — die Falle, in die dieses
     * Haus schon zweimal gelaufen ist.
     */
    expect(existsSync(BUENDEL), `${BUENDEL} fehlt — \`node scripts/buendle-motor.mjs\`.`).toBe(
      true,
    );
    const gebaut = readFileSync(BUENDEL, 'utf8');
    expect(kursholerKopf(gebaut)).toMatch(/connectionTimeoutMillis:\s*[0-9_]+/);
    /*
     * ⚠️ Im Bündel steht der Riegel NICHT wörtlich: esbuild zieht die
     * Leerräume zusammen und macht aus `if (kursLaeuft) return;` ein
     * `if(kursLaeuft)return;`. Der erste Entwurf suchte wörtlich und meldete
     * ein sauber gebautes Bündel als ungebündelt. Gesucht wird deshalb das
     * MUSTER, in beiden Schreibweisen.
     */
    expect(
      gebaut,
      'Die Quelle trägt den Riegel, das Bündel nicht. Auf der Kasse läuft das ' +
        'Bündel. Neu bündeln: `node scripts/buendle-motor.mjs`.',
    ).toMatch(/if\s*\(\s*kursLaeuft\s*\)\s*return/);
  });
});
