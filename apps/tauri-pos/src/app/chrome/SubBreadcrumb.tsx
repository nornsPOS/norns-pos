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

export interface SubBreadcrumbProps {
  /** Tier-1 digit (1..8). Omit for Tier-2 surfaces — a diamond renders instead. */
  digit?: number;
  label: string;
  /** Optional trailing breadcrumb segments rendered after the label. */
  trail?: ReactNode;
}

export function SubBreadcrumb({ digit, label, trail }: SubBreadcrumbProps): JSX.Element {
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
