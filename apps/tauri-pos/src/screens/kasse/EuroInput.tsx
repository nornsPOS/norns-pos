/**
 * EuroInput — purpose-built EUR amount field for Kasse forms.
 *
 * Wire format: DecimalString matching the backend's `^\d{1,16}(\.\d{1,2})?$`.
 * The visual format is German (1.234,56 €) inside a JetBrains-Mono input —
 * memory.md §10.3 + memory.md #76 strict "money uses mono".
 *
 * Local UX rules:
 *   • operator types digits + a comma OR a dot — both produce the canonical
 *     dot-decimal output via `valueEur`.
 *   • underline-only border that turns gold on focus (matches PinPad).
 *   • the suffix shows "€" + the live formatted preview to confirm parsing.
 *
 * Touch register (opt-in `keypad`):
 *   • A purpose-built numeric keypad — NEVER a QWERTY keyboard for money
 *     (design-ux-brief §1 EuroInput, APPLY-FIRST #5). Calculator digit layout
 *     (1-2-3 top row, PrehKeyTec standard), >=56px keys with >=10px gaps,
 *     a German comma key, a backspace/correction key + a clear key.
 *   • Keys mutate the SAME canonical `valueEur` string through the SAME
 *     `normalise` parser — no separate money path, no rounding, German-comma
 *     parsing untouched. Sub-0.1s press feedback (active scale + 90ms colour).
 */

import { normalizeDecimal } from '../../lib/decimal.js';

import {
  type CSSProperties,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useId,
  useMemo,
  useState,
} from 'react';

export interface EuroInputProps {
  /** Canonical decimal string (e.g. "1234.50"). Always dot-decimal. */
  valueEur: string;
  /** Called with the new canonical string on every change. */
  onValueChange: (next: string) => void;
  label: string;
  /** Disables the input + greys the underline. */
  disabled?: boolean;
  /** Auto-focus when mounted. */
  autoFocus?: boolean;
  /** Max characters in the raw input string. Default 14. */
  maxLength?: number;
  /**
   * Render the on-screen numeric register keypad below the field.
   * Off by default so tight inline forms keep their compact layout; the
   * cashier/tender surfaces opt in for a no-QWERTY, muscle-memory keypad.
   */
  keypad?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** A single key the numeric register keypad can emit. */
type KeypadKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'comma'
  | 'backspace';

/**
 * Rohtext des Kassierers zur kanonischen Zeichenkette.
 *
 * ⚠️ 02.08.2026: hier stand eine EIGENE Kopie der Zerlegung, und sie trug
 * denselben Fehler wie die gemeinsame: sie las den ERSTEN Punkt als
 * Dezimalpunkt. `1.999,99` wurde damit zu `1.99`, also aus 1.999,99 € ein
 * Betrag von 1,99 €, und es galt als gültig. Arabische Ziffern und das
 * arabische Dezimalzeichen ٫ verschwanden ersatzlos.
 *
 * Genau die Doppelung war der Fehler: zwei Zerlegungen für dieselbe Sache
 * bleiben nur so lange gleich, bis jemand eine davon berichtigt. Jetzt ruft
 * dieses Feld die EINE Zerlegung aus `lib/decimal.ts`.
 */
function normalise(raw: string): string {
  return normalizeDecimal(raw, 2);
}

/**
 * Apply one keypad keystroke to the current canonical string.
 * Runs the result back through `normalise` so the keypad obeys the exact same
 * rules as typing (single dot, max 2 fraction digits, digits-only) — there is
 * no second money parser.
 */
function applyKey(current: string, key: KeypadKey, maxLength: number): string {
  if (key === 'backspace') return normalise(current.slice(0, -1));
  // A comma keystroke is the German decimal separator -> canonical dot.
  const appended = key === 'comma' ? `${current},` : `${current}${key}`;
  if (appended.length > maxLength) return current;
  return normalise(appended);
}

function formatPreview(canonical: string): string {
  if (canonical.length === 0) return '';
  const trimmed = canonical;
  // Don't preview half-typed input — show only when there's at least one digit.
  if (!/\d/.test(trimmed)) return '';
  const [whole, frac] = trimmed.split('.');
  const wholeFmt = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fracFmt = (frac ?? '').padEnd(2, '0').slice(0, 2);
  return `${wholeFmt},${fracFmt} €`;
}

/** Calculator digit layout — 1-2-3 top row (PrehKeyTec register standard). */
const KEYPAD_ROWS: ReadonlyArray<ReadonlyArray<KeypadKey>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['comma', '0', 'backspace'],
];

const KEY_GLYPH: Record<KeypadKey, string> = {
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  comma: ',',
  backspace: '⌫',
};

const KEY_LABEL: Record<KeypadKey, string> = {
  '0': 'Null',
  '1': 'Eins',
  '2': 'Zwei',
  '3': 'Drei',
  '4': 'Vier',
  '5': 'Fünf',
  '6': 'Sechs',
  '7': 'Sieben',
  '8': 'Acht',
  '9': 'Neun',
  comma: 'Komma',
  backspace: 'Letzte Ziffer löschen',
};

interface RegisterKeypadProps {
  valueEur: string;
  onValueChange: (next: string) => void;
  disabled: boolean;
  maxLength: number;
}

/**
 * Numeric register keypad — NEVER a QWERTY keyboard for money.
 * Calculator layout, >=56px keys, >=10px gaps, comma + backspace + clear.
 */
function RegisterKeypad({
  valueEur,
  onValueChange,
  disabled,
  maxLength,
}: RegisterKeypadProps): JSX.Element {
  const [pressed, setPressed] = useState<KeypadKey | 'clear' | null>(null);

  const press = useCallback(
    (key: KeypadKey): void => {
      if (disabled) return;
      onValueChange(applyKey(valueEur, key, maxLength));
    },
    [disabled, onValueChange, valueEur, maxLength],
  );

  const clearAll = useCallback((): void => {
    if (disabled) return;
    onValueChange('');
  }, [disabled, onValueChange]);

  const keyStyle = (active: boolean): CSSProperties => ({
    appearance: 'none',
    border: `2px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
    borderRadius: 'var(--w14-radius-card)',
    background: active ? 'var(--w14-gold-soft)' : 'var(--w14-parchment-2)',
    color: 'var(--w14-ink)',
    fontFamily: 'var(--w14-font-mono)',
    fontSize: 'var(--w14-schrift-kopf)',
    fontWeight: 600,
    // §1: >=48px hot-path; we use 56px so the inner/edge keys clear 1cm comfortably.
    minHeight: 56,
    minWidth: 56,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    userSelect: 'none',
    touchAction: 'manipulation',
    // Sub-0.1s press feedback: 90ms colour + scale, no double-tap ambiguity.
    transform: active ? 'scale(0.95)' : 'scale(1)',
    transition: 'transform var(--w14-dur-press) var(--w14-ease-curator), background-color var(--w14-dur-press) linear',
  });

  // Pointer-down so feedback + entry land before any focus race (Doherty <0.1s).
  const onDown =
    (key: KeypadKey) =>
    (ev: ReactPointerEvent<HTMLButtonElement>): void => {
      ev.preventDefault();
      setPressed(key);
      press(key);
    };
  const onClearDown = (ev: ReactPointerEvent<HTMLButtonElement>): void => {
    ev.preventDefault();
    setPressed('clear');
    clearAll();
  };
  const release = (): void => setPressed(null);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        marginTop: 'var(--space-2)',
      }}
    >
      {KEYPAD_ROWS.map((row) => (
        <div
          key={row.join('')}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}
        >
          {row.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={KEY_LABEL[key]}
              disabled={disabled}
              onPointerDown={onDown(key)}
              onPointerUp={release}
              onPointerLeave={release}
              onPointerCancel={release}
              style={keyStyle(pressed === key)}
            >
              {KEY_GLYPH[key]}
            </button>
          ))}
        </div>
      ))}
      <button
        type="button"
        aria-label="Eingabe löschen"
        disabled={disabled}
        onPointerDown={onClearDown}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        style={{
          ...keyStyle(pressed === 'clear'),
          minWidth: '100%',
          fontFamily: 'var(--w14-font-display)',
          fontSize: 'var(--w14-schrift-grund)',
          letterSpacing: '0.04em',
          color: 'var(--w14-wax-red)',
          borderColor: pressed === 'clear' ? 'var(--w14-wax-red)' : 'var(--w14-rule)',
          background: pressed === 'clear' ? 'var(--w14-wax-red-soft)' : 'var(--w14-parchment-2)',
        }}
      >
        Löschen
      </button>
    </div>
  );
}

export function EuroInput({
  valueEur,
  onValueChange,
  label,
  disabled = false,
  autoFocus = false,
  maxLength = 14,
  keypad = false,
  className,
  style,
}: EuroInputProps): JSX.Element {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const preview = useMemo(() => formatPreview(valueEur), [valueEur]);

  const onChange = (ev: ChangeEvent<HTMLInputElement>): void => {
    const next = normalise(ev.target.value);
    onValueChange(next);
  };

  const wrapStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--w14-abstand-4)',
    ...style,
  };
  const inputStyle: CSSProperties = {
    width: '100%',
    border: 'none',
    outline: 'none',
    // Unfokussiert die FELDLINIE, nie die Zierlinie: auf hellem Papier lag
    // die Zierlinie bei 1,05:1 und das Geldfeld verschmolz mit der Karte.
    borderBottom: `2px solid ${focused ? 'var(--w14-gold)' : 'var(--w14-feldlinie)'}`,
    background: 'transparent',
    color: 'var(--w14-ink)',
    fontFamily: 'var(--w14-font-mono)',
    fontSize: 'var(--w14-schrift-flaeche)', // A1: larger for fast-paced retail readability
    padding: 'var(--w14-abstand-14) var(--w14-abstand-8)', // A1: taller tap target (~52px) for touch
    minHeight: 52,
    transition: 'border-color var(--w14-dur-short) var(--w14-ease-curator)',
    opacity: disabled ? 0.55 : 1,
  };

  return (
    <div className={className} style={wrapStyle}>
      <label
        htmlFor={id}
        className="w14-smallcaps"
        style={{
          color: 'var(--w14-ink-aged)',
          fontSize: 'var(--w14-schrift-zeile)',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        value={valueEur}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        maxLength={maxLength}
        autoFocus={autoFocus}
        style={inputStyle}
      />
      <span
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-feld)',
          color: 'var(--w14-ink-faded)',
          minHeight: '1.2em',
        }}
      >
        {preview || '-'}
      </span>
      {keypad ? (
        <RegisterKeypad
          valueEur={valueEur}
          onValueChange={onValueChange}
          disabled={disabled}
          maxLength={maxLength}
        />
      ) : null}
    </div>
  );
}
