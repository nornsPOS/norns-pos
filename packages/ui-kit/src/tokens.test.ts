// @vitest-environment node
//
// Diese Prüfung zeichnet nichts, sie liest eine Datei. In der jsdom-Umgebung
// des Pakets ist `import.meta.url` keine Datei-Adresse, und der Pfad zur
// Quelle liesse sich gar nicht bilden. Deshalb ausdrücklich Node.

/**
 * Der Wächter über die zwei Leitern.
 *
 * ── WOZU ES DIESE DATEI GIBT ────────────────────────────────────────────────
 * Basel am Tresen: „zu viele Dinge, chaotisch, nicht einfach und elegant, das
 * Design überlagert sich."
 *
 * Gezählt statt geraten: 48 verschiedene Schriftgrössen bei 1062 Verwendungen,
 * und zwei Abstandsleitern nebeneinander, von denen ausgerechnet die als
 * veraltet markierte alle 289 Verwendungen trug. `tokens.css` bringt beides in
 * je EINE Leiter. Diese Datei beweist, dass die Leitern tragen.
 *
 * ── WARUM DIE QUELLE UND NICHT dist/ ────────────────────────────────────────
 * Dieses Paket liefert seine Stilblätter über `dist/` aus (package.json
 * exports). Ein Test, der `dist/tokens.css` liest, bliebe grün, während die
 * Quelle kaputt ist, denn `dist/` ist eine Kopie von vorhin. Rot-Grün wäre
 * damit wertlos. Der Pfad unten zeigt deshalb ausdrücklich auf `src/`, und der
 * erste Test besteht darauf, dass das so bleibt.
 *
 * ── WAS HIER BEWIESEN WIRD ──────────────────────────────────────────────────
 *  1. Keine Marke liest sich selbst. Genau dieser Fehler stand am 26.07.2026
 *     live in der Datei (`--w14-leading-body: var(--w14-leading-body)`) und hat
 *     den Zeilenabstand der ganzen Kasse still auf `normal` fallen lassen.
 *  2. Beide Leitern steigen lückenlos, ohne Doppelung, jede Stufe definiert.
 *  3. Kein Abstand hat sich verschoben: jeder alte Name löst sich auf genau den
 *     Pixelwert auf, den er vor dem Umbau hatte.
 *  4. Die Zuordnungstabelle deckt jede der 48 gemessenen Schriftgrössen ab,
 *     zeigt auf eine Stufe, die es wirklich gibt, nennt die NÄCHSTE Stufe und
 *     rechnet die Verschiebung richtig aus.
 *
 * Die Tabelle wird aus dem Kommentarblock in `tokens.css` GELESEN, nicht hier
 * nachgeschrieben. Eine Kopie hier wäre eine zweite Wahrheit und könnte von der
 * Leiter abdriften, ohne dass etwas rot wird.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TOKENS_PFAD = fileURLToPath(new URL('./tokens.css', import.meta.url));
const QUELLE = readFileSync(TOKENS_PFAD, 'utf8');

/** Der Quelltext ohne Kommentare. Nur so sind Deklarationen echte Deklarationen:
 *  in den Kommentaren stehen absichtlich Beispielzeilen (etwa der alte,
 *  selbstbezügliche Zeilenabstand), die sonst als gültige Marken gelesen
 *  würden und einen Fehlalarm auslösten. */
const OHNE_KOMMENTARE = QUELLE.replace(/\/\*[\s\S]*?\*\//g, '');

/** Jede Deklaration `--name: wert`, in Reihenfolge des Auftretens. */
function deklarationen(): Array<{ name: string; wert: string }> {
  const gefunden: Array<{ name: string; wert: string }> = [];
  for (const treffer of OHNE_KOMMENTARE.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    gefunden.push({ name: treffer[1] as string, wert: (treffer[2] as string).trim() });
  }
  return gefunden;
}

/** Der zuletzt gewinnende Wert je Marke (die Kaskade nimmt die letzte Zeile). */
function marken(): Map<string, string> {
  const karte = new Map<string, string>();
  for (const { name, wert } of deklarationen()) karte.set(name, wert);
  return karte;
}

/** Löst `var(--a)` so lange auf, bis eine echte Zahl mit Einheit dasteht. */
function aufloesen(name: string, karte: Map<string, string>, tiefe = 0): string {
  if (tiefe > 20) throw new Error(`Kette zu tief bei ${name}`);
  const wert = karte.get(name);
  if (wert === undefined) throw new Error(`Marke ${name} ist nirgends definiert`);
  const zeiger = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(wert);
  return zeiger ? aufloesen(zeiger[1] as string, karte, tiefe + 1) : wert;
}

function pixel(name: string, karte: Map<string, string>): number {
  const wert = aufloesen(name, karte);
  const zahl = /^(-?[\d.]+)px$/.exec(wert);
  if (!zahl) throw new Error(`${name} löst sich auf zu "${wert}", das ist kein Pixelwert`);
  return Number(zahl[1]);
}

function rem(name: string, karte: Map<string, string>): number {
  const wert = aufloesen(name, karte);
  const zahl = /^(-?[\d.]+)rem$/.exec(wert);
  if (!zahl) throw new Error(`${name} löst sich auf zu "${wert}", das ist kein rem-Wert`);
  return Number(zahl[1]);
}

/* ── Die Leitern, wie sie in tokens.css stehen sollen ──────────────────────
   Die Namen stehen hier, die WERTE nicht: die kommen aus der Datei. Sonst
   prüfte der Test seine eigene Kopie. */
/* 27.07.2026: 2, 6, 10 und 14 kamen dazu — NICHT erfunden, sondern nachgemessen.
   Die erste Leiter zählte nur var()-Verwendungen (289). Die Zählung über ALLE
   rohen gap/padding-Bausteine der Kasse (1346) fand 464 Stellen auf genau
   diesen vier Halbstufen: 10px allein 103-mal, öfter als fast jede Vollstufe.
   Am dichten Ende eines Kassenbildschirms ist das gelebte Raster 2 Pixel. */
const ABSTAND_STUFEN = [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128];
const SCHRIFT_STUFEN = [
  'fussnote', 'marke', 'kuerzel', 'zeile', 'feld', 'text', 'betont', 'grund',
  'lead', 'titel', 'kopf', 'summe', 'flaeche', 'kachel', 'betrag', 'anschlag', 'buehne',
] as const;

/**
 * Die Pixelwerte, die JEDER alte Abstandsname vor dem Umbau am 26.07.2026
 * hatte. Das ist der eigentliche Anker dieser Etappe: 289 Stellen in der Kasse
 * hängen an diesen Namen, und die Zusage lautete, dass sich nichts verschiebt.
 * Wer eine Stufe „aufräumt" und dabei 4px zu 8px macht, fällt hier auf.
 */
const ABSTAND_VORHER: Record<string, number> = {
  '--space-1': 4, '--space-2': 8, '--space-3': 12, '--space-4': 16,
  '--space-5': 20, '--space-6': 24, '--space-7': 32, '--space-8': 40,
  '--space-9': 48, '--space-10': 64, '--space-11': 80, '--space-12': 96,
  '--w14-space-1': 8, '--w14-space-2': 16, '--w14-space-3': 24,
  '--w14-space-4': 40, '--w14-space-5': 64, '--w14-space-6': 96,
  '--w14-space-7': 128, '--w14-unit': 8,
};

/** Die 48 Schriftgrössen, so wie sie am 26.07.2026 in apps/tauri-pos/src
 *  gezählt wurden. Die Zahl dahinter ist die Anzahl Fundstellen. */
const SCHRIFT_MESSUNG: Record<string, number> = {
  '0.54': 1, '0.6': 5, '0.62': 4, '0.64': 4, '0.65': 1, '0.66': 16, '0.68': 22,
  '0.7': 27, '0.72': 88, '0.74': 53, '0.75': 4, '0.76': 19, '0.78': 155,
  '0.8': 44, '0.82': 75, '0.84': 17, '0.85': 65, '0.86': 30, '0.88': 36,
  '0.9': 72, '0.92': 82, '0.94': 3, '0.95': 57, '0.96': 2, '0.98': 4,
  '1': 28, '1.05': 18, '1.08': 1, '1.1': 9, '1.12': 1, '1.15': 8, '1.16': 1,
  '1.2': 10, '1.25': 3, '1.3': 13, '1.35': 2, '1.4': 29, '1.5': 22,
  '1.6': 11, '1.65': 1, '1.7': 2, '1.8': 3, '1.9': 1, '2': 4, '2.1': 1,
  '2.4': 4, '2.6': 2, '3': 2,
};
const SCHRANKE_REM = 0.03;

interface SchriftZeile {
  quelle: number;
  quelleText: string;
  anzahl: number;
  ziel: string;
  deltaRem: number;
  deltaPx: number;
  markiert: boolean;
}

/** Liest die Zuordnungstabelle aus dem Kommentarblock in tokens.css. */
function schriftTabelle(): SchriftZeile[] {
  const zeilen: SchriftZeile[] = [];
  const muster =
    /SCHRIFT\s+([\d.]+)rem\s+x(\d+)\s+->\s+(--w14-schrift-[a-z-]+)\s+([+-][\d.]+)rem\s+\(([+-][\d.]+)px\)(\s*!)?/g;
  for (const t of QUELLE.matchAll(muster)) {
    zeilen.push({
      quelle: Number(t[1]),
      quelleText: t[1] as string,
      anzahl: Number(t[2]),
      ziel: t[3] as string,
      deltaRem: Number(t[4]),
      deltaPx: Number(t[5]),
      markiert: t[6] !== undefined,
    });
  }
  return zeilen;
}

/** Liest die Abstands-Zuordnung aus dem Kommentarblock. */
function abstandTabelle(): Array<{ alt: string; neu: string }> {
  const zeilen: Array<{ alt: string; neu: string }> = [];
  for (const t of QUELLE.matchAll(/ABSTAND\s+var\((--space-\d+)\)\s+->\s+var\((--w14-abstand-\d+)\)/g)) {
    zeilen.push({ alt: t[1] as string, neu: t[2] as string });
  }
  return zeilen;
}

describe('tokens.css liest wirklich die Quelle', () => {
  it('zeigt auf src/ und nicht auf dist/', () => {
    // Ohne diese Zusicherung könnte der ganze Rest über eine gebaute Kopie
    // laufen. Dann bliebe alles grün, während die Quelle kaputt ist, und das
    // ist die schlimmste Art von grün.
    expect(TOKENS_PFAD).toMatch(/[/\\]src[/\\]tokens\.css$/);
    expect(TOKENS_PFAD).not.toMatch(/[/\\]dist[/\\]/);
  });

  it('findet überhaupt Marken', () => {
    // Ein kaputter Pfad oder ein kaputtes Muster wäre sonst ein grüner Test
    // über eine leere Menge.
    expect(deklarationen().length).toBeGreaterThan(80);
  });
});

describe('Keine Marke liest sich selbst', () => {
  it('hat keinen Kreis in der Abhängigkeitskette', () => {
    // DER FUND VOM 26.07.2026: hier stand
    //     --w14-leading-body: var(--w14-leading-body);
    // Eine Marke, die sich selbst liest, ist „ungültig zum Rechenzeitpunkt":
    // sie bekommt gar keinen Wert, und jede Regel, die sie ohne Rückfall
    // liest, wird verworfen. Im Browser gemessen: die Marke war leer und der
    // Zeilenabstand der ganzen Kasse fiel von 1,62 auf `normal`, also rund ein
    // Drittel enger als entworfen. Genau das Gefühl von „zu dicht".
    //
    // Weder der Typprüfer noch der Marken-Wächter konnten das sehen: der eine
    // liest eine Zeichenkette, der andere prüft nur, OB ein Name definiert ist,
    // und definiert war er ja, zweimal sogar.
    const karte = marken();
    const kreise: string[] = [];

    const pruefe = (start: string, name: string, gesehen: Set<string>): void => {
      const wert = karte.get(name);
      if (wert === undefined) return;
      for (const t of wert.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        const naechste = t[1] as string;
        if (naechste === start) {
          kreise.push(`${start} liest über ${name} wieder ${start}`);
          continue;
        }
        if (gesehen.has(naechste)) continue;
        gesehen.add(naechste);
        pruefe(start, naechste, gesehen);
      }
    };

    for (const name of karte.keys()) pruefe(name, name, new Set([name]));
    expect(kreise, `Marken im Kreis:\n  ${kreise.join('\n  ')}`).toEqual([]);
  });
});

describe('Die Abstandsleiter', () => {
  const karte = marken();

  it('ist vollständig definiert, steigt lückenlos und hat keine Doppelung', () => {
    const werte = ABSTAND_STUFEN.map((px) => pixel(`--w14-abstand-${px}`, karte));
    expect(werte).toEqual(ABSTAND_STUFEN);
    for (let i = 1; i < werte.length; i += 1) {
      expect(werte[i], `Stufe ${i} steigt nicht`).toBeGreaterThan(werte[i - 1] as number);
    }
    expect(new Set(werte).size).toBe(werte.length);
  });

  it('hat keine erfundene Zwischenstufe', () => {
    // Die Leiter ist genau die Vereinigung der zwei alten Leitern. Eine Stufe,
    // die niemand braucht, ist wieder ein Ding mehr auf einem Bildschirm, von
    // dem Basel gesagt hat, es seien schon zu viele.
    const gefunden = [...karte.keys()]
      .filter((n) => n.startsWith('--w14-abstand-'))
      .map((n) => Number(n.slice('--w14-abstand-'.length)))
      .sort((a, b) => a - b);
    expect(gefunden).toEqual(ABSTAND_STUFEN);
  });

  it('verschiebt keinen einzigen alten Abstand', () => {
    // Der Kern der Zusage. 289 Stellen in der Kasse hängen an diesen Namen.
    const heute: Record<string, number> = {};
    for (const name of Object.keys(ABSTAND_VORHER)) heute[name] = pixel(name, karte);
    expect(heute).toEqual(ABSTAND_VORHER);
  });

  it('hat eine Zuordnung für jeden gelebten Namen, und sie stimmt im Pixel', () => {
    const tabelle = abstandTabelle();
    const alteNamen = Object.keys(ABSTAND_VORHER).filter((n) => n.startsWith('--space-'));
    expect(tabelle.map((z) => z.alt).sort()).toEqual([...alteNamen].sort());
    for (const { alt, neu } of tabelle) {
      expect(pixel(neu, karte), `${alt} -> ${neu} ändert den Pixelwert`).toBe(ABSTAND_VORHER[alt]);
    }
  });
});

/** Die Stufen mit ihren Werten aus der Datei. Bewusst eine Funktion und keine
 *  Konstante im describe-Rumpf: fehlt eine Stufe, soll der zugehörige Test rot
 *  werden und den Namen nennen, statt die ganze Datei beim Einsammeln zu
 *  sprengen. Ein Fehler beim Einsammeln liest sich wie „keine Tests" und ist
 *  ein schwächeres Signal als eine benannte Zusicherung. */
function schriftStufen(karte: Map<string, string>): Array<{ name: string; wert: number }> {
  return SCHRIFT_STUFEN.map((n) => ({ name: `--w14-schrift-${n}`, wert: rem(`--w14-schrift-${n}`, karte) }));
}

describe('Die Schriftleiter', () => {
  const karte = marken();

  it('ist vollständig definiert, steigt lückenlos und hat keine Doppelung', () => {
    const stufen = schriftStufen(karte);
    for (let i = 1; i < stufen.length; i += 1) {
      const vor = stufen[i - 1] as { name: string; wert: number };
      const jetzt = stufen[i] as { name: string; wert: number };
      expect(jetzt.wert, `${jetzt.name} steigt nicht über ${vor.name}`).toBeGreaterThan(vor.wert);
    }
    expect(new Set(stufen.map((s) => s.wert)).size).toBe(stufen.length);
  });

  it('reicht unter die kleinste Stufe der Ladenleiter', () => {
    // Das war die Frage, an der diese Etappe hing. Die Ladenleiter beginnt bei
    // 0,8125rem; 441 der 1062 Verwendungen der Kasse liegen darunter, allein
    // 0,78rem 155 mal. Eine Kassenoberfläche auf die Ladenleiter zu zwingen
    // hiesse, 441 Stellen grösser zu machen und jedes dichte Raster zu brechen.
    const ladenleiter = rem('--w14-step--1', karte);
    expect(ladenleiter).toBe(0.8125);
    const unterhalb = schriftStufen(karte).filter((s) => s.wert < ladenleiter);
    expect(unterhalb.length, 'die Leiter reicht nicht nach unten').toBeGreaterThanOrEqual(4);
  });

  it('hat keine Stufe ohne Verwendung', () => {
    // Eine Stufe, die keine einzige gemessene Grösse trägt, ist Zierrat.
    const belegt = new Set(schriftTabelle().map((z) => z.ziel));
    const leer = schriftStufen(karte).map((s) => s.name).filter((n) => !belegt.has(n));
    expect(leer, `Stufen ohne jede Verwendung: ${leer.join(', ')}`).toEqual([]);
  });
});

describe('Die Zuordnungstabelle', () => {
  const karte = marken();
  const tabelle = schriftTabelle();
  const werte = (): Map<string, number> => new Map(schriftStufen(karte).map((s) => [s.name, s.wert] as const));

  it('deckt jede der 48 gemessenen Grössen genau einmal ab', () => {
    expect(tabelle.length).toBe(48);
    const quellen = tabelle.map((z) => z.quelleText).sort();
    expect(new Set(quellen).size).toBe(48);
    expect(quellen).toEqual(Object.keys(SCHRIFT_MESSUNG).sort());
  });

  it('nennt die richtige Anzahl Fundstellen je Grösse', () => {
    for (const zeile of tabelle) {
      expect(zeile.anzahl, `Anzahl für ${zeile.quelleText}rem`).toBe(SCHRIFT_MESSUNG[zeile.quelleText]);
    }
    const summe = tabelle.reduce((s, z) => s + z.anzahl, 0);
    expect(summe, 'die Summe der Fundstellen').toBe(1062);
  });

  it('zeigt nur auf Stufen, die es wirklich gibt', () => {
    // Eine Zuordnung auf einen Namen, den niemand definiert hat, ist genau der
    // Fehler, an dem die Kasse am 25.07.2026 zwei Auslieferungen lang litt:
    // ein `var()` ohne Rückfall auf einen unbekannten Namen macht die ganze
    // Regel ungültig, und der Browser zeichnet einfach nichts.
    const vorhanden = new Set(deklarationen().map((d) => d.name));
    const unbekannt = tabelle.filter((z) => !vorhanden.has(z.ziel)).map((z) => z.ziel);
    expect(unbekannt, `unbekannte Stufen: ${unbekannt.join(', ')}`).toEqual([]);
  });

  it('rechnet jede Verschiebung richtig aus', () => {
    const stufenWert = werte();
    for (const zeile of tabelle) {
      const ziel = stufenWert.get(zeile.ziel) as number;
      expect(zeile.deltaRem, `${zeile.quelleText}rem -> ${zeile.ziel}`).toBeCloseTo(ziel - zeile.quelle, 6);
      expect(zeile.deltaPx, `${zeile.quelleText}rem in Pixeln`).toBeCloseTo((ziel - zeile.quelle) * 16, 2);
    }
  });

  it('wählt für jede Grösse die NÄCHSTE Stufe', () => {
    // Sonst wäre die Tabelle beliebig: man könnte 0,78rem auf die Bühnenstufe
    // zeigen lassen und die Schranke wäre nur noch Behauptung.
    const stufenWert = werte();
    for (const zeile of tabelle) {
      let beste = '';
      let bester = Infinity;
      for (const [name, wert] of stufenWert) {
        const abstand = Math.abs(wert - zeile.quelle);
        if (abstand < bester - 1e-9) {
          bester = abstand;
          beste = name;
        }
      }
      expect(zeile.ziel, `${zeile.quelleText}rem liegt näher an ${beste}`).toBe(beste);
    }
  });

  it('markiert genau die Zeilen, die über 0,03rem wandern', () => {
    for (const zeile of tabelle) {
      const drueber = Math.abs(zeile.deltaRem) > SCHRANKE_REM + 1e-9;
      expect(
        zeile.markiert,
        `${zeile.quelleText}rem verschiebt sich um ${zeile.deltaRem}rem, Markierung stimmt nicht`,
      ).toBe(drueber);
    }
  });

  it('hält die Schranke im dichten Bereich AUSNAHMSLOS', () => {
    // Unten sitzt Text in einer Zeile mit fester Höhe; eine halbe Pixelstufe
    // schiebt dort die Nachbarspalte. Genau dort darf nichts wandern.
    const dicht = tabelle.filter((z) => z.quelle <= 1);
    const verletzt = dicht.filter((z) => Math.abs(z.deltaRem) > SCHRANKE_REM + 1e-9);
    expect(
      verletzt.map((z) => `${z.quelleText}rem: ${z.deltaRem}rem`),
      'im dichten Bereich darf keine Grösse über 0,03rem wandern',
    ).toEqual([]);
  });

  it('bewegt 1006 von 1062 Verwendungen um höchstens 0,03rem', () => {
    // Die Kennzahl, mit der diese Etappe steht oder fällt. Steht sie im
    // Bericht, muss sie auch messbar sein.
    let innerhalb = 0;
    let darueber = 0;
    let groesste = 0;
    for (const zeile of tabelle) {
      if (Math.abs(zeile.deltaRem) <= SCHRANKE_REM + 1e-9) innerhalb += zeile.anzahl;
      else darueber += zeile.anzahl;
      groesste = Math.max(groesste, Math.abs(zeile.deltaRem));
    }
    expect(innerhalb).toBe(1006);
    expect(darueber).toBe(56);
    expect(groesste).toBeCloseTo(0.1, 6);
  });
});
