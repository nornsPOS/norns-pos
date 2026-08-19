/**
 * Seal — das gestempelte Medaillon der Marke.
 *
 * ⚠️ 31.07.2026: HIER STAND EINE FREMDE MARKE.
 *
 * Die Vorgabe war `label = '14'` — das Zeichen von Warehouse14. In Norns POS
 * trug damit JEDE Flaeche, die dieses Siegel benutzt, das Zeichen eines
 * anderen Hauses: 28 Dateien, darunter der Startbildschirm, die Anmeldung und
 * die Fehlerflaeche „Keine Verbindung zum Server". Basel sah es dort zuerst.
 *
 * Es war nie eine einzelne vergessene Zeichenkette, sondern EINE Vorgabe, die
 * sich ueber das ganze Programm ausgoss. Deshalb ist die Heilung auch nur eine
 * Zeile: die Marke gehoert an EINE Stelle, und von dort in jede Flaeche.
 *
 * Three sizes (sm 32px, md 56px, lg 96px). Used as the persistent app icon
 * in the nav rail + as the receipt header + as an empty-state focal point.
 * The number may be overridden — useful for showing daily counters ("N° 47")
 * or shift IDs on the operator footer.
 */

import type { CSSProperties, ReactNode } from 'react';

export interface SealProps {
  /**
   * Was im Siegel steht: das Zeichen DIESER Flaeche, etwa die Ziffer aus der
   * Zeichensprache, ein `§` oder ein `◊`.
   *
   * ⚠️ NICHT die Marke des Hauses. Die ist `NornsZeichen`, und sie hat einen
   * Faden, keinen Ring. Vorgabe ist deshalb die Raute, nicht ein Buchstabe.
   */
  label?: string;
  /**
   * SVG-Motiv statt Text im Siegel (z. B. ein lucide-Icon als verschachteltes
   * `<svg>` mit `x`/`y`/`width`/`height` im 100er-Koordinatenraum).
   *
   * WARUM (26.07.2026): das Step-up-Siegel trug `label="🔒"` — im SVG-Text
   * rendert Windows daraus ein buntes Segoe-Emoji mitten im gestempelten
   * Ring. Ein Strich-Motiv in currentColor bleibt auf jedem System gleich.
   */
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Stroke + text colour. Default: ink. */
  tone?: 'ink' | 'gold' | 'wax-red' | 'faded';
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/**
 * ⚠️ 04.08.2026: DIESE VORGABE WAR DAS N IM KREIS.
 *
 * Hier stand `const MARKE = 'N'`. Am 31.07. hatte ich damit die fremde `'14'`
 * ersetzt und es fuer erledigt gehalten. Es war nur der zweite Fehler an
 * derselben Stelle.
 *
 * Denn Basel hat das Zeichen des Hauses am 04.08. woertlich benannt: das N
 * mit dem terrakottaroten Faden IST das Logo, es steht in `NornsZeichen`, und
 * er will „bedon حرف N ذهبي" — kein goldenes N. Ein gestempelter Ring mit
 * einem gesetzten Grossbuchstaben darin ist eine ZWEITE, erfundene Marke. Auf
 * `LocalLock` stand sie sogar in Gilt: ein goldenes N, genau das Verbotene.
 *
 * Getroffen hatte es sieben Flaechen, weil sie `label` weggelassen haben:
 * die Fehlerflaeche „Keine Verbindung", das Startbild, den Werkstattkopf, das
 * Geraeteschloss, das Konfliktpostfach und zwei weitere.
 *
 * ── DIE HEILUNG IST DIE VORGABE, NICHT DIE SIEBEN STELLEN ──────────────────
 *
 * Das Siegel ist ab jetzt ein MEDAILLON um ein eigenes Zeichen der Flaeche
 * (eine Ziffer, ein §, ein ◊) und NIE die Marke. Wer die Marke zeigen will,
 * nimmt `NornsZeichen`. Faellt kuenftig wieder jemand das `label` weg,
 * erscheint die Raute des Hauses, kein Buchstabe, der sich als Logo ausgibt.
 */
const MARKE = '◊';

const SIZE_PX = { sm: 32, md: 56, lg: 96 } as const;

const TONE_VAR: Record<NonNullable<SealProps['tone']>, string> = {
  ink: 'var(--w14-ink)',
  gold: 'var(--w14-gilt)',
  'wax-red': 'var(--w14-wax-red)',
  faded: 'var(--w14-ink-faded)',
};

export function Seal({
  label = MARKE,
  size = 'md',
  tone = 'ink',
  className,
  style,
  title,
  children,
}: SealProps): JSX.Element {
  const px = SIZE_PX[size];
  const merged: CSSProperties = {
    color: TONE_VAR[tone],
    width: px,
    height: px,
    ...style,
  };

  // Font size proportional to ring radius; the display face takes the lead inside.
  const fontSize = Math.round(px * 0.52);

  return (
    <svg
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      viewBox="0 0 100 100"
      className={className}
      style={merged}
      fill="none"
    >
      {/* outer ring — slightly off-true to feel hand-stamped */}
      <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="2.5" />
      {/* inner hairline ring */}
      <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="0.6" opacity="0.55" />
      {children ?? (
      <text
        x="50"
        y="50"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="var(--w14-font-display)"
        fontWeight={500}
        fontStyle="normal"
        fontSize={fontSize}
        fill="currentColor"
      >
        {label}
      </text>
      )}
    </svg>
  );
}
