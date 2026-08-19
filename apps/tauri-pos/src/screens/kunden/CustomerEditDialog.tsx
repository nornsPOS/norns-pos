/**
 * CustomerEditDialog — PII edit form (Day 10).
 *
 * Calls `PUT /api/customers/:id`. The server enforces step-up when
 * `kyc_verified_at IS NOT NULL` — the `wrapWithStepUp` interceptor opens
 * the brand StepUpModal transparently and retries the request. This
 * dialog never needs to ask for PIN explicitly.
 *
 * Validation: each editable field is mirrored client-side with the same
 * shape the route accepts. Submit is enabled only when at least one
 * field has been changed (no point in PUT-ing a no-op — the server
 * would 400 anyway, but client-side gating saves a roundtrip).
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  ApiError,
  type CustomerDetail,
  type CustomerUpdateBody,
  customersApi,
} from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { FENSTER_ROLLRAHMEN, useFensterRahmen } from '../../lib/fenster-rahmen.js';
import { germanDateToIso, isoToGermanDate } from '../../lib/german-date.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError, formatCustomerAddress } from '@norns/i18n-de';
import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';

export interface CustomerEditDialogProps {
  open: boolean;
  customer: CustomerDetail;
  onClose: () => void;
}

export function CustomerEditDialog({
  open,
  customer,
  onClose,
}: CustomerEditDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [fullName, setFullName] = useState<string>(customer.fullName);
  const [dateOfBirth, setDateOfBirth] = useState<string>(isoToGermanDate(customer.dateOfBirth));
  const [email, setEmail] = useState<string>(customer.email ?? '');
  const [phone, setPhone] = useState<string>(customer.phone ?? '');
  // Eine strukturierte Anschrift liegt als JSON in der Spalte. Der Kassierer
  // bearbeitet die gefaltete deutsche Zeile, nie den rohen Block.
  const [address, setAddress] = useState<string>(formatCustomerAddress(customer.address) ?? '');
  const [vatId, setVatId] = useState<string>(customer.vatId ?? '');
  const [notes, setNotes] = useState<string>(customer.notes ?? '');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when dialog opens for a different customer.
  useEffect(() => {
    if (!open) return;
    setFullName(customer.fullName);
    setDateOfBirth(isoToGermanDate(customer.dateOfBirth));
    setEmail(customer.email ?? '');
    setPhone(customer.phone ?? '');
    setAddress(formatCustomerAddress(customer.address) ?? '');
    setVatId(customer.vatId ?? '');
    setNotes(customer.notes ?? '');
    setSubmitting(false);
    setError(null);
  }, [open, customer]);

  // Wie beim Anlegen: viele Felder, keine Höhenbegrenzung, und der Wurzelkasten
  // rollt nicht. Bei kleinem Schirm war die Überschrift samt Namensfeld oben aus
  // dem Bild. Der gemeinsame Rahmen ersetzt den blossen Escape-Lauscher und
  // bringt Höhe, Rollbereich, Anfangsfokus und Fokusfang mit.
  const rahmenRef = useFensterRahmen({ offen: open, aufSchliessen: onClose, gesperrt: submitting });

  // Build diff body — only fields that actually changed.
  const buildBody = (): CustomerUpdateBody => {
    const body: CustomerUpdateBody = {};
    const trimOrNull = (v: string): string | null => (v.trim().length === 0 ? null : v.trim());

    if (fullName.trim() !== customer.fullName) body.fullName = fullName.trim();
    // Field holds German TT.MM.JJJJ; convert to ISO. A typo (non-empty but
    // unparseable) is left untouched rather than silently wiping the stored DOB.
    const dobIso = dateOfBirth.trim() ? germanDateToIso(dateOfBirth.trim()) : null;
    if (!(dateOfBirth.trim() && dobIso === null) && dobIso !== customer.dateOfBirth)
      body.dateOfBirth = dobIso;
    if ((email.trim() || null) !== customer.email) body.email = trimOrNull(email);
    if ((phone.trim() || null) !== customer.phone) body.phone = trimOrNull(phone);
    // Gegen die GEFALTETE Anschrift vergleichen: ein unberührtes Feld darf eine
    // strukturierte Adresse niemals still in eine Klartextzeile umschreiben.
    if ((address.trim() || null) !== (formatCustomerAddress(customer.address) ?? null))
      body.address = trimOrNull(address);
    // Gross/klein vergleichen, nicht schreiben: sonst gilt eine unberührte
    // klein gespeicherte USt-IdNr. beim Öffnen sofort als geändert.
    const nextVatId = vatId.trim().toUpperCase();
    const prevVatId = (customer.vatId ?? '').trim().toUpperCase();
    if (nextVatId !== prevVatId) body.vatId = nextVatId.length > 0 ? nextVatId : null;
    if ((notes.trim() || null) !== customer.notes) body.notes = trimOrNull(notes);
    return body;
  };

  const hasDiff = Object.keys(buildBody()).length > 0;
  const canSubmit = hasDiff && fullName.trim().length >= 2 && !submitting;
  const kycVerified = customer.kycVerifiedAt !== null;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await customersApi.update(api, customer.id, buildBody());
      addToast({
        tone: 'success',
        title: 'Kundendaten gespeichert',
        body: `${result.changedFields.length} Feld${result.changedFields.length === 1 ? '' : 'er'} geändert${result.stepUpEnforced ? ' · PIN bestätigt' : ''}.`,
      });
      await qc.invalidateQueries({ queryKey: ['customers', customer.id] });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') {
          setError('PIN-Bestätigung wurde abgebrochen.');
        } else if (err.code === 'CONFLICT') {
          setError('E-Mail oder Telefon bereits einem anderen Kunden zugewiesen.');
        } else if (err.code === 'VALIDATION_ERROR') {
          setError(describeError(err));
        } else {
          setError(describeError(err));
        }
      } else {
        setError(ohneApiFehlerSatz(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label="Kundendaten bearbeiten"
      ref={rahmenRef}
      tabIndex={-1}
      onClick={() => {
        if (!submitting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w14-overlay)',
        zIndex: 'var(--w14-z-fenster)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-24)',
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          ...FENSTER_ROLLRAHMEN,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-kopf)',
            textAlign: 'center',
          }}
        >
          Kundendaten bearbeiten
        </h2>
        <p
          style={{
            margin: '4px 0 0',
            textAlign: 'center',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-text)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {customer.fullName}
          {' · '}
          <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
            {customer.customerNumber}
          </span>
        </p>

        {kycVerified && (
          <p
            style={{
              margin: '12px 0 0',
              textAlign: 'center',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-feld)',
              color: 'var(--w14-ink-aged)',
            }}
          >
            KYC ist bestätigt. Änderungen erfordern PIN-Bestätigung.
          </p>
        )}

        <Zwischentitel label="Daten" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--w14-abstand-12)' }}>
          <Field
            label="Vollständiger Name"
            value={fullName}
            onChange={setFullName}
            required
            colSpan={2}
          />
          <Field
            label="Geburtsdatum (TT.MM.JJJJ)"
            value={dateOfBirth}
            onChange={setDateOfBirth}
            mono
          />
          <Field label="E-Mail" value={email} onChange={setEmail} type="email" />
          <Field label="Telefon" value={phone} onChange={setPhone} mono />
          <Field label="Adresse" value={address} onChange={setAddress} multiline colSpan={2} />
          <Field label="USt-IdNr." value={vatId} onChange={setVatId} mono />
          <Field
            label="Notizen (z. B. Personalausweis-Nr.)"
            value={notes}
            onChange={setNotes}
            multiline
            colSpan={2}
          />
        </div>

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '14px 0 0',
              fontSize: 'var(--w14-schrift-betont)',
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}

        <div style={{ marginTop: 22, display: 'flex', gap: 'var(--w14-abstand-12)', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Speichert…' : hasDiff ? 'Speichern' : 'Keine Änderung'}
          </Button>
        </div>
      </ParchmentCard>
    </div></Fensterboden>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
  mono = false,
  multiline = false,
  type = 'text',
  colSpan,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  mono?: boolean;
  multiline?: boolean;
  type?: 'text' | 'email' | 'tel';
  colSpan?: number;
}): JSX.Element {
  const containerStyle: React.CSSProperties = colSpan ? { gridColumn: `span ${colSpan}` } : {};
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)', ...containerStyle }}>
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
            resize: 'vertical',
            fontFamily: 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-betont)',
            color: 'var(--w14-ink)',
          }}
        />
      ) : (
        <input
          type={type}
          value={value}
          spellCheck={false}
          onChange={(ev) => onChange(ev.target.value)}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-feldlinie)',
            background: 'transparent',
            padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
            fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-betont)',
            color: 'var(--w14-ink)',
          }}
        />
      )}
    </label>
  );
}
