/**
 * Der Wächter gegen die fremde Lupe auf dem Bestätigen-Knopf.
 *
 * Am 31.07.2026 auf dem Schirm gesehen: die Anmeldung von Norns zeigte unter
 * dem Norns-Schriftzug einen Knopf mit einer Lupe. Die Lupe ist laut ihrem
 * eigenen Kopf „extracted from the warehouse-14-logo" — ein Wappen aus einem
 * anderen Haus. Und sie sagte dem Händler „suchen", während der Knopf eine
 * Anmeldung abschickte.
 *
 * Dieser Block wird von VIER Flächen getragen (Anmeldung, Gerätesperre,
 * Stufenabfrage, Sperre der Inhaber-App). Ein Rückfall hier ist deshalb nie
 * ein einzelner Fehler.
 *
 * Der Wächter liest die QUELLE, nicht das gebaute Paket: eine Kopie unter
 * `dist/` kann von der Quelle abweichen, und dann prüfte er das Falsche.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Der Pfad kommt aus dem Arbeitsverzeichnis, NICHT aus `import.meta.url`:
 * dieser Lauf steht in einer Browserumgebung, und dort ist `import.meta.url`
 * kein Dateipfad, sondern eine Adresse des Entwicklungsservers.
 */
const QUELLE = join(process.cwd(), 'src/components/PinPad.tsx');

/**
 * Kommentare weg, bevor gesucht wird. Sonst macht ausgerechnet die Erklärung,
 * WARUM die Lupe hier nicht sein darf, den Wächter grün oder rot aus dem
 * falschen Grund.
 */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('PinPad trägt keine fremde Marke', () => {
  it('findet die Quelle überhaupt', () => {
    // Ohne diesen Satz wäre ein falscher Pfad ein Absturz statt eines Befundes,
    // oder — schlimmer — eine leere Datei, gegen die jede Suche grün ist.
    expect(existsSync(QUELLE), `nicht gefunden: ${QUELLE}`).toBe(true);
    expect(readFileSync(QUELLE, 'utf8').length).toBeGreaterThan(500);
  });

  const rumpf = ohneKommentare(readFileSync(QUELLE, 'utf8'));

  it('holt die Warehouse14-Lupe nicht herein', () => {
    expect(rumpf).not.toMatch(/MagnifierIcon/);
  });

  it('setzt sie auch nicht als Bild in den Knopf', () => {
    expect(rumpf).not.toMatch(/<\s*MagnifierIcon/);
  });

  it('hängt überhaupt kein Bild an den Bestätigen-Knopf', () => {
    // `iconLeft` / `iconRight` sind der einzige Weg, wie ein Zeichen auf diesen
    // Knopf kommt. Wer eines anhängt, muss hier vorbei und begründen.
    expect(rumpf).not.toMatch(/icon(Left|Right)\s*=/);
  });

  it('lässt den Knopf sein Wort behalten', () => {
    // Die Gegenprobe zum Streichen: es darf nicht passieren, dass jemand die
    // Lupe entfernt UND dabei die Beschriftung mitnimmt. Dann stünde ein
    // leerer Knopf da, und der Wächter oben wäre trotzdem grün.
    expect(rumpf).toMatch(/>\s*OK\s*</);
  });

  /**
   * ⚠️ DIE FALLE, IN DIE ICH AM 31.07.2026 SELBST GETRETEN BIN.
   *
   * Die vier Sätze oben lasen die QUELLE und waren grün. Die Kasse benutzt
   * aber nicht die Quelle: `package.json` zeigt mit `main` auf
   * `./dist/index.js`. Ich hatte die Quelle geändert, das Paket NICHT neu
   * gebaut, die App gebaut, installiert — und auf dem Schirm sass die Lupe
   * weiter auf dem Knopf. Die gebaute Kopie war vierzehn Stunden alt.
   *
   * Ein Wächter, der nur die Quelle liest, ist gegen diesen Fehler blind.
   * Deshalb prüft dieser Satz die KOPIE, also genau das, was die Kasse lädt.
   *
   * Fehlt die Kopie ganz, ist das kein Grün: dann wurde nie gebaut, und die
   * Prüfung hätte nichts gesehen.
   */
  it('auch die GEBAUTE Kopie trägt die fremde Marke nicht', () => {
    const gebaut = join(process.cwd(), 'dist/components/PinPad.js');
    expect(existsSync(gebaut), `nicht gebaut: ${gebaut} — erst 'pnpm build'`).toBe(true);

    const kopie = readFileSync(gebaut, 'utf8');
    expect(kopie.length).toBeGreaterThan(200);
    expect(kopie, 'die gebaute Kopie holt die Warehouse14-Lupe herein').not.toMatch(
      /MagnifierIcon/,
    );
    expect(kopie, 'die gebaute Kopie hängt ein Bild an den Bestätigen-Knopf').not.toMatch(
      /icon(Left|Right)/,
    );
  });

  /**
   * Und der Satz, der die Ursache selbst benennt: eine Kopie, die ÄLTER ist
   * als die Quelle, ist eine Lüge, auch wenn ihr Inhalt gerade zufällig passt.
   */
  it('die Kopie ist nicht älter als die Quelle', () => {
    const gebaut = join(process.cwd(), 'dist/components/PinPad.js');
    expect(existsSync(gebaut)).toBe(true);
    expect(
      statSync(gebaut).mtimeMs,
      'die gebaute Kopie ist älter als die Quelle — die Kasse lädt alten Stand',
    ).toBeGreaterThanOrEqual(statSync(QUELLE).mtimeMs);
  });
});
