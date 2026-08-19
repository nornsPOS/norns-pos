/**
 * Der Handgriff: nach dem Kassenschluss einmal sichern.
 *
 * Die REGEL steht in `sicherung-nach-abschluss.ts` und ist dort geprüft;
 * hier steht nur der Griff zum Rumpf. Getrennt, weil sich ein Tauri-Aufruf
 * nicht sinnvoll testen lässt, eine Regel aber sehr wohl — und weil man
 * genau dann aufhört zu testen, wenn beides in einer Datei liegt.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';

import { entscheide, gelungenSatz, gescheitertSatz, heute } from './sicherung-nach-abschluss.js';
import { zielLesen, zuletztLesen, zuletztSchreiben } from './sicherungsziel-store.js';

/** Was der Rumpf nach einer gelungenen Sicherung meldet. */
interface Bericht {
  datei: string;
  tabellen: number;
  zeilen: number;
  sequenzen: number;
}

/**
 * Nur die zwei Tonlagen, die dieser Weg wirklich braucht.
 *
 * ⚠️ Kein `error`: eine ausgefallene Sicherung ist eine Warnung, kein
 * Fehler. Der Kassenschluss steht; rot zu melden hiesse, den Kassierer
 * einen fiskalischen Schaden vermuten zu lassen, den es nicht gibt.
 */
type Meldung = (t: { tone: 'success' | 'alert'; title: string; body: string }) => void;

/**
 * ⚠️ Wirft NIE. Der Aufrufer steht mitten im Kassenschluss.
 */
export async function sichereNachAbschluss(melde: Meldung): Promise<void> {
  const heutigerTag = heute();
  const urteil = entscheide({
    zielordner: zielLesen(),
    zuletztAm: zuletztLesen(),
    heute: heutigerTag,
  });
  // Nichts zu tun ist kein Ereignis: ein Kassierer, der jeden Abend liest
  // „heute schon gesichert", liest bald gar nichts mehr.
  if (!urteil.sichern) return;

  /*
   * ── OHNE KASSENKERN GIBT ES KEINE SICHERUNG, UND DAS WIRD GESAGT ────────
   *
   * Gefunden in der 0.6.0-Begehung (14.08.2026): im Browser-Durchlauf ohne
   * Tauri brach der `invoke`-Aufruf selbst, und sein ENGLISCHER TypeError
   * („Cannot read properties of undefined") reiste wörtlich in den
   * deutschen Händler-Toast. `grundLesen` unten reicht Zeichenketten durch,
   * weil der Rumpf seine Gründe auf Deutsch ablehnt — ein Bruch VOR der
   * Brücke hält diesen Vertrag nicht.
   *
   * Still übersprungen wird trotzdem nicht: eine Sicherung, die fällig ist
   * und nicht laufen kann, ist die Klasse „Prüfung besteht still ohne ihr
   * Werkzeug". Der Satz bleibt ehrlich und deutsch.
   */
  if (!isTauri()) {
    melde({
      tone: 'alert',
      title: 'Sicherung ausgefallen',
      body: gescheitertSatz(
        'Diese Ansicht läuft ohne den Kassenkern (Browser). Die Sicherung läuft nur im Kassenprogramm.',
      ),
    });
    return;
  }

  try {
    const bericht = (await invoke('sicherung_jetzt', {
      zielordner: urteil.zielordner,
    })) as Bericht;
    // ⚠️ Der Tag wird ERST hier vermerkt. Wer ihn vorher setzt, sperrt sich
    // nach dem ersten Fehlschlag für den Rest des Tages selbst aus.
    zuletztSchreiben(heutigerTag);
    melde({
      tone: 'success',
      title: 'Sicherung angelegt',
      body: gelungenSatz(bericht.datei, bericht.zeilen),
    });
  } catch (fehler) {
    melde({
      tone: 'alert',
      title: 'Sicherung ausgefallen',
      body: gescheitertSatz(grundLesen(fehler)),
    });
  }
}

/**
 * Den Grund einer Ablehnung des Rumpfes in einen Satz holen.
 *
 * ⚠️ NIEMALS `String(fehler)`. Der Rumpf lehnt nicht immer mit einer
 * Zeichenkette ab: bricht der Aufruf selbst (Befehl fehlt, IPC gestört), ist
 * es ein Objekt, und `String({…})` ergibt „[object Object]" — der Händler
 * läse das wörtlich. Ein Wächter im Baum hält diese Regel fest
 * (`keine-rohe-ablehnung.test.ts`), und er hat genau das hier gefunden.
 *
 * `sicherung_jetzt` liefert seine Gründe schon auf Deutsch, deshalb reisen
 * sie unverändert weiter; alles Unbekannte fällt auf einen ehrlichen Satz
 * statt auf eine Zeichenfolge, die niemand lesen kann.
 */
function grundLesen(fehler: unknown): string {
  if (typeof fehler === 'string' && fehler.trim() !== '') return fehler;
  if (fehler instanceof Error && fehler.message.trim() !== '') {
    /*
     * Ein `Error`-OBJEKT heisst: nicht der Rumpf hat abgelehnt, sondern der
     * AUFRUF selbst ist gebrochen (Brücke gestört, Befehl nichtregistriert).
     * Seine Meldung ist Laufzeit-Englisch für Entwickler, kein Satz für die
     * Theke — sie geht ins Protokoll, der Händler bekommt Deutsch.
     * (0.6.0-Begehung: „Cannot read properties of undefined" stand im Toast.)
     */
    console.warn('[sicherung] Der Brücken-Aufruf selbst brach:', fehler);
    return 'Die Brücke zum Kassenkern hat den Aufruf nicht angenommen.';
  }
  return 'Der Grund liess sich nicht ermitteln.';
}
