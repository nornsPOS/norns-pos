/**
 * kurzcode — der sechsstellige Kennzeichen-Code für das kleine Kapselfähnchen.
 *
 * WOFÜR
 * Auf dem kleinen Etikett (Rückadresse, 17,6 × 40,3 mm bedruckbar) hat ein
 * Code-128-Strichcode nur Platz für wenige Zeichen. Die beiden lebenden
 * Nummern-Erzeuger prägen aber länger:
 *
 *   apps/api-cloud/src/mcp/tools/create-product.ts → `JV-` plus zehn Stellen = 13
 *   apps/mobile/src/warehouse14/ankauf-ui.ts       → `AN-<3>-<4>`            = 11
 *
 * Beide nachgeprüft. Ein 13-stelliger Code wären 178 Module; bei vier
 * Druckpunkten je Modul sind das 60,3 mm auf einem Etikett, das 40,3 mm
 * bedrucken kann. Er passt schlicht nicht. Deshalb trägt das kleine Etikett
 * einen eigenen, kurzen Code — unabhängig davon, wie lang die Artikelnummer
 * gewachsen ist.
 *
 * WAS DIESE DATEI TUT
 * Sie leitet den Kurzcode ab, sie liest einen abgetippten Kurzcode zurück, und
 * sie rechnet die Kollisionswahrscheinlichkeit aus. Sie druckt nicht, sie
 * kennt keine Datenbank und sie stellt keine Eindeutigkeit her — das kann sie
 * nicht, und so zu tun als ob wäre die gefährlichere Lüge.
 *
 * WAS DER AUFRUFER SICHERSTELLEN MUSS
 * Die Ableitung ist ein Streuwert, also kollidiert sie nach dem Schubfachprinzip.
 * Bei 10.000 Stücken liegt die Wahrscheinlichkeit, dass sich irgendwo zwei
 * Stücke denselben Kurzcode teilen, bei rund 4,5 Prozent (siehe
 * `kollisionswahrscheinlichkeit`). Vier Prozent klingen wenig, am Tresen
 * bedeuten sie aber: irgendwann zieht ein Scan das falsche Stück in den Warenkorb.
 * Darum nimmt `kurzcodeAusArtikelnummer` einen `versuch`. Der Aufrufer, der die
 * Datenbank sieht, prüft den Code auf Eindeutigkeit und fragt bei Belegung mit
 * `versuch + 1` erneut. Das bleibt reproduzierbar: gleiche Artikelnummer und
 * gleicher Versuch ergeben immer denselben Code.
 *
 * WARUM DIE SPALTE NICHT LEER IST — ein Fund
 * `create-product.ts` schreibt heute `barcode: sku` mit dem Kommentar, die
 * Artikelnummer SEI der Strichcode. Genau diese Spiegelung ist der Grund,
 * warum das kleine Etikett bisher nicht gedruckt werden konnte: was in
 * `products.barcode` steht, ist immer die volle, zu lange Artikelnummer. Ein
 * Kurzcode verdrängt diese Spiegelung. Diese Datei ändert dort nichts — die
 * Entscheidung, was künftig in der Spalte steht, gehört dem Inhaber.
 *
 * DER LESEPFAD BLEIBT UNBERÜHRT
 * `classifyScanMatch` in `scan-resolve.ts` vergleicht heute schon gegen die
 * Artikelnummer ODER die Strichcode-Spalte. Steht der Kurzcode in dieser
 * Spalte, findet ihn der Scanner ohne eine einzige Änderung am Lesepfad.
 */

/**
 * Das Alphabet: 32 Zeichen, nach Crockford. Ausgeschlossen sind I, L, O und U.
 *
 * WARUM AUSGESCHLOSSEN
 * Wenn der Scanner streikt, tippt jemand den Code vom Papier ab. „O" und die
 * Null, „I" und „l" und die Eins sind auf einem 17,6 mm breiten Thermodruck
 * nicht sicher zu unterscheiden. Ein U fliegt mit, weil es sich als V lesen
 * lässt und weil ein Sechsergriff aus 32 Zeichen sonst gelegentlich ein Wort
 * ergibt, das nicht auf ein Schmuckstück gehört.
 *
 * WARUM AUSGERECHNET 32
 * Nicht 34 und nicht 36. 32 ist eine Zweierpotenz, also fünf Bit je Zeichen.
 * Damit lässt sich ein Streuwert bitweise in Zeichen zerlegen, ohne Rest und
 * ohne Modulo. Bei 34 oder 36 Zeichen wäre der Rest ungleich verteilt: die
 * ersten Zeichen des Alphabets kämen messbar häufiger vor, und ungleich
 * verteilte Codes kollidieren früher als die Rechnung verspricht.
 */
export const kurzcodeAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Sechs Zeichen. Diese Zahl ist eine Entscheidung des Entwurfspanels und keine
 * beiläufige Wahl — sie steht auf der Geometrie des Etiketts:
 *
 *   Code 128 braucht 11 × Zeichen + 35 Module (Start, Prüfsumme, Schluss).
 *   Sechs Zeichen sind 101 Module.
 *   Bei 4 Druckpunkten je Modul (0,33867 mm) sind das 34,205 mm.
 *   Bedruckbar sind 40,287 mm, es bleiben also 3,041 mm Weiss je Seite,
 *   dazu 5,256 mm unbedrucktes Etikettenpapier vor dem Stanzschnitt.
 *   Gefordert sind 10 Module Ruhezone, also 3,387 mm. Faktor 2,45.
 *
 * Sieben Zeichen passten rechnerisch noch aufs Papier, drückten den Faktor
 * aber auf 1,90. Diese Reserve ist nicht Zierde: das Fähnchen liegt um eine
 * Münzkapsel gebogen, und die äussere Papierkante ist dann nicht immer voll
 * sichtbar. Die Prüfung in `kurzcode.test.ts` hält den Faktor fest, damit
 * niemand den Code später still verlängert und die Reserve aufisst.
 */
export const kurzcodeLaenge = 6;

/**
 * KEINE PRÜFZIFFER — und das ist gerechnet, nicht gespart.
 *
 * Eine Prüfziffer kostet eines von sechs Zeichen. Der Coderaum fiele von
 * 32^6 = 1.073.741.824 auf 32^5 = 33.554.432, also auf ein Zweiunddreissigstel.
 * Die Kollisionswahrscheinlichkeit bei 10.000 Stücken stiege damit von
 * 4,5 Prozent auf 77,5 Prozent. Das ist der Preis.
 *
 * Und der Nutzen ist hier fast null. Der Kurzcode wird nicht für sich geprüft,
 * er wird in einem Bestand nachgeschlagen. Ein vertippter Code trifft nur dann
 * ein falsches Stück, wenn er zufällig auf einen belegten Platz fällt — bei
 * 10.000 Stücken in 1,07 Milliarden Plätzen ist das einmal in 107.374 Fällen.
 * Mit Prüfziffer ist es genau derselbe Wert: ein Zweiunddreissigstel der
 * Tippfehler kommt durch die Prüfziffer, und davon trifft wieder nur einer von
 * 3.355 einen belegten Platz. Die Prüfziffer verschiebt den Zeitpunkt der
 * Fehlermeldung, nicht ihre Häufigkeit — sie sagt „Prüfziffer falsch" statt
 * „unbekannt". Dafür siebzehnmal mehr echte Kollisionen zu kaufen, wäre ein
 * schlechtes Geschäft.
 */

/** Die Zeichen, die beim Abtippen dazwischenrutschen: Leerraum, Bindestrich,
 *  Gedankenstrich, Punkt, Schrägstrich, Tiefstrich. Sie werden entfernt. */
const TRENNZEICHEN = /[\s\-\u2013\u2014./_]/gu;

/**
 * Was ein Mensch tippt und was er meint. Nur diese drei Paare, und nur in
 * dieser Richtung: wer „O" tippt, meint die Null; wer „I" oder „l" tippt,
 * meint die Eins. Die Gegenrichtung gibt es nicht, denn 0 und 1 sind gültige
 * Zeichen des Alphabets und dürfen nie zu Buchstaben werden.
 */
const VERWECHSLUNGEN: ReadonlyMap<string, string> = new Map([
  ['O', '0'],
  ['I', '1'],
  ['L', '1'],
]);

/** Das Ergebnis eines abgetippten Kurzcodes. */
export type KurzcodeLesung =
  | { art: 'ok'; kurzcode: string }
  | { art: 'leer'; hinweis: string }
  | { art: 'zeichen'; zeichen: string; hinweis: string }
  | { art: 'laenge'; gelesen: number; hinweis: string };

/**
 * Streuwert einer Zeichenkette: FNV-1a über beide Bytes jeder Code-Einheit,
 * danach die Lawinenstufe aus MurmurHash3. Ohne diese zweite Stufe hängen die
 * oberen Bits von FNV-1a zu eng am letzten Zeichen — zwei Artikelnummern, die
 * sich nur hinten unterscheiden, bekämen dann ähnliche Codes, und der Bestand
 * würde sich in einer Ecke des Coderaums drängen. Alles in 32-Bit-Ganzzahlen
 * über `Math.imul`, damit das Ergebnis auf jeder Maschine dasselbe ist.
 */
function streuwert(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ (c >>> 8), 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/**
 * Der Kurzcode zu einer Artikelnummer.
 *
 * Rein und wiederholbar: dieselbe Artikelnummer und derselbe Versuch ergeben
 * immer denselben Code, heute wie in drei Jahren, auf jeder Kasse. Gross- und
 * Kleinschreibung sowie umschliessender Leerraum der Artikelnummer sind egal,
 * damit `jv-abc` und `JV-ABC ` nicht zu zwei Etiketten für dasselbe Stück führen.
 *
 * `versuch` ist der Ausweg aus einer Kollision: ergibt Versuch 0 einen Code,
 * den der Bestand schon führt, fragt der Aufrufer mit 1 weiter. Der Aufrufer
 * MUSS diese Prüfung machen — diese Datei sieht den Bestand nicht.
 */
export function kurzcodeAusArtikelnummer(artikelnummer: string, versuch = 0): string {
  const basis = artikelnummer.trim().toUpperCase();
  if (basis === '') {
    throw new Error(
      'Ein Kurzcode braucht eine Artikelnummer. Eine leere Nummer ergäbe für jedes ' +
        'Stück denselben Code, und der Scanner zöge am Tresen das falsche Stück in den Korb.',
    );
  }
  if (!Number.isInteger(versuch) || versuch < 0) {
    throw new Error('Der Versuch muss eine ganze Zahl ab null sein.');
  }

  let code = '';
  let runde = 0;
  let vorrat = 0;
  let bitsUebrig = 0;
  for (let i = 0; i < kurzcodeLaenge; i += 1) {
    // Ein Streuwert liefert 30 nutzbare Bit, also sechs Zeichen. Wird der Code
    // je länger, holt die Schleife von selbst einen weiteren Streuwert nach,
    // statt Bits ein zweites Mal zu verwenden — wiederverwendete Bits ergäben
    // sichtbare Muster im Code.
    if (bitsUebrig < 5) {
      vorrat = streuwert(`${basis}#${versuch}:${runde}`) & 0x3fffffff;
      bitsUebrig = 30;
      runde += 1;
    }
    code += kurzcodeAlphabet[vorrat & 31]!;
    vorrat >>>= 5;
    bitsUebrig -= 5;
  }
  return code;
}

/**
 * Einen abgetippten Kurzcode zurücklesen.
 *
 * Kleinbuchstaben werden gross, Trennzeichen fallen weg, und die drei
 * verwechselbaren Zeichen werden auf ihren kanonischen Partner abgebildet.
 * Alles andere ist ein Fehler mit Begründung, kein stilles Weiterlaufen: ein
 * „U" wird NICHT zu „V" geraten. Ein geratenes Zeichen könnte ein anderes,
 * echtes Stück treffen, und das merkt am Tresen niemand.
 */
export function normalisiereKurzcode(eingabe: string): KurzcodeLesung {
  const roh = eingabe.replace(TRENNZEICHEN, '').toUpperCase();
  if (roh === '') {
    return { art: 'leer', hinweis: 'Kein Kurzcode eingegeben.' };
  }

  let code = '';
  for (const zeichen of roh) {
    const kanonisch = VERWECHSLUNGEN.get(zeichen) ?? zeichen;
    if (!kurzcodeAlphabet.includes(kanonisch)) {
      return {
        art: 'zeichen',
        zeichen,
        hinweis: `„${zeichen}" kommt in einem Kurzcode nicht vor. Erlaubt sind Ziffern und Grossbuchstaben ohne I, L, O und U.`,
      };
    }
    code += kanonisch;
  }

  if (code.length !== kurzcodeLaenge) {
    return {
      art: 'laenge',
      gelesen: code.length,
      hinweis: `Ein Kurzcode hat ${kurzcodeLaenge} Zeichen, gelesen wurden ${code.length}.`,
    };
  }
  return { art: 'ok', kurzcode: code };
}

/** Kurz und bündig: ist das ein fertiger, gültiger Kurzcode? */
export function istKurzcode(eingabe: string): boolean {
  return normalisiereKurzcode(eingabe).art === 'ok';
}

/**
 * Der Kurzcode für das menschliche Auge, in zwei Dreiergruppen: „K7B 3M9".
 * Sechs Zeichen am Stück liest niemand fehlerfrei ab; drei und drei schon.
 * Das Leerzeichen fällt beim Zurücklesen wieder weg.
 */
export function kurzcodeAnzeige(kurzcode: string): string {
  const lesung = normalisiereKurzcode(kurzcode);
  const code = lesung.art === 'ok' ? lesung.kurzcode : kurzcode;
  const mitte = Math.ceil(code.length / 2);
  return `${code.slice(0, mitte)} ${code.slice(mitte)}`.trim();
}

/**
 * Wie wahrscheinlich ist es, dass sich unter `anzahl` Stücken irgendwo zwei
 * denselben Kurzcode teilen? Das Geburtstagsproblem, in der geschlossenen Form
 *
 *   p = 1 − e^(−k(k−1) / 2N)
 *
 * mit N gleich der Grösse des Coderaums. Die exakte Form wäre ein Produkt über
 * k Faktoren; bei k weit unter N stimmen beide auf mehr Stellen überein, als
 * hier je gebraucht werden, und die Prüfung weist das nach.
 *
 * Diese Funktion steht hier nicht als Zierde. Sie gehört in die Oberfläche:
 * wächst der Bestand, soll die Kasse sagen können, wie eng es im Coderaum wird.
 */
export function kollisionswahrscheinlichkeit(
  anzahl: number,
  coderaum = kurzcodeAlphabet.length ** kurzcodeLaenge,
): number {
  if (!Number.isFinite(anzahl) || anzahl < 2) return 0;
  if (anzahl > coderaum) return 1;
  return 1 - Math.exp((-anzahl * (anzahl - 1)) / (2 * coderaum));
}
