// @vitest-environment node
//
// Diese Prüfung zeichnet nichts, sie liest Quelltext — wie der Marken-Wächter
// (design-marken.test.ts in der Kasse) und aus demselben Grund im Node-Umfeld.

/**
 * Der Bewegungs-Wächter. Zwei Zusagen, beide aus den Bewegungsregeln des
 * Hauses, beide von keinem Typprüfer und keinem Rendering-Test erreichbar:
 *
 * 1. KEINE Animation und keine Transition bewegt eine LAYOUT-Eigenschaft
 *    (width, height, top, left, margin, padding … oder das wahllose `all`).
 *    Layout-Eigenschaften zwingen den Browser, bei jedem Bild neu zu
 *    rechnen und neu zu setzen — auf dem Tresen-Gerät ruckelt genau dann
 *    die Kasse, wenn sie geschmeidig wirken soll. Und `all` nimmt still
 *    Farbe, Rand und Schatten mit, die nie gemeint waren.
 *
 * 2. JEDES Modul, das einen eigenen @keyframes definiert, behandelt
 *    prefers-reduced-motion SELBST. Die globale Regel in tokens.css kürzt
 *    nur DAUERN (animation-duration, transition-duration) — sie kürzt keine
 *    VERZÖGERUNG, und eine unendliche Animation mit einer Dauer von 0.001ms
 *    ist ein Stroboskop, kein Stillstand. Wer einen Keyframe erfindet, muss
 *    sagen, was er bei reduzierter Bewegung tut (Media-Query im selben
 *    Modul, oder ein matchMedia-Zweig wie in lib/motion.tsx).
 *
 * Die Heuristik von Zusage 2 ist bewusst grob (Zeichenketten-Suche im selben
 * Modul): sie kann nicht beweisen, dass die Behandlung RICHTIG ist, aber sie
 * macht es unmöglich, einen Keyframe hinzuzufügen, ohne die Frage überhaupt
 * beantwortet zu haben. Genau das war der Zustand des Bestands.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const KIT = HIER.replace(/\/$/, '');
const KASSE = join(HIER, '../../../apps/tauri-pos/src');

/** Eigenschaften, deren Bewegung Layout auslöst — plus das wahllose `all`. */
const LAYOUT_EIGENSCHAFTEN =
  /^(all|width|height|top|left|right|bottom|inset|min-width|max-width|min-height|max-height|margin[a-z-]*|padding[a-z-]*|flex-basis|font-size|line-height|gap|border-width)$/i;

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

/** Kurzname für Meldungen und die Ausnahmen-Liste. */
function kurz(pfad: string): string {
  return pfad.replace(`${KASSE}/`, 'apps/tauri-pos/src/').replace(`${KIT}/`, 'packages/ui-kit/src/');
}

/**
 * Quelltext ohne Kommentare: in Kommentaren stehen absichtlich Beispiele
 * („transition: 'left …'" als abschreckendes Zitat) — die sind Rede ÜBER
 * Bewegung, keine Bewegung. Blockkommentare fallen ganz, Zeilenkommentare
 * nur, wenn die Zeile mit // BEGINNT (sonst zerschnitte das jede URL).
 */
function ohneKommentare(quelle: string): string {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((zeile) => !zeile.trimStart().startsWith('//'))
    .join('\n');
}

/** Alle Quelldateien beider Bäume, ohne Prüf- und Erzähl-Dateien. */
function quelldateien(): string[] {
  return [...dateien(KIT, ['.ts', '.tsx', '.css']), ...dateien(KASSE, ['.ts', '.tsx', '.css'])].filter(
    (d) => !/\.test\.tsx?$/.test(d) && !/\.stories\.tsx?$/.test(d),
  );
}

interface Fund {
  ort: string;
  eigenschaft: string;
  wert: string;
}

/**
 * Jede Eigenschaft, die eine transition bewegt. Der Wert wird zuerst von
 * Klammerinhalten befreit (cubic-bezier trägt Kommas), dann an Kommas
 * getrennt; das erste Wort jedes Abschnitts ist die Eigenschaft.
 */
function transitionEigenschaften(wert: string): string[] {
  return wert
    .replace(/\([^)]*\)/g, '()')
    .split(',')
    .map((teil) => teil.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean);
}

/** Findet Layout-Bewegung in transitions (TS-Zeichenketten und CSS). */
function layoutTransitions(): Fund[] {
  const funde: Fund[] = [];
  for (const datei of quelldateien()) {
    const quelle = ohneKommentare(readFileSync(datei, 'utf8'));
    const istCss = datei.endsWith('.css');
    const muster = istCss
      ? /(?:^|[;{\s])transition(?:-property)?\s*:\s*([^;]+);/g
      : /transition(?:Property)?\s*:\s*(['"`])([^'"`]+)\1/g;
    for (const treffer of quelle.matchAll(muster)) {
      const wert = (istCss ? treffer[1] : treffer[2]) as string;
      for (const eigenschaft of transitionEigenschaften(wert)) {
        if (LAYOUT_EIGENSCHAFTEN.test(eigenschaft)) {
          funde.push({ ort: kurz(datei), eigenschaft, wert: wert.trim() });
        }
      }
    }
  }
  return funde;
}

/** Der Rumpf jedes @keyframes-Blocks (mit Klammer-Zählung, from/to schachteln). */
function keyframesRuempfe(quelle: string): Array<{ name: string; rumpf: string }> {
  const bloecke: Array<{ name: string; rumpf: string }> = [];
  const muster = /@keyframes\s+([\w-]+)\s*\{/g;
  for (const treffer of quelle.matchAll(muster)) {
    const start = (treffer.index ?? 0) + treffer[0].length;
    let tiefe = 1;
    let i = start;
    while (i < quelle.length && tiefe > 0) {
      const zeichen = quelle[i];
      if (zeichen === '{') tiefe += 1;
      else if (zeichen === '}') tiefe -= 1;
      i += 1;
    }
    bloecke.push({ name: treffer[1] as string, rumpf: quelle.slice(start, i - 1) });
  }
  return bloecke;
}

/** Findet Layout-Eigenschaften INNERHALB von Keyframe-Rümpfen. */
function layoutKeyframes(): Fund[] {
  const funde: Fund[] = [];
  for (const datei of quelldateien()) {
    const quelle = ohneKommentare(readFileSync(datei, 'utf8'));
    for (const { name, rumpf } of keyframesRuempfe(quelle)) {
      for (const zeile of rumpf.matchAll(/(?:^|[{;\s])([a-z-]+)\s*:/gi)) {
        const eigenschaft = zeile[1] as string;
        if (LAYOUT_EIGENSCHAFTEN.test(eigenschaft)) {
          funde.push({ ort: kurz(datei), eigenschaft, wert: `@keyframes ${name}` });
        }
      }
    }
  }
  return funde;
}

/** Module, die einen eigenen @keyframes tragen, ohne reduzierte Bewegung zu behandeln. */
function keyframesOhneReduzierung(): Array<{ ort: string; keyframes: string[] }> {
  const funde: Array<{ ort: string; keyframes: string[] }> = [];
  for (const datei of quelldateien()) {
    const quelle = readFileSync(datei, 'utf8');
    const bloecke = keyframesRuempfe(ohneKommentare(quelle));
    if (bloecke.length === 0) continue;
    // Die Behandlung darf auch in einem Kommentar begründet stehen? NEIN —
    // gezählt wird nur wirksamer Quelltext, deshalb ohne Kommentare prüfen.
    if (ohneKommentare(quelle).includes('prefers-reduced-motion')) continue;
    funde.push({ ort: kurz(datei), keyframes: bloecke.map((b) => b.name) });
  }
  return funde;
}

describe('Der Bewegungs-Wächter findet überhaupt Bewegung', () => {
  it('sieht beide Bäume und genug Bewegungsstellen — sonst prüft er eine leere Menge', () => {
    // Ein kaputter Pfad wäre sonst die schlimmste Art von grün.
    const alle = quelldateien();
    expect(alle.some((d) => d.includes('apps/tauri-pos/src'))).toBe(true);
    expect(alle.some((d) => d.includes('packages/ui-kit/src'))).toBe(true);
    let keyframes = 0;
    for (const datei of alle) {
      keyframes += keyframesRuempfe(ohneKommentare(readFileSync(datei, 'utf8'))).length;
    }
    expect(keyframes).toBeGreaterThan(10);
  });
});

/**
 * ── ALTLASTEN, gemessen am 27.07.2026 (der rote Erstlauf dieses Wächters) ──
 * Diese Stellen standen VOR dem Wächter im Bestand und gehören den Flächen-
 * Gewerken der Kasse, die zeitgleich daran arbeiten. Jede Zeile ist eine
 * Schuld: der Schalterdaumen und die Fortschrittsbalken sind auf transform
 * umzustellen, das `all` auf eine benannte Liste. Die Listen sind
 * OBERGRENZEN (Teilmenge, nicht Gleichheit): eine behobene Stelle darf
 * einfach verschwinden, ohne dass ein fremdes Gewerk diese Datei anfassen
 * muss — aber KEINE NEUE Stelle kommt je dazu.
 */
const LAYOUT_ALTLASTEN = new Set([
  'apps/tauri-pos/src/app/chrome/UpdateCenter.tsx → width',
  'apps/tauri-pos/src/screens/lager/WebSeoPanel.tsx → left',
  'apps/tauri-pos/src/screens/secondary/Einstellungen.tsx → left',
  // Kurse.tsx → all: am 27.07.2026 behoben (das Metall-Plättchen bewegt jetzt
  // border-color, background-color und color einzeln) — Eintrag gelöscht,
  // damit ein neues `all` dort sofort wieder rot wird.
  'apps/tauri-pos/src/screens/zielkarte/instruments.tsx → width',
]);

/**
 * Module mit eigenem Keyframe ohne reduced-motion-Antwort, Stand des roten
 * Erstlaufs. Die sechs w14-skel-Kopien fallen mit dem Umbau auf das neue
 * Skelett-Bauteil des Baukastens ohnehin weg; der Rest bekommt seine Antwort
 * vom jeweiligen Gewerk (Muster: lib/motion.tsx oder eine Media-Query im
 * selben Modul). Auch hier: Obergrenze, nie Zuwachs.
 */
const REDUZIERUNG_ALTLASTEN = new Set([
  'apps/tauri-pos/src/app/chrome/HealthDot.tsx',
  'apps/tauri-pos/src/app/chrome/UpdateButton.tsx',
  'apps/tauri-pos/src/app/chrome/UpdateCenter.tsx',
  'apps/tauri-pos/src/components/LocalLockGate.tsx',
  'apps/tauri-pos/src/components/hardware/ZvtSpinner.tsx',
  'apps/tauri-pos/src/screens/_shared/SanfteMomente.tsx',
  'apps/tauri-pos/src/screens/aufgaben/Aufgaben.tsx',
  'apps/tauri-pos/src/screens/lager/WebSeoPanel.tsx',
  'apps/tauri-pos/src/screens/secondary/Belegtexte.tsx',
  'apps/tauri-pos/src/screens/secondary/Dokumente.tsx',
  'apps/tauri-pos/src/screens/secondary/Ebay.tsx',
  'apps/tauri-pos/src/screens/secondary/Tagebuch.tsx',
  'apps/tauri-pos/src/screens/secondary/TradingTerminal.tsx',
  'apps/tauri-pos/src/screens/secondary/WhatsApp.tsx',
  'apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx',
  'apps/tauri-pos/src/screens/verkauf/CartPanel.tsx',
]);

describe('Keine Bewegung auf Layout-Eigenschaften', () => {
  it('keine transition bewegt width/height/top/left/margin/padding oder `all`', () => {
    const funde = layoutTransitions().filter(
      (f) => !LAYOUT_ALTLASTEN.has(`${f.ort} → ${f.eigenschaft}`),
    );
    const bericht = funde.map((f) => `  ${f.ort}: "${f.wert}" bewegt ${f.eigenschaft}`).join('\n');
    expect(
      funde.map((f) => `${f.ort} → ${f.eigenschaft}`),
      `NEUE Layout-Bewegung (nicht in den Altlasten):\n${bericht}`,
    ).toEqual([]);
  });

  it('der geteilte Baukasten selbst ist frei von Altlasten', () => {
    // Das Fundament darf sich nicht hinter der eigenen Ausnahmen-Liste
    // verstecken: für packages/ui-kit gilt die Regel OHNE Obergrenze.
    const kitFunde = layoutTransitions().filter((f) => f.ort.startsWith('packages/ui-kit/'));
    expect(kitFunde).toEqual([]);
    expect([...LAYOUT_ALTLASTEN, ...REDUZIERUNG_ALTLASTEN].filter((a) => a.startsWith('packages/ui-kit/'))).toEqual([]);
  });

  it('kein @keyframes setzt eine Layout-Eigenschaft', () => {
    const funde = layoutKeyframes();
    const bericht = funde.map((f) => `  ${f.ort}: ${f.wert} bewegt ${f.eigenschaft}`).join('\n');
    expect(
      funde.map((f) => `${f.ort} → ${f.eigenschaft}`),
      `Layout-Keyframes gefunden:\n${bericht}`,
    ).toEqual([]);
  });
});

describe('Kein Keyframe ohne Antwort auf reduzierte Bewegung', () => {
  it('jedes Modul mit eigenem @keyframes behandelt prefers-reduced-motion selbst', () => {
    const funde = keyframesOhneReduzierung().filter((f) => !REDUZIERUNG_ALTLASTEN.has(f.ort));
    const bericht = funde.map((f) => `  ${f.ort}: ${f.keyframes.join(', ')}`).join('\n');
    expect(
      funde.map((f) => f.ort),
      `NEUE Keyframes ohne reduced-motion-Behandlung (nicht in den Altlasten):\n${bericht}`,
    ).toEqual([]);
  });
});
