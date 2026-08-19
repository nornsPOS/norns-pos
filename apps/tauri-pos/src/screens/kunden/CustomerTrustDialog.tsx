/**
 * CustomerTrustDialog — change trust level (Day 10).
 *
 * Calls `PATCH /api/customers/:id/trust` (Day 26 backend). Step-up
 * required by the route; wrapWithStepUp interceptor handles it.
 *
 * Backend rules (memory.md #72):
 *   • Promoting to VERIFIED/VIP requires kyc_verified_at IS NOT NULL —
 *     the route refuses otherwise. UI surfaces this by disabling those
 *     options when the customer has no KYC stamp.
 *   • Demoting to SUSPICIOUS/BANNED requires a price-expectation note
 *     >= 8 chars — UI requires the operator to type the rationale.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  ApiError,
  type CustomerDetail,
  type CustomerTrustLevel,
  customersApi,
} from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { FENSTER_ROLLRAHMEN, useFensterRahmen } from '../../lib/fenster-rahmen.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';
import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';

const TRUST_OPTIONS: Array<{
  value: CustomerTrustLevel;
  label: string;
  tone: 'gold' | 'ink' | 'wax-red';
}> = [
  { value: 'NEW', label: 'NEU, Standard', tone: 'ink' },
  { value: 'VERIFIED', label: 'BESTÄTIGT, Stammkunde', tone: 'gold' },
  { value: 'VIP', label: 'VIP, Sammler', tone: 'gold' },
  { value: 'SUSPICIOUS', label: 'BEOBACHTEN, Verdacht', tone: 'wax-red' },
  { value: 'BANNED', label: 'GESPERRT, kein Geschäft', tone: 'wax-red' },
];

export interface CustomerTrustDialogProps {
  open: boolean;
  customer: CustomerDetail;
  onClose: () => void;
}

export function CustomerTrustDialog({
  open,
  customer,
  onClose,
}: CustomerTrustDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [target, setTarget] = useState<CustomerTrustLevel>(customer.trustLevel);
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTarget(customer.trustLevel);
    setNote('');
    setSubmitting(false);
    setError(null);
  }, [open, customer]);

  // Vorher stand hier nur der Escape-Lauscher. Das Fenster hatte keine
  // Höhenbegrenzung, und die Liste der Vertrauensstufen wächst mit jeder Stufe
  // samt Begründungsfeld: bei kleinem Schirm lag die Überschrift oben aus dem
  // Bild, und der Wurzelkasten steht auf `overflow: hidden`, holt sie also nie
  // zurück. Der gemeinsame Rahmen bringt Höhe, Rollbereich, Anfangsfokus und
  // Fokusfang mit.
  const rahmenRef = useFensterRahmen({ offen: open, aufSchliessen: onClose, gesperrt: submitting });

  const kycVerified = customer.kycVerifiedAt !== null;
  const requiresNote = target === 'SUSPICIOUS' || target === 'BANNED';
  const promotionRequiresKyc = (target === 'VERIFIED' || target === 'VIP') && !kycVerified;
  const noteValid = !requiresNote || note.trim().length >= 8;
  const canSubmit =
    target !== customer.trustLevel && noteValid && !promotionRequiresKyc && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // The trust route reads `req.body.reason` (≥8 chars) for SUSPICIOUS/BANNED
      // and writes it to price_expectation_notes server-side. Sending the note
      // under any other key is silently dropped → a valid rationale still 400s.
      const body = requiresNote
        ? { trustLevel: target, reason: note.trim() }
        : { trustLevel: target };
      await customersApi.setTrust(api, customer.id, body);
      addToast({
        tone: target === 'BANNED' || target === 'SUSPICIOUS' ? 'alert' : 'success',
        title: 'Trust-Level geändert',
        body: `${customer.fullName} → ${target}`,
      });
      await qc.invalidateQueries({ queryKey: ['customers', customer.id] });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') setError('PIN-Bestätigung wurde abgebrochen.');
        else setError(describeError(err));
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
      ref={rahmenRef}
      role="dialog"
      aria-modal="true"
      aria-label="Vertrauensstufe ändern"
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
          width: 'min(460px, 100%)',
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
          Vertrauensstufe
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
        </p>

        <Zwischentitel />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-6)' }}>
          {TRUST_OPTIONS.map((opt) => {
            const disabled = (opt.value === 'VERIFIED' || opt.value === 'VIP') && !kycVerified;
            const color =
              opt.tone === 'gold'
                ? 'var(--w14-gold)'
                : opt.tone === 'wax-red'
                  ? 'var(--w14-wax-red)'
                  : 'var(--w14-ink-faded)';
            return (
              <label
                key={opt.value}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 'var(--w14-abstand-10)',
                  alignItems: 'baseline',
                  padding: 'var(--w14-abstand-6) var(--w14-abstand-10)',
                  background: target === opt.value ? 'var(--w14-parchment-3)' : 'transparent',
                  border: `1px solid ${target === opt.value ? color : 'var(--w14-rule)'}`,
                  borderRadius: 'var(--w14-radius-card)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                <input
                  type="radio"
                  name="trust-level"
                  value={opt.value}
                  checked={target === opt.value}
                  disabled={disabled}
                  onChange={() => setTarget(opt.value)}
                />
                <span
                  className="w14-smallcaps"
                  style={{ color, letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-betont)' }}
                >
                  {opt.label}
                </span>
              </label>
            );
          })}
        </div>

        {promotionRequiresKyc && (
          <p
            style={{
              margin: '14px 0 0',
              color: 'var(--w14-wax-red)',
              fontSize: 'var(--w14-schrift-text)',
              textAlign: 'center',
              fontStyle: 'italic',
            }}
          >
            KYC-Bestätigung erforderlich, bevor BESTÄTIGT oder VIP gesetzt werden kann.
          </p>
        )}

        {requiresNote && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.08em',
              }}
            >
              Begründung (mind. 8 Zeichen) *
            </span>
            <textarea
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              rows={2}
              placeholder="Z. B. Hehlerverdacht, Auffälligkeit am 27.05.2026"
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
          </div>
        )}

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
            {submitting ? 'Setzt…' : 'Bestätigen'}
          </Button>
        </div>
      </ParchmentCard>
    </div></Fensterboden>
  );
}
