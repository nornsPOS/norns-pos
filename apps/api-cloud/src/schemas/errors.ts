/**
 * ════════════════════════════════════════════════════════════════════════
 *  Die EINE Gestalt einer Fehlerantwort
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 11.08.2026 ───────────────────────────────────────────
 *
 * 74 Routendateien erklaerten sich ihr eigenes `ErrorResponse` mit vier
 * Feldern (code, message, details?, requestId), zusammen 465 Statuszeilen.
 * Keines davon kannte `stelle`. `fast-json-stringify` streift jedes nicht
 * deklarierte Feld ab, lautlos — die Stellenkennung erreichte damit auf 63
 * von 96 Routendateien den Bildschirm nie, darunter JEDE fiskale Route
 * (Tagesabschluss, Storno, DATEV, DSFinV-K, Schichten, Ankauf). Der
 * Haendler rief an und konnte nur „es kam ein Konflikt" sagen; davon gibt
 * es fuenfzig.
 *
 * ── WAS SEITHER GILT ────────────────────────────────────────────────────
 *
 * Der Fehlerkoerper wird zentral in `plugins/error-handler.ts` gebaut und
 * dort auch zentral als fertiger JSON-Rumpf ausgeliefert, also am
 * Schema-Serialisierer VORBEI. Ein knappes Routenschema kann seither nichts
 * mehr abschneiden. Diese Datei ist deshalb kein Riegel, sondern die
 * ehrliche BESCHREIBUNG: wer eine Fehlerantwort deklariert (fuer die
 * Schnittstellenbeschreibung, fuer den erzeugten Klienten), soll die
 * Gestalt beschreiben, die wirklich am Draht ankommt.
 *
 * ⚠️ NICHT als Pflicht fuer alle 74 Dateien gedacht: eine Umschreibung von
 * 74 Dateien waere ein grosser Zug ohne Gewinn, und die 75. Datei brachte
 * das Loch ohnehin zurueck. Der Riegel liegt im Behandler; hier steht die
 * Wahrheit fuer neue Routen.
 */

import { type Static, Type } from '@sinclair/typebox';

/**
 * Die Fehlerantwort, wie `plugins/error-handler.ts` sie WIRKLICH sendet.
 *
 * `details` ist bewusst `Type.Unknown()`: es traegt je nach Fehlerklasse
 * eine Feldliste der Pruefung, eine Sperrfrist (`lockedUntil`) oder eine
 * Belegnummer. Eine engere Angabe waere eine Behauptung, die der Behandler
 * nicht einloest.
 */
export const FehlerAntwort = Type.Object({
  error: Type.Object({
    /** Die ART des Fehlers. 194 Fehlerklassen fallen auf 20 dieser Codes. */
    code: Type.String(),
    /** Der Satz fuer den Menschen. */
    message: Type.String(),
    /** Strukturierte Angaben, wenn die Fehlerklasse welche traegt. */
    details: Type.Optional(Type.Unknown()),
    /** Der Vorgang — dieselbe Kennung wie im Kopf `x-request-id`. */
    requestId: Type.String(),
    /**
     * WO es passiert ist, z. B. `NORNS-INVENTUR-SITZUNG-OFFEN`. Fehlt nur,
     * wenn der Fehler gar keine Domaenenklasse war (etwa ein von Fastify
     * selbst erhobener Formfehler).
     */
    stelle: Type.Optional(Type.String()),
  }),
});

export type TFehlerAntwort = Static<typeof FehlerAntwort>;
