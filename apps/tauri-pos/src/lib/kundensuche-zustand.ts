/**
 * kundensuche-zustand — die EINE Entscheidung, was die Kundensuche gerade
 * anzeigen darf.
 *
 * DER FUND, der dieses Modul erzwungen hat:
 * Alle drei Suchmasken der Kasse (Ankauf, Verkauf, Bewertung) haben früher nur
 * gefragt „ist die Trefferliste leer und wird gerade nicht geladen?" und daraus
 * „Kein Treffer" gefolgert. Bei einem Serverfehler ist die Trefferliste
 * ebenfalls leer und es wird ebenfalls nicht mehr geladen. Die Kasse hat also
 * einen Netzfehler als gesicherte Auskunft ausgegeben: „diese Person kennen wir
 * nicht" — und im Ankauf und im Verkauf gleich daneben zum Anlegen eingeladen.
 *
 * WAS DAS AM TRESEN BEDEUTET: Ein gesperrter Verkäufer bringt Altgold, das Netz
 * zuckt, die Kasse sagt „Kein Treffer" und bietet „+ Als neuen Kunden anlegen"
 * an. Wird das angenommen, entsteht eine zweite, blanke Kundenakte: ohne
 * Sperrvermerk, ohne Sanktionstreffer, ohne PEP-Fahne, ohne KYC-Datum. Die
 * Suche fragt ausdrücklich mit `excludeBlocked: false` ab, DAMIT genau diese
 * Warnung erscheint — bei Serverfehler fiel sie lautlos aus.
 *
 * „Kein Treffer" ist eine Aussage über die Kundendatei. „Der Server schweigt"
 * ist eine Aussage über das Netz. Nur die erste darf zum Anlegen führen.
 *
 * Rein: kein React, kein Netz, kein Zeitgeber. Damit ist die Regel prüfbar,
 * und alle drei Masken teilen sie sich, statt sie je einzeln zu verlieren.
 */

export type KundensucheZustand =
  /** Es wurde noch keine Suche gestellt (leeres Feld). */
  | 'tippen'
  /** Eine Anfrage läuft und es liegt noch nichts Anzeigbares vor. */
  | 'sucht'
  /** Die Suche hat geantwortet: Fehler. Über die Kundendatei wissen wir NICHTS. */
  | 'nicht_erreichbar'
  /** Die Suche hat geantwortet: es gibt diese Person wirklich nicht. */
  | 'leer'
  /** Es gibt etwas anzuzeigen. */
  | 'treffer';

export interface KundensucheEingabe {
  /** Der Suchtext, mit dem tatsächlich abgefragt wurde (entprellt). */
  suchtext: string;
  /** Eine Anfrage ist gerade unterwegs. */
  isFetching: boolean;
  /** Die letzte Anfrage ist fehlgeschlagen. */
  isError: boolean;
  /** Anzahl der Zeilen, die angezeigt werden könnten. */
  trefferzahl: number;
}

/**
 * Leitet aus dem Zustand der Abfrage ab, was die Maske zeigen darf.
 *
 * Die Reihenfolge der Prüfungen IST die Sicherheitsregel:
 *
 *  1. Leerer Suchtext gewinnt zuerst — es wurde gar nichts gefragt, also gibt
 *     es auch nichts zu behaupten.
 *  2. Ein Fehler gewinnt vor allem Übrigen, ausdrücklich auch vor „leer" und
 *     ausdrücklich auch vor einer noch laufenden Wiederholung. Solange eine
 *     Wiederholung unterwegs ist, bliebe die Maske sonst kurz auf „sucht"
 *     stehen und der Anlegen-Knopf würde für diesen Moment wieder scharf. Genau
 *     dieser Moment ist der gefährliche. Dass eine Wiederholung läuft, zeigt
 *     die Maske daneben am Wort „sucht…" im Suchfeld, nicht durch Freigabe des
 *     Anlegens.
 *  3. Vorhandene Zeilen gewinnen vor „sucht", damit die Liste beim Nachladen
 *     nicht flackert.
 */
export function kundensucheZustand(eingabe: KundensucheEingabe): KundensucheZustand {
  if (eingabe.suchtext.trim().length === 0) return 'tippen';
  if (eingabe.isError) return 'nicht_erreichbar';
  if (eingabe.trefferzahl > 0) return 'treffer';
  if (eingabe.isFetching) return 'sucht';
  return 'leer';
}

/**
 * Darf in diesem Zustand ein neuer Kunde angelegt werden?
 *
 * Nein, sobald die Suche nicht geantwortet hat: ein Doppel anzulegen ist hier
 * nicht bloss unordentlich, es umgeht Sperre, Sanktionstreffer und PEP-Fahne
 * der bereits vorhandenen Akte.
 */
export function anlegenErlaubt(zustand: KundensucheZustand): boolean {
  return zustand !== 'nicht_erreichbar';
}
