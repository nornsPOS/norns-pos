/**
 * fineness-presets — die gebräuchlichen Feingehalte je Metall, als Schnellwahl.
 *
 * Karat und Feingehalt sind KEINE unabhängigen Felder: K585 heißt 0,585. Beim
 * Ankauf tippt der Kassierer beide von Hand, und ein Zahlendreher in einem der
 * Felder verschiebt die Bewertung und die §25c-Einordnung des Artikels.
 *
 * Eine Auswahl setzt deshalb immer BEIDE Felder gemeinsam. Freitext bleibt
 * möglich, denn ein Sonderstück muss erfassbar sein.
 *
 * Reines Datenmodul: keine React-Importe, direkt testbar.
 */

import type { Metal } from '@norns/api-client';

export interface FinenessPreset {
  /** Der Knopftext, z. B. „585". */
  label: string;
  /** Der Karat-Code, wie ihn der Server erwartet, z. B. „K585". */
  karatCode: string;
  /** Der Feingehalt als Dezimalzahl in [0, 1], z. B. „0.585". */
  finenessDecimal: string;
}

/**
 * Die im deutschen Edelmetallhandel üblichen Stempel. Bewusst kurz gehalten:
 * eine Schnellwahl mit zwanzig Knöpfen ist keine Schnellwahl mehr.
 */
const PRESETS: Readonly<Record<Metal, readonly FinenessPreset[]>> = {
  gold: [
    { label: '333', karatCode: 'K333', finenessDecimal: '0.333' },
    { label: '375', karatCode: 'K375', finenessDecimal: '0.375' },
    { label: '585', karatCode: 'K585', finenessDecimal: '0.585' },
    { label: '750', karatCode: 'K750', finenessDecimal: '0.750' },
    { label: '900', karatCode: 'K900', finenessDecimal: '0.900' },
    { label: '916', karatCode: 'K916', finenessDecimal: '0.916' },
    { label: '999', karatCode: 'K999', finenessDecimal: '0.999' },
  ],
  silver: [
    { label: '800', karatCode: 'AG800', finenessDecimal: '0.800' },
    { label: '835', karatCode: 'AG835', finenessDecimal: '0.835' },
    { label: '925', karatCode: 'AG925', finenessDecimal: '0.925' },
    { label: '999', karatCode: 'AG999', finenessDecimal: '0.999' },
  ],
  platinum: [
    { label: '950', karatCode: 'PT950', finenessDecimal: '0.950' },
    { label: '999', karatCode: 'PT999', finenessDecimal: '0.999' },
  ],
  palladium: [
    { label: '500', karatCode: 'PD500', finenessDecimal: '0.500' },
    { label: '950', karatCode: 'PD950', finenessDecimal: '0.950' },
  ],
};

/**
 * Die Schnellwahl für das gewählte Metall. Ohne Metall gibt es nichts zu raten,
 * also eine leere Liste (die UI blendet die Zeile dann aus).
 */
export function finenessPresets(metal: Metal | '' | null | undefined): readonly FinenessPreset[] {
  if (!metal) return [];
  return PRESETS[metal] ?? [];
}

/**
 * Ob ein Feld-Paar genau einer Schnellwahl entspricht. Treibt die Markierung des
 * aktiven Knopfes, ohne einen getippten Sonderwert fälschlich als Preset zu
 * markieren.
 */
export function matchesPreset(
  preset: FinenessPreset,
  karatCode: string,
  finenessDecimal: string,
): boolean {
  return (
    preset.karatCode === karatCode.trim().toUpperCase() &&
    Number.parseFloat(preset.finenessDecimal) === Number.parseFloat(finenessDecimal)
  );
}
