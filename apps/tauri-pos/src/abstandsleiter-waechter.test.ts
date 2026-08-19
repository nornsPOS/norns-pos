// @vitest-environment node
//
// Diese Prüfung zeichnet nichts, sie liest Quelldateien — darum Node, nicht
// jsdom (dasselbe Muster wie schriftleiter-waechter.test.ts nebenan).

/**
 * Der Wächter über die Abstandsleiter der GANZEN Kasse.
 *
 * ── WOZU ES IHN GIBT ────────────────────────────────────────────────────────
 * Am 27.07.2026 über ALLE rohen gap/padding-Bausteine gezählt: 1346 Stück,
 * davon 464 auf den vier Halbstufen 2/6/10/14, die die Leiter bis dahin gar
 * nicht kannte (die alte Zählung sah nur var()-Verwendungen). Die Leiter
 * wurde um genau diese gelebten Stufen erweitert, die Kasse stieg mit über
 * tausend Stellen darauf — und dieser Wächter hält sie dort. Eine einzelne
 * rohe `padding: '9px 13px'` sieht im Diff harmlos aus; hundert davon sind
 * wieder das alte Rauschen.
 *
 * ── WAS ER BEWEIST ──────────────────────────────────────────────────────────
 * Jeder gap-, rowGap-, columnGap- und padding-Wert in jeder .tsx unter src/
 * ist entweder
 *   a) ausschliesslich aus existierenden Marken und Nullen gebaut
 *      (`'var(--…)'`, auch mehrteilig wie `'var(--…) 0'`, auch im
 *      Bedingungsausdruck, solange JEDER Zweig so gebaut ist), oder
 *   b) ausdrücklich freigestellt — je Datei (Papier/Kunst, Liste unten mit
 *      Grund) oder je Zeile (`abstandsleiter-frei:` mit Grund).
 * Alles andere ist rot. Nicht beweisbar in Ordnung heisst nicht in Ordnung —
 * die Lehre aus der Rot-Probe des Schriftleiter-Wächters (ein Erlaubnismuster
 * übersieht genau das, was es nie erwartet hat) gilt hier vom ersten Tag.
 *
 * ── WARUM DIE QUELLE UND NICHT dist/ ────────────────────────────────────────
 * Die Leiter wird aus `packages/ui-kit/src/tokens.css` gelesen; `dist/` ist
 * eine Kopie von vorhin (am 27.07. live erlebt: 14 Stunden alte Kopie, Marken
 * leer, App in der Altgestalt).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));

/** Papier- und Kunstflächen ausserhalb der Leiter — identisch zur Schriftliste. */
const AUSGENOMMEN: ReadonlyMap<string, string> = new Map([
  [
    'screens/verkauf/ReceiptPreview.tsx',
    'Papier-Mimikry: Masse folgen der 42-Zeichen-Spalte des Bondruckers.',
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
const FREI = 'abstandsleiter-frei:';

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

const LEITER_PFAD = join(HIER, '../../../packages/ui-kit/src/tokens.css');
const LEITER_QUELLE = readFileSync(LEITER_PFAD, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const DEFINIERTE_MARKEN = new Set(
  [...LEITER_QUELLE.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string),
);

/** Ein Wertausdruck ist in Ordnung, wenn nach Abzug aller existierenden
 *  `'var(…)'`-Trauben und nackter Nullen nichts Rohes übrig bleibt. */
function pruefeWert(wert: string, verstoesse: string[], zeileNr: number): void {
  const marken = [...wert.matchAll(/var\(([^)]+)\)/g)].map((m) => (m[1] as string).trim());
  for (const marke of marken) {
    if (!DEFINIERTE_MARKEN.has(marke)) verstoesse.push(`Z${zeileNr}: tote Marke: ${marke}`);
  }
  // Erst die var-Trauben abziehen, dann alleinstehende Nullen; was danach noch
  // Ziffern oder Anführungszeichen trägt, ist roh.
  const rest = wert
    .replace(/'(?:var\([^)]+\)|0)(?:\s+(?:var\([^)]+\)|0))*'/g, '')
    .replace(/(?<![\w.'])0(?![\w.'])/g, '');
  if (marken.length === 0 && !/^\s*$/.test(rest) === false && wert.trim() !== '0') {
    // kein var und kein blosses 0 — unten fängt die Ziffernprüfung es ohnehin
  }
  if (/[0-9'"]/.test(rest)) verstoesse.push(`Z${zeileNr}: roher Anteil: ${wert}`);
}

describe('Abstandsleiter der Kasse', () => {
  it('findet die Flächen und die Leiter', () => {
    expect(FLAECHEN.length).toBeGreaterThanOrEqual(80);
    expect(DEFINIERTE_MARKEN.has('--w14-abstand-10')).toBe(true);
    for (const pfad of AUSGENOMMEN.keys()) {
      expect(() => readFileSync(join(HIER, pfad), 'utf8'), `Ausnahme fehlt: ${pfad}`).not.toThrow();
    }
  });

  it.each(FLAECHEN)('%s: jeder Abstand ist eine existierende Stufe', (name) => {
    const quelle = readFileSync(join(HIER, name), 'utf8');
    const zeilen = quelle.split('\n');
    const verstoesse: string[] = [];
    zeilen.forEach((zeile, i) => {
      for (const treffer of zeile.matchAll(
        /(?:padding(?:Top|Right|Bottom|Left)?|gap|rowGap|columnGap):\s*([^,\n}]+)/g,
      )) {
        if (zeile.includes(FREI)) {
          const grund = zeile.split(FREI)[1]?.trim() ?? '';
          if (grund.length < 8) verstoesse.push(`Z${i + 1}: Freistellung ohne Grund`);
          continue;
        }
        const wert = (treffer[1] as string).trim();
        if (wert === '0') continue;
        pruefeWert(wert, verstoesse, i + 1);
      }
    });
    expect(verstoesse, `in ${name}:\n  ${verstoesse.join('\n  ')}`).toEqual([]);
  });
});
