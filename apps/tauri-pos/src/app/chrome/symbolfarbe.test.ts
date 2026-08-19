/**
 * ⛔ ZWEI LISTEN, EINE WAHRHEIT
 *
 * `symbolfarbe.ts` fuehrt die Zuordnung Pfad → Taetigkeit noch einmal, weil
 * es ein REINES Modul ist und die Kopfleiste es frueher braucht als die
 * Uebersichtsflaeche geladen wird. Zwei Kopien laufen ohne Waechter
 * auseinander — die Hausklasse, an der dieses Haus schon dreimal gelernt hat
 * (die Kursquellen, die Hilfekennungen, die Nachzuegler).
 *
 * Dieser Satz haelt sie zusammen: jeder Pfad einer Uebersichtsgruppe hat hier
 * eine Taetigkeit, und keine Taetigkeit steht hier fuer einen Pfad, den es in
 * keiner Gruppe gibt.
 */

import { describe, expect, it } from 'vitest';

import { GRUPPEN } from '../../screens/secondary/Uebersicht.js';
import { SURFACES } from './surface-registry.js';
import { PFADE_MIT_TAETIGKEIT, symbolfarbeFuer } from './symbolfarbe.js';

describe('⛔ Die Farbe eines Zeichens folgt der Taetigkeit', () => {
  // ── 19.08.2026: die Kopfleiste ist die zweite rechtmaessige Quelle ──────
  //
  // Bis heute kannte dieser Waechter nur die Uebersichtsgruppen — und genau
  // deshalb blieb die KOPFLEISTE grau: ihre sieben Reiter stehen in keiner
  // Gruppe, ihre Zuordnungen haette der Waechter als „zeigt ins Leere"
  // abgewiesen. Rechtmaessig ist ein Pfad, den ENTWEDER die Uebersicht
  // ODER das Flaechenverzeichnis fuehrt.
  const ausGruppen = [
    ...GRUPPEN.flatMap((g) => [...g.pfade]),
    ...SURFACES.map((s) => s.path),
  ];

  it('⛔ jeder Pfad der Uebersicht traegt eine Taetigkeit', () => {
    // Ohne diesen Satz waere ein neuer Bereich still grau — und niemand
    // merkte, dass die Wuerze fehlt.
    const ohne = ausGruppen.filter((p) => !PFADE_MIT_TAETIGKEIT.includes(p));
    expect(ohne, 'Diese Pfade haetten keine Zeichenfarbe').toEqual([]);
  });

  it('⛔ und keine Taetigkeit zeigt auf einen Pfad, den es nicht gibt', () => {
    const tot = PFADE_MIT_TAETIGKEIT.filter((p) => !ausGruppen.includes(p));
    expect(tot, 'Diese Zuordnungen zeigen ins Leere').toEqual([]);
  });

  it('die Farben sind MARKEN, nie Literale — sonst kippen sie nachts nicht', () => {
    for (const p of PFADE_MIT_TAETIGKEIT) {
      const f = symbolfarbeFuer(p);
      expect(f.startsWith('var(--w14-'), `${p} traegt ein Literal: ${f}`).toBe(true);
    }
  });

  it('ein unbekannter Pfad bekommt die Tinte, nie eine Zufallsfarbe', () => {
    expect(symbolfarbeFuer('/gibt-es-nicht')).toBe('var(--w14-ink-faded)');
  });

  it('die Taetigkeiten sind wirklich UNTERSCHIEDLICH gefaerbt', () => {
    // Ein System, in dem alles dieselbe Marke bekommt, waere die
    // Volltoenung mit Zwischenschritt.
    const farben = new Set(ausGruppen.map(symbolfarbeFuer));
    expect(farben.size).toBeGreaterThanOrEqual(4);
  });
});
