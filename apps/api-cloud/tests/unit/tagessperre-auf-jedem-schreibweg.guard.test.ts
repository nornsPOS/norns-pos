/**
 * ════════════════════════════════════════════════════════════════════════
 *  Jeder Schreibweg auf `transactions` nimmt die Tagessperre
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * Sechs Wege schreiben nach `transactions`. Genau EINER nahm die geteilte
 * Sperre auf den Geschäftstag: der Verkauf. Storno, Retoure, Ankauf,
 * Ankaufschätzung und Netzbestellung liefen daneben.
 *
 * Der Tagesabschluss nimmt die ausschliessliche Sperre und rechnet dann die
 * Summen des Tages über MEHRERE Abfragen zusammen. Ein Vorgang ohne Sperre
 * kann mitten hinein festschreiben und steht dann in der einen Summe und
 * fehlt in der nächsten. Der Auslöser `transactions_validate_closing_day`
 * fängt das nicht: er weist nur Schreibvorgänge in einen bereits
 * FESTGESCHRIEBENEN Tag ab, und im gefährlichen Fenster ist `finalized_at`
 * noch NULL.
 *
 * Ein Z-Bon, dessen Zahlen einander widersprechen, ist kein Rundungsfehler.
 * § 158 AO erlaubt dem Prüfer, eine widersprüchliche Buchführung im Ganzen
 * zu verwerfen.
 *
 * ── ⚠️ WARUM DIESER WÄCHTER DIE WEGE ZÄHLT STATT SIE AUFZUZÄHLEN ────────
 *
 * Eine abgeschriebene Liste von sechs Dateinamen wäre genau der Fehler noch
 * einmal: der siebte Schreibweg käme dazu, stünde in keiner Liste, und der
 * Wächter bliebe grün. Das ist die Klasse „Wächter mit Namensliste wird
 * blind" — ein Eintrag ohne Datei wird nie geprüft und fällt nie auf.
 *
 * Deshalb wird `src/routes/` durchsucht: jede Datei, die nach `transactions`
 * schreibt, MUSS `nimmTagessperre` aufrufen. Wer morgen einen siebten Weg
 * baut, wird hier rot, ohne dass jemand daran denken muss.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROUTEN = join(HIER, '../../src/routes');

/**
 * Schreibt diese Datei nach `transactions` (dem Kopf, nicht den Zeilen)?
 *
 * `transaction_items` und `transaction_payments` sind eigene Tische und
 * hängen ohnehin am Kopf; sie zählen hier nicht.
 */
function schreibtNachTransactions(quelle: string): boolean {
  const ohneZeilen = quelle
    .replace(/insert\(transactionItems\)/g, '')
    .replace(/insert\(transactionPayments\)/g, '');
  return /\.insert\(transactions\)/.test(ohneZeilen) || /INSERT\s+INTO\s+transactions\b/i.test(ohneZeilen);
}

function alleRoutendateien(): string[] {
  return readdirSync(ROUTEN).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
}

describe('Die Tagessperre liegt auf JEDEM Schreibweg', () => {
  it('findet überhaupt Schreibwege — sonst misst dieser Wächter nichts', () => {
    const schreiber = alleRoutendateien().filter((f) =>
      schreibtNachTransactions(readFileSync(join(ROUTEN, f), 'utf8')),
    );
    // Am 08.08.2026 waren es sechs. Weniger als zwei hiesse, die Suche ist
    // kaputt, und ein grüner Lauf über eine leere Menge ist die schlimmste
    // Art von grün.
    expect(schreiber.length, `gefunden: ${schreiber.join(', ')}`).toBeGreaterThanOrEqual(2);
  });

  it('⛔ jeder Schreibweg ruft nimmTagessperre auf', () => {
    const ohneSperre: string[] = [];
    for (const datei of alleRoutendateien()) {
      const quelle = readFileSync(join(ROUTEN, datei), 'utf8');
      if (!schreibtNachTransactions(quelle)) continue;
      // Der AUFRUF, nicht der Import: ein Import allein sperrt nichts.
      // Das `(?<!as\s)` schliesst eine blosse Umbenennung aus.
      if (!/(?<!as\s)\bnimmTagessperre\s*\(/.test(quelle)) ohneSperre.push(datei);
    }
    expect(
      ohneSperre,
      'Diese Wege schreiben nach `transactions`, ohne die Tagessperre zu ' +
        `nehmen. Der Z-Bon kann sie mitten im Rechnen verlieren:\n  ${ohneSperre.join('\n  ')}`,
    ).toEqual([]);
  });

  it('⚠️ und niemand leitet den Schlüssel selbst ab', () => {
    /**
     * Sechs Abschriften derselben Ableitung driften. Der Namensraum 1146
     * darf deshalb ausserhalb von `tagessperre.ts` nur noch dort stehen, wo
     * die GEGENSEITE ihn nimmt: im Tagesabschluss, der die ausschliessliche
     * Sperre hält.
     */
    const erlaubt = new Set(['closings-finalize.ts']);
    const eigenbau: string[] = [];
    for (const datei of alleRoutendateien()) {
      if (erlaubt.has(datei)) continue;
      // ⚠️ Kommentare RAUS, bevor gemessen wird. Ein Wächter, der auf einen
      // erklärenden Satz anspringt, wird beim nächsten Mal abgeschaltet —
      // und dann schützt er gar nichts mehr. Gemessen wird Code.
      const quelle = readFileSync(join(ROUTEN, datei), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/\b1146\b/.test(quelle)) eigenbau.push(datei);
    }
    expect(
      eigenbau,
      `Diese Dateien bauen den Sperrschlüssel selbst, statt nimmTagessperre zu ` +
        `rufen:\n  ${eigenbau.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('⛔ Die Gegenseite: der Abschluss nimmt die AUSSCHLIESSLICHE Sperre', () => {
  it('auf denselben Namensraum, sonst treffen sich die beiden nie', () => {
    // Zwei Sperren auf verschiedenen Schlüsseln behindern einander nicht.
    // Driften die Namensräume auseinander, sind beide Seiten für sich
    // korrekt und zusammen wirkungslos — und nichts fällt auf.
    const abschluss = readFileSync(join(ROUTEN, 'closings-finalize.ts'), 'utf8');
    expect(abschluss).toMatch(/pg_advisory_xact_lock\s*\(\s*1146\s*,/);
  });
});
