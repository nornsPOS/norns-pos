/**
 * Die Übersicht darf keine Fläche erfinden und keine verschweigen.
 *
 * ── DER FUND (25.07.2026) ──────────────────────────────────────────────────
 * Die Gruppentabelle nannte SIEBEN Pfade, die es im Register nicht gibt —
 * `/belegdesigner`, `/sammlungen`, `/trading`, `/geraete`, `/integrationen`,
 * `/api-schluessel`, `/konflikte`. Sie taten nichts Schlimmes: sie fanden
 * einfach nichts. Der Schaden war leiser — das Konfliktpostfach heisst in
 * Wahrheit `/compliance-inbox`, rutschte deshalb aus „Kundschaft" heraus und
 * landete unter „Weiteres", zwischen lauter Unsortiertem.
 *
 * Eine Namensliste, die niemand gegen die Wirklichkeit hält, driftet still.
 */
import { describe, expect, it } from 'vitest';

import { SECONDARY_SURFACES, SURFACES } from '../../app/chrome/surface-registry.js';
import { GRUPPEN } from './Uebersicht.js';

describe('die Gruppen der Übersicht', () => {
  it('nennen nur Pfade, die es wirklich gibt', () => {
    const echte = new Set(SURFACES.map((s) => s.path));
    const erfunden = GRUPPEN.flatMap((g) => g.pfade).filter((p) => !echte.has(p));
    expect(erfunden).toEqual([]);
  });

  it('nennen keinen Pfad zweimal', () => {
    const alle = GRUPPEN.flatMap((g) => g.pfade);
    const doppelt = alle.filter((p, i) => alle.indexOf(p) !== i);
    expect(doppelt).toEqual([]);
  });

  it('lassen keine sekundäre Fläche ohne Gruppe zurück', () => {
    // „Weiteres" faengt zwar alles auf, aber eine Flaeche dort ist unsortiert,
    // nicht eingeordnet. Diese Pruefung haelt die Tabelle vollstaendig.
    const einsortiert = new Set(GRUPPEN.flatMap((g) => g.pfade));
    /*
     * ⚠️ 20.08.2026: WEICHEN brauchen keine eigene Tür. Seit die vier
     * Aufsichtsflächen unter einer Tür stehen, sind `/risiko`, `/tagebuch`
     * und `/compliance-inbox` Adressen, die in einen BEREICH führen. Sie
     * bleiben auffindbar (Cmd+K, Startliste, Muskelgedächtnis), aber eine
     * zweite Tür in der Spalte wäre genau die Dopplung, die Basel beseitigt
     * haben wollte.
     *
     * Gelesen wird das aus der Registrierung selbst (`weicheAuf`), nicht aus
     * einer Liste hier — sonst driftet die Ausnahme von der Sache weg.
     */
    const fehlend = SECONDARY_SURFACES.filter((s) => s.weicheAuf === undefined)
      .map((s) => s.path)
      // Die Übersicht selbst gehoert nicht in ihre eigene Liste.
      .filter((p) => p !== '/uebersicht' && !einsortiert.has(p));
    expect(fehlend).toEqual([]);
  });
});
