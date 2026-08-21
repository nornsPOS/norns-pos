// @vitest-environment node
/**
 * ⛔ Die Kasse fuellt ihr Fenster — kein geerbter Rand, kein leeres Scrollen
 *
 * ── DER BEFUND VOM 21.08.2026, AM LAUFENDEN BILDSCHIRM GEMESSEN ───────────
 *
 *     document.documentElement.scrollHeight  916
 *     window.innerHeight                     900
 *     Ueberschuss                             16
 *
 * Der Grund war die Vorgabe des Browsers, `body { margin: 8px }`, die dieser
 * Grundriss nie zurueckgesetzt hat. Zwei Folgen, beide taeglich:
 *
 *   • JEDE Flaeche liess sich um 16 px scrollen, ohne dass es etwas zu sehen
 *     gab. Auf einem Tresengeraet mit Finger federt dabei die ganze Seite bei
 *     jeder Beruehrung -- der Eindruck von „billig", ohne dass jemand sagen
 *     koennte, woran es liegt.
 *   • Kopfleiste und Kursstreifen sind auf VOLLE Breite gebaut und lagen
 *     trotzdem 8 px vom Fensterrand ab. Nur weil der Rand zufaellig die Farbe
 *     des Grundes trug, ist es keinem aufgefallen.
 *
 * Und jede `100dvh`-Rechnung im Haus war um 16 px zu gross.
 *
 * ── WARUM EIN WAECHTER FUER EINE ZEILE ────────────────────────────────────
 *
 * Weil genau diese Zeile still verschwindet: sie steht in einem Block, den
 * jeder anfasst, der eine Schriftart oder eine Farbe aendert, und ihr Fehlen
 * sieht man nicht -- man spuert es nur.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * ⚠️ OHNE KOMMENTARE gelesen, und das ist keine Feinheit: der Kommentar im
 * Block DARUNTER zitiert `body { margin: 8px }` als das, was hier schiefging.
 * Wer roh sucht, findet dessen schliessende Klammer zuerst und liest einen
 * Rumpf, der beim Zitat endet. Genau daran ist dieser Waechter im ersten
 * Anlauf gescheitert -- dieselbe Falle wie beim Filter-Waechter am 20.08.
 */
const TOKENS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Der Rumpf des `html, body`-Blocks. */
function grundriss(): string {
  const i = TOKENS.indexOf('html,\nbody {');
  expect(i, 'der Block `html, body` fehlt ganz').toBeGreaterThan(-1);
  return TOKENS.slice(i, TOKENS.indexOf('}', i));
}

describe('⛔ Die Kasse fuellt ihr Fenster', () => {
  it('⛔ der Rand des Browsers ist zurueckgesetzt', () => {
    expect(
      grundriss(),
      'Ohne `margin: 0` erbt der body die 8 px des Browsers: jede Flaeche ' +
        'scrollt 16 px ins Leere und die Kasse sitzt eingerueckt in ihrem Fenster.',
    ).toMatch(/\bmargin:\s*0\b/);
  });

  it('und der Grund traegt eine Farbe, damit der Rand nie durchscheint', () => {
    expect(grundriss()).toMatch(/background-color:\s*var\(--w14-parchment\)/);
  });
});
