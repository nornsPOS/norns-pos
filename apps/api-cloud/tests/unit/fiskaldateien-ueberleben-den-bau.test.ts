/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ALLE PRÜFUNGEN GRÜN, DAS ABBILD KAPUTT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `tsc` übersetzt TypeScript und rührt nichts anderes an. `index.xml` und die
 * DTD blieben deshalb unter `src/` liegen; im gebauten Abbild fehlten sie.
 *
 * Am Simulationsmandanten gegen ein echtes Abbild gemessen:
 *
 *     GET …/export/dsfinvk → 500
 *     ENOENT: open '/app/dist/fiskal/dsfinvk-2.4/index.xml'
 *
 * ⚠️ Und jede Prüfung war GRÜN. Sie laufen gegen `src/`, wo die Dateien
 * liegen. Nur das gebaute Abbild kennt den Unterschied.
 *
 * Dieselbe Fehlerklasse wie „dist statt Quelle macht Rot-Grün wertlos": ein
 * Test, der eine andere Datei liest als die Auslieferung, misst die falsche
 * Wirklichkeit.
 */

import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const paket = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { scripts?: Record<string, string> };

describe('⛔ der Bau nimmt die amtlichen Dateien mit', () => {
  it('das build-Skript kopiert sie', () => {
    // Am `build` und nicht am Dockerfile, damit auch ein lokaler Bau nicht in
    // dieselbe Grube fällt.
    expect(paket.scripts?.build, 'build kopiert die Fiskaldateien nicht').toContain(
      'kopiere-fiskaldateien',
    );
  });

  it('und der Kopierschritt SIEHT NACH, statt zu vertrauen', () => {
    const s = readFileSync(
      new URL('../../scripts/kopiere-fiskaldateien.mjs', import.meta.url),
      'utf8',
    );
    expect(s).toContain('index.xml');
    expect(s).toContain('gdpdu-01-09-2004.dtd');
    // Ein stiller Kopierfehler wäre genau der Zustand, den der Schritt beendet.
    expect(s, 'der Schritt prüft sein eigenes Ergebnis nicht').toContain('process.exit(1)');
  });

  it('⚠️ und wenn dist existiert, liegen sie WIRKLICH dort', () => {
    // Diese Zusage greift nur nach einem Bau. Vorher ist sie still —
    // aber nach einem Bau ist sie der einzige Beweis, der zählt.
    const dist = new URL('../../dist/fiskal/dsfinvk-2.4/index.xml', import.meta.url);
    if (!existsSync(new URL('../../dist/', import.meta.url))) return;
    expect(existsSync(dist), 'dist ist gebaut, aber index.xml fehlt darin').toBe(true);
    expect(readFileSync(dist, 'utf8')).toContain('<URL>transactions.csv</URL>');
  });
});
