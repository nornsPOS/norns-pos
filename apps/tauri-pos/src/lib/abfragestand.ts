/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  abfragestand — was eine Abfrage GERADE ist, ohne Loch
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 (an der laufenden Kasse gemessen) ────────────
 *
 * Die Ankaufsfläche zeigte eine LEERE linke Spalte: die Überschrift
 * „Verkäufer", darunter nichts. Kein Ladehinweis, keine Meldung, kein Weg
 * heraus ausser dem kleinen „anderer Kunde".
 *
 * Der Grund, im Abfragespeicher abgelesen:
 *
 *     status: 'pending'   fetchStatus: 'paused'   fehlversuche: 1
 *
 * Die Abfrage war einmal gescheitert und hatte sich dann SCHLAFEN GELEGT:
 * react-query pausiert einen Wiederholungsversuch, solange es die Anwendung
 * für offline hält. In diesem Zustand ist
 *
 *     isLoading === false        (pausiert heisst nicht ladend)
 *     isError   === false        (der Versuch ist nicht aufgegeben)
 *     data      === undefined
 *
 * Und die Fläche prüfte genau diese drei. Alle drei falsch, also nichts.
 *
 * ── WARUM DAS KEIN EINZELFALL WAR ──────────────────────────────────────────
 *
 * Am 20.08.2026 gemessen: ZEHN Flächen der Kasse trugen dasselbe Muster
 * (`isLoading && …` / `isError && …` / `data && …`), und KEINE EINZIGE kannte
 * den vierten Zustand. Eine Kasse, deren Motor kurz stolpert — er startet
 * neu, die Datenbank ist beschäftigt, das Gerät kommt aus dem Schlaf —,
 * zeigte dem Menschen am Tresen eine leere Fläche und sagte nicht, warum.
 *
 * ── DIE ANTWORT ────────────────────────────────────────────────────────────
 *
 * Nicht zehn Flicken, sondern ein Satz Zustände, der VOLLSTÄNDIG ist. Wer
 * ihn benutzt, kann keinen Fall vergessen: die Fallunterscheidung ist eine
 * Vereinigung, und TypeScript besteht auf jedem Zweig.
 */

/** Was eine Abfrage gerade ist. Vollständig, ohne stillen vierten Fall. */
export type Abfragestand =
  /** Sie läuft, zum ersten Mal. */
  | { art: 'laedt' }
  /**
   * Sie hat es versucht, ist gescheitert, und wartet auf die Verbindung.
   *
   * ⚠️ Genau der Zustand, der die Flächen leer liess. Er ist KEIN Fehler —
   * die Kasse gibt nicht auf — aber er ist auch kein Laden, und er kann
   * lange dauern. Er gehört gesagt.
   */
  | { art: 'wartet' }
  /** Sie ist aufgegeben. Der Satz sagt, woran. */
  | { art: 'fehler'; satz: string }
  /** Sie ist fertig und hat nichts gefunden. */
  | { art: 'leer' }
  /** Sie ist fertig und hat etwas. */
  | { art: 'da' };

/** Die Felder, die dieser Leser aus einer Abfrage braucht. */
export interface Abfrageblick {
  isPending: boolean;
  isPaused: boolean;
  isError: boolean;
  data: unknown;
}

/**
 * Den Stand einer Abfrage bestimmen.
 *
 * Die Reihenfolge ist Absicht und nicht beliebig:
 *
 *   1. `data` zuerst. Liegt ein Stand vor, ist er der Wahrheit näher als
 *      jeder laufende Versuch — eine Fläche, die schon etwas zeigt, soll
 *      beim Nachladen nicht auf einen Ladehinweis zurückfallen.
 *   2. `wartet` VOR `laedt`. Pausiert ist eine Untermenge von „noch nichts
 *      da", und die spezifischere Aussage gewinnt.
 *   3. `fehler` vor `laedt`, damit ein Wiederholungslauf die schon bekannte
 *      Absage nicht verdeckt.
 */
export function abfragestand(q: Abfrageblick, fehlersatz: () => string): Abfragestand {
  if (q.data !== undefined && q.data !== null) return { art: 'da' };
  if (q.isPaused) return { art: 'wartet' };
  if (q.isError) return { art: 'fehler', satz: fehlersatz() };
  if (q.isPending) return { art: 'laedt' };
  return { art: 'leer' };
}

/** Der Satz, den die Kasse für einen Stand sagt. */
export function standSatz(stand: Abfragestand, was: string): string {
  switch (stand.art) {
    case 'laedt':
      return `${was} wird geladen…`;
    case 'wartet':
      // Kein „Fehler": die Kasse versucht es weiter. Aber sie sagt, worauf
      // gewartet wird — sonst steht der Mensch vor einer stummen Fläche.
      return `Keine Verbindung zum Motor. ${was} wird geholt, sobald er wieder antwortet.`;
    case 'fehler':
      return stand.satz;
    case 'leer':
      return `${was}: nichts gefunden.`;
    case 'da':
      return '';
  }
}
