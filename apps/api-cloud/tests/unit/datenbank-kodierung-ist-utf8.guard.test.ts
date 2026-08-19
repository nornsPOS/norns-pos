/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⛔ Die Datenbank wird IMMER als UTF8 angelegt, egal was Windows meint
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 10.08.2026, AUF BASELS WINDOWS-RECHNER ───────────────
 *
 * Die Kasse startete nicht. Auf dem Bildschirm, wörtlich:
 *
 *     ABBRUCH: character with byte sequence 0xe2 0x94 0x80 in encoding
 *     "UTF8" has no equivalent in encoding "WIN1252"
 *
 * `0xe2 0x94 0x80` ist `─`, der Zeichenstrich aus den Kommentarköpfen der
 * Wanderungen. Der eigentliche Fehler steckt eine Ebene tiefer: `initdb`
 * übernimmt ohne Anweisung die Sprachumgebung des Rechners, und auf einem
 * deutschen Windows heisst das Kodierung WIN1252. Die Wanderungen sind
 * UTF-8; beim ersten `─` bricht die Umsetzung ab, und die Kasse steht.
 *
 * ── ⚠️ WARUM KEIN FLIESSBAND DAS JE GEFANGEN HAT ────────────────────────
 *
 * Jeder Läufer (Ubuntu, macOS) trägt eine UTF-8-Umgebung, dort wählt
 * `initdb` von allein UTF8. Der Fehler existiert NUR auf dem Rechner des
 * Händlers. Ein Verhalten, das von der Umgebung des Geräts abhängt, ist
 * dieselbe Klasse wie ein erfundener Vorgabewert: es sieht überall gut aus,
 * ausser genau dort, wo es zählt.
 *
 * Deshalb wird die Kodierung jetzt FESTGENAGELT: jede Anlage des
 * Datenverzeichnisses sagt `--encoding=UTF8` ausdrücklich dazu. Postgres
 * erlaubt auf Windows UTF8 mit jeder Sprachumgebung; die deutsche
 * Sortierung und Gross-Klein-Behandlung bleiben erhalten.
 *
 * ── UND DER ZWEITE TEIL: EIN SCHON FALSCH ANGELEGTES VERZEICHNIS ────────
 *
 * Auf dem betroffenen Rechner LIEGT bereits ein WIN1252-Verzeichnis. Beim
 * nächsten Start wird nicht neu angelegt, also träfe derselbe Fehler wieder.
 * Der Motor muss die Kodierung beim Start MESSEN und, wenn sie falsch ist
 * und das Verzeichnis nachweislich KEINEN Beleg trägt, es BEISEITELEGEN
 * (umbenennen, nie löschen) und neu anlegen. Trägt es Belege, bricht er mit
 * einer ehrlichen Meldung ab, statt Daten anzufassen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const SIDECAR = join(HIER, '../../sidecar/norns-sidecar.mjs');

/**
 * ⚠️ Gemessen wird der GEBRAUCH, nicht die Erwähnung: Kommentarzeilen
 * fliegen raus, bevor gezählt wird. Sonst machte dieser Kommentarkopf hier
 * oder einer im Sidecar den Wächter grün, ohne dass eine Zeile Code steht.
 */
function code(): string {
  return readFileSync(SIDECAR, 'utf8')
    .split('\n')
    .filter((z) => {
      const t = z.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('⛔ initdb bekommt die Kodierung gesagt, statt Windows zu fragen', () => {
  it('⛔ JEDE Anlage des Datenverzeichnisses erzwingt UTF8', () => {
    const q = code();

    const anlagen = q.match(/new EmbeddedPostgres\(/g)?.length ?? 0;
    expect(anlagen, 'keine EmbeddedPostgres-Anlage gefunden — der Pfad stimmt nicht').toBeGreaterThan(0);

    const mitKodierung = q.match(/--encoding=UTF8/g)?.length ?? 0;
    expect(
      mitKodierung,
      `${anlagen} Anlagen des Datenverzeichnisses, aber nur ${mitKodierung} sagen ` +
        `--encoding=UTF8. Auf einem deutschen Windows waehlt initdb sonst WIN1252, ` +
        `und die erste Wanderung mit einem Zeichenstrich bricht die Kasse beim Start.`,
    ).toBeGreaterThanOrEqual(anlagen);

    // Und zwar als initdbFlags, nicht irgendwo im Text.
    expect(q, 'die Kodierung steht nicht in initdbFlags').toMatch(
      /initdbFlags:\s*\[[^\]]*--encoding=UTF8/,
    );
  });

  it('⛔ und ein FALSCH angelegtes Verzeichnis wird beim Start erkannt', () => {
    const q = code();
    // Der Heilungsweg: die Kodierung wird gemessen, nicht angenommen.
    expect(q, 'niemand misst server_encoding beim Start').toMatch(/server_encoding/);
    /*
     * Beiseitelegen heisst umbenennen. Ein rm oder unlink auf das
     * Datenverzeichnis waere genau das Loeschen, das das Haus verbietet.
     *
     * ⚠️ Gemessen wird der AUFRUF auf das Datenverzeichnis, nicht das Wort:
     * die erste Fassung dieses Satzes traf `renameSync` in der EINFUHRZEILE
     * und blieb gruen, als der eigentliche Aufruf sabotiert war. Ein
     * Waechter, den die Einfuhr sattmacht, misst die Erwaehnung statt den
     * Gebrauch.
     */
    expect(q, 'der Heilungsweg legt nicht beiseite (kein renameSync-Aufruf auf PGORT)').toMatch(
      /renameSync\(PGORT,/,
    );
  });
});
