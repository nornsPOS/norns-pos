/**
 * LedgerEntry — one row in the Werkstatt right-column live feed.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ ◆ 14:32:18  transaction.finalized  ▸ €1.420,00       │
 *   │           shift • cashier • txn-id…                  │
 *   └──────────────────────────────────────────────────────┘
 *
 * Pure presentation; the parent translates `eventType` + `payload` into
 * the optional rightHint / subtitle slots. Critical-alert events
 * (alert.*) get the wax-red accent + diamond replaced with a stop-glyph.
 */

import type { CSSProperties, ReactNode } from 'react';

export interface LedgerEntryProps {
  /** ISO-8601 timestamp — rendered HH:MM:SS in viewer's locale. */
  timestamp: string;
  /** The `event_type` string from `ledger_events`. */
  eventType: string;
  /** Optional right-aligned hint (e.g. formatted money) — Mono face. */
  rightHint?: ReactNode;
  /** Smaller line beneath the title — entity ids / actor names. */
  subtitle?: ReactNode;
  /** Mark as critical alert (alert.* event types). Wax-red accents. */
  alert?: boolean;
  /** When true, render the recently-arrived flash animation (200ms fade-in). */
  fresh?: boolean;
  className?: string;
  style?: CSSProperties;
}

function timeOnly(iso: string): string {
  // ISO → HH:MM:SS in the local zone. The cashier is in Schorndorf so
  // the browser's local zone is Europe/Berlin in practice.
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export function LedgerEntry({
  timestamp,
  eventType,
  rightHint,
  subtitle,
  alert = false,
  fresh = false,
  className,
  style,
}: LedgerEntryProps): JSX.Element {
  const merged: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '78px 1fr auto',
    columnGap: 12,
    rowGap: 2,
    padding: '8px 14px',
    borderRadius: 'var(--w14-radius-card)',
    backgroundColor: 'transparent',
    color: 'var(--w14-ink)',
    transition: 'background-color var(--w14-dur-short) var(--w14-ease-curator)',
    ...style,
  };
  const freshStyle: CSSProperties = fresh
    ? {
        animation: 'w14-fresh-fade 480ms var(--w14-ease-curator)',
        backgroundColor: 'rgba(168, 133, 62, 0.06)' /* gold-soft @ 6% */,
      }
    : {};

  // No `role="listitem"` here: the consumer renders this inside a real <li>
  // within a <ul role="list">, so adding the role on this inner <div> is both
  // redundant and invalid (a listitem must be a direct child of a list).
  return (
    <div
      className={['w14-ledger-entry', alert ? 'w14-ledger-entry--alert' : null, className]
        .filter(Boolean)
        .join(' ')}
      style={{ ...merged, ...freshStyle }}
    >
      <span
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.78rem',
          color: 'var(--w14-ink-faded)',
          gridColumn: '1 / 2',
          gridRow: '1 / 2',
          alignSelf: 'baseline',
        }}
      >
        {timeOnly(timestamp)}
      </span>

      <span
        style={{
          gridColumn: '2 / 3',
          gridRow: '1 / 2',
          fontFamily: 'var(--w14-font-body)',
          fontSize: '0.9rem',
          color: alert ? 'var(--w14-wax-red)' : 'var(--w14-ink)',
          fontWeight: alert ? 600 : 500,
        }}
      >
        {/* 19.08.2026: die Raute vor dem Ereignis fiel (Basels Anweisung);
            der Mittelpunkt markiert die Zeile, ohne zu schmücken. */}
        <span aria-hidden style={{ marginRight: 6, opacity: 0.6 }}>
          {alert ? '✕' : '·'}
        </span>
        {eventType}
      </span>

      {rightHint !== undefined && (
        <span
          style={{
            gridColumn: '3 / 4',
            gridRow: '1 / 2',
            justifySelf: 'end',
            alignSelf: 'baseline',
          }}
        >
          {rightHint}
        </span>
      )}

      {subtitle !== undefined && (
        <span
          style={{
            gridColumn: '2 / 4',
            gridRow: '2 / 3',
            fontFamily: 'var(--w14-font-body)',
            fontSize: '0.78rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {subtitle}
        </span>
      )}

      <style>{`
        @keyframes w14-fresh-fade {
          0%   { background-color: rgba(168, 133, 62, 0.20); }
          100% { background-color: rgba(168, 133, 62, 0.06); }
        }
        @media (prefers-reduced-motion: reduce) {
          .w14-ledger-entry { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
