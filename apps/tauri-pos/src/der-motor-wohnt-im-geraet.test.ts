/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Keine Abfrage schläft ein, weil das Haus nicht am Netz hängt
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 (an der laufenden Kasse gemessen) ────────────
 *
 * Die linke Spalte des Ankaufs war LEER — nur die Überschrift „Verkäufer".
 * Im Abfragespeicher stand:
 *
 *     status: 'pending'   fetchStatus: 'paused'   fehlversuche: 1
 *
 * react-query hatte den Wiederholungsversuch schlafen gelegt, weil sein
 * `onlineManager` die Anwendung für offline hielt. In demselben Augenblick
 * meldete `navigator.onLine` `true`, und der Motor lieferte die Metallkurse
 * weiter. Ein verirrtes `offline`-Ereignis genügt; zurück springt der
 * Manager erst bei einem `online`-Ereignis, das nie kommen muss.
 *
 * Für eine Kasse, deren Motor als Beiprogramm auf DEMSELBEN Gerät läuft und
 * die ausdrücklich OHNE Netz arbeitet, ist diese Frage falsch gestellt.
 *
 * ── WAS DIESER WÄCHTER HÄLT ────────────────────────────────────────────────
 *
 * Dass die Kasse ihre Abfragen nicht an einer Netzvermutung aufhängt. Wer
 * `networkMode` wieder herausnimmt, bekommt die leere Fläche zurück — und
 * sie ist am Tresen nicht als Fehler zu erkennen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const START = readFileSync(join(HIER, 'main.tsx'), 'utf8');

/** Der Block, in dem der Abfragespeicher gebaut wird. */
function speicherblock(): string {
  const a = START.indexOf('new QueryClient(');
  expect(a, 'Der Abfragespeicher wird nicht mehr in `main.tsx` gebaut').toBeGreaterThan(0);
  return START.slice(a, START.indexOf('});', a) + 3);
}

describe('⛔ Der Motor wohnt im Gerät', () => {
  const block = speicherblock();

  it('⛔ Abfragen laufen IMMER, statt auf ein vermutetes Netz zu warten', () => {
    expect(
      /queries:\s*\{[^}]*networkMode:\s*'always'/s.test(block),
      'Ohne `networkMode: always` legt react-query jede gescheiterte Abfrage ' +
        'schlafen, sobald es die Anwendung für offline hält — und Flächen, ' +
        'die nur `isLoading`/`isError`/`data` kennen, bleiben LEER.',
    ).toBe(true);
  });

  it('⛔ und Änderungen ebenso — eine schlafende Buchung ist schlimmer', () => {
    expect(/mutations:\s*\{[^}]*networkMode:\s*'always'/s.test(block)).toBe(true);
  });

  it('die Begründung steht dabei, nicht nur die Einstellung', () => {
    // Wer die Zeile eines Tages wieder herausnimmt, soll vorher lesen, was
    // sie gekostet hat.
    const vorher = START.slice(Math.max(0, START.indexOf('new QueryClient(') - 2200));
    expect(vorher).toContain('paused');
    expect(vorher).toContain('20.08.2026');
  });

  it('⛔ keine Fläche mit der Dreier-Verzweigung hängt an einer BEDINGTEN Abfrage', () => {
    /*
     * Warum das die zweite Hälfte der Antwort ist:
     *
     * `networkMode: 'always'` schliesst das Loch für jede EINGESCHALTETE
     * Abfrage — sie läuft, und sie endet in Daten oder in einem Fehler.
     * Offen bleibt genau ein Fall: eine Abfrage mit `enabled: false` steht
     * auf `pending` und fetcht NICHT. Dann ist `isLoading` falsch,
     * `isError` falsch, `data` leer — und eine Fläche, die nur diese drei
     * kennt, ist wieder stumm.
     *
     * Am 20.08.2026 gemessen: neun Flächen tragen die Dreier-Verzweigung,
     * und keine davon hat eine bedingte Abfrage. Das Loch ist also
     * geschlossen. Dieser Satz hält es geschlossen — wer einer dieser
     * Flächen ein `enabled:` gibt, muss `abfragestand` benutzen.
     */
    const flaechen = [
      'app/chrome/MetalTicker.tsx',
      'screens/werkstatt/DayControl.tsx',
      'screens/kasse/NextHourPanel.tsx',
      'screens/kasse/Kasse.tsx',
      'screens/verkauf/KaeuferPicker.tsx',
      'screens/verkauf/CatalogGrid.tsx',
      'screens/secondary/Tagebuch.tsx',
    ];
    const gefaehrdet: string[] = [];
    for (const f of flaechen) {
      const text = readFileSync(join(HIER, f), 'utf8');
      const dreier = text.includes('isLoading &&') && text.includes('isError &&');
      // Ein `enabled:` im Abfrage-Sinn, nicht das eines beliebigen Hakens.
      const bedingt = /useQuery\([\s\S]{0,600}?enabled:/.test(text);
      if (dreier && bedingt && !text.includes('abfragestand')) gefaehrdet.push(f);
    }
    expect(
      gefaehrdet,
      'Diese Fläche kennt nur isLoading/isError/data UND schaltet ihre ' +
        'Abfrage bedingt ab. In diesem Zustand zeigt sie NICHTS. ' +
        'Benutze `lib/abfragestand.ts`.',
    ).toEqual([]);
  });

  it('⛔ die Kasse besorgt ihre Haltbarkeit SELBST — sonst wäre die Zeile leichtsinnig', () => {
    // `networkMode: always` ist nur deshalb richtig, weil es eine eigene
    // Ausgangswarteschlange und einen eigenen Sicherungsschalter gibt.
    // Verschwänden die, wäre diese Einstellung ein Datenverlust.
    const kontext = readFileSync(join(HIER, 'lib/api-context.tsx'), 'utf8');
    expect(kontext).toContain('offlineQueueMiddleware');
    expect(kontext).toContain('circuitBreakerMiddleware');
  });
});
