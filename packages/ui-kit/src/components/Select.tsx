/**
 * Select — brand dropdown. Same control surface + invalid state as Input;
 * a chevron affordance is drawn via a background SVG so the native control
 * keeps full keyboard + screen-reader behaviour.
 */
import { type SelectHTMLAttributes, forwardRef, useState } from 'react';

import { baseControlStyle, controlIsInvalid } from './Input.js';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

const CHEVRON =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, style, onFocus, onBlur, disabled, children, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const isInvalid = controlIsInvalid(invalid, rest['aria-invalid']);
  return (
    <select
      ref={ref}
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
        ...baseControlStyle({ invalid: isInvalid, focused, disabled }),
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none',
        backgroundImage: CHEVRON,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
        paddingRight: 40,
        cursor: disabled ? 'default' : 'pointer',
        ...style,
      }}
      {...rest}
    >
      {children}
    </select>
  );
});
