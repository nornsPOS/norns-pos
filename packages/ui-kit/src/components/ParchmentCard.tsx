/**
 * ParchmentCard — the base surface every card, panel, drawer sits on.
 *
 * Parchment-2 background, hairline ink rule on the bottom (1px shadow,
 * not box border — preserves the "printed on paper" feel), the card
 * radius (`--w14-radius-card`, 8px — 1:1 with apps/mobile), 24px interior
 * padding by default.
 *
 *   <ParchmentCard>
 *     <h3>Werkstatt</h3>
 *     <Zwischentitel />
 *     …
 *   </ParchmentCard>
 *
 * The `tone="deep"` variant goes parchment-3 for two-tier nesting. The
 * `tone="ink"` variant is the inversion (dark card on parchment) used for
 * Owner-only callouts.
 */

import type { CSSProperties, HTMLAttributes, KeyboardEvent, ReactNode } from 'react';

export interface ParchmentCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: 'parchment' | 'deep' | 'ink';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Apply the subtle marbled-noise overlay. Default: true. */
  noise?: boolean;
}

const PADDING_PX = { none: 0, sm: 12, md: 24, lg: 32 } as const;

const TONE_BG: Record<NonNullable<ParchmentCardProps['tone']>, string> = {
  parchment: 'var(--w14-parchment-2)',
  deep: 'var(--w14-parchment-3)',
  ink: 'var(--w14-ink)',
};

const TONE_FG: Record<NonNullable<ParchmentCardProps['tone']>, string> = {
  parchment: 'var(--w14-ink)',
  deep: 'var(--w14-ink)',
  ink: 'var(--w14-parchment)',
};

export function ParchmentCard({
  children,
  tone = 'parchment',
  padding = 'md',
  noise = true,
  className,
  style,
  onClick,
  onKeyDown,
  role,
  tabIndex,
  ...rest
}: ParchmentCardProps): JSX.Element {
  const merged: CSSProperties = {
    backgroundColor: TONE_BG[tone],
    color: TONE_FG[tone],
    borderRadius: 'var(--w14-radius-card)',
    boxShadow: 'var(--w14-shadow-card)',
    padding: PADDING_PX[padding],
    position: 'relative',
    isolation: 'isolate',
    ...style,
  };
  const classes = ['w14-card', noise && tone !== 'ink' ? 'w14-paper-noise' : null, className]
    .filter(Boolean)
    .join(' ');

  // When the card is given an onClick it behaves like an interactive control.
  // Give it keyboard parity (role=button + tab stop + Enter/Space activation)
  // so it is reachable and operable without a mouse — unless the caller has
  // already supplied their own role/tabIndex/onKeyDown.
  const interactive = typeof onClick === 'function';
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (!interactive || event.defaultPrevented) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.(event as unknown as Parameters<NonNullable<typeof onClick>>[0]);
    }
  };

  return (
    <div
      className={classes}
      style={merged}
      onClick={onClick}
      onKeyDown={interactive || onKeyDown ? handleKeyDown : undefined}
      role={role ?? (interactive ? 'button' : undefined)}
      tabIndex={interactive ? (tabIndex ?? 0) : tabIndex}
      {...rest}
    >
      {children}
    </div>
  );
}
