/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ DAS KURSDIAGRAMM ERFAND EINE ANKAUFMARGE VON ZEHN PROZENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND (Tiefenjagd 11.08.2026, drei von drei Stimmen) ─────────────
 *
 * In `TradingTerminal.tsx` stand `const margin = safetyMarginPct ?? 0.1`.
 * Fiel die Abfrage `/api/metal-prices/rates` aus, war der Wert null, und der
 * Rückfall machte daraus zehn Prozent. Das Diagramm zeichnete eine
 * gestrichelte Ankauflinie, das Fadenkreuz zeigte „Ankauf 56,21 EUR" und die
 * Legende „Ankauf (−10,0 %)".
 *
 * Gemessen mit hinterlegten 18 Prozent: auf 100 g Feingold zeigte das
 * Diagramm 5620,50 EUR statt 5120,90 EUR — 499,60 EUR zu viel.
 *
 * Heimtückisch, weil `/current` und `/rates` ZWEI Abfragen sind: fällt nur
 * die zweite aus, bleibt der Spotkurs richtig stehen und nur die Ankauflinie
 * lügt. Der Bildschirm sieht vollständig aus.
 *
 * ── WARUM DAS KEIN SCHÖNHEITSFEHLER IST ──────────────────────────────────
 *
 * Der Kursbildschirm ist die Fläche, auf die der Händler schaut, BEVOR er
 * einen Preis nennt. Eine erfundene Marge dort ist ein erfundener Ankaufpreis.
 *
 * ── WAS DIESER WÄCHTER MISST ─────────────────────────────────────────────
 *
 * Nicht den Quelltext, sondern das GEZEICHNETE Ergebnis: die Fläche wird mit
 * `renderToStaticMarkup` wirklich gerendert, einmal ohne und einmal mit
 * hinterlegter Marge. Eine Textsuche nach `?? 0.1` würde jeden anderen Weg
 * zur selben Lüge übersehen.
 *
 * Der Test ist bewusst `.ts` und nicht `.tsx`: `vitest.config.ts` dieser App
 * sammelt nur `src/**\/*.test.ts`. Eine `.tsx`-Datei liefe hier NIE.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TradingTerminal } from './TradingTerminal.js';

/**
 * Ein kurzer, echter Kursverlauf: DESC, wie ihn die Route liefert.
 *
 * ⚠️ 12.08.2026: die Zeitstempel standen hier FEST ('2026-08-11T09:00').
 * Die Fläche filtert den Verlauf auf das gewählte Zeitfenster relativ zu
 * JETZT — am Tag nach dem Schreiben fielen alle drei Kerzen aus dem
 * 1T-Fenster, die Fläche zeigte ehrlich „wird noch aufgebaut", und der Test
 * wurde rot, ohne dass sich irgendein Code geändert hätte. Ein Test, der
 * mit dem Kalender stirbt, misst den Kalender. Deshalb relativ zur Laufzeit.
 */
const JETZT = Date.now();
const stundenVorher = (h: number): string => new Date(JETZT - h * 3_600_000).toISOString();
const VERLAUF = [
  { validFrom: stundenVorher(1), pricePerGramEur: '62.4500' },
  { validFrom: stundenVorher(2), pricePerGramEur: '62.1000' },
  { validFrom: stundenVorher(3), pricePerGramEur: '61.8000' },
] as const;

function zeichne(marge: number | null): string {
  return renderToStaticMarkup(
    createElement(TradingTerminal, {
      metalLabel: 'Gold',
      accent: '#c8a24a',
      history: VERLAUF as never,
      currentPrice: '62.4500',
      safetyMarginPct: marge,
    }),
  );
}

describe('⛔ die Ankaufmarge wird nicht erfunden', () => {
  it('ohne hinterlegte Marge steht KEINE Prozentzahl auf der Fläche', () => {
    const html = zeichne(null);

    // Die alte Lüge, wörtlich: die Legende nannte „−10,0 %".
    expect(html, 'die erfundenen zehn Prozent stehen wieder da').not.toContain('10,0 %');
    // Und überhaupt keine Ankaufprozente.
    expect(/Ankauf \(−[\d,]+\s?%\)/.test(html), 'eine Ankaufmarge wird behauptet').toBe(false);
  });

  it('ohne hinterlegte Marge sagt die Fläche, warum die Linie fehlt', () => {
    expect(zeichne(null)).toContain('Marge nicht geladen');
  });

  it('ohne hinterlegte Marge wird KEINE Ankauflinie gezeichnet', () => {
    const ohne = zeichne(null);
    const mit = zeichne(0.18);
    // Die gestrichelte Linie ist das Erkennungszeichen der Ankauflinie.
    expect(mit, 'die Ankauflinie fehlt, obwohl die Marge bekannt ist').toContain(
      'stroke-dasharray="4 3"',
    );
    expect(ohne, 'eine Ankauflinie ohne bekannte Marge').not.toContain('stroke-dasharray="4 3"');
  });

  it('mit hinterlegter Marge steht GENAU diese Zahl auf der Fläche', () => {
    const html = zeichne(0.18);
    expect(html).toContain('18 %');
    expect(html, 'die alte Erfindung mischt sich unter die echte Zahl').not.toContain('10,0 %');
  });
});
