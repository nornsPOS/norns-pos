/**
 * Field — the form-accessibility wrapper. Wraps a single control (Input,
 * Select, Textarea, Checkbox) with a <label>, an optional hint, and an
 * inline error, and wires the aria relationships so screen readers and the
 * operator both get the same guidance:
 *   • <label for> ↔ control id
 *   • aria-describedby → hint id and/or error id
 *   • aria-invalid="true" when there is an error
 *   • aria-required when required
 *
 * The control is cloned, so callers write the natural `<Field label="…">
 * <Input/></Field>` and the ids are managed for them.
 */
import { type CSSProperties, type ReactElement, cloneElement, isValidElement, useId } from 'react';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** Exactly one control element (Input / Select / Textarea / Checkbox). */
  children: ReactElement;
}

const LABEL_STYLE: CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--w14-ink-faded)',
};

const HINT_STYLE: CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  color: 'var(--w14-ink-faded)',
};

const ERROR_STYLE: CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--w14-wax-red)',
};

export function Field({ label, hint, error, required, children }: FieldProps): JSX.Element {
  const base = useId();
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const fallbackControlId = `${base}-control`;

  const hasError = typeof error === 'string' && error.length > 0;

  const childProps: Record<string, unknown> = isValidElement(children)
    ? (children.props as Record<string, unknown>)
    : {};
  const controlId = (childProps.id as string | undefined) ?? fallbackControlId;

  const describedBy =
    [
      childProps['aria-describedby'] as string | undefined,
      hint ? hintId : null,
      hasError ? errorId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  const control = cloneElement(children, {
    id: controlId,
    'aria-invalid': hasError ? 'true' : (childProps['aria-invalid'] as string | undefined),
    'aria-describedby': describedBy,
    'aria-required': required ? 'true' : (childProps['aria-required'] as string | undefined),
  } as Record<string, unknown>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={controlId} className="w14-smallcaps" style={LABEL_STYLE}>
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--w14-wax-red)' }}>
            {' *'}
          </span>
        )}
      </label>
      {control}
      {hint && (
        <p id={hintId} style={HINT_STYLE}>
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} role="alert" style={ERROR_STYLE}>
          {error}
        </p>
      )}
    </div>
  );
}
