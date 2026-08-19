/**
 * ════════════════════════════════════════════════════════════════════════
 *  Gesperrt wird der Tag, auf den WIRKLICH gebucht wird
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 *     transactions-finalize.ts:710   nimmTagessperre(tx, erfasstAm ?? null)
 *     transactions-finalize.ts:796   finalizedAtWert = null   ← 80 Zeilen später
 *
 * Gesperrt wurde der ERFASSUNGSTAG. War dieser Tag schon abgeschlossen, fiel
 * `finalized_at` auf `DEFAULT now()` — der Beleg gehörte damit dem LAUFENDEN
 * Tag, für den nie eine Sperre genommen wurde.
 *
 * Läuft in diesem Augenblick der Abschluss des laufenden Tages, sieht dessen
 * Momentaufnahme den Beleg nicht und schreibt den Z-Bon ohne ihn fest. Der
 * Beleg landet danach trotzdem in diesem Tag.
 *
 * Der Wächter `transactions_validate_closing_day()` fängt es nicht: er liest
 * `daily_closings` in READ COMMITTED und sieht die noch nicht bestätigte
 * Abschlusszeile nicht.
 *
 * Ergebnis: ein Umsatz, der in `daily_closings` fehlt, aber in DSFinV-K und
 * DATEV erscheint — beide lesen live aus `transactions`. Kopfzahlen und
 * Belegzeilen widersprechen sich, und das begründet eine Schätzungsbefugnis
 * nach § 158 AO.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buchungszeitpunkt } from '../../src/lib/tagessperre.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');
const lies = (p: string): string => readFileSync(join(REPO, p), 'utf8');

const ERFASST = new Date('2026-06-01T10:00:00.000Z');

describe('Der Buchungszeitpunkt', () => {
  it('ein Beleg von jetzt bucht auf jetzt', () => {
    expect(buchungszeitpunkt(null, false)).toBeNull();
  });

  it('ein Nachtrag in einen OFFENEN Tag bucht auf seinen eigenen Tag', () => {
    expect(buchungszeitpunkt(ERFASST, false)).toBe(ERFASST);
  });

  it('⛔ ein Nachtrag in einen ABGESCHLOSSENEN Tag bucht auf den laufenden Tag', () => {
    /**
     * `null` heisst hier: die Spalte fällt auf `DEFAULT now()`. § 146 Abs. 4 AO
     * lässt keinen Weg zurück in einen versiegelten Tag.
     *
     * Genau dieser Fall war der Befund: die Sperre lag auf dem Erfassungstag,
     * gebucht wurde hierher.
     */
    expect(buchungszeitpunkt(ERFASST, true)).toBeNull();
  });
});

describe('⛔ Die Sperre bekommt den BUCHUNGSTAG, nicht den Erfassungstag', () => {
  const quelle = (): string => lies('apps/api-cloud/src/routes/transactions-finalize.ts');

  const ohneKommentare = (q: string): string =>
    q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('⛔ die Sperre nimmt den entschiedenen Wert', () => {
    // ⚠️ Gemessen ohne Kommentare: der Kopf dieser Route ZITIERT den alten
    // Aufruf, und ein Wächter, der auf eine Erklärung anspringt, wird beim
    // nächsten Mal abgeschaltet.
    const q = ohneKommentare(quelle());
    expect(q).toContain('nimmTagessperre(tx, finalizedAtWert)');
    expect(q, 'der alte Aufruf steht noch da').not.toMatch(
      /nimmTagessperre\(tx,\s*erfasstAm/,
    );
  });

  it('⛔ und die Entscheidung fällt VOR der Sperre, nicht danach', () => {
    /**
     * Die eigentliche Aussage des Befunds ist die REIHENFOLGE. Stünde
     * `buchungszeitpunkt` wieder hinter `nimmTagessperre`, wäre der Wert beim
     * Sperren gar nicht bekannt — und der Fehler wäre zurück, obwohl der
     * Aufruf oben richtig aussieht.
     */
    const q = ohneKommentare(quelle());
    const entscheidung = q.indexOf('buchungszeitpunkt(');
    const sperre = q.indexOf('nimmTagessperre(tx,');
    expect(entscheidung).toBeGreaterThan(-1);
    expect(sperre).toBeGreaterThan(-1);
    expect(entscheidung, 'die Entscheidung steht hinter der Sperre').toBeLessThan(sperre);
  });

  it('⚠️ und es gibt nur EINE Stelle, die den Buchungstag entscheidet', () => {
    // Zwei Stellen würden driften, und die Sperre hinge dann wieder an der
    // falschen. Das war die Bauart des Fehlers.
    const q = ohneKommentare(quelle());
    expect([...q.matchAll(/finalizedAtWert\s*=/g)]).toHaveLength(1);
  });
});
