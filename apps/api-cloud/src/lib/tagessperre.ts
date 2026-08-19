/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE TAGESSPERRE — jeder Schreibweg auf `transactions` nimmt sie
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ──────────────────────────────────────────────
 *
 * Auf `transactions` schreiben SECHS Wege. Gezählt, nicht geschätzt:
 *
 *     transactions-finalize.ts:821   der Verkauf          ← nahm die Sperre
 *     transactions-storno.ts:250     der Storno           ← nahm sie NICHT
 *     transactions-return.ts:138     die Retoure          ← nahm sie NICHT
 *     transactions-ankauf.ts:328     der Ankauf           ← nahm sie NICHT
 *     appraisals.ts:616              die Ankaufschätzung  ← nahm sie NICHT
 *     storefront-webhook.ts:580      die Netzbestellung   ← nahm sie NICHT
 *
 * Einer von sechs.
 *
 * ── WAS DABEI KAPUTTGEHT ──────────────────────────────────────────────────
 *
 * Der Tagesabschluss nimmt die AUSSCHLIESSLICHE Sperre auf denselben
 * Schlüssel, wartet damit auf jeden laufenden Verkauf, und rechnet dann die
 * Summen des Tages zusammen. Genau dafür gibt es sie.
 *
 * Ein Ankauf, der die Sperre nicht nimmt, läuft daneben weiter. Er kann
 * mitten hinein festschreiben, WÄHREND der Abschluss seine Summen liest —
 * und der Abschluss liest mehrere Abfragen nacheinander. Der Ankauf steht
 * dann in der einen Summe und fehlt in der nächsten.
 *
 * Der Auslöser `transactions_validate_closing_day` fängt das NICHT: er weist
 * nur Schreibvorgänge in einen bereits FESTGESCHRIEBENEN Tag ab. Im
 * gefährlichen Fenster ist `finalized_at` des Abschlusses noch NULL.
 *
 * Das Ergebnis ist ein Z-Bon, dessen Zahlen nicht zueinander passen. Das ist
 * kein Rundungsfehler, sondern ein Widerspruch in einem Dokument, das
 * § 146 AO als Grundlage der Buchführung verlangt — und § 158 AO erlaubt dem
 * Prüfer, eine widersprüchliche Buchführung im Ganzen zu verwerfen.
 *
 * ── ⚠️ DER SCHLÜSSEL IST DER TAG DER ERFASSUNG ────────────────────────────
 *
 * Nicht der Tag des Eingangs. Ein aus dem Offline-Speicher nachgespielter
 * Vorgang trägt das Datum von gestern und gehört in den Z-Bon von GESTERN.
 * Nähme er die Sperre von heute, könnte der Abschluss von gestern genau
 * daneben laufen — also derselbe Fehler, nur einen Tag versetzt.
 *
 * Ohne Erfassungszeit gilt der Eingangstag, und das ist dann auch der
 * richtige.
 *
 * ── WARUM DIESE DATEI EXISTIERT ───────────────────────────────────────────
 *
 * Die Ableitung des Schlüssels stand an einer Stelle im Quelltext und musste
 * an sechs stehen. Sechs Abschriften driften; eine Stelle nicht. Der Wächter
 * `tagessperre-auf-jedem-schreibweg.guard.test.ts` zählt die Schreibwege aus
 * dem Quelltext und verlangt für jeden den Aufruf von hier.
 */

import { sql } from 'drizzle-orm';

/** Was hier gebraucht wird: irgendetwas, das SQL in DIESER Transaktion ausführt. */
export interface SperrbareTransaktion {
  execute: (abfrage: ReturnType<typeof sql>) => Promise<unknown>;
}

/**
 * Der Namensraum der Tagessperre. Der Abschluss nimmt denselben.
 *
 * Der Schlüsselraum aus zwei `int` ist getrennt von den Sperren mit einem
 * einzelnen `bigint` (etwa die Terminfenster), es gibt also keine Kollision.
 */
export const TAGESSPERRE_NAMENSRAUM = 1146;

/**
 * ⛔ AUF WELCHEN TAG BUCHT DIESER BELEG WIRKLICH?
 *
 * ── DER BEFUND VOM 08.08.2026 ────────────────────────────────────────────
 *
 * `transactions-finalize.ts` nahm die Sperre auf den ERFASSUNGSTAG (Zeile 710)
 * und entschied den BUCHUNGSTAG erst achtzig Zeilen später (Zeile 796 bis 813).
 * Ist der Erfassungstag schon abgeschlossen, fällt `finalized_at` auf
 * `DEFAULT now()` — der Beleg gehört dann dem LAUFENDEN Tag, für den nie eine
 * Sperre genommen wurde.
 *
 * Läuft in diesem Augenblick der Abschluss des laufenden Tages, sieht dessen
 * Momentaufnahme den Beleg nicht, schreibt den Z-Bon ohne ihn fest, und der
 * Beleg landet danach trotzdem in diesem Tag. Der Wächter
 * `transactions_validate_closing_day()` fängt es nicht: er liest
 * `daily_closings` in READ COMMITTED und sieht die noch nicht bestätigte
 * Abschlusszeile nicht.
 *
 * Ergebnis: ein Umsatz, der in `daily_closings` fehlt, aber in DSFinV-K und
 * DATEV erscheint — beide lesen live aus `transactions`. Kopfzahlen und
 * Belegzeilen widersprechen sich, und genau das begründet eine
 * Schätzungsbefugnis nach § 158 AO.
 *
 * ── DIE REGEL ────────────────────────────────────────────────────────────
 *
 * Gesperrt wird der Tag, auf den WIRKLICH gebucht wird. Beide Tage zu sperren
 * wäre nicht nötig: der Beleg landet in genau einem.
 *
 * Rein, damit die Entscheidung prüfbar ist — sie stand vorher mitten in einer
 * 200-Zeilen-Route und konnte von keinem Test erreicht werden.
 *
 * @param erfasstAm Der nachgetragene Zeitpunkt, oder null bei einem Beleg von
 *   jetzt.
 * @param erfassungstagAbgeschlossen Ist der Kassentag dieses Zeitpunkts schon
 *   festgeschrieben?
 * @returns Der Zeitpunkt, der in `finalized_at` landet. `null` heisst: die
 *   Spalte fällt auf `DEFAULT now()`, also der laufende Tag.
 */
export function buchungszeitpunkt(
  erfasstAm: Date | null,
  erfassungstagAbgeschlossen: boolean,
): Date | null {
  if (erfasstAm === null) return null;
  // Ein Nachtrag in einen versiegelten Tag geht NICHT dorthin zurück
  // (§ 146 Abs. 4 AO), sondern in den laufenden Tag.
  return erfassungstagAbgeschlossen ? null : erfasstAm;
}

/**
 * Die GETEILTE Sperre auf den Geschäftstag dieses Vorgangs nehmen.
 *
 * Geteilte Sperren behindern einander nicht, gleichzeitige Verkäufe laufen
 * also ungebremst. Nur der einmal tägliche Abschluss wartet, und genau das
 * soll er.
 *
 * Gilt bis zum COMMIT dieser Transaktion; es gibt nichts freizugeben.
 *
 * @param erfassungszeit Die Zeit, die der Vorgang trägt. `null`/`undefined`
 *   heisst: der Eingangstag gilt.
 */
export async function nimmTagessperre(
  tx: SperrbareTransaktion,
  erfassungszeit?: Date | string | null,
): Promise<void> {
  const zeit =
    erfassungszeit == null
      ? null
      : erfassungszeit instanceof Date
        ? erfassungszeit.toISOString()
        : erfassungszeit;

  await tx.execute(sql`
    SELECT pg_advisory_xact_lock_shared(
      ${TAGESSPERRE_NAMENSRAUM},
      (berlin_business_day(COALESCE(${zeit}::timestamptz, now()))::date - DATE '1970-01-01')::int)`);
}
