// @vitest-environment node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Die Kopfzeile behauptet nicht mehr, als die Zeilen darunter sagen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 21.08.2026 ──────────────────────────────────────────────
 *
 * Die Einrichtungskarte zählte unter der Überschrift „Diese Kasse kann noch
 * nicht verkaufen":
 *
 *     const blockierend = offen.filter(
 *       (s) => s.sperre !== 'KOSMETIK' && s.sperre !== 'MELDUNG');
 *     → „7 Aufgaben halten den Betrieb auf."
 *
 * Das Vokabular der Sperren kennt aber FÜNF Ränge, und nur EINER hält den
 * Verkauf auf:
 *
 *     VERKAUF    4   hält den Verkauf auf
 *     EXPORT     8   hält die Steuerausfuhr auf
 *     TERMINE    2   hält die Terminverwaltung auf
 *     KOSMETIK   7   hält nichts auf
 *     MELDUNG    2   ist eine Meldepflicht, kein Riegel
 *
 * Das Haus hatte es am 20.08. selbst nachgemessen und in den Plan
 * geschrieben: „von zwölf Punkten halten nur ZWEI den Verkauf auf". Die
 * ZEILEN sagten es richtig („Kein Verkauf möglich" gegen „Kein Steuerexport
 * möglich"), die Farben ebenso — nur die Kopfzeile widersprach allem
 * darunter.
 *
 * ── WARUM DAS NICHT KOSMETISCH IST ────────────────────────────────────────
 *
 * Wer glaubt, sieben Dinge hinderten ihn am Verkaufen, räumt am ersten Tag
 * sieben Dinge weg, bevor er den ersten Kunden bedient — statt zwei. Der
 * Steuerexport eilt nicht am Tresen; er eilt zum Monatsende.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Ohne Kommentare: der Kopf oben ZITIERT die alte Zeile. */
const QUELLE = readFileSync(
  fileURLToPath(new URL('./EinrichtungCard.tsx', import.meta.url)),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((z) => !z.trim().startsWith('//'))
  .join('\n');

describe('⛔ Die Kopfzeile zählt nur den Verkauf', () => {
  it('⛔ sie zählt AUSSCHLIESSLICH die Sperre VERKAUF', () => {
    expect(
      QUELLE,
      'Die Kopfzeile muss aus einer Menge zählen, die nur `sperre === VERKAUF` ' +
        'enthält — sonst behauptet sie mehr, als die Zeilen darunter sagen.',
    ).toMatch(/haltenDenVerkaufAuf\s*=\s*offen\.filter\(\s*\(s\)\s*=>\s*s\.sperre === 'VERKAUF'\s*\)/);
  });

  it('⛔ und ihr Satz spricht vom VERKAUF, nicht vom „Betrieb"', () => {
    expect(QUELLE).toMatch(/Aufgaben halten den Verkauf auf/);
    expect(
      QUELLE,
      'Der alte Satz „halten den Betrieb auf" warf Verkauf, Steuerausfuhr und ' +
        'Termine in eine Zahl.',
    ).not.toMatch(/halten den Betrieb auf/);
  });

  it('die Steuerausfuhr bekommt ihre EIGENE, leisere Zahl', () => {
    // Sie verschwindet nicht — sie steht nur nicht mehr als Verkaufssperre da.
    expect(QUELLE).toMatch(/haltenSonstAuf/);
    expect(QUELLE).toMatch(/warten auf die Steuerausfuhr/);
  });

  it('⚠️ und die Farbe bleibt bei der Wahrheit: nur VERKAUF trägt das Rot', () => {
    expect(QUELLE).toMatch(/sperre === 'VERKAUF'\)\s*return 'var\(--w14-danger\)'/);
  });
});
