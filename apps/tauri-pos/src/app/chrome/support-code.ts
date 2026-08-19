/**
 * Der Support-Code dieser Kasse.
 *
 * Steht in einer eigenen Datei, weil ihn zwei Stellen brauchten: der Knopf im
 * Kopfbereich und das Fenster des Sprachassistenten. Seit dem 01.08.2026 gibt
 * es nur noch den Knopf — der Assistent ist ausgezogen, begründet in
 * `SupportButton.tsx`.
 *
 * Die Datei bleibt trotzdem eigenständig. Der Code ist eine Aussage der Kasse
 * über sich selbst und gehört nicht in einen Knopf; wer ihn morgen auch auf
 * einer Fehlerseite braucht, soll dafür nicht den Kopfbereich einlesen müssen.
 */

import { MARKE_KUERZEL } from '../../lib/marke.js';

/**
 * ⚠️ 01.08.2026: hier stand `W14-963` — das Kürzel einer fremden Firma und
 * die Hausnummer eines fremden Labors. Der Satz eine Zeile tiefer sagte
 * bereits „Norns Kasse"; der Code darin widersprach ihm.
 */
export const SUPPORT_CODE = `${MARKE_KUERZEL}-POS`;

/** Der Satz, der in die Zwischenablage geht — mit dem Code darin. */
export function supportZeile(): string {
  return `Norns Kasse · Support-Code: ${SUPPORT_CODE}`;
}
