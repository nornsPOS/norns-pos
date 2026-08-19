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

import type { SseStatus } from '../../hooks/useLedgerStream.js';

export interface WerkstattHeaderProps {
  operatorName: string;
  sseStatus: SseStatus;
  todayLabel: string;
}

const DOT_COLOR: Record<SseStatus, string> = {
  idle: 'var(--w14-ink-faded)',
  connecting: 'var(--w14-gold-soft)',
  open: 'var(--w14-gold)',
  reconnecting: 'var(--w14-wax-red)',
  closed: 'var(--w14-ink-faded)',
};

const DOT_LABEL: Record<SseStatus, string> = {
  idle: 'Inaktiv',
  connecting: 'Verbindet…',
  open: 'Live',
  reconnecting: 'Wiederverbinden…',
  closed: 'Getrennt',
};

export function WerkstattHeader({
  operatorName,
  sseStatus,
  todayLabel,
}: WerkstattHeaderProps): JSX.Element {
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
        <div
          aria-label={`SSE-Status: ${DOT_LABEL[sseStatus]}`}
          title={DOT_LABEL[sseStatus]}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--w14-abstand-8)',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontVariant: 'all-small-caps',
            letterSpacing: '0.1em',
            fontSize: 'var(--w14-schrift-zeile)',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              backgroundColor: DOT_COLOR[sseStatus],
              boxShadow: sseStatus === 'open' ? '0 0 0 2px rgba(168, 133, 62, 0.18)' : 'none',
              transition: 'background-color var(--w14-dur-medium) var(--w14-ease-curator)',
            }}
          />
          {DOT_LABEL[sseStatus]}
        </div>
      </div>
      <Zwischentitel />
    </header>
  );
}
