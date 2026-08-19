/**
 * Breitbild-Entscheidung des Lagers (26.07.2026, Basels Dekret Punkt 5):
 * das kommende Gerät ist BREIT. Ab genügend Fensterbreite wird das
 * Produktblatt rechts ANGEDOCKT (Liste bleibt sichtbar) statt als
 * überlagernde Schublade. Die Schwelle ist eine bewusste, geprüfte Zahl:
 * unterhalb muss die Liste ihre gesunde Mindestbreite behalten, sonst
 * quetscht das 520er-Blatt die Tabelle unter ihre Spaltenminima.
 */
import { describe, expect, it } from 'vitest';

import {
  ANDOCK_MINDESTBREITE,
  BLATT_BREITE_ANGEDOCKT,
  blattAnordnung,
} from './lager-layout.js';

describe('blattAnordnung', () => {
  it('überlagert auf dem heutigen 1280er-Bild — dort ändert sich NICHTS', () => {
    expect(blattAnordnung(1280)).toBe('ueberlagernd');
  });

  it('dockt auf dem breiten Gerät (1920) an', () => {
    expect(blattAnordnung(1920)).toBe('angedockt');
  });

  it('kippt genau an der Schwelle, nicht davor', () => {
    expect(blattAnordnung(ANDOCK_MINDESTBREITE - 1)).toBe('ueberlagernd');
    expect(blattAnordnung(ANDOCK_MINDESTBREITE)).toBe('angedockt');
  });

  it('lässt der Tabelle neben dem angedockten Blatt ihre Mindestbreite', () => {
    // Spaltenminima der LagerTable (GRID_TEMPLATE, LagerTable.tsx): 56 + 120
    // + 0 + 124 + 130 + 140 + 116 + 132 = 818. Dazu Flächenabstand ~48 und
    // der Spaltenabstand. An der Schwelle muss neben dem Blatt mehr als das
    // übrig bleiben, sonst dockt die Fläche an und die Tabelle bricht.
    const tabellenMinimum = 818 + 48;
    expect(ANDOCK_MINDESTBREITE - BLATT_BREITE_ANGEDOCKT).toBeGreaterThan(tabellenMinimum);
  });
});
