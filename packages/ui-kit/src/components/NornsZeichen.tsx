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
const BREITE = 0.78 * HOEHE; // 46,8
const STRICH = 0.16 * HOEHE; // 9,6
const LINKS = M - BREITE / 2; // 26,6
const RECHTS = M + BREITE / 2; // 73,4
const OBEN = M - HOEHE / 2; // 20
const UNTEN = M + HOEHE / 2; // 80

const FADEN_DICKE = 0.11 * HOEHE; // 6,6
const KAPPE = FADEN_DICKE / 2;

// Der Faden ist die Schräge: von der Spitze des LINKEN Stamms zum Fuss des
// RECHTEN, auf den Mittellinien der Stämme. Die runden Kappen rücken um
// ihren Radius nach innen (Basels Korrektur), damit sie GENAU auf Ober- und
// Unterkante des N enden.
const F_X1 = LINKS + STRICH / 2;
const F_Y1 = OBEN + KAPPE;
const F_X2 = RECHTS - STRICH / 2;
const F_Y2 = UNTEN - KAPPE;

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
      {/* Die beiden Stämme in Tinte. */}
      <rect x={LINKS} y={OBEN} width={STRICH} height={HOEHE} fill={tinte} />
      <rect x={RECHTS - STRICH} y={OBEN} width={STRICH} height={HOEHE} fill={tinte} />

      {/* Der Faden IST die Schräge des N (19.08.2026). Kein Tintenbalken
          darunter, keine Kreuzung darüber: eine Diagonale, in Weinrot. */}
      <line
        x1={F_X1}
        y1={F_Y1}
        x2={F_X2}
        y2={F_Y2}
        stroke={faden}
        strokeWidth={FADEN_DICKE}
        strokeLinecap="round"
      />
    </svg>
  );
}
