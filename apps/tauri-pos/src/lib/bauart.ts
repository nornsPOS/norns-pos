/**
 * Was diese Kasse WIRKLICH kann — an einer Stelle, nicht verstreut.
 *
 * Norns POS ist der Auslieferungsbau für den Tresen: der Server reist als
 * Kindprozess mit, und das Gerät steht ohne Netz. Derselbe Quelltext trägt
 * aber auch die Warehouse14-Fassung, die an einer fernen Schnittstelle hängt
 * und einen Arbeiterprozess neben sich hat.
 *
 * Wo sich die beiden unterscheiden, muss die Oberfläche es WISSEN, sonst
 * verspricht sie dem Kassierer Dinge, die auf seinem Gerät niemand tut.
 */

/**
 * Dieser Bau ist die Norns-Kasse.
 *
 * Stand bis zum 01.08.2026 als lokale Konstante allein in
 * `screens/secondary/Einstellungen.tsx:43` und war damit nur dort bekannt.
 */
export const NORNS_BAUART = true;

/**
 * Verschickt diese Kasse selbst E-Mail?
 *
 * ⚠️ NEIN, und das ist gemessen, nicht angenommen: `nodemailer` kommt im
 * gebündelten Motor (`src-tauri/resources/sidecar/start.mjs`) NULL mal vor.
 * Der Versender wohnt allein in `apps/worker`, und der Motor dokumentiert
 * selbst, dass der Arbeiter mit Norns nicht mitreist.
 *
 * Der Server meldet nach einem Briefauftrag `mailed: true`. Sein eigener
 * Kommentar sagt, was das heisst: „ob er wirklich EINGEREIHT wurde".
 * Eingereiht, nicht zugestellt. Auf einer Kasse ohne Versender heisst
 * eingereiht: nie.
 *
 * Die Bestellungen-Fläche las dieses `true` und schrieb dem Kassierer
 * „Die Kundschaft wurde per E-Mail benachrichtigt." Der Kassierer verliess
 * sich darauf und rief niemanden an.
 */
export const KASSE_VERSENDET_POST = false;
