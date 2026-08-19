/**
 * motion — the app's one calm reveal primitive.
 *
 * The house motion language (DESIGN-SYSTEM §5) is: enter once, curator ease,
 * animate only transform + opacity, always honour prefers-reduced-motion. There
 * was no shared reveal utility — chrome did it inline per component. This gives
 * surfaces a single `<Reveal>` with an optional stagger index so a dashboard can
 * settle in sequence without each screen re-inventing the keyframe.
 *
 * The keyframe (`w14-reveal-up`) lives in ui-kit tokens.css. The global
 * reduced-motion rule there only zeroes animation *duration*, not *delay* — so a
 * staggered item would flash hidden during its delay. This helper closes that
 * gap by reading the preference in JS and dropping the animation entirely when
 * reduced: the content simply renders at its final state.
 */

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

/** Live `prefers-reduced-motion: reduce` preference. False during SSR. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export interface RevealProps {
  children: ReactNode;
  /** Stagger position — each step adds one `--w14-stagger` (70ms), capped. */
  index?: number;
  /** Explicit delay in ms; overrides `index`. */
  delayMs?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Fades + rises its children in once on mount. Under reduced motion it renders
 * the final state with no animation and no delay.
 */
export function Reveal({ children, index = 0, delayMs, className, style }: RevealProps): JSX.Element {
  const reduced = useReducedMotion();
  const delay = delayMs ?? Math.min(Math.max(index, 0), 12) * 70;

  // ── will-change nur WAEHREND der Bewegung (27.07.2026) ───────────────────
  // Vorher stand `willChange: 'transform, opacity'` als bleibender Inline-Stil:
  // fuenf Elemente der Uebersicht hielten dauerhaft eine Kompositor-Schicht,
  // bei null laufenden Animationen (live gemessen bei der Gegenprobe der
  // Bewegungs-Werkstatt). will-change ist ein Versprechen an den Browser, das
  // Speicher kostet — es gehoert gesetzt, solange die Einblendung laeuft, und
  // danach entfernt.
  const [settled, setSettled] = useState(false);

  const motionStyle: CSSProperties = reduced
    ? {}
    : {
        animationName: 'w14-reveal-up',
        animationDuration: 'var(--w14-dur-base)',
        animationTimingFunction: 'var(--w14-ease-curator)',
        animationFillMode: 'both',
        animationDelay: `${delay}ms`,
        ...(settled ? {} : { willChange: 'transform, opacity' }),
      };

  return (
    <div
      className={className}
      style={{ ...motionStyle, ...style }}
      onAnimationEnd={reduced || settled ? undefined : () => setSettled(true)}
    >
      {children}
    </div>
  );
}
