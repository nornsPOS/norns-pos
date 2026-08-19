/**
 * CustomerDetailPanel — right column of Kunden (Day 10).
 *
 * Composes:
 *   • Header card (name, customer number, KYC + Trust chips, sanctions banner)
 *   • Personal data card (Geburtsdatum, Telefon, E-Mail, Adresse, Notizen) +
 *     "Bearbeiten" → CustomerEditDialog (PUT /api/customers/:id)
 *   • Compliance card: KYC stamp action + Trust level change action
 *   • History — Ankauf list + Verkauf list (collapsible)
 *
 * Triggers `useQuery(['customers', customerId])` for the detail. Three
 * independent queries run alongside: detail, ankauf-history, sales-history.
 * One slow query doesn't block the others.
 */

import { useQueryClient } from '@tanstack/react-query';

import { StaleBadge, useCachedQuery } from '../../offline/index.js';
import { useState } from 'react';

import { ApiError, type CustomerDetail, customersApi } from '@norns/api-client';
import { Button, Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';
import { describeError, formatCustomerAddress } from '@norns/i18n-de';

import { useApiClient } from '../../lib/api-context.js';
import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';
import { useToastStore } from '../../state/toast-store.js';

import { CustomerEditDialog } from './CustomerEditDialog.js';
import { CustomerEraseDialog } from './CustomerEraseDialog.js';
import { CustomerAnkaufHistory, CustomerSalesHistory } from './CustomerHistoryPanels.js';
import { CustomerTrustDialog } from './CustomerTrustDialog.js';
import { KycCaptureModal } from './KycCaptureModal.js';
import { KycLocalDocs, kycLocalQueryKey } from './KycLocalDocs.js';

export interface CustomerDetailPanelProps {
  customerId: string | null;
}

export function CustomerDetailPanel({ customerId }: CustomerDetailPanelProps): JSX.Element {
  if (customerId === null) return <EmptyDetailPlaceholder />;
  return <DetailLoaded customerId={customerId} />;
}

function DetailLoaded({ customerId }: { customerId: string }): JSX.Element {
  const api = useApiClient();
  // Offline-resilient (Phase 2.5): on an offline remount, seed the akte from the
  // last-good snapshot instead of an error placeholder, marked with a StaleBadge.
  const q = useCachedQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId),
    cacheKey: `customer:detail:${customerId}`,
    staleTime: 10_000,
  });

  if (q.isLoading) return <LoadingPlaceholder />;
  if (q.isError || !q.data) return <ErrorPlaceholder />;

  return (
    <>
      {q.fromCache && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--w14-abstand-4) var(--w14-abstand-8) 0' }}>
          <StaleBadge cachedAt={q.cachedAt} stale={q.isStale} />
        </div>
      )}
      <CustomerCard detail={q.data} />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main detail card
// ────────────────────────────────────────────────────────────────────────

function CustomerCard({ detail }: { detail: CustomerDetail }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [trustOpen, setTrustOpen] = useState<boolean>(false);
  const [kycOpen, setKycOpen] = useState<boolean>(false);
  const [eraseOpen, setEraseOpen] = useState<boolean>(false);
  const [stamping, setStamping] = useState<boolean>(false);
  const addToast = useToastStore((st) => st.addToast);
  const blocked = detail.sanctionsMatch || detail.trustLevel === 'BANNED';
  const kycVerified = detail.kycVerifiedAt !== null;

  /**
   * Den Ausweis gegen die Person bestätigen (§10 GwG). Dieselbe Handlung wie am
   * Verkaufs- und Ankaufstresen, nur aus der Akte heraus: der Server verlangt
   * dafür eine PIN-Bestätigung, die der api-client abfängt.
   */
  async function stampKyc(): Promise<void> {
    if (stamping || kycVerified) return;
    setStamping(true);
    try {
      await customersApi.stampKyc(
        api,
        detail.id,
        detail.trustLevel === 'NEW'
          ? { documentType: 'PERSONALAUSWEIS', promoteTrustLevelTo: 'VERIFIED' }
          : { documentType: 'PERSONALAUSWEIS' },
      );
      addToast({ tone: 'success', title: 'Ausweis bestätigt', body: detail.fullName });
      await qc.invalidateQueries({ queryKey: ['customers', detail.id] });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Ausweis nicht bestätigt',
        body:
          err instanceof ApiError
            ? err.code === 'STEP_UP_REQUIRED'
              ? 'PIN-Bestätigung wurde abgebrochen.'
              : describeError(err)
            : ohneApiFehlerSatz(err),
      });
    } finally {
      setStamping(false);
    }
  }

  return (
    <section
      aria-label="Kundenakte"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--space-5)',
        gap: 'var(--space-4)',
        overflowY: 'auto',
      }}
    >
      {/* Sanctions / Banned banner */}
      {blocked && (
        <ParchmentCard
          padding="md"
          style={{ border: '2px solid var(--w14-wax-red)', background: 'var(--w14-parchment-3)' }}
        >
          <p
            style={{
              margin: 0,
              color: 'var(--w14-wax-red)',
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: 'var(--w14-schrift-grund)',
            }}
          >
            Geschäft mit diesem Kunden gesperrt.
          </p>
          <p
            style={{
              margin: 'var(--space-2) 0 0',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-text)',
            }}
          >
            {detail.sanctionsMatch
              ? 'Sanktionslisten-Treffer laut EU-Verordnung.'
              : 'Vom Inhaber gesperrt. Trust = BANNED.'}
          </p>
        </ParchmentCard>
      )}

      {/* Header */}
      <ParchmentCard padding="lg">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-4)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: 'var(--w14-schrift-flaeche)',
              }}
            >
              {detail.fullName}
            </h1>
            <p
              className="w14-tabular"
              style={{
                margin: 'var(--space-1) 0 0',
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-text)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {detail.customerNumber}
              {' · seit '}
              {new Date(detail.createdAt).toLocaleDateString('de-DE')}
              {detail.registration && (
                <>
                  {' · '}
                  <span
                    style={{
                      color: detail.registration.online
                        ? 'var(--w14-gilt)'
                        : 'var(--w14-ink-faded)',
                    }}
                  >
                    {detail.registration.method === 'GOOGLE'
                      ? 'Mit Google registriert'
                      : detail.registration.method === 'EMAIL'
                        ? 'Online registriert'
                        : 'Im Geschäft angelegt'}
                  </span>
                </>
              )}
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 'var(--space-2)',
            }}
          >
            <TrustChip
              kycVerified={kycVerified}
              trust={detail.trustLevel}
              sanctions={detail.sanctionsMatch}
            />
            {detail.pepMatch && <PepChip />}
            <Button variant="ghost" size="sm" onClick={() => setTrustOpen(true)}>
              Trust ändern
            </Button>
          </div>
        </div>

        <Zwischentitel label="Persönliche Daten" />
        <DataGrid>
          <DataRow label="Geburtsdatum" value={detail.dateOfBirth} mono />
          <DataRow label="E-Mail" value={detail.email} />
          <DataRow label="Telefon" value={detail.phone} mono />
          {/* Eine strukturierte Anschrift kommt als JSON. Gefaltet, nie roh. */}
          <DataRow label="Adresse" value={formatCustomerAddress(detail.address)} multiline />
          <DataRow label="USt-IdNr." value={detail.vatId} mono />
          <DataRow label="Notizen" value={detail.notes} multiline />
        </DataGrid>

        <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            size="md"
            onClick={() => setEditOpen(true)}
            disabled={detail.sanctionsMatch}
          >
            Bearbeiten
          </Button>
        </div>
      </ParchmentCard>

      {/* KYC + cumulative card */}
      <ParchmentCard padding="md">
        <Zwischentitel label="KYC + Bilanz" />
        <DataGrid>
          <DataRow
            label="KYC-Status"
            value={
              kycVerified
                ? `bestätigt ${detail.kycVerifiedAt ? new Date(detail.kycVerifiedAt).toLocaleString('de-DE') : ''}`
                : 'noch nicht bestätigt'
            }
            tone={kycVerified ? 'gold' : 'faded'}
          />
          <DataRow
            label="KYC-Eingang"
            value={
              detail.kycCompletedAt ? new Date(detail.kycCompletedAt).toLocaleString('de-DE') : '-'
            }
            mono
          />
          <DataRow
            label="Bisherige Ankäufe"
            valueElement={<MoneyAmount valueEur={detail.cumulativeAnkaufEur} />}
          />
          <DataRow
            label="Bisherige Käufe"
            valueElement={<MoneyAmount valueEur={detail.cumulativeSpendEur} />}
          />
          {detail.cumulativeDebtEur !== '0.00' && (
            <DataRow
              label="Offene Schuld"
              valueElement={<MoneyAmount valueEur={detail.cumulativeDebtEur} emphasis />}
              tone="wax-red"
            />
          )}
        </DataGrid>
        <KycLocalDocs customerId={detail.id} onPromoteTrust={() => setTrustOpen(true)} />

        <div
          style={{
            marginTop: 'var(--space-4)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
          }}
        >
          <Button variant="ghost" size="md" onClick={() => setKycOpen(true)}>
            Ausweis erfassen
          </Button>
          {!kycVerified && (
            <Button
              variant="primary"
              size="md"
              onClick={() => void stampKyc()}
              disabled={stamping || detail.sanctionsMatch}
            >
              {stamping ? 'Wird bestätigt…' : 'Ausweis bestätigen'}
            </Button>
          )}
        </div>
      </ParchmentCard>

      {/* History. 15.08.2026 (0.6.0 Spur E): hier stand zusaetzlich die
          Online-Bestellungen-Kachel des alten Webshops; seit dem
          0.4.0-Kahlschlag konnte sie nur noch fuer immer leer sein. */}
      <CustomerAnkaufHistory customerId={detail.id} />
      <CustomerSalesHistory customerId={detail.id} />

      {/* Datenschutz — DSGVO Art. 17. Deliberately last + low-emphasis: a rare,
          serious action, step-up-gated on the server and confirm-word-gated here. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-1) var(--space-4)',
          marginTop: 'var(--space-2)',
          borderTop: '1px solid var(--w14-rule)',
        }}
      >
        <span style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
          Recht auf Löschung (Art. 17)
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEraseOpen(true)}
          style={{ color: 'var(--w14-wax-red)' }}
        >
          Kundendaten löschen
        </Button>
      </div>

      <CustomerEditDialog open={editOpen} customer={detail} onClose={() => setEditOpen(false)} />
      <CustomerTrustDialog open={trustOpen} customer={detail} onClose={() => setTrustOpen(false)} />
      <CustomerEraseDialog open={eraseOpen} customer={detail} onClose={() => setEraseOpen(false)} />
      {kycOpen && (
        <KycCaptureModal
          customerId={detail.id}
          onClose={() => setKycOpen(false)}
          onSaved={() => void qc.invalidateQueries({ queryKey: kycLocalQueryKey(detail.id) })}
        />
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Empty / Loading / Error placeholders
// ────────────────────────────────────────────────────────────────────────

function EmptyDetailPlaceholder(): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-9)' }}>
      <ParchmentCard padding="lg" style={{ textAlign: 'center', maxWidth: 440 }}>
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: 'var(--space-4) 0 var(--space-1)',
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Kein Kunde ausgewählt
        </h2>
        <Zwischentitel />
        <p
          style={{
            margin: 'var(--space-2) 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-betont)',
          }}
        >
          Wählen Sie links einen Kunden, um die Akte zu öffnen.
        </p>
      </ParchmentCard>
    </div>
  );
}

function LoadingPlaceholder(): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-9)' }}>
      <ParchmentCard padding="md">
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
          Lädt Kundenakte…
        </p>
      </ParchmentCard>
    </div>
  );
}

function ErrorPlaceholder(): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-9)' }}>
      <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
        <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
          Kundenakte konnte nicht geladen werden.
        </p>
      </ParchmentCard>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Data-grid primitives
// ────────────────────────────────────────────────────────────────────────

function DataGrid({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
      {children}
    </div>
  );
}

function DataRow({
  label,
  value,
  valueElement,
  mono = false,
  multiline = false,
  tone = 'ink',
}: {
  label: string;
  value?: string | null;
  valueElement?: JSX.Element;
  mono?: boolean;
  multiline?: boolean;
  tone?: 'ink' | 'gold' | 'faded' | 'wax-red';
}): JSX.Element {
  const toneColor: Record<typeof tone, string> = {
    ink: 'var(--w14-ink)',
    gold: 'var(--w14-gold)',
    faded: 'var(--w14-ink-faded)',
    'wax-red': 'var(--w14-wax-red)',
  };
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(140px, auto) 1fr',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) 0',
        alignItems: multiline ? 'start' : 'baseline',
      }}
    >
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      {valueElement ?? (
        <span
          style={{
            fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-betont)',
            textAlign: 'right',
            whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: toneColor[tone],
          }}
        >
          {value ?? '-'}
        </span>
      )}
    </div>
  );
}

/**
 * PepChip — §15 GwG. A politically exposed person is not blocked, but every
 * dealing with them carries verstärkte Sorgfaltspflichten. The marker stands
 * beside the trust chip rather than replacing it: a PEP can also be VERIFIED.
 */
function PepChip(): JSX.Element {
  return (
    <span
      className="w14-smallcaps"
      title="Politisch exponierte Person. Verstärkte Sorgfaltspflicht nach §15 GwG."
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontSize: 'var(--w14-schrift-text)',
        letterSpacing: '0.08em',
        padding: 'var(--space-1) var(--space-3)',
        borderRadius: 'var(--w14-radius-button)',
        border: '1px solid var(--w14-gold)',
        color: 'var(--w14-gold)',
      }}
    >
      Politisch exponiert
      {/* 27.07.2026: die Pflicht stand nur im title= — auf der Theke
          verschwindet sie unter dem Finger. Als stille zweite Zeile ist sie
          jetzt sichtbar; Tinte statt Gold, damit das Wort lesbar bleibt. */}
      <span
        style={{
          fontSize: 'var(--w14-schrift-kuerzel)',
          letterSpacing: '0.06em',
          color: 'var(--w14-ink-aged)',
        }}
      >
        Verstärkte Sorgfalt, §15 GwG
      </span>
    </span>
  );
}

function TrustChip({
  kycVerified,
  trust,
  sanctions,
}: {
  kycVerified: boolean;
  trust: 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED';
  sanctions: boolean;
}): JSX.Element {
  const base: React.CSSProperties = {
    fontSize: 'var(--w14-schrift-text)',
    letterSpacing: '0.08em',
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--w14-radius-button)',
    border: '1px solid',
  };
  if (sanctions) {
    return (
      <span
        className="w14-smallcaps"
        style={{ ...base, color: 'var(--w14-wax-red)', borderColor: 'var(--w14-wax-red)' }}
      >
        Sanktion
      </span>
    );
  }
  if (trust === 'BANNED' || trust === 'SUSPICIOUS') {
    return (
      <span
        className="w14-smallcaps"
        style={{ ...base, color: 'var(--w14-wax-red)', borderColor: 'var(--w14-wax-red)' }}
      >
        {trust === 'BANNED' ? 'gesperrt' : 'beobachten'}
      </span>
    );
  }
  if (trust === 'VIP') {
    return (
      <span
        className="w14-smallcaps"
        style={{ ...base, color: 'var(--w14-gold)', borderColor: 'var(--w14-gold)' }}
      >
        {/* 19.08.2026: die Rauten vor „VIP" sind gefallen (Basels Anweisung:
            keine Raute im ganzen Programm). */}
        VIP
      </span>
    );
  }
  if (kycVerified || trust === 'VERIFIED') {
    return (
      <span
        className="w14-smallcaps"
        style={{ ...base, color: 'var(--w14-gold)', borderColor: 'var(--w14-gold)' }}
      >
        KYC bestätigt
      </span>
    );
  }
  return (
    <span
      className="w14-smallcaps"
      style={{ ...base, color: 'var(--w14-ink-faded)', borderColor: 'var(--w14-rule)' }}
    >
      ohne KYC
    </span>
  );
}
