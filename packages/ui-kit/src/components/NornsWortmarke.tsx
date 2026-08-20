/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  NornsWortmarke — der Name des Hauses, dessen N das ZEICHEN selbst ist
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS ANWEISUNG, ZWEIMAL GESAGT ──────────────────────────────────────
 *
 * 19.08.2026, sinngemäß: „das Zeichen soll klug an die Stelle des gewöhnlichen
 * N gesetzt werden, dann schlägst du zwei Fliegen mit einer Klappe."
 * 20.08.2026, wörtlich, weil ich es beim ersten Mal falsch gelesen hatte:
 * „das normale N entfernen und das Zeichen an seine Stelle setzen."
 *
 * ⚠️ MEIN FEHLER, damit er nicht wiederkommt: ich hatte das Zeichen ÜBER den
 * Schriftzug gestellt und den Schriftzug unverändert gelassen. Damit stand die
 * Marke zweimal untereinander, und genau das sollte enden.
 *
 * ── WAS DIESES BAUTEIL TUT ────────────────────────────────────────────────
 *
 * Es setzt EIN Wort: das Zeichen als erster Buchstabe, dann O R N S in der
 * Anzeigeschrift. Kein zweites Bild darüber, keine Wiederholung.
 *
 * ── DIE OPTISCHE ARBEIT, DIE DAHINTERSTECKT ───────────────────────────────
 *
 * Ein gezeichnetes N neben gesetzten Buchstaben stimmt nie von selbst. Drei
 * Masse mussten am laufenden Bild gemessen werden, nicht geschätzt:
 *
 *   1. HÖHE. Die Buchstaben der Anzeigeschrift stehen auf ihrer Versalhöhe,
 *      nicht auf der Schriftgrösse. Für Fraunces sind das rund 0,70 em
 *      (am Schirm nachgemessen). Das Zeichen wird deshalb auf `0.70em`
 *      gesetzt, damit seine Oberkante mit den Versalien fluchtet.
 *   2. BESCHNITT. Das Zeichen liegt in einem 100er-Feld mit viel Luft aussen
 *      (das N sitzt von 26,6 bis 73,4 und von 20 bis 80). Als Buchstabe darf
 *      diese Luft nicht mitzählen, sonst steht das N geschrumpft und
 *      eingerückt. Der Ausschnitt zeigt darum GENAU die Glyphe.
 *   3. SPERRUNG. Die Wortmarke ist weit gesperrt. Ein `letter-spacing` wirkt
 *      NUR zwischen Textzeichen, nie zwischen einem Bild und dem Text
 *      daneben — die Lücke nach dem Zeichen wird deshalb hier eigens gesetzt.
 *
 * Alles andere erbt: Farbe, Grösse und Gewicht kommen von der Fläche.
 */

import type { CSSProperties } from 'react';

import { FADEN_DICKE, NORNS_FADEN, NORNS_TINTE, ZEICHEN_KASTEN } from './NornsZeichen.js';

/**
 * Versalhöhe der Anzeigeschrift als Anteil der Schriftgrösse.
 *
 * Am laufenden Bild gemessen (Fraunces, 20.08.2026): ein „N" bei 100 px
 * Schriftgrösse misst 70 px in der Höhe. Wer die Anzeigeschrift wechselt,
 * misst diesen Wert neu, statt ihn zu übernehmen.
 */
const VERSALHOEHE_EM = 0.7;

export interface NornsWortmarkeProps {
  /**
   * Die Farbe der Tinte, für Zeichen UND Schrift. Vorgabe: die Tinte des
   * Zeichens; auf dunklem Grund reicht die Fläche ihre helle Tinte herein.
   */
  tinte?: string;
  /** Die Farbe des Fadens. Vorgabe: das Weinrot des Erzeugers. */
  faden?: string;
  /**
   * Die Sperrung zwischen den Buchstaben, als CSS-Wert. Die Fläche bestimmt
   * sie: die Anmeldekarte steht weiter als eine Kopfleiste.
   */
  sperrung?: string;
  className?: string;
  /** Grösse, Gewicht und alles Weitere kommen von hier. */
  style?: CSSProperties;
}

export function NornsWortmarke({
  tinte = NORNS_TINTE,
  faden = NORNS_FADEN,
  sperrung = '0.34em',
  className,
  style,
}: NornsWortmarkeProps): JSX.Element {
  return (
    <span
      role="img"
      aria-label="Norns"
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        fontFamily: 'var(--w14-font-display)',
        color: tinte,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <svg
        // GENAU die Glyphe, ohne die Luft des Symbolfeldes.
        viewBox={ZEICHEN_KASTEN}
        // Höhe = Versalhöhe der Nachbarbuchstaben; die Breite folgt dem
        // Seitenverhältnis der Glyphe von selbst.
        height={`${VERSALHOEHE_EM}em`}
        aria-hidden
        focusable="false"
        style={{
          // Die Grundlinie des Bildes ist seine Unterkante; damit steht das
          // Zeichen exakt auf derselben Linie wie O R N S.
          display: 'inline-block',
          // Die Sperrung wirkt nicht zwischen Bild und Text: hier von Hand.
          marginRight: sperrung,
          overflow: 'visible',
        }}
      >
        <rect x="26.6" y="20" width="9.6" height="60" fill={tinte} />
        <rect x="63.8" y="20" width="9.6" height="60" fill={tinte} />
        <line
          x1="31.4"
          y1={20 + FADEN_DICKE / 2}
          x2="68.6"
          y2={80 - FADEN_DICKE / 2}
          stroke={faden}
          strokeWidth={FADEN_DICKE}
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          letterSpacing: sperrung,
          // Sperrung fügt rechts vom letzten Buchstaben Luft an; ohne diesen
          // Ausgleich stünde das Wort sichtbar links von der Mitte.
          marginRight: `-${sperrung}`,
        }}
      >
        ORNS
      </span>
    </span>
  );
}
