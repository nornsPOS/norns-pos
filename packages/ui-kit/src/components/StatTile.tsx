/**
 * StatTile — the Werkstatt dashboard cell.
 *
 *   ┌──────────────┐
 *   │ ◆ I          │  ← optional Roman index (the dashboard "page number")
 *   │              │
 *   │      47      │  ← value, large Bricolage Grotesque
 *   │ Meine Aufgaben│  ← label, small-caps
 *   │              │
 *   │ ⚪ Action       │  ← optional attention dot + caption (wax-red when urgent)
 *   └──────────────┘
 *
 * Pure presentation: parent owns the data + when to flag `attention`.
 * Hover lifts a 1-px gold hairline (matches Button hover).
 */

import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';

import { RomanIndex } from './RomanIndex.js';

export interface StatTileProps {
  /** Big numeric or short text (already formatted — no locale work here). */
  value: ReactNode;
  /** Caption underneath, small-caps. */
  label: string;
  /** Optional Roman index in the top-left (1-based dashboard ordering). */
  index?: number;
  /** "Needs attention" — adds a wax-red dot + tinted accent caption. */
  attention?: boolean;
  /** Caption right of the attention dot. Shows only when attention=true. */
  attentionCaption?: string;
  /** Click handler — when present the tile becomes a button. */
  onClick?: MouseEventHandler<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
}

export function StatTile({
  value,
  label,
  index,
  attention = false,
  attentionCaption,
  onClick,
  className,
  style,
}: StatTileProps): JSX.Element {
  const interactive = typeof onClick === 'function';

  const merged: CSSProperties = {
    backgroundColor: 'var(--w14-parchment-2)',
    color: 'var(--w14-ink)',
    border: '1px solid transparent',
    borderRadius: 'var(--w14-radius-card)',
    boxShadow: 'var(--w14-shadow-card)',
    padding: '20px 22px',
    minHeight: 132,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    cursor: interactive ? 'pointer' : 'default',
    transition:
      'border-color var(--w14-dur-short) var(--w14-ease-curator),' +
      ' box-shadow var(--w14-dur-short) var(--w14-ease-curator)',
    ...style,
  };

  return (
    <div
      role={interactive ? 'button' : 'group'}
      tabIndex={interactive ? 0 : -1}
      className={['w14-tile', attention ? 'w14-tile--attention' : null, className]
        .filter(Boolean)
        .join(' ')}
      style={merged}
      onClick={onClick}
      onKeyDown={(ev) => {
        if (!interactive) return;
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          (ev.currentTarget as HTMLDivElement).click();
        }
      }}
      onMouseEnter={(ev) => {
        (ev.currentTarget as HTMLDivElement).style.borderColor = 'var(--w14-gilt)';
      }}
      onMouseLeave={(ev) => {
        (ev.currentTarget as HTMLDivElement).style.borderColor = 'transparent';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        {index !== undefined ? (
          <RomanIndex value={index} tone="faded" />
        ) : (
          /* 19.08.2026: hier stand eine Raute als Platzhalter — Basels
             Anweisung verbannt sie. Der leere Träger hält nur das Layout. */
          <span aria-hidden />
        )}
        {attention && (
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: 'var(--w14-wax-red)',
            }}
          />
        )}
      </div>

      <div
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: '2.4rem',
          lineHeight: 1,
          margin: '12px 0 6px',
          color: attention ? 'var(--w14-wax-red)' : 'var(--w14-ink)',
        }}
      >
        {value}
      </div>

      <div
        className="w14-smallcaps"
        style={{
          color: 'var(--w14-ink-faded)',
          fontSize: '0.78rem',
        }}
      >
        {label}
      </div>

      {attention && attentionCaption && (
        <div
          style={{
            marginTop: 6,
            color: 'var(--w14-wax-red-soft)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.85rem',
          }}
        >
          {attentionCaption}
        </div>
      )}
    </div>
  );
}
