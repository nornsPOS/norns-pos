/**
 * Der Wächter über die Rollbalken.
 *
 * ── WARUM (26.07.2026, Basels Dekret „Feinschliff besonders auf Windows") ──
 * Im ganzen Programm gab es NULL Rollbalken-Gestaltung — auf Windows bekam
 * jede lange Liste (Lager, Katalog, Bezahl-Korpus, Tagebuch, Bestellungen)
 * den klobigen grauen Systembalken, der das Pergament zerschneidet. Ein
 * einziger globaler Block in tokens.css veredelt alle Listen auf einmal:
 * Tauri rendert auf Windows über WebView2/Chromium, dort greift
 * `::-webkit-scrollbar`; `scrollbar-width`/`scrollbar-color` decken Firefox
 * und neue Chromium-Versionen. Die Farben kommen aus den Themen-Marken und
 * folgen damit hell wie dunkel automatisch.
 *
 * Der Test liest die ausgelieferte tokens.css und verlangt, dass der Block
 * existiert und aus Marken schöpft statt aus festen Farben.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Kein `import.meta.url`: die jsdom-Umgebung dieses Pakets liefert dafür kein
// file-Schema. Vitest läuft mit dem Paketverzeichnis als Arbeitsverzeichnis.
const TOKENS = join(process.cwd(), 'src/tokens.css');

describe('Rollbalken-Gestaltung', () => {
  const css = readFileSync(TOKENS, 'utf8');

  it('gestaltet die Chromium/WebView2-Balken', () => {
    expect(css).toContain('::-webkit-scrollbar');
    expect(css).toContain('::-webkit-scrollbar-thumb');
  });

  it('deckt auch den Standardweg (scrollbar-width/-color)', () => {
    expect(css).toContain('scrollbar-width');
    expect(css).toContain('scrollbar-color');
  });

  it('der Daumen schöpft aus einer Themen-Marke, nicht aus einer festen Farbe', () => {
    const daumen = css.match(/::-webkit-scrollbar-thumb\s*{[^}]*}/);
    expect(daumen, 'Kein thumb-Block gefunden').not.toBeNull();
    expect(daumen?.[0] ?? '').toMatch(/var\(--w14-[a-z0-9-]+\)/);
  });
});
