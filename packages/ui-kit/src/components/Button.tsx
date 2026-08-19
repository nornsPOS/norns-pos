/**
 * Button — three variants, two sizes. The primary fill is INK (the official
 * store system: ink is the accent; gold is a thread/edge/seal only, never a
 * fill). Ghost/destructive get a subtle gilt underline swash on hover.
 *
 *   <Button variant="primary">Verkauf abschließen</Button>
 *   <Button variant="destructive">Storno</Button>
 *   <Button variant="ghost">Abbrechen</Button>
 *
 * Owner-step-up actions wrap the button in a separate StepUpGuard component
 * (Phase 2 Day 3) — Button itself is presentation-only.
 *
 * ── Zustände leben in CSS (tokens.css), nicht hier ──────────────────────
 * hover/focus lagen früher als onMouseEnter/onFocus-Stilgefummel in diesem
 * Bauteil. Damit war ein Druckzustand UNMÖGLICH: :active kann ein
 * Inline-Stil nicht ausdrücken, und so hat am Tresen kein Knopf den Finger
 * quittiert. Farben, Schatten, hover, focus-visible und der Druck stehen
 * jetzt als `.w14-button`/`.w14-button--…`-Regeln in tokens.css — hier
 * bleibt nur, was JS wirklich wissen muss (Größe, Breite, disabled).
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /**
   * `primary`  die eine Hauptsache der Fläche
   * `zweit`    Tinte gefuellt, Text in Pergament: eine echte Handlung, die
   *            nicht die Hauptsache ist (Basels Wunsch vom 04.08.2026)
   * `ghost`    die stille dritte Reihe, jetzt mit SICHTBARER Kante
   * `destructive` das Rote
   */
  variant?: 'primary' | 'akzent' | 'zweit' | 'destructive' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

/* Min tap heights honour the accessibility floor (WCAG 2.5.5) — never below
   40px, and md (where primary money-path actions land) meets the canonical
   44px --w14-touch-min. lg stays the generous ~52px. */
const SIZE_STYLE: Record<NonNullable<ButtonProps['size']>, CSSProperties> = {
  sm: { padding: '6px 14px', fontSize: 'var(--w14-step--1)', minHeight: 40 },
  md: { padding: '8px 18px', fontSize: 'var(--w14-step-0)', minHeight: 'var(--w14-touch-min)' },
  lg: { padding: '12px 24px', fontSize: 'var(--w14-step-1)', minHeight: 52 },
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth,
  className,
  style,
  ...rest
}: ButtonProps): JSX.Element {
  const merged: CSSProperties = {
    ...SIZE_STYLE[size],
    borderRadius: 'var(--w14-radius-button)',
    fontFamily: 'var(--w14-font-body)',
    // Der Grad steht hier und nicht in der Klasse, damit ein Aufrufer ihn per
    // style-Prop überschreiben kann, so wie vor dem Umzug der Zustände.
    fontWeight: variant === 'primary' || variant === 'akzent' || variant === 'zweit' ? 600 : 500,
    cursor: rest.disabled ? 'not-allowed' : 'pointer',
    opacity: rest.disabled ? 0.55 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--w14-space-1)',
    width: fullWidth ? '100%' : 'auto',
    ...style,
  };
  return (
    <button
      className={['w14-button', `w14-button--${variant}`, className].filter(Boolean).join(' ')}
      style={merged}
      {...rest}
    >
      {iconLeft}
      <span>{children}</span>
      {iconRight}
    </button>
  );
}
