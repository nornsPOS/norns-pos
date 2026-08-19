import { Delete } from 'lucide-react';
/**
 * AmountPad — a large on-screen numeric keypad for POS amount entry (the cash
 * RECEIVED at Bezahlen). The pure `amountPadReduce` owns the input logic so the
 * view stays a thin, testable shell. The component DISPLAYS a German-comma
 * value and EMITS a canonical dot-decimal via `onChange` (the money math
 * downstream — computeTender — is never reimplemented here).
 *
 * Touch-first: every key is ≥56px. Backspace uses the Icon system (lucide
 * Delete). A quick-tender row offers "Passend" (exact due) + common notes.
 */
import { type CSSProperties, useEffect, useState } from 'react';

import { Icon } from './Icon.js';

export type AmountPadKey =
  | { type: 'digit'; digit: string }
  | { type: 'decimal' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'set'; value: string };

/** Number of fraction digits in a German-comma display string (−1 = no comma). */
function fractionLength(display: string): number {
  const i = display.indexOf(',');
  return i === -1 ? -1 : display.length - i - 1;
}

/** Parse a value that may be canonical dot-decimal OR German comma → number. */
function toNumber(s: string): number {
  const dot = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return Number(dot);
}

/** PURE input reducer: (current display, key) → next display (German comma). */
export function amountPadReduce(current: string, key: AmountPadKey): string {
  switch (key.type) {
    case 'clear':
      return '';
    case 'backspace':
      return current.slice(0, -1);
    case 'decimal':
      if (current.includes(',')) return current; // a single decimal only
      return current === '' ? '0,' : `${current},`;
    case 'set': {
      const n = toNumber(key.value);
      if (!Number.isFinite(n)) return current;
      return n.toFixed(2).replace('.', ',');
    }
    case 'digit': {
      if (fractionLength(current) >= 2) return current; // 2-decimal cap
      if (current === '' || current === '0') return key.digit; // replace leading zero
      return current + key.digit;
    }
  }
}

/** German display ("12,50" / "12," / "") → canonical dot-decimal ("12.50" / "12" / ""). */
function displayToCanonical(display: string): string {
  if (display === '') return '';
  return display.replace(',', '.').replace(/\.$/, '');
}

/** Canonical ("12.50") → display ("12,50"); '' stays ''. */
function canonicalToDisplay(canonical: string): string {
  if (canonical === '') return '';
  const n = toNumber(canonical);
  if (!Number.isFinite(n)) return '';
  // Keep it as typed if it's already a clean integer/decimal; show with comma.
  return canonical.includes('.') ? canonical.replace('.', ',') : canonical;
}

export interface AmountPadProps {
  /** Canonical dot-decimal of the current amount; '' for empty. */
  value: string;
  /** Emits the canonical dot-decimal after each key. */
  onChange: (canonical: string) => void;
  /** Due total (canonical) — powers the "Passend" quick-tender. */
  dueEur?: string;
  /** Quick-tender note denominations (canonical). */
  notes?: readonly string[];
}

const DEFAULT_NOTES = ['5', '10', '20', '50', '100', '200'] as const;

const KEY_BASE: CSSProperties = {
  minHeight: 56,
  minWidth: 56,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment-2)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-mono)',
  fontSize: '1.3rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export function AmountPad({
  value,
  onChange,
  dueEur,
  notes = DEFAULT_NOTES,
}: AmountPadProps): JSX.Element {
  const [display, setDisplay] = useState<string>(() => canonicalToDisplay(value));

  // Re-sync if the parent resets the value externally (e.g. on dialog open).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-syncs only when the parent `value` changes; depending on `display` would clobber in-progress typing.
  useEffect(() => {
    if (displayToCanonical(display) !== value) {
      setDisplay(canonicalToDisplay(value));
    }
  }, [value]);

  const apply = (key: AmountPadKey): void => {
    const next = amountPadReduce(display, key);
    setDisplay(next);
    onChange(displayToCanonical(next));
  };

  const padKey = (
    label: string,
    key: AmountPadKey,
    ariaLabel?: string,
    extra?: CSSProperties,
  ): JSX.Element => (
    <button
      key={ariaLabel ?? label}
      type="button"
      aria-label={ariaLabel ?? label}
      onClick={() => apply(key)}
      style={{ ...KEY_BASE, ...extra }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Value display */}
      <output
        className="w14-tabular"
        style={{
          display: 'block',
          textAlign: 'right',
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '1.8rem',
          fontWeight: 700,
          padding: '10px 14px',
          background: 'var(--w14-parchment-3)',
          borderRadius: 'var(--w14-radius-button)',
          color: 'var(--w14-ink)',
          minHeight: 32,
        }}
      >
        {display === '' ? '0' : display} €
      </output>

      {/* Quick-tender row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {dueEur && (
          <button
            type="button"
            aria-label="Passend"
            onClick={() => apply({ type: 'set', value: dueEur })}
            style={{
              ...KEY_BASE,
              minHeight: 44,
              flex: '1 1 auto',
              background: 'var(--w14-ink)',
              color: 'var(--w14-parchment-2)',
              borderColor: 'var(--w14-ink)',
              fontSize: '0.95rem',
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            Passend {toNumber(dueEur).toFixed(2).replace('.', ',')} €
          </button>
        )}
        {notes.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} Euro`}
            onClick={() => apply({ type: 'set', value: n })}
            style={{ ...KEY_BASE, minHeight: 44, fontSize: '0.95rem', flex: '1 0 auto' }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {n} €
          </button>
        ))}
      </div>

      {/* Numeric keypad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((d) =>
          padKey(d, { type: 'digit', digit: d }),
        )}
        {padKey(',', { type: 'decimal' }, 'Komma')}
        {padKey('0', { type: 'digit', digit: '0' })}
        <button
          type="button"
          aria-label="Letzte Ziffer löschen"
          onClick={() => apply({ type: 'backspace' })}
          style={KEY_BASE}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Icon icon={Delete} size={24} />
        </button>
      </div>
    </div>
  );
}
