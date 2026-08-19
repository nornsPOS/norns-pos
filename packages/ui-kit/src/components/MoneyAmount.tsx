/**
 * MoneyAmount — formatted EUR display with tabular figures.
 *
 *   <MoneyAmount valueEur="1234.50" />              →  €&nbsp;1.234,50
 *   <MoneyAmount valueEur="1234.50" emphasis />     →  schwerer, eine Stufe grösser
 *   <MoneyAmount valueEur="-99.99" signed />        →  shows leading minus in wax-red
 *
 * Accepts string values (the only safe wire format — never JS numbers for
 * money). German locale by default (1.234,50 €).
 */

import type { CSSProperties } from 'react';

/**
 * ── Ein Formatierer je Gestalt, nicht je Preis (19.08.2026, gemessen) ─────
 *
 * `new Intl.NumberFormat(...)` lud bei JEDEM Betrag die Locale-Daten neu —
 * rund 60 Konstruktionen je Katalog-Durchlauf, 0,5 bis 1 ms je Durchlauf.
 * Für sich unsichtbar; multipliziert mit den Kachel-Neuaufbauten eines
 * Scan-Schubs aber messbar. Drei andere Dateien des Hauses heben den
 * Formatierer längst auf Modulebene; hier fehlte es.
 *
 * Der Schlüssel trägt alle drei Gestalt-Merkmale, damit kein Wechsel der
 * Währung oder Locale je einen falschen Formatierer erwischt.
 */
const FORMATIERER = new Map<string, Intl.NumberFormat>();
function holeFormatierer(locale: string, currency: string, bareNumber: boolean): Intl.NumberFormat {
  const schluessel = `${locale}|${currency}|${bareNumber ? 'nackt' : 'waehrung'}`;
  let f = FORMATIERER.get(schluessel);
  if (!f) {
    f = bareNumber
      ? new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
    FORMATIERER.set(schluessel, f);
  }
  return f;
}

export interface MoneyAmountProps {
  /** EUR amount as a decimal STRING (never a number). */
  valueEur: string;
  /** Schwerer Schnitt + eine Stufe grösser. Die Grösse bleibt überschreibbar. */
  emphasis?: boolean;
  /** When `valueEur` is negative, render the minus in wax-red. */
  signed?: boolean;
  /** Locale — default `'de-DE'`. */
  locale?: string;
  /** Currency symbol — default `'EUR'`. */
  currency?: string;
  /** Hide the currency symbol entirely. */
  bareNumber?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Optional title (tooltip) — useful for showing the raw value on hover. */
  title?: string;
}

export function MoneyAmount({
  valueEur,
  emphasis = false,
  signed = false,
  locale = 'de-DE',
  currency = 'EUR',
  bareNumber = false,
  className,
  style,
  title,
}: MoneyAmountProps): JSX.Element {
  // Parse the string to two-decimal-precision integer cents so the formatter
  // never sees floating-point noise. Empty / undefined / non-numeric → render
  // an em-dash placeholder.
  const trimmed = (valueEur ?? '').trim();
  if (trimmed.length === 0 || !/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return (
      <span
        className={className}
        style={{ color: 'var(--w14-ink-faded)', fontFamily: 'var(--w14-font-mono)', ...style }}
        title={title}
      >
        —
      </span>
    );
  }

  const negative = trimmed.startsWith('-');
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ''] = abs.split('.');
  const cents = Number(`${intPart}${fracPart.padEnd(2, '0').slice(0, 2)}`);
  const amount = cents / 100;

  const formatted = holeFormatierer(locale, currency, bareNumber).format(amount);

  // ── Warum Geld hier NICHT in der Anzeigeschrift steht (27.07.2026) ──────
  // `emphasis` griff auf `--w14-font-display`. Seit die Marke auf Fraunces
  // zeigt, war das ein stiller Defekt: an der Schriftdatei GEMESSEN führt
  // dieser Fraunces-Schnitt nur `liga rvrn` — kein `tnum`. Die Ziffer 0 ist
  // 1457 Einheiten breit, die 1 nur 1019, 43 % Unterschied. Die beiden
  // Zeilen darunter (`font-feature-settings`, `font-variant-numeric`) wären
  // wirkungslos gewesen, weil das Merkmal in der Schrift fehlt: die
  // Gesamtsumme wäre bei JEDER Ziffernänderung seitlich gesprungen.
  // Manrope führt `tnum` wirklich (gemessen: calt dnom frac liga locl numr
  // pnum tnum) — darum trägt es hier jede Zahl, hervorgehoben oder nicht.
  //
  // Und die GRÖSSE gehört der Aufrufstelle. Vorher stand hier hart 1.6rem;
  // das überschrieb still jede Grösse, die eine Fläche davorsetzte — jede
  // Geldzahl der ganzen Kasse war exakt gleich gross, ganz gleich was am
  // Aufruf stand. Genau daher kam der Eindruck, dass nichts wichtiger
  // aussieht als alles andere. Die Vorgabe ist jetzt die Zeilenstufe, und
  // `...style` steht danach, damit eine Fläche sie wirklich anheben kann.
  const merged: CSSProperties = {
    fontFamily: 'var(--w14-font-zahl)',
    fontWeight: emphasis ? 600 : 400,
    fontSize: emphasis ? 'var(--w14-betrag-zeile)' : '1em',
    fontFeatureSettings: '"tnum" 1, "lnum" 1',
    fontVariantNumeric: 'tabular-nums lining-nums',
    letterSpacing: emphasis ? '-0.015em' : undefined,
    color: negative && signed ? 'var(--w14-wax-red)' : 'inherit',
    whiteSpace: 'nowrap',
    ...style,
  };

  return (
    <span className={className} style={merged} title={title ?? valueEur}>
      {negative ? '−' : ''}
      {formatted}
    </span>
  );
}
