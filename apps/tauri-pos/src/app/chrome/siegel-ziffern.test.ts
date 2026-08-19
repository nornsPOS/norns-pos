/**
 * Kein Siegel trägt eine fest getippte Ziffer.
 *
 * ── DER FUND (25.07.2026) ──────────────────────────────────────────────────
 * Die Schiene war einmal anders geordnet. Als sich das änderte, wanderte das
 * Register mit — die Siegel in den Überschriften nicht. Danach stand über dem
 * Lager „◇6", während die 6 in die Kunden führte, über dem Verkauf „◇2",
 * während die 2 in den Ankauf führte, und über der Bewertung eine „8" für eine
 * Fläche, die überhaupt keine Ziffer hat.
 *
 * Wer sich die Ziffer merkte, landete woanders. Die einzige Tastaturhilfe, die
 * die Kasse bewirbt, log an vier von sechs Stellen.
 *
 * Deshalb: eine Ziffer im Siegel kommt aus `zifferFuerFlaeche(pfad)` oder gar
 * nicht. Eine Fläche ohne eigene Ziffer trägt die Raute.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRIMARY_SURFACES, zifferFuerFlaeche } from './surface-registry.js';

const SCHIRME = new URL('../../screens', import.meta.url).pathname;

function alleSchirme(verzeichnis: string, gesammelt: string[] = []): string[] {
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) alleSchirme(pfad, gesammelt);
    else if (/\.tsx$/.test(eintrag) && !/\.test\.tsx$/.test(eintrag)) gesammelt.push(pfad);
  }
  return gesammelt;
}

describe('die Siegel-Ziffern', () => {
  const dateien = alleSchirme(SCHIRME).map((p) => ({
    kurz: p.slice(SCHIRME.length + 1),
    text: readFileSync(p, 'utf8'),
  }));

  it('liest ueberhaupt Bildschirme', () => {
    expect(dateien.length).toBeGreaterThan(30);
  });

  it('keine steht als fester Text im Bildschirm', () => {
    const suender = dateien
      .filter((d) => /<Seal[^>]*label=["'][0-9]["']/.test(d.text))
      .map((d) => d.kurz);
    expect(suender).toEqual([]);
  });

  it('auch kein digitLabel steht als fester Text', () => {
    const suender = dateien.filter((d) => /digitLabel=["'][0-9]["']/.test(d.text)).map((d) => d.kurz);
    expect(suender).toEqual([]);
  });

  it('die Quelle selbst antwortet richtig — und schweigt, wo es nichts zu sagen gibt', () => {
    for (const s of PRIMARY_SURFACES) {
      expect(zifferFuerFlaeche(s.path)).toBe(s.digit === undefined ? null : String(s.digit));
    }
    // Bewertung ist eine Fläche zweiter Ordnung und hat KEINE Ziffer. Die „8",
    // die dort stand, gehoert dem Schreiben.
    expect(zifferFuerFlaeche('/bewertung')).toBeNull();
    expect(zifferFuerFlaeche('/gibt-es-nicht')).toBeNull();
  });
});
