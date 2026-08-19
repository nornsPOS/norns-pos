/**
 * ════════════════════════════════════════════════════════════════════════
 *  DER KOPF DER FREIGABE MUSS SAGEN, WAS SIE WIRKLICH BAUT
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * `release.yml` widersprach sich in den ersten acht Zeilen selbst:
 *
 *     Zeile 2      „nur Windows, siehe Matrix unten"
 *     Zeile 5 bis 8 „three native runners: macos-14, macos-13, windows-latest"
 *     die Matrix    windows-latest UND macos-14, kein Intel-Mac
 *
 * Drei Aussagen, drei verschiedene Antworten. Das ist keine Kosmetik: wer
 * sucht, warum ein Buendel fehlt, liest zuerst den Kopf. Ein Kopf, der etwas
 * anderes verspricht als die Matrix, schickt ihn in die falsche Richtung, und
 * im schlimmsten Fall wartet jemand auf ein Intel-Paket, das nie gebaut wird.
 *
 * Hausklasse „ein Dokument verspricht, was der Code nicht tut". Das Gegenmittel
 * dort war immer dasselbe: EINE Groesse, und ein Waechter in beide Richtungen.
 *
 * ── WAS DIESER WAECHTER MISST ──────────────────────────────────────────────
 *
 * Der Kopf traegt genau eine maschinenlesbare Zeile:
 *
 *     GEBAUT: windows-latest, macos-14
 *
 * Verglichen wird sie mit den `- platform:` Eintraegen der Matrix, und zwar in
 * BEIDE Richtungen: kein Laeufer darf gebaut werden, ohne oben zu stehen, und
 * keiner darf oben stehen, ohne gebaut zu werden. Die Reihenfolge ist egal,
 * denn sie traegt keine Bedeutung.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const FREIGABE = join(HIER, '../../../..', '.github/workflows/release.yml');

function quelle(): string {
  return readFileSync(FREIGABE, 'utf8');
}

/** Was der Kopf BEHAUPTET zu bauen. */
function laeuferLautKopf(): string[] {
  const treffer = /^#\s*GEBAUT:\s*(.+)$/m.exec(quelle());
  if (treffer === null) return [];
  return (treffer[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort();
}

/** Was die Matrix WIRKLICH baut. */
function laeuferLautMatrix(): string[] {
  const treffer = [...quelle().matchAll(/^\s*-\s*platform:\s*(\S+)\s*$/gm)].map(
    (m) => m[1] as string,
  );
  return [...new Set(treffer)].sort();
}

describe('⛔ Kopf und Matrix der Freigabe nennen dieselben Laeufer', () => {
  it('die Matrix baut ueberhaupt etwas', () => {
    // Ein Waechter ohne Messpunkt ist still gruen.
    expect(
      laeuferLautMatrix().length,
      'In `release.yml` steht kein einziges `- platform:` mehr. Entweder wurde ' +
        'die Matrix umgebaut, dann gehoert dieser Waechter mit umgebaut, oder ' +
        'die Freigabe baut nichts mehr.',
    ).toBeGreaterThan(0);
  });

  it('der Kopf traegt seine eine maschinenlesbare Zeile', () => {
    expect(
      laeuferLautKopf().length,
      'Im Kopf von `release.yml` fehlt die Zeile `# GEBAUT: ...`. Sie ist der ' +
        'einzige Ort, an dem der Kopf ueberpruefbar sagt, was gebaut wird. ' +
        'Ohne sie kann der Kopf wieder etwas anderes behaupten als die Matrix, ' +
        'und genau das war der Befund vom 13.08.2026.',
    ).toBeGreaterThan(0);
  });

  it('⛔ beide Listen sind gleich, in beide Richtungen', () => {
    const kopf = laeuferLautKopf();
    const matrix = laeuferLautMatrix();
    expect(
      kopf,
      `Der Kopf nennt [${kopf.join(', ')}], die Matrix baut [${matrix.join(', ')}]. ` +
        'Wer nach einem fehlenden Buendel sucht, liest zuerst den Kopf. Sagt er ' +
        'etwas anderes als die Matrix, sucht er an der falschen Stelle, oder er ' +
        'wartet auf ein Paket, das nie gebaut wird. Bitte die Zeile `# GEBAUT:` ' +
        'nachziehen, oder die Matrix, je nachdem was gewollt war.',
    ).toEqual(matrix);
  });
});
