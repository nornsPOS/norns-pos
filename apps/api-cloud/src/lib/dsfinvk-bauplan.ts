/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER ERZEUGER BEKOMMT SEINE SPALTEN AUS DER NORM, NICHT AUS DEM KOPF
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bis zum 28.07.2026 schrieb `dsfinvk-export.ts` jede Kopfzeile von Hand:
 *
 *     const header = ['Z_KASSE_ID', 'Z_NR', 'BON_ID', …];
 *
 * Fünf der acht Dateien trugen damit Namen, die die Taxonomie nicht kennt
 * (`bon_kopf.csv`, `bon_pos.csv`, …), und in den anderen fehlten Spalten. Der
 * Test daneben verglich dieselben von Hand geschriebenen Namen mit sich
 * selbst und konnte deshalb nie rot werden.
 *
 * ── Was sich umkehrt ────────────────────────────────────────────────────
 *
 * Ab jetzt kommt die Spaltenliste aus `index.xml`, der amtlichen Beschreibung
 * aus dem BZSt-Paket. Der Erzeuger füllt nur noch WERTE, und zwar je Spalte
 * NAMENTLICH. Damit kann die Kopfzeile nicht mehr falsch sein — sie wird gar
 * nicht mehr geschrieben, sondern abgeleitet.
 *
 * Und was dabei sichtbar wird, war vorher unsichtbar: **eine Spalte, für die
 * es keinen Wert gibt, ist jetzt eine LÜCKE mit Namen.** Vorher fehlte sie
 * einfach, und niemand konnte sie vermissen.
 *
 * ── Die Regel für fehlende Werte ────────────────────────────────────────
 *
 * Leer. Nicht geraten, nicht mit einem Platzhalter, nicht mit einer Null.
 *
 * Eine Null in einem Betragsfeld ist eine AUSSAGE („es wurde nichts
 * eingenommen"), kein Fehlen. Ein erfundener Ländercode ist eine Anschrift,
 * die niemand eingegeben hat. Beides steht dann in einer
 * fortschreibungsgeschützten Aufzeichnung.
 */

import type { TaxonomieTabelle } from './dsfinvk-taxonomie.js';

/**
 * Wie ein einzelnes Feld gefüllt wird.
 *
 * `undefined` heisst: für diese Spalte gibt es in diesem Haus keinen Wert.
 * Sie bleibt leer, und das ist eine ehrliche Aussage.
 */
export type Fueller<Z> = (zeile: Z) => string | undefined;

/** Die Zuordnung Spaltenname → Wert, für eine Tabelle. */
export type Zuordnung<Z> = Readonly<Record<string, Fueller<Z>>>;

/** Ein Feld für CSV einfassen: nur wenn nötig, und dann nach der Norm. */
function fasseEin(wert: string, t: TaxonomieTabelle): string {
  const { spaltentrenner, texteinfassung } = t.format;
  const brauchtEinfassung =
    wert.includes(spaltentrenner) ||
    wert.includes(texteinfassung) ||
    wert.includes('\r') ||
    wert.includes('\n');
  if (!brauchtEinfassung) return wert;
  const e = texteinfassung;
  return e + wert.split(e).join(e + e) + e;
}

/**
 * Eine Zahl nach der Norm schreiben.
 *
 * ⚠️ DEZIMALKOMMA, nicht Punkt. Die `index.xml` sagt `<DecimalSymbol>,`, und
 * sie ist dieselbe Datei, mit der ein Prüfwerkzeug unsere Zahlen einliest.
 * Der Erzeuger schrieb bis heute Punkte — damit beschrieb die mitgelieferte
 * Beschreibung JEDEN Betrag des Pakets falsch.
 *
 * Kein Tausendertrennzeichen: die Norm nennt zwar eines, aber die
 * Beispieldateien setzen es nicht, und ein Trenner in einer Zahl ist eine
 * Fehlerquelle ohne Gegenwert.
 */
export function zahl(wert: string | number | null | undefined, nachkomma: number): string {
  if (wert === null || wert === undefined || wert === '') return '';
  const roh = typeof wert === 'number' ? wert.toFixed(nachkomma) : wert.trim();
  if (!/^-?\d+(\.\d+)?$/.test(roh)) return '';
  const negativ = roh.startsWith('-');
  const ohne = negativ ? roh.slice(1) : roh;
  const [ganz = '0', bruch = ''] = ohne.split('.');
  const gefuellt = (bruch + '0'.repeat(nachkomma)).slice(0, nachkomma);
  return `${negativ ? '-' : ''}${ganz}${nachkomma > 0 ? ',' + gefuellt : ''}`;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE FELDLÄNGE DER NORM WIRD EINGEHALTEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die `index.xml` nennt zu jedem Textfeld eine `MaxLength`. Der Leser holt
 * sie, und der Erzeuger warf sie bisher weg.
 *
 * Das ist keine Formalie: das Prüfwerkzeug liest die Beschreibung, die im
 * SELBEN ZIP liegt, und weist den Datenträger wegen einer Feldüberlänge
 * zurück. Ein Schmuckname mit Punzenbeschreibung sprengt `ARTIKELTEXT`
 * (60 Zeichen) ohne Weiteres.
 *
 * ⚠️ Gekürzt wird nur, wo die Norm eine Länge NENNT, und nur bei Textfeldern.
 * Eine Zahl zu kürzen wäre eine Fälschung — sie ist entweder darstellbar oder
 * der Wert gehört nicht dorthin.
 */
/**
 * ⛔ GEKUERZT WIRD AN DER ZEICHENGRENZE, NICHT AN DER BYTEGRENZE
 * (19.08.2026, Fund der boeswilligen Pruefung).
 *
 * JavaScript zaehlt eine Zeichenkette in UTF-16-Einheiten. Ein Emoji
 * (etwa der Ring 💍) belegt ZWEI davon — ein Surrogatpaar. Faellt die
 * Kuerzung genau zwischen die beiden Haelften, entsteht eine halbe
 * Zeichenkette: ein einzelnes Surrogat, das kein gueltiges Unicode mehr
 * ist. Was daraus in einer CSV landet, kann ein Pruefwerkzeug abweisen,
 * und niemand am Tresen versteht warum — der Produktname sah normal aus.
 *
 * `[...text]` zerlegt nach ZEICHEN (Codepoints), nicht nach Einheiten;
 * damit faellt der Schnitt nie mitten in ein Zeichen.
 */
export function kuerzeAufZeichen(text: string, hoechstens: number): string {
  if (text.length <= hoechstens) return text;
  const zeichen = [...text];
  if (zeichen.length <= hoechstens) return text;
  return zeichen.slice(0, hoechstens).join('');
}

function kuerzeAufFeldlaenge(spalte: { art: 'text' | 'zahl'; laenge: number | null }, wert: string): string {
  if (spalte.art !== 'text' || spalte.laenge === null) return wert;
  return kuerzeAufZeichen(wert, spalte.laenge);
}

/**
 * Eine Tabelle bauen: Kopfzeile aus der Norm, Datenzeilen aus der Zuordnung.
 *
 * Wirft, wenn die Zuordnung eine Spalte NICHT kennt. Das ist Absicht: eine
 * stillschweigend leere Spalte wäre genau der Zustand, den diese Umstellung
 * beendet. Wer eine Spalte nicht füllen kann, schreibt das ausdrücklich hin
 * (`() => undefined`) — dann steht die Lücke im Quelltext und ist auffindbar.
 */
export function baueTabelle<Z>(
  t: TaxonomieTabelle,
  zeilen: readonly Z[],
  zuordnung: Zuordnung<Z>,
): string {
  const unbekannt = t.spalten.map((s) => s.name).filter((n) => !(n in zuordnung));
  if (unbekannt.length > 0) {
    throw new Error(
      `DSFinV-K ${t.datei}: für diese Spalten ist nicht festgelegt, woher ihr Wert kommt: ` +
        `${unbekannt.join(', ')}. Jede Spalte braucht einen Eintrag, auch wenn er ` +
        `\`() => undefined\` lautet, damit die Lücke im Quelltext steht.`,
    );
  }

  const zeilenTexte = zeilen.map((z) =>
    t.spalten
      .map((s) => fasseEin(kuerzeAufFeldlaenge(s, (zuordnung[s.name] as Fueller<Z>)(z) ?? ''), t))
      .join(t.format.spaltentrenner),
  );

  return [t.spalten.map((s) => s.name).join(t.format.spaltentrenner), ...zeilenTexte].join(
    t.format.zeilentrenner,
  ) + t.format.zeilentrenner;
}
