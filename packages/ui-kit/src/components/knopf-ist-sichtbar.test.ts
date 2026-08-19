/**
 * Ein Knopf muss ohne Berührung als Knopf zu erkennen sein.
 *
 * ── BASELS BEFUND VOM 04.08.2026 ───────────────────────────────────────────
 *
 * Wörtlich: „es gibt einen Text, den man drückt, und man erkennt ihn erst
 * beim Drücken." Er nannte als Beispiel den Griff für die Ankaufmarge.
 *
 * ── WAS DASTAND ────────────────────────────────────────────────────────────
 *
 * ⚠️ Der stille Knopf war vollständig durchsichtig, MIT durchsichtiger Kante:
 *
 *     background-color: transparent;
 *     border: 1px solid transparent;
 *
 * Erst beim Zeigen mit der Maus erschien ein Giltstrich. Am Tresen gibt es
 * keine Maus. Der Händler tippt auf einen Bildschirm und sieht Text, der wie
 * Text aussieht.
 *
 * Getroffen hat es die zweite Reihe in der ganzen Kasse: „Ankaufmarge je
 * Metall", „Kurs von Hand eintragen", „Abbrechen", „Zurück".
 *
 * ── WAS DIESER WÄCHTER FESTHÄLT ────────────────────────────────────────────
 *
 * 1. KEIN Rang hat eine durchsichtige Kante bei durchsichtigem Grund.
 * 2. Die vier Ränge sind voneinander unterscheidbar. Zwei gleich aussehende
 *    Knöpfe nebeneinander sind eine Fläche ohne Rangfolge.
 * 3. Die Ecke ist gerundet, wie Basel es verlangt hat.
 * 4. Jede benutzte Farbmarke gibt es wirklich. Eine `var()` ohne Rückfall,
 *    die es nicht gibt, verwirft die GANZE Deklaration, und der Knopf ist
 *    wieder unsichtbar. Genau diese Falle hat dieses Haus schon getroffen.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HIER, '../tokens.css'), 'utf8');

const RAENGE = ['primary', 'akzent', 'zweit', 'ghost', 'destructive'] as const;

/** Der Rumpf einer Rangregel, ohne die Zustände beim Zeigen. */
function regel(rang: string): string {
  const m = new RegExp(`\\.w14-button--${rang}\\s*\\{([^}]*)\\}`).exec(CSS);
  return m?.[1] ?? '';
}

describe('Ein Knopf sieht aus wie ein Knopf', () => {
  it('⛔ KEIN Rang ist durchsichtig auf durchsichtig', () => {
    // Der eigentliche Befund. Ein Knopf ohne Grund UND ohne Kante ist Text.
    for (const rang of RAENGE) {
      const r = regel(rang);
      expect(r.length, `${rang}: keine Regel gefunden`).toBeGreaterThan(0);
      const grundlos = /background-color:\s*transparent/.test(r);
      const kantenlos = /border:[^;]*transparent/.test(r);
      expect(grundlos && kantenlos, `${rang} ist unsichtbar, bis man ihn berührt`).toBe(false);
    }
  });

  it('⛔ die vier Ränge sind voneinander unterscheidbar', () => {
    // Zwei gleich aussehende Knöpfe nebeneinander sind keine Rangfolge. Der
    // erste Entwurf des zweiten Knopfes war Tinte GEFÜLLT, genau wie der
    // Hauptknopf; am Bildschirm waren es zwei schwarze Klötze. Gesehen, nicht
    // gerechnet, und danach zum Umriss geändert.
    const bilder = RAENGE.map((r) => {
      const t = regel(r);
      const grund = /background-color:\s*([^;]+)/.exec(t)?.[1]?.trim() ?? '';
      const kante = /border:\s*([^;]+)/.exec(t)?.[1]?.trim() ?? '';
      return `${grund}|${kante}`;
    });
    expect(new Set(bilder).size, 'zwei Ränge sehen gleich aus').toBe(RAENGE.length);
  });

  it('⛔ jede Farbmarke gibt es wirklich', () => {
    // ⚠️ Eine `var()` ohne Rückfall, die nirgends definiert ist, verwirft die
    // GANZE Deklaration. Der Knopf wäre wieder unsichtbar, und nichts würde
    // rot. Genau so ist mir `--w14-rule-stark` heute durchgerutscht.
    for (const rang of RAENGE) {
      for (const [, marke] of regel(rang).matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        expect(CSS, `${rang}: die Marke ${marke} gibt es nicht`).toContain(`${marke}:`);
      }
    }
  });

  it('⛔ gefuelltes Rot heisst TUN, umrissenes Rot heisst RUECKGAENGIG', () => {
    // Der Akzent (Weinrot) und die Ruecknahme (Siegelrot) sind beide rot.
    // Auseinanderzuhalten sind sie nur an der Fuellung. Faellt das, storniert
    // der Kassierer, wo er kassieren wollte.
    const akzent = regel('akzent');
    const zurueck = regel('destructive');
    expect(akzent, 'der Akzentknopf ist nicht gefuellt').toMatch(
      /background-color:\s*var\(--w14-accent\)/,
    );
    expect(zurueck, 'die Ruecknahme ist gefuellt statt umrissen').toMatch(
      /background-color:\s*transparent/,
    );
    expect(zurueck, 'die Ruecknahme hat keinen roten Umriss').toMatch(
      /border:[^;]*var\(--w14-wax-red\)/,
    );
  });


  it('⛔ ein EINGABEFELD traegt nie die Zierlinie', () => {
    // ── DER FUND VOM 04.08.2026 ─────────────────────────────────────────────
    //
    // ⚠️ Die Zifferntafel zeichnete ihre Felder mit `--w14-rule`. Auf dem
    // Schirm gemessen: 1,05 zu 1 gegen den Karton. WCAG 1.4.11 verlangt 3 zu
    // 1. Der Haendler tippte in ein Feld, das er nicht sah.
    //
    // Die Marke selbst sagt es: `--w14-feldlinie` ist „der Unterstrich von
    // Eingabefeldern, nie die Zierlinie". Der Quelltext hielt sich nicht
    // daran, und niemand merkte es, weil beide Namen plausibel klingen.
    //
    // Dieser Satz liest die Bauteile, nicht die Marken: wo ein Feld gezeichnet
    // wird, darf `--w14-rule` nicht stehen.
    const eingabefelder = ['PinPad.tsx', 'Input.tsx', 'Textarea.tsx', 'Select.tsx'];
    for (const datei of eingabefelder) {
      const pfad = resolve(HIER, datei);
      if (!existsSync(pfad)) continue;
      const inhalt = readFileSync(pfad, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(inhalt, `${datei}: ein Eingabefeld traegt die Zierlinie`).not.toMatch(
        /border[A-Za-z]*:\s*['"`][^'"`]*var\(--w14-rule\)/,
      );
    }
  });

  it('die Ecke ist gerundet, nicht scharf', () => {
    const m = /--w14-radius-button:\s*([0-9]+)px/.exec(CSS);
    expect(m, 'kein Knopfradius definiert').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(8);
  });

  it('der stille Knopf traegt eine Kante, die man SIEHT', () => {
    // `--w14-rule` ist ein Haar für Trennlinien und verschwindet auf
    // Pergament. Eine Knopfkante muss aus einem Meter Abstand sichtbar sein.
    const r = regel('ghost');
    expect(r).toMatch(/border:\s*1px solid var\(--w14-ink-faded\)/);
  });
});
