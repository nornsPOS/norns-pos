/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Kein Geist gilt als Verkäufer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 (an der laufenden Kasse gemessen) ────────────
 *
 * Der Ankauf fragte den KORB („steht da eine Kundenkennung?") statt die
 * BÜCHER („gibt es diese Person?"). Eine Kennung aus einem geparkten Ankauf,
 * die es nicht mehr gab, galt damit als Verkäufer:
 *
 *   • die Schrittleiste sprang auf „2 · Stücke bewerten",
 *   • das Erfassungsformular ging auf (43 von 46 Bedienelementen bedienbar),
 *   • die linke Spalte blieb leer und sagte nicht, warum,
 *   • und aufgefallen wäre es erst beim Bezahlen, mit einem Menschen davor.
 *
 * Am echten Tresen entsteht das durch eine Löschung nach der
 * Datenschutz-Grundverordnung, eine zurückgespielte Sicherung, oder einen
 * Ankauf, der an einer anderen Kasse begonnen wurde.
 *
 * ── WAS DIESER WÄCHTER HÄLT ────────────────────────────────────────────────
 *
 * Dass die Sperre des Formulars an der bestätigten Person hängt und nicht an
 * der blossen Kennung — und dass beide Leser (Spalte und Boden) DIESELBE
 * Quelle befragen, damit sie nicht verschiedener Meinung sein können.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const lies = (n: string): string => readFileSync(join(HIER, n), 'utf8');

/**
 * Der Quelltext OHNE Kommentare.
 *
 * ⚠️ Ohne das misst dieser Wächter seine eigene Begründung: der Grabstein in
 * `Ankauf.tsx` zitiert die alte Zeile („hier stand `customerId !== null`"),
 * und die erste Fassung dieses Satzes wurde daran rot. Ein Wächter, der auf
 * Prosa anschlägt, misst nicht die Sache.
 */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('⛔ Kein Geist gilt als Verkäufer', () => {
  const boden = ohneKommentare(lies('Ankauf.tsx'));
  const spalte = lies('CustomerPanel.tsx');
  const quelle = ohneKommentare(lies('verkaeufer-stand.ts'));

  it('⛔ der Boden sperrt an der BESTÄTIGTEN Person, nicht an der Kennung', () => {
    expect(
      /customerId\s*!==\s*null/.test(boden),
      'Der Ankaufsboden entscheidet wieder an der blossen Kennung aus dem ' +
        'Korb. Eine gelöschte Person gälte damit als Verkäufer.',
    ).toBe(false);
    expect(boden).toContain('useVerkaeuferStand');
    expect(/hasCustomer\s*=\s*verkaeufer\.steht/.test(boden)).toBe(true);
  });

  it('⛔ „steht" verlangt Daten aus den Büchern, nicht nur eine Kennung', () => {
    // Die eine Zeile, an der alles hängt.
    expect(/steht:\s*kennung\s*!==\s*null\s*&&\s*q\.data\s*!==\s*undefined/.test(quelle)).toBe(
      true,
    );
  });

  it('⛔ Spalte und Boden fragen DIESELBE Quelle', () => {
    // Zwei eigene Abfragen könnten auseinanderlaufen: die Spalte zeigte
    // einen Verkäufer, das Formular bliebe gesperrt — oder umgekehrt.
    expect(spalte).toContain('useVerkaeuferStand');
    expect(boden).toContain('useVerkaeuferStand');
  });

  it('⛔ der Geist wird an der letzten Absage erkannt, nicht erst am Aufgeben', () => {
    // Gemessen: nach zwei echten 404 stand `error` auf leer, weil
    // react-query noch weiterversuchte. Nur `failureReason` trug die
    // Auskunft — ohne sie sagte die Fläche „keine Verbindung", obwohl der
    // Motor klar geantwortet hatte.
    expect(quelle).toContain('failureReason');
    expect(quelle).toContain("code === 'NOT_FOUND'");
  });

  it('⛔ der Korb wird NICHT still geleert', () => {
    // Ein Korb, der sich unter der Hand selbst leert, ist am Tresen
    // unheimlicher als einer, der sagt, was ihm fehlt.
    expect(/setCustomerId\(null\)/.test(quelle)).toBe(false);
    // Der Griff dazu gehört dem Menschen, in der Spalte.
    expect(spalte).toContain('Verkäufer neu wählen');
  });

  it('die Spalte bleibt in KEINEM Zustand stumm', () => {
    // Sie rendert entweder die Karte oder einen Satz — nie nichts.
    expect(spalte).toContain('standSatz');
  });
});
