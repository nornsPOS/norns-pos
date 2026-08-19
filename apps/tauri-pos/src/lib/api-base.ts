/**
 * api-base — es gibt in Norns POS KEINE feste Anschrift mehr.
 *
 * ── WARUM DIESE DATEI FAST LEER IST (30.07.2026) ────────────────────────────
 *
 * Hier stand:
 *
 *     export const API_BASE_URL = env.VITE_API_BASE_URL ?? 'https://api.warehouse14.de';
 *
 * Und `.env.production` setzte denselben Wert, und `release-build.sh` erzwang
 * ihn zusätzlich und PRÜFTE danach, dass er im ausgelieferten Bündel steht. Im
 * Auslieferungsbau war die Anschrift also garantiert die Wolke.
 *
 * Gelesen wurde sie von genau einer Stelle: der Anmeldung. Jeder andere
 * Bildschirm bekommt seine Anschrift vom Motor im Gerät. Das Ergebnis war eine
 * Kasse, bei der alles lädt und nur das Anmelden nie zustande kommt — der
 * Kassierer tippt morgens auf „Mit Google anmelden", und das Fenster öffnet
 * sich auf einem fremden Rechner im Internet statt auf dem Server zwei
 * Zentimeter weiter im selben Gerät. Ohne Netz kommt niemand an der
 * Anmeldefläche vorbei, und damit ist die ganze Kasse tot.
 *
 * Die Anschrift kommt ab jetzt IMMER aus `useApiClient().baseUrl`, also aus
 * dem, was der Motor beim Start gemeldet hat. Es gibt keinen zweiten Weg mehr,
 * und deshalb steht hier auch keine Konstante mehr, die man versehentlich
 * wieder benutzen könnte.
 */

export {};
