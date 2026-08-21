// @vitest-environment node
/**
 * ⛔ Der Papierschleier folgt JEDER Rundung
 *
 * ── DER BEFUND VOM 21.08.2026, VON BASEL AM TAGBILD GESEHEN ───────────────
 *
 * Er schickte einen Abzug einer Kartenecke: an der runden Ecke lugte eine
 * ECKIGE Fläche hervor. Gemessen an der laufenden Anmeldekarte:
 *
 *     Karte    border-radius  18px
 *     Rauschen border-radius   0px
 *
 * `.w14-paper-noise::before` legte sein Rauschquadrat über jede Karte und
 * malte an allen vier Ecken über den Grund hinaus. Im NACHTBILD unsichtbar
 * (dunkles Rauschen auf dunklem Grund) — im TAGBILD eine dunkle Stufe an
 * jeder Ecke jeder Karte im ganzen Haus.
 *
 * ── WARUM `inherit` UND NICHT EINE ZAHL ───────────────────────────────────
 *
 * Eine feste Zahl hier wäre eine zweite Wahrheit neben `--w14-radius-card`
 * und liefe auseinander, sobald jemand die Rundung ändert. `inherit` folgt
 * dem Element, auf dem die Klasse sitzt — auch einer künftigen Rundung, auch
 * einer anderen je Bauteil. EINE Zeile heilt jede Ecke im Haus.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Ohne Kommentare: der Kopf oben ZITIERT das Problem. */
const TOKENS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Der Rumpf des Schleier-Blocks. */
function schleier(): string {
  const i = TOKENS.indexOf('.w14-paper-noise::before');
  expect(i, 'der Schleier-Block fehlt ganz').toBeGreaterThan(-1);
  return TOKENS.slice(i, TOKENS.indexOf('}', i));
}

describe('⛔ Der Papierschleier folgt der Rundung', () => {
  it('⛔ er erbt die Rundung seines Trägers', () => {
    expect(
      schleier(),
      'Ohne `border-radius: inherit` liegt ein eckiges Rauschquadrat über ' +
        'jeder runden Karte und malt an allen vier Ecken über den Grund hinaus.',
    ).toMatch(/border-radius:\s*inherit/);
  });

  it('und er bleibt ein Schleier: absolut, deckend, ohne Zeigerfang', () => {
    const s = schleier();
    expect(s).toMatch(/position:\s*absolute/);
    expect(s).toMatch(/inset:\s*0/);
    expect(s).toMatch(/pointer-events:\s*none/);
  });
});
