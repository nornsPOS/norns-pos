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

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  ApiError,
  type CustomerCreateBody,
  type CustomerDetail,
  customersApi,
} from '@norns/api-client';
import { Button, Zwischentitel, Fensterboden, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { MrzScanner } from '../../components/MrzScanner.js';
import { standSatz } from '../../lib/abfragestand.js';
import { type Ausweisuebernahme, uebernimmAusweis } from '../../lib/ausweis-uebernahme.js';
import { useFensterRahmen } from '../../lib/fenster-rahmen.js';
import { useApiClient } from '../../lib/api-context.js';
import { germanDateToIso } from '../../lib/german-date.js';
import { KundenSucher, VertrauensZeichen, useKundenSuche } from '../kunden/KundenSucher.js';
import { type VerkaeuferStand, useVerkaeuferStand } from './verkaeufer-stand.js';
import { useAnkaufCartStore } from '../../state/ankauf-cart-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';

type Mode = 'SEARCH' | 'CREATE';

export function CustomerPanel(): JSX.Element {
  const setCustomerId = useAnkaufCartStore((s) => s.setCustomerId);
  // DIESELBE Quelle, die auch den Boden entscheiden lässt. Zwei eigene
  // Abfragen könnten verschiedener Meinung sein: die Spalte zeigte einen
  // Verkäufer, das Formular bliebe gesperrt (oder umgekehrt).
  const stand = useVerkaeuferStand();

  if (stand.kennung === null) {
    return <SearchOrCreate onSelect={(id) => setCustomerId(id)} />;
  }
  return <SelectedCustomer stand={stand} onClear={() => setCustomerId(null)} />;
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
  stand: vs,
  onClear,
}: {
  stand: VerkaeuferStand;
  onClear: () => void;
}): JSX.Element {

  /*
   * ── 20.08.2026: DIESE SPALTE WAR LEER, UND ZWAR STUMM ───────────────────
   *
   * An der laufenden Kasse gemessen: die Abfrage hing in
   * `fetchStatus: 'paused'` — einmal gescheitert, dann schlafen gelegt, weil
   * react-query die Anwendung für offline hielt. Dabei ist `isLoading`
   * falsch, `isError` falsch und `data` leer. Die drei Zweige, die hier
   * standen, trafen alle drei nicht, und der Mensch am Tresen sah eine halbe
   * Fläche Nichts. `lib/abfragestand.ts` trägt die Begründung.
   *
   * Beides — der Stand der Abfrage und die Frage, ob der Verkäufer wirklich
   * feststeht — kommt jetzt aus `verkaeufer-stand.ts`, damit die Spalte und
   * der Boden nicht verschiedener Meinung sein können.
   */
  const { stand, geist, verkaeufer } = vs;

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

      {verkaeufer !== null ? (
        <CustomerCard detail={verkaeufer} />
      ) : (
        <ParchmentCard padding="md">
          <p
            role={stand.art === 'fehler' ? 'alert' : 'status'}
            style={{
              margin: 0,
              color: stand.art === 'fehler' ? 'var(--w14-wax-red)' : 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-betont)',
              lineHeight: 1.5,
              textWrap: 'pretty',
            }}
          >
            {standSatz(stand, 'Der Verkäufer')}
          </p>

          {/*
            ── DER GEIST IM WARENKORB (20.08.2026) ────────────────────────
            Ist der gemerkte Verkäufer WEG — geloescht nach der
            Datenschutz-Grundverordnung, oder die Buecher kamen aus einer
            Sicherung zurueck —, dann hilft kein Warten. Die Kasse sagt das
            und bietet den einen Griff an, der weiterhilft.
          */}
          {geist && (
            <p style={{ margin: 'var(--w14-abstand-10) 0 0', color: 'var(--w14-ink-faded)', lineHeight: 1.5 }}>
              Vielleicht wurde die Person gelöscht, oder dieser Ankauf wurde an
              einer anderen Kasse begonnen. Wählen Sie sie neu aus.
            </p>
          )}

          {(geist || stand.art === 'fehler') && (
            <div style={{ marginTop: 'var(--w14-abstand-14)' }}>
              <Button variant="primary" size="sm" onClick={onClear}>
                Verkäufer neu wählen
              </Button>
            </div>
          )}
        </ParchmentCard>
      )}
    </section>
  );
}

/*
 * 20.08.2026: hier stand `SkeletonCard`, die Ladekarte dieser Spalte. Ihr
 * einziger Leser war der `isLoading`-Zweig; er ist der erschöpfenden
 * Fallunterscheidung gewichen (`lib/abfragestand.ts`), die das Laden mit
 * demselben Satzbau sagt wie das Warten und das Scheitern.
 */


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

  /*
   * ── DER AUSWEISLESER (20.08.2026, Basels Frage) ───────────────────────
   *
   * Basel hat nach dem Ausweisleser am Ankauf gefragt. Beim Nachmessen kam
   * heraus: er war GEBAUT — Kamera, Handeingabe und ein Auswerter mit allen
   * Prüfziffern nach ICAO 9303 — und an KEINER Fläche eingebaut.
   *
   * Hier gehört er hin: an die Stelle, an der die Person entsteht, die nach
   * § 10 GwG identifiziert sein muss.
   *
   * ⚠️ Ohne Kamera und ohne Texterkennung bleibt er trotzdem nützlich: die
   * Handeingabe nimmt die zwei oder drei Maschinenzeilen entgegen, und die
   * üblichen Ausweisleser am Tresen tippen genau die als Tastatur ein.
   */
  const [leserOffen, setLeserOffen] = useState<boolean>(false);
  const [ausweis, setAusweis] = useState<Ausweisuebernahme | null>(null);
  // Escape, Anfangsfokus, Fokusfang und die Rückgabe des Fokus — aus dem
  // gemeinsamen Rahmen, statt sie hier ein weiteres Mal zu bauen.
  const leserRahmen = useFensterRahmen({
    offen: leserOffen,
    aufSchliessen: () => setLeserOffen(false),
  });

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
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={() => setLeserOffen(true)}>
            Ausweis einlesen
          </Button>
        </div>

        {/*
          ⚠️ Was der Ausweis SAGT, und wie sicher. Eine Kasse, die eine
          unstimmige Nummer wortlos ins Formular schreibt, nimmt dem Händler
          die Möglichkeit, genauer hinzusehen — und die Identifizierung nach
          § 10 GwG ist SEINE Pflicht, nicht die der Kasse.
        */}
        {ausweis && (
          <p
            role="status"
            style={{
              margin: 0,
              padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
              borderRadius: 'var(--w14-radius-button)',
              background:
                ausweis.geprueft && !ausweis.abgelaufen
                  ? 'rgb(var(--w14-verdigris-rgb) / 0.10)'
                  : 'rgb(var(--w14-wax-red-rgb) / 0.10)',
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-zeile)',
              lineHeight: 1.5,
              textWrap: 'pretty',
            }}
          >
            {ausweis.dokumentennummer} · {ausweis.staat}
            {ausweis.geprueft
              ? ' · Angaben gehen auf'
              : /*
                 ⚠️ 20.08.2026: hier stand „Prüfziffern stimmen NICHT". Beim
                 Gegenprüfen mit einem Muster stimmten alle vier Prüfziffern —
                 unbekannt war der STAATENCODE. Eine falsch benannte Ursache
                 schickt den Händler an die falsche Stelle; bei einer
                 Identifizierung nach § 10 GwG ist das schlimmer als gar keine
                 Angabe. Also wird genannt, was WIRKLICH nicht aufging.
                */
                ` · ⚠️ nicht in Ordnung: ${ausweis.beanstandet.join(', ')}`}
            {ausweis.abgelaufen ? ' · ⚠️ Ausweis ist abgelaufen' : ''}
          </p>
        )}

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

      {leserOffen && (
        <Fensterboden>
          <div
            ref={leserRahmen}
            role="dialog"
            aria-modal="true"
            aria-label="Ausweis einlesen"
            style={{
              position: 'fixed',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'rgb(var(--w14-ink-rgb) / 0.45)',
              padding: 'var(--w14-abstand-20)',
            }}
          >
            <ParchmentCard
              padding="md"
              style={{ maxWidth: 520, width: '100%', maxHeight: '90dvh', overflowY: 'auto' }}
            >
              <MrzScanner
                onCancel={() => setLeserOffen(false)}
                onResult={(person) => {
                  const u = uebernimmAusweis(person);
                  setAusweis(u);
                  // ⚠️ Nur FÜLLEN, nie überschreiben, was schon dasteht: hat
                  // der Kassierer den Namen bereits getippt, ist seine
                  // Schreibweise die gewollte.
                  if (fullName.trim() === '') setFullName(u.fullName);
                  if (dateOfBirth.trim() === '' && u.geburtsdatum !== null) {
                    setDateOfBirth(u.geburtsdatum);
                  }
                  setLeserOffen(false);
                }}
              />
            </ParchmentCard>
          </div>
        </Fensterboden>
      )}
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
