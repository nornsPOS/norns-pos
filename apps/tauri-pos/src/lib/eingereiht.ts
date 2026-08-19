/**
 * „Sicher eingereiht" ist ein ERFOLG. Hier steht das an EINER Stelle.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIESE FEHLERKLASSE IST IN DIESEM HAUS SCHON ZWEIMAL AUFGETRETEN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ApiOfflineQueuedError` erbt von `Error` und NICHT von `ApiError`. Wer also
 * schreibt
 *
 *     if (err instanceof ApiError) { zeigeFehler(err) }
 *     else { setError('Verbindung gestört. Netzwerk prüfen.') }
 *
 * fällt in den unteren Zweig und behauptet gegenüber der Kassiererin, es sei
 * etwas schiefgegangen, obwohl ihr Wille sicher im Ausgangskorb liegt und
 * übertragen wird, sobald das Netz zurück ist.
 *
 * Die Doktrin steht seit jeher ausdrücklich in
 * `packages/api-client/src/errors.ts`:
 *
 *     „Semantically this is a success from the UI's point of view … The
 *      catching screen should advance its optimistic state and render a calm
 *      badge, NOT an error toast."
 *
 * Am 07.06.2026 wurde genau das gemeldet und NUR für den Ankauf behoben. Am
 * 26.07.2026 fand eine Prüfung dieselbe Stelle in vier weiteren Masken:
 * Kassenbewegung, Z-Abschluss, Storno und Schichtöffnung.
 *
 * ── Warum das nicht bloss hässlich, sondern teuer ist ─────────────────────
 *
 * Die Kassiererin liest „Netzwerk prüfen" und drückt folgerichtig erneut. Bei
 * der Kassenbewegung entstand daraus eine ZWEITE Zeile im Kassenbuch, und der
 * Blindsturz wies danach eine Differenz aus, die niemand verursacht hatte.
 * `cash_movements` ist fortschreibend: die Phantomzeile lässt sich weder
 * löschen noch berichtigen, nur gegenbuchen.
 *
 * Deshalb liegt die Antwort jetzt hier und nicht in fünf Masken nebeneinander.
 * Wer eine sechste Maske baut, findet diese Datei, bevor er den Fehler
 * wiederholt.
 */

import {
  ApiCircuitOpenError,
  ApiNetworkError,
  ApiOfflineQueuedError,
} from '@norns/api-client';

/**
 * Wurde der Vorgang sicher eingereiht statt zu scheitern?
 *
 * Bewusst eine Funktion und kein blosses `instanceof` an der Aufrufstelle: so
 * gibt es einen Namen, nach dem man suchen kann, und einen Ort für den Grund.
 */
export function istSicherEingereiht(err: unknown): err is ApiOfflineQueuedError {
  return err instanceof ApiOfflineQueuedError;
}

/**
 * Der ruhige Hinweis, den die Kassiererin sehen soll.
 *
 * Zwei Dinge muss er leisten, und beide sind wichtig:
 *   1. sagen, dass NICHTS verloren ist,
 *   2. ausdrücklich davon abhalten, es noch einmal einzutragen.
 *
 * Der zweite Satz ist der eigentliche Schutz. Ohne ihn liest ein Mensch
 * „offline gespeichert" und trägt es sicherheitshalber trotzdem noch einmal
 * ein.
 */
export function eingereihtHinweis(vorgang: string): {
  tone: 'info';
  title: string;
  body: string;
} {
  return {
    tone: 'info',
    title: `${vorgang} offline gespeichert`,
    body: 'Wird übertragen, sobald die Verbindung zurück ist. Bitte NICHT erneut eintragen.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DER ANDERE ZWEIG: WAS DIE FLÄCHE SAGT, WENN ES KEIN ApiError WAR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Gemessen über den ganzen Quellbaum der Kasse: der Satz „Verbindung gestört"
 * stand an ZWANZIG Stellen, in zwei Fassungen, die verschiedene Dinge raten:
 *
 *     „Verbindung gestört. Bitte erneut versuchen."   10 Dateien
 *     „Verbindung gestört. Netzwerk prüfen."          10 Dateien
 *
 * Jede stand im `else` von `if (err instanceof ApiError)`. Dieser Zweig ist
 * aber NICHT „das Netz ist weg". Er ist „es war keine geordnete Antwort des
 * Servers", und darunter liegen vier verschiedene Lagen:
 *
 *   · der Vorgang liegt SICHER im Ausgangskorb  → ein Erfolg, kein Fehler
 *   · das Netz ist wirklich weg                  → „Netzwerk prüfen" stimmt
 *   · die Kasse hat die Übertragung angehalten   → Warten hilft, Drücken nicht
 *   · ein Fehler in der Kasse selbst             → das Netz ist unschuldig
 *
 * Die Kasse behauptete in allen vier Lagen dieselbe Ursache, die niemand
 * gemessen hat. Im schlimmsten Fall schickt sie den Kassierer zum Router,
 * während der Fehler im Programm sitzt — und im zweitschlimmsten lässt sie ihn
 * einen Vorgang wiederholen, der schon sicher liegt.
 *
 * ⚠️ Diese Datei ist die EINZIGE Stelle, an der diese Sätze stehen dürfen.
 * Ein Wächter (`ehrlicher-fehlersatz.test.ts`) liest den ganzen Baum und wird
 * rot, sobald eine Fläche wieder selbst tippt.
 */
export type Fehlerlage = 'eingereiht' | 'netzWeg' | 'uebertragungPausiert' | 'fehlerInDerKasse';

/**
 * Welche der vier Lagen liegt vor?
 *
 * Nur `instanceof` auf die Klassen, die der api-client wirklich wirft — KEINE
 * Textsuche in der Meldung. Ein Wächter, der `err.message` nach „fetch"
 * durchsucht, hängt an der Wortwahl einer fremden Laufzeitumgebung.
 */
export function fehlerlage(err: unknown): Fehlerlage {
  if (err instanceof ApiOfflineQueuedError) return 'eingereiht';
  if (err instanceof ApiNetworkError) return 'netzWeg';
  if (err instanceof ApiCircuitOpenError) return 'uebertragungPausiert';
  return 'fehlerInDerKasse';
}

/**
 * Der Satz für den `else`-Zweig — also für alles, was KEIN `ApiError` ist.
 *
 * ⚠️ Für einen sicher eingereihten Vorgang gibt diese Funktion mit Absicht
 * keinen brauchbaren Fehlersatz zurück, sondern einen, der den Fehler benennt:
 * `istSicherEingereiht` gehört VOR den Fehlerzweig, weil dort ein Erfolg
 * behandelt werden muss (Fläche schliessen, ruhiger Hinweis) und nicht bloss
 * ein anderer Text. Der Wächter erzwingt genau dieses Paar.
 */
export function ohneApiFehlerSatz(err: unknown): string {
  switch (fehlerlage(err)) {
    case 'eingereiht':
      // Erreichbar nur, wenn eine Fläche `istSicherEingereiht` vergessen hat.
      // Dann sagt der Satz die Wahrheit, statt zum Wiederholen einzuladen.
      return 'Der Vorgang liegt sicher im Ausgangskorb und wird übertragen. Bitte NICHT erneut eintragen.';

    case 'netzWeg':
      return 'Keine Verbindung zum Kassenserver. Bitte Netzwerk prüfen und erneut versuchen.';

    case 'uebertragungPausiert':
      // Der Kassierer soll NICHT drücken: der Schaltkreis ist mit Absicht
      // offen und schliesst sich von allein.
      return 'Die Kasse hat die Übertragung nach mehreren Fehlversuchen angehalten und versucht es gleich von allein wieder. Bitte einen Moment warten.';

    case 'fehlerInDerKasse':
      // Kein Wort über das Netz: hier ist die Kasse selbst gestolpert, und der
      // Vorgang ist nachweislich NICHT hinausgegangen.
      return 'Unerwarteter Fehler in der Kasse. Der Vorgang wurde NICHT gesendet. Bitte erneut versuchen und, wenn es bleibt, den Inhaber verständigen.';
  }
}
