/**
 * ShiftGuard — the empty state shown when no shift is open on this device.
 *
 * Originally written for Verkauf (Day 7). Extracted to `_shared/` on Day 8
 * because Ankauf has the same posture: no shift → no Kassenbuch → no audit
 * home → hard refuse. Phase 1.5 surfaces (Bewertung, Storno) compose on the
 * same primitive.
 *
 * Per memory.md #67 Retail-Core philosophy: a transaction without an open
 * shift would have no Kassenbuch home — the Z-Bon couldn't reconcile cash,
 * the audit chain would break. Surfaces hard-refuse until
 * `/api/shifts/current` returns a row.
 *
 * `digitLabel` is the surface's Karteikasten chip number so the Seal in the
 * empty state still tells the operator which surface they're on. Pass it from
 * `zifferFuerFlaeche(path)` — NEVER as a literal: the rail order has changed
 * before, and on 25.07.2026 four surfaces were found showing a digit that
 * jumped somewhere else entirely.
 *
 * `surfaceTitle` is the surface name displayed under the seal. Defaults to
 * "Schicht erforderlich" — explicit overrides used by individual surfaces.
 *
 * `lede` is the small-italic paragraph above the CTA explaining WHY.
 *
 * `ctaLabel` defaults to "Zur Kasse — Schicht eröffnen".
 */

import { useNavigate } from 'react-router-dom';

import { Button, Zwischentitel, ParchmentCard, Seal } from '@norns/ui-kit';

export interface ShiftGuardProps {
  /** Karteikasten chip digit (2=Verkauf, 3=Ankauf, …). */
  digitLabel: string;
  surfaceTitle: string;
  lede: string;
  /** Optional override for the CTA. */
  ctaLabel?: string;
}

export function ShiftGuard({
  digitLabel,
  surfaceTitle,
  lede,
  ctaLabel = 'Zur Kasse, Schicht eröffnen',
}: ShiftGuardProps): JSX.Element {
  const navigate = useNavigate();

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-32)',
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(460px, 100%)', textAlign: 'center' }}>
        <Seal size="md" tone="faded" label={digitLabel} />
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: '14px 0 4px',
            fontSize: 'var(--w14-schrift-summe)',
          }}
        >
          {surfaceTitle}
        </h2>
        <Zwischentitel />
        <p
          style={{
            margin: '6px 0 18px',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-betont)',
          }}
        >
          {lede}
        </p>
        <Button variant="primary" size="lg" onClick={() => navigate('/kasse')}>
          {ctaLabel}
        </Button>
      </ParchmentCard>
    </div>
  );
}
