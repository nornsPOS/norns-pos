/**
 * BewertungCustomerStep — pre-open phase (Day 11).
 *
 * Asks the operator to pick the seller (customer) BEFORE a DRAFT appraisal
 * exists server-side. Die Suche selbst führt das gemeinsame Bauteil
 * `screens/kunden/KundenSucher.tsx` — diese Maske trug sie früher ein eigenes
 * Mal, mit eigener Entprellung, eigener Zeile und eigenen Sätzen.
 *
 * Once a customer is selected, the "Bewertung starten" button POSTs to
 * `/api/appraisals` (via the parent's `onStart` callback) and the
 * coordinator's phase machine flips to the workspace.
 */

import { useQuery } from '@tanstack/react-query';

import { customersApi } from '@norns/api-client';
import { Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { KundenSucher, useKundenSuche } from '../kunden/KundenSucher.js';

export interface BewertungCustomerStepProps {
  customerId: string | null;
  onPickCustomer: (id: string | null) => void;
  onStart: () => void;
  starting: boolean;
}

export function BewertungCustomerStep({
  customerId,
  onPickCustomer,
  onStart,
  starting,
}: BewertungCustomerStepProps): JSX.Element {
  const api = useApiClient();

  // Der ECHTE Unterschied dieser Maske, den das gemeinsame Bauteil trägt statt
  // ihn zu verschlucken: hier gilt `excludeBlocked: true`. Eine gesperrte Akte
  // darf gar nicht erst zur Auswahl stehen, denn die Bewertung ist der Anfang
  // eines Ankaufs. In Ankauf und Verkauf ist es umgekehrt — dort soll der
  // Gesperrte SICHTBAR sein, mit rotem Rahmen und ohne Klick.
  //
  // Der zweite echte Unterschied: diese Maske hat KEINEN Weg zum Anlegen.
  // Deshalb steht hier `onAnlegen` nicht. Die alte Zeile schickte den Bewerter
  // trotzdem dorthin („Bitte zuerst Kunde im Tab Kunden anlegen") — also zum
  // selben Doppel, nur einen Schritt später. Bei schweigender Suche erscheint
  // dieser Nachsatz jetzt nicht mehr, weil dann die Fehlertafel steht.
  const suche = useKundenSuche({ limit: 20, excludeBlocked: true });

  const detailQ = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId!),
    enabled: customerId !== null,
    staleTime: 10_000,
  });

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-32)',
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(560px, 100%)' }}>
        <div style={{ textAlign: 'center' }}>
          <h2
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              margin: '14px 0 4px',
              fontSize: 'var(--w14-schrift-summe)',
            }}
          >
            Neue Bewertung
          </h2>
          <p
            style={{
              margin: '4px 0 0',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-betont)',
            }}
          >
            Wählen Sie zuerst den Verkäufer der Sammlung.
          </p>
        </div>

        <Zwischentitel label="Verkäufer suchen" />

        {customerId === null ? (
          <KundenSucher
            rolle="Verkäufer"
            suche={suche}
            onSelect={onPickCustomer}
            onAnlegen={null}
            leerNachsatz="Bitte zuerst Kunde im Tab „Kunden“ anlegen."
            einstiegshinweis={false}
            ergebnisStil={{ marginTop: 12, maxHeight: 320, overflowY: 'auto' }}
          />
        ) : (
          <SelectedCustomerCard
            detail={detailQ.data}
            loading={detailQ.isLoading}
            onChange={() => onPickCustomer(null)}
            onStart={onStart}
            starting={starting}
          />
        )}
      </ParchmentCard>
    </div>
  );
}

function SelectedCustomerCard({
  detail,
  loading,
  onChange,
  onStart,
  starting,
}: {
  detail: import('@norns/api-client').CustomerDetail | undefined;
  loading: boolean;
  onChange: () => void;
  onStart: () => void;
  starting: boolean;
}): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ background: 'var(--w14-parchment-2)' }}>
      {loading || !detail ? (
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt…</p>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 'var(--w14-abstand-12)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  margin: 0,
                  fontFamily: 'var(--w14-font-display)',
                  fontWeight: 500,
                  fontSize: 'var(--w14-schrift-lead)',
                }}
              >
                {detail.fullName}
              </h3>
              <p
                className="w14-tabular"
                style={{
                  margin: '4px 0 0',
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: 'var(--w14-schrift-zeile)',
                  color: 'var(--w14-ink-faded)',
                }}
              >
                {detail.customerNumber}
              </p>
            </div>
            <span
              className="w14-smallcaps"
              style={{
                fontSize: 'var(--w14-schrift-zeile)',
                color: detail.kycVerifiedAt ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
                letterSpacing: '0.08em',
                padding: 'var(--w14-abstand-4) var(--w14-abstand-10)',
                border: `1px solid ${detail.kycVerifiedAt ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
                borderRadius: 'var(--w14-radius-button)',
              }}
            >
              {detail.kycVerifiedAt ? 'KYC bestätigt' : 'ohne KYC'}
            </span>
          </div>
          <Zwischentitel />
          <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onChange} disabled={starting}>
              Anderer Kunde
            </Button>
            <Button variant="primary" size="lg" onClick={onStart} disabled={starting}>
              {starting ? 'Beginnt…' : 'Bewertung starten'}
            </Button>
          </div>
        </>
      )}
    </ParchmentCard>
  );
}
