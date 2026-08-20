/**
 * Das Zeichen von Norns, für die Oberfläche.
 *
 * ── DIE FORM, UND WER SIE ENTSCHIEDEN HAT ──────────────────────────────────
 *
 * ⚠️ BASELS ANWEISUNG VOM 19.08.2026, und sie hebt seine eigene vom 04.08.
 * auf („es soll NICHT verändert werden"): das alte Zeichen — ein volles N,
 * quer durchzogen von einem roten Faden von links unten nach rechts oben —
 * las sich als DURCHGESTRICHENES N, wie ein Verbotszeichen. Wörtlich: es
 * wurde ihm zur Last, jedes Mal beim Öffnen. Der Faden kreuzte die eigene
 * Diagonale des Buchstabens und ergab ein X; das Auge liest X über einem
 * Zeichen als Streichung.
 *
 * DIE NEUE FORM: der Faden IST die Schräge des N. Zwei Stämme in Tinte,
 * und statt eines dritten Tintenbalkens spannt sich der weinrote Faden von
 * der Spitze des linken Stamms zum Fuss des rechten — die Richtung, die
 * ein N zum N macht. Nichts kreuzt mehr, nichts streicht mehr: die Nornen
 * spinnen den Faden, und der Faden TRÄGT den Buchstaben. Dieselbe
 * Geschichte, eine Kreuzung weniger.
 *
 * ⚠️ WEITERHIN GILT: die Form gehört Basel. Wer sie erneut ändern will,
 * ändert die Identität des Hauses, und das ist keine Entscheidung des
 * Quelltextes.
 *
 * ── ABSCHRIFT, KEIN ZWEITES ZEICHEN ────────────────────────────────────────
 *
 * Die Masse stehen Zahl für Zahl auch im Erzeuger der Programmsymbole
 * (`apps/tauri-pos/src-tauri/icons/generate.py`). Basels Korrektur vom
 * 30.07. lebt weiter: die runden Kappen des Fadens rücken um ihren Radius
 * nach innen, damit kein Punkt über die Enden hinaussteht.
 *
 * ── DIE MASSE ──────────────────────────────────────────────────────────────
 *
 * Feld 100 mal 100, Mitte auf 50.
 *   Höhe des N     0,60 des Feldes
 *   Breite         0,78 der Höhe
 *   Strichdicke    0,16 der Höhe
 *   Faden          0,11 der Höhe, runde Kappen — kräftiger als der alte
 *                  Querfaden (0,075), weil er jetzt die Schräge trägt und
 *                  in der 16-Punkt-Fensterleiste lesbar bleiben muss
 */

import type { CSSProperties } from 'react';

/** Die Farben des Hauses, wie sie im Erzeuger stehen. */
export const NORNS_TINTE = '#262019';
export const NORNS_PAPIER = '#faf6ee';
export const NORNS_FADEN = '#9c2630';

// ── Geometrie, Zahl für Zahl aus `generate.py` ────────────────────────────
const FELD = 100;
const M = FELD / 2;
const HOEHE = 0.6 * FELD; // 60
const OBEN = M - HOEHE / 2; // 20
const UNTEN = M + HOEHE / 2; // 80

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ZWEI SCHNITTE DESSELBEN BUCHSTABENS (Basels Anweisung, 20.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Basel: das Zeichen soll mit dem Wort NORNS verschmelzen wie bei einer
 * grossen Firma, „zwei Fliegen mit einer Klappe" — und nicht als grosses N
 * über oder neben dem Wort stehen. Es IST der Buchstabe N des Wortes.
 *
 * ── WAS DIE MESSUNG ERGAB ──────────────────────────────────────────────────
 *
 * Am 20.08.2026 am laufenden Bild gemessen, im Hausschnitt Fraunces 500:
 *
 *     Versalhöhe                     140
 *     Tintenbreite des N             138      → 0,986 der Versalhöhe
 *     Stämme auf halber Höhe          11      → 0,079
 *     Schräge auf halber Höhe         34      → 0,243
 *
 * Das ist die klassische römische Antiqua: DÜNNE Stämme und eine DICKE
 * Schräge — die Schräge trägt das Gewicht des Buchstabens, mehr als das
 * Dreifache der Stämme. Das Zeichen des Hauses sagt seit dem 19.08.
 * dasselbe („der Faden IST die Schräge"), nur trug es die Verhältnisse
 * genau andersherum: dicke Stämme (0,16) und eine leichtere Schräge.
 *
 * Deshalb las es sich fremd im eigenen Wort: ein schmales, schweres N vor
 * vier breiten, leichten Buchstaben.
 *
 * ── WARUM DENNOCH ZWEI SCHNITTE ────────────────────────────────────────────
 *
 * Weil das Programmsymbol eine andere Aufgabe hat als der Schriftzug. Ein
 * Stamm von 0,079 der Versalhöhe misst in einem 16-Punkt-Symbol weniger als
 * einen Bildpunkt und verschwindet. Ein Schriftzug und ein Anwendungssymbol
 * sind in jedem Markenhaus zwei Schnitte derselben Form; das ist kein
 * zweites Zeichen, sondern dieselbe Form in zwei Gewichten.
 *
 * ⚠️ Die FORM ist beiden gemeinsam und steht nur EINMAL da (`ZeichenGestalt`
 * unten). Was sich unterscheidet, sind drei Zahlen — und die stehen hier,
 * nebeneinander, nachlesbar.
 */
export interface Schnitt {
  /** Breite der Glyphe, als Anteil der Versalhöhe. */
  breite: number;
  /** Dicke der senkrechten Stämme, als Anteil der Versalhöhe. */
  stamm: number;
  /** WAAGERECHTE Dicke der Schräge, als Anteil der Versalhöhe. */
  schraege: number;
}

/**
 * Der Schnitt für das PROGRAMMSYMBOL.
 *
 * Kräftig, damit er in der Fensterleiste bei 16 Punkt noch ein N ist. Die
 * Schräge ist hier ABGELEITET statt gemessen: `stamm / cos` macht sie
 * senkrecht gemessen genau so dick wie ein Stamm. Bei diesem Gewicht ist
 * eine römische Feder-Schräge (dreifache Stammdicke) unmöglich — sie
 * verschlösse den Innenraum.
 */
export const SCHNITT_SYMBOL: Schnitt = (() => {
  const breite = 0.78;
  const stamm = 0.16;
  const kosinus = 1 / Math.hypot(breite, 1);
  return { breite, stamm, schraege: stamm / kosinus };
})();

/**
 * Der Schnitt für den SCHRIFTZUG — die gemessenen Verhältnisse des
 * Hausschnitts, damit das N zwischen O R N S steht wie ein Buchstabe und
 * nicht wie ein eingesetztes Bild.
 */
export const SCHNITT_WORT: Schnitt = {
  breite: 0.986,
  stamm: 0.079,
  schraege: 0.243,
};

/** Die Kanten eines Schnitts im 100er-Feld. */
function kanten(schnitt: Schnitt): {
  links: number;
  rechts: number;
  strich: number;
  schraeg: number;
} {
  const breite = schnitt.breite * HOEHE;
  return {
    links: M - breite / 2,
    rechts: M + breite / 2,
    strich: schnitt.stamm * HOEHE,
    schraeg: schnitt.schraege * HOEHE,
  };
}

/**
 * Der Ausschnitt für den GESETZTEN Gebrauch: die Glyphe plus die beiden
 * Seitenlagen, die ein Buchstabe von sich aus mitbringt.
 *
 * Am laufenden Bild gemessen (Fraunces, 20.08.2026): ein „N" trägt beidseitig
 * zusammen 0,117 seiner Versalhöhe als Seitenlage, also 0,059 je Seite.
 */
const SEITENLAGE = 0.059 * HOEHE;
const WORT = kanten(SCHNITT_WORT);
export const ZEICHEN_KASTEN = `${WORT.links - SEITENLAGE} ${OBEN} ${
  WORT.rechts - WORT.links + 2 * SEITENLAGE
} ${HOEHE}`;

export function ZeichenGestalt({
  tinte,
  faden,
  schnitt = SCHNITT_SYMBOL,
}: {
  tinte: string;
  faden: string;
  schnitt?: Schnitt;
}): JSX.Element {
  const { links, rechts, strich, schraeg } = kanten(schnitt);
  /*
   * Die Schräge als Vieleck mit SENKRECHTEN Schnitten, von der oberen linken
   * Ecke des Buchstabenfeldes zur unteren rechten — so, wie die Schräge eines
   * N gebaut ist.
   *
   * ⚠️ Sie kann nicht überstehen, weil ihre Ecken die Ecken des Buchstabens
   * SIND. Basels Korrektur vom 30.07. (die runden Kappen um ihren Radius nach
   * innen zu rücken, damit nichts hinausragt) erledigt sich damit von selbst:
   * es gibt keine Kappen mehr.
   */
  const schraege = [
    [links, OBEN],
    [links + schraeg, OBEN],
    [rechts, UNTEN],
    [rechts - schraeg, UNTEN],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
  return (
    <>
      <rect x={links} y={OBEN} width={strich} height={HOEHE} fill={tinte} />
      <rect x={rechts - strich} y={OBEN} width={strich} height={HOEHE} fill={tinte} />
      <polygon points={schraege} fill={faden} />
    </>
  );
}

export interface NornsZeichenProps {
  /** Kantenlänge in Punkten. */
  size?: number;
  /**
   * Die Farbe des N. Vorgabe: die Tinte des Zeichens.
   *
   * ⚠️ Auf dunklem Grund gehört hier die helle Tinte der Fläche hin, NICHT
   * eine andere Farbe: das Zeichen bleibt Tinte auf Papier, das Papier
   * wechselt.
   */
  tinte?: string;
  /**
   * Die Farbe des Fadens. Vorgabe: das Weinrot des Erzeugers als Rueckfall.
   * 19.08.2026: fest #9c2630 mass auf dunklem Grund nur 2,40:1 — in der Kasse
   * uebergibt die Flaeche die Themen-Marke (tokens.css kennt dafuer #b8404c).
   */
  faden?: string;
  /**
   * Der Name für Vorleseprogramme. Leer heisst: rein schmückend, das
   * Programm überspringt das Zeichen. Steht es allein für den Namen des
   * Hauses, gehört „Norns" hinein.
   */
  titel?: string;
  className?: string;
  style?: CSSProperties;
}

export function NornsZeichen({
  size = 48,
  tinte = NORNS_TINTE,
  faden = NORNS_FADEN,
  titel,
  className,
  style,
}: NornsZeichenProps): JSX.Element {
  return (
    <svg
      viewBox={`0 0 ${FELD} ${FELD}`}
      width={size}
      height={size}
      className={className}
      style={style}
      role={titel ? 'img' : 'presentation'}
      aria-label={titel}
      aria-hidden={titel ? undefined : true}
      focusable="false"
    >
      {/* Zwei Stämme in Tinte, und die Schräge in Weinrot. Kein Tintenbalken
          darunter, keine Kreuzung darüber: EINE Diagonale, und sie gehört
          dem Buchstaben. */}
      <ZeichenGestalt tinte={tinte} faden={faden} />
    </svg>
  );
}
