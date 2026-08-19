/**
 * Textarea — brand multi-line input. Shares the control surface + invalid
 * state with Input; min-height comfortably exceeds the 48px touch floor.
 */
import { type TextareaHTMLAttributes, forwardRef, useState } from 'react';

import { baseControlStyle, controlIsInvalid } from './Input.js';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { mono, invalid, style, onFocus, onBlur, disabled, rows = 3, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const isInvalid = controlIsInvalid(invalid, rest['aria-invalid']);
  return (
    <textarea
      ref={ref}
      rows={rows}
      disabled={disabled}
      onFocus={(ev) => {
        setFocused(true);
        onFocus?.(ev);
      }}
      onBlur={(ev) => {
        setFocused(false);
        onBlur?.(ev);
      }}
      style={{
        ...baseControlStyle({ mono, invalid: isInvalid, focused, disabled }),
        minHeight: 72,
        resize: 'vertical',
        lineHeight: 1.5,
        ...style,
      }}
      {...rest}
    />
  );
});
