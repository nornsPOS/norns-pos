/**
 * Welches Etikett? — die Entscheidung, getrennt von der Fläche und vom Drucker.
 *
 * ── WAS AM TRESEN SCHIEFGING ───────────────────────────────────────────────
 * Es gab keine Wahl. `hardware-client.ts` hängte an JEDEN Rasterdruck den
 * Bauplan der einen fest verdrahteten Grösse — 28,6 × 88,9 mm, das
 * Adressetikett. Für eine 20-Euro-Münze in einer Kapsel bedeutete das ein
 * Etikett, das dreimal so lang ist wie das Stück selbst: es passt weder auf die
 * Kapsel noch in die Schublade, also klebte es daneben, und daneben heisst
 * früher oder später verrutscht. Ein Preis, der nicht mehr sicher zu seinem
 * Stück gehört, ist am Tresen schlimmer als gar kein Preis.
 *
 * Der Drucker kann zehn Medien. Neun davon hat die Kasse nie angeboten.
 *
 * ── WAS DIESE DATEI TUT UND WAS NICHT ──────────────────────────────────────
 * Sie RECHNET und sie BEGRÜNDET. Sie liefert zu einem Artikel:
 *   • welche der zehn Grössen überhaupt gehen und welche nicht, und bei jeder
 *     Sperre einen ganzen deutschen Satz, warum,
 *   • einen Vorschlag, der aus echten Eigenschaften des Stücks folgt
 *     (Warenart, Gewicht, Länge der Artikelnummer, ob ein Name da ist),
 *   • und die Begründung dieses Vorschlags, damit ein Mensch ihn BEGRÜNDET
 *     ändern kann statt ihn blind anzunehmen.
 *
 * Sie zeichnet nichts, sie druckt nichts und sie kennt kein React. Damit ist
 * jede Regel ohne Drucker und ohne Bildschirm prüfbar.
 *
 * ── DIE ZAHLEN SIND AUS DEM TREIBER, NICHT AUS EINEM DATENBLATT ─────────────
 * Alles Folgende ist aus `/etc/cups/ppd/Warehouse14-Etikett.ppd` des HIER
 * angeschlossenen DYMO LabelWriter 450 gelesen. Die PPD nennt je Medium
 * `*PaperDimension` (das Papier) und `*ImageableArea` (was der Kopf erreicht),
 * beides in PostScript-Punkten zu 1/72 Zoll. Für JEDES der zehn Medien gilt
 * dort dieselbe Randformel: `2 14.9 (w-2) (h-14.9)`. Deshalb stehen hier zwei
 * Randkonstanten und keine zehn Rechtecke.
 *
 * (Die PPD schreibt `14.89999961853` statt `14.9`; der Unterschied ist
 * 1,4 × 10⁻⁸ mm und damit weit unter einem Druckpunkt. Gerundet wird bewusst,
 * nicht aus Nachlässigkeit.)
 *
 * ── EINE BEDINGUNG AN DEN BAUPLAN, OHNE DIE HIER ALLES WERTLOS IST ─────────
 * Gerechnet wird gegen die BEDRUCKBARE Fläche, nicht gegen das Papier. Das ist
 * kein Geschmack, sondern Folge des Druckwegs: `src-tauri/…/label.rs` liest die
 * PPD, passt den Bauplan MITTIG in die bedruckbare Fläche ein und verkleinert
 * ihn dabei, wenn er grösser ist (`aufbau_rechnen`). Ein Bauplan, der 88,9 mm
 * breit ist, wird auf 78,4 mm bedruckbare Länge also mit Faktor 0,88
 * geschrumpft — und mit ihm jedes Modul des Strichcodes. Aus 0,254 mm werden
 * 0,224 mm, und der Rasterweg verweigert den Druck dann zu Recht.
 *
 * Damit die Zusicherungen dieser Datei am Papier ankommen, MUSS der Bauplan in
 * den Massen der bedruckbaren Fläche gebaut sein. Dann ist der Einpassfaktor
 * 1,0 und die hier gerechnete Modulbreite ist die, die gedruckt wird.
 */

import { Code128UnkodierbarError, code128BalkenBreiten } from './code128.js';

// ───────────────────────────────────────────────────────────────────────────
// DER DRUCKER
// ───────────────────────────────────────────────────────────────────────────

/** Ein PostScript-Punkt in Millimetern. */
const PT_MM = 25.4 / 72;

/** Der DYMO LabelWriter 450 druckt mit 300 Punkten je Zoll. */
export const PUNKTE_JE_ZOLL = 300;

/** Ein Druckpunkt in Millimetern: 0,0846667. Die kleinste Einheit, die es gibt. */
export const DRUCKPUNKT_MM = 25.4 / PUNKTE_JE_ZOLL;

/** Seitlicher Rand (quer zur Laufrichtung), aus der PPD: 2 pt = 0,706 mm. */
const SEITENRAND_PT = 2;

/**
 * Rand an BEIDEN Enden der Laufrichtung, aus der PPD: 14,9 pt = 5,256 mm.
 *
 * Das ist der wichtigste Wert dieser Datei — siehe `ruhezoneImPapier`.
 */
const ENDRAND_PT = 14.9;

/** Der Endrand in Millimetern. Weisses Papier, nur ausserhalb der Kopfreichweite. */
export const ENDRAND_MM = ENDRAND_PT * PT_MM;

/**
 * Die schmalste Linie, die ein gewöhnlicher Handscanner am Tresen noch sicher
 * liest: 3 Druckpunkte.
 *
 * Bei 300 dpi sind 3 Punkte EXAKT 0,254 mm — die verbreitete Untergrenze für
 * Code 128 auf Thermopapier. Dass die Grenze genau auf einer ganzen Punktzahl
 * liegt, ist der Grund, warum hier in Punkten und nicht in Millimetern
 * gerechnet wird: eine Modulbreite von „0,254 mm" ist eine Zahl, eine
 * Modulbreite von „3 Punkten" ist etwas, das der Kopf auch drucken kann.
 */
export const SCHMALSTE_LINIE_PUNKTE = 3;

/**
 * Die breiteste Linie, die noch sinnvoll ist: 8 Punkte (0,677 mm).
 *
 * Ohne Deckel würde eine kurze Nummer auf einem langen Etikett Balken von
 * mehreren Millimetern bekommen. Lesbar wäre das, aber es sieht aus wie ein
 * Fehler, und der freie Platz ist für Text mehr wert.
 */
export const BREITESTE_LINIE_PUNKTE = 8;

/**
 * Die Ruhezone links und rechts vom Strichcode, in Modulen. Norm: 10.
 *
 * Bewusst hier noch einmal definiert und nicht aus `etikett-layout.ts`
 * geholt: das ist ein Normwert, keine Eigenschaft eines bestimmten Bauplans,
 * und diese Datei soll ihre Sperren allein begründen können.
 */
export const RUHEZONE_MODULE = 10;

// ───────────────────────────────────────────────────────────────────────────
// DIE ZEHN MEDIEN
// ───────────────────────────────────────────────────────────────────────────

/**
 * Die CUPS-Namen der zehn Medien. Der Name IST die Geometrie: `w54h144` heisst
 * 54 × 144 Punkt. Eine Prüfung liest das nach, damit Tabelle und Name nie
 * auseinanderlaufen.
 */
export type EtikettGroesse =
  | 'w54h144'
  | 'w81h252'
  | 'w101h252'
  | 'w41h144'
  | 'w41h248'
  | 'w153h198'
  | 'w162h225'
  | 'w162h288'
  | 'w162h504'
  | 'w162h540';

interface MediumRoh {
  /** Breite quer zur Laufrichtung, in Punkten. Die KURZE Kante des Etiketts. */
  querPt: number;
  /** Länge in Laufrichtung, in Punkten. Die LANGE Kante, an der gelesen wird. */
  laufPt: number;
  /** Wie der Treiber das Medium nennt — so steht es in der PPD. */
  treiberName: string;
  /** Wie ein Mensch die Rolle im Schrank wiedererkennt. */
  name: string;
}

const MEDIEN_ROH: Readonly<Record<EtikettGroesse, MediumRoh>> = {
  w54h144: { querPt: 54, laufPt: 144, treiberName: 'Return Address', name: 'Rückadresse' },
  w81h252: { querPt: 81, laufPt: 252, treiberName: 'Address', name: 'Adresse' },
  w101h252: { querPt: 101, laufPt: 252, treiberName: 'Large Address', name: 'Adresse gross' },
  w41h144: { querPt: 41, laufPt: 144, treiberName: 'Hanging Folder', name: 'Hängemappe' },
  w41h248: { querPt: 41, laufPt: 248, treiberName: 'File Folder', name: 'Aktenmappe' },
  w153h198: { querPt: 153, laufPt: 198, treiberName: '3.5" Disk', name: 'Diskette' },
  w162h225: { querPt: 162, laufPt: 225, treiberName: 'Paint Can', name: 'Farbdose' },
  w162h288: { querPt: 162, laufPt: 288, treiberName: '2.25x4.00"', name: 'Grossformat' },
  w162h504: {
    querPt: 162,
    laufPt: 504,
    treiberName: 'Internet Postage 3-Part',
    name: 'Porto dreiteilig',
  },
  w162h540: {
    querPt: 162,
    laufPt: 540,
    treiberName: 'Internet Postage 2-Part',
    name: 'Porto zweiteilig',
  },
};

export interface EtikettMedium {
  groesse: EtikettGroesse;
  /** Deutscher Name der Rolle. */
  name: string;
  /** Der Name aus der Treiberdatei — den braucht der Druckauftrag. */
  treiberName: string;
  /** Papier quer zur Laufrichtung, in Millimetern. */
  papierQuerMm: number;
  /** Papier in Laufrichtung, in Millimetern. */
  papierLaufMm: number;
  /** BEDRUCKBAR quer zur Laufrichtung. */
  druckQuerMm: number;
  /** BEDRUCKBAR in Laufrichtung. */
  druckLaufMm: number;
}

function mediumAus(groesse: EtikettGroesse): EtikettMedium {
  const roh = MEDIEN_ROH[groesse];
  return {
    groesse,
    name: roh.name,
    treiberName: roh.treiberName,
    papierQuerMm: roh.querPt * PT_MM,
    papierLaufMm: roh.laufPt * PT_MM,
    druckQuerMm: (roh.querPt - 2 * SEITENRAND_PT) * PT_MM,
    druckLaufMm: (roh.laufPt - 2 * ENDRAND_PT) * PT_MM,
  };
}

/**
 * Alle zehn Medien in der Reihenfolge, in der sie angeboten werden.
 *
 * Zuerst die drei, für die es einen Bauplan gibt — vom kleinsten zum grössten,
 * denn das ist die Frage, die ein Mensch am Tresen wirklich stellt („passt das
 * kleine noch?"). Danach die übrigen sieben, aufsteigend nach bedruckbarer
 * Fläche. Sie stehen da, weil der Drucker sie kann und weil eine Liste, die
 * verschweigt, was im Gerät steckt, wieder die alte Lüge wäre — nur mit
 * Begründung, warum heute nichts darauf gedruckt werden kann.
 */
export const ETIKETT_GROESSEN: readonly EtikettGroesse[] = [
  'w54h144',
  'w81h252',
  'w101h252',
  'w41h144',
  'w41h248',
  'w153h198',
  'w162h225',
  'w162h288',
  'w162h504',
  'w162h540',
];

export const ETIKETT_MEDIEN: Readonly<Record<EtikettGroesse, EtikettMedium>> = Object.freeze(
  Object.fromEntries(ETIKETT_GROESSEN.map((g) => [g, mediumAus(g)])) as Record<
    EtikettGroesse,
    EtikettMedium
  >,
);

// ───────────────────────────────────────────────────────────────────────────
// DIE BAUARTEN
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ein Bauplan ist nicht dasselbe wie ein Medium. Auf dieselbe Rolle könnten
 * mehrere Entwürfe passen, und ein Entwurf verlangt eine Mindesthöhe und eine
 * Mindestlänge. Deshalb steht hier, WAS gedruckt würde, getrennt von WORAUF.
 */
export type EtikettBauart = 'kapselfaehnchen' | 'regal' | 'grossadresse';

/**
 * Unterlänge nach GEVIERT, nicht nach Versalhöhe.
 *
 * Der Unterschied klingt nach Haarspalterei und ist keiner: eine Grotesk hat
 * rund 0,717 Geviert Versalhöhe, die Unterlänge sind rund 0,23 GEVIERT. Wer
 * 0,23 × Versalhöhe rechnet, bekommt 30 Prozent zu wenig und lässt das „g" von
 * „890,00 €" oder das „p" eines Namens über die Papierkante laufen. Genau
 * dieser Rechenweg hat im Entwurfspanel einen Kommafehler gefunden.
 */
const GROTESK_VERSAL_JE_GEVIERT = 0.717;
const UNTERLAENGE_JE_GEVIERT = 0.23;

export function unterlaengeMm(versalhoeheMm: number): number {
  return (versalhoeheMm / GROTESK_VERSAL_JE_GEVIERT) * UNTERLAENGE_JE_GEVIERT;
}

interface BauartRegel {
  /** Wie das Etikett heisst, das hier entsteht. */
  name: string;
  /** Ein Satz für den Menschen: wofür ist dieses Etikett da? */
  zweck: string;
  /**
   * Was der Bauplan an bedruckbarer Höhe (quer zur Laufrichtung) braucht.
   * In Millimetern, hergeleitet — keine gegriffene Zahl.
   */
  mindestHoeheMm: number;
  /** Wieviel Länge dem Strichcode auf diesem Medium zur Verfügung steht. */
  strichcodeZoneMm: (medium: EtikettMedium) => number;
  /**
   * Darf die Ruhezone im unbedruckbaren Weiss liegen?
   *
   * ── DIE ERKENNTNIS, DIE DAS KLEINE ETIKETT MÖGLICH MACHT ─────────────────
   * Die 5,256 mm an jedem Ende der Laufrichtung sind WEISSES ETIKETTENPAPIER
   * vor dem Stanzschnitt. Sie sind nur ausserhalb der Reichweite des
   * Thermokopfes. Eine Ruhezone verlangt aber Weiss, nicht Druckfläche — der
   * Scanner sieht Papier, nicht den Datenblattbereich eines Treibers.
   *
   * Ein Strichcode, der quer über die ganze Laufrichtung geht, bekommt seine
   * Ruhezone also GESCHENKT. Auf dem kleinen Etikett steigt die Obergrenze
   * damit von 8 auf 11 Zeichen, und ein sechsstelliger Code darf 4 statt 3
   * Punkte je Modul führen.
   *
   * Steht der Code dagegen in einer SPALTE, neben der noch etwas gedruckt wird
   * (so wie beim Regaletikett neben dem QR), grenzt er nicht an Papier,
   * sondern an Nachbarn. Dann muss die Ruhezone in die Druckfläche.
   */
  ruhezoneImPapier: boolean;
}

/**
 * Die Strichcodespalte des Regaletiketts.
 *
 * HERKUNFT: der bestehende Bauplan in `etikett-layout.ts` setzt den Code von
 * `rand` (2,0 mm) bis `spalteRechts` (68,4 mm); rechts davon steht der QR.
 * ACHTUNG: `etikett-layout.ts` wird gerade überarbeitet. Ändert sich die
 * Spalte dort, muss diese Zahl mitgehen — sonst sperrt diese Datei entweder
 * zu streng (harmlos) oder zu lasch (gefährlich, weil dann ein Code aufs
 * Papier käme, den kein Scanner liest). Die Prüfung `etikett-wahl.test.ts`
 * hält die Richtung fest: im Zweifel zu streng.
 */
const REGAL_SPALTE_MM = 66.4;

const BAUARTEN: Readonly<Record<EtikettBauart, BauartRegel>> = {
  kapselfaehnchen: {
    name: 'Kapselfähnchen',
    zweck:
      'Für kleine Münzen und kleine Stücke: Kurzcode als Strichcode über die ganze Länge, darüber der QR, dazu der Preis. Trägt bewusst keinen Namen, dafür ist kein Millimeter da.',
    // Die senkrechte Aufteilung des Entwurfspanels, in Druckpunkten:
    //   oben 8 + QR 100 + Ruhezone 16 + Strichcode 79 + unten 4 = 207.
    // In Punkten gerechnet, weil jede dieser Kanten auf einem Punkt liegen
    // muss. 207 × 0,0846667 = 17,526 mm; bedruckbar sind 17,639 mm.
    mindestHoeheMm: 207 * DRUCKPUNKT_MM,
    strichcodeZoneMm: (m) => m.druckLaufMm,
    ruhezoneImPapier: true,
  },
  regal: {
    name: 'Regaletikett',
    zweck:
      'Der Standard am Regal: Artikelnummer als Strichcode und im Klartext, Name, Gewicht und Feinheit, Preis rechts unten, QR in der rechten Spalte.',
    // Die unterste Grundlinie des bestehenden Bauplans liegt bei 25,4 mm,
    // die Schrift dort hat 2,3 mm Versalhöhe. Dazu die Unterlänge nach
    // Geviert — sonst schneidet das Papier das „g" von „g" und „890,00 €" ab.
    mindestHoeheMm: 25.4 + unterlaengeMm(2.3),
    strichcodeZoneMm: () => REGAL_SPALTE_MM,
    ruhezoneImPapier: false,
  },
  grossadresse: {
    name: 'Namensetikett',
    zweck:
      'Wie das Regaletikett, aber mit einer eigenen Zeile für den vollen Namen, ohne Auslassungszeichen. Für Stücke, deren Bezeichnung die Ware ausmacht.',
    // ANFORDERUNG, keine Messung: der Bauplan für diese Grösse ist noch nicht
    // gebaut. Der Entwurf ist das Regaletikett plus EINE volle Namenszeile mit
    // 3,4 mm Versalhöhe und 1,4 mm Durchschuss. Sobald der Bauplan steht, muss
    // diese Zahl gegen ihn abgeglichen werden.
    mindestHoeheMm: 25.4 + unterlaengeMm(2.3) + 3.4 + 1.4,
    strichcodeZoneMm: () => REGAL_SPALTE_MM,
    ruhezoneImPapier: false,
  },
};

/**
 * Welches Medium trägt welchen Bauplan.
 *
 * Eine ausgeschriebene Tabelle statt einer Suche: jede Zeile ist EINE
 * Entscheidung, die ein Mensch nachlesen kann. Dass die Zeile geometrisch
 * überhaupt möglich ist, prüft nicht das Vertrauen, sondern die Prüfdatei —
 * sie rechnet für jede Zuordnung nach, ob Höhe und Länge wirklich reichen.
 */
const BAUART_JE_GROESSE: Readonly<Record<EtikettGroesse, EtikettBauart | null>> = {
  w54h144: 'kapselfaehnchen',
  w81h252: 'regal',
  w101h252: 'grossadresse',
  w41h144: null,
  w41h248: null,
  w153h198: null,
  w162h225: null,
  w162h288: null,
  w162h504: null,
  w162h540: null,
};

// ───────────────────────────────────────────────────────────────────────────
// DER STRICHCODE: WIEVIEL PASST
// ───────────────────────────────────────────────────────────────────────────

/**
 * Wieviele Module ein Code 128 in der Zeichenmenge B für n Zeichen belegt.
 *
 * Startzeichen 11 + n × 11 + Prüfsumme 11 + Schlusszeichen 13 = 11n + 35.
 * Für sechs Zeichen sind das 101 Module — genau die Zahl, mit der das
 * Entwurfspanel gerechnet hat. Die Prüfdatei hält diese Formel gegen den
 * ECHTEN Kodierer aus `code128.ts`; eine Formel, die nur mit sich selbst
 * übereinstimmt, wäre wertlos.
 */
export function code128Module(zeichen: number): number {
  return 11 * zeichen + 35;
}

/**
 * Wieviele Zeichen die Strichcodezone bei der schmalsten noch lesbaren Linie
 * fasst.
 *
 * Gerechnet wird in ganzen Druckpunkten, nicht in Millimetern: der Kopf kann
 * nichts anderes setzen.
 */
export function maximaleZeichen(bauart: EtikettBauart, medium: EtikettMedium): number {
  const regel = BAUARTEN[bauart];
  const zonePunkte = Math.floor(regel.strichcodeZoneMm(medium) / DRUCKPUNKT_MM);
  const module = Math.floor(zonePunkte / SCHMALSTE_LINIE_PUNKTE);
  const fuerDenCode = regel.ruhezoneImPapier ? module : module - 2 * RUHEZONE_MODULE;
  return Math.max(0, Math.floor((fuerDenCode - 35) / 11));
}

export interface Strichcodemass {
  /** Was der Strichcode wirklich trägt. */
  inhalt: string;
  /** Woher dieser Inhalt kommt. */
  quelle: 'kurzcode' | 'artikelnummer';
  /** Module des Codes selbst, ohne Ruhezone. */
  module: number;
  /**
   * Breite EINES Moduls in ganzen Druckpunkten.
   *
   * ── WARUM GANZZAHLIG ────────────────────────────────────────────────────
   * Ein Modul von 3,7 Punkten gibt es nicht. Der Thermokopf rundet dann jede
   * einzelne Kante für sich, und weil die Rundungsfehler sich abwechselnd
   * addieren und aufheben, wird die schmalste Linie mal 3 und mal 4 Punkte
   * breit. Ein Scanner misst Verhältnisse — ungleichmässige Linien sind für
   * ihn kein leicht unsauberer Code, sondern ein anderer. Deshalb ist die
   * Ganzzahligkeit hier eine Zusicherung des Bauplans und keine Fussnote.
   */
  modulPunkte: number;
  modulbreiteMm: number;
  /** Die ganze Breite des Codes ohne Ruhezone. */
  breiteMm: number;
  /**
   * Wieviel Weiss je Seite wirklich zur Verfügung steht, geteilt durch das
   * geforderte. Unter 1,0 wäre der Code gesperrt; er wird berichtet, damit
   * sichtbar bleibt, wie gross die Reserve ist.
   */
  ruhezoneFaktor: number;
}

/** Warum ein Code auf einer Grösse nicht geht — oder `null`, wenn er geht. */
type Codeurteil = { ok: true; mass: Strichcodemass } | { ok: false; grund: string };

function strichcodeMass(
  inhalt: string,
  quelle: 'kurzcode' | 'artikelnummer',
  bauart: EtikettBauart,
  medium: EtikettMedium,
): Codeurteil {
  const regel = BAUARTEN[bauart];

  // Ein Zeichen, das Code 128 B nicht kann, ist KEIN Grössenproblem — es wäre
  // heute eine geworfene Ausnahme mitten im Druckweg und am Tresen nur eine
  // Meldung „Etikettendruck fehlgeschlagen" ohne Grund. Hier wird daraus ein
  // Satz, der sagt, welches Zeichen es ist.
  let module: number;
  try {
    module = code128BalkenBreiten(inhalt).reduce((a, b) => a + b, 0);
  } catch (fehler) {
    if (fehler instanceof Code128UnkodierbarError) {
      return {
        ok: false,
        grund: `Der Code enthält das Zeichen „${fehler.zeichen}", das ein Strichcode nicht darstellen kann.`,
      };
    }
    throw fehler;
  }

  const zonePunkte = Math.floor(regel.strichcodeZoneMm(medium) / DRUCKPUNKT_MM);
  const bedarfModule = module + (regel.ruhezoneImPapier ? 0 : 2 * RUHEZONE_MODULE);
  const modulPunkte = Math.min(
    BREITESTE_LINIE_PUNKTE,
    Math.floor(zonePunkte / Math.max(1, bedarfModule)),
  );

  if (modulPunkte < SCHMALSTE_LINIE_PUNKTE) {
    const passt = maximaleZeichen(bauart, medium);
    return {
      ok: false,
      grund: `Der Code hat ${inhalt.length} Zeichen; auf dieser Grösse sind höchstens ${passt} lesbar. Mehr Zeichen hiessen dünnere Linien, als ein Handscanner sicher erkennt.`,
    };
  }

  const modulbreiteMm = modulPunkte * DRUCKPUNKT_MM;
  const breiteMm = module * modulbreiteMm;
  const zoneMm = regel.strichcodeZoneMm(medium);
  const weissJeSeiteMm = (zoneMm - breiteMm) / 2 + (regel.ruhezoneImPapier ? ENDRAND_MM : 0);
  const gefordertMm = RUHEZONE_MODULE * modulbreiteMm;

  return {
    ok: true,
    mass: {
      inhalt,
      quelle,
      module,
      modulPunkte,
      modulbreiteMm,
      breiteMm,
      ruhezoneFaktor: weissJeSeiteMm / gefordertMm,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// DER ARTIKEL
// ───────────────────────────────────────────────────────────────────────────

/**
 * Was diese Entscheidung über ein Stück wissen muss.
 *
 * Die Felder sind so getippt, wie der Server sie liefert (`weightGrams` und
 * `listPriceEur` kommen als Zeichenkette), damit an der Aufrufstelle nichts
 * umgerechnet werden muss. Eine Umrechnung, die an vier Stellen von Hand
 * geschieht, ist an einer davon irgendwann falsch.
 */
export interface EtikettArtikel {
  /** Die Artikelnummer. */
  sku: string;
  /** Der Name, wie er im Lager steht. */
  name?: string | null;
  /**
   * Der KURZCODE — heute die Spalte `barcode` des Artikels.
   *
   * Warum ein zweiter Code neben der Artikelnummer: eine Artikelnummer wie
   * `MZ-260726-A3F9` hat 14 Zeichen und passt bei lesbarer Linienbreite nicht
   * auf 40 mm. Ein kurzer, eigener Code passt IMMER. Dass er am Tresen auch
   * auflöst, ist keine Hoffnung: `scan-resolve.ts` vergleicht einen Scan
   * gegen die Artikelnummer UND gegen `barcode`.
   */
  kurzcode?: string | null;
  /** Die Warenart, roh wie der Server sie liefert (`itemType`). */
  warenart?: string | null;
  /** Gewicht in Gramm. */
  gewichtGramm?: string | number | null;
  /** Verkaufspreis in Euro. */
  preisEur?: string | number | null;
}

/** Zahl aus einem Feld, das eine Zahl oder eine Zeichenkette sein darf. */
function zahl(wert: string | number | null | undefined): number | null {
  if (wert === null || wert === undefined || wert === '') return null;
  const n = typeof wert === 'number' ? wert : Number(wert);
  return Number.isFinite(n) ? n : null;
}

/** Ein Code, wie ihn der Scanner sieht: ohne Ränder, in Grossbuchstaben. */
function codeNormal(roh: string | null | undefined): string | null {
  if (roh === null || roh === undefined) return null;
  const sauber = roh.trim().toUpperCase();
  return sauber === '' ? null : sauber;
}

type Warenklasse = 'muenze' | 'barren' | 'schmuck' | 'uhr' | 'antiquitaet' | 'unbekannt';

/**
 * Die Warenart auf die vier Fälle bringen, die für die Etikettengrösse etwas
 * bedeuten. Roh bleibt nichts übrig — kein Wert aus der Datenbank wird je
 * sichtbar.
 */
function warenklasse(roh: string | null | undefined): Warenklasse {
  const w = (roh ?? '').toLowerCase();
  if (w.endsWith('coin')) return 'muenze';
  if (w.endsWith('bar')) return 'barren';
  if (w.endsWith('jewelry')) return 'schmuck';
  if (w === 'watch') return 'uhr';
  if (w === 'antique') return 'antiquitaet';
  return 'unbekannt';
}

/**
 * Bis zu welchem Gewicht ein Stück als „klein" gilt: 15 g.
 *
 * Ein Ring, ein Ohrring, eine kleine Kette, eine Marke — das liegt in einer
 * Schale oder in einer Tüte, nicht in einer Schublade mit Platz für ein
 * 89 mm langes Fähnchen. Über 15 g ist es ein Stück, das sich selbst trägt.
 */
const KLEIN_BIS_GRAMM = 15;

/**
 * Bis zu welchem Gewicht ein Barren noch das Kapselfähnchen bekommt: 100 g.
 *
 * Ein 100-g-Barren steckt in einem Blister von etwa 50 × 80 mm; daneben passt
 * ein schmales Fähnchen, ein Adressetikett nicht. Darüber wird die Verpackung
 * so gross, dass das grössere Etikett bequem darauf liegt.
 */
const BARREN_KAPSEL_BIS_GRAMM = 100;

/**
 * Ab wieviel Zeichen ein Name auf dem Regaletikett gekürzt würde: 18.
 *
 * Hergeleitet, nicht gegriffen: die Namenszone des Regaletiketts ist 38 mm
 * breit, die Schrift dort hat 2,6 mm Versalhöhe. Bei einer Grotesk mit 0,717
 * Geviert Versalhöhe sind das 3,63 mm Geviert, und ein durchschnittliches
 * Zeichen einer deutschen Warenbezeichnung belegt gut 0,58 Geviert, also rund
 * 2,1 mm. 38 / 2,1 ergibt 18 Zeichen.
 *
 * Die Schätzung irrt bewusst in Richtung des GRÖSSEREN Etiketts: ein zu
 * grosses Etikett kostet Papier, ein zu kleines schneidet den Namen ab, und
 * ein abgeschnittener Name ist am Regal eine falsche Auskunft.
 */
const NAME_ZEICHEN_OHNE_KUERZUNG = 18;

// ───────────────────────────────────────────────────────────────────────────
// DAS ERGEBNIS
// ───────────────────────────────────────────────────────────────────────────

export interface EtikettMoeglichkeit {
  groesse: EtikettGroesse;
  medium: EtikettMedium;
  /** Welcher Bauplan hier gedruckt würde; `null`, wenn es keinen gibt. */
  bauart: EtikettBauart | null;
  /** Der Name dieses Bauplans, für den Menschen. */
  bauartName: string | null;
  /** Wofür dieses Etikett gedacht ist — ein Satz. */
  zweck: string | null;
  waehlbar: boolean;
  /** Nur wenn nicht wählbar: der Grund, als ganzer Satz. Sonst `null`. */
  sperrgrund: string | null;
  /** Nur wenn wählbar: was der Strichcode trüge. Sonst `null`. */
  strichcode: Strichcodemass | null;
  /** Wieviele Zeichen der Strichcode auf dieser Grösse höchstens fasst. */
  maximaleZeichen: number | null;
  istVorschlag: boolean;
}

export interface EtikettWahl {
  /** Alle zehn Medien des Druckers, in Anzeigereihenfolge. */
  moeglichkeiten: EtikettMoeglichkeit[];
  /** Die vorgeschlagene Grösse; `null`, wenn keine einzige möglich ist. */
  vorschlag: EtikettGroesse | null;
  /**
   * Warum genau diese — ein ganzer Satz.
   *
   * Der Vorschlag ohne seine Begründung wäre eine Anweisung. Mit ihr ist er
   * ein Argument, dem ein Mensch widersprechen kann.
   */
  begruendung: string;
}

/**
 * Welche Grösse ein Stück BEKOMMEN SOLLTE, wenn sie frei wäre.
 *
 * Getrennt von der Frage, ob sie geht: sonst liessen sich Vorschlag und Sperre
 * nicht mehr auseinanderhalten, und die Begründung könnte nicht sagen
 * „eigentlich das kleine, aber dafür fehlt der Kurzcode".
 */
function wunschGroesse(artikel: EtikettArtikel): { groesse: EtikettGroesse; weil: string } {
  const klasse = warenklasse(artikel.warenart);
  const gramm = zahl(artikel.gewichtGramm);
  const name = (artikel.name ?? '').trim();

  // Regel 1 — Münzen. Eine Münze liegt in einer Kapsel und zeigt sich selbst;
  // ihr Name steht auf ihr. Ein Etikett, das dreimal so lang ist wie die
  // Kapsel, kann nur daneben liegen, und daneben verrutscht.
  if (klasse === 'muenze') {
    return {
      groesse: 'w54h144',
      weil: 'Eine Münze liegt in einer Kapsel und zeigt ihren Namen selbst. Das Kapselfähnchen passt daneben, ohne den Preis vom Stück zu trennen.',
    };
  }

  // Regel 2 — kleine Barren. Bis 100 g steckt der Barren in einem Blister, an
  // den ein schmales Fähnchen passt und ein Adressetikett nicht.
  if (klasse === 'barren' && gramm !== null && gramm <= BARREN_KAPSEL_BIS_GRAMM) {
    return {
      groesse: 'w54h144',
      weil: `Ein Barren mit ${gramm.toLocaleString('de-DE')} g steckt in einem kleinen Blister. Das Kapselfähnchen liegt daneben, ohne ihn zu verdecken.`,
    };
  }

  // Regel 3 — alles Leichte. Unter 15 g ist ein Stück so klein, dass das
  // grosse Etikett es optisch und räumlich erschlägt.
  if (gramm !== null && gramm <= KLEIN_BIS_GRAMM) {
    return {
      groesse: 'w54h144',
      weil: `Mit ${gramm.toLocaleString('de-DE')} g ist das Stück so klein, dass ein 89 mm langes Etikett daneben liegen müsste. Das Kapselfähnchen bleibt bei ihm.`,
    };
  }

  // Regel 4 — der Name macht die Ware. Bei Schmuck, Uhren und Antiquitäten ist
  // die Bezeichnung das, was ein Mensch am Regal sucht; ein abgeschnittener
  // Name ist dort eine falsche Auskunft.
  if (name.length > NAME_ZEICHEN_OHNE_KUERZUNG) {
    return {
      groesse: 'w101h252',
      weil: `Der Name hat ${name.length} Zeichen und würde auf dem Regaletikett mit einem Auslassungszeichen enden. Das Namensetikett trägt ihn ganz.`,
    };
  }

  // Regel 5 — der Normalfall.
  return {
    groesse: 'w81h252',
    weil: 'Name, Gewicht, Preis und beide Codes passen ohne Kürzung auf das Regaletikett. Es ist die Rolle, die im Drucker steckt.',
  };
}

/**
 * Die ganze Entscheidung zu einem Artikel.
 *
 * Liefert IMMER alle zehn Grössen — die gesperrten mit ihrem Grund. Eine
 * Grösse, die einfach fehlt, lässt einen Menschen suchen; eine Grösse mit
 * Begründung beantwortet die Frage, bevor sie gestellt wird.
 */
export function etikettWahl(artikel: EtikettArtikel): EtikettWahl {
  const sku = codeNormal(artikel.sku);
  const kurzcode = codeNormal(artikel.kurzcode);

  const moeglichkeiten: EtikettMoeglichkeit[] = ETIKETT_GROESSEN.map((groesse) => {
    const medium = ETIKETT_MEDIEN[groesse];
    const bauart = BAUART_JE_GROESSE[groesse];

    if (bauart === null) {
      return {
        groesse,
        medium,
        bauart: null,
        bauartName: null,
        zweck: null,
        waehlbar: false,
        sperrgrund: ohneBauplanGrund(medium),
        strichcode: null,
        maximaleZeichen: null,
        istVorschlag: false,
      };
    }

    const regel = BAUARTEN[bauart];
    const grundlage = {
      groesse,
      medium,
      bauart,
      bauartName: regel.name,
      zweck: regel.zweck,
      maximaleZeichen: maximaleZeichen(bauart, medium),
      istVorschlag: false,
    };

    // Welchen Code trägt dieses Etikett? Das Kapselfähnchen bevorzugt den
    // Kurzcode, weil er kurz IST; es nimmt aber die Artikelnummer, wenn sie
    // von sich aus kurz genug ist. Die grösseren Etiketten tragen immer die
    // Artikelnummer — dort ist sie lesbar, und sie ist das, was im Lager gilt.
    const kandidaten: { inhalt: string; quelle: 'kurzcode' | 'artikelnummer' }[] =
      bauart === 'kapselfaehnchen'
        ? [
            ...(kurzcode !== null
              ? [{ inhalt: kurzcode, quelle: 'kurzcode' as const }]
              : []),
            ...(sku !== null ? [{ inhalt: sku, quelle: 'artikelnummer' as const }] : []),
          ]
        : sku !== null
          ? [{ inhalt: sku, quelle: 'artikelnummer' as const }]
          : [];

    if (kandidaten.length === 0) {
      return {
        ...grundlage,
        waehlbar: false,
        sperrgrund: 'Der Artikel hat weder eine Artikelnummer noch einen Kurzcode.',
        strichcode: null,
      };
    }

    let letzterGrund = '';
    for (const kandidat of kandidaten) {
      const urteil = strichcodeMass(kandidat.inhalt, kandidat.quelle, bauart, medium);
      if (urteil.ok) {
        return { ...grundlage, waehlbar: true, sperrgrund: null, strichcode: urteil.mass };
      }
      letzterGrund = urteil.grund;
    }

    // Kein Kandidat passte. Fehlt der Kurzcode ganz, ist DAS die eigentliche
    // Nachricht — nicht „Nummer zu lang", sondern „es gibt keinen kurzen".
    const grund =
      bauart === 'kapselfaehnchen' && kurzcode === null
        ? `${letzterGrund} Für dieses Stück ist kein Kurzcode vergeben; mit einem kurzen Code würde das Kapselfähnchen passen.`
        : letzterGrund;

    return { ...grundlage, waehlbar: false, sperrgrund: grund, strichcode: null };
  });

  const wunsch = wunschGroesse(artikel);
  const gewuenscht = moeglichkeiten.find((m) => m.groesse === wunsch.groesse);
  const ersteWaehlbare = moeglichkeiten.find((m) => m.waehlbar);

  if (gewuenscht !== undefined && gewuenscht.waehlbar) {
    gewuenscht.istVorschlag = true;
    return { moeglichkeiten, vorschlag: gewuenscht.groesse, begruendung: wunsch.weil };
  }

  if (ersteWaehlbare === undefined) {
    return {
      moeglichkeiten,
      vorschlag: null,
      begruendung:
        'Für dieses Stück lässt sich derzeit kein Etikett drucken. Die Gründe stehen an jeder Grösse.',
    };
  }

  // Der Wunsch ging nicht. Das wird GESAGT, samt Grund, und dann wird die
  // nächste mögliche Grösse vorgeschlagen. Heimlich auf eine andere Grösse
  // auszuweichen wäre dieselbe Unehrlichkeit wie heimliches Verkleinern.
  ersteWaehlbare.istVorschlag = true;
  const abgelehnt = gewuenscht?.sperrgrund ?? 'Diese Grösse hat keinen Bauplan.';
  return {
    moeglichkeiten,
    vorschlag: ersteWaehlbare.groesse,
    begruendung: `Vorgesehen wäre ${wunschName(wunsch.groesse)}: ${wunsch.weil} Das geht hier nicht: ${kleinAnfang(abgelehnt)} Deshalb ${wunschName(ersteWaehlbare.groesse)}.`,
  };
}

/** Der Name einer Grösse, wie er in einem Satz steht. */
function wunschName(groesse: EtikettGroesse): string {
  const bauart = BAUART_JE_GROESSE[groesse];
  const medium = ETIKETT_MEDIEN[groesse];
  return bauart === null ? `die Rolle „${medium.name}"` : `das ${BAUARTEN[bauart].name}`;
}

/** Einen fertigen Satz mitten in einen anderen setzen, ohne Grossbuchstaben. */
function kleinAnfang(satz: string): string {
  return satz.charAt(0).toLowerCase() + satz.slice(1);
}

/**
 * Warum auf dieser Rolle heute nichts gedruckt werden kann.
 *
 * Zwei verschiedene Wahrheiten, und sie werden auseinandergehalten: entweder
 * ist die Rolle zu SCHMAL für den kleinsten Bauplan — das ist Geometrie und
 * ändert sich nie —, oder es ist schlicht noch kein Bauplan dafür gezeichnet.
 * Das zweite ist Arbeit, das erste ist Physik, und ein Mensch soll wissen,
 * welches von beidem er vor sich hat.
 */
function ohneBauplanGrund(medium: EtikettMedium): string {
  const kleinste = Math.min(...Object.values(BAUARTEN).map((b) => b.mindestHoeheMm));
  if (medium.druckQuerMm < kleinste) {
    return `Die Rolle ist zu schmal: ${mm(medium.druckQuerMm)} mm sind bedruckbar, der kleinste Bauplan braucht ${mm(kleinste)} mm. QR und Strichcode passen dort nicht übereinander.`;
  }
  return 'Für diese Rolle ist noch kein Bauplan gezeichnet. Der Drucker kann sie, die Kasse hat dafür noch kein Etikett.';
}

/** Eine Millimeterzahl deutsch und auf eine Nachkommastelle. */
export function mm(wert: number): string {
  return wert.toFixed(1).replace('.', ',');
}
