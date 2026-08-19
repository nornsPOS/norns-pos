/**
 * Der Katalog wird gegen die TREIBERDATEI geprüft, nicht gegen ein Datenblatt.
 *
 * ── WARUM ─────────────────────────────────────────────────────────────────
 * Am 26.07.2026 kam ein Etikett beschnitten aus dem DYMO, weil der Bauplan mit
 * dem PAPIERMASS rechnete statt mit dem, was der Thermokopf erreicht. Der
 * Unterschied steht in `/etc/cups/ppd/Warehouse14-Etikett.ppd` und ist kein
 * Rundungsfehler: an beiden Enden der Laufrichtung fehlen 5,256 mm.
 *
 * Diese Prüfung hält die Zahlen des Katalogs gegen eine von Hand aus der
 * Treiberdatei abgelesene Tabelle. Vertippt sich jemand beim Pflegen, wird sie
 * rot — statt dass es erst am beschnittenen Papier auffällt.
 */
import { describe, expect, it } from 'vitest';

import {
  DRUCKPUNKT_MM,
  ETIKETT_MEDIEN,
  STANDARD_MEDIUM,
  ausDruckpunkten,
  familieFuer,
  inDruckpunkte,
  mediumFuer,
  punktZuMm,
  standardMedium,
} from './etikett-groessen.js';

/**
 * Papier quer, Papier längs, bedruckbar quer, bedruckbar längs — in
 * Millimetern, auf eine Nachkommastelle abgelesen.
 */
const SOLL: Record<string, [number, number, number, number]> = {
  w81h252: [28.6, 88.9, 27.2, 78.4],
  w101h252: [35.6, 88.9, 34.2, 78.4],
  w54h144: [19.1, 50.8, 17.6, 40.3],
  w41h144: [14.5, 50.8, 13.1, 40.3],
  w41h248: [14.5, 87.5, 13.1, 77.0],
  w153h198: [54.0, 69.9, 52.6, 59.3],
  w162h225: [57.2, 79.4, 55.7, 68.9],
  w162h288: [57.2, 101.6, 55.7, 91.1],
  w162h504: [57.2, 177.8, 55.7, 167.3],
  w162h540: [57.2, 190.5, 55.7, 180.0],
};

describe('der Katalog der Etikettengroessen', () => {
  it('kennt genau die zehn Medien der Treiberdatei', () => {
    expect(ETIKETT_MEDIEN).toHaveLength(10);
    expect([...ETIKETT_MEDIEN].map((m) => m.cups).sort()).toEqual(Object.keys(SOLL).sort());
  });

  it('rechnet Papier und bedruckbare Flaeche aus den PPD-Punkten nach', () => {
    for (const m of ETIKETT_MEDIEN) {
      const z = SOLL[m.cups]!;
      // Ein Zwanzigstel Millimeter Spielraum, weil die Soll-Tabelle auf eine
      // Nachkommastelle gerundet ist (19,05 wird zu 19,1 geschrieben).
      const nah = (ist: number, sollWert: number, wo: string): void => {
        expect(Math.abs(ist - sollWert), `${m.cups} ${wo}: ${ist.toFixed(4)}`).toBeLessThanOrEqual(
          0.051,
        );
      };
      nah(m.papier.querMm, z[0], 'Papier quer');
      nah(m.papier.laengsMm, z[1], 'Papier laengs');
      nah(m.bedruckbar.hoeheMm, z[2], 'bedruckbar quer');
      nah(m.bedruckbar.breiteMm, z[3], 'bedruckbar laengs');
    }
  });

  it('kennt den unbedruckbaren Rand — die Grundlage der Ruhezone', () => {
    // Seitlich 2 Punkt, an beiden Enden der Laufrichtung 14,9 Punkt. Dieses
    // weisse Papier ist der Grund, warum auf das kleine Etikett ueberhaupt ein
    // brauchbarer Strichcode passt.
    for (const m of ETIKETT_MEDIEN) {
      expect(m.bedruckbar.randQuerMm, m.cups).toBeCloseTo(punktZuMm(2), 9);
      expect(m.bedruckbar.randLaengsMm, m.cups).toBeCloseTo(punktZuMm(14.9), 9);
      expect(m.bedruckbar.randQuerMm, m.cups).toBeCloseTo(0.706, 3);
      expect(m.bedruckbar.randLaengsMm, m.cups).toBeCloseTo(5.256, 3);
    }
  });

  it('laesst Papier und bedruckbare Flaeche zusammenpassen', () => {
    // Bedruckbar plus zweimal Rand muss das Papier ergeben. Faellt das
    // auseinander, stimmt eine der beiden PPD-Zeilen nicht.
    for (const m of ETIKETT_MEDIEN) {
      const quer = m.bedruckbar.hoeheMm + 2 * (m.bedruckbar.randQuerMm ?? 0);
      const laengs = m.bedruckbar.breiteMm + 2 * (m.bedruckbar.randLaengsMm ?? 0);
      expect(quer, `${m.cups} quer`).toBeCloseTo(m.papier.querMm, 6);
      expect(laengs, `${m.cups} laengs`).toBeCloseTo(m.papier.laengsMm, 6);
    }
  });

  it('rechnet die Millimeter in DERSELBEN Reihenfolge wie die Rust-Seite', () => {
    // `pt * 25.4 / 72` und `pt * (25.4 / 72)` liefern nicht dasselbe letzte
    // Bit. Die Rust-Seite passt den Bauplan in die bedruckbare Flaeche ein und
    // prueft danach die schmalste Linie — bei 0,9999999 statt 1,0 wuerde ein
    // gerade noch lesbarer Strichcode grundlos abgelehnt.
    expect(punktZuMm(77)).toBe((77 * 25.4) / 72);
    const m = standardMedium();
    expect(m.bedruckbar.hoeheMm).toBe(punktZuMm(79) - punktZuMm(2));
    expect(m.bedruckbar.breiteMm).toBe(punktZuMm(237.1) - punktZuMm(14.9));
  });

  it('waehlt die Bauplanfamilie nach der BAHNBREITE', () => {
    expect(mediumFuer('w54h144')?.familie).toBe('klein');
    expect(mediumFuer('w41h144')?.familie).toBe('klein');
    expect(mediumFuer('w41h248')?.familie).toBe('klein');
    expect(mediumFuer('w81h252')?.familie).toBe('standard');
    expect(mediumFuer('w101h252')?.familie).toBe('standard');
    expect(mediumFuer('w153h198')?.familie).toBe('gross');
    expect(mediumFuer('w162h225')?.familie).toBe('gross');
    expect(mediumFuer('w162h540')?.familie).toBe('gross');

    expect(familieFuer(17.6)).toBe('klein');
    expect(familieFuer(20)).toBe('klein');
    expect(familieFuer(20.1)).toBe('standard');
    expect(familieFuer(36)).toBe('standard');
    expect(familieFuer(36.1)).toBe('gross');
  });

  it('sagt ehrlich, welche Medien dieses Geschaeft wirklich braucht', () => {
    const kern = ETIKETT_MEDIEN.filter((m) => m.eignung === 'kern').map((m) => m.cups);
    // Der Alltag am Tresen: Haus-Etikett, hohes Haus-Etikett, Kapselfaehnchen.
    expect(kern).toEqual(['w81h252', 'w101h252', 'w54h144']);
    // Frankierstreifen sind keine Warenetiketten und duerfen im Katalog nicht
    // so aussehen, als waeren sie eine gleichwertige Wahl.
    for (const cups of ['w162h504', 'w162h540', 'w41h144']) {
      expect(mediumFuer(cups)?.eignung, cups).toBe('beiliegend');
    }
    for (const m of ETIKETT_MEDIEN) {
      expect(m.zweck.length, `${m.cups} braucht einen echten Satz`).toBeGreaterThan(30);
      expect(m.bezeichnung, `${m.cups} braucht eine deutsche Bezeichnung`).not.toMatch(/_/);
    }
  });

  it('nennt das Medium, das der Treiber als Vorgabe fuehrt', () => {
    expect(STANDARD_MEDIUM).toBe('w81h252');
    expect(standardMedium().cups).toBe('w81h252');
    expect(mediumFuer('gibt-es-nicht')).toBeUndefined();
  });

  it('rechnet Druckpunkte bei 300 dpi', () => {
    expect(DRUCKPUNKT_MM).toBeCloseTo(0.08467, 5);
    expect(ausDruckpunkten(3)).toBeGreaterThanOrEqual(0.254);
    expect(inDruckpunkte(ausDruckpunkten(100))).toBe(100);
    // Genau auf der Kante darf kein Punkt verlorengehen: drei Punkte sind
    // rechnerisch 0,254 mm, in Fliesskomma aber ein Hauch daneben.
    expect(inDruckpunkte(0.254)).toBe(3);
    // Und eine Summe aus Teilstuecken darf sich nicht wegrunden.
    expect(inDruckpunkte(ausDruckpunkten(8) + ausDruckpunkten(100) + ausDruckpunkten(16))).toBe(
      124,
    );
  });
});
