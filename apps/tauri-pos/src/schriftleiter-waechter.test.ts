// @vitest-environment node
//
// Diese Prüfung zeichnet nichts, sie liest Quelldateien — darum Node, nicht
// jsdom (dasselbe Muster wie tokens.test.ts im ui-kit).

/**
 * Der Wächter über die Schriftleiter der GANZEN Kasse.
 *
 * ── WOZU ES IHN GIBT ────────────────────────────────────────────────────────
 * Am 27.07.2026 gemessen: 1041 rohe Schriftgrössen in 60 verschiedenen Werten,
 * davon zwölf kaum unterscheidbare Stufen zwischen 0,70rem und 0,95rem. Die
 * Leiter in `tokens.css` (ui-kit) existierte da schon MIT Zuordnungstabelle —
 * nur benutzt hat sie niemand. Genau diese Lücke zwischen „Leiter steht" und
 * „Flächen steigen darauf" ist die Sorte Drift, die kein Auge im Diff bemerkt:
 * eine einzelne 0.83rem sieht in der Durchsicht harmlos aus.
 *
 * ── WAS ER BEWEIST ──────────────────────────────────────────────────────────
 * Jeder fontSize-Wert in jeder .tsx unter src/ ist entweder
 *   a) eine existierende Stufe der Leiter (`'var(--…)'`, auch im
 *      Bedingungsausdruck, solange JEDER Zweig eine Stufe ist), oder
 *   b) ausdrücklich freigestellt — je Datei (Liste unten, mit Grund) oder je
 *      Zeile (`schriftleiter-frei:` im Kommentar derselben Zeile, mit Grund).
 * Alles andere ist rot. Nicht beweisbar in Ordnung heisst nicht in Ordnung.
 *
 * ── DIE LEHRE AUS DER EIGENEN ROT-PROBE ─────────────────────────────────────
 * Der erste Wurf fing rohe Zahlen mit einem Muster und tote Marken mit einem
 * ZWEITEN Muster `[a-z0-9-]+`. Ein absichtlich eingebautes
 * `--w14-schrift-GIBTSNICHT-…` blieb GRÜN: der Grossbuchstabe passte auf
 * keines der beiden Muster, also wurde er schlicht nie angesehen. Ein Wächter
 * aus Erlaubnismustern übersieht genau das, was er nie erwartet hat. Darum
 * sammelt dieser hier ALLES ein und lässt nur Beweisbares durch.
 *
 * ── WARUM DIE QUELLE UND NICHT dist/ ────────────────────────────────────────
 * Die Leiter wird aus `packages/ui-kit/src/tokens.css` gelesen. `dist/` ist
 * eine Kopie von vorhin; ein Wächter, der die Kopie liest, bliebe grün,
 * während die Quelle eine Stufe verliert (am 27.07. live erlebt: 14 Stunden
 * alte Kopie, drei Marken leer, die App in der Altschrift).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));

/**
 * Dateien AUSSERHALB der Leiter — jede mit ihrem Grund. Neue Einträge nur mit
 * Begründung; ein Eintrag ohne erkennbaren Papier- oder Kunstgrund gehört in
 * eine Durchsicht, nicht in diese Liste.
 */
const AUSGENOMMEN: ReadonlyMap<string, string> = new Map([
  [
    'screens/verkauf/ReceiptPreview.tsx',
    'Papier-Mimikry: die Grössen folgen der 42-Zeichen-Spalte des Bondruckers.',
  ],
  [
    'screens/secondary/Schreiben.tsx',
    'A4-Briefvorschau in Druckeinheiten (mm, pt) — Papiertreue, nicht Bildschirm.',
  ],
  [
    'screens/zielkarte/instruments.tsx',
    'Gemaltes Instrumentenbrett (SVG-Kunstwerk) mit eigenem inneren Massstab.',
  ],
]);

/** Kommentar-Marke, die EINE Zeile freistellt. Grund dahinter ist Pflicht. */
const FREI = 'schriftleiter-frei:';

/** Alle .tsx unter src/, rekursiv, ohne Tests. */
function alleFlaechen(ordner: string): string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(join(HIER, ordner), { withFileTypes: true })) {
    const pfad = ordner === '.' ? eintrag.name : `${ordner}/${eintrag.name}`;
    if (eintrag.isDirectory()) gefunden.push(...alleFlaechen(pfad));
    else if (eintrag.name.endsWith('.tsx') && !eintrag.name.includes('.test.'))
      gefunden.push(pfad);
  }
  return gefunden.sort();
}

const FLAECHEN = alleFlaechen('.').filter((p) => !AUSGENOMMEN.has(p));

/** tokens.css der Leiter — ausdrücklich die QUELLE des Arbeitsbereichs-Pakets. */
const LEITER_PFAD = join(HIER, '../../../packages/ui-kit/src/tokens.css');
const LEITER_QUELLE = readFileSync(LEITER_PFAD, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const DEFINIERTE_MARKEN = new Set(
  [...LEITER_QUELLE.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string),
);

describe('Schriftleiter der Kasse', () => {
  it('findet die Flächen und die Leiter', () => {
    // Bricht der Ordner- oder Leiterpfad, sollen die Prüfungen unten nicht
    // leer durchwinken, sondern DIESE hier laut werden.
    expect(FLAECHEN.length).toBeGreaterThanOrEqual(80);
    expect(DEFINIERTE_MARKEN.has('--w14-schrift-zeile')).toBe(true);
    // Und jede Ausnahme muss noch existieren — sonst ist die Liste Geröll.
    for (const pfad of AUSGENOMMEN.keys()) {
      expect(() => readFileSync(join(HIER, pfad), 'utf8'), `Ausnahme fehlt: ${pfad}`).not.toThrow();
    }
  });

  it.each(FLAECHEN)('%s: jede Schriftgrösse ist eine existierende Stufe', (name) => {
    const quelle = readFileSync(join(HIER, name), 'utf8');
    const zeilen = quelle.split('\n');
    const verstoesse: string[] = [];
    zeilen.forEach((zeile, i) => {
      for (const treffer of zeile.matchAll(/fontSize:\s*([^,\n}]+)/g)) {
        if (zeile.includes(FREI)) {
          // Freigestellt — aber nur mit Grund: die Marke allein genügt nicht.
          const grund = zeile.split(FREI)[1]?.trim() ?? '';
          if (grund.length < 8) verstoesse.push(`Z${i + 1}: Freistellung ohne Grund`);
          continue;
        }
        const wert = (treffer[1] as string).trim();
        const marken = [...wert.matchAll(/var\(([^)]+)\)/g)].map((m) => (m[1] as string).trim());
        if (marken.length === 0) {
          verstoesse.push(`Z${i + 1}: kein var(): ${wert}`);
          continue;
        }
        for (const marke of marken) {
          if (!DEFINIERTE_MARKEN.has(marke)) verstoesse.push(`Z${i + 1}: tote Marke: ${marke}`);
        }
        const rest = wert.replace(/'var\([^)]+\)'/g, '');
        if (/[0-9'"]/.test(rest)) verstoesse.push(`Z${i + 1}: roher Anteil neben var(): ${wert}`);
      }
    });
    expect(verstoesse, `in ${name}:\n  ${verstoesse.join('\n  ')}`).toEqual([]);
  });
});
