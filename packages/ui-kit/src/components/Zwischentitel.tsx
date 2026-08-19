/**
 * Zwischentitel — die Überschrift eines Kartenabschnitts, in reiner Schrift.
 *
 * ── BASELS ANWEISUNG VOM 19.08.2026 ────────────────────────────────────────
 *
 * Hier stand `DiamondRule`: Linie, Raute, Linie („───── ◆ ─────"), an 81
 * Stellen im Programm. Basel wörtlich: die Striche mit dem Punkt dazwischen
 * sind überall, sie sehen abstossend aus, sie sollen aus dem GANZEN Programm
 * verschwinden. Das ist eine Identitätsentscheidung des Inhabers, keine
 * Geschmacksfrage des Quelltextes.
 *
 * Die Antwort ist KEIN neues Ornament, sondern Typografie: eine Kapitälchen-
 * Zeile in der Anzeigeschrift, gesperrt gesetzt, ohne eine einzige Zierlinie.
 * Ein Abschnitt beginnt, weil eine Überschrift ihn eröffnet — nicht, weil
 * eine Linie ihn abtrennt. Die Ausrichtung erbt vom Umfeld (die Anmeldekarte
 * zentriert, eine Werkzeugkarte setzt linksbündig), darum trägt das Bauteil
 * selbst keine Meinung dazu.
 *
 * Ohne `label` war das alte Bauteil eine reine Zierlinie. Ab jetzt ist es
 * ATEMRAUM: eine stille Lücke in der Höhe einer Abstandsmarke. Trennung
 * durch Luft, nicht durch Striche.
 *
 * ── DIE TÖNE ───────────────────────────────────────────────────────────────
 *
 * `faded` (die Vorgabe) zeigt bewusst auf `--w14-ink-aged`, nicht auf das
 * blasse `--w14-ink-faded`: eine Abschnittsüberschrift ist STRUKTUR, und das
 * blasse Grau an 81 Stellen war Teil von Basels Befund „keine Lebendigkeit".
 * `gold` zeigt auf `--w14-gilt-deep` — die textsichere Stufe des Gilts
 * (das helle `--w14-gilt` misst im Hellthema nur 3,07:1 und ist für Fäden
 * und Kanten da, nie für Schrift).
 */

import type { CSSProperties } from 'react';

export interface ZwischentitelProps {
  /** Farbton der Überschrift. Vorgabe: gealterte Tinte. */
  tone?: 'ink' | 'gold' | 'wax-red' | 'faded';
  /** Ohne Text: reiner Atemraum zwischen zwei Abschnitten. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const TONE_VAR: Record<NonNullable<ZwischentitelProps['tone']>, string> = {
  ink: 'var(--w14-ink)',
  gold: 'var(--w14-gilt-deep)',
  'wax-red': 'var(--w14-wax-red)',
  faded: 'var(--w14-ink-aged)',
};

export function Zwischentitel({
  tone = 'faded',
  label,
  className,
  style,
}: ZwischentitelProps): JSX.Element {
  if (!label) {
    // Atemraum statt Zierlinie: die Lücke trennt, ohne zu zeichnen.
    return (
      <div aria-hidden className={className} style={{ height: 'var(--w14-abstand-24)', ...style }} />
    );
  }
  return (
    <div className={className} style={{ margin: '20px 0 10px', ...style }}>
      <span
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.16em',
          fontWeight: 600,
          fontSize: '0.92rem',
          lineHeight: 1.2,
          color: TONE_VAR[tone],
        }}
      >
        {label}
      </span>
    </div>
  );
}
