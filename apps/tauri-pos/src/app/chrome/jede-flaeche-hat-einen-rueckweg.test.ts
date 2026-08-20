/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Von jeder sekundären Fläche führt ein benannter Weg zurück
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 (Basel, auf seinem Schirm) ───────────────────
 *
 * „Beim Betreten der Einstellungen fehlt der Zurück-Knopf, besonders von den
 * Symbolen unten."
 *
 * Die acht Karteireiter oben führen NUR auf die acht Hauptflächen. Die
 * sekundären Flächen stehen in keinem Reiter. Wer eine davon betrat, hatte
 * keinen Weg zurück — nur den Sprung auf irgendeine der acht, also woanders
 * hin als dorthin, wo er herkam.
 *
 * ── WAS DIESER WÄCHTER HÄLT ────────────────────────────────────────────────
 *
 *   1. JEDE sekundäre Fläche hat einen Rückweg, auch beim Kaltstart ohne
 *      jede Geschichte. Eine neue Fläche, die niemand einer Gruppe zuordnet,
 *      macht ihn rot — und das ist der Sinn.
 *   2. Der Rückweg zeigt NIE auf sich selbst.
 *   3. Er zeigt nur auf Adressen, die es wirklich gibt.
 *   4. Auf den acht Hauptflächen gibt es KEINEN — dort ist die Schiene der
 *      Weg, und ein zweiter daneben wäre eine Tür zu viel.
 */

import { describe, expect, it } from 'vitest';

import { type Wegstand, rueckwegFuer, schreibeWegFort } from './rueckweg.js';
import { PRIMARY_SURFACES, SECONDARY_SURFACES, findSurfaceByPath } from './surface-registry.js';

describe('⛔ Von jeder sekundären Fläche führt ein Weg zurück', () => {
  it('die Bühne ist besetzt — sonst wäre dieser Wächter grün aus Leere', () => {
    expect(SECONDARY_SURFACES.length).toBeGreaterThan(5);
    expect(PRIMARY_SURFACES.length).toBeGreaterThan(5);
  });

  it.each(SECONDARY_SURFACES.map((s) => [s.label, s.path] as const))(
    '⛔ %s hat auch beim Kaltstart einen Rückweg',
    (label, pfad) => {
      // `null` als Vorgeschichte: die Kasse wurde auf dieser Adresse
      // gestartet, oder der Mensch kam über einen Tiefenlink. Genau dann
      // versagte der Browserschritt zurück.
      const weg = rueckwegFuer(pfad, null);
      expect(
        weg,
        `„${label}" hat keinen Weg zurück. Wer sie betritt, kommt nur ` +
          'wieder heraus, indem er woanders hin springt. Trage sie in ' +
          '`gruppen.ts` ein.',
      ).not.toBeNull();
      expect(weg!.label.length).toBeGreaterThan(2);
    },
  );

  it.each(SECONDARY_SURFACES.map((s) => [s.label, s.path] as const))(
    '%s: der Rückweg führt auf eine Fläche, die es gibt — und nie auf sich selbst',
    (_label, pfad) => {
      const weg = rueckwegFuer(pfad, null)!;
      expect(weg.pfad).not.toBe(pfad);
      expect(findSurfaceByPath(weg.pfad), `„${weg.pfad}" ist keine Fläche`).toBeDefined();
    },
  );

  it('⛔ auf den Hauptflächen gibt es KEINEN — die Schiene ist der Weg', () => {
    for (const s of PRIMARY_SURFACES) {
      expect(rueckwegFuer(s.path, '/einstellungen'), `${s.label} trägt einen zweiten Weg`).toBeNull();
      // Auch tiefer in der Fläche, z. B. `/verkauf/beleg/47`.
      expect(rueckwegFuer(`${s.path}/tiefer`, null)).toBeNull();
    }
  });

  it('kam der Mensch von einer anderen Fläche, führt der Weg DORTHIN', () => {
    const ziel = SECONDARY_SURFACES[0]!;
    const woher = PRIMARY_SURFACES[0]!;
    const weg = rueckwegFuer(ziel.path, woher.path);
    expect(weg).toEqual({ pfad: woher.path, label: woher.label });
  });

  it('⛔ ein Knopf auf die eigene Adresse wäre ein Knopf, der nichts tut', () => {
    const ziel = SECONDARY_SURFACES[0]!;
    // Ein Neuladen derselben Adresse darf den Weg nicht auf sich selbst
    // richten — er fällt dann auf die Gruppe zurück.
    const weg = rueckwegFuer(ziel.path, ziel.path);
    expect(weg?.pfad).not.toBe(ziel.path);
  });

  it('⛔ der Weg merkt sich den Vorgänger SOFORT, nicht erst beim nächsten Bild', () => {
    /*
     * ── DER FEHLER, DEN DIE NACHPRÜFUNG GEFUNDEN HAT (20.08.2026) ────────
     *
     * Die erste Fassung schrieb den Vorgänger im AUFRÄUMEN eines Effekts.
     * React räumt erst NACH dem Rendern der neuen Fläche auf: beim ERSTEN
     * Bild stand dort noch der Pfad von vorvorhin, und der Rückweg fiel auf
     * die Heimfläche zurück.
     *
     * An der laufenden Kasse gemessen: von „Lager" nach „Dokumente" sagte
     * der Knopf „Zurück zu Werkstatt".
     *
     * ⚠️ Meine ERSTE Probe hatte das nicht gefangen, weil ich von der
     * Werkstatt aus geprüft hatte — und die Heimfläche IST die Werkstatt.
     * Die falsche Antwort sah aus wie die richtige. Diese Probe geht deshalb
     * ausdrücklich von einer ANDEREN Fläche aus.
     */
    let stand: Wegstand = { letzter: null, vorher: null };
    stand = schreibeWegFort(stand, '/werkstatt');
    stand = schreibeWegFort(stand, '/lager');
    stand = schreibeWegFort(stand, '/dokumente');

    const weg = rueckwegFuer('/dokumente', stand.vorher);
    expect(
      weg?.label,
      'Der Rückweg zeigt nicht dorthin, wo der Mensch wirklich herkam.',
    ).toBe('Lager');
  });

  it('⛔ zweimal dasselbe Bild wirft den Vorgänger NICHT weg', () => {
    // React rendert im Prüfmodus doppelt. Wäre die Fortschreibung nicht
    // idempotent, zeigte der Knopf nach dem zweiten Bild auf die Fläche,
    // auf der man gerade steht.
    let stand: Wegstand = { letzter: null, vorher: null };
    stand = schreibeWegFort(stand, '/lager');
    stand = schreibeWegFort(stand, '/dokumente');
    stand = schreibeWegFort(stand, '/dokumente');
    stand = schreibeWegFort(stand, '/dokumente');
    expect(stand.vorher).toBe('/lager');
    expect(rueckwegFuer('/dokumente', stand.vorher)?.label).toBe('Lager');
  });

  it('⛔ eine WEICHE ist kein Herkunftsort — sonst dreht sich der Weg im Kreis', () => {
    /*
     * Am Schirm gesehen (20.08.2026): `/tagebuch` leitet seit der
     * Zusammenlegung sofort nach `/leitstand?bereich=tagebuch` weiter. Wer
     * die alte Adresse aufrief, hatte „Tagebuch" als vorherige Fläche — und
     * der Knopf zurück führte auf die Weiche, die ihn postwendend wieder
     * zurückschickte.
     */
    const weichen = SECONDARY_SURFACES.filter((s) => s.weicheAuf !== undefined);
    expect(weichen.length, 'ohne Weichen beweist dieser Satz nichts').toBeGreaterThan(0);

    for (const w of weichen) {
      const weg = rueckwegFuer('/dokumente', w.path);
      expect(weg?.pfad, `„${w.label}" wurde als Herkunft angenommen`).not.toBe(w.path);
    }
  });

  it('⛔ auch eine unbekannte Adresse führt auf eine WIRKLICHE Fläche', () => {
    // Der Rumpf leitet unbekannte Adressen ohnehin nach Hause; der Knopf
    // sagt dasselbe. Was er NICHT tun darf, ist auf eine Adresse zeigen,
    // hinter der niemand steht — deshalb wird das Ziel nachgeschlagen.
    for (const wo of ['/gibt-es-nicht', '/auch-nicht']) {
      const weg = rueckwegFuer(wo, null)!;
      expect(weg).not.toBeNull();
      expect(findSurfaceByPath(weg.pfad)).toBeDefined();
    }
  });

  it('⛔ die Einstellungen selbst führen NICHT auf sich zurück', () => {
    // Sie sind die Tür aller Gruppen; ohne die Ausnahme in Regel 3 zeigte
    // ihr Knopf auf die eigene Adresse und täte nichts.
    const weg = rueckwegFuer('/einstellungen', null)!;
    expect(weg.pfad).not.toBe('/einstellungen');
    expect(findSurfaceByPath(weg.pfad)).toBeDefined();
  });
});
