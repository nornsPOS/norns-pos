/**
 * StaleBadge — the „Stand vor … / veraltet" marker beside a cached value.
 *
 * Purely presentational: it formats a `cachedAt` instant against now and picks a
 * tone. No fetching, no store reads — a surface passes `cachedAt` (from
 * `useCachedQuery`) and, optionally, whether it's crossed the stale threshold.
 *
 *   „Stand vor 12 s"  — recent, calm (muted): we lost the cloud a moment ago.
 *   „veraltet · vor 8 Min"  — past the stale threshold, warm tone: trust with care.
 */

export interface StaleBadgeProps {
  /** `Date.now()` the shown data was captured (from `useCachedQuery.cachedAt`). */
  cachedAt: number | null;
  /** Crossed the stale threshold — flips the tone from calm to warm. */
  stale?: boolean;
  /** Injectable clock for tests. */
  now?: number;
}

function sinceLabel(cachedAt: number, now: number): string {
  const ms = Math.max(0, now - cachedAt);
  const s = Math.round(ms / 1000);
  if (s < 60) return `vor ${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `vor ${min} Min`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${std} Std`;
  const days = Math.round(std / 24);
  return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
}

export function StaleBadge({ cachedAt, stale = false, now = Date.now() }: StaleBadgeProps): JSX.Element | null {
  if (cachedAt == null) return null;
  const label = stale ? `veraltet · ${sinceLabel(cachedAt, now)}` : `Stand ${sinceLabel(cachedAt, now)}`;
  return (
    <span
      role="status"
      aria-label={`Daten aus dem Zwischenspeicher, ${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--w14-abstand-4)',
        fontSize: 'var(--w14-schrift-kuerzel)',
        letterSpacing: '0.04em',
        fontFamily: 'var(--w14-font-mono, monospace)',
        color: stale ? 'var(--w14-wax-red)' : 'var(--w14-ink-faded)',
        opacity: 0.9,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 'var(--w14-radius-pille)',
          background: stale ? 'var(--w14-wax-red)' : 'var(--w14-ink-faded)',
        }}
      />
      {label}
    </span>
  );
}
