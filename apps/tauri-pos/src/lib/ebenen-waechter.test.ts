// @vitest-environment node
//
// Diese Prüfung zeichnet nichts, sie liest Quelltext — wie der Marken-Wächter
// (design-marken.test.ts) und der Bewegungs-Wächter im Baukasten.

/**
 * Der Ebenen-Wächter: keine nackte Zahl mehr in einer Ebene.
 *
 * ── WARUM ES IHN GIBT (27.07.2026) ──────────────────────────────────────────
 * Der Fund vom 26.07.2026 steht im Ebenen-Kommentar von tokens.css: der
 * Meldungskasten lag auf der nackten Zahl 900, jedes Fenster auf 1050 — und
 * damit verschwand am Tresen genau die Warnung („Druck fehlgeschlagen",
 * „Terminal nicht konfiguriert"), für die der Kasten existiert. Die Leiter
 * --w14-z-basis … --w14-z-hinweis hat das behoben, aber nichts hinderte die
 * nächste nackte Zahl daran, denselben Fehler in neuer Form zu wiederholen:
 * am Tag dieses Wächters standen noch SIEBZEHN rohe Ebenen im Bestand, davon
 * vier volle Modal-Schleier auf 100 und 120 — jede Meldung und jedes Fenster
 * hätte sie überdeckt, aber ein Spotlight-Schleier (1000) hätte sie schon
 * verschluckt. Kein Typprüfer sieht das: `zIndex: 100` ist für ihn nur eine
 * Zahl. Deshalb liest dieser Wächter den Quelltext selbst.
 *
 * ── DIE REGEL ───────────────────────────────────────────────────────────────
 * Jede Ebene, die zwischen Flächen konkurriert, trägt einen Namen der Leiter
 * (`zIndex: 'var(--w14-z-…)'`). Nackte Zahlen sind nur als LOKALE Stapel
 * erlaubt: -1 bis 9, also „hinter dem eigenen Inhalt" bis „wenige Geschwister
 * übereinander" — solche Werte konkurrieren nie mit einem Fenster, weil die
 * unterste echte Leiterstufe (klebend) bei 100 beginnt. Ab 10 wird es rot.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const KASSE = join(HIER, '..');

/**
 * Begründete Ausnahmen — kurz, benannt, jede mit Grund. Die Liste ist eine
 * OBERGRENZE wie beim Bewegungs-Wächter: eine behobene Stelle darf einfach
 * verschwinden, aber KEINE NEUE Stelle kommt je dazu.
 */
const AUSNAHMEN = new Set<string>([
  // (leer — Stand 27.07.2026: alle konkurrierenden Ebenen tragen Namen)
]);

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

function kurz(pfad: string): string {
  return pfad.replace(KASSE, 'apps/tauri-pos/src');
}

/** Quelltext ohne Kommentare: dort stehen absichtlich abschreckende Beispiele.
 *  Blockkommentare werden zeichenweise geleert statt gelöscht, damit die
 *  ZEILENNUMMERN der Meldungen stimmen — der rote Erstlauf nannte sonst
 *  Zeile 203, wo der Fund in Wahrheit auf 226 stand. */
function ohneKommentare(quelle: string): string {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((zeile) => {
      const nur = zeile.trimStart();
      return nur.startsWith('//') || nur.startsWith('*') ? '' : zeile;
    })
    .join('\n');
}

function quelldateien(): string[] {
  return dateien(KASSE, ['.ts', '.tsx', '.css']).filter(
    (d) => !/\.test\.tsx?$/.test(d) && !/\.stories\.tsx?$/.test(d),
  );
}

interface Fund {
  ort: string;
  wert: number;
}

/** Jede nackte Ebenen-Zahl ab 10, mit Datei und Zeile. */
function nackteEbenen(): Fund[] {
  const funde: Fund[] = [];
  for (const datei of quelldateien()) {
    const zeilen = ohneKommentare(readFileSync(datei, 'utf8')).split('\n');
    zeilen.forEach((zeile, i) => {
      for (const treffer of zeile.matchAll(/(?:\bzIndex\s*:|(?:^|[;{\s])z-index\s*:)\s*(-?\d+)\b/g)) {
        const wert = Number(treffer[1]);
        if (wert >= 10) funde.push({ ort: `${kurz(datei)}:${i + 1}`, wert });
      }
    });
  }
  return funde;
}

describe('Der Ebenen-Wächter', () => {
  it('sieht überhaupt Ebenen — sonst prüft er eine leere Menge', () => {
    // Ein kaputter Pfad oder ein kaputtes Muster wäre sonst die schlimmste
    // Art von grün: der Bestand nutzt die Leiter an weit mehr als 10 Stellen.
    let leiter = 0;
    for (const datei of quelldateien()) {
      leiter += (readFileSync(datei, 'utf8').match(/var\(--w14-z-/g) ?? []).length;
    }
    expect(leiter).toBeGreaterThan(10);
  });

  it('keine nackte Ebenen-Zahl ab 10 ausserhalb der begründeten Ausnahmen', () => {
    const funde = nackteEbenen().filter((f) => !AUSNAHMEN.has(f.ort));
    const bericht = funde.map((f) => `  ${f.ort}: zIndex ${f.wert}`).join('\n');
    expect(
      funde.map((f) => `${f.ort} (${f.wert})`),
      `Nackte Ebenen (Namen der Leiter benutzen, --w14-z-…):\n${bericht}`,
    ).toEqual([]);
  });

  it('die Ausnahmen-Liste wächst nie über den Stand ihrer Begründungen', () => {
    // Jede Ausnahme muss auf eine EXISTIERENDE Fundstelle zeigen. Eine
    // Ausnahme ohne Fund ist erledigt und gehört gelöscht — sonst wird die
    // Liste zum Friedhof, hinter dem sich neue Funde verstecken könnten.
    const orte = new Set(nackteEbenen().map((f) => f.ort));
    const tot = [...AUSNAHMEN].filter((a) => !orte.has(a));
    expect(tot, `Ausnahmen ohne Fundstelle (löschen): ${tot.join(', ')}`).toEqual([]);
  });
});
