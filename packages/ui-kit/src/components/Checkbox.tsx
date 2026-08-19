/**
 * Checkbox — brand checkbox with an inline label. The hit target (label +
 * box) comfortably clears the 48px touch floor. Forwards its ref + props,
 * so it slots into <Field> like the other controls.
 */
import { type InputHTMLAttributes, type ReactNode, forwardRef, useId } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, id, disabled, style, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label
      htmlFor={inputId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        disabled={disabled}
        style={{ width: 22, height: 22, accentColor: 'var(--w14-ink)', cursor: 'inherit' }}
        {...rest}
      />
      <span
        style={{ fontFamily: 'var(--w14-font-body)', fontSize: '0.95rem', color: 'var(--w14-ink)' }}
      >
        {label}
      </span>
    </label>
  );
});
