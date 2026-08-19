/**
 * Das Kursband darf keine Tage behaupten, die es nicht gemessen hat.
 *
 * ⚠️ 01.08.2026 auf einer frischen Kasse gesehen: „0,0 % ggü. Ø 10 Tage",
 * an einem Tag, an dem genau ein Kurs vorlag. Das Mittel WAR der heutige
 * Kurs, die Differenz also zwangsläufig null. Ein Händler liest daraus einen
 * ruhigen Markt, obwohl niemand etwas gemessen hat.
 *
 * Diese Sätze halten beide Hälften ehrlich: die Zahl der Tage und die Frage,
 * ob die Prozentzahl überhaupt erscheinen darf.
 */

import { describe, expect, it } from 'vitest';

import { deckeMittelAb, MITTEL_FENSTER_TAGE } from './metal-tick.js';

/** Fester Bezugspunkt, damit die Sätze nicht mit dem Kalender wandern. */
const JETZT = new Date('2026-08-01T12:00:00.000Z');

/** `n` Tage vor JETZT, als ISO-Zeichenkette. */
function vorTagen(n: number): string {
  return new Date(JETZT.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('Deckung des Zehn-Tage-Mittels', () => {
  it('ein einziger Tag: die Prozentzahl darf NICHT erscheinen', () => {
    // Genau der Fall, der auf Basels Schirm stand.
    const d = deckeMittelAb([vorTagen(0)], JETZT);
    expect(d.tage).toBe(1);
    expect(d.vergleichstext).toBeNull();
  });

  it('gar kein Kurs: ebenfalls kein Vergleich', () => {
    expect(deckeMittelAb([], JETZT)).toEqual({ tage: 0, vergleichstext: null });
  });

  it('drei Tage: die Kasse nennt DREI, nicht zehn', () => {
    const d = deckeMittelAb([vorTagen(0), vorTagen(1), vorTagen(2)], JETZT);
    expect(d.tage).toBe(3);
    expect(d.vergleichstext).toBe('ggü. Ø 3 Tagen, mehr liegt noch nicht vor');
    expect(d.vergleichstext).not.toMatch(/10/);
  });

  it('volles Fenster: erst dann darf „10 Tage" dastehen', () => {
    const alle = Array.from({ length: MITTEL_FENSTER_TAGE }, (_, i) => vorTagen(i));
    const d = deckeMittelAb(alle, JETZT);
    expect(d.tage).toBe(MITTEL_FENSTER_TAGE);
    expect(d.vergleichstext).toBe('ggü. Ø 10 Tage');
  });

  it('zwei Abrufe am selben Tag sind EIN Tag', () => {
    // Sonst zählte eine Kasse, die stündlich abruft, nach einem Tag „24 Tage".
    const d = deckeMittelAb(
      ['2026-08-01T06:00:00.000Z', '2026-08-01T09:00:00.000Z', '2026-08-01T11:00:00.000Z'],
      JETZT,
    );
    expect(d.tage).toBe(1);
    expect(d.vergleichstext).toBeNull();
  });

  it('was älter ist als das Fenster, zählt nicht mit', () => {
    // Der Server mittelt über zehn Tage. Ein 40 Tage alter Kurs steckt nicht
    // im Mittel und darf die Deckung nicht schönen.
    const d = deckeMittelAb([vorTagen(0), vorTagen(1), vorTagen(40), vorTagen(90)], JETZT);
    expect(d.tage).toBe(2);
  });

  it('Unbrauchbares fällt still heraus statt zu zählen', () => {
    const d = deckeMittelAb([null, undefined, '', 'kein Datum', vorTagen(0), vorTagen(1)], JETZT);
    expect(d.tage).toBe(2);
  });

  it('mehr als zehn beobachtete Tage behaupten trotzdem nur zehn', () => {
    // Das Fenster begrenzt oben schon; dieser Satz hält fest, dass der Text
    // nie „ggü. Ø 14 Tagen" sagt, wenn der Server über zehn mittelt.
    const alle = Array.from({ length: 14 }, (_, i) => vorTagen(i));
    expect(deckeMittelAb(alle, JETZT).vergleichstext).toBe('ggü. Ø 10 Tage');
  });
});
