/**
 * SubBreadcrumb — the 32-px line beneath the Karteikasten rail.
 *
 * Shown ONLY on Tier-2 surfaces or when a Tier-1 surface drills into a
 * detail view. Cormorant Italic small-caps, with the leading surface
 * digit (1..8) in JetBrains Mono. Tier-2 surfaces without a chip number
 * beginnen direkt mit ihrem Namen — hier stand eine Raute als Platzhalter,
 * bis Basels Anweisung vom 19.08.2026 die Raute aus dem ganzen Programm
 * verbannte.
 *
 *   3 · Ankauf · Belegnummer 47
 *   Edelmetallkursraum
 */

import type { CSSProperties, ReactNode } from 'react';

import type { Rueckweg } from './rueckweg.js';

export interface SubBreadcrumbProps {
  /** Tier-1 digit (1..8). Omit for Tier-2 surfaces — a diamond renders instead. */
  digit?: number;
  label: string;
  /** Optional trailing breadcrumb segments rendered after the label. */
  trail?: ReactNode;
  /**
   * Der benannte Weg zurück, falls es von hier einen gibt.
   *
   * ⚠️ 20.08.2026: bis heute hatte diese Zeile KEINEN. Die vierzehn
   * sekundären Flächen stehen in keinem Karteireiter, also blieb dem
   * Menschen nur, irgendeinen der acht zu drücken — und woanders zu landen
   * als dort, wo er herkam. `rueckwegFuer` entscheidet, ob und wohin.
   */
  zurueck?: Rueckweg | null;
  /** Wird gerufen, wenn er den Weg zurück nimmt. */
  onZurueck?: (pfad: string) => void;
}

export function SubBreadcrumb({
  digit,
  label,
  trail,
  zurueck,
  onZurueck,
}: SubBreadcrumbProps): JSX.Element {
  const rowStyle: CSSProperties = {
    height: 32,
    padding: '0 var(--w14-abstand-20)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--w14-abstand-8)',
    fontFamily: 'var(--w14-font-display)',
    fontStyle: 'italic',
    fontVariant: 'all-small-caps',
    letterSpacing: '0.1em',
    fontSize: 'var(--w14-schrift-zeile)',
    color: 'var(--w14-ink-faded)',
    borderBottom: '1px solid var(--w14-rule)',
    backgroundColor: 'var(--w14-parchment)',
  };
  return (
    <nav aria-label="Pfad" style={rowStyle}>
      {/* Der Weg zurück steht VOR dem Namen — links, wo die Hand ihn sucht,
          und mit dem Ziel darauf statt dem blossen Wort „zurück". Wer liest
          „Einstellungen", weiss, wo er gleich steht. */}
      {zurueck && onZurueck && (
        <>
          <button
            type="button"
            onClick={() => onZurueck(zurueck.pfad)}
            title={`Zurück zu ${zurueck.label}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--w14-abstand-4)',
              // Die Zeile ist 32 hoch; der Knopf füllt sie ganz, damit das
              // Ziel auch mit dem Finger sicher zu treffen ist.
              height: 32,
              margin: '0 var(--w14-abstand-4) 0 calc(var(--w14-abstand-8) * -1)',
              padding: '0 var(--w14-abstand-8)',
              font: 'inherit',
              fontVariant: 'all-small-caps',
              letterSpacing: 'inherit',
              color: 'var(--w14-ink-aged)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'color var(--w14-dur-fast) var(--w14-ease-hover)',
            }}
          >
            <span aria-hidden style={{ fontStyle: 'normal', lineHeight: 1 }}>
              ←
            </span>
            {zurueck.label}
          </button>
          <span aria-hidden style={{ opacity: 0.45 }}>
            ·
          </span>
        </>
      )}
      {digit !== undefined && (
        <>
          <span
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontStyle: 'normal',
              letterSpacing: 0,
              fontSize: 'var(--w14-schrift-feld)',
              color: 'var(--w14-ink-aged)',
            }}
          >
            {digit}
          </span>
          <span aria-hidden style={{ opacity: 0.45 }}>
            ·
          </span>
        </>
      )}
      <span>{label}</span>
      {trail && (
        <>
          <span aria-hidden style={{ opacity: 0.45 }}>
            ·
          </span>
          <span>{trail}</span>
        </>
      )}
    </nav>
  );
}
