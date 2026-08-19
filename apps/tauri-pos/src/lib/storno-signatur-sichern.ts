/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN STORNO IST DER VORGANG, DEN EIN PRÜFER ZUERST ANSIEHT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND ─────────────────────────────────────────────────────────────
 *
 * In `StornoDialog.tsx` stand nach dem erfolgreichen FINISH:
 *
 *     } catch {
 *       // Der Storno steht. Die Signatur holt die Warteschlange nach.
 *     }
 *
 * und `grep -c "enqueueSignatureRecordOnly"` ergab 0. Der Kommentar behauptete
 * also genau das Gegenteil dessen, was der Code tat: es gab keine
 * Warteschlange, die hier etwas nachholt. Verkauf (`BezahlenDialog.tsx:997`)
 * und Ankauf (`AnkaufBezahlenDialog.tsx:446`) rufen an derselben Stelle
 * `enqueueSignatureRecordOnly` UND melden dem Kassierer, ob die Sicherung
 * geklappt hat. Der Storno tat beides nicht.
 *
 * Der FINISH war erfolgreich, die Signatur lag also im Fenster — und
 * verschwand beim nächsten Klick, sobald der Server die Aufzeichnung ablehnte.
 * Keine Zeile in `tse_signature_queue`, kein Zähler im Gerätemanager, kein
 * Wort an den Menschen.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ─────────────────────────────────
 *
 * Der naheliegende Weg wäre, den Satz aus dem Verkauf wörtlich zu übernehmen:
 * „Bitte den gedruckten Beleg aufbewahren." Dieser Dialog DRUCKT ABER NICHTS
 * (kein einziger Druckaufruf in der Datei). Der Satz wäre eine Lüge, und der
 * Kassierer suchte ein Papier, das es nie gab. Deshalb steht der Wortlaut hier
 * und nicht in `ohne-signatur-hinweis.ts`: er muss den Storno beschreiben.
 *
 * Was in diesem Fall wirklich noch existiert, ist der Vorgang IN der
 * zertifizierten Sicherungseinrichtung selbst — der FINISH ist gelungen,
 * Signaturzähler und Vorgangsnummer stehen in ihrem eigenen, manipulations-
 * sicheren Protokoll. Verloren geht die SERVERSEITIGE Spiegelung. Genau das
 * sagt der Satz, und er nennt den Handgriff dazu.
 *
 * ── WAS HIER RECHNET UND WAS NICHT ────────────────────────────────────────
 *
 * Rein: keine Uhr, kein Netz, keine Ablage, kein React. Die zwei Nahtstellen
 * werden hereingereicht, damit die Entscheidung fahrbar ist, ohne einen
 * Bildschirm zu bauen. Sie wirft NIE: der Storno ist zu diesem Zeitpunkt
 * gebucht, und ein Fehler beim Sichern darf ihn nicht umwerfen.
 */

/** Wie die Sicherung der Storno-Signatur ausgegangen ist. */
export type StornoSignaturAusgang =
  /** Der Server hat die Signatur angenommen. Nichts weiter zu tun. */
  | { art: 'aufgezeichnet' }
  /** Server abgelehnt, aber die Zeile liegt dauerhaft im Korb und wird nachgereicht. */
  | { art: 'eingereiht'; fehler: unknown }
  /** Server abgelehnt UND das Einreihen scheiterte: nur noch im TSE-Protokoll. */
  | { art: 'nur_auf_papier'; fehler: unknown };

export interface StornoSignaturNahtstellen {
  /** Die Aufzeichnung auf dem Server. Wirft bei jedem Nicht-2xx. */
  aufzeichnen: () => Promise<void>;
  /**
   * Der dauerhafte Korb (`enqueueSignatureRecordOnly`). `false` heisst: auch
   * die örtliche Ablage hat den Schreibvorgang verweigert.
   */
  einreihen: (fehler: unknown) => Promise<boolean>;
}

/**
 * Aufzeichnen, und wenn das misslingt, die fertige Signatur dauerhaft
 * einreihen. Der Rückgabewert sagt, was der Mensch erfahren muss.
 */
export async function stornoSignaturSichern(
  nahtstellen: StornoSignaturNahtstellen,
): Promise<StornoSignaturAusgang> {
  try {
    await nahtstellen.aufzeichnen();
    return { art: 'aufgezeichnet' };
  } catch (fehler) {
    let eingereiht = false;
    try {
      eingereiht = await nahtstellen.einreihen(fehler);
    } catch {
      // Auch der Korb hat verweigert. Das ist der ehrliche Fall unten, kein
      // Grund, den gebuchten Storno mit einem Wurf umzuwerfen.
      eingereiht = false;
    }
    return eingereiht ? { art: 'eingereiht', fehler } : { art: 'nur_auf_papier', fehler };
  }
}

export interface StornoSignaturHinweis {
  title: string;
  body: string;
}

/**
 * Der Satz für den Kassierer. `null` heisst: es gibt nichts zu sagen, die
 * Signatur liegt beim Server.
 *
 * ⚠️ Beide Fälle sagen ausdrücklich, dass der Storno GEBUCHT ist. Ein Hinweis,
 * der nur von der Signatur spricht, liest sich am Tresen wie „der Storno hat
 * nicht geklappt" — und die Kassiererin drückt dann erneut, was den zweiten
 * Versuch gegen den Riegel „höchstens ein Storno je Beleg" laufen lässt.
 */
export function stornoSignaturHinweis(
  ausgang: StornoSignaturAusgang,
): StornoSignaturHinweis | null {
  if (ausgang.art === 'aufgezeichnet') return null;
  if (ausgang.art === 'eingereiht') {
    return {
      title: 'TSE-Signatur nicht gespeichert',
      body: 'Storno gebucht. Die Signatur wird nachgereicht, sobald der Server wieder antwortet.',
    };
  }
  return {
    title: 'TSE-Signatur nicht gesichert',
    body:
      'Storno gebucht und von der Sicherungseinrichtung signiert, aber die Signatur ' +
      'konnte weder gespeichert noch für später vorgemerkt werden. Bitte die ' +
      'Belegnummer notieren und den Inhaber verständigen.',
  };
}
