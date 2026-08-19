/**
 * KaeuferPicker — § 10 GwG buyer-attach + Ausweisprüfung step for the Verkauf
 * checkout.
 *
 * Mandatory whenever a sale total ≥ €2.000 (GwG-Schwelle): the server trigger
 * `transactions_validate_kyc` refuses an anonymous high-value VERKAUF, so the
 * cashier MUST attach a KYC-verified buyer before finalize. This modal is the
 * UX that makes that satisfiable:
 *
 *   1. SEARCH  — debounced customer search (reuses `customersApi.list`, the
 *      exact pattern from Ankauf's CustomerPanel), each row showing its KYC
 *      chip so the operator can spot an already-verified buyer at a glance.
 *   2. CREATE  — inline minimal-field create (`customersApi.create`) for a
 *      walk-in with no record yet, then auto-selects.
 *   3. VERIFY  — once a buyer is selected, show the KYC status. If not yet
 *      verified, a single "Ausweis geprüft — bestätigen" button stamps KYC
 *      (`customersApi.stampKyc`, step-up enforced by the api-client
 *      interceptor — same eyeball-verify flow as Ankauf). Only a verified
 *      buyer can be handed back to the dialog.
 *
 * Below €2.000 this picker is never shown — anonymous Tafelgeschäft stays
 * unchanged. This is purely the UX so the cashier CAN satisfy the gate; the
 * server trigger remains the authoritative source of truth.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  type CustomerCreateBody,
  type CustomerDetail,
  customersApi,
} from '@norns/api-client';
import { Fensterboden,
  Button,
  Zwischentitel,
  Icon,
  MoneyAmount,
  ParchmentCard,
  ShieldCheck,
} from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { germanDateToIso } from '../../lib/german-date.js';
import { KundenSucher, VertrauensZeichen, useKundenSuche } from '../kunden/KundenSucher.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';

type Mode = 'SEARCH' | 'CREATE' | 'SELECTED';

export interface KaeuferPickerProps {
  /** Sale total (€ string) — shown in the header so the operator sees why ID is needed. */
  totalEur: string;
  /** Optional: a buyer already chosen earlier in this checkout (re-open keeps it). */
  initialCustomerId?: string | null;
  /** Fired with the chosen buyer ONCE they are KYC-verified — attaches to finalize. */
  onConfirm: (customer: CustomerDetail) => void;
  onCancel: () => void;
}

export function KaeuferPicker({
  totalEur,
  initialCustomerId,
  onConfirm,
  onCancel,
}: KaeuferPickerProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(initialCustomerId ?? null);
  const [mode, setMode] = useState<Mode>(initialCustomerId ? 'SELECTED' : 'SEARCH');

  // Esc cancels.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setMode('SELECTED');
  }, []);

  return (
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label="Käufer zuordnen, Ausweis erforderlich"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w14-overlay)',
        zIndex: 'var(--w14-z-anker)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-24)',
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          boxShadow: 'var(--w14-shadow-modal)',
        }}
      >
        <header style={{ flexShrink: 0 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: 'var(--w14-schrift-summe)',
              textAlign: 'center',
            }}
          >
            Käufer zuordnen
          </h2>
          <p
            style={{
              margin: '6px 0 0',
              textAlign: 'center',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontSize: 'var(--w14-schrift-text)',
            }}
          >
            Ausweis erforderlich ab 2.000&nbsp;€ (§ 10 GwG) · Verkauf{' '}
            <MoneyAmount valueEur={totalEur} />
          </p>
          <Zwischentitel />
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex' }}>
          {mode === 'SELECTED' && selectedId !== null ? (
            <SelectedBuyer
              customerId={selectedId}
              onConfirm={onConfirm}
              onClear={() => {
                setSelectedId(null);
                setMode('SEARCH');
              }}
            />
          ) : mode === 'CREATE' ? (
            <CreateBuyer onCreated={select} onCancel={() => setMode('SEARCH')} />
          ) : (
            <SearchBuyer onSelect={select} onSwitchToCreate={() => setMode('CREATE')} />
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 'var(--w14-abstand-12)',
            marginTop: 14,
            paddingTop: 'var(--w14-abstand-14)',
            borderTop: '1px solid var(--w14-rule)',
          }}
        >
          <Button variant="ghost" size="lg" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      </ParchmentCard>
    </div></Fensterboden>
  );
}

// ────────────────────────────────────────────────────────────────────────
// SEARCH
// ────────────────────────────────────────────────────────────────────────

/**
 * FUND, der hier ausgebaut wurde: derselbe Käufersucher stand hier ein zweites
 * Mal, Zeile für Zeile — eigene Entprellung, eigene Abfrage, eigene Zeile,
 * eigenes Zeichen. Er unterschied sich vom Ankauf in Kleinigkeiten, die ein
 * Mensch am Tresen trotzdem sieht: die PEP-Fahne stand hier NEBEN dem Zeichen
 * statt darüber, und die Trefferzeile zeigte keine bisherige Ankaufsumme.
 *
 * Warum das Anlegen bei schweigender Suche gesperrt bleibt: eine zweite Akte
 * hebt die Sperre der ersten auf. §10 GwG verlangt ab 2.000 € die
 * Identifizierung des Käufers — eine soeben angelegte, blanke Akte erfüllt das
 * formal, verliert aber genau die Merkmale, wegen derer der Verkauf zu
 * unterbleiben hätte. Die Regel steht in `kundenSucherAnsicht`.
 */
function SearchBuyer({
  onSelect,
  onSwitchToCreate,
}: {
  onSelect: (id: string) => void;
  onSwitchToCreate: () => void;
}): JSX.Element {
  // `excludeBlocked: false` ist Absicht: eine gesperrte Akte soll mit rotem
  // Rahmen erscheinen, DAMIT die Warnung überhaupt sichtbar wird.
  const suche = useKundenSuche({ limit: 20, excludeBlocked: false });

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-12)' }}>
      <KundenSucher
        rolle="Käufer"
        suche={suche}
        onSelect={onSelect}
        onAnlegen={onSwitchToCreate}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// SELECTED — show KYC status, stamp if needed, then confirm
// ────────────────────────────────────────────────────────────────────────

function SelectedBuyer({
  customerId,
  onConfirm,
  onClear,
}: {
  customerId: string;
  onConfirm: (customer: CustomerDetail) => void;
  onClear: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [stamping, setStamping] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId),
    staleTime: 5_000,
  });
  const customer = q.data;

  const blocked = customer?.sanctionsMatch === true || customer?.trustLevel === 'BANNED';
  const kycVerified = customer?.kycVerifiedAt != null;

  const stampKyc = useCallback(async (): Promise<void> => {
    if (!customer || stamping) return;
    setStamping(true);
    setError(null);
    try {
      // The PATCH route requires step-up — the api-client interceptor opens the
      // PIN modal and retries transparently (same eyeball-verify as Ankauf).
      // documentType is a required backend audit enum: PERSONALAUSWEIS is the
      // honest default ID inspected at a German counter (metadata only).
      await customersApi.stampKyc(
        api,
        customer.id,
        customer.trustLevel === 'NEW'
          ? { documentType: 'PERSONALAUSWEIS', promoteTrustLevelTo: 'VERIFIED' }
          : { documentType: 'PERSONALAUSWEIS' },
      );
      addToast({ tone: 'success', title: 'Ausweis bestätigt', body: customer.fullName });
      await qc.invalidateQueries({ queryKey: ['customers', customer.id] });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'STEP_UP_REQUIRED' ? 'PIN-Bestätigung wurde abgebrochen.' : describeError(err),
        );
      } else {
        // Die zweite Aussage bleibt — sie ist die wichtigere: was NICHT
        // geschehen ist. Nur die behauptete Ursache weicht dem gemessenen Satz.
        setError(`${ohneApiFehlerSatz(err)} Der Ausweis ist nicht bestätigt.`);
      }
    } finally {
      setStamping(false);
    }
  }, [addToast, api, customer, qc, stamping]);

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-12)' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-text)',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          anderer Käufer
        </button>
      </div>

      {q.isLoading && (
        <ParchmentCard padding="md">
          <p
            style={{
              margin: 0,
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
            }}
          >
            Lädt Käufer…
          </p>
        </ParchmentCard>
      )}
      {q.isError && (
        <ParchmentCard padding="md">
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: 0, fontSize: 'var(--w14-schrift-betont)' }}>
            Käuferdaten konnten nicht geladen werden.
          </p>
        </ParchmentCard>
      )}

      {customer && (
        <>
          {blocked && (
            <ParchmentCard
              padding="md"
              style={{
                border: '2px solid var(--w14-wax-red)',
                background: 'var(--w14-parchment-3)',
              }}
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
                Verkauf an diesen Kunden nicht zulässig.
              </p>
              <p
                style={{
                  margin: '6px 0 0',
                  color: 'var(--w14-ink-faded)',
                  fontFamily: 'var(--w14-font-display)',
                  fontStyle: 'italic',
                  fontSize: 'var(--w14-schrift-text)',
                }}
              >
                {customer.sanctionsMatch
                  ? 'Sanktionslisten-Treffer. Verstoß gegen EU-Verordnung.'
                  : 'Kunde ist gesperrt. Siehe Notizen.'}
              </p>
            </ParchmentCard>
          )}

          <ParchmentCard padding="md">
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
            >
              <h3
                style={{
                  margin: 0,
                  fontFamily: 'var(--w14-font-display)',
                  fontWeight: 500,
                  fontSize: 'var(--w14-schrift-lead)',
                }}
              >
                {customer.fullName}
              </h3>
              <VertrauensZeichen
                kycGeprueft={kycVerified}
                stufe={customer.trustLevel}
                sanktion={customer.sanctionsMatch}
                pep={customer.pepMatch}
              />
            </div>
            <p
              className="w14-tabular"
              style={{
                margin: '4px 0 0',
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {customer.customerNumber}
              {customer.dateOfBirth ? ` · geb. ${customer.dateOfBirth}` : ''}
            </p>

            <p
              style={{
                margin: '12px 0 0',
                fontFamily: 'var(--w14-font-display)',
                fontSize: 'var(--w14-schrift-text)',
                color: kycVerified ? 'var(--w14-gold)' : 'var(--w14-wax-red)',
              }}
            >
              {kycVerified
                ? `Ausweis geprüft am ${
                    customer.kycVerifiedAt
                      ? new Date(customer.kycVerifiedAt).toLocaleDateString('de-DE')
                      : '-'
                  }`
                : 'Ausweis noch nicht geprüft. § 10 GwG verlangt eine Identifizierung.'}
            </p>
          </ParchmentCard>

          {error && (
            <p
              role="alert"
              style={{
                color: 'var(--w14-wax-red)',
                margin: 0,
                fontSize: 'var(--w14-schrift-betont)',
                textAlign: 'center',
              }}
            >
              {error}
            </p>
          )}

          {!blocked &&
            (kycVerified ? (
              <Button
                variant="primary"
                size="lg"
                iconLeft={<Icon icon={ShieldCheck} size={18} />}
                onClick={() => onConfirm(customer)}
                style={{
                  backgroundColor: 'var(--w14-accent)',
                  borderColor: 'var(--w14-accent)',
                  color: 'var(--w14-accent-ink)',
                }}
              >
                Käufer übernehmen
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={() => void stampKyc()}
                disabled={stamping}
              >
                {stamping ? 'Bestätigt…' : 'Ausweis geprüft, bestätigen'}
              </Button>
            ))}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// CREATE
// ────────────────────────────────────────────────────────────────────────

function CreateBuyer({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [fullName, setFullName] = useState<string>('');
  const [dateOfBirth, setDateOfBirth] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = fullName.trim().length >= 2 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const rawDob = dateOfBirth.trim();
      const dobIso = rawDob ? germanDateToIso(rawDob) : null;
      if (rawDob && !dobIso) {
        setError('Geburtsdatum bitte als TT.MM.JJJJ eingeben (z. B. 15.06.1990).');
        setSubmitting(false);
        return;
      }
      const body: CustomerCreateBody = {
        fullName: fullName.trim(),
        ...(dobIso ? { dateOfBirth: dobIso } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      };
      const created = await customersApi.create(api, body);
      addToast({ tone: 'success', title: 'Kunde angelegt', body: created.customerNumber });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      onCreated(created.id);
    } catch (err) {
      // ⚠️ EINGEREIHT IST EIN ERFOLG — ABER KEIN KÄUFER FÜR DIESEN VERKAUF.
      //
      // Der Kunde liegt sicher im Ausgangskorb und entsteht, sobald das Netz
      // zurück ist. Seine Kennung gibt es JETZT aber nicht, und ohne sie kann
      // `onCreated` ihn diesem Verkauf nicht zuordnen. Beides muss dastehen:
      // dass nichts verloren ist UND dass die Zuordnung hier nicht geht.
      //
      // Der frühere Satz („bitte erneut versuchen") lud dazu ein, denselben
      // Kunden noch einmal anzulegen — bei einem Ankauf mit Ausweispflicht
      // stehen danach zwei Akten für dieselbe Person in den Büchern.
      if (istSicherEingereiht(err)) {
        addToast(eingereihtHinweis('Kunde'));
        setError(
          'Der Kunde ist offline gespeichert und wird übertragen. Diesem Verkauf ' +
            'kann er erst zugeordnet werden, wenn die Verbindung zurück ist. ' +
            'Bitte NICHT erneut anlegen.',
        );
        return;
      }
      if (err instanceof ApiError) setError(describeError(err));
      else setError(ohneApiFehlerSatz(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-12)' }}>
      <ParchmentCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-10)' }}>
        <Field
          label="Vollständiger Name"
          value={fullName}
          onChange={setFullName}
          autoFocus
          required
        />
        <Field label="Geburtsdatum (TT.MM.JJJJ)" value={dateOfBirth} onChange={setDateOfBirth} />
        <Field label="E-Mail" value={email} onChange={setEmail} type="email" />
        <Field label="Telefon" value={phone} onChange={setPhone} />
        <Field label="Adresse" value={address} onChange={setAddress} multiline />
      </ParchmentCard>

      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--w14-wax-red)',
            margin: 0,
            fontSize: 'var(--w14-schrift-betont)',
            textAlign: 'center',
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)' }}>
        <Button variant="ghost" size="md" onClick={onCancel} disabled={submitting}>
          Zurück
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => void submit()}
          disabled={!canSubmit}
          style={{ flex: 1 }}
        >
          {submitting ? 'Speichert…' : 'Anlegen'}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  autoFocus = false,
  required = false,
  type = 'text',
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  required?: boolean;
  type?: 'text' | 'email' | 'tel';
  multiline?: boolean;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
      >
        {label}
        {required && <span style={{ color: 'var(--w14-wax-red)' }}> *</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          rows={2}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-feldlinie)',
            background: 'transparent',
            padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
            fontFamily: 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-betont)',
            resize: 'vertical',
            color: 'var(--w14-ink)',
          }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          autoFocus={autoFocus}
          spellCheck={false}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-feldlinie)',
            background: 'transparent',
            padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
            fontFamily: 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-betont)',
            color: 'var(--w14-ink)',
          }}
        />
      )}
    </label>
  );
}
