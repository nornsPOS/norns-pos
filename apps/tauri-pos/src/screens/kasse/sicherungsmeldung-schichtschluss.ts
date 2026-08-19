/**
 * Die Sicherungsmeldung nach dem SCHICHTSCHLUSS — der Satz, der nicht stimmte.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER NACHGEMESSENE BEFUND VOM 13.08.2026
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ZBonDialog.tsx` ruft nach `shiftsApi.close` — also nach dem SCHICHTSCHLUSS
 * — die Sicherung an (`lib/sichere-nach-abschluss.ts:35`). Scheitert sie, meldet
 * sie mit dem Satz aus `lib/sicherung-nach-abschluss.ts:78`:
 *
 *     „Der Tagesabschluss ist gebucht. Nur die automatische Sicherung danach
 *      hat nicht geklappt: … Sie lässt sich unter Einstellungen jederzeit von
 *      Hand nachholen."
 *
 * Der erste Satz ist an dieser Stelle falsch. Gebucht wurde der Schichtschluss;
 * der Tagesabschluss (`closingsApi.finalize`) hat noch gar nicht stattgefunden.
 * Wer das liest, geht nach Hause — und für den Tag entsteht keine Zeile in
 * `daily_closings`, also kein Kassenbericht, kein DATEV, kein DSFinV-K
 * (§ 146 Abs. 1 Satz 2 AO). Es ist dieselbe Lüge wie vorher, nur ausgelöst aus
 * einer anderen Datei.
 *
 * ── WARUM DER SATZ HIER UMGESCHRIEBEN UND NICHT DORT GEÄNDERT WIRD ─────────
 *
 * Der Satz in `lib/` gehört einem anderen Arbeitspaket, und er ist dort nicht
 * grundsätzlich falsch: nach einem echten Tagesabschluss stimmt er wörtlich.
 * Falsch ist er nur für den Aufrufer, der bloss eine Schicht geschlossen hat.
 * Also richtet ihn genau dieser Aufrufer — und zwar so, dass der GRUND der
 * Ablehnung erhalten bleibt. Ohne ihn stünde der Händler vor „hat nicht
 * geklappt" und wüsste nicht, ob ein Ordner fehlt oder die Platte voll ist.
 *
 * ── WARUM DIE FORM AUS DER ECHTEN FUNKTION GELESEN WIRD ────────────────────
 *
 * ⚠️ Der Wortlaut steht hier NICHT noch einmal abgeschrieben. Eine zweite
 * Abschrift wäre die Hausklasse „der Prüfstand macht denselben Fehler": sie
 * würde nach einer Umformulierung in `lib/` still nicht mehr greifen, und der
 * alte Satz stünde wieder auf dem Schirm. Stattdessen wird die Schablone einmal
 * von `gescheitertSatz` selbst erzeugt und daraus abgeleitet, wo der Grund
 * steht. Passt die Form nicht mehr, fällt dieses Stück auf einen Satz zurück,
 * der zwar den Grund verliert, aber NIE etwas Falsches behauptet — und der
 * Wächter `sicherungsmeldung-luegt-nicht.test.ts` wird rot.
 */

import { gescheitertSatz } from '../../lib/sicherung-nach-abschluss.js';

/** Eine Meldung, wie `sichereNachAbschluss` sie an den Aufrufer gibt. */
export interface Sicherungsmeldung {
  tone: 'success' | 'alert';
  title: string;
  body: string;
}

/**
 * Die Schablone: `gescheitertSatz` einmal mit einer Marke füttern und sehen,
 * was vor und hinter dem Grund steht. Kein abgeschriebener Wortlaut.
 */
const MARKE = 'HIER-STEHT-DER-GRUND';
const [VORNE = '', HINTEN = ''] = gescheitertSatz(MARKE).split(MARKE);

/**
 * Den Grund aus einem Sicherungssatz herauslösen — oder `null`, wenn der Satz
 * nicht (mehr) die Form hat, die `gescheitertSatz` erzeugt.
 */
export function grundAusSicherungssatz(satz: string): string | null {
  if (VORNE === '' || !satz.startsWith(VORNE) || !satz.endsWith(HINTEN)) return null;
  const grund = satz.slice(VORNE.length, satz.length - HINTEN.length).trim();
  return grund === '' ? null : grund;
}

/**
 * Derselbe Sachverhalt, ehrlich für den Schichtschluss erzählt.
 *
 * Enthält der Satz keine falsche Zusage über den Tagesabschluss, bleibt er
 * unangetastet: dieses Stück soll fremde Meldungen nicht umschreiben.
 */
export function sicherungssatzNachSchichtschluss(satz: string): string {
  const kopf = 'Die Schicht ist abgeschlossen; der Tagesabschluss steht noch aus. ';
  const fuss = 'Sie lässt sich in den Einstellungen jederzeit von Hand nachholen.';
  const grund = grundAusSicherungssatz(satz);
  if (grund !== null) {
    return `${kopf}Nur die automatische Sicherung danach hat nicht geklappt: ${grund} ${fuss}`;
  }
  if (!satz.includes('Tagesabschluss')) return satz;
  return `${kopf}Nur die automatische Sicherung danach hat nicht geklappt. ${fuss}`;
}

/**
 * Was der Schichtschluss der Kassiererin wirklich zeigen darf.
 *
 * Nur der Alarm wird angefasst. Die Erfolgsmeldung nennt den Ablageort der
 * Sicherung und behauptet nichts über den Kassentag.
 */
export function meldungNachSchichtschluss(meldung: Sicherungsmeldung): Sicherungsmeldung {
  if (meldung.tone !== 'alert') return meldung;
  return { ...meldung, body: sicherungssatzNachSchichtschluss(meldung.body) };
}
