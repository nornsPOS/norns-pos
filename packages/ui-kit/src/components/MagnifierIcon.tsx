/**
 * MagnifierIcon — extracted from the warehouse-14-logo SVG.
 *
 * Brand-specific search affordance. Used everywhere the operator looks
 * for a product, a customer, or a transaction. NEVER replace with a
 * generic Lucide search glyph — this one is the brand.
 */

import type { CSSProperties, SVGProps } from 'react';

export interface MagnifierIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  /** Stroke colour token — defaults to current ink. */
  tone?: 'ink' | 'gold' | 'wax-red' | 'faded';
  /**
   * Accessible German name. Provide ONLY when this glyph is the sole label of
   * an interactive control (then it announces as an image). Omitted by default
   * because it almost always sits beside a labelled search input as a decorative
   * adornment — in that case it must stay silent (aria-hidden) to avoid a
   * double-announce. (Never English: the floor is German.)
   */
  label?: string;
}

const TONE_VAR: Record<NonNullable<MagnifierIconProps['tone']>, string> = {
  ink: 'var(--w14-ink)',
  gold: 'var(--w14-gilt)',
  'wax-red': 'var(--w14-wax-red)',
  faded: 'var(--w14-ink-faded)',
};

export function MagnifierIcon({
  size = 24,
  tone = 'ink',
  label,
  style,
  ...rest
}: MagnifierIconProps): JSX.Element {
  const merged: CSSProperties = {
    color: TONE_VAR[tone],
    ...style,
  };
  // Labelled → an announced image with a German name; otherwise decorative.
  // (Two explicit branches so the role↔aria-label pairing is statically clear.)
  const glyph = (
    <>
      {/* lens — slightly hand-drawn proportions to echo the antique cartouche */}
      <circle cx="10.5" cy="10.5" r="6.5" />
      {/* handle — angled at 45°, with a knob at the end */}
      <line x1="15.5" y1="15.5" x2="20" y2="20" />
      <circle cx="20.4" cy="20.4" r="1" fill="currentColor" />
      {/* the four motion strokes flanking the lens in the logo */}
      <path d="M2 9 L4 9.5" opacity="0.55" />
      <path d="M2 11 L4 11" opacity="0.4" />
      <path d="M2 13 L4 12.5" opacity="0.25" />
    </>
  );
  const shared = {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.5',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: merged,
    ...rest,
  } as const;
  if (label) {
    return (
      <svg role="img" aria-label={label} {...shared}>
        {glyph}
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" focusable="false" {...shared}>
      {glyph}
    </svg>
  );
}
