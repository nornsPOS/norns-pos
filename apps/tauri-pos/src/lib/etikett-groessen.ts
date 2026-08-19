/**
 * Der Katalog der Etiketten, die der DYMO am Tresen wirklich kann.
 *
 * ── WOHER DIE ZAHLEN KOMMEN ────────────────────────────────────────────────
 * Nicht aus einem Datenblatt, sondern aus der Treiberdatei der ANGESCHLOSSENEN
 * Warteschlange: `/etc/cups/ppd/Warehouse14-Etikett.ppd`. Dort stehen je Medium
 * zwei Zeilen, und beide werden hier wörtlich übernommen:
 *
 *   *PaperDimension w81h252/Address: "81 252"
 *   *ImageableArea  w81h252/Address: "2 14.89999961853 79 237.100006103516"
 *
 * `PaperDimension` ist das PAPIER, `ImageableArea` ist das, was der Kopf
 * wirklich schwärzen kann — links, unten, rechts, oben, alles in PostScript-
 * Punkten zu 1/72 Zoll. Der Unterschied ist kein Rundungsfehler: seitlich
 * fehlen 0,706 mm, an BEIDEN Enden der Laufrichtung 5,256 mm. Auf dem Etikett
 * 88,9 mm sind das über zehn Prozent der Länge.
 *
 * ── WARUM DIE ROHEN PUNKTE HIER STEHEN UND NICHT DIE MILLIMETER ────────────
 * Ein Etikett kam am 26.07.2026 beschnitten aus dem Drucker, weil der Bauplan
 * mit dem PAPIERMASS rechnete. Wer die Millimeter von Hand einträgt, kann sich
 * genau dort wieder vertippen, und niemand merkt es, bis Papier verbraucht ist.
 * Deshalb stehen hier die Zahlen aus der Treiberdatei, und die Millimeter
 * werden gerechnet — mit derselben Reihenfolge der Rechenschritte wie in
 * `src-tauri/src/commands/label.rs` (`pt * 25.4 / 72.0`), damit beide Seiten
 * auf das letzte Bit dasselbe Mass meinen und die Einpassung dort sauber 1,0
 * ergibt statt 0,999.
 */

/** Ein PostScript-Punkt in Millimetern. */
export function punktZuMm(punkt: number): number {
  // Klammerung und Reihenfolge sind dieselben wie in `pt_zu_mm` auf der
  // Rust-Seite. Das ist kein Zufall und keine Kosmetik: `p * 25.4 / 72` und
  // `p * (25.4 / 72)` liefern in Fliesskomma NICHT dasselbe letzte Bit, und
  // die Rust-Seite prüft die schmalste Linie nach der Einpassung.
  return (punkt * 25.4) / 72;
}

/**
 * Ein Druckpunkt des DYMO bei 300 dpi, in Millimetern.
 *
 * Der Thermokopf kennt nur ganze Punkte. Alles, was auf einen Bruchteil davon
 * gesetzt wird, rundet er selbst — und zwar jede Kante einzeln.
 */
export const DRUCKPUNKT_MM = 25.4 / 300;

/** Wie viele volle Druckpunkte in diese Länge passen. */
export function inDruckpunkte(mm: number): number {
  // Das kleine Zugeständnis fängt den Fall ab, dass eine Länge rechnerisch
  // exakt auf einem Punkt liegt und die Fliesskommadarstellung eine Winzigkeit
  // darunter landet. Ohne das verlöre ein Strichcode gelegentlich grundlos
  // einen ganzen Punkt Modulbreite.
  return Math.floor(mm / DRUCKPUNKT_MM + 1e-9);
}

/** Ganze Druckpunkte als Länge in Millimetern. */
export function ausDruckpunkten(punkte: number): number {
  return punkte * DRUCKPUNKT_MM;
}

/**
 * Die Masse, mit denen der Bauplan rechnet — IMMER die bedruckbare Fläche.
 *
 * `breiteMm` ist die LAUFRICHTUNG (die lange Kante, in der das Etikett durch
 * den Drucker läuft), `hoeheMm` die Bahnbreite quer dazu.
 */
export interface EtikettMasse {
  /** Bedruckbare Länge in Laufrichtung, in Millimetern. */
  breiteMm: number;
  /** Bedruckbare Breite quer zur Laufrichtung, in Millimetern. */
  hoeheMm: number;
  /**
   * Weisses, aber UNBEDRUCKBARES Papier an jedem Ende der Laufrichtung.
   *
   * Diese Zahl ist der Grund, warum auf das kleine Etikett überhaupt ein
   * brauchbarer Strichcode passt: eine Ruhezone verlangt WEISS, nicht
   * Druckfläche. Das Papier ist dort weiss, es liegt nur ausserhalb der
   * Reichweite des Kopfes. Fehlt die Angabe, wird nichts angenommen — dann
   * muss die Ruhezone innerhalb der Druckfläche liegen.
   */
  randLaengsMm?: number | undefined;
  /** Dasselbe quer zur Laufrichtung. */
  randQuerMm?: number | undefined;
}

/**
 * Welcher der drei Baupläne dieses Medium trägt.
 *
 * Entschieden wird nach der BAHNBREITE, nicht nach der Länge: ob ein Name,
 * eine Nummer und ein Preis untereinander Platz haben, hängt an der kurzen
 * Kante. Ein Etikett kann beliebig lang sein und trotzdem nur ein Fähnchen.
 */
export type Bauplanfamilie = 'klein' | 'standard' | 'gross';

export function familieFuer(hoeheMm: number): Bauplanfamilie {
  if (hoeheMm <= 20) return 'klein';
  if (hoeheMm <= 36) return 'standard';
  return 'gross';
}

/**
 * Wie brauchbar dieses Medium für dieses Geschäft ist.
 *
 * Ein Katalog, der so tut, als sei alles gleich sinnvoll, hilft niemandem: der
 * Inhaber steht dann vor zehn gleichrangigen Zeilen und muss selbst herausfinden,
 * dass zwei davon Frankierstreifen sind.
 */
export type Eignung =
  /** Trägt den Alltag am Tresen. */
  | 'kern'
  /** Hat seinen Fall, aber nicht jeden Tag. */
  | 'gelegentlich'
  /** Der Drucker kann es, das Geschäft braucht es nicht. */
  | 'beiliegend';

export interface EtikettMedium {
  /** Der Name, den der Druckbefehl braucht, z. B. `-o PageSize=w54h144`. */
  cups: string;
  /** Deutsche Bezeichnung für die Auswahl am Bildschirm. */
  bezeichnung: string;
  /** Das PAPIER: quer zur Laufrichtung und in Laufrichtung, in Millimetern. */
  papier: { querMm: number; laengsMm: number };
  /** Die BEDRUCKBARE Fläche — damit rechnet der Bauplan. */
  bedruckbar: EtikettMasse;
  familie: Bauplanfamilie;
  eignung: Eignung;
  /** Wofür es im Haus taugt. Ein Satz, wie ihn der Inhaber lesen soll. */
  zweck: string;
}

/**
 * Die zehn Zeilen aus der Treiberdatei, roh.
 *
 * `seite` ist `*PaperDimension` (quer, längs), `feld` ist `*ImageableArea`
 * (links, unten, rechts, oben). Die Nachkommastellen der Treiberdatei sind
 * hier auf die vier Stellen gekürzt, die der Treiber selbst meint (14,9 statt
 * 14,89999961853) — der Unterschied liegt bei 4 millionstel Millimetern.
 */
interface PpdZeile {
  cups: string;
  bezeichnung: string;
  seite: readonly [number, number];
  feld: readonly [number, number, number, number];
  eignung: Eignung;
  zweck: string;
}

const PPD: readonly PpdZeile[] = [
  {
    cups: 'w81h252',
    bezeichnung: 'Adresse',
    seite: [81, 252],
    feld: [2, 14.9, 79, 237.1],
    eignung: 'kern',
    zweck: 'Das Haus-Etikett für Regal, Vitrine und Tüte. Trägt Strichcode, Nummer, Name, Gewicht, Preis und den QR fürs Lager.',
  },
  {
    cups: 'w101h252',
    bezeichnung: 'Adresse gross',
    seite: [101, 252],
    feld: [2, 14.9, 99, 237.1],
    eignung: 'kern',
    zweck: 'Wie das Haus-Etikett, nur höher: der volle Name bekommt zwei Zeilen und muss nicht abgeschnitten werden.',
  },
  {
    cups: 'w54h144',
    bezeichnung: 'Rückadresse',
    seite: [54, 144],
    feld: [2, 14.9, 52, 129.1],
    eignung: 'kern',
    zweck: 'Das Kapselfähnchen für kleine Münzen und kleine Stücke: Kurzcode als Strichcode, QR und Preis. Mehr passt auf 17,6 mm nicht, und mehr wäre gelogen.',
  },
  {
    cups: 'w41h248',
    bezeichnung: 'Aktenmappe',
    seite: [41, 248],
    feld: [2, 14.9, 39, 233.1],
    eignung: 'gelegentlich',
    zweck: 'Ein langer schmaler Streifen: passt längs auf ein Münzröhrchen oder an die Kante eines Kästchens. Für einen QR zu schmal.',
  },
  {
    cups: 'w153h198',
    bezeichnung: 'Diskette',
    seite: [153, 198],
    feld: [2, 14.9, 151, 183.1],
    eignung: 'gelegentlich',
    zweck: 'Fast quadratisch: für Schatullen, Kästen und Konvolute, bei denen der ganze Name und die Feinheit lesbar stehen sollen.',
  },
  {
    cups: 'w162h225',
    bezeichnung: 'Farbdose',
    seite: [162, 225],
    feld: [2, 14.9, 160, 210.1],
    eignung: 'gelegentlich',
    zweck: 'Breites Etikett für Lagerkästen und Kartons. Viel Fläche für Name und Lagerort.',
  },
  {
    cups: 'w162h288',
    bezeichnung: '2,25 × 4,00 Zoll',
    seite: [162, 288],
    feld: [2, 14.9, 160, 273.1],
    eignung: 'gelegentlich',
    zweck: 'Das grosse Versandformat: für Pakete an Kunden und für Konvolute, die als Ganzes gehen.',
  },
  {
    cups: 'w41h144',
    bezeichnung: 'Hängemappe',
    seite: [41, 144],
    feld: [2, 14.9, 39, 129.1],
    eignung: 'beiliegend',
    zweck: 'Nur 13,1 mm bedruckbar, für einen lesbaren QR zu schmal, es bleiben Strichcode und Preis. Liegt bei, weil der Drucker es kennt.',
  },
  {
    cups: 'w162h504',
    bezeichnung: 'Porto dreiteilig',
    seite: [162, 504],
    feld: [2, 14.9, 160, 489.1],
    eignung: 'beiliegend',
    zweck: 'Frankierstreifen, kein Warenetikett. Liegt bei, weil der Drucker es kennt.',
  },
  {
    cups: 'w162h540',
    bezeichnung: 'Porto zweiteilig',
    seite: [162, 540],
    feld: [2, 14.9, 160, 525.1],
    eignung: 'beiliegend',
    zweck: 'Frankierstreifen, kein Warenetikett. Liegt bei, weil der Drucker es kennt.',
  },
];

function ausPpd(z: PpdZeile): EtikettMedium {
  const [querPt, laengsPt] = z.seite;
  const [linksPt, untenPt, rechtsPt, obenPt] = z.feld;

  // Die Differenz wird aus den UMGERECHNETEN Rändern gebildet, nicht aus der
  // umgerechneten Differenz. Rust macht es genauso, und nur so ergibt die
  // Einpassung dort exakt 1,0.
  const bedruckbarLaengs = punktZuMm(obenPt) - punktZuMm(untenPt);
  const bedruckbarQuer = punktZuMm(rechtsPt) - punktZuMm(linksPt);

  return {
    cups: z.cups,
    bezeichnung: z.bezeichnung,
    papier: { querMm: punktZuMm(querPt), laengsMm: punktZuMm(laengsPt) },
    bedruckbar: {
      breiteMm: bedruckbarLaengs,
      hoeheMm: bedruckbarQuer,
      randLaengsMm: punktZuMm(untenPt),
      randQuerMm: punktZuMm(linksPt),
    },
    familie: familieFuer(bedruckbarQuer),
    eignung: z.eignung,
    zweck: z.zweck,
  };
}

/**
 * Alle zehn Medien, in der Reihenfolge, in der sie dem Inhaber angeboten
 * werden sollen: erst die drei, die den Alltag tragen, dann die gelegentlichen,
 * zuletzt die, die nur der Vollständigkeit halber dabei sind.
 */
export const ETIKETT_MEDIEN: readonly EtikettMedium[] = PPD.map(ausPpd);

/** Das Medium, das ohne besondere Wahl gedruckt wird: `*DefaultPageSize`. */
export const STANDARD_MEDIUM = 'w81h252';

export function mediumFuer(cups: string): EtikettMedium | undefined {
  return ETIKETT_MEDIEN.find((m) => m.cups === cups);
}

/**
 * Das Standardmedium, hart geholt.
 *
 * Wirft, wenn es fehlt — das kann nur passieren, wenn jemand die Tabelle oben
 * kaputt macht, und dann soll die Prüfung rot werden statt am Tresen ein
 * Etikett in erfundener Grösse zu drucken.
 */
export function standardMedium(): EtikettMedium {
  const m = mediumFuer(STANDARD_MEDIUM);
  if (!m) throw new Error(`Das Standardmedium „${STANDARD_MEDIUM}" fehlt im Katalog.`);
  return m;
}
