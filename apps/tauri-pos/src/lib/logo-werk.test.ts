/**
 * Grössenstufen und Dateiannahme des Logo-Werks — rein, ohne DOM und ohne Tauri.
 *
 * WARUM DIESE PRÜFUNGEN (26.07.2026, Basels Dekret): der Händler wählt
 * klein / mittel / gross, nie Pixel. Die Zahlen hier SPIEGELN die Rust-Seite
 * (thermal.rs, `logo_zielbreite` und `druckbreite_punkte`): 40/60/80 Prozent
 * der Druckbreite, 384 Punkte auf der 58-mm-Rolle und 576 auf 80 mm, mit
 * GANZZAHLIGER Teilung. Läuft eine der beiden Seiten davon, zeigt die
 * React-Seitenansicht eine andere Logobreite als der Drucker schneidet —
 * genau die Doppelpflege, die die Byte-Vorschau abschaffen soll. Diese
 * Prüfungen schreiben die Zahlen fest, damit ein Drift ROT wird.
 *
 * Die Dateigrenze ist die SERVER-Grenze (beleg-logo.ts: 256 KB) — eine
 * Fläche, die 2 MB verspricht und bei 300 KB scheitert, wäre eine Lüge.
 */
import { describe, expect, it } from 'vitest';

import {
  LOGO_MAX_BYTES,
  LOGO_STUFEN,
  logoMime,
  logoZielbreitePunkte,
  druckbreitePunkte,
  pruefeLogoDatei,
} from './logo-werk.js';

describe('druckbreitePunkte', () => {
  it('kennt nur die zwei Rollen, die es real gibt (Spiegel von thermal.rs)', () => {
    expect(druckbreitePunkte(48)).toBe(576); // 80 mm
    expect(druckbreitePunkte(32)).toBe(384); // 58 mm
  });

  it('faellt bei einer unbekannten Spaltenzahl auf die schmale Rolle zurueck', () => {
    // Dieselbe Entscheidung wie `cols_of`/`druckbreite_punkte` in thermal.rs:
    // im Zweifel schmal. Ein Logo, das auf 58 mm passt, passt immer auch auf
    // 80 mm — andersherum schneidet der Drucker rechts ab, still.
    expect(druckbreitePunkte(37)).toBe(384);
    expect(druckbreitePunkte(0)).toBe(384);
  });
});

describe('logoZielbreitePunkte', () => {
  it('liefert die drei festen Stufen auf 80 mm (40/60/80 Prozent von 576)', () => {
    expect(logoZielbreitePunkte('klein', 48)).toBe(230);
    expect(logoZielbreitePunkte('mittel', 48)).toBe(345);
    expect(logoZielbreitePunkte('gross', 48)).toBe(460);
  });

  it('liefert die drei festen Stufen auf 58 mm (40/60/80 Prozent von 384)', () => {
    expect(logoZielbreitePunkte('klein', 32)).toBe(153);
    expect(logoZielbreitePunkte('mittel', 32)).toBe(230);
    expect(logoZielbreitePunkte('gross', 32)).toBe(307);
  });

  it('die Stufen sind streng aufsteigend und nie breiter als die Rolle', () => {
    for (const cols of [32, 48] as const) {
      expect(logoZielbreitePunkte('klein', cols)).toBeLessThan(
        logoZielbreitePunkte('mittel', cols),
      );
      expect(logoZielbreitePunkte('mittel', cols)).toBeLessThan(
        logoZielbreitePunkte('gross', cols),
      );
      for (const { stufe } of LOGO_STUFEN) {
        expect(logoZielbreitePunkte(stufe, cols)).toBeLessThanOrEqual(druckbreitePunkte(cols));
      }
    }
  });
});

describe('logoMime', () => {
  it('liefert den Anzeigetyp je Format — fuer die data-URL der Seitenansicht', () => {
    expect(logoMime('svg')).toBe('image/svg+xml');
    expect(logoMime('png')).toBe('image/png');
    expect(logoMime('jpeg')).toBe('image/jpeg');
  });
});

describe('pruefeLogoDatei', () => {
  it('nimmt SVG an — Basels Vorgabe: „die praeziseste Form"', () => {
    const ergebnis = pruefeLogoDatei('zeichen.svg', 'image/svg+xml', 4_000);
    expect(ergebnis).toEqual({ ok: true, format: 'svg' });
  });

  it('nimmt PNG und JPEG an', () => {
    expect(pruefeLogoDatei('logo.png', 'image/png', 50_000)).toEqual({ ok: true, format: 'png' });
    expect(pruefeLogoDatei('logo.jpg', 'image/jpeg', 50_000)).toEqual({ ok: true, format: 'jpeg' });
    expect(pruefeLogoDatei('logo.jpeg', 'image/jpeg', 50_000)).toEqual({
      ok: true,
      format: 'jpeg',
    });
  });

  it('erkennt das Format an der Endung, wenn der Browser keinen MIME-Typ liefert', () => {
    // Windows liefert fuer .svg je nach Registry einen leeren Typ.
    expect(pruefeLogoDatei('zeichen.svg', '', 4_000)).toEqual({ ok: true, format: 'svg' });
  });

  it('lehnt fremde Formate mit ehrlichem Grund ab', () => {
    const ergebnis = pruefeLogoDatei('logo.webp', 'image/webp', 4_000);
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.grund).toContain('SVG, PNG oder JPEG');
  });

  it('lehnt eine leere Datei ab', () => {
    const ergebnis = pruefeLogoDatei('logo.png', 'image/png', 0);
    expect(ergebnis.ok).toBe(false);
  });

  it('die Grenze ist die SERVER-Grenze: 256 KB, und sie steht im Grund', () => {
    expect(LOGO_MAX_BYTES).toBe(256 * 1024);
    const ergebnis = pruefeLogoDatei('logo.png', 'image/png', LOGO_MAX_BYTES + 1);
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.grund).toContain('256 KB');
    // Genau an der Grenze ist noch gut.
    expect(pruefeLogoDatei('logo.png', 'image/png', LOGO_MAX_BYTES).ok).toBe(true);
  });
});
