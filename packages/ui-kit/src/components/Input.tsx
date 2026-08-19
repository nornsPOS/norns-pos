/**
 * Input — brand text/number input. Parchment-3 surface, ≥48px touch height,
 * JetBrains-mono opt-in for numeric / SKU fields, error state via aria-invalid.
 *
 * Forwards its ref so a Dialog can take it as `initialFocusRef`.
 */
import { type CSSProperties, type InputHTMLAttributes, forwardRef, useState } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Use the mono typeface — for SKUs, amounts, hashes (tabular numbers). */
  mono?: boolean;
  /** Visually mark the field invalid. Also inferred from aria-invalid. */
  invalid?: boolean;
}

export function controlIsInvalid(
  invalid: boolean | undefined,
  ariaInvalid: InputHTMLAttributes<HTMLInputElement>['aria-invalid'],
): boolean {
  return invalid === true || ariaInvalid === true || ariaInvalid === 'true';
}

export function baseControlStyle(opts: {
  mono?: boolean | undefined;
  invalid?: boolean | undefined;
  focused?: boolean | undefined;
  disabled?: boolean | undefined;
}): CSSProperties {
  const borderColor = opts.invalid
    ? 'var(--w14-wax-red)'
    : opts.focused
      ? 'var(--w14-ink)'
      : 'var(--w14-rule)';
  return {
    width: '100%',
    minHeight: 48,
    padding: '12px 14px',
    background: 'var(--w14-parchment-3)',
    color: 'var(--w14-ink)',
    border: `1px solid ${borderColor}`,
    borderRadius: 'var(--w14-radius-button)',
    outline: 'none',
    fontFamily: opts.mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
    fontSize: '1rem',
    opacity: opts.disabled ? 0.55 : 1,
    boxShadow: opts.focused ? 'var(--w14-focus-shadow)' : 'none',
    transition:
      'border-color var(--w14-dur-short) var(--w14-ease-curator),' +
      ' box-shadow var(--w14-dur-short) var(--w14-ease-curator)',
  };
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono, invalid, style, onFocus, onBlur, disabled, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const isInvalid = controlIsInvalid(invalid, rest['aria-invalid']);
  return (
    <input
      ref={ref}
      disabled={disabled}
      className="w14-tabular"
      onFocus={(ev) => {
        setFocused(true);
        onFocus?.(ev);
      }}
      onBlur={(ev) => {
        setFocused(false);
        onBlur?.(ev);
      }}
      style={{ ...baseControlStyle({ mono, invalid: isInvalid, focused, disabled }), ...style }}
      {...rest}
    />
  );
});
