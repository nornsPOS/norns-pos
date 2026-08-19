/**
 * Die amtlichen Beschreibungsdateien, aus dem Erzeugnis gelesen.
 *
 * ⚠️ Sie gehören IN das ausgelieferte Paket. Ein DSFinV-K-Datenträger besteht
 * nicht nur aus den CSV-Dateien: `index.xml` beschreibt sie für das
 * Prüfwerkzeug, und die DTD beschreibt die `index.xml`. Ohne beide kann ein
 * Prüfer den Datenträger nicht einlesen.
 *
 * Herkunft und Prüfsummen: siehe `src/fiskal/dsfinvk-2.4/HERKUNFT.md`.
 */

import { existsSync, readFileSync } from 'node:fs';

/**
 * ⚠️ DER FUND VOM 02.08.2026, UND ER IST DER TEUERSTE DES TAGES.
 *
 * Hier stand genau eine Zeile:
 *
 *     readFileSync(new URL(`../fiskal/dsfinvk-2.4/${name}`, import.meta.url))
 *
 * Im Baum stimmt der Pfad. Im AUSGELIEFERTEN Paket nicht.
 *
 * Der Motor reist als ein einziges gebündeltes `start.mjs` mit, und dort zeigt
 * `import.meta.url` auf `resources/sidecar/start.mjs`. Der Pfad `../fiskal/…`
 * landet also neben dem Sidecar-Ordner, und dort liegt nichts: gemessen im
 * gebauten Paket vom 02.08. gibt es KEINE einzige `index.xml`.
 *
 * Was das am Tresen bedeutet: der Prüfer steht im Laden, der Händler drückt
 * den Knopf für die Kassennachschau, und der Export bricht ab. Genau der Fall,
 * der Bussgeld kostet und den Ruf zerstört. Ein Datenträger ohne `index.xml`
 * ist für das Prüfwerkzeug ausserdem gar nicht einlesbar.
 *
 * Deshalb wird jetzt an MEHREREN Orten gesucht, vom ausgelieferten zuerst, und
 * das Fehlen wird zu einem SATZ statt zu einem rohen Systemfehler.
 */
const ORTE = (name: string): URL[] => [
  // 1. Neben dem gebündelten Motor: `resources/sidecar/fiskal/dsfinvk-2.4/…`.
  //    Das ist der Ort im ausgelieferten Paket.
  new URL(`./fiskal/dsfinvk-2.4/${name}`, import.meta.url),
  // 2. Der Ort im Baum und im gebauten `dist`.
  new URL(`../fiskal/dsfinvk-2.4/${name}`, import.meta.url),
  // 3. Eine Ebene höher, falls der Motor einmal tiefer wandert.
  new URL(`../../fiskal/dsfinvk-2.4/${name}`, import.meta.url),
];

/**
 * Die amtliche Datei lesen, oder mit einem Satz anhalten, den ein Mensch
 * versteht.
 *
 * Ein roher `ENOENT` wäre hier das Schlimmste: der Händler steht mit dem
 * Prüfer da und liest einen Dateipfad.
 */
const lies = (name: string): string => {
  for (const ort of ORTE(name)) {
    try {
      if (existsSync(ort)) return readFileSync(ort, 'utf8');
    } catch {
      // Nächsten Ort versuchen.
    }
  }
  throw new Error(
    `Die amtliche Beschreibungsdatei „${name}" der DSFinV-K liegt nicht bei dieser ` +
      'Kasse. Ohne sie lässt sich kein Prüferpaket erzeugen, denn sie beschreibt ' +
      'dem Prüfwerkzeug die Dateien. Das ist ein Fehler der Auslieferung, nicht ' +
      'Ihrer Eingabe: bitte die Kasse neu einspielen.',
  );
};

/** Die amtliche `index.xml` als Text — Quelle der Spaltendefinitionen. */
export function amtlicheTaxonomie(): string {
  return lies('index.xml');
}

/**
 * Die Fassung der DSFinV-K, nach der dieses Paket gebaut ist.
 *
 * ── DER FUND VOM 04.08.2026, AN EINEM ECHTEN EXPORT GEMESSEN ──────────────
 *
 * ⚠️ `cashpointclosing.csv` trug TAXONOMIE_VERSION LEER. Die Route las den
 * Einstellungsschlüssel `dsfinvk.taxonomie_version`, und den konnte niemand
 * schreiben: er stand in keiner Positivliste, in keiner Saat, auf keiner
 * Fläche. Also war er IMMER leer, in jedem je erzeugten Paket.
 *
 * Ein Prüfwerkzeug entscheidet an diesem Feld, nach welcher Fassung es die
 * Dateien liest. Leer heisst: es rät oder lehnt ab.
 *
 * ⚠️ Und es war die falsche Frage. Nach welcher Fassung dieses Paket gebaut
 * ist, weiss nicht der Steuerberater, sondern DIESE KASSE: es ist die
 * Beschreibungsdatei, die mit ihr ausgeliefert wird. Deshalb kommt der Wert
 * jetzt von dort und nicht aus einer Eingabe.
 */
export const DSFINVK_FASSUNG = '2.4';

/**
 * Die zwei Beschreibungsdateien, wie sie ins Paket gehören.
 *
 * ⚠️ `DataSupplier` wird gefüllt. Die amtliche Vorlage lässt ihn leer, weil
 * sie eine VORLAGE ist — der Steuerpflichtige trägt sich dort ein. Ein
 * ausgeliefertes Paket mit leerem `DataSupplier` ist ein Datenträger ohne
 * Absender: der Prüfer sieht Zahlen, aber nicht, wessen Zahlen.
 *
 * Nur der NAME wird gesetzt; die übrigen Knoten der Vorlage bleiben, wie sie
 * sind. Ein Eingriff, der mehr ändert, wäre eine eigene index.xml — und dann
 * misst der Wächter nicht mehr die amtliche.
 */
export function amtlicheBeschreibung(haendler?: {
  name?: string;
  ort?: string;
}): { name: string; content: string }[] {
  let index = lies('index.xml');

  if (haendler?.name && haendler.name.trim() !== '') {
    index = index.replace(
      '<Name />',
      `<Name>${entschaerfe(haendler.name)}</Name>`,
    );
  }
  if (haendler?.ort && haendler.ort.trim() !== '') {
    index = index.replace(
      '<Location />',
      `<Location>${entschaerfe(haendler.ort)}</Location>`,
    );
  }

  return [
    { name: 'index.xml', content: index },
    { name: 'gdpdu-01-09-2004.dtd', content: lies('gdpdu-01-09-2004.dtd') },
  ];
}

/** XML-Sonderzeichen entschärfen — ein Firmenname darf ein `&` enthalten. */
function entschaerfe(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
