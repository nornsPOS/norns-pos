/**
 * ⛔ DIE ANMELDUNG SAGT DEM KASSIERER DIE WAHRHEIT
 *
 * ── DER BEFUND VOM 12.08.2026, IN DER VORSCHAU BEGANGEN ──────────────────
 *
 * Die Kasse wurde geöffnet, während der Motor NICHT lief, und eine PIN
 * eingetippt. Am Tresen stand:
 *
 *     „Datensatz nicht gefunden."
 *
 * Der Kassierer hält damit sein KONTO für unbekannt und tippt die PIN noch
 * einmal, und noch einmal. Die wahre Lage ist eine ganz andere: die Kasse
 * erreicht ihren Motor nicht.
 *
 * ── WARUM DIE ALTE AUSKUNFT NICHT NUR UNFREUNDLICH, SONDERN UNMÖGLICH WAR ─
 *
 * `apps/api-cloud/src/routes/auth-pin.ts` wirft NIE `NOT_FOUND`. Ein
 * unbekannter Mensch bekommt dort mit Absicht `UnauthorizedError` („Invalid
 * PIN"), damit sich die Namensliste des Ladens nicht abfragen lässt. Ein 404
 * auf diesem Bildschirm kann deshalb NUR heissen: die Anmeldung des Motors
 * ist gar nicht erreichbar — er läuft noch nicht, oder das Programm ruft
 * einen Weg, den seine Fassung nicht kennt (Fassungsversatz nach einer
 * Aktualisierung).
 *
 * ── WAS DIESER WÄCHTER MISST ────────────────────────────────────────────
 *
 * Dass der NOT_FOUND-Zweig überhaupt existiert (sonst fiele er wieder auf
 * den allgemeinen Satz) und dass der gezeigte Satz die PIN ausdrücklich
 * ENTLASTET. Ohne diesen Halbsatz sucht der Kassierer den Fehler bei sich.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const ANMELDUNG = resolve(HIER, 'PinLogin.tsx');

/** Nur der Code, ohne Kommentare — der Wächter misst den Gebrauch. */
function ohneKommentare(inhalt: string): string {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((z) => !z.trim().startsWith('//'))
    .join('\n');
}

describe('⛔ die Anmeldung sagt die Wahrheit', () => {
  it('behandelt NOT_FOUND eigens, statt es auf den allgemeinen Satz fallen zu lassen', () => {
    const code = ohneKommentare(readFileSync(ANMELDUNG, 'utf8'));
    expect(
      code,
      'Ohne eigenen Zweig liest der Kassierer „Datensatz nicht gefunden." und hält ' +
        'sein Konto für unbekannt — dabei ist nur der Motor nicht erreichbar.',
    ).toContain("case 'NOT_FOUND':");
  });

  it('entlastet die PIN ausdrücklich und nennt den Weg', () => {
    const code = ohneKommentare(readFileSync(ANMELDUNG, 'utf8'));
    // Der Satz muss sagen, dass es NICHT an der PIN liegt ...
    expect(code, 'der Satz entlastet die PIN nicht').toMatch(/nicht an Ihrer PIN/);
    // ... und einen Weg nennen, nicht nur eine Absage.
    expect(code, 'der Satz nennt keinen Weg').toMatch(/neu starten/);
  });

  it('⚠️ und der irreführende Satz steht auf diesem Bildschirm nirgends', () => {
    const code = ohneKommentare(readFileSync(ANMELDUNG, 'utf8'));
    expect(code).not.toContain('Datensatz nicht gefunden');
  });
});
