/**
 * Sparkline — a pure, dependency-free compact line chart. Used by the
 * metal-ticker detail popover to show a glanceable price history (fed REAL
 * `metalPricesApi.history` points). No external charting lib; deterministic
 * SVG so it stays cheap on the always-mounted chrome.
 */
import type { CSSProperties } from 'react';

export type SparklineTone = 'gold' | 'up' | 'down' | 'neutral';

export interface SparklineProps {
  values: number[];
  ariaLabel: string;
  width?: number;
  height?: number;
  tone?: SparklineTone;
  style?: CSSProperties;
}

const TONE_STROKE: Record<SparklineTone, string> = {
  gold: 'var(--w14-gilt)',
  up: 'var(--w14-verdigris)',
  down: 'var(--w14-wax-red)',
  neutral: 'var(--w14-ink-faded)',
};

export function Sparkline({
  values,
  ariaLabel,
  width = 220,
  height = 56,
  tone = 'gold',
  style,
}: SparklineProps): JSX.Element {
  const pad = 3;
  const finite = values.filter((v) => Number.isFinite(v));
  const enough = finite.length >= 2;

  let points = '';
  if (enough) {
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const span = max - min || 1; // avoid /0 on a flat series
    const stepX = (width - pad * 2) / (finite.length - 1);
    points = finite
      .map((v, i) => {
        const x = pad + i * stepX;
        const y = pad + (height - pad * 2) * (1 - (v - min) / span);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      style={style}
    >
      {enough && (
        <polyline
          points={points}
          fill="none"
          stroke={TONE_STROKE[tone]}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
