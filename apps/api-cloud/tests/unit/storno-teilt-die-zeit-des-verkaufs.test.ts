/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VERKAUF UND STORNO HATTEN ZWEI VERSCHIEDENE UHREN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Seit Wanderung 0118 bringt ein Verkauf seine eigene Zeit mit: `erfasstAm`
 * kommt vom GERÄT, damit ein am nächsten Morgen aus dem Offline-Speicher
 * nachgespielter Beleg im Z-Bon von GESTERN landet.
 *
 * Der Storno kannte das Feld nicht. Sein `finalized_at` kam aus
 * `DEFAULT now()` — der Uhr des SERVERS.
 *
 * ── Im Monatslauf gemessen (28.07.2026) ──────────────────────────────────
 *
 *     Verkauf  RCP-2026-000074   Geschäftstag 2026-06-19
 *     Storno   RCP-2026-000075   Geschäftstag 2026-07-28
 *
 * Der Erlös stand in einem Tagesabschluss, seine Aufhebung in einem anderen.
 *
 * ── Warum das auch in der Produktion zählt ───────────────────────────────
 *
 * Dort teilen Anwendung und Datenbank dieselbe Uhr, der Alltagsfall geht also
 * gut. NICHT gut gehen genau die Fälle, für die es die Gerätezeit überhaupt
 * gibt:
 *
 *   • Ein NACHGESPIELTER Verkauf trägt das Datum von gestern. Sein Storno
 *     bekäme das von heute.
 *   • Ein Verkauf um 23:58 und sein Storno um 00:02 fallen auseinander — und
 *     da `transactions_validate_closing_day` den zweiten Tag hindert, den
 *     ersten aufzuheben, bliebe der Erlös stehen.
 *
 * ── Und warum die Prüfung in eine eigene Datei zog ───────────────────────
 *
 * Sie stand wörtlich in `transactions-finalize.ts`. Sie in den Storno zu
 * KOPIEREN hätte zwei Fassungen derselben Fiskalregel ergeben, und dann gilt
 * für Verkauf und Storno verschiedenes Recht, sobald eine geändert wird.
 *
 * ── Nachgezogen am 11.08.2026 (Befund 12: der Storno kennt den Nachtrag) ──
 *
 * WAS war der Befund: der Storno schrieb die geprüfte Gerätezeit DIREKT in
 * `finalized_at`. Lag der Tag des Urbelegs schon FINALIZED, wies der
 * Auslöser den Storno mit `CLOSING_DAY_FINALIZED` ab, der wirklich geschehene
 * Storno war nicht aufzeichenbar. WARUM der naheliegende Weg falsch wäre:
 * die alte Quelltextform hier festzuhalten hätte genau diese Direktschrift
 * erzwungen. Die Gerätezeit läuft jetzt wie beim Verkauf durch
 * `buchungszeitpunkt` aus `tagessperre.ts`: offener Tag heisst Gerätezeit,
 * versiegelter Tag heisst laufender Tag plus `nachtrag_bezugstag`. WAS die
 * angepassten Sätze messen: dieselbe Wirkung wie vorher, nur an der neuen
 * Kette — die geprüfte Zeit erreicht `finalized_at` wirklich, und ohne
 * Angabe bricht nichts ab. Den Nachtragsweg selbst misst
 * `tests/integration/storno-nachtrag-in-den-laufenden-tag.test.ts` gegen ein
 * echtes Postgres.
 */

import { describe, expect, it } from 'vitest';

import {
  HOECHSTALTER_MS,
  pruefeErfassungszeit,
  ZUKUNFT_TOLERANZ_MS,
} from '../../src/lib/erfassungszeit.js';

const jetzt = new Date('2026-06-19T18:00:00.000Z');

describe('die Regel selbst', () => {
  it('ohne Angabe gilt die Serverzeit', () => {
    expect(pruefeErfassungszeit(null, jetzt)).toEqual({ erfasstAm: null });
    expect(pruefeErfassungszeit(undefined, jetzt)).toEqual({ erfasstAm: null });
  });

  it('eine gültige Zeit wird übernommen', () => {
    const b = pruefeErfassungszeit('2026-06-19T10:30:00.000Z', jetzt);
    expect(b.fehler).toBeUndefined();
    expect(b.erfasstAm?.toISOString()).toBe('2026-06-19T10:30:00.000Z');
  });

  it('⛔ Unsinn wird abgewiesen, nicht als „jetzt" gedeutet', () => {
    const b = pruefeErfassungszeit('gestern Abend', jetzt);
    expect(b.fehler?.nachricht).toContain('keine gültige Zeitangabe');
    expect(b.erfasstAm).toBeNull();
  });

  it('⛔ eine Zeit aus der Zukunft wird abgewiesen', () => {
    const b = pruefeErfassungszeit(
      new Date(jetzt.getTime() + ZUKUNFT_TOLERANZ_MS + 1000).toISOString(),
      jetzt,
    );
    expect(b.fehler?.nachricht).toContain('Zukunft');
  });

  it('aber ein kleiner Uhrenversatz bleibt erlaubt', () => {
    // Eine Kasse ohne Zeitabgleich weicht um Sekunden ab; daran soll kein
    // Verkauf scheitern.
    const b = pruefeErfassungszeit(new Date(jetzt.getTime() + 30_000).toISOString(), jetzt);
    expect(b.fehler).toBeUndefined();
  });

  it('⛔ älter als sieben Tage wird abgewiesen', () => {
    const b = pruefeErfassungszeit(
      new Date(jetzt.getTime() - HOECHSTALTER_MS - 1000).toISOString(),
      jetzt,
    );
    expect(b.fehler?.nachricht).toContain('sieben Tage');
  });

  it('sechs Tage alt geht durch — der Offline-Speicher braucht das', () => {
    const b = pruefeErfassungszeit(
      new Date(jetzt.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      jetzt,
    );
    expect(b.fehler).toBeUndefined();
  });
});

/**
 * ⚠️ Die Wächter: BEIDE Wege müssen dieselbe Regel benutzen.
 */
describe('Verkauf und Storno benutzen DIESELBE Prüfung', () => {
  const lies = async (p: string) =>
    (await import('node:fs')).readFileSync(new URL(p, import.meta.url), 'utf8');
  const ohneKommentare = (q: string) =>
    q
      .split('\n')
      .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
      .join('\n');

  it('finalize ruft die Bibliothek', async () => {
    const q = ohneKommentare(await lies('../../src/routes/transactions-finalize.ts'));
    expect(q).toContain('pruefeErfassungszeit(body.erfasstAm');
  });

  it('⛔ und der STORNO ebenfalls', async () => {
    const q = ohneKommentare(await lies('../../src/routes/transactions-storno.ts'));
    expect(q, 'der Storno prüft die Zeit nicht').toContain('pruefeErfassungszeit(');
  });

  it('⛔ der Storno SCHREIBT die Gerätezeit auch wirklich', async () => {
    // Sie zu prüfen und dann zu verwerfen wäre die schlimmste Variante:
    // ein grüner Riegel ohne Wirkung. Seit dem 11.08.2026 (Befund 12) läuft
    // die geprüfte Zeit nicht mehr DIREKT in `finalized_at`, sondern wie beim
    // Verkauf durch `buchungszeitpunkt`; gemessen wird die ganze Kette.
    const q = ohneKommentare(await lies('../../src/routes/transactions-storno.ts'));
    expect(q).toContain('const erfasstAm = zeitbefund.erfasstAm');
    expect(q).toMatch(/const finalizedAtWert = buchungszeitpunkt\(erfasstAm/);
    expect(q).toMatch(/finalizedAtWert\s*\?\s*\{\s*finalizedAt:\s*finalizedAtWert\s*\}/);
  });

  it('⚠️ und eine ÄLTERE Kasse ohne das Feld läuft weiter', async () => {
    // Sie sendet `erfasstAm` nicht. Dann muss die Serverzeit gelten, nicht
    // ein Abbruch — sonst kann nach dem Ausrollen niemand mehr stornieren,
    // bis jede Kasse aktualisiert ist. `buchungszeitpunkt(null, …)` liefert
    // null, also müssen BEIDE Spalten bedingt geschrieben werden: fehlt die
    // Zeit, fällt `finalized_at` auf `DEFAULT now()`.
    expect(pruefeErfassungszeit(undefined, jetzt).fehler).toBeUndefined();
    const q = ohneKommentare(await lies('../../src/routes/transactions-storno.ts'));
    expect(q).toMatch(/\.\.\.\(finalizedAtWert \? \{ finalizedAt: finalizedAtWert \} : \{\}\)/);
    expect(q).toMatch(/\.\.\.\(erfasstAm \? \{ erfasstAm \} : \{\}\)/);
  });

  it('⛔ und die Regel steht NICHT zweimal im Quelltext', async () => {
    // Zwei Kopien einer Fiskalregel laufen auseinander, sobald eine geändert
    // wird — dann gilt für Verkauf und Storno verschiedenes Recht.
    for (const datei of [
      '../../src/routes/transactions-finalize.ts',
      '../../src/routes/transactions-storno.ts',
    ]) {
      const q = ohneKommentare(await lies(datei));
      expect(
        /const (ZUKUNFT_TOLERANZ_MS|HOECHSTALTER_MS)\s*=/.test(q),
        `${datei} hält eine eigene Kopie der Grenzwerte`,
      ).toBe(false);
    }
  });
});
