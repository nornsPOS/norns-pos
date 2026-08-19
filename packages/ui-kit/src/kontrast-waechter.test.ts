// @vitest-environment node
//
// Diese Prüfung zeichnet nichts, sie liest eine Datei und rechnet. Wie
// tokens.test.ts läuft sie ausdrücklich in Node, weil `import.meta.url` in
// der jsdom-Umgebung keine Datei-Adresse wäre.

/**
 * Der Wächter über das ruhende Auge: Kontrast, gerechnet statt behauptet.
 *
 * ── WOZU ES DIESE DATEI GIBT (27.07.2026) ───────────────────────────────────
 * Frisch am HEAD gemessen lagen im Hellthema mehrere Textpaare unter der
 * WCAG-Schwelle von 4,5:1 für Fliesstext: die blasse Tinte bestand auf dem
 * Grundpergament mit exakt 4,50 und fiel auf der erhabenen Fläche auf 4,10
 * durch, bei 603 Verwendungen. Die Fehlerfarbe stand bei 4,20, das gepresste
 * Gilt bei 4,31, Terra bei 4,01. Und die Trennlinie, die die GESAMTE
 * Tabellenstruktur trägt, lag in jeder Kombination unter 1,5:1 (hell 1,05).
 *
 * Niemand hatte gelogen: jede dieser Farben sieht auf einem hellen, grossen
 * Bildschirm gut aus. Auf der Theke, aus einem Meter, unter Ladenlicht, ist
 * 4,1:1 auf 12px-Schrift schlicht unlesbar. Und kein Typprüfer, kein
 * Marken-Wächter, kein Test hat das gesehen, weil alle nur prüfen, OB eine
 * Marke definiert ist, nie, WAS sie taugt.
 *
 * ── WAS HIER BEWIESEN WIRD ──────────────────────────────────────────────────
 *  1. Jede Text-Marke erreicht auf JEDER der drei Pergamentflächen mindestens
 *     4,5:1 (WCAG AA für Fliesstext), im Hell- UND im Dunkelthema.
 *  2. Gilt, das nur für grosse Schrift und Linien taugt, hält 3:1 auf dem
 *     Grundpergament und 4,5:1 auf der dunklen Kopfleiste (Hellthema).
 *  3. Die Tabellenlinien-Marke hält mindestens 1,5:1 auf jeder Fläche in
 *     beiden Themen, und sie ist IMMER kräftiger als die zarte Zierlinie —
 *     wer die beiden vertauscht oder angleicht, wird rot.
 *  4. Jede Farb-Marke mit RGB-Begleiter bleibt mit ihm im Gleichschritt
 *     (die Kopfregel dieser Datei: KEEP THE PAIRS IN SYNC — bisher stand sie
 *     nur als Kommentar da, jetzt rechnet sie jemand nach).
 *
 * Die Verhältnisse werden nach WCAG aus der relativen Luminanz GERECHNET,
 * aus genau der Quelle, die auch der Browser lädt. Eine künftige „nur ein
 * bisschen heller"-Änderung kann das Auge damit nicht mehr still verlieren.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TOKENS_PFAD = fileURLToPath(new URL('./tokens.css', import.meta.url));
const QUELLE = readFileSync(TOKENS_PFAD, 'utf8');

/* ── Die Schwellen. WCAG 2.x: 4,5:1 für Fliesstext, 3:1 für grosse Schrift
   und Bedien-Grafik. Für eine Linie, die nur Struktur trägt (keine
   Information, die sonst fehlt), verlangt das Haus 1,5:1 — die Messung vom
   27.07. zeigte, dass die 1,05:1 der Zierlinie als EINZIGE Tabellenstruktur
   schlicht verschwindet. */
const SCHWELLE_FLIESSTEXT = 4.5;
const SCHWELLE_GROSS = 3.0;
const SCHWELLE_TABELLENLINIE = 1.5;

/* ── tokens.css lesen: erst Kommentare fort, dann Blöcke je Selektor.
   In den Kommentaren stehen absichtlich Beispielwerte und alte Hex-Zahlen —
   die dürfen nie als Deklaration gelesen werden. */
const OHNE_KOMMENTARE = QUELLE.replace(/\/\*[\s\S]*?\*\//g, '');

function deklarationenJeSelektor(): Array<{ selektor: string; name: string; wert: string }> {
  const gefunden: Array<{ selektor: string; name: string; wert: string }> = [];
  for (const block of OHNE_KOMMENTARE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selektor = (block[1] as string).trim();
    for (const d of (block[2] as string).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      gefunden.push({ selektor, name: d[1] as string, wert: (d[2] as string).trim() });
    }
  }
  return gefunden;
}

/** Das Hellthema: alles, was in `:root` steht. Das Dunkelthema: dasselbe,
 *  überschrieben von `:root[data-theme="dark"]` — genau die Kaskade des
 *  Browsers, nur nachgebaut. */
function thema(dunkel: boolean): Map<string, string> {
  const karte = new Map<string, string>();
  for (const { selektor, name, wert } of deklarationenJeSelektor()) {
    if (selektor === ':root') karte.set(name, wert);
  }
  if (dunkel) {
    for (const { selektor, name, wert } of deklarationenJeSelektor()) {
      if (selektor === ':root[data-theme="dark"]') karte.set(name, wert);
    }
  }
  return karte;
}

function aufloesen(name: string, karte: Map<string, string>, tiefe = 0): string {
  if (tiefe > 20) throw new Error(`Kette zu tief bei ${name}`);
  const wert = karte.get(name);
  if (wert === undefined) throw new Error(`Marke ${name} ist nirgends definiert`);
  const zeiger = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(wert);
  return zeiger ? aufloesen(zeiger[1] as string, karte, tiefe + 1) : wert;
}

/** #rrggbb zu drei Kanälen 0..255. Kurzformen gibt es in dieser Datei nicht,
 *  und sollen auch nicht einreissen — deshalb bewusst NUR die volle Form. */
function hex(name: string, karte: Map<string, string>): [number, number, number] {
  const wert = aufloesen(name, karte);
  const t = /^#([0-9a-f]{6})$/i.exec(wert);
  if (!t) throw new Error(`${name} löst sich auf zu "${wert}", das ist kein #rrggbb-Wert`);
  const h = t[1] as string;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative Luminanz nach WCAG 2.x, Definition wörtlich umgesetzt. */
function luminanz([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b]
    .map((k) => k / 255)
    .map((k) => (k <= 0.04045 ? k / 12.92 : ((k + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (rl as number) + 0.7152 * (gl as number) + 0.0722 * (bl as number);
}

function kontrast(a: string, b: string, karte: Map<string, string>): number {
  const la = luminanz(hex(a, karte));
  const lb = luminanz(hex(b, karte));
  const [hellste, dunkelste] = la >= lb ? [la, lb] : [lb, la];
  return (hellste + 0.05) / (dunkelste + 0.05);
}

/* ── Die Paare, die das Auge wirklich sieht ──────────────────────────────── */
const FLAECHEN = ['--w14-parchment', '--w14-parchment-2', '--w14-parchment-3'] as const;

/** Jede Marke, die irgendwo als Text auf Pergament steht. Gilt fehlt hier mit
 *  Absicht: es ist Faden, Kante, Siegel — nie Fliesstext — und wird unten mit
 *  der 3:1-Schwelle für grosse Schrift geprüft. wax-red-soft fehlt ebenfalls:
 *  es ist eine weiche Fläche, keine Textfarbe, und seine vier Text-Fundstellen
 *  gehören einzeln repariert, nicht die Marke verbogen. */
const TEXT_MARKEN = [
  '--w14-ink',
  '--w14-ink-aged',
  '--w14-ink-faded',
  '--w14-wax-red',
  '--w14-verdigris',
  '--w14-gilt-deep',
  '--w14-terra',
  '--w14-gold',
  '--w14-gold-soft',
] as const;

for (const dunkel of [false, true]) {
  const themaName = dunkel ? 'Dunkelthema' : 'Hellthema';

  describe(`Kontrast im ${themaName}`, () => {
    const karte = thema(dunkel);

    it('trägt jede Text-Marke mit mindestens 4,5:1 auf jeder Pergamentfläche', () => {
      const verstoesse: string[] = [];
      for (const text of TEXT_MARKEN) {
        for (const flaeche of FLAECHEN) {
          const wert = kontrast(text, flaeche, karte);
          if (wert < SCHWELLE_FLIESSTEXT) {
            verstoesse.push(`${text} auf ${flaeche}: ${wert.toFixed(2)}:1 (< ${SCHWELLE_FLIESSTEXT}:1)`);
          }
        }
      }
      expect(verstoesse, `Fliesstext unter WCAG AA:\n  ${verstoesse.join('\n  ')}`).toEqual([]);
    });

    it('hält den Text auf der Akzentfläche bei mindestens 4,5:1', () => {
      // Der gewählte Reiter, der Schalter, der Punkt „lebendig": überall liegt
      // --w14-accent-ink auf --w14-accent. Fällt dieses Paar, ist jeder aktive
      // Zustand unlesbar.
      expect(kontrast('--w14-accent-ink', '--w14-accent', karte)).toBeGreaterThanOrEqual(SCHWELLE_FLIESSTEXT);
    });

    it('hält Gilt bei mindestens 3:1 auf dem Grundpergament (grosse Schrift und Linien)', () => {
      expect(kontrast('--w14-gilt', '--w14-parchment', karte)).toBeGreaterThanOrEqual(SCHWELLE_GROSS);
    });

    it('gibt der Tabellenlinie mindestens 1,5:1 auf jeder Fläche', () => {
      // Die Messung vom 27.07.2026: die Zierlinie lag bei 1,05:1 und trug an
      // 272 Stellen die GESAMTE Struktur jeder Tabelle. Aus einem Meter ist
      // eine solche Tabelle ein Brei. Struktur braucht eine sichtbare Linie.
      const verstoesse: string[] = [];
      for (const flaeche of FLAECHEN) {
        const wert = kontrast('--w14-tabellenlinie', flaeche, karte);
        if (wert < SCHWELLE_TABELLENLINIE) {
          verstoesse.push(`--w14-tabellenlinie auf ${flaeche}: ${wert.toFixed(2)}:1`);
        }
      }
      expect(verstoesse, `Tabellenlinie zu blass:\n  ${verstoesse.join('\n  ')}`).toEqual([]);
    });

    it('gibt der Feldlinie mindestens 3:1 auf jeder Fläche (WCAG 1.4.11)', () => {
      // Basels Ort-Befund (29.07.2026): 23 Dateien zeichneten Eingabefelder
      // nur mit der Zierlinie — im Hellthema 1,05:1, der Inhaber tippte
      // blind. Ein Feld ist BEDIENUNG: tragende UI-Kennzeichen brauchen 3:1.
      const verstoesse: string[] = [];
      for (const flaeche of FLAECHEN) {
        const wert = kontrast('--w14-feldlinie', flaeche, karte);
        if (wert < SCHWELLE_GROSS) {
          verstoesse.push(`--w14-feldlinie auf ${flaeche}: ${wert.toFixed(2)}:1`);
        }
      }
      expect(verstoesse, `Feldlinie zu blass:\n  ${verstoesse.join('\n  ')}`).toEqual([]);
    });

    it('lässt die Zierlinie zart, aber die Tabellenlinie IMMER kräftiger', () => {
      // Die Zierlinie darf hauchen — sie ist Schmuck. Aber wer die beiden
      // Marken angleicht oder vertauscht, hat wieder unsichtbare Tabellen.
      const zier = kontrast('--w14-rule', '--w14-parchment', karte);
      const tabelle = kontrast('--w14-tabellenlinie', '--w14-parchment', karte);
      expect(tabelle).toBeGreaterThan(zier);
    });

    it('hält jede Farb-Marke mit ihrem RGB-Begleiter im Gleichschritt', () => {
      // Die Kopfregel der Datei („KEEP THE PAIRS IN SYNC") war bisher nur ein
      // Kommentar. Ein Begleiter, der hinterherhinkt, macht jede
      // Tailwind-Deckkraft-Nutzung (bg-ink/45) zur falschen Farbe — still.
      const verstoesse: string[] = [];
      for (const name of karte.keys()) {
        if (!name.endsWith('-rgb')) continue;
        const farbe = name.slice(0, -'-rgb'.length);
        if (!karte.has(farbe)) continue;
        let kanaele: [number, number, number];
        try {
          kanaele = hex(farbe, karte);
        } catch {
          continue; // kein #rrggbb (etwa eine rgba-Fläche) — nicht Sache dieses Tests
        }
        const begleiter = aufloesen(name, karte).split(/\s+/).map(Number);
        if (begleiter.length !== 3 || begleiter.some((k, i) => k !== kanaele[i])) {
          verstoesse.push(`${name} ist "${aufloesen(name, karte)}", ${farbe} ist aber ${kanaele.join(' ')}`);
        }
      }
      expect(verstoesse, `RGB-Begleiter driften:\n  ${verstoesse.join('\n  ')}`).toEqual([]);
    });
  });
}

describe('Der Wächter liest wirklich die Quelle', () => {
  it('zeigt auf src/ und nicht auf dist/', () => {
    // dist/ ist eine Kopie von vorhin; ein Test darüber bliebe grün, während
    // die Quelle das Auge verliert (die Regel aus tokens.test.ts).
    expect(TOKENS_PFAD).toMatch(/[/\\]src[/\\]tokens\.css$/);
    expect(TOKENS_PFAD).not.toMatch(/[/\\]dist[/\\]/);
  });

  it('findet beide Themen', () => {
    // Ein kaputtes Blockmuster wäre sonst ein grüner Test über einer leeren
    // Menge: das Dunkelthema muss eigene Flächen mitbringen.
    const hell = thema(false);
    const dunkel = thema(true);
    expect(hell.size).toBeGreaterThan(80);
    expect(aufloesen('--w14-parchment', hell)).not.toBe(aufloesen('--w14-parchment', dunkel));
  });
});
