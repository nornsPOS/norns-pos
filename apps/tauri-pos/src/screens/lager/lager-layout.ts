/**
 * Breitbild-Anordnung des Lagers (26.07.2026, letztes Schreibtisch-Update).
 *
 * WARUM eine Schwelle statt Fluss: ob das Produktblatt die Liste ÜBERLAGERT
 * (Schublade mit Fokusfalle) oder rechts ANGEDOCKT daneben steht, ist eine
 * Entweder-oder-Entscheidung — es gibt keinen fließenden Zwischenzustand.
 * Das Haus vermeidet Breiten-Medienabfragen bewusst; hier ist die eine
 * begründete Ausnahme, und sie lebt als GEPRÜFTE Zahl in diesem Modul statt
 * als nackte Abfrage im CSS.
 *
 * WARUM 1600: die LagerTable braucht mindestens ~818 Punkte (Summe ihrer
 * Spaltenminima in GRID_TEMPLATE) plus Flächenabstand. Ein angedocktes Blatt
 * von 520 Punkten lässt bei 1600 noch gut 1030 Punkte für die Liste — Luft
 * statt Gedränge. Darunter würde das Andocken die Tabelle quetschen, also
 * bleibt dort die bewährte Schublade. Der Wächtertest hält diese Rechnung.
 */

import { useSyncExternalStore } from 'react';

/** Ab dieser Fensterbreite (CSS-Punkte) wird das Produktblatt angedockt. */
export const ANDOCK_MINDESTBREITE = 1600;

/** Breite des angedockten Blatts — bewusst schmaler als die 620er-Schublade. */
export const BLATT_BREITE_ANGEDOCKT = 520;

export type BlattAnordnung = 'angedockt' | 'ueberlagernd';

export function blattAnordnung(fensterBreite: number): BlattAnordnung {
  return fensterBreite >= ANDOCK_MINDESTBREITE ? 'angedockt' : 'ueberlagernd';
}

// ── React-Anbindung ──────────────────────────────────────────────────────
// useSyncExternalStore statt eines resize-useEffect: der Wert ist beim ersten
// Render sofort richtig (kein Aufblitzen der Schublade auf dem breiten
// Gerät), und es gibt genau EINE Quelle der Wahrheit für die Schwelle.

function abonniere(melde: () => void): () => void {
  window.addEventListener('resize', melde);
  return () => window.removeEventListener('resize', melde);
}

function lies(): BlattAnordnung {
  return blattAnordnung(window.innerWidth);
}

/** Live-Anordnung des Produktblatts, folgt der Fensterbreite. */
export function useBlattAnordnung(): BlattAnordnung {
  return useSyncExternalStore(abonniere, lies);
}
