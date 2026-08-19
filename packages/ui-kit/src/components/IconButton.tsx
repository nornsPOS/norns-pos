import type { LucideIcon } from 'lucide-react';
/**
 * IconButton — an icon-only button for universal actions. ALWAYS requires an
 * accessible name (`label` → aria-label + title). Touch-first: ≥44px target,
 * brand hover (parchment-3) + a gold focus ring. Use for delete/close/search/
 * add/print/back/edit; anything non-obvious must use a label, not an icon alone.
 *
 * Zustände (hover, focus-visible, Druck) leben als `.w14-icon-button` in
 * tokens.css. Vorher hielt das Bauteil dafür zwei useState und vier Handler —
 * und konnte trotzdem keinen Druck ausdrücken, weil :active im Inline-Stil
 * nicht existiert.
 */
import { type ButtonHTMLAttributes, type CSSProperties, forwardRef } from 'react';

import { Icon } from './Icon.js';

export type IconButtonTone = 'default' | 'muted' | 'danger';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: LucideIcon;
  /** REQUIRED accessible name — becomes aria-label + the hover title. */
  label: string;
  /** Icon pixel size (the button stays ≥44px regardless). */
  iconSize?: number;
  tone?: IconButtonTone;
}

const TONE_COLOR: Record<IconButtonTone, string> = {
  default: 'var(--w14-ink-aged)',
  muted: 'var(--w14-ink-faded)',
  danger: 'var(--w14-wax-red)',
};

const BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 44,
  minHeight: 44,
  padding: 0,
  border: 'none',
  borderRadius: 'var(--w14-radius-button)',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, iconSize = 20, tone = 'default', disabled, className, style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={['w14-icon-button', className].filter(Boolean).join(' ')}
      style={{
        ...BASE,
        color: TONE_COLOR[tone],
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        ...style,
      }}
      {...rest}
    >
      <Icon icon={icon} size={iconSize} />
    </button>
  );
});
