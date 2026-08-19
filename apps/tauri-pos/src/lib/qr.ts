/**
 * Ein QR-Code, selbst gerechnet.
 *
 * WARUM OHNE FREMDE BIBLIOTHEK
 * Die Vorschau des Belegs zeigte an der Stelle des QR-Codes einen leeren Kasten
 * mit dem Wort „QR-Code (wird gedruckt)". Der echte Code entsteht erst im
 * Drucker (ESC/POS `GS ( k`), also konnte niemand VOR dem Druck sehen, ob er
 * an der richtigen Stelle sitzt, ob er zu gross ist, ob er passt. Basel:
 * „الفاتورة لما تنطبع تحتاج تحسينات … وتوليد QR كود".
 *
 * Der Algorithmus ist festgeschrieben (ISO/IEC 18004) und ändert sich nie. Eine
 * Abhängigkeit dafür in eine Kasse zu holen, die jahrelang unverändert laufen
 * soll, wäre eine dauerhafte Verpflichtung für eine einmalige Rechnung.
 *
 * WAS DIESER ZEICHNER KANN
 *   • Byte-Modus (UTF-8), Fehlerkorrektur M — genau das, was ein TSE-Bezug
 *     braucht.
 *   • Alphanumerik-Modus (Grossbuchstaben, Ziffern und `$%*+-./:`) — zwei
 *     Zeichen in elf Bit statt zweimal acht. Siehe den Absatz darunter.
 *   • Versionen 1 bis 20 (bis 666 Zeichen bei Stufe M). Ein DSFinV-K-Bezug
 *     liegt weit darunter.
 *   • Alle acht Masken, bewertet nach den vier Straftabellen der Norm — ein
 *     fest gewählter Maskentyp erzeugt Codes, die manche Lesegeräte nicht
 *     mögen.
 *
 * WARUM DER ALPHANUMERIK-MODUS DAZUKAM (26.07.2026)
 * Auf dem kleinen Etikett (Rückadresse, 17,6 × 40,3 mm bedruckbar) ist der QR
 * kein Beiwerk mehr, sondern ein tragender Code: er bekommt genau 100
 * Druckpunkte Kantenlänge, also 8,467 mm. Jede Version mehr bedeutet vier
 * Module mehr auf derselben Fläche und damit kleinere Punkte. Der Verweis
 * `HTTPS://WAREHOUSE14.DE/P/MZ-0042` sind 31 Zeichen: im Byte-Modus 248 Bit
 * plus Kopf, das reicht nicht in Version 2 (Stufe M, 224 Datenbit) und fällt
 * auf Version 3. Im Alphanumerik-Modus sind es 11 × 15 + 6 = 171 Bit plus
 * Kopf, und Version 2 trägt es bequem. Weil jedes Modul ein ganzzahliges
 * Vielfaches eines Druckpunkts sein muss (0,08467 mm), heisst das am Tresen:
 * Version 2 sind 25 Module zu 4 Punkten (0,33867 mm), Version 3 wären 29
 * Module, die in dieselben 100 Punkte nur zu 3 Punkten passen (0,254 mm). Der
 * Alphanumerik-Modus kauft dem kleinen Etikett also ein Drittel mehr
 * Modulbreite — ohne eine kurze Netzadresse kaufen zu müssen.
 *
 * ⚠ DER MODUS WIRD GEWÄHLT, NICHT ERZWUNGEN. Diese Datei schreibt den Text
 * NIEMALS selbst in Grossbuchstaben um. Für den Rechnernamen einer Netzadresse
 * wäre das gleichwertig (RFC 4343), für den PFAD dahinter ist es das NICHT: ein
 * Server darf `/p/mz-0042` und `/P/MZ-0042` als zwei verschiedene Dinge
 * ansehen. Wer einen alphanumerikfähigen Verweis will, muss ihn schon
 * alphanumerikfähig übergeben — `alphanumerikTauglich` sagt vorher, ob er es
 * ist.
 *
 * WAS ER NICHT KANN, UND WARUM DAS IN ORDNUNG IST
 * Kein reiner Zahlenmodus (der spart gegenüber Alphanumerik nur bei langen
 * Ziffernketten, die hier nicht vorkommen), keine Stufen L/Q/H, keine Version
 * über 20. Jede dieser Grenzen wirft einen ehrlichen Fehler, statt still etwas
 * Falsches zu zeichnen.
 */

// ── Galois-Feld GF(256) für die Reed-Solomon-Rechnung ────────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // das Generatorpolynom der Norm
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] as number;
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number;
}

/**
 * Das Generatorpolynom für `grad` Fehlerkorrekturbytes, in FALLENDER Ordnung:
 * `[1, g1, …, gn]`, also der führende Koeffizient zuerst.
 *
 * ⚠ Die Ordnung ist der ganze Punkt dieses Kommentars. Innerhalb der Schleife
 * wird STEIGEND gerechnet (`poly[k]` ist der Koeffizient von x^k), weil das
 * Multiplizieren mit x dann ein schlichtes Verschieben nach oben ist. Die
 * Division in `fehlerbytes` braucht aber die fallende Ordnung. Am 25.07.2026
 * fehlte hier genau die letzte Zeile, und das Ergebnis war ein QR-Code, der
 * strukturell tadellos aussah — Sucherkreuze, Taktlinien, gültiges
 * Formatzeichen — und den KEIN Lesegerät entziffern konnte. Nur der Vergleich
 * mit einem veröffentlichten Vektor hat es gezeigt.
 */
export function generator(grad: number): number[] {
  let poly = [1];
  for (let i = 0; i < grad; i += 1) {
    const naechste = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      naechste[j] = (naechste[j] as number) ^ mul(poly[j] as number, EXP[i] as number);
      naechste[j + 1] = (naechste[j + 1] as number) ^ (poly[j] as number);
    }
    poly = naechste;
  }
  return poly.reverse();
}

/**
 * Die Fehlerkorrekturbytes eines Datenblocks: der Rest der Polynomdivision
 * durch das Generatorpolynom.
 *
 * Bewusst in der ANSCHAULICHEN Form geschrieben — Nachricht um `anzahl` Nullen
 * verlängert, dann Stelle für Stelle abdividieren — und nicht als
 * Schieberegister. Die kurze Fassung ist zwei Zeilen sparsamer und war am
 * 25.07.2026 der Ort, an dem sich ein Ordnungsfehler des Generatorpolynoms
 * verstecken konnte. Ein Rest, der falsch ist, sieht genauso zufällig aus wie
 * einer, der stimmt.
 */
export function fehlerbytes(daten: readonly number[], anzahl: number): number[] {
  const gen = generator(anzahl);
  const werk = [...daten, ...new Array<number>(anzahl).fill(0)];
  for (let i = 0; i < daten.length; i += 1) {
    const koeffizient = werk[i] as number;
    if (koeffizient === 0) continue;
    for (let j = 1; j <= anzahl; j += 1) {
      werk[i + j] = (werk[i + j] as number) ^ mul(gen[j] as number, koeffizient);
    }
  }
  return werk.slice(daten.length);
}

/**
 * Je Version (1 bis 20) bei Stufe M: [Datenbytes gesamt, EK-Bytes je Block,
 * Blöcke Gruppe 1, Blöcke Gruppe 2].
 * Aus Tabelle 9 der Norm. Gruppe 2 hat je ein Datenbyte mehr als Gruppe 1.
 */
const M_TABELLE: readonly (readonly [number, number, number, number])[] = [
  [16, 10, 1, 0], // 1
  [28, 16, 1, 0], // 2
  [44, 26, 1, 0], // 3
  [64, 18, 2, 0], // 4
  [86, 24, 2, 0], // 5
  [108, 16, 4, 0], // 6
  [124, 18, 4, 0], // 7
  [154, 22, 2, 2], // 8
  [182, 22, 3, 2], // 9
  [216, 26, 4, 1], // 10
  [254, 30, 1, 4], // 11
  [290, 22, 6, 2], // 12
  [334, 22, 8, 1], // 13
  [365, 24, 4, 5], // 14
  [415, 24, 5, 5], // 15
  [453, 28, 7, 3], // 16
  [507, 28, 10, 1], // 17
  [563, 26, 9, 4], // 18
  [627, 26, 3, 11], // 19
  [669, 26, 3, 13], // 20
];

/**
 * Die Lage der Ausrichtungsmuster je Version (Anhang E der Norm), Feld 0 ist
 * Version 1.
 *
 * ⚠ Die Tabelle der Norm BEGINNT BEI VERSION 2 — Version 1 hat keine
 * Ausrichtungsmuster. Wer sie eins zu eins abschreibt und vorne eine leere
 * Zeile für Version 1 ergänzt, muss GENAU EINE ergänzen. Am 25.07.2026 standen
 * hier zwei, und damit war ab Version 2 jedes Muster an der Stelle der
 * VORIGEN Version. Version 1 (bis 13 Bytes) las sich einwandfrei zurück, alles
 * darüber gar nicht — ein Fehler, den nur ein echtes Lesegerät zeigt, weil das
 * Bild in beiden Fällen wie ein QR-Code aussieht.
 */
const AUSRICHTUNG: readonly (readonly number[])[] = [
  [], // 1 — ohne
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], // 2 bis 6
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], // 7 bis 10
  [6, 30, 54], [6, 32, 58], [6, 34, 62], // 11 bis 13
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], // 14 bis 16
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], // 17 bis 20
];

/** Vorgerechnete Formatzeichen für Stufe M, Maske 0 bis 7 (Tabelle C.1). */
const FORMAT_M: readonly number[] = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

/** Vorgerechnete Versionszeichen ab Version 7 (Tabelle D.1). */
const VERSION_BITS: Readonly<Record<number, number>> = {
  7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3, 11: 0x0bbf6, 12: 0x0c762,
  13: 0x0d847, 14: 0x0e60d, 15: 0x0f928, 16: 0x10b78, 17: 0x1145d, 18: 0x12a17,
  19: 0x13532, 20: 0x149a6,
};

/**
 * Die Zeichentabelle des Alphanumerik-Modus (Tabelle 5 der Norm). Die Stelle
 * IST der Wert: „A" ist 10, das Leerzeichen 36, der Doppelpunkt 44.
 *
 * ⚠ Genau 45 Zeichen, und die Reihenfolge der Satzzeichen am Ende ist die der
 * Norm, nicht die von ASCII. Wer sie nach ASCII sortiert, baut einen Code, der
 * strukturell tadellos ist und beim Zurücklesen andere Zeichen liefert.
 */
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/**
 * Passt der Text vollständig in die Alphanumerik-Tabelle?
 *
 * Wer einen QR-Verweis entwirft, kann damit VOR dem Zeichnen fragen, ob seine
 * Schreibweise den dichteren Modus erlaubt. Leerer Text zählt nicht: dafür gibt
 * es keinen sinnvollen Code.
 */
export function alphanumerikTauglich(text: string): boolean {
  if (text.length === 0) return false;
  for (const zeichen of text) {
    if (!ALNUM.includes(zeichen)) return false;
  }
  return true;
}

/** Welcher Modus einen Text trägt. */
export type QrModus = 'alphanumerik' | 'byte';

/**
 * Die Breite des Zeichenzählers hinter dem Moduskopf.
 *
 * ⚠ Sie hängt von BEIDEM ab, Modus UND Versionsbereich (Tabelle 3 der Norm).
 * Byte: 8 Bit bis Version 9, danach 16. Alphanumerik: 9 Bit bis Version 9,
 * danach 11 (ab Version 27 wären es 13, so weit gehen wir nicht). Ein einziges
 * Bit zu wenig oder zu viel verschiebt ALLE folgenden Daten, und der Code sieht
 * dabei völlig normal aus.
 */
function zaehlerBits(modus: QrModus, version: number): number {
  if (modus === 'byte') return version < 10 ? 8 : 16;
  return version < 10 ? 9 : 11;
}

export interface QrGitter {
  /** Kantenlänge in Modulen. */
  groesse: number;
  /** `true` = dunkles Modul. Zeilenweise, Länge `groesse * groesse`. */
  module: boolean[];
  /** Welche Version gewählt wurde. Für Prüfungen und Fehlermeldungen. */
  version: number;
  /** Welcher Modus den Text getragen hat. Für Prüfungen und den Bauplan. */
  modus: QrModus;
}

/**
 * Den Text als QR-Gitter rechnen (Stufe M).
 *
 * Der Modus wird selbst gewählt: passt der Text vollständig in die
 * Alphanumerik-Tabelle, trägt ihn der dichtere Modus, sonst der Byte-Modus.
 * Der Text selbst bleibt dabei unangetastet — siehe den Kopf dieser Datei.
 *
 * Wirft, wenn der Text nicht in Version 20 passt — lieber ein ehrlicher Fehler
 * als ein Code, den kein Lesegerät entziffert.
 */
export function qrGitter(text: string): QrGitter {
  const modus: QrModus = alphanumerikTauglich(text) ? 'alphanumerik' : 'byte';
  const daten = Array.from(new TextEncoder().encode(text));
  const zeichen = modus === 'alphanumerik' ? Array.from(text) : [];

  // Wie viele Bit die reinen Nutzdaten belegen — ohne Kopf und Zähler, die
  // hängen ja noch von der Version ab.
  const nutzBits =
    modus === 'alphanumerik'
      ? 11 * Math.floor(zeichen.length / 2) + 6 * (zeichen.length % 2)
      : daten.length * 8;

  // Die kleinste Version, in die Kopf, Zähler und Daten passen.
  let version = 0;
  for (let v = 1; v <= 20; v += 1) {
    const [kapazitaet] = M_TABELLE[v - 1] as readonly [number, number, number, number];
    const noetig = Math.ceil((4 + zaehlerBits(modus, v) + nutzBits) / 8);
    if (noetig <= kapazitaet) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    const menge = modus === 'alphanumerik' ? `${zeichen.length} Zeichen` : `${daten.length} Bytes`;
    throw new Error(
      `QR: ${menge} passen nicht in Version 20 (Stufe M). Kein Code ist besser als ein unlesbarer.`,
    );
  }

  const [kapazitaet, ekProBlock, blockG1, blockG2] = M_TABELLE[version - 1] as readonly [
    number,
    number,
    number,
    number,
  ];

  // ── Bitstrom: Moduskopf, Zähler, Nutzdaten, Abschluss, Füllung ─────────────
  const bits: number[] = [];
  const schiebe = (wert: number, anzahl: number): void => {
    for (let i = anzahl - 1; i >= 0; i -= 1) bits.push((wert >> i) & 1);
  };
  if (modus === 'alphanumerik') {
    schiebe(0b0010, 4);
    schiebe(zeichen.length, zaehlerBits('alphanumerik', version));
    // Paarweise: der erste Wert ist die HÖHERWERTIGE Stelle zur Basis 45.
    // Ein einzelnes Restzeichen am Ende bekommt sechs Bit, nicht elf.
    let i = 0;
    for (; i + 1 < zeichen.length; i += 2) {
      const a = ALNUM.indexOf(zeichen[i] as string);
      const b = ALNUM.indexOf(zeichen[i + 1] as string);
      schiebe(a * 45 + b, 11);
    }
    if (i < zeichen.length) schiebe(ALNUM.indexOf(zeichen[i] as string), 6);
  } else {
    schiebe(0b0100, 4);
    schiebe(daten.length, zaehlerBits('byte', version));
    for (const b of daten) schiebe(b, 8);
  }
  // Abschluss: bis zu vier Nullen, aber nie über die Kapazität hinaus.
  for (let i = 0; i < 4 && bits.length < kapazitaet * 8; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | (bits[i + j] as number);
    bytes.push(b);
  }
  // Füllbytes der Norm, abwechselnd.
  const FUELL = [0xec, 0x11];
  for (let i = 0; bytes.length < kapazitaet; i += 1) bytes.push(FUELL[i % 2] as number);

  // ── In Blöcke teilen, je Block die Fehlerkorrektur rechnen ─────────────────
  const bloecke = blockG1 + blockG2;
  const g1Laenge = Math.floor(kapazitaet / bloecke);
  const datenBloecke: number[][] = [];
  const ekBloecke: number[][] = [];
  let ort = 0;
  for (let i = 0; i < bloecke; i += 1) {
    const laenge = i < blockG1 ? g1Laenge : g1Laenge + 1;
    const block = bytes.slice(ort, ort + laenge);
    ort += laenge;
    datenBloecke.push(block);
    ekBloecke.push(fehlerbytes(block, ekProBlock));
  }

  // Verschränken: Spalte für Spalte über alle Blöcke.
  const strom: number[] = [];
  const maxDaten = Math.max(...datenBloecke.map((b) => b.length));
  for (let i = 0; i < maxDaten; i += 1) {
    for (const block of datenBloecke) if (i < block.length) strom.push(block[i] as number);
  }
  for (let i = 0; i < ekProBlock; i += 1) {
    for (const block of ekBloecke) strom.push(block[i] as number);
  }

  // ── Das Gitter aufbauen ────────────────────────────────────────────────────
  const groesse = version * 4 + 17;
  const module: (boolean | null)[] = new Array(groesse * groesse).fill(null);
  const reserviert: boolean[] = new Array(groesse * groesse).fill(false);
  const setze = (x: number, y: number, dunkel: boolean, fest = true): void => {
    module[y * groesse + x] = dunkel;
    if (fest) reserviert[y * groesse + x] = true;
  };

  // Sucherkreuze samt Trennlinie.
  const sucher = (ox: number, oy: number): void => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const px = ox + x;
        const py = oy + y;
        if (px < 0 || py < 0 || px >= groesse || py >= groesse) continue;
        const imRing = (x >= 0 && x <= 6 && (y === 0 || y === 6)) || (y >= 0 && y <= 6 && (x === 0 || x === 6));
        const imKern = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        setze(px, py, imRing || imKern);
      }
    }
  };
  sucher(0, 0);
  sucher(groesse - 7, 0);
  sucher(0, groesse - 7);

  // Taktlinien.
  for (let i = 8; i < groesse - 8; i += 1) {
    setze(i, 6, i % 2 === 0);
    setze(6, i, i % 2 === 0);
  }

  // Ausrichtungsmuster, ausser wo sie ein Sucherkreuz überdecken.
  const orte = AUSRICHTUNG[version - 1] as readonly number[];
  for (const cy of orte) {
    for (const cx of orte) {
      const beiSucher =
        (cx <= 8 && cy <= 8) || (cx >= groesse - 9 && cy <= 8) || (cx <= 8 && cy >= groesse - 9);
      if (beiSucher) continue;
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          setze(cx + x, cy + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
      }
    }
  }

  /*
   * Die Felder für Format und Version FREIHALTEN.
   *
   * Ausdrücklich aufgezählt statt „alles, was noch leer ist": die Taktlinien
   * kreuzen diesen Bereich bei (6,8) und (8,6), und eine Prüfung auf „noch
   * leer" übersieht dabei ausgerechnet (8,8). Bliebe die eine Zelle
   * unreserviert, schriebe der Zickzack dort ein Datenbit hinein, das
   * Formatzeichen überschriebe es danach — und ALLE folgenden Bits säßen um
   * eines verschoben. Der Code sähe richtig aus und wäre unlesbar.
   *
   * Spalte 8: Zeilen 0 bis 5, 7, 8 und die letzten acht.
   * Zeile 8:  Spalten 0 bis 5, 7, 8 und die letzten acht.
   * (6 gehört jeweils der Taktlinie und bleibt, wie sie ist.)
   */
  for (const i of [0, 1, 2, 3, 4, 5, 7, 8]) {
    setze(8, i, false);
    setze(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    setze(groesse - 1 - i, 8, false);
    setze(8, groesse - 1 - i, false);
  }
  // Das eine immer dunkle Modul liegt IN diesem Streifen und muss danach
  // wieder gesetzt werden, sonst hat die Schleife es eben gelöscht.
  setze(8, groesse - 8, true);
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      setze(Math.floor(i / 3), groesse - 11 + (i % 3), false);
      setze(groesse - 11 + (i % 3), Math.floor(i / 3), false);
    }
  }

  // ── Den Strom im Zickzack einlegen ─────────────────────────────────────────
  let bitIndex = 0;
  const stromBits: number[] = [];
  for (const b of strom) for (let i = 7; i >= 0; i -= 1) stromBits.push((b >> i) & 1);

  let aufwaerts = true;
  for (let rechts = groesse - 1; rechts > 0; rechts -= 2) {
    if (rechts === 6) rechts -= 1; // die senkrechte Taktlinie überspringen
    for (let schritt = 0; schritt < groesse; schritt += 1) {
      const y = aufwaerts ? groesse - 1 - schritt : schritt;
      for (const x of [rechts, rechts - 1]) {
        if (reserviert[y * groesse + x]) continue;
        module[y * groesse + x] = (stromBits[bitIndex] ?? 0) === 1;
        bitIndex += 1;
      }
    }
    aufwaerts = !aufwaerts;
  }

  // ── Alle acht Masken bewerten, die beste nehmen ────────────────────────────
  const maskeGilt = (m: number, x: number, y: number): boolean => {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };

  let beste: boolean[] | null = null;
  let besteStrafe = Number.POSITIVE_INFINITY;
  for (let m = 0; m < 8; m += 1) {
    const feld: boolean[] = new Array(groesse * groesse).fill(false);
    for (let y = 0; y < groesse; y += 1) {
      for (let x = 0; x < groesse; x += 1) {
        const i = y * groesse + x;
        const roh = module[i] === true;
        feld[i] = reserviert[i] ? roh : roh !== maskeGilt(m, x, y);
      }
    }
    // Format- und Versionszeichen einlegen (sie hängen von der Maske ab).
    const format = FORMAT_M[m] as number;
    for (let i = 0; i < 15; i += 1) {
      const bit = ((format >> i) & 1) === 1;
      // Der senkrechte Streifen links, der waagerechte oben.
      if (i < 6) feld[i * groesse + 8] = bit;
      else if (i < 8) feld[(i + 1) * groesse + 8] = bit;
      else feld[(groesse - 15 + i) * groesse + 8] = bit;
      if (i < 8) feld[8 * groesse + (groesse - 1 - i)] = bit;
      else if (i < 9) feld[8 * groesse + 15 - i - 1 + 1] = bit;
      else feld[8 * groesse + (15 - i - 1)] = bit;
    }
    if (version >= 7) {
      const vb = VERSION_BITS[version] as number;
      for (let i = 0; i < 18; i += 1) {
        const bit = ((vb >> i) & 1) === 1;
        feld[(groesse - 11 + (i % 3)) * groesse + Math.floor(i / 3)] = bit;
        feld[Math.floor(i / 3) * groesse + (groesse - 11 + (i % 3))] = bit;
      }
    }

    const strafe = bewerte(feld, groesse);
    if (strafe < besteStrafe) {
      besteStrafe = strafe;
      beste = feld;
    }
  }

  return { groesse, module: beste as boolean[], version, modus };
}

/** Die vier Straftabellen der Norm (Abschnitt 7.8.3). */
function bewerte(feld: readonly boolean[], n: number): number {
  const an = (x: number, y: number): boolean => feld[y * n + x] === true;
  let strafe = 0;

  // 1) Fünf oder mehr gleiche in einer Reihe.
  for (let y = 0; y < n; y += 1) {
    for (const waagerecht of [true, false]) {
      let lauf = 1;
      for (let i = 1; i < n; i += 1) {
        const jetzt = waagerecht ? an(i, y) : an(y, i);
        const vorher = waagerecht ? an(i - 1, y) : an(y, i - 1);
        if (jetzt === vorher) lauf += 1;
        else {
          if (lauf >= 5) strafe += 3 + (lauf - 5);
          lauf = 1;
        }
      }
      if (lauf >= 5) strafe += 3 + (lauf - 5);
    }
  }

  // 2) Zwei mal zwei gleiche Blöcke.
  for (let y = 0; y < n - 1; y += 1) {
    for (let x = 0; x < n - 1; x += 1) {
      const a = an(x, y);
      if (a === an(x + 1, y) && a === an(x, y + 1) && a === an(x + 1, y + 1)) strafe += 3;
    }
  }

  // 3) Das Muster, das mit einem Sucherkreuz verwechselt wird.
  const MUSTER = [true, false, true, true, true, false, true, false, false, false, false];
  const UMGEKEHRT = [...MUSTER].reverse();
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x <= n - 11; x += 1) {
      const waagerecht = Array.from({ length: 11 }, (_, i) => an(x + i, y));
      const senkrecht = Array.from({ length: 11 }, (_, i) => an(y, x + i));
      for (const reihe of [waagerecht, senkrecht]) {
        if (MUSTER.every((v, i) => v === reihe[i]) || UMGEKEHRT.every((v, i) => v === reihe[i])) {
          strafe += 40;
        }
      }
    }
  }

  // 4) Das Verhältnis dunkel zu hell.
  const dunkel = feld.filter(Boolean).length;
  const anteil = (dunkel * 100) / (n * n);
  strafe += Math.floor(Math.abs(anteil - 50) / 5) * 10;

  return strafe;
}

/**
 * Das Gitter als SVG-Pfad, ohne jede Abhängigkeit.
 *
 * Ein einziger `<path>` statt tausend `<rect>`: ein QR der Version 10 hat 3481
 * Module, und dreitausend Knoten in einem Beleg-Vorschaufenster kosten spürbar
 * Zeit beim Zeichnen.
 *
 * `rand` ist die ruhige Zone in Modulen. Die Norm verlangt vier; weniger, und
 * manche Lesegeräte finden den Code auf dunklem Grund nicht.
 */
export function qrSvgPfad(gitter: QrGitter): string {
  const teile: string[] = [];
  for (let y = 0; y < gitter.groesse; y += 1) {
    for (let x = 0; x < gitter.groesse; x += 1) {
      if (gitter.module[y * gitter.groesse + x]) teile.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return teile.join('');
}
