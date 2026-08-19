/**
 * Bedienziele — die gemeinsamen Touch-Masse der Kasse.
 *
 * ── WARUM ES DIESE DATEI GIBT (26.07.2026) ──────────────────────────────────
 * Basels Dekret zum letzten Schreibtisch-Update: das kommende Kassengerät ist
 * ein Touchbildschirm. Gemessen war: der Zahlart-Wähler im Bezahldialog war
 * 24 Punkte hoch (die wichtigste Entscheidung des Bezahlens als kleinstes
 * Ziel), die Kopfleiste 56 Punkte mit sechs 36er-Knöpfen. Die Grössen waren
 * in FÜNF Dateien einzeln hartkodiert — wer eine anhob, vergass die anderen.
 *
 * Hier stehen sie einmal; der Wächter `bedienziele.test.ts` prüft die Werte
 * UND dass die fünf Flächen wirklich von hier schöpfen.
 */

/** Höhe der Kopfleiste. 56 liess 44er-Knöpfen nur 6 Punkte Luft je Seite. */
export const KOPFLEISTE_HOEHE = 64;

/**
 * Kantenmass der Kopfleisten-Knöpfe (Darstellung, Statuspunkt, Alle Flächen,
 * Einstellungen, Update, Support). WCAG 2.5.5-Untergrenze für Touchziele.
 */
export const KOPF_ZIEL = 44;

/** Mindesthöhe des Zahlart-Wählers (Barzahlung/Kartenzahlung) im Bezahldialog. */
export const ZAHLART_ZIEL = 44;

/**
 * Mindesthöhe der Bedienelemente in der Leser-Verwaltung (Kartenleser Stripe):
 * das Registrierungscode-Feld und jeder Entfernen-Knopf. Dieselbe
 * WCAG-Untergrenze wie oben — die Einrichtung geschieht am selben Touchgerät.
 */
export const LESER_ZIEL = 44;
