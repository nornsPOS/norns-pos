/**
 * Werkstatt header — Seal on the left, brand title + today's date in the
 * middle, live SSE indicator on the right.
 *
 * The SSE dot pulses gold when `status === 'open'`, wax-red when
 * `reconnecting`, faded ink when `closed`. It is intentionally tiny —
 * the operator should never have to look for it; only notice when
 * something is wrong.
 */

import type { CSSProperties } from 'react';

import { Zwischentitel } from '@norns/ui-kit';


export interface WerkstattHeaderProps {
  operatorName: string;
  todayLabel: string;
}

/*
 * ⚰️ 21.08.2026: hier standen DOT_COLOR und DOT_LABEL — ein zweiter
 * Leuchtpunkt samt Wort „Live" neben der Überschrift. Basels Anweisung:
 * EIN Systemlicht, oben neben den Einstellungen (HealthDot in der
 * Kopfleiste). Zwei Lichter, die dasselbe sagen, sind eines zu viel; und
 * wenn sie sich je widersprächen, wüsste niemand, welches lügt.
 */

export function WerkstattHeader({ operatorName, todayLabel }: WerkstattHeaderProps): JSX.Element {
  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    gap: 'var(--space-6)',
    alignItems: 'center',
    padding: 'var(--space-5) var(--space-7)',
  };

  return (
    <header>
      <div style={rowStyle}>
        {/* Die Ziffer der Fläche, wie auf jedem anderen Kopf. Ohne sie fiel
            das Siegel auf die Vorgabe zurück, und das war bis zum 04.08.2026
            ein N im Kreis: eine zweite, erfundene Marke. */}
        <div>
          <h1
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: 'var(--w14-schrift-flaeche)',
              margin: 0,
              letterSpacing: '0.02em',
            }}
          >
            Werkstatt
          </h1>
          <p
            style={{
              margin: 0,
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-betont)',
            }}
          >
            {todayLabel} · {operatorName}
          </p>
        </div>
      </div>
      <Zwischentitel />
    </header>
  );
}
