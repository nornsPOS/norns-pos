/**
 * Bewertung — Tier-1 surface #8 (Day 11). The master craftsman's desk.
 *
 * Phase machine:
 *   • appraisalId === null + customerId === null → BewertungCustomerStep
 *   • appraisalId === null + customerId set      → "Bewertung starten" CTA
 *   • appraisalId set (DRAFT / COMPLETED)        → BewertungWorkspace
 *   • appraisalId set (ACCEPTED / REJECTED)      → outcome view + reset CTA
 *
 * The appraisal id lives in localStorage via `useBewertungStore` so F5
 * mid-data-entry rehydrates straight to the workspace. The items list
 * itself is server-of-record (TanStack Query against `GET /api/appraisals/:id`).
 */

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { appraisalsApi } from '@norns/api-client';
import { Button, Zwischentitel, ParchmentCard, Seal } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';
import { etikettenFuerKonvolut, etikettenHinweis } from '../../lib/etiketten-fuer-konvolut.js';
import { useToastStore } from '../../state/toast-store.js';
import {
  selectAppraisalId,
  selectBewertungCustomerId,
  useBewertungStore,
} from '../../state/bewertung-store.js';

import { AcceptanceDialog } from './AcceptanceDialog.js';
import { BewertungCustomerStep } from './BewertungCustomerStep.js';
import { BewertungWorkspace } from './BewertungWorkspace.js';

export function Bewertung(): JSX.Element {
  const api = useApiClient();
  const appraisalId = useBewertungStore(selectAppraisalId);
  const customerId = useBewertungStore(selectBewertungCustomerId);
  const setAppraisalId = useBewertungStore((s) => s.setAppraisalId);
  const setCustomerId = useBewertungStore((s) => s.setCustomerId);
  const reset = useBewertungStore((s) => s.reset);

  const [acceptOpen, setAcceptOpen] = useState<boolean>(false);
  const [starting, setStarting] = useState<boolean>(false);

  const q = useQuery({
    queryKey: ['appraisals', appraisalId],
    queryFn: () => appraisalsApi.get(api, appraisalId!),
    enabled: appraisalId !== null,
    staleTime: 5_000,
  });

  const startAppraisal = useCallback(async (): Promise<void> => {
    if (customerId === null || starting) return;
    setStarting(true);
    try {
      const result = await appraisalsApi.open(api, { customerId });
      setAppraisalId(result.id);
      setCustomerId(null);
    } finally {
      setStarting(false);
    }
  }, [api, customerId, setAppraisalId, setCustomerId, starting]);

  if (appraisalId === null) {
    return (
      <BewertungCustomerStep
        customerId={customerId}
        onPickCustomer={(id) => setCustomerId(id)}
        onStart={() => void startAppraisal()}
        starting={starting}
      />
    );
  }

  if (q.isLoading || (q.data === undefined && !q.isError)) return <LoadingSplash />;
  if (q.isError) return <ErrorSplash onReset={reset} />;
  if (!q.data) return <LoadingSplash />;

  const appraisal = q.data;

  if (
    appraisal.status === 'ACCEPTED' ||
    appraisal.status === 'REJECTED' ||
    appraisal.status === 'EXPIRED'
  ) {
    return <OutcomeView appraisal={appraisal} onReset={reset} />;
  }

  return (
    <>
      <BewertungWorkspace appraisal={appraisal} onOpenAcceptance={() => setAcceptOpen(true)} />
      {acceptOpen && (
        <AcceptanceDialog
          open={acceptOpen}
          appraisal={appraisal}
          onClose={() => setAcceptOpen(false)}
        />
      )}
    </>
  );
}

function LoadingSplash(): JSX.Element {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 'var(--w14-abstand-32)' }}>
      <ParchmentCard padding="lg" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: '14px 0 4px',
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Bewertung wird geladen…
        </h2>
        <Zwischentitel />
      </ParchmentCard>
    </div>
  );
}

function ErrorSplash({ onReset }: { onReset: () => void }): JSX.Element {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 'var(--w14-abstand-32)' }}>
      <ParchmentCard
        padding="lg"
        style={{
          width: 'min(460px, 100%)',
          textAlign: 'center',
          border: '1px solid var(--w14-wax-red)',
        }}
      >
        <p
          role="alert"
          style={{ color: 'var(--w14-wax-red)', margin: 0, fontFamily: 'var(--w14-font-display)' }}
        >
          Die Bewertung konnte nicht geladen werden.
        </p>
        <div style={{ marginTop: 14 }}>
          <Button variant="ghost" onClick={onReset}>
            Neue Bewertung beginnen
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}

function OutcomeView({
  appraisal,
  onReset,
}: {
  appraisal: import('@norns/api-client').AppraisalView;
  onReset: () => void;
}): JSX.Element {
  const accepted = appraisal.status === 'ACCEPTED';
  const printer = useLabelPrinter();
  const api = useApiClient();
  const addToast = useToastStore((st) => st.addToast);
  const [drucke, setDrucke] = useState(false);
  const druckbar = accepted && appraisal.items.some((i) => i.productId !== null);

  /*
   * DIE ARTIKELNUMMER WIRD NACHGESCHLAGEN.
   *
   * Vorher stand hier `sku: i.productId` — die UUID des Datensatzes. Genau
   * dieses Feld kodiert der Etikettendrucker als Code128, und die Kasse loest
   * einen Scan ausschliesslich ueber SKU oder Barcode auf, gross geschrieben.
   * Eine kleine UUID trifft nichts: JEDES ueber eine Bewertung angenommene
   * Stueck war am Tresen nicht scanbar.
   */
  const etikettenDrucken = useCallback(async (): Promise<void> => {
    setDrucke(true);
    try {
      const ergebnis = await etikettenFuerKonvolut(api, appraisal.items);
      const hinweis = etikettenHinweis(ergebnis);
      if (hinweis) {
        addToast({ tone: 'alert', title: 'Nicht alle Etiketten', body: hinweis });
      }
      if (ergebnis.etiketten.length > 0) await printer.print(ergebnis.etiketten);
    } finally {
      setDrucke(false);
    }
  }, [addToast, api, appraisal.items, printer]);
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 'var(--w14-abstand-32)' }}>
      <ParchmentCard padding="lg" style={{ width: 'min(520px, 100%)', textAlign: 'center' }}>
        <Seal size="md" tone={accepted ? 'gold' : 'faded'} label="◊" />
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: '14px 0 4px',
            fontSize: 'var(--w14-schrift-summe)',
          }}
        >
          {accepted
            ? 'Bewertung angenommen'
            : appraisal.status === 'REJECTED'
              ? 'Bewertung abgelehnt'
              : 'Bewertung abgelaufen'}
        </h2>
        <Zwischentitel />
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-betont)',
          }}
        >
          {appraisal.items.length} Stück{appraisal.items.length === 1 ? '' : 'e'}
          {accepted && appraisal.ankaufTransactionId && (
            <>
              {' · Ankauf-ID '}
              <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
                {appraisal.ankaufTransactionId.slice(0, 8)}…
              </span>
            </>
          )}
        </p>
        <div style={{ marginTop: 22, display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'center' }}>
          {druckbar && (
            <Button variant="ghost" disabled={drucke} onClick={() => void etikettenDrucken()}>
              {drucke ? 'Etiketten werden geholt …' : 'Etiketten drucken'}
            </Button>
          )}
          <Button variant="primary" onClick={onReset}>
            Neue Bewertung
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
