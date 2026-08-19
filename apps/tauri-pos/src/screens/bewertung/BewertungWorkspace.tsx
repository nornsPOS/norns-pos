/**
 * BewertungWorkspace — split-view editor for a DRAFT/COMPLETED appraisal.
 *
 *   Left  : AppraisalItemsList — Roman-numbered items + running total +
 *           "Vollständig" CTA to advance to COMPLETED + Acceptance.
 *   Right : AppraisalItemForm — high-speed evaluator form (weight, karat,
 *           fineness, condition, individual offer) with live Schmelzwert
 *           hint from the metal-prices route.
 *
 * Adds, updates, removes are server-of-record via `appraisalsApi.*` —
 * the parent query invalidates and re-renders the whole list. The form
 * resets on success.
 */

import { useMemo } from 'react';

import type { AppraisalView } from '@norns/api-client';
import { Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { AppraisalItemForm } from './AppraisalItemForm.js';
import { AppraisalItemsList } from './AppraisalItemsList.js';

export interface BewertungWorkspaceProps {
  appraisal: AppraisalView;
  onOpenAcceptance: () => void;
}

export function BewertungWorkspace({
  appraisal,
  onOpenAcceptance,
}: BewertungWorkspaceProps): JSX.Element {
  const editable = appraisal.status === 'DRAFT';
  const totalAppraisedEur = useMemo(
    () => appraisal.totalAppraisedEur,
    [appraisal.totalAppraisedEur],
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(360px, 1fr) minmax(0, 1.4fr)',
        height: '100%',
        minHeight: 0,
        flex: 1,
      }}
    >
      <AppraisalItemsList
        appraisal={appraisal}
        totalAppraisedEur={totalAppraisedEur}
        editable={editable}
        onOpenAcceptance={onOpenAcceptance}
      />
      <section
        aria-label="Bewerten"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          padding: 'var(--w14-abstand-20)',
          gap: 'var(--w14-abstand-14)',
          background: 'var(--w14-parchment-1)',
        }}
      >
        {editable ? (
          <AppraisalItemForm appraisalId={appraisal.id} />
        ) : (
          <ParchmentCard padding="lg" style={{ textAlign: 'center' }}>
            <Zwischentitel />
            <p
              style={{
                margin: '8px 0 0',
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
              }}
            >
              Bewertung ist abgeschlossen. Bitte mit „Kunde nimmt an / lehnt ab" fortfahren.
            </p>
            <p style={{ marginTop: 8, fontFamily: 'var(--w14-font-display)' }}>
              Angebotswert:{' '}
              <MoneyAmount valueEur={appraisal.totalOfferedEur ?? totalAppraisedEur} emphasis />
            </p>
          </ParchmentCard>
        )}
      </section>
    </div>
  );
}
