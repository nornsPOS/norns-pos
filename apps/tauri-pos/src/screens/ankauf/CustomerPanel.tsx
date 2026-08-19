/**
 * CustomerPanel — left column of Ankauf (Day 8).
 *
 * Three modes:
 *   1. UNSELECTED — magnifier search input + recent-matches dropdown +
 *      "Neuer Kunde anlegen" CTA. Items panel locked until a customer
 *      is chosen.
 *   2. SELECTED   — full customer card: name, KYC status chip, trust
 *      level chip, sanctions warning (if any), cumulative Ankauf
 *      history. "Anderer Kunde" link to return to mode 1.
 *   3. CREATING   — inline minimal-field form (full name + DOB + ID
 *      number + ID country + email + phone + address). Calls
 *      customersApi.create + auto-selects.
 *
 * Sanctions hard-block: if the selected customer has sanctions_match=TRUE,
 * the panel locks the items column with a wax-red lock screen ("Geschäft
 * kann nicht durchgeführt werden"). Backend would refuse anyway; the
 * client prevents the operator from wasting effort.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  ApiError,
  type CustomerCreateBody,
  type CustomerDetail,
  customersApi,
} from '@norns/api-client';
import { Button, Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { germanDateToIso } from '../../lib/german-date.js';
import { KundenSucher, VertrauensZeichen, useKundenSuche } from '../kunden/KundenSucher.js';
import { selectAnkaufCustomerId, useAnkaufCartStore } from '../../state/ankauf-cart-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';

type Mode = 'SEARCH' | 'CREATE';

export function CustomerPanel(): JSX.Element {
  const customerId = useAnkaufCartStore(selectAnkaufCustomerId);
  const setCustomerId = useAnkaufCartStore((s) => s.setCustomerId);

  if (customerId === null) {
    return <SearchOrCreate onSelect={(id) => setCustomerId(id)} />;
  }
  return <SelectedCustomer customerId={customerId} onClear={() => setCustomerId(null)} />;
}

// ────────────────────────────────────────────────────────────────────────
// Mode 1+3: search OR create
// ────────────────────────────────────────────────────────────────────────

function SearchOrCreate({ onSelect }: { onSelect: (id: string) => void }): JSX.Element {
  const [mode, setMode] = useState<Mode>('SEARCH');
  return (
    <section
      aria-label="Verkäufer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--space-4)',
        gap: 'var(--space-4)',
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Verkäufer
        </h2>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}
        >
          {mode === 'SEARCH' ? 'suchen oder anlegen' : 'neue Person'}
        </span>
      </header>

      {mode === 'SEARCH' ? (
        <SearchMode onSelect={onSelect} onSwitchToCreate={() => setMode('CREATE')} />
      ) : (
        <CreateMode onCreated={onSelect} onCancel={() => setMode('SEARCH')} />
      )}
    </section>
  );
}

/**
 * FUND, der hier ausgebaut wurde: diese Spalte trug eine eigene Entprellung,
 * eine eigene Abfrage, eine eigene Trefferzeile und ein eigenes
 * Vertrauenszeichen — dieselbe Arbeit wie im Verkauf, in der Bewertung und in
 * der Kundenakte, viermal getrennt gepflegt und darum viermal auseinander
 * gelaufen. Alles davon steht jetzt in `screens/kunden/KundenSucher.tsx`.
 *
 * Zwei Dinge, die ein Mensch am Tresen HIER gesehen hat und die dabei
 * verschwinden:
 *
 *  • Neben der PEP-Fahne standen zwei nackte Klammern. Im JSX waren „(" und „)"
 *    als Text zwischen die Elemente geraten, also las die Verkäuferspalte
 *    „( PEP ) gesperrt". Nur diese eine Maske hatte den Fehler.
 *  • Der Sanktionstreffer hiess hier „Sanktioniert", in der Kundenakte
 *    „Sanktion". Ein Sachverhalt, zwei Wörter.
 *
 * Die Sperre des Anlegens bei schweigender Suche bleibt unverändert bestehen;
 * sie liegt jetzt in `kundenSucherAnsicht` und ist dort geprüft.
 */
function SearchMode({
  onSelect,
  onSwitchToCreate,
}: {
  onSelect: (id: string) => void;
  onSwitchToCreate: () => void;
}): JSX.Element {
  // `excludeBlocked: false` ist Absicht: ein gesperrter Verkäufer soll dem
  // Menschen am Tresen mit rotem Rahmen begegnen, statt lautlos zu fehlen.
  const suche = useKundenSuche({ limit: 20, excludeBlocked: false });

  return (
    <KundenSucher
      rolle="Verkäufer"
      suche={suche}
      onSelect={onSelect}
      onAnlegen={onSwitchToCreate}
      zeigeAnkaufSumme
      ergebnisStil={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────
// Mode 2: selected customer
// ────────────────────────────────────────────────────────────────────────

function SelectedCustomer({
  customerId,
  onClear,
}: {
  customerId: string;
  onClear: () => void;
}): JSX.Element {
  const api = useApiClient();

  const q = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId),
    staleTime: 10_000,
  });

  return (
    <section
      aria-label="Verkäufer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--space-4)',
        gap: 'var(--space-4)',
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Verkäufer
        </h2>
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
          anderer Kunde
        </button>
      </header>

      {q.isLoading && <SkeletonCard />}
      {q.isError && (
        <ParchmentCard padding="md">
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: 0, fontSize: 'var(--w14-schrift-betont)' }}>
            Verkäuferdaten konnten nicht geladen werden.
          </p>
        </ParchmentCard>
      )}
      {q.data && <CustomerCard detail={q.data} />}
    </section>
  );
}

function SkeletonCard(): JSX.Element {
  return (
    <ParchmentCard padding="md">
      <p
        style={{
          margin: 0,
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
        }}
      >
        Lädt Verkäufer…
      </p>
    </ParchmentCard>
  );
}

function CustomerCard({ detail }: { detail: CustomerDetail }): JSX.Element {
  const blocked = detail.sanctionsMatch || detail.trustLevel === 'BANNED';

  return (
    <>
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
            Geschäft mit diesem Kunden nicht zulässig.
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
            {detail.sanctionsMatch
              ? 'Sanktionslisten-Treffer. Verstoß gegen EU-Verordnung.'
              : 'Kunde ist gesperrt. Siehe Notizen.'}
          </p>
        </ParchmentCard>
      )}

      <ParchmentCard padding="md">
        <Zwischentitel />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginTop: 8,
          }}
        >
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
          <VertrauensZeichen
            kycGeprueft={detail.kycVerifiedAt !== null}
            stufe={detail.trustLevel}
            sanktion={detail.sanctionsMatch}
            pep={detail.pepMatch}
          />
        </div>
        <p
          className="w14-tabular"
          style={{
            margin: '4px 0 8px',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {detail.customerNumber}
        </p>

        <Row label="Geburtsdatum" value={detail.dateOfBirth ?? '-'} />
        <Row label="E-Mail" value={detail.email ?? '-'} />
        <Row label="Telefon" value={detail.phone ?? '-'} />
        <Row label="Adresse" value={detail.address ?? '-'} multiline />

        <Zwischentitel label="Bisher" />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--w14-abstand-10)' }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}
          >
            Ankäufe
          </span>
          <MoneyAmount valueEur={detail.cumulativeAnkaufEur} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--w14-abstand-10)', marginTop: 4 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}
          >
            Verkäufe an
          </span>
          <MoneyAmount valueEur={detail.cumulativeSpendEur} />
        </div>
      </ParchmentCard>
    </>
  );
}

function Row({
  label,
  value,
  multiline = false,
}: { label: string; value: string; multiline?: boolean }): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 'var(--w14-abstand-10)',
        padding: 'var(--w14-abstand-6) 0',
        alignItems: multiline ? 'start' : 'baseline',
      }}
    >
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: multiline ? 'var(--w14-font-body)' : 'var(--w14-font-mono)',
          fontSize: 'var(--w14-schrift-betont)',
          textAlign: 'right',
          whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Mode 3: create
// ────────────────────────────────────────────────────────────────────────

function CreateMode({
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
      // ⚠️ EINGEREIHT IST EIN ERFOLG — ABER KEIN VERKÄUFER FÜR DIESEN ANKAUF.
      //
      // Derselbe Fall wie im Käuferwähler des Verkaufs, hier aber schwerer:
      // ein Ankauf über der Schwelle verlangt die Person mit Ausweis (GwG).
      // Ohne Kennung darf `onCreated` nicht laufen, und der Kassierer muss
      // wissen, dass er NICHT noch einmal anlegen darf — sonst stehen zwei
      // Akten derselben Person in den Büchern.
      if (istSicherEingereiht(err)) {
        addToast(eingereihtHinweis('Kunde'));
        setError(
          'Der Kunde ist offline gespeichert und wird übertragen. Diesem Ankauf ' +
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
    <>
      <ParchmentCard
        padding="md"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      >
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

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'auto' }}>
        <Button variant="ghost" size="md" onClick={onCancel} disabled={submitting}>
          Abbrechen
        </Button>
        <Button variant="primary" size="md" onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? 'Speichert…' : 'Anlegen'}
        </Button>
      </div>
    </>
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
