/**
 * QrBild — ein QR-Code auf dem Schirm, gerechnet von `lib/qr.ts`.
 *
 * WOFÜR
 * Die Belegvorschau zeigte an der Stelle des QR-Codes einen leeren Kasten mit
 * dem Text „QR-Code (wird gedruckt)". Der echte Code entsteht erst im Drucker,
 * also konnte niemand VOR dem Druck sehen, ob er sitzt. Jetzt steht dort das,
 * was gleich auf dem Papier steht.
 *
 * ── DIE EINE REGEL, DIE HIER ÜBER ALLEM STEHT ───────────────────────────────
 * Ein QR-Code auf einem Kassenbon SIEHT AUS WIE EINE FISKALISCHE SIGNATUR.
 * Wer einen zeichnet, wo keine ist, hat nicht die Gestalt geprüft, sondern eine
 * Behauptung gedruckt. Deshalb:
 *
 *   • `muster` ist KEIN Stil, sondern ein anderer Zustand. Er zeichnet einen
 *     Code, dessen INHALT selbst sagt, dass er keine Signatur ist, und er
 *     legt einen sichtbaren Streifen quer über das Bild.
 *   • Ohne `muster` wird ein leerer oder als Ausfall erkennbarer Bezug NICHT
 *     gezeichnet. Die Komponente gibt dann `null` zurück, und der Aufrufer
 *     schreibt seinen ehrlichen Satz.
 *
 * Verwandt: die Fehlerklasse „erfinden, wenn nicht eingerichtet" — dieselbe,
 * die schon einmal echte Sendungsnummern erfunden hat.
 */

import { useMemo } from 'react';

import { qrGitter, qrSvgPfad } from '../lib/qr.js';

/** Der Text, den ein MUSTER-Code trägt. Er sagt selbst, was er ist. */
export const MUSTER_INHALT =
  'MUSTER, keine gueltige TSE-Signatur. Nur zum Pruefen der Belegform. Norns POS.';

export interface QrBildProps {
  /** Der zu kodierende Text. Bei `muster` wird er ignoriert. */
  inhalt: string;
  /** Kantenlänge in Pixeln, ohne die Ruhezone. */
  groesse?: number;
  /**
   * MUSTER-Modus: zeichnet einen erkennbar unechten Code mit Querstreifen.
   * Ausdrücklich zu setzen — nie ein stiller Rückfall.
   */
  muster?: boolean;
  /** Vorgelesener Name. Immer deutsch. */
  name?: string;
}

/** Vier Module Ruhezone: weniger, und manche Lesegeräte finden den Code nicht. */
const RUHEZONE = 4;

export function QrBild({
  inhalt,
  groesse = 108,
  muster = false,
  name,
}: QrBildProps): JSX.Element | null {
  const gezeichnet = useMemo(() => {
    const text = muster ? MUSTER_INHALT : inhalt;
    if (!text.trim()) return null;
    try {
      const gitter = qrGitter(text);
      return { gitter, pfad: qrSvgPfad(gitter) };
    } catch {
      // Ein zu langer Bezug ist ein ehrliches Nichts, kein halber Code.
      return null;
    }
  }, [inhalt, muster]);

  if (!gezeichnet) return null;

  const { gitter, pfad } = gezeichnet;
  const kante = gitter.groesse + RUHEZONE * 2;
  const beschriftung = name ?? (muster ? 'Muster eines QR-Codes, keine Signatur' : 'TSE QR-Code');

  return (
    <svg
      role="img"
      aria-label={beschriftung}
      viewBox={`0 0 ${kante} ${kante}`}
      width={groesse}
      height={groesse}
      // Ohne dies verwischt der Browser die Modulkanten beim Skalieren, und
      // ein verwaschener QR wird auf dem Bildschirm nicht mehr gelesen.
      shapeRendering="crispEdges"
      style={{ display: 'block' }}
    >
      <rect width={kante} height={kante} fill="#ffffff" />
      <g transform={`translate(${RUHEZONE},${RUHEZONE})`} fill="#000000">
        <path d={pfad} />
      </g>
      {muster && (
        <>
          {/*
           * Der Querstreifen. Er verdeckt einen Teil der Module ABSICHTLICH:
           * ein MUSTER darf nicht nur beschriftet, sondern soll auch nicht
           * versehentlich lesbar sein. Wer ihn abfotografiert, bekommt nichts.
           */}
          <rect
            x={0}
            y={kante / 2 - kante * 0.09}
            width={kante}
            height={kante * 0.18}
            fill="#c0492f"
            opacity={0.92}
          />
          <text
            x={kante / 2}
            y={kante / 2 + kante * 0.045}
            textAnchor="middle"
            fill="#ffffff"
            fontSize={kante * 0.12}
            fontFamily="Helvetica, Arial, sans-serif"
            letterSpacing={kante * 0.012}
          >
            MUSTER
          </text>
        </>
      )}
    </svg>
  );
}
