/**
 * Das Kürzel dieser Kasse, an genau einer Stelle.
 *
 * Nicht zu verwechseln mit zwei Nachbarn:
 *   • `api-cloud/src/lib/erzeugnis.ts` nennt das Erzeugnis gegenüber dem
 *     FINANZAMT (`KASSE_BRAND` in der DSFinV-K-Ausfuhr).
 *   • Der Ladenname gehört dem Händler und wird nie erfunden.
 *
 * Hier geht es um das kurze Kürzel, das in technischen Kennungen auftaucht,
 * die ein Mensch trotzdem zu sehen bekommt: Support-Codes, Vorschläge für
 * Druckerwarteschlangen, das Schema auf dem Etiketten-QR.
 *
 * ⚠️ 01.08.2026 gemessen: an sieben Stellen stand `W14`. Der Kassierer las am
 * Kopf der Kasse „Support-Ref: W14-NET-OFFLINE", der Etikettendrucker legte
 * Warteschlangen namens „W14-Zebra-ZD421" im Betriebssystem an, und der
 * Etiketten-QR trug `w14://`. Alles Marken einer fremden Firma.
 */

/** Das Kürzel. Drei Buchstaben, damit es in enge Kennungen passt. */
export const MARKE_KUERZEL = 'NRN';

/**
 * Das eigene Schema auf dem Etiketten-QR, das diese Kasse ab jetzt DRUCKT.
 *
 * Der Leser (`scan-resolve.ts`) nimmt weiterhin auch das alte `w14://` an,
 * und zwar dauerhaft: bereits geklebte Etiketten scannt sonst niemand mehr.
 * Ein Schemawechsel ohne Rücksicht auf gedruckte Etiketten macht am Tag der
 * Auslieferung jedes Regal unlesbar.
 */
export const ETIKETT_SCHEMA = 'norns://';

/**
 * ── Was hier ABSICHTLICH NICHT steht ────────────────────────────────────────
 *
 * Fünf Speicherorte und sechs Einstellungsschlüssel tragen weiterhin den
 * alten Namen:
 *
 *   `sqlite:warehouse14.db`              (Ausgangskorb, TSE-Schlange, KYC,
 *                                         Kassenabsichten, Lesezwischenlager)
 *   `warehouse14.hardware-config.v1`     Gerätekonfiguration
 *   `warehouse14.integrations.v1`        Kanaleinstellungen (der Leser wurde
 *                                         am 14.08.2026 mit der Trennung
 *                                         entfernt; der Schluessel kann auf
 *                                         Geraeten liegen und wird von der
 *                                         spaeteren Wanderung geraeumt)
 *   `warehouse14.beleg-logo.v1`          das Logo des Händlers
 *   `warehouse14.camera.deviceId`        die gewählte Kamera
 *   `warehouse14.theme`                  Alt-Schlüssel der Darstellung
 *
 * Diese Namen bleiben, und das ist kein Vergessen. Ein Speicherschlüssel ist
 * kein Text, sondern eine ADRESSE. Wer ihn umbenennt, zeigt auf ein leeres
 * Fach: die Kasse startet, findet nichts, und verhält sich wie frisch
 * ausgepackt. Das Logo des Händlers wäre weg, die Gerätekonfiguration wäre
 * weg, und im Ausgangskorb lägen unversandte fiskale Vorgänge, die niemand
 * mehr findet.
 *
 * Kein Mensch bekommt diese Zeichenketten je zu sehen. Sie umzubenennen
 * kostet eine Wanderung, die alte Fächer ausliest und in neue umschreibt,
 * plus den Beweis, dass sie auf einer BESTÜCKTEN Kasse funktioniert. Das ist
 * eine eigene Aufgabe und keine Nebensache in einem Umbenenn-Durchgang.
 */
