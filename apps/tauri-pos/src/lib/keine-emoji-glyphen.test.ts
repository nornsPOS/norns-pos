/**
 * Der Wächter gegen Emoji und wacklige Symbol-Glyphen in der Bedienoberfläche.
 *
 * ── WARUM (Basels Dekret, 26.07.2026) ──────────────────────────────────────
 * Auf Windows rendert WebView2 Zeichen wie 🔒 ⌛ 📷 als bunte Segoe-Emoji —
 * grell, plastisch, und sie zerschneiden die Antiquitäten-Gestaltung der
 * Kasse. Auch die Zier-Glyphen ✦ ✧ ◈ ◫ ↻ ↺ fallen je nach Schriftausstattung
 * unterschiedlich aus. Das kommende Kassengerät läuft auf Windows; dort darf
 * kein einziges dieser Zeichen mehr im Chrome oder in den Flächen stehen.
 *
 * Ersatz sind SVG-Icons (ui-kit `Icon` mit lucide, oder die hauseigenen
 * Inline-SVGs in `app/chrome/Icons.tsx`) — Strich statt Farbfläche, immer
 * gleich, in hell und dunkel.
 *
 * Emoji in INHALTEN (Produktnotizen, Kundennachrichten) sind Daten und
 * bleiben; dieser Test liest nur den QUELLTEXT der Oberfläche, ohne
 * Kommentare.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const KASSE = join(HIER, '..');

/** Die verbannten Zeichen, jedes mit seinem Fundort vom 26.07.2026. */
const VERBANNT = ['🔒', '⌛', '📷', '✦', '✧', '◈', '◫', '↻', '↺'] as const;

function dateien(wurzel: string, endungen: readonly string[]): string[] {
  const gefunden: string[] = [];
  const gehe = (ort: string): void => {
    let eintraege: string[];
    try {
      eintraege = readdirSync(ort);
    } catch {
      return;
    }
    for (const name of eintraege) {
      if (name === 'node_modules' || name === 'dist' || name === 'src-tauri') continue;
      const voll = join(ort, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (endungen.some((e) => name.endsWith(e))) gefunden.push(voll);
    }
  };
  gehe(wurzel);
  return gefunden;
}

/** Kommentare raus — dort dürfen die Zeichen als Dokumentation weiterleben. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('Keine Emoji-Glyphen in der Oberfläche', () => {
  it('kein verbanntes Zeichen ausserhalb von Kommentaren', () => {
    const funde: string[] = [];
    for (const datei of dateien(KASSE, ['.ts', '.tsx'])) {
      if (/\.test\.tsx?$/.test(datei)) continue;
      const zeilen = ohneKommentare(readFileSync(datei, 'utf8')).split('\n');
      zeilen.forEach((zeile, i) => {
        for (const zeichen of VERBANNT) {
          if (zeile.includes(zeichen)) {
            funde.push(`${zeichen}  ${datei.replace(KASSE, 'src')}:${i + 1}`);
          }
        }
      });
    }
    expect(funde, `Verbannte Zeichen gefunden:\n${funde.join('\n')}`).toEqual([]);
  });
});
