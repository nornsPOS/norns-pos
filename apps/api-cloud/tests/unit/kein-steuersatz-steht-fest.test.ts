// @vitest-environment node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Kein Steuersatz steht als feste Zahl im Rechenweg
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DIE GESCHICHTE, DIE DIESEN WÄCHTER ERZWUNGEN HAT ──────────────────────
 *
 * 20.08.2026: die festen Sätze wurden an VIER Stellen durch `satzAm` aus
 * `@norns/domain` ersetzt. Der Kopf von `umsatzsteuersaetze.ts` zählt sie auf.
 *
 * 21.08.2026, beim Nachmessen: ZWEI davon lebten weiter.
 *
 *   • `cart-math.ts`, Fall REVERSE_CHARGE_13B:
 *         roundHalfEven(total * 100n, 119n)
 *     Beim § 13b weist der Verkäufer KEINE Steuer aus — der Käufer schuldet
 *     sie und rechnet sie auf das NETTO. Ein falsches Netto ist die falsche
 *     Steuerschuld des KÄUFERS, und auf dem Beleg steht keine Steuer, an der
 *     es auffallen könnte. Gemessen: 1.190,00 brutto im Corona-Halbjahr
 *     ergaben 1.000,00 statt 1.025,86 EUR.
 *
 *   • `dsfinvk-daten.ts`, Rabatt auf eine § 25a-Marge:
 *         (marge * 19n + 59n) / 119n
 *     mit dem Kommentar „dieselbe Zeile wie in marge-nachrechnen.ts" — und
 *     GENAU die war am Vortag umgestellt worden. Die zwei waren
 *     auseinandergelaufen, der Kommentar behauptete weiter Gleichheit. Diese
 *     Zahl landet im PRÜFERPAKET.
 *
 * ── WARUM EIN WÄCHTER UND NICHT ZWEI KORREKTUREN ──────────────────────────
 *
 * Eine Korrektur heilt EINE Zeile. Diese Klasse ist zweimal in zwei Tagen
 * wiedergekommen, beide Male beim Umstellen selbst. Sie muss unmöglich
 * werden, nicht sorgfältig vermieden.
 *
 * ── WAS ERLAUBT BLEIBT ────────────────────────────────────────────────────
 *
 * `umsatzsteuersaetze.ts` SELBST — dort stehen die Sätze als Verzeichnis, das
 * ist ihr Zuhause. Und Proben dürfen Zahlen nennen: sie prüfen ja gerade,
 * dass eine bestimmte herauskommt.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

/** Wo gerechnet wird. Erzeugnisse und der gebündelte Beiläufer bleiben aussen. */
const ORTE = ['apps/api-cloud/src', 'apps/tauri-pos/src', 'packages/domain/src'];

/**
 * Die Brüche, mit denen man aus einem Bruttobetrag die Steuer zieht.
 * `119`/`107` und ihre Zähler `19`/`7` — als BigInt-Literale oder als Zahlen
 * in einer Division.
 */
const BRUCH = /\b(?:19n\s*,\s*119n|119n|107n|\*\s*19n|\*\s*7n)\b|\b(?:100n\s*,\s*119n)\b/;

/** Der Satz als Zeichenkette, wie ihn die Datenbank führt. */
const SATZ_TEXT = /'0\.(?:1900|0700|1600|0500)'/;

/** Dateien, die ihre Sätze von Berufs wegen nennen dürfen. */
const ZUHAUSE = ['umsatzsteuersaetze.ts'];

/**
 * Zeilen, die einen Satz NENNEN statt mit ihm zu RECHNEN.
 *
 * ⚠️ Der Unterschied ist der ganze Punkt dieses Wächters. `examples:
 * ['0.0700', '0.1900']` in einer Schemabeschreibung erzeugt keinen Betrag —
 * es zeigt einem Menschen, wie das Feld aussieht. Wer solche Zeilen mitzählt,
 * baut einen Wächter, den man abschaltet, statt ihn zu befolgen.
 */
const NUR_GENANNT = /\b(?:examples?|description|default|enum|beispiel)\b\s*:/;

function dateien(wurzel: string): string[] {
  const raus: string[] = [];
  const gehe = (ort: string): void => {
    let namen: string[];
    try {
      namen = readdirSync(ort);
    } catch {
      return;
    }
    for (const name of namen) {
      if (name === 'node_modules' || name === 'dist' || name === 'src-tauri') continue;
      const voll = join(ort, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') && !/\.test\.tsx?$/.test(name)) {
        raus.push(voll);
      }
    }
  };
  gehe(wurzel);
  return raus;
}

/** Ohne Kommentare — die Erklärungen ZITIEREN die alten Zahlen. */
function nurCode(inhalt: string): string[] {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((z) => (z.trim().startsWith('//') ? '' : z));
}

describe('⛔ Kein Steuersatz steht als feste Zahl im Rechenweg', () => {
  const alle = ORTE.flatMap((o) => dateien(join(WURZEL, o)));

  it('findet überhaupt Dateien — der Wächter darf nicht ins Leere greifen', () => {
    expect(alle.length).toBeGreaterThan(200);
  });

  it('⛔ keine Rechenzeile trägt 19/119, 7/107 oder einen Satz als Text', () => {
    const suender: string[] = [];
    for (const datei of alle) {
      if (ZUHAUSE.some((z) => datei.endsWith(z))) continue;
      nurCode(readFileSync(datei, 'utf8')).forEach((zeile, i) => {
        if (NUR_GENANNT.test(zeile)) return;
        if (BRUCH.test(zeile) || SATZ_TEXT.test(zeile)) {
          suender.push(`${datei.slice(WURZEL.length + 1)}:${i + 1}  ${zeile.trim().slice(0, 72)}`);
        }
      });
    }
    expect(
      suender,
      'Diese Zeilen rechnen mit einem FESTEN Steuersatz. Der Satz hängt am TAG ' +
        '(im Corona-Halbjahr 2020 waren es 16 statt 19 Prozent). Richtig ist ' +
        '`bruttoBruch(satzAm("REGEL", tag))` aus @norns/domain.',
    ).toEqual([]);
  });
});
