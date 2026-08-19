/**
 * Der Wächter über die Marke des Hauses.
 *
 * ── WARUM ES IHN GIBT (31.07.2026) ──────────────────────────────────────────
 *
 * Basel öffnete die Kasse und sah mitten auf der Fehlerfläche „Keine
 * Verbindung zum Server" ein Siegel mit der Ziffer **14** — dem Zeichen von
 * Warehouse14, in einem Programm, das Norns heisst.
 *
 * Es war kein vergessener Einzelfall. `Seal` hatte die Vorgabe `label = '14'`,
 * und dieses Siegel steht in 28 Dateien: Startbildschirm, Anmeldung,
 * Gerätesperre, Step-up. EINE Vorgabe goss die fremde Marke über das ganze
 * Programm.
 *
 * Dieser Wächter liest die QUELLE des Siegels, nicht die Bildschirme: dort
 * entsteht die Vorgabe, und dort muss sie stimmen.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const SIEGEL = join(HIER, '../../../../../packages/ui-kit/src/components/Seal.tsx');
const OEFFENTLICH = join(HIER, '../../../public');
const QUELLEN = join(HIER, '../..');

/** Kommentare weg: dieser Wächter misst Code, nicht Prosa. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('das Siegel trägt die Marke DIESES Hauses', () => {
  const quelle = ohneKommentare(readFileSync(SIEGEL, 'utf8'));

  it('nirgends steht die fremde Ziffer als Vorgabe', () => {
    // Genau die Form, die den Fehler gemacht hat: label = '14'
    expect(
      /label\s*=\s*['"]14['"]/.test(quelle),
      'Seal.tsx setzt wieder die Marke von Warehouse14 als Vorgabe',
    ).toBe(false);
  });

  it('die Vorgabe kommt aus EINER benannten Stelle', () => {
    // Ein hart hineingeschriebener Buchstabe wäre wieder derselbe Fehler,
    // nur mit anderem Zeichen: die Marke gehört an eine Stelle mit Namen.
    expect(quelle, 'die Marke muss eine benannte Konstante sein').toMatch(
      /const MARKE\s*=\s*['"][^'"]+['"]/,
    );
    expect(quelle, 'die Vorgabe muss aus MARKE kommen').toMatch(/label\s*=\s*MARKE/);
  });

  it('die Marke ist nicht die des anderen Hauses', () => {
    const treffer = quelle.match(/const MARKE\s*=\s*['"]([^'"]+)['"]/);
    expect(treffer, 'MARKE nicht gefunden').not.toBeNull();
    expect(treffer?.[1]).not.toBe('14');
  });
});

/**
 * ── DIE ZWEITE REGEL, UND WARUM SIE SPAETER KAM (31.07.2026) ────────────────
 *
 * Der Waechter oben lief GRUEN, waehrend die Anmeldeflaeche das vollstaendige
 * Wappen des fremden Hauses zeigte: 300 Pixel breit, Medaillon mit der Ziffer
 * 14, Schriftzug WAREHOUSE, Zeile ANTIQUITAETEN · BRIEFMARKEN · MUENZEN. Er
 * las eine einzige Quelldatei, `Seal.tsx`, und sah Bilder nie.
 *
 * Schlimmer: ein Textgrep haette es AUCH nicht gefunden. Die Datei war reine
 * Pfadgrafik, jeder Buchstabe zu Kurven ausgezogen; die Suche nach dem Wort
 * „WAREHOUSE" ergab null Treffer. Nur Rastern und Hinsehen entschied.
 *
 * Diese Regel kann kein Bild lesen. Sie tut das Naechstbeste und Belastbare:
 * sie verbietet, dass ueberhaupt eine Bilddatei mit diesem Namen im Programm
 * liegt oder von einer Flaeche gerufen wird. Was nicht da ist, kann nicht
 * gezeigt werden.
 */
describe('kein fremdes Wappen als Bilddatei', () => {
  it('die Wappendateien liegen nicht mehr im Programm', () => {
    for (const name of ['shop-logo.svg', 'shop-logo.png']) {
      expect(
        existsSync(join(OEFFENTLICH, name)),
        `${name} ist wieder da. Sie trug das Wappen von Warehouse14, und kein ` +
          'Textgrep kann das sehen: die Buchstaben sind zu Pfaden ausgezogen.',
      ).toBe(false);
    }
  });

  it('keine Flaeche ruft eine solche Bilddatei', () => {
    const suender: string[] = [];
    const gehen = (ort: string): void => {
      for (const e of readdirSync(ort, { withFileTypes: true })) {
        const pfad = join(ort, e.name);
        if (e.isDirectory()) gehen(pfad);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const text = readFileSync(pfad, 'utf8');
          // Nur echte Aufrufe, keine Kommentare: der Fix selbst erklaert sich
          // im Kommentar und darf den Waechter nicht ausloesen.
          const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
          if (/shop-logo\.(svg|png)/.test(code)) suender.push(e.name);
        }
      }
    };
    gehen(QUELLEN);
    expect(suender).toEqual([]);
  });
});
