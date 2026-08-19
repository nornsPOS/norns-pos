/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN BELEG OHNE SIGNATUR MUSS IM AUSZUG STEHEN, NICHT FEHLEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ──────────────────────────────────────────────
 *
 * Im Erzeuger der DSFinV-K-Daten stand:
 *
 *     if (r.tse) { … tse.push({ …, tseTaFehler: null }); }
 *
 * Zwei Sätze, ein Loch. Erstens war `tseTaFehler` die EINZIGE Schreibstelle
 * im ganzen Baum und schrieb immer `null`. Zweitens, und schwerer: ein Beleg
 * ohne Signatur bekam wegen des `if` **gar keine Zeile**.
 *
 * Die Wirkung: fällt die TSE aus, verschwinden die betroffenen Belege
 * lautlos aus `transactions_tse.csv`. Der Auszug sieht dann aus wie ein Tag,
 * an dem jeder Beleg sauber signiert wurde. Das ist die gefährlichste Form
 * eines Fehlers in einem Steuerauszug: nicht falsch, sondern **still**.
 *
 * `TSE_TA_FEHLER` ist genau für diesen Fall gebaut. Die mitgelieferte
 * amtliche Beschreibung (`src/fiskal/dsfinvk-2.4/index.xml`, gemessen, nicht
 * erinnert):
 *
 *     <Name>TSE_TA_FEHLER</Name>
 *     <Description>Beschreibung des TSE-Ausfalls oder Fehlers</Description>
 *     <AlphaNumeric /> <MaxLength>200</MaxLength>
 *
 * Ein leeres Feld heisst „kein Ausfall". Eine fehlende Zeile heisst „diesen
 * Vorgang gab es nicht". Beides ist unwahr, sobald die TSE weg war.
 *
 * ── ⚠️ WAS HIER BEWUSST NICHT ENTSCHIEDEN WIRD ────────────────────────────
 *
 * Der Satz in `TSE_AUSFALL_VERMERK` ist eine **Erklärung an die
 * Finanzverwaltung**. Er sagt genau das, was gemessen werden kann, und keine
 * Silbe mehr: es gab keinen Signaturvorgang, der Ausfall ist vermerkt. Er
 * behauptet keine Ursache, kein Verschulden und keine Rechtsfolge.
 *
 * ⚠️ 14.08.2026: Hier stand „Nachholung ausstehend". Gemessen am Baum führt
 * der Motor KEINE rückwirkende Signatur aus — nachgereicht wird nur, was die
 * Sicherungseinrichtung bereits ANGENOMMEN hat (Warteschlange der Kasse).
 * Ein Beleg, der ganz ohne Sicherungseinrichtung entstand, bekommt nie eine.
 * Ein Pflichtauszug darf keine Zukunft versprechen, die kein Code einlöst
 * (Klasse „Dokument verspricht, was der Code nicht tut").
 *
 * Ob darüber hinaus ein eigenes Ausfallregister mit Beginn, Ende, Ursache und
 * Gerät zu führen und aufzubewahren ist, gehört dem Steuerberater vorgelegt,
 * bevor die TSE scharf geht. Diese Datei ist so gebaut, dass er dafür **eine
 * einzige Zeile** ändern muss und nichts sonst.
 */

/**
 * Der Wortlaut, der bei einem Beleg ohne Signatur in `TSE_TA_FEHLER` steht.
 *
 * ⚠️ Nur Gemessenes. Keine Ursache, kein Verschulden, keine Rechtsfolge.
 * Diese eine Zeile ist die Stelle, an der der Steuerberater ansetzt.
 */
export const TSE_AUSFALL_VERMERK =
  'Sicherungseinrichtung zum Buchungszeitpunkt nicht in Betrieb oder nicht erreichbar, ' +
  'kein Signaturvorgang. Ausfall im Kassenabschluss vermerkt.';

/** Die amtliche Feldlänge aus `index.xml`, hier als Zahl festgehalten. */
export const TSE_AUSFALL_MAXLAENGE = 200;

/**
 * Der Vermerk, auf die amtliche Länge gebracht.
 *
 * ⚠️ Gezählt wird in ZEICHEN, nicht in UTF-16-Einheiten: `[...text]` statt
 * `text.length`. Sonst zerschneidet ein Kürzen ein Zeichen in der Mitte und
 * die Datei trägt ein halbes Zeichen — dieselbe Klasse wie bei DATEV.
 *
 * Gekürzt wird an der letzten Wortgrenze, damit kein Wort halb dasteht.
 */
export function ausfallVermerk(text: string = TSE_AUSFALL_VERMERK): string {
  const zeichen = [...text];
  if (zeichen.length <= TSE_AUSFALL_MAXLAENGE) return text;
  const roh = zeichen.slice(0, TSE_AUSFALL_MAXLAENGE).join('');
  const letzteLuecke = roh.lastIndexOf(' ');
  return letzteLuecke > 0 ? roh.slice(0, letzteLuecke) : roh;
}
