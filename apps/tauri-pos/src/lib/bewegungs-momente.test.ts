/**
 * Der Wächter über die fünf Momente des Bezahlwegs.
 *
 * ── WARUM ES IHN GIBT (27.07.2026) ──────────────────────────────────────────
 * Die Kasse trägt eine Antiquitäten-Identität, und die Bewegung muss dieser
 * Welt gehören: ein Siegel, das sich setzt; Papier, das sich auflegt; eine
 * Sperre, die sich ruhig löst. Die Bewegungsregeln des Hauses sind hart:
 *
 *   1. NUR transform, opacity (und billige Farbtöne) werden bewegt. NIEMALS
 *      Layout-Eigenschaften — left, top, width, height, margin, padding lösen
 *      Layout aus, und `all` bewegt unabsichtlich alles mit.
 *   2. JEDE Animation braucht eine prefers-reduced-motion-Alternative. Die
 *      globale Regel in tokens.css nullt nur die DAUER, nicht die VERZÖGERUNG —
 *      wer staffelt oder verzögert, muss die Vorliebe selbst lesen.
 *   3. Dauern bleiben klein: nichts über 500 ms.
 *
 * Nichts davon sieht ein Typprüfer: `'left 160ms ease'` ist für ihn nur eine
 * Zeichenkette. Genau solche Verstöße standen am 26.07.2026 an drei Stellen im
 * Quelltext. Dieser Wächter liest die Momentdateien selbst und wird ROT, wenn
 * ein Moment fehlt oder eine Regel bricht — mit Datei und Fundstelle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const KASSE = join(HIER, '..');

/**
 * Die Dateien, in denen die Momente wohnen.
 *
 * Bis zum 14.08.2026 standen hier auch `sperre` (LocalLock.tsx) und
 * `sperrtor` (LocalLockGate.tsx): die Momente des lokalen Gerätecodes. Der
 * Code wurde mit der Ein-Code-Anordnung vom 05.08.2026 abgeschafft, die
 * beiden Flächen starben in der 0.6.0-Begehung — ihre Momente mit ihnen.
 */
const MOMENT_DATEIEN = {
  bezahlen: join(KASSE, 'screens/verkauf/BezahlenDialog.tsx'),
  karte: join(KASSE, 'screens/verkauf/CartPanel.tsx'),
  beleg: join(KASSE, 'screens/verkauf/ReceiptPreview.tsx'),
} as const;

function lese(pfad: string): string {
  return readFileSync(pfad, 'utf8');
}

describe('Die fünf Momente des Bezahlwegs', () => {
  it('Zahlungserfolg: das Siegel setzt sich (einmal, würdevoll)', () => {
    const quell = lese(MOMENT_DATEIEN.bezahlen);
    // Das Siegel muss im Erfolgs-Moment stehen und sich setzen — nicht nur
    // eine Textblase.
    expect(quell, 'Der Erfolgs-Moment braucht das Siegel-Setzen').toContain('w14-siegel-setzen');
    expect(quell, 'Der feine Gold-Ring des Siegels fehlt').toContain('w14-siegel-ring');
  });

  it('Artikel in den Korb: die Zeile tritt ein und die Summe schimmert', () => {
    const quell = lese(MOMENT_DATEIEN.karte);
    expect(quell, 'Die neue Korbzeile braucht einen Eintritt').toContain('w14-zeile-eintritt');
    // Der Schimmer der Summe kommt aus dem geteilten Baustein des Gewerks
    // „Verbindung" (SanfteMomente) — wer zuerst baut, dessen Baustein gilt.
    expect(quell, 'Die Summe muss bei Änderung schimmern (Geldschimmer)').toContain('Geldschimmer');
  });

  it('Belegvorschau: das Papier legt sich auf (Haus-Eintritt, kein harter Schnitt)', () => {
    const quell = lese(MOMENT_DATEIEN.beleg);
    // Wiederverwendung der Haus-Keyframes statt einer siebten Kopie.
    expect(quell, 'Das Papier braucht den Haus-Eintritt').toContain('w14-dialog-in');
    expect(quell, 'Der Schleier braucht die Haus-Einblendung').toContain('w14-modal-overlay-in');
  });

  it('KEIN Moment bewegt Layout-Eigenschaften oder `all`', () => {
    // `transition: 'left …'`, `width`, `margin` usw. lösen Layout aus; `all`
    // bewegt unbeabsichtigt Farbe, Rand und Schatten mit. Beides ist in den
    // Momentdateien verboten.
    const verboten =
      /(?:transition|animation)\s*:\s*['"`][^'"`]*\b(left|right|top|bottom|width|height|margin|padding|all)\b/;
    for (const [name, pfad] of Object.entries(MOMENT_DATEIEN)) {
      const quell = lese(pfad);
      const zeilen = quell.split('\n');
      zeilen.forEach((zeile, i) => {
        const treffer = verboten.exec(zeile);
        expect(
          treffer,
          `${name}:${i + 1} bewegt eine Layout-Eigenschaft (${treffer?.[1] ?? ''}): ${zeile.trim()}`,
        ).toBeNull();
      });
    }
  });

  it('jede Animation hat eine reduced-motion-Alternative', () => {
    // Die globale Regel in tokens.css nullt animation-duration und
    // transition-duration — sie deckt also jede verzögerungsfreie Einblendung,
    // deren Dauer eine Marke ist. NICHT gedeckt sind (a) eine Verzögerung oder
    // Staffelung und (b) ein JS-Timer, der einen Abgang hinauszögert. Wer eines
    // von beidem benutzt, muss die Vorliebe selbst lesen.
    for (const [name, pfad] of Object.entries(MOMENT_DATEIEN)) {
      const quell = lese(pfad);
      const verzoegert = /animationDelay|--w14-stagger|animation-delay/.test(quell);
      if (verzoegert) {
        expect(
          /prefers-reduced-motion|useReducedMotion/.test(quell),
          `${name} verzögert eine Animation, liest die Bewegungs-Vorliebe aber nirgends`,
        ).toBe(true);
      }
      // Jede animation:-Zeichenkette muss ihre Dauer aus einer Marke beziehen,
      // sonst greift die globale reduced-motion-Nullung nicht sichtbar genug
      // und die Bewegungssprache zerfällt in rohe Zahlen.
      const zeilen = quell.split('\n');
      zeilen.forEach((zeile, i) => {
        const treffer = /animation\s*:\s*['"`]([^'"`]+)['"`]/.exec(zeile);
        if (!treffer) return;
        expect(
          /var\(--w14-dur-/.test(treffer[1] as string),
          `${name}:${i + 1} animiert mit roher Dauer statt einer Marke: ${treffer[1]}`,
        ).toBe(true);
      });
    }
  });

  it('keine Dauer über 500 ms in den Momentdateien', () => {
    // Bewusste Momente (Zahlungserfolg) dürfen bis 500 ms; darüber ist nichts
    // würdevoll mehr, es ist langsam. Marken-Dauern (var(--w14-dur-…)) sind
    // im Themenmodul gedeckelt und hier ausgenommen.
    const dauer = /\b(\d{3,})ms\b/g;
    for (const [name, pfad] of Object.entries(MOMENT_DATEIEN)) {
      const zeilen = lese(pfad).split('\n');
      zeilen.forEach((zeile, i) => {
        for (const treffer of zeile.matchAll(dauer)) {
          const ms = Number(treffer[1]);
          expect(ms, `${name}:${i + 1} trägt ${ms} ms — über dem Deckel von 500 ms`).toBeLessThanOrEqual(500);
        }
      });
    }
  });
});
