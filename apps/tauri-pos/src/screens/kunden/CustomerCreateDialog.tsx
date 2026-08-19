/**
 * CustomerCreateDialog — anlegen eines neuen Kunden, auch ohne Verkauf.
 *
 * Captures the full personal record (name, Geburtsdatum, contact, address,
 * notes, Sprache) and POSTs to /api/customers (customersApi.create, ADMIN +
 * CASHIER). On success the new customer is selected in the Kundenakte so the
 * operator lands straight on the fresh record.
 *
 * Only `fullName` is required — everything else is optional, so the shop can
 * record an interested visitor and complete the data later.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  ApiError,
  type CustomerCreateBody,
  type CustomerLanguage,
  customersApi,
} from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { FENSTER_ROLLRAHMEN, useFensterRahmen } from '../../lib/fenster-rahmen.js';
import { germanDateToIso } from '../../lib/german-date.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';

export interface CustomerCreateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new customer id after a successful create. */
  onCreated: (id: string) => void;
}

const LANGS: Array<{ value: CustomerLanguage; label: string }> = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' },
  { value: 'ar', label: 'Arabisch' },
];

export function CustomerCreateDialog({
  open,
  onClose,
  onCreated,
}: CustomerCreateDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [language, setLanguage] = useState<CustomerLanguage>('de');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setDateOfBirth('');
    setEmail('');
    setPhone('');
    setAddress('');
    setNotes('');
    setLanguage('de');
    setSubmitting(false);
    setError(null);
  }, [open]);

  // Dieses Fenster ist das längste der Gruppe: acht Felder in zwei Spalten plus
  // Sprachauswahl und Notizen. Ohne Höhenbegrenzung stand die Überschrift „Neuen
  // Kunden anlegen" samt dem Pflichtfeld Name bei kleinem Schirm oberhalb der
  // Bildkante, und weil der Wurzelkasten auf `overflow: hidden` steht, gab es
  // keinen Weg dorthin. Der gemeinsame Rahmen ersetzt den blossen
  // Escape-Lauscher, der vorher hier stand.
  const rahmenRef = useFensterRahmen({ offen: open, aufSchliessen: onClose, gesperrt: submitting });

  const canSubmit = fullName.trim().length >= 2 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: CustomerCreateBody = {
        fullName: fullName.trim(),
        preferredLanguage: language,
      };
      const dob = dateOfBirth.trim();
      const em = email.trim();
      const ph = phone.trim();
      const ad = address.trim();
      const nt = notes.trim();
      if (dob) {
        const iso = germanDateToIso(dob);
        if (!iso) {
          setError('Geburtsdatum bitte als TT.MM.JJJJ eingeben (z. B. 15.06.1990).');
          setSubmitting(false);
          return;
        }
        body.dateOfBirth = iso;
      }
      if (em) body.email = em;
      if (ph) body.phone = ph;
      if (ad) body.address = ad;
      if (nt) body.notes = nt;
      const result = await customersApi.create(api, body);
      addToast({
        tone: 'success',
        title: 'Kunde angelegt',
        body: `${fullName.trim()} · ${result.customerNumber}`,
      });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      onCreated(result.id);
      onClose();
    } catch (err) {
      // ⚠️ EINGEREIHT IST EIN ERFOLG.
      //
      // `ApiOfflineQueuedError` erbt von `Error`, nicht von `ApiError`, und
      // fiel deshalb in den unteren Zweig: die Maske sagte „bitte erneut
      // versuchen", obwohl der Kunde sicher im Ausgangskorb lag. Der zweite
      // Versuch legte ihn ein ZWEITES Mal an — und zwei Kundenakten mit
      // derselben Person sind hinterher nicht mehr sauber zu trennen.
      //
      // Die Kennung des neuen Kunden gibt es in diesem Fall noch nicht;
      // `onCreated` bleibt daher aus. Die Maske schliesst, der Hinweis sagt
      // ausdrücklich, dass nichts verloren ist.
      if (istSicherEingereiht(err)) {
        addToast(eingereihtHinweis('Kunde'));
        await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
        onClose();
        return;
      }
      if (err instanceof ApiError) {
        setError(
          err.code === 'CONFLICT'
            ? 'E-Mail oder Telefon bereits einem anderen Kunden zugewiesen.'
            : describeError(err),
        );
      } else {
        setError(ohneApiFehlerSatz(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc handled above + explicit buttons.
    // biome-ignore lint/a11y/useSemanticElements: backdrop overlay matches the existing dialog pattern in this screen.
    <Fensterboden><div
      ref={rahmenRef}
      role="dialog"
      aria-modal="true"
      aria-label="Neuen Kunden anlegen"
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
          Neuen Kunden anlegen
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
          Auch ohne Kauf. Nur der Name ist Pflicht.
        </p>

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
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-aged)',
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.08em',
              }}
            >
              Sprache
            </span>
            <select
              value={language}
              onChange={(ev) => setLanguage(ev.target.value as CustomerLanguage)}
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
            >
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <Field label="E-Mail" value={email} onChange={setEmail} type="email" />
          <Field label="Telefon" value={phone} onChange={setPhone} mono />
          <Field label="Adresse" value={address} onChange={setAddress} multiline colSpan={2} />
          <Field
            label="Notizen (z. B. Personalausweis-Nr., Interesse)"
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
            {submitting ? 'Legt an…' : 'Kunden anlegen'}
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
