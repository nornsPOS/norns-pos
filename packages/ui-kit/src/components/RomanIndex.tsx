/**
 * RomanIndex — renders a number as a small-caps Roman numeral with the
 * brand's diamond `◆` glyph on the left, used as a line-number affordance.
 *
 *   <RomanIndex value={1} />   →  ◆ I
 *   <RomanIndex value={47} />  →  ◆ XLVII
 *
 * Cap at 3999 (standard Roman ceiling). For lowercase use `variant="lower"`
 * — sub-items in nested cart lines.
 */

import type { CSSProperties } from 'react';

export interface RomanIndexProps {
  value: number;
  variant?: 'upper' | 'lower';
  /* 19.08.2026: `showDiamond` ist gefallen — vor jeder römischen Zahl stand
     eine Raute, und Basels Anweisung verbannt die Raute aus dem ganzen
     Programm. Die Zahl spricht allein. */
  /** Tone of the numeral. */
  tone?: 'ink' | 'gold' | 'wax-red' | 'faded';
  className?: string;
  style?: CSSProperties;
}

const TONE_VAR: Record<NonNullable<RomanIndexProps['tone']>, string> = {
  ink: 'var(--w14-ink)',
  gold: 'var(--w14-gilt)',
  'wax-red': 'var(--w14-wax-red)',
  faded: 'var(--w14-ink-faded)',
};

const ROMAN_PAIRS: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n >= 4000) {
    return String(n);
  }
  let remaining = n;
  let out = '';
  for (const [v, glyph] of ROMAN_PAIRS) {
    while (remaining >= v) {
      out += glyph;
      remaining -= v;
    }
  }
  return out;
}

export function RomanIndex({
  value,
  tone = 'ink',
  className,
  style,
}: RomanIndexProps): JSX.Element {
  // Decision (Basel, 2026-05-31): render plain Arabic numerals (1, 2, 3) — they
  // read faster and are more practical than Roman numerals. The display
  // typography carries the editorial style; the leading diamond fell on
  // 19.08.2026 (Basels Anweisung: keine Raute im ganzen Programm). `toRoman`
  // remains exported for any caller that still wants the classic numeral.
  const numeral = String(value);
  const merged: CSSProperties = {
    color: TONE_VAR[tone],
    fontFamily: 'var(--w14-font-display)',
    fontVariant: 'all-small-caps',
    letterSpacing: '0.08em',
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: '0.4em',
    ...style,
  };
  return (
    <span className={className} style={merged}>
      <span>{numeral}</span>
    </span>
  );
}
