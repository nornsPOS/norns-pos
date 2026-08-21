/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VON DEN ZEILEN DES HAUSES ZU DEN ZEILEN DER NORM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `dsfinvk-dateien.ts` sagt, welche Spalte woher kommt. Diese Datei bringt
 * die Werte: sie nimmt, was die Route aus der Datenbank geholt hat, und formt
 * daraus die Zeilen der zwanzig Tabellen.
 *
 * ⚠️ Sie RECHNET nicht. Jeder Betrag steht so, wie er in der Aufzeichnung
 * steht. Wo eine Summe gebraucht wird, ist sie die Summe gespeicherter Werte,
 * nie eine Neuberechnung — sonst könnte das Prüferpaket etwas anderes sagen
 * als der Beleg, den der Kunde in der Hand hielt.
 */

import type {
  AbschlussZeile,
  BelegZeile,
  Daten,
  GeschaeftsvorfallZeile,
  KassenladeZeile,
  PositionsZeile,
  PreisfindungZeile,
  ReferenzZeile,
  TseZeile,
  UstZeile,
  ZahlZeile,
  ZahlartSummeZeile,
} from './dsfinvk-dateien.js';
import type {
  DsfinvkBundleInput,
  DsfinvkReceiptInput,
} from './dsfinvk-export.js';
import { ZNummerFehltError } from './dsfinvk-export.js';
import { bruttoBruch, satzAm } from '@norns/domain';
import {
  UST_STAMM_FEST,
  bonTypFuer,
  gvTypFuer,
  ustSchluesselFuer,
  zahlartTypFuer,
} from './dsfinvk-schluessel.js';
import type { StammdatenBefund } from './haendler-stammdaten.js';
import { ERZEUGNIS_SOFTWARE_MARKE } from './erzeugnis.js';
import { ausfallVermerk } from './tse-ausfall.js';

/** Was ein Mensch beigesteuert hat und kein Code herleiten kann. */
export interface MenschlicheAngaben {
  /** Die Stammdaten des Steuerpflichtigen (Wanderung 0126). */
  stammdaten: StammdatenBefund;
  /** Die vom Steuerberater vergebenen Umsatzsteuerschlüssel. */
  eigeneUstSchluessel: Readonly<Record<string, string>>;
  /**
   * Der Geschäftsvorfalltyp für den Ankauf von Privat, aus den Einstellungen.
   *
   * ⚠️ Steht hier bei den MENSCHLICHEN Angaben und nicht im Quelltext, weil es
   * eine steuerliche Auslegung ist. Aus Anhang C käme „Auszahlung" in
   * Betracht, weil Geld die Kasse verlässt — aber das zu entscheiden ist Sache
   * des Steuerberaters, nicht der Kasse.
   *
   * Leer heisst: der Export bricht beim ersten Ankaufbeleg mit 409 ab. Für
   * einen Edelmetallhändler ist das fast jeder Tag; deshalb nennt die Meldung
   * jetzt auch, WO die Antwort einzutragen ist.
   *
   * ⚠️ PFLICHTFELD, und das mit Absicht. Als `?`-Feld liess sich die
   * Durchreichung in `closing-export.ts` ersatzlos löschen, OHNE dass die
   * Typprüfung etwas sagte — gemessen. Der Export wäre dann wieder für jeden
   * Ankaufstag gesperrt gewesen, und niemand hätte es bemerkt, bis ein Händler
   * anruft. `null` muss man hinschreiben; vergessen kann man es nicht.
   */
  gvTypAnkauf: string | null;
  /**
   * Der Prozentsatz je eigenem Schlüssel, ebenfalls vom Berater.
   *
   * ⚠️ KEIN Vorgabewert. Ein fest eingetragenes `0.00` liess `vat.csv` dem
   * `lines_vat.csv` daneben widersprechen: dort standen 3,19 EUR Steuer unter
   * einem Schlüssel, den `vat.csv` mit null Prozent auswies.
   */
  eigeneUstSaetze?: Readonly<Record<string, string>>;
  /** Die Klartextbeschreibung je eigenem Schlüssel. */
  eigeneUstBeschreibungen?: Readonly<Record<string, string>>;
  /**
   * Die Stammdaten je Sicherheitseinrichtung, geschlüsselt nach ihrer
   * fiskaly-Kennung.
   *
   * ⚠️ Seriennummer und öffentlicher Schlüssel haben seit dem 12.08.2026 einen
   * ZWEITEN, besseren Weg: die Sicherungseinrichtung legt beide jeder Signatur
   * selbst bei, und ein so GEMESSENER Wert geht dem hier eingetragenen vor.
   *
   * ⛔ Nur läuft dieser bessere Weg heute nirgends. Am 13.08.2026 über den
   * (⚠️ VERALTET seit 19.08.2026, stehen gelassen als Zeitzeuge und unten
   * berichtigt: HEUTE fuellen beide Kassenwege die Felder — BezahlenDialog
   * und AnkaufBezahlenDialog senden Seriennummer und Schluessel mit, die
   * Warteschlange reicht sie nach, die Tagesmappe traegt sie ins Paket.)
   * ganzen Baum gemessen: keine Produktionsstelle füllt `tssSerialNumber` oder
   * `signaturePublicKey`; die Kette ist an vier Stellen offen, aufgezählt an
   * `DsfinvkTseInput` in `dsfinvk-export.ts`. Also ist dieses Feld hier bis
   * heute die EINZIGE Quelle beider Angaben — und `routes/closing-export.ts`
   * gibt es nicht mit. Ergebnis: `TSE_SERIAL` und `TSE_PUBLIC_KEY` sind in
   * jedem gezogenen Prüferpaket leer.
   *
   * Zeitformat und Zertifikat kommen ohnehin ausschliesslich von hier: die
   * Brücke der Kasse liefert sie nicht. Fehlen sie, bleiben die Spalten LEER —
   * ein Prüfer sieht dann, DASS die Angabe fehlt, statt eine erfundene zu
   * lesen.
   */
  tseStammdaten?: Readonly<
    Record<
      string,
      {
        seriennummer?: string;
        signaturAlgorithmus?: string;
        zeitformat?: string;
        publicKey?: string;
        zertifikat?: string;
      }
    >
  >;
  /** Seriennummer der Kasse, § 146a Abs. 4 AO. */
  kassenSeriennummer: string;
  /** Was in TAXONOMIE_VERSION gehört — der Berater sagt es. */
  taxonomieVersion: string;
  /**
   * Fassung der Kassensoftware. Landet als `KASSE_SW_VERSION` in
   * `cashregister.csv`, also in der Datei, die ein Betriebsprüfer bei einer
   * Kassennachschau nach § 146b AO als Erstes aufschlägt.
   *
   * ⚠️ LEER heisst LEER, nicht „nimm irgendetwas". Wer hier nichts weiss,
   * gibt nichts an — genau wie bei `kassenSeriennummer` und den
   * TSE-Stammdaten weiter oben. Ein Prüfer sieht dann, DASS die Angabe
   * fehlt; das ist eine Lücke. Eine erfundene Zahl wäre dagegen eine
   * unwahre Angabe in einem amtlichen Dokument, und das ist keine Lücke,
   * sondern ein Vorwurf.
   *
   * Den Wert holt man sich mit `kassensoftwareFassung()` unten, nicht von
   * Hand.
   */
  softwareVersion: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE FASSUNG DER KASSE — GEMESSEN, NICHT GERATEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 04.08.2026 gemessen. In `routes/closing-export.ts` stand:
 *
 *     softwareVersion: process.env.APP_VERSION ?? '1.0.0',
 *
 * `APP_VERSION` wird im ganzen Baum NIRGENDS gesetzt (gemessen mit einem
 * `grep` über alle `.ts`, `.mjs`, `.rs`, `.json`, `.yml`: der einzige Treffer
 * war diese Zeile selbst und ihre gebündelten Kopien). Also griff IMMER der
 * Ersatzwert. Jedes je erzeugte Prüferpaket meldete dem Finanzamt die Fassung
 * `1.0.0`. Die Kasse ist `0.0.2` — das steht in
 * `apps/tauri-pos/src-tauri/tauri.conf.json`, und `scripts/set-version.mjs`
 * erklärt diese Datei ausdrücklich zur einzigen wahren Quelle.
 *
 * Der Weg ist jetzt geschlossen und läuft in EINE Richtung:
 *
 *     tauri.conf.json  →  (esbuild bäckt sie beim Bündeln in start.mjs)
 *                      →  der Sidecar setzt NORNS_KASSE_VERSION
 *                      →  diese Funktion
 *                      →  KASSE_SW_VERSION in cashregister.csv
 *
 * `APP_VERSION` bleibt als zweiter Weg stehen, damit derselbe Motor auch in
 * einer Aufstellung ohne Sidecar (Wolke, Behälter) eine wahre Fassung melden
 * kann. Er ist nur noch ein Weg, kein Ersatzwert mehr.
 *
 * WAS DIE NORM VERLANGT: `KASSE_SW_VERSION` steht in der mitgelieferten
 * amtlichen Beschreibung (`src/fiskal/dsfinvk-2.4/index.xml`) als
 * `AlphaNumeric`, `MaxLength` 50, ohne Vorgabewert. Die Spalte MUSS also da
 * sein, und sie MUSS die Wahrheit sagen. Nichts in der Norm erlaubt, sie zu
 * füllen, wenn man die Fassung nicht kennt.
 *
 * Deshalb: unbekannt → leere Zeichenkette → das Feld bleibt leer.
 */
export function kassensoftwareFassung(
  umgebung: Record<string, string | undefined> = process.env,
): string {
  const roh = (umgebung['NORNS_KASSE_VERSION'] ?? umgebung['APP_VERSION'] ?? '').trim();
  // ⚠️ Was nicht wie eine Fassung aussieht, IST keine. Ein versehentlich
  // gesetztes „true", ein Pfad oder ein abgeschnittener Text würde sonst auf
  // dem Prüferdatenträger stehen und dort mehr Fragen aufwerfen als ein
  // leeres Feld. Die Form ist die des Hauses: `x.y.z` mit erlaubtem Anhang,
  // dieselbe, die `scripts/set-version.mjs` durchlässt.
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(roh)) return '';
  // MaxLength 50 laut index.xml. Eine Fassung dieser Form wird nie so lang;
  // steht sie es doch, ist sie kaputt und das Feld bleibt lieber leer, statt
  // abgeschnitten eine ANDERE Fassung zu behaupten.
  if (roh.length > 50) return '';
  return roh;
}

/** `123.45` → `123.45`, aber `null`/leer bleibt leer statt null zu werden. */
const betrag = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * Dasselbe Geld, andere Richtung.
 *
 * Rein auf der Zeichenkette, ohne Gleitkomma: „500.00" wird „-500.00". Eine
 * schon negative Zahl bleibt negativ, und die Null bleibt die Null (ein
 * „-0.00" auf einem Prüferdatenträger sähe aus wie ein Fehler).
 */
/**
 * ⚠️ DIE RICHTUNG EINES BELEGS ENTSCHEIDET SEIN VORZEICHEN — ÜBERALL.
 *
 * ── DER BEFUND VOM 05.08.2026 ─────────────────────────────────────────────
 *
 * Sechs Prüfer fanden acht Befunde, die alle DIESELBE Wurzel hatten: ein
 * Ankauf trug im Belegkopf ein PLUS und in seiner Zahlungszeile ein MINUS.
 *
 * Gemessen an einem Tag mit einem Verkauf über 270,00 und einem Ankauf über
 * 500,00, beide bar: `transactions.csv` meldete 770,00 Umsatz, die Summe der
 * Zahlungen war −230,00. Der Datenträger behauptete dem Finanzamt 270,00 EUR
 * Bareinnahme, während die Lade an dem Tag 230,00 EUR VERLOREN hatte. Auf
 * einen einzigen Ankauf 1.000,00 EUR Unterschied in der ersten Rechnung, die
 * ein Prüfer macht.
 *
 * Ein Ankauf ist eine AUSZAHLUNG: Geld verlässt die Kasse. `gvTypFuer` sagt
 * das für die Positionszeile längst. Ab jetzt sagt es der ganze Beleg —
 * Kopf, Positionen, Positionssteuer, Belegsteuer, Preisfindung und Zahlung
 * tragen dasselbe Vorzeichen.
 *
 * Diese Funktion ist der EINE Ort, an dem das entschieden wird. Wer eine
 * neue Datei hinzufügt, führt ihre Beträge hier durch, statt eine zweite
 * Meinung über die Richtung zu bilden.
 */
function nachRichtung(richtung: 'VERKAUF' | 'ANKAUF', wert: string): string {
  return richtung === 'ANKAUF' ? vorzeichenUmkehren(wert) : wert;
}

/**
 * ⛔ ECHTE VORZEICHENUMKEHR, KEIN „MINUS DAVORSETZEN" (19.08.2026).
 *
 * ── DER FUND DER BOESWILLIGEN PRUEFUNG ─────────────────────────────────────
 *
 * Hier stand `negativ()`, und die Funktion tat genau das, was ihr Name sagt:
 * sie machte eine Zahl negativ. War sie es schon, liess sie sie in Ruhe.
 *
 * Beim STORNO eines Ankaufs ist der Betrag aber bereits gespiegelt
 * (`transactions-storno.ts` kehrt ihn um, ein CHECK erzwingt es): aus dem
 * Barankauf ueber 500,00 EUR wird eine Zahlungszeile ueber −500,00. Die alte
 * Funktion liess dieses Minus stehen — und der Storno, der den Geldabfluss
 * AUSGLEICHEN soll, verdoppelte ihn im Datentraeger: −500 statt +500.
 *
 * ⚠️ Und schlimmer: die Tagesvorfaelle (`businesscases.csv`) rechnen zwanzig
 * Zeilen weiter unten mit `vz = -1n`, also mit einer ECHTEN Umkehr. Derselbe
 * Beleg trug damit in zwei Dateien desselben Pakets zwei verschiedene
 * Wahrheiten: 0 gegen −2×. Ein Pruefer, der Kopf-, Positions- und
 * Vorfallzeilen gegeneinander stellt — und das ist sein erster Griff —
 * findet einen Widerspruch, den niemand erklaeren kann.
 *
 * Beide Wege benutzen jetzt dieselbe Regel: das Vorzeichen wird GEDREHT.
 * Die Null bleibt die Null; ein „−0,00" waere eine Aussage ueber nichts.
 */
function vorzeichenUmkehren(v: string): string {
  const t = v.trim();
  if (t === '') return t;
  if (/^-?0+([.,]0+)?$/.test(t)) return t.startsWith('-') ? t.slice(1) : t;
  return t.startsWith('-') ? t.slice(1) : `-${t}`;
}

/**
 * Geld in ganze Cent, ohne Gleitkomma.
 *
 * ⚠️ `Number('0.1') + Number('0.2')` ist nicht `0.3`. Auf einem Datenträger,
 * den ein Prüfer gegen die Einzelaufzeichnung stellt, ist so ein Cent keine
 * Rundung, sondern eine Abweichung, die er erklärt haben will.
 */
function zuCentGlobal(s: string | null | undefined): bigint {
  const t = (s ?? '0').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return 0n;
  const neg = t.startsWith('-');
  const [w = '0', f = ''] = (neg ? t.slice(1) : t).split('.');
  const v = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -v : v;
}

function ausCentGlobal(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

/**
 * Der Preis pro Maßeinheit, aus Zeilenbetrag und Menge.
 *
 * ⚠️ Bei Menge 1 (dem Regelfall dieses Hauses) ist er der Zeilenbetrag. Die
 * Rechnung steht trotzdem hier, weil der Tag kommt, an dem jemand zwei
 * gleiche Münzen auf EINE Zeile bucht.
 *
 * Ist die Menge unbrauchbar oder null, bleibt der Zeilenbetrag stehen: eine
 * Division durch null ergäbe `Infinity`, und das wäre schlimmer als eine
 * ungeteilte Zahl.
 */
function stueckpreis(zeilenbetrag: string, menge: string): string {
  const b = Number((zeilenbetrag ?? '').trim());
  const m = Number((menge ?? '').trim());
  if (!Number.isFinite(b) || !Number.isFinite(m) || m === 0) return betrag(zeilenbetrag);
  if (m === 1) return betrag(zeilenbetrag);
  return (b / m).toFixed(5);
}

/**
 * Der Belegschlüssel.
 *
 * ⚠️ Die Norm trennt zwei Dinge, die hier bisher dasselbe waren:
 *
 *   BON_ID  — dauerhaft eindeutig über den ganzen Lebenszyklus der Kasse
 *   BON_NR  — eindeutig INNERHALB eines Kassenabschlusses, darf sich
 *             über die Jahre wiederholen
 *
 * Der Belegbezeichner (`RCP-2026-000074`) erfüllt beides: er ist eindeutig
 * und trägt eine fortlaufende Nummer. Als BON_NR wird deshalb der numerische
 * Teil genommen, und wenn er fehlt, die Position im Tag.
 */
function bonNummer(r: DsfinvkReceiptInput, position: number): string {
  const m = /(\d+)\s*$/.exec(r.receiptLocator);
  return m?.[1] ? String(Number(m[1])) : String(position + 1);
}

/**
 * Aus dem Rumpf der Route die Zeilen der Norm formen.
 *
 * Wirft, wo ein Wert fehlt, der nicht erfunden werden darf — die Meldungen
 * kommen aus `dsfinvk-schluessel.ts` und `haendler-stammdaten.ts` und nennen
 * jeweils, wer entscheidet.
 */
export function formeDaten(input: DsfinvkBundleInput, mensch: MenschlicheAngaben): Daten {
  const { closing, cashRegister, receipts, businessDay } = input;

  /**
   * ⛔ 08.08.2026 — HIER STAND NUR `(closing.zNr ?? '').trim()`.
   *
   * Kein Wurf, keine Meldung. Fehlte die Nummer, entstanden zwanzig Dateien
   * mit leerem Z-Feld: ein Paket, das vollständig AUSSIEHT und keinen
   * Schlüssel trägt, mit dem ein Prüfer die Abschlüsse verbinden könnte.
   *
   * ⚠️ Und die Route behauptete an ihrer Aufrufstelle das Gegenteil:
   * „Fehlt er, wirft `zNr`". Der Satz stimmte einmal — er beschreibt `zNr()`
   * aus dem ABGELÖSTEN Erzeuger `dsfinvk-export.ts`, der seit dem 28.07.
   * keinen Aufrufer mehr hat. Der Riegel blieb beim Umzug zurück, der
   * Kommentar reiste mit.
   *
   * Das ist die gefährlichste Sorte Kommentar: er beruhigt an genau der
   * Stelle, an der jemand nachsehen würde.
   *
   * Der CHECK in der Datenbank hilft nicht: er ist `NOT VALID`, Altbestände
   * wurden nie geprüft.
   */
  const zNr = (closing.zNr ?? '').trim();
  if (zNr === '') throw new ZNummerFehltError(businessDay);
  const erstellung = closing.finalizedAt ?? '';
  const kasseId = cashRegister.id;

  const belege: BelegZeile[] = [];
  const positionen: PositionsZeile[] = [];
  const positionsUst: UstZeile[] = [];
  const preisfindung: PreisfindungZeile[] = [];
  const belegUst: UstZeile[] = [];
  /**
   * Die Tagesvorfälle, während der Belegschleife gesammelt.
   *
   * ⚠️ Aus den BELEGEN, nicht aus einer zweiten Aufstellung des
   * Abschlusses. Zwei Quellen für dieselbe Zahl laufen auseinander,
   * und am 05.08.2026 taten sie es: `businesscases.csv` kannte den
   * Ankauf nicht, `transactions.csv` schon.
   */
  const gvSummen = new Map<
    string,
    { gvTyp: string; schluessel: string; brutto: bigint; netto: bigint; ust: bigint }
  >();
  const zahlungen: ZahlZeile[] = [];
  const tse: TseZeile[] = [];
  const referenzen: ReferenzZeile[] = [];
  // Welche Sicherheitseinrichtungen in diesem Abschluss vorkommen, in der
  // Reihenfolge ihres ersten Auftretens.
  const tseIds: string[] = [];
  const signaturAlgorithmen = new Map<string, string>();
  /**
   * Die Stammangaben, die jede Signatur ihrer eigenen Sicherungseinrichtung
   * beilegt: Seriennummer und öffentlicher Schlüssel.
   *
   * ⚠️ Sie werden hier GESAMMELT, nicht erfragt. Der Signaturalgorithmus geht
   * seit jeher genau diesen Weg (`signaturAlgorithmen` eine Zeile höher);
   * diese beiden können ihn seit dem 12.08.2026 ebenfalls gehen. Der erste
   * Beleg, der einen Wert nennt, gewinnt; jeder weitere Beleg desselben Geräts
   * nennt denselben.
   *
   * ⛔ Bis heute bleiben beide Sammlungen im Betrieb LEER: kein Beleg, den
   * `routes/closing-export.ts` baut, nennt einen Wert. Der Signaturalgorithmus
   * kommt an, weil die Datenbank eine Spalte dafür hat und die Abfrage sie
   * holt — genau die zwei Dinge fehlen diesen beiden. Aufgezählt an
   * `DsfinvkTseInput` in `dsfinvk-export.ts`, gemessen vom Wächter
   * `tests/unit/tse-stammdaten-lebender-weg.test.ts`.
   */
  const seriennummern = new Map<string, string>();
  const oeffentlicheSchluessel = new Map<string, string>();

  for (const [i, r] of receipts.entries()) {
    const bonId = r.receiptLocator;

    belege.push({
      bonId,
      bonNr: bonNummer(r, i),
      bonTyp: bonTypFuer(r.isStorno),
      bonStorno: r.isStorno,
      // ⚠️ Beginn und Ende des Vorgangs.
      //
      // 19.08.2026: die Kasse kennt den Beginn jetzt WIRKLICH — die
      // Vorgangs-Uhr oeffnet beim ersten Stueck im Korb (0147,
      // `vorgang_begonnen_at`). Fuer aeltere Belege und die Faelle, in denen
      // der Beginn unbekannt ist (Wiederanlauf, Web-Abholung), bleibt der
      // alte, ehrliche Rueckfall: beide Felder aus `finalized_at` — der
      // Zeitpunkt IST der des Vorgangs, nur seine Dauer kennen wir nicht.
      //
      // ── Zur Zeitzone, nachgemessen am Normtext ────────────────────────
      //
      // Ein Prüfer meldete, die Norm verlange LOKALZEIT und unser `Z` sei
      // falsch. Nachgezählt: das Wort „Lokalzeit" kommt im ganzen Normtext
      // NULL Mal vor. Der Befund ist unbelegt.
      //
      // Was stimmt: die Norm verlangt „ISO 8601 und RFC3339" und zeigt drei
      // Beispiele, ALLE ohne Zonenangabe (`2016-09-27T17:00:01`). Wir
      // schreiben mit `Z`, also mit ausdrücklicher Zone.
      //
      // Das bleibt so, und zwar bewusst: RFC 3339 verlangt die Zonenangabe
      // sogar, und ein Zeitstempel OHNE sie ist mehrdeutig — bei der
      // Sommerzeitumstellung gibt es eine Stunde, die zweimal existiert.
      // Ein Prüfer, der einen Beleg dieser Stunde einer Minute zuordnen
      // will, kann das mit `Z` und ohne sie nicht.
      //
      // ⚠️ Sollte das amtliche Prüfwerkzeug die Zone beanstanden, ist DAS
      // die Stelle, die sich ändert — und dann gehört die Berliner Ortszeit
      // hierher, nicht UTC ohne Kennzeichen.
      bonStart: r.vorgangBegonnenAt ?? r.finalizedAt,
      bonEnde: r.finalizedAt,
      bedienerId: r.cashierUserId,
      umsatzBrutto: nachRichtung(r.direction, betrag(r.totalEur)),
      kundeId: r.customerId,
      notiz: null,
    });

    // ── Der Beleg je Steuersatz ────────────────────────────────────────
    // Aus den ZEILEN summiert, nicht neu gerechnet: die gespeicherten Werte
    // sind die des gedruckten Belegs.
    const jeSatz = new Map<string, { brutto: bigint; netto: bigint; ust: bigint }>();
    const zuCent = (s: string): bigint => {
      const t = (s ?? '0').trim();
      const neg = t.startsWith('-');
      const [w = '0', f = ''] = (neg ? t.slice(1) : t).split('.');
      const v = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
      return neg ? -v : v;
    };
    const ausCent = (c: bigint): string => {
      const neg = c < 0n;
      const a = neg ? -c : c;
      return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
    };

    for (const l of r.lines) {
      const schluessel = ustSchluesselFuer(l.appliedTaxTreatmentCode, mensch.eigeneUstSchluessel);
      const posZeile = String(l.lineNumber);

      positionen.push({
        bonId,
        posZeile,
        artikeltext: l.productName,
        gvTyp: gvTypFuer(r.direction, mensch.gvTypAnkauf),
        // ⚠️ NICHT `r.isStorno`. Tz. 4.2.3, wörtlich: wer eine zweite Zeile
        // mit negiertem Vorzeichen erstellt, darf P_STORNO gerade NICHT auf
        // „1" setzen — und „sobald die Transaktion in der TSE signiert ist,
        // darf das Feld P_STORNO nicht mehr verwendet werden".
        //
        // Dieses Haus bucht gegen und signiert jeden Storno. Beide
        // Bedingungen treffen also zu.
        posStorno: false,
        artNr: null,
        menge: betrag(l.quantity),
        // ⚠️ STK_BR ist der PREIS PRO MASSEINHEIT, nicht der Zeilenbetrag.
        // Die Norm, wörtlich: „(Grund)Preis pro Maßeinheit in der
        // Basiswährung der Kasse. Beispiel: Fleisch kostet z. B. 5 € pro
        // 1,5 kg, verkaufte Menge: 2 kg. Preis pro Maßeinheit: 5,00."
        //
        // Heute fällt der Unterschied nicht auf, weil die Route für jede
        // Zeile die Menge 1 einträgt und Zeilenbetrag gleich Stückpreis ist.
        // Sobald ein Stück mit Menge 2 verkauft wird — Münzen, Silberbarren —
        // stünde dort der DOPPELTE Preis. Ein latenter Fehler, der genau dann
        // sichtbar wird, wenn niemand mehr daran denkt.
        stueckBrutto: nachRichtung(r.direction, stueckpreis(l.lineTotalEur, l.quantity)),
      });

      positionsUst.push({
        bonId,
        posZeile,
        ustSchluessel: schluessel,
        brutto: nachRichtung(r.direction, betrag(l.lineTotalEur)),
        netto: nachRichtung(r.direction, betrag(l.lineSubtotalEur)),
        ust: nachRichtung(r.direction, betrag(l.lineVatEur)),
      });

      /**
       * ── Die Preisfindung, `itemamounts.csv` ────────────────────────────
       *
       * Die Norm: „Auflistung der gewährten Rabattbeträge oder Aufschläge pro
       * Position … ZUSÄTZLICH IST DER GRUNDPREIS DER POSITION ANZUGEBEN."
       * Ein Rabatt braucht also ZWEI Zeilen, und die Rabattzeile trägt
       * „mit negiertem Vorzeichen".
       *
       * Ohne Rabatt bleibt die Datei für diese Position leer: es gibt dann
       * nichts zu erklären, und eine Grundpreiszeile ohne Abzug wäre nur
       * Rauschen. Mit Rabatt dagegen sah ein Prüfer bisher einen Preis, den
       * NICHTS erklärte — die Abfrage las die Spalte nie.
       *
       * ── Wie der Abzug auf Netto und USt aufgeht ────────────────────────
       *
       * Nicht geraten, sondern gerechnet: ein Preisnachlass ändert die
       * Bemessungsgrundlage (§ 17 Abs. 1 UStG). Der Steueranteil des Abzugs
       * ist deshalb `Rabatt × Satz / (100 + Satz)`, mit dem Satz, der auf
       * DIESER Zeile angewandt wurde.
       *
       *   • 19 % und 7 %: unmittelbar, die Steuer hängt am Preis.
       *   • § 25a: die Marge sinkt um genau den Rabatt, also sinkt ihre
       *     Steuer um denselben Anteil. Dieselbe Rechnung.
       *   • § 25c und § 13b: der Satz ist 0, der Anteil wird 0. Richtig.
       *
       * Der Grundpreis entsteht dann durch ADDITION, nicht durch eine zweite
       * Rechnung — so geht `Grundpreis − Rabatt = Zeile` in allen drei
       * Feldern auf den Cent auf, und kein Rundungsrest bleibt hängen.
       *
       * ── Die Abwägung, die dabei zu treffen war ─────────────────────────
       *
       * Man könnte die Steuer des Grundpreises auch aus dem Grundpreis SELBST
       * rechnen: 110,00 × 19/119 = 17,56. Additiv kommt 17,57 heraus, weil
       * 15,97 und 1,60 jeweils für sich gerundet sind. Ein Cent Unterschied.
       *
       * Die Addition gewinnt, aus zwei Gründen:
       *
       *   • Bei § 25a führt der andere Weg NICHT einen Cent daneben, sondern
       *     meilenweit: dort hängt die Steuer an der Marge, nicht am Preis.
       *     `Grundpreis × 19/119` wäre die Steuer auf den ganzen Verkauf.
       *   • Die 17,56 wäre die Steuer eines Preises, der NIE kassiert wurde.
       *     Die 17,57 dagegen ist die Steuer, die wirklich anfiel, plus der
       *     Anteil, der wegfiel. Beides sind gebuchte Zahlen.
       *
       * Was ein Prüfer prüft, ist die Schliessung: Grundpreis minus Rabatt
       * muss die Zeile ergeben. Das tut sie hier immer, in jedem Feld.
       */
      const rabatt = zuCent(l.lineDiscountEur ?? '0');
      if (rabatt > 0n) {
        /**
         * ── Wie der Abzug auf Netto und USt aufgeht ──────────────────────
         *
         * ⚠️ Der erste Entwurf las `appliedVatRate` als PROZENTZAHL und
         * teilte den Rabatt danach. Zwei Messungen haben ihn umgeworfen:
         *
         *   1. Die Spalte ist `numeric(5,4)` und trägt einen BRUCH: 0.1900,
         *      nicht 19.00. Der eigene Test fütterte „19.00" und stimmte der
         *      Fehlannahme damit zu — grün, und trotzdem falsch.
         *
         *   2. Viel schwerer: von den acht rabattierten Zeilen auf der
         *      Produktion sind ACHT § 25a, und alle acht tragen `satz = NULL`.
         *      Der Satzweg hätte also bei JEDEM echten Rabatt eine Steuer von
         *      null ergeben und den ganzen Abzug ins Netto geschoben.
         *
         * Bei § 25a liegt die Steuer auf der MARGE. Der Rabatt senkt den
         * Preis, damit die Marge, damit ihre Steuer. Gerechnet wird deshalb
         * die Differenz zweier Margen — mit derselben Regel, die
         * `marge-nachrechnen.ts` erzwingt: 19/119 der Marge, kaufmännisch
         * gerundet, und eine negative Marge ist null (Abschn. 25a.1 Abs. 12
         * UStAE, das Finanzamt erstattet keine Steuer auf Verlust).
         *
         * Genau dieser Deckel ist der Grund, warum der Satzweg hier nicht nur
         * ungenau, sondern falsch wäre: bei einem Verlustverkauf ändert ein
         * Rabatt an der Steuer NICHTS, und ein Anteil „19/119 des Rabatts"
         * wäre frei erfunden. Auf der Produktion steht so eine Zeile:
         * brutto 0,95, Rabatt 0,05, Marge 0,00, Steuer 0,00.
         */
        const rabattUst = ((): bigint => {
          const satzBruch = l.appliedVatRate === null || l.appliedVatRate === undefined
            ? null
            : Number(l.appliedVatRate);
          if (satzBruch !== null && Number.isFinite(satzBruch) && satzBruch > 0) {
            // Der Satz steht auf der Zeile: 0.1900 heisst 19 %. Zehntausendstel,
            // weil die Spalte vier Nachkommastellen führt.
            const r = BigInt(Math.round(satzBruch * 10000));
            const teiler = 10000n + r;
            return (rabatt * r + teiler / 2n) / teiler;
          }
          // Kein Satz auf der Zeile. Bei § 25a rechnet die Marge.
          const ek = l.acquisitionCostEurSnapshot;
          if (l.appliedTaxTreatmentCode === 'MARGIN_25A' && ek !== null && ek !== undefined) {
            const ekCent = zuCent(ek);
            const margeNachher = zuCent(l.lineTotalEur) - ekCent;
            const margeVorher = zuCent(l.lineTotalEur) + rabatt - ekCent;
            /*
             * Kaufmännisch gerundet, wie in `marge-nachrechnen.ts`. Bewusst
             * hier und nicht importiert: das Geschwistermodul hält seine
             * eigene, und zwei winzige Kopien einer Rundung sind harmloser
             * als eine Abhängigkeit quer durch die fiskale Ausfuhr.
             */
            const rundeHalfEven = (zaehler: bigint, nenner: bigint): bigint => {
              const q = zaehler / nenner;
              const r = zaehler - q * nenner;
              const zwei = 2n * r;
              if (zwei > nenner) return q + 1n;
              if (zwei < nenner) return q;
              return q % 2n === 0n ? q : q + 1n;
            };
            const ustAus = (marge: bigint): bigint => {
              if (marge <= 0n) return 0n;
              /*
               * ⛔ HIER STAND `(marge * 19n + 59n) / 119n` (bis 21.08.2026),
               * mit dem Kommentar „dieselbe Zeile wie in marge-nachrechnen.ts".
               *
               * Genau die wurde am 20.08. auf `satzAm` umgestellt — die beiden
               * sind seitdem AUSEINANDERGELAUFEN, und der Kommentar behauptete
               * weiter eine Gleichheit, die es nicht mehr gab. Ein Kommentar,
               * der auf eine Zeile zeigt, altert mit ihr.
               *
               * ⚠️ Diese Zahl landet im PRÜFERPAKET. § 25a besteuert die Marge
               * mit dem Regelsatz DES TAGES; im Corona-Halbjahr 2020 waren das
               * 16 Prozent. Mit der festen Zahl trüge die Ausfuhr für solche
               * Belege eine Steuer, die der Beleg selbst nie hatte.
               */
              const { zaehler, nenner } = bruttoBruch(satzAm('REGEL', businessDay));
              return rundeHalfEven(marge * zaehler, nenner);
            };
            return ustAus(margeVorher) - ustAus(margeNachher);
          }
          // § 25c und § 13b: es fällt keine Steuer an, also ändert ein Rabatt
          // auch keine. 0 ist hier die gemessene Wahrheit, kein Rückfall.
          return 0n;
        })();
        const rabattNetto = rabatt - rabattUst;
        const zeileBrutto = zuCent(l.lineTotalEur);
        const zeileNetto = zuCent(l.lineSubtotalEur);
        const zeileUst = zuCent(l.lineVatEur);

        // ⚠️ Auch hier gilt die Richtung. „Grundpreis minus Rabatt ergibt die
        // Zeile" muss auf einem Ankaufbeleg genauso aufgehen wie auf einem
        // Verkauf — und die Zeile trägt dort seit heute ein Minus.
        preisfindung.push(
          {
            bonId,
            posZeile,
            typ: 'base_amount',
            ustSchluessel: schluessel,
            brutto: nachRichtung(r.direction, ausCent(zeileBrutto + rabatt)),
            netto: nachRichtung(r.direction, ausCent(zeileNetto + rabattNetto)),
            ust: nachRichtung(r.direction, ausCent(zeileUst + rabattUst)),
          },
          {
            bonId,
            posZeile,
            typ: 'discount',
            ustSchluessel: schluessel,
            brutto: nachRichtung(r.direction, ausCent(-rabatt)),
            netto: nachRichtung(r.direction, ausCent(-rabattNetto)),
            ust: nachRichtung(r.direction, ausCent(-rabattUst)),
          },
        );
      }

      const g = jeSatz.get(schluessel) ?? { brutto: 0n, netto: 0n, ust: 0n };
      g.brutto += zuCent(l.lineTotalEur);
      g.netto += zuCent(l.lineSubtotalEur);
      g.ust += zuCent(l.lineVatEur);
      jeSatz.set(schluessel, g);
    }

    for (const [schluessel, g] of jeSatz) {
      belegUst.push({
        bonId,
        ustSchluessel: schluessel,
        brutto: nachRichtung(r.direction, ausCent(g.brutto)),
        netto: nachRichtung(r.direction, ausCent(g.netto)),
        ust: nachRichtung(r.direction, ausCent(g.ust)),
      });

      // ⚠️ Die Tagessumme entsteht HIER, aus denselben Zeilen wie die
      // Einzelaufzeichnung. Vorher kam sie aus `closing.umsatzByTreatment`,
      // und das ist eine VERKAUFSREINE Aufstellung: der Ankauf fehlte in
      // `businesscases.csv` vollständig, und die Summe der Tagesvorfälle
      // stimmte nie mit der Summe der Belege überein.
      const gvTyp = gvTypFuer(r.direction, mensch.gvTypAnkauf);
      const gvKey = `${gvTyp}\u0000${schluessel}`;
      const gv = gvSummen.get(gvKey) ?? { gvTyp, schluessel, brutto: 0n, netto: 0n, ust: 0n };
      const vz = r.direction === 'ANKAUF' ? -1n : 1n;
      gv.brutto += g.brutto * vz;
      gv.netto += g.netto * vz;
      gv.ust += g.ust * vz;
      gvSummen.set(gvKey, gv);
    }

    for (const p of r.payments) {
      zahlungen.push({
        bonId,
        zahlartTyp: zahlartTypFuer(p.paymentMethod),
        zahlartName: p.paymentMethod,
        /**
         * ⚠️ EINE ANKAUFZAHLUNG IST EINE AUSZAHLUNG.
         *
         * ── DER RÜCKFALL VOM 28.07.2026, GEMESSEN AM 04.08.2026 ───────────
         *
         * `datapayment.csv` ist die Zahlartenaufstellung, aus der ein Prüfer
         * je Zahlart SUMMIERT. Steht eine Auszahlung dort ohne Vorzeichen,
         * liest er sie als Einnahme.
         *
         * Der abgelöste Erzeuger kannte das (`zahlungsBetrag` in
         * `dsfinvk-export.ts` kehrte das Vorzeichen um). Beim Umbau auf den
         * amtlichen Erzeuger ging die Richtung verloren, und niemand sah es:
         * die Zusage stand in der Integrationsmappe, und die lief nirgends.
         *
         * Gemessen wurde damals wie heute dieselbe Zahl: Bar ergab 76.929
         * statt −23.071 Cent. Ein Ankauf über 500,00 EUR erschien als
         * Bareinnahme über 500,00 EUR, also 1.000,00 EUR Unterschied in der
         * Kassenaufstellung eines einzigen Tages.
         */
        betrag: nachRichtung(r.direction, betrag(p.amountEur)),
      });
    }

    // ⚠️ Der Verweis des Stornos auf seinen Urbeleg. Tz. 4.2.2 macht ihn zur
    // Pflicht, und ohne ihn sagt das Paket zwar, DASS storniert wurde, aber
    // nicht WAS.
    // 0148: die Rueckgabe traegt denselben Verweis (stornoVon ist dann das
    // Original der Ruecknahme — der Tag-Builder fuellt das Feld fuer beide
    // Verweisarten). Die Bedingung haengt am VERWEIS, nicht am Storno-Bit.
    if (r.stornoVon) {
      referenzen.push({
        bonId,
        refBonId: r.stornoVon.bonId,
        // Die Kasse des URBELEGS. Solange es eine gibt, ist es dieselbe.
        refZKasseId: kasseId,
        refZNr: r.stornoVon.zNr ?? undefined,
        refDatum: r.stornoVon.erstellung ?? undefined,
      });
    }

    if (r.tse) {
      if (!tseIds.includes(r.tse.fiskalyTssId)) tseIds.push(r.tse.fiskalyTssId);
      if (r.tse.signatureAlgorithm) {
        signaturAlgorithmen.set(r.tse.fiskalyTssId, r.tse.signatureAlgorithm);
      }
      // ⚠️ `trim()` und die Prüfung auf leer sind der Riegel gegen ein
      // aufgezeichnetes „nichts": eine leere Zeichenkette, die als Angabe
      // durchginge, sähe im Prüferpaket aus wie eine gemeldete Seriennummer.
      // Der erste WIRKLICHE Wert setzt sich, spätere überschreiben ihn nicht.
      const seriennummer = r.tse.tssSerialNumber?.trim();
      if (seriennummer && !seriennummern.has(r.tse.fiskalyTssId)) {
        seriennummern.set(r.tse.fiskalyTssId, seriennummer);
      }
      const oeffentlich = r.tse.signaturePublicKey?.trim();
      if (oeffentlich && !oeffentlicheSchluessel.has(r.tse.fiskalyTssId)) {
        oeffentlicheSchluessel.set(r.tse.fiskalyTssId, oeffentlich);
      }
      tse.push({
        bonId,
        // ⚠️ Die laufende Nummer AUS DIESEM PAKET, nicht die fiskaly-UUID.
        // Die Norm: TSE_ID „wird nur zur Referenzierung innerhalb eines
        // Kassenabschlusses verwendet".
        tseId: String(tseIds.indexOf(r.tse.fiskalyTssId) + 1),
        tseTaNr: r.tse.fiskalyTransactionNumber,
        tseTaStart: r.tse.tseStartTime,
        tseTaEnde: r.tse.tseEndTime,
        tseTaVorgangsart: r.tse.processType,
        tseTaSigZaehler: r.tse.signatureCounter,
        tseTaSignatur: r.tse.signatureValue,
        tseTaFehler: null,
      });
    } else {
      /**
       * ⛔ 08.08.2026 — HIER STAND KEIN `else`, UND DAS WAR DAS LOCH.
       *
       * Ein Beleg ohne Signatur bekam gar keine Zeile. Fiel die TSE aus,
       * verschwanden die betroffenen Belege lautlos aus
       * `transactions_tse.csv`, und der Auszug sah aus wie ein Tag, an dem
       * jeder Beleg sauber signiert wurde.
       *
       * Nicht falsch, sondern **still**: eine falsche Zahl kann ein Prüfer
       * finden, eine fehlende Zeile nicht.
       *
       * `TSE_TA_FEHLER` ist genau dafür gebaut, siehe die amtliche
       * Beschreibung in `src/fiskal/dsfinvk-2.4/index.xml`. Der Wortlaut
       * steht in `tse-ausfall.ts` an EINER Stelle, weil er eine Erklärung an
       * die Finanzverwaltung ist.
       *
       * ⚠️ Alle Signaturfelder bleiben LEER. Eine Transaktionsnummer oder
       * ein Signaturzähler, den nie jemand vergeben hat, wäre eine falsche
       * Angabe in einem Steuerauszug — Klasse „fabricate-when-unconfigured",
       * nur an der teuersten denkbaren Stelle.
       *
       * Und `tseIds` bleibt unberührt: `tse.csv` meldet nur Geräte, die
       * wirklich beteiligt waren.
       */
      tse.push({
        bonId,
        tseId: null,
        tseTaNr: null,
        tseTaStart: null,
        tseTaEnde: null,
        tseTaVorgangsart: null,
        tseTaSigZaehler: null,
        tseTaSignatur: null,
        tseTaFehler: ausfallVermerk(),
      });
    }
  }

  // ── Der Kassenabschluss ────────────────────────────────────────────────
  const s = mensch.stammdaten.daten;

  /**
   * ⚠️ DIE TAGESSUMMEN KOMMEN AUS DEN BELEGEN, NICHT AUS EINER ZWEITEN LISTE
   *
   * ── DER BEFUND VOM 05.08.2026 ──────────────────────────────────────────
   *
   * Hier stand `closing.paymentsByMethod`. Diese Aufstellung entsteht in
   * `closings-finalize.ts` mit einem Richtungsfilter und kennt nur die
   * VERKAUFSSEITE. `datapayment.csv` daneben kannte den Ankauf.
   *
   * Gemessen an einem Tag mit 270,00 bar ein und 500,00 bar aus: die
   * Einzelzahlungen ergaben −230,00, `payment.csv` behauptete 270,00 und
   * `Z_SE_BARZAHLUNGEN` ebenfalls 270,00. EIN Paket, DREI Zahlen für
   * dieselbe Frage — und ein Prüfer stellt genau diese drei gegeneinander.
   *
   * Ab jetzt gibt es eine Quelle: die Zahlungszeilen der Belege, die oben
   * schon mit Vorzeichen gebaut wurden. Was einzeln steht, steht auch in der
   * Summe.
   */
  const zahlartCent = new Map<string, { typ: string; cent: bigint }>();
  for (const z of zahlungen) {
    const vorher = zahlartCent.get(z.zahlartName) ?? { typ: z.zahlartTyp, cent: 0n };
    vorher.cent += zuCentGlobal(z.betrag);
    zahlartCent.set(z.zahlartName, vorher);
  }
  const zahlartSummen: ZahlartSummeZeile[] = [...zahlartCent.entries()].map(
    ([methode, w]) => ({
      zahlartTyp: w.typ,
      zahlartName: methode,
      waehrung: 'EUR',
      betrag: ausCentGlobal(w.cent),
    }),
  );

  /**
   * ⚠️ AUS DEN BELEGEN, JE RICHTUNG UND STEUERSCHLÜSSEL
   *
   * Hier stand eine Abbildung über `closing.vatByTreatment` mit dem festen
   * Geschäftsvorfalltyp `gvTypFuer('VERKAUF')`. Ein Ankauf konnte darin
   * nicht vorkommen: weder der Typ noch die Zahlen kannten ihn. Ein Ankauf
   * über 500,00 EUR stand deshalb in KEINER Tagessumme, während er in
   * `transactions.csv` und `lines.csv` sichtbar war.
   *
   * Die Zeilen entstehen jetzt aus `gvSummen`, das während der Belegschleife
   * aus denselben Positionen gefüllt wird, aus denen auch `transactions_vat`
   * entsteht. Damit gilt: Σ businesscases = Σ transactions, immer.
   *
   * Der aufgezeichnete `umsatzByTreatment` des Abschlusses bleibt daneben
   * bestehen und wird von `closing-export.ts` weiter für den Kopf benutzt; er
   * ist hier nur nicht mehr die Quelle für die Tagesvorfälle.
   */
  const geschaeftsvorfaelle: GeschaeftsvorfallZeile[] = [...gvSummen.values()].map((g) => ({
    gvTyp: g.gvTyp,
    gvName: null,
    agenturId: null,
    ustSchluessel: g.schluessel,
    brutto: ausCentGlobal(g.brutto),
    netto: ausCentGlobal(g.netto),
    ust: ausCentGlobal(g.ust),
  }));

  /**
   * `cash_per_currency.csv` — die BARZAHLUNGEN je Währung.
   *
   * ⚠️ Hier stand der GEZÄHLTE Kassenbestand (`closing.cashCountedEur`).
   * Das ist eine andere Zahl und beantwortet eine andere Frage. Die Datei
   * gehört zur Zahlartenaufstellung: sie muss mit `Z_SE_BARZAHLUNGEN` auf
   * den Cent zusammenfallen, und tat es nicht.
   *
   * Der gezählte Bestand ist damit NICHT mehr im Paket. Das ist eine
   * bewusste, offene Lücke: er gehörte als eigener Geschäftsvorfall
   * `DifferenzSollIst` hinein (DSFinV-K Anhang C), und der braucht den
   * Sollbestand samt Anfangsbestand der Lade. Solange der nicht sauber
   * geführt wird, ist keine Zeile besser als eine erfundene. Der gezählte
   * Bestand steht weiterhin im Kassenbericht.
   */
  const barCentGesamt = zahlungen
    .filter((z) => z.zahlartTyp === 'Bar')
    .reduce((a, z) => a + zuCentGlobal(z.betrag), 0n);
  const kassenlade: KassenladeZeile[] =
    zahlungen.some((z) => z.zahlartTyp === 'Bar')
      ? [{ waehrung: 'EUR', betrag: ausCentGlobal(barCentGesamt) }]
      : [];

  // ⚠️ In GANZEN CENT, nicht mit Gleitkomma. Der erste Entwurf rechnete
  // `Number(b)` und `toFixed(2)` — und `0.1 + 0.2` ist in dieser Arithmetik
  // nicht `0.3`. Auf einem Datenträger, den ein Prüfer gegen die
  // Einzelaufzeichnung stellt, ist ein solcher Cent kein Rundungsfehler,
  // sondern eine Abweichung, die er erklärt haben will.
  //
  // Dieselbe Regel gilt im ganzen Haus: Geld wird in Cent gerechnet und erst
  // zum Schreiben in eine Zeichenkette gebracht.
  // Aus DERSELBEN Quelle wie `payment.csv` und `datapayment.csv`: den
  // Zahlungszeilen der Belege. Drei Zahlen für dieselbe Frage gab es am
  // 05.08.2026 genau deshalb, weil hier eine vierte Quelle stand.
  const summeZahlungenCent = [...zahlartCent.values()].reduce((a, w) => a + w.cent, 0n);
  const barCent = barCentGesamt;

  const abschluss: AbschlussZeile = {
    buchungstag: businessDay,
    taxonomieVersion: mensch.taxonomieVersion || undefined,
    // Der erste und letzte Beleg des Abschlusses.
    startId: receipts[0]?.receiptLocator,
    endeId: receipts[receipts.length - 1]?.receiptLocator,
    name: s.legalName || undefined,
    strasse: s.street || undefined,
    plz: s.postalCode || undefined,
    ort: s.city || undefined,
    land: s.countryCode || undefined,
    stnr: s.taxNumber || undefined,
    ustId: s.vatId || undefined,
    summeZahlungen: ausCentGlobal(summeZahlungenCent),
    summeBarzahlungen: ausCentGlobal(barCent),
  };

  return {
    kopf: { kasseId, erstellung, zNr },
    abschluss,
    belege,
    positionen,
    positionsUst,
    preisfindung,
    belegUst,
    zahlungen,
    tse,
    geschaeftsvorfaelle,
    zahlartSummen,
    kassenlade,
    kasse: {
      brand: cashRegister.brand,
      modell: cashRegister.model,
      seriennummer: mensch.kassenSeriennummer || undefined,
      // Stand hier als 'warehouse14' — landete als KASSE_SW_BRAND in der
      // amtlichen cashregister.csv. Eine Quelle, siehe erzeugnis.ts.
      swBrand: ERZEUGNIS_SOFTWARE_MARKE,
      // Stand hier als `mensch.softwareVersion` roh — und die Route reichte
      // dort den Ersatzwert '1.0.0' herein, weil `APP_VERSION` nirgends
      // gesetzt ist. Jetzt derselbe Weg wie bei der Seriennummer eine Zeile
      // höher: leer bleibt leer, statt still zu einer erfundenen Zahl zu
      // werden. Siehe `kassensoftwareFassung()` oben.
      swVersion: mensch.softwareVersion.trim() || undefined,
      basiswaehrung: 'EUR',
      umrechnung: undefined,
    },
    ort: {
      name: s.legalName || undefined,
      strasse: s.street || undefined,
      plz: s.postalCode || undefined,
      ort: s.city || undefined,
      land: s.countryCode || undefined,
      stnr: s.taxNumber || undefined,
      ustId: s.vatId || undefined,
    },
    // ══════════════════════════════════════════════════════════════════
    //  DIE STEUERSÄTZE — und warum § 25a hier NICHT null Prozent ist
    // ══════════════════════════════════════════════════════════════════
    //
    // ⚠️ Der erste Entwurf schrieb für JEDEN Schlüssel des Beraters `0.00`.
    // Im selben Paket gemessen:
    //
    //     vat.csv        Schlüssel 1001 → 0,00 %
    //     lines_vat.csv  Schlüssel 1001 → 3,19 EUR Umsatzsteuer
    //
    // Die Datei, mit der ein Prüfer die Schlüssel AUFLÖST, widersprach der
    // Belegdatei daneben. § 25a wird mit 19 Prozent auf die MARGE besteuert,
    // nicht mit null.
    //
    // Der Satz ist deshalb eine Angabe des Beraters, kein Vorgabewert: bei
    // § 25a sind es 19 auf die Marge, bei § 13b schuldet der Empfänger, bei
    // § 25c ist es steuerfrei. Welche Zahl in diesem Feld die Buchhaltung
    // trägt, entscheidet er — und bis dahin bleibt sie LEER statt falsch.
    //
    // ── Und warum die Liste dem GEBRAUCH folgt, nicht einer festen Aufzählung
    //
    // ⚠️ Hier standen fest die Schlüssel 1, 2 und 5. Im ersten Paket nach der
    // Berichtigung des Anlagegold-Schlüssels stand dann in `businesscases.csv`
    // ein `UST_SCHLUESSEL=6` — und in `vat.csv`, der Datei, mit der ein Prüfer
    // Schlüssel AUFLÖST, gab es keine 6. Dafür eine 5, die kein Vorgang je
    // benutzt hat.
    //
    // Ein toter Verweis in die Stammdaten. In IDEA, wo diese Dateien
    // zusammengeführt werden, ist das kein Schönheitsfehler: der Umsatz hängt
    // an einem Satz, den die Datei nicht kennt.
    //
    // Eine feste Aufzählung kann das immer wieder. Deshalb wird die Liste jetzt
    // aus den WIRKLICH geschriebenen Schlüsseln gebaut. Ein benutzter Schlüssel
    // kann damit nicht mehr fehlen, und ein unbenutzter steht nicht mehr da.
    ustSchluessel: (() => {
      const benutzt = new Set<string>();
      for (const z of [...positionsUst, ...belegUst]) if (z.ustSchluessel) benutzt.add(z.ustSchluessel);
      for (const g of geschaeftsvorfaelle) if (g.ustSchluessel) benutzt.add(g.ustSchluessel);
      const eigeneNachId = new Map(
        Object.entries(mensch.eigeneUstSchluessel).map(([code, id]) => [id, code] as const),
      );
      return [...benutzt]
        .sort((a, b) => Number(a) - Number(b))
        .map((id) => {
          const fest = UST_STAMM_FEST[id];
          if (fest) return { id, satz: fest.satz, beschreibung: fest.beschreibung };
          const code = eigeneNachId.get(id);
          return {
            id,
            // Satz und Beschreibung eines eigenen Sachverhalts gehören dem
            // Berater. Fehlen sie, bleiben sie LEER statt falsch.
            satz: code === undefined ? '' : (mensch.eigeneUstSaetze?.[code] ?? ''),
            beschreibung: code === undefined ? '' : (mensch.eigeneUstBeschreibungen?.[code] ?? code),
          };
        });
    })(),
    // ══════════════════════════════════════════════════════════════════
    //  DIE SICHERHEITSEINRICHTUNG — eine Zeile je benutzter TSE
    // ══════════════════════════════════════════════════════════════════
    //
    // ⚠️ Vorher fest LEER, während jede Zeile in `transactions_tse.csv` auf
    // eine `TSE_ID` verwies. Ein Prüfer konnte die Signaturen also keiner
    // Sicherheitseinrichtung zuordnen, und das Material zum NACHRECHNEN
    // (öffentlicher Schlüssel, Zertifikat) fehlte ganz.
    //
    // Die Norm sagt zu TSE_ID ausdrücklich: „wird nur zur Referenzierung
    // INNERHALB eines Kassenabschlusses verwendet". Es ist also KEIN
    // globaler Bezeichner, sondern eine laufende Nummer im Paket — deshalb
    // 1, 2, 3 statt der fiskaly-UUID, die vorher dort stand.
    //
    // ── ⛔ SERIENNUMMER UND ÖFFENTLICHER SCHLÜSSEL SIND HEUTE LEER ──────
    //
    // Diese Zeile KANN seit dem 12.08.2026 zwei Quellen lesen: was die
    // Signaturen mitbrachten (`seriennummern`, `oeffentlicheSchluessel`), und
    // hilfsweise, was ein Mensch eingetragen hat. Gemessene Werte gehen vor.
    //
    // ⛔ Am 13.08.2026 gemessen: BEIDE Quellen laufen im Betrieb trocken.
    // Kein Beleg des lebenden Weges nennt einen Wert (die Kette ist an vier
    // Stellen offen, aufgezählt an `DsfinvkTseInput` in `dsfinvk-export.ts`),
    // und `routes/closing-export.ts` gibt auch kein `tseStammdaten` mit. Also
    // sind `TSE_SERIAL` und `TSE_PUBLIC_KEY` NUR bei Belegen von VOR
    // Wanderung 0141 leer — seither senden beide Kassenwege sie mit. Der
    // alte Satz („in JEDEM Paket leer") war am 19.08.2026 nachweislich
    // ueberholt und stand hier trotzdem noch:
    // leer — obwohl die Sicherungseinrichtung beide Werte JEDER Signatur
    // beilegt (gemessen in der Brücke der Kasse,
    // `apps/tauri-pos/src-tauri/src/commands/tse.rs:338` und `:339`).
    //
    // Was der Händler damit erlebt: ein Prüfer liest in `tse.csv` einen
    // Stammsatz ohne Seriennummer und ohne Schlüssel. Er kann die Signaturen
    // aus `transactions_tse.csv` keiner Sicherungseinrichtung zuordnen und
    // keine einzige nachrechnen — und nachtragen kann der Händler es nicht,
    // weil nur das Gerät diese Angaben kennt.
    //
    // Diese Zeile ist damit fertig und wartet auf ihre Zulieferung. Was
    // NIEMAND nennt, bleibt LEER statt erfunden. Gemessen wird der Zustand von
    // `tests/unit/tse-stammdaten-lebender-weg.test.ts` und von
    // `tests/integration/tse-seriennummer-erreicht-das-pruefpaket.test.ts`.
    //
    // ⚠️ TSE_ZEITFORMAT und die beiden Zertifikatsspalten bleiben bewusst am
    // Menschen: die Brücke liefert sie nicht, und eine geratene Angabe wäre
    // eine unwahre Angabe in einem amtlichen Auszug.
    tseStamm: tseIds.map((tssId, i) => ({
      tseId: String(i + 1),
      seriennummer: seriennummern.get(tssId) ?? mensch.tseStammdaten?.[tssId]?.seriennummer,
      signaturAlgorithmus:
        signaturAlgorithmen.get(tssId) ?? mensch.tseStammdaten?.[tssId]?.signaturAlgorithmus,
      zeitformat: mensch.tseStammdaten?.[tssId]?.zeitformat,
      publicKey: oeffentlicheSchluessel.get(tssId) ?? mensch.tseStammdaten?.[tssId]?.publicKey,
      zertifikat: mensch.tseStammdaten?.[tssId]?.zertifikat,
    })),
    referenzen,
  };
}
