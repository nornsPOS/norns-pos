/**
 * Der Wächter gegen eine Marke, die es gar nicht gibt.
 *
 * ── WAS AM 25.07.2026 PASSIERT IST ──────────────────────────────────────────
 * Basel: „قسم الطلبات بل اخص معطوب الوان شفافه غير واضحة" — die Bestellungen
 * seien kaputt, die Farben durchsichtig und unklar.
 *
 * Sie waren es. Der gewählte Reiter und die gewählte Bestellzeile trugen
 *
 *     background: gewaehlt ? 'var(--w14-parchment-deep)' : 'transparent'
 *
 * und `--w14-parchment-deep` ist in KEINER Datei definiert. Ein `var()` auf
 * einen unbekannten Namen OHNE Rückfall macht die ganze Deklaration ungültig,
 * der Browser verwirft sie — die gewählte Zeile bekam also gar keine Fläche
 * und sah aus wie jede andere. Genau „durchsichtig und unklar".
 *
 * Sechs solcher Namen standen im Quelltext. Nichts hat gewarnt:
 *   • Der Typprüfer sieht in `'var(--w14-…)'` nur eine Zeichenkette.
 *   • Kein Test rendert diese Flächen.
 *   • Die Konsole des Browsers schweigt, es ist kein Fehler, nur nichts.
 * Die einzige andere Chance wäre gewesen, dass jemand hinsieht — und genau das
 * hat zwei Auslieferungen lang niemand getan.
 *
 * ── WAS DIESER TEST TUT ─────────────────────────────────────────────────────
 * Er liest JEDES `var(--w14-…)` im Quelltext der Kasse und im geteilten Kit und
 * prüft, ob der Name irgendwo als `--w14-…: wert` definiert ist. Fehlt einer,
 * wird er ROT und nennt Datei und Zeile.
 *
 * Ein `var(--name, rueckfall)` MIT Rückfall ist kein Fehler im Sinne von
 * „unsichtbar", aber es ist einer im Sinne von „diese Marke gibt es nicht" —
 * und ein Rückfall, der zufällig `transparent` lautet, war in der
 * Kassentastatur genau derselbe Fehler mit einer Tarnkappe. Deshalb prüft der
 * Wächter BEIDE Formen.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const KASSE = join(HIER, '..');
const KIT = join(HIER, '../../../../packages/ui-kit/src');

/** Alle Dateien unter einem Verzeichnis, deren Endung zählt. */
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

/**
 * Kommentare weg, bevor gesucht wird.
 *
 * ⚠️ Ohne diesen Schritt zaehlen zwei Erklaerungen als Fundstellen: `tokens.css`
 * nennt `var(--hex)` in seiner Prosa ueber Tailwind, und die Leiter-Begruendung
 * nennt `var(--space-13)` als BEISPIEL fuer genau die Blindheit, die dieser
 * Waechter jetzt schliesst. Beide sind keine ausgelieferte Oberflaeche.
 */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Jeder Name, der irgendwo als `--x: wert` gesetzt wird.
 *
 * ⚠️ 01.08.2026 GEOEFFNET. Hier stand `--w14-[a-z0-9-]+`, und dasselbe Muster
 * stand unten bei den Verwendungen. Der Waechter sah damit AUSSCHLIESSLICH
 * Namen unter der Hausmarke — jede andere Marke war fuer ihn unsichtbar.
 *
 * Gemessen an dem Tag: 132 benutzte Marken, davon 15 OHNE `--w14-`. Eine
 * davon, `var(--radius-sm)` in der Kundenliste, gab es im Haus gar nicht und
 * hatte keinen Rueckfall — der Browser verwirft dann die GANZE Deklaration,
 * und die Plakette „Konto geloescht" stand als einzige mit scharfen Ecken in
 * einer Liste voller runder. Der Waechter war die ganze Zeit gruen.
 *
 * Die Leiter-Begruendung in `tokens.css` hatte diese Luecke sogar schon
 * beschrieben: „`--space-N` traegt kein `--w14-`-Praefix und ist deshalb fuer
 * ihn unsichtbar, ein `var(--space-13)` waere bis heute stumm durchgegangen."
 */
function definierteMarken(): Set<string> {
  const marken = new Set<string>();
  for (const datei of [...dateien(KIT, ['.css']), ...dateien(KASSE, ['.css'])]) {
    const text = ohneKommentare(readFileSync(datei, 'utf8'));
    for (const treffer of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      marken.add(treffer[1] as string);
    }
  }
  return marken;
}

interface Fundstelle {
  marke: string;
  ort: string;
  mitRueckfall: boolean;
}

/** Jeder Gebrauch von `var(--w14-…)`, mit Datei, Zeile und Rückfall-Angabe. */
function benutzteMarken(): Fundstelle[] {
  const funde: Fundstelle[] = [];
  const quellen = [
    ...dateien(KASSE, ['.ts', '.tsx', '.css']),
    ...dateien(KIT, ['.ts', '.tsx', '.css']),
  ];
  for (const datei of quellen) {
    // Prüfdateien werden NICHT gescannt. Sie zeichnen nichts auf einen
    // Bildschirm; sie reden ÜBER Marken. Der Ebenen-Wächter im Baukasten prüft
    // zum Beispiel, ob ein zIndex mit `'var(--w14-z-` beginnt — dieses Präfix
    // ist keine Marke, wurde hier aber als eine gelesen und meldete am
    // 26.07.2026 einen Fehlalarm.
    //
    // Das schwächt den Wächter NICHT: ausgelieferte Oberfläche steht niemals in
    // einer `.test.`-Datei. Was ein Mensch am Tresen sieht, wird weiterhin
    // vollständig geprüft.
    if (/\.test\.tsx?$/.test(datei)) continue;
    const zeilen = ohneKommentare(readFileSync(datei, 'utf8')).split('\n');
    zeilen.forEach((zeile, i) => {
      // Jede Marke, nicht nur die des Hauses — siehe `definierteMarken`.
      for (const treffer of zeile.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/g)) {
        funde.push({
          marke: treffer[1] as string,
          ort: `${datei.replace(KASSE, 'apps/tauri-pos/src').replace(KIT, 'packages/ui-kit/src')}:${i + 1}`,
          mitRueckfall: treffer[2] === ',',
        });
      }
    });
  }
  return funde;
}

describe('Design-Marken der Kasse', () => {
  it('findet überhaupt Marken — sonst prüft dieser Test nichts', () => {
    // Ohne diese Zusicherung wäre ein kaputter Pfad ein GRÜNER Test über eine
    // leere Menge: die schlimmste Art von grün.
    const definiert = definierteMarken();
    const benutzt = benutzteMarken();
    expect(definiert.size).toBeGreaterThan(50);
    expect(benutzt.length).toBeGreaterThan(50);
  });

  it('benutzt KEINE Marke, die nirgends definiert ist', () => {
    const definiert = definierteMarken();
    const fehlend = benutzteMarken().filter((f) => !definiert.has(f.marke));

    // Die Meldung nennt Datei und Zeile, damit der Fund ohne Suche behebbar ist.
    const bericht = fehlend
      .map((f) => `  ${f.marke}${f.mitRueckfall ? ' (mit Rückfall)' : ' (OHNE Rückfall — unsichtbar)'} → ${f.ort}`)
      .join('\n');
    expect(fehlend.map((f) => f.marke), `Unbekannte Design-Marken:\n${bericht}`).toEqual([]);
  });

  it('kennt die sechs Namen von damals nicht mehr', () => {
    // Namensprobe: diese sechs standen am 25.07.2026 im Quelltext und es gab
    // sie nicht. Sollte einer zurückkommen, fällt dieser Test zuerst und nennt
    // den Grund beim Namen, statt nur „unbekannte Marke" zu sagen.
    const benutzt = new Set(benutzteMarken().map((f) => f.marke));
    for (const tot of [
      '--w14-parchment-deep',
      '--w14-paper',
      '--w14-paper-2',
      '--w14-radius-md',
      '--w14-font-sans',
      '--w14-midnight-vellum',
    ]) {
      expect(benutzt.has(tot), `${tot} ist kein Name des Systems`).toBe(false);
    }
  });
});
