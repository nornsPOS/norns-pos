/**
 * SchichtschlussDialog — die Blindzählung beim Schichtschluss.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ DIESES FENSTER SCHLIESST DIE SCHICHT — NICHT DEN KASSENTAG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Hier stand über der Blindzählung die Überschrift „Tagesabschluss", der Knopf
 * hiess „Schließen und Z-Bon ausgeben", die Erfolgsmeldung „Z-Bon ausgegeben",
 * und der Infopunkt daneben (`KassenbuchPanel.tsx:245`) sagte wörtlich, der
 * Z-Bon sei „der gesetzliche Tagesabschluss nach KassenSichV" und friere den
 * Kassentag unwiderruflich ein.
 *
 * Gerufen wird von hier aber `shiftsApi.close` — der SCHICHTSCHLUSS. Der
 * gesetzliche Tagesabschluss ist `closingsApi.finalize`, und der hatte in der
 * ganzen Kasse NULL Aufrufer.
 *
 * Der Händler schloss also abends die Schicht, las die Erfolgsmeldung und
 * hielt den Tag für erledigt. Es entstand KEINE Zeile in `daily_closings` —
 * und ohne die gibt es kein DSFinV-K, kein DATEV und keinen Kassenbericht für
 * den Tag. Eine Lüge auf einer ausgelieferten Fläche, die den Händler in eine
 * Lücke laufen liess, die erst der Prüfer bemerkt.
 *
 * Seitdem gilt hier durchgängig EIN Wortschatz: Schichtschluss, Blindzählung,
 * Kassensturz, Differenz. „Z-Bon", „Tagesabschluss" und jeder Gesetzesbezug
 * gehören dem echten Tagesabschluss (`TagesabschlussDialog.tsx`) — der
 * Wächter `schichtschluss-ist-kein-tagesabschluss.test.ts` hält das fest.
 *
 * ⚠️ Der DATEINAME bleibt `ZBonDialog.tsx`: `lib/fenster-wache.test.ts:55` und
 * `sicherung-haengt-am-abschluss.test.ts:32` zeigen namentlich darauf, und
 * beide gehören einem anderen Arbeitspaket. Ein Dateiname steht auf keinem
 * Bildschirm; der Wortschatz für den Menschen ist gerade gerichtet worden.
 *
 * ── DIE BLINDZÄHLUNG ──────────────────────────────────────────────────────
 *
 * The cashier counts the physical drawer FIRST and types the result; the
 * route then reveals the system-computed expected balance + the variance.
 * The Owner audit chain requires the operator's number land BEFORE seeing
 * what the system thinks — otherwise the "blind" guarantee is broken.
 *
 * Step-up: the `/api/shifts/:id/close` route returns 403 STEP_UP_REQUIRED
 * when the session is not fresh. Our wrapWithStepUp interceptor (memory.md
 * #76 ⑦) catches it transparently — this dialog never needs to ask for PIN
 * explicitly. The brand StepUpModal pops, the operator types PIN, and the
 * close call retries.
 *
 * Two phases:
 *   1. INPUT  — operator types blindCountEur, optional note
 *   2. RESULT — once `/close` returns, render variance + reset CTA
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError, type ShiftView, shifts as shiftsApi } from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';
import { useApiClient } from '../../lib/api-context.js';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';
import { FENSTER_ROLLRAHMEN, useFensterRahmen } from '../../lib/fenster-rahmen.js';
import { classifyDifferenz } from '../../lib/kassensturz.js';
import { sichereNachAbschluss } from '../../lib/sichere-nach-abschluss.js';
import { useToastStore } from '../../state/toast-store.js';

import { describeError } from '@norns/i18n-de';
import { EuroInput } from './EuroInput.js';
import {
  meldungNachSchichtschluss,
  type Sicherungsmeldung,
} from './sicherungsmeldung-schichtschluss.js';

export interface SchichtschlussDialogProps {
  open: boolean;
  shiftId: string;
  onClose: () => void;
}

export function SchichtschlussDialog({
  open,
  shiftId,
  onClose,
}: SchichtschlussDialogProps): JSX.Element | null {
  const api = useApiClient();
  const { invalidateShiftScope } = useCurrentShift();
  const addToast = useToastStore((s) => s.addToast);

  const [blindCountEur, setBlindCountEur] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<ShiftView | null>(null);

  /**
   * ⚠️ DIE SICHERUNGSMELDUNG WIRD UMGESCHRIEBEN, NICHT DURCHGEREICHT.
   *
   * ── DER NACHGEMESSENE BEFUND VOM 13.08.2026 ─────────────────────────────
   * Vorher stand hier `sichereNachAbschluss(addToast)`. Scheitert die
   * Sicherung, beginnt ihr Satz mit „Der Tagesabschluss ist gebucht"
   * (`lib/sicherung-nach-abschluss.ts:78`). Gebucht ist an dieser Stelle aber
   * nur der SCHICHTSCHLUSS — `closingsApi.finalize` hat nie stattgefunden.
   * Damit stand dieselbe Lüge wieder auf dem Schirm, nur aus einer anderen
   * Datei ausgelöst: der Händler liest, der Tag sei durch, und geht heim.
   *
   * Der Satz gehört einem anderen Arbeitspaket und ist dort nach einem echten
   * Tagesabschluss wörtlich richtig. Also richtet ihn der Aufrufer, für den er
   * falsch ist — mit erhaltenem Grund der Ablehnung.
   */
  const meldeSicherung = useCallback(
    (meldung: Sicherungsmeldung) => addToast(meldungNachSchichtschluss(meldung)),
    [addToast],
  );

  // Reset on open.
  useEffect(() => {
    if (open) {
      setBlindCountEur('');
      setNotes('');
      setError(null);
      setClosed(null);
    }
  }, [open]);

  // Von allen acht war dieses Fenster am gefährlichsten ohne Höhenbegrenzung:
  // die zweite Stufe zeigt den fertigen Kassensturz mit allen Zahlarten und
  // der Differenz. Diese Liste wächst mit
  // dem Geschäftstag. Ohne Begrenzung und ohne Rollbereich lief sie an einem
  // umsatzstarken Tag oben und unten aus dem Bild, und der Wurzelkasten steht
  // auf `overflow: hidden` — es gab also keine Möglichkeit, an die Zahlen zu
  // kommen, die man gerade abzeichnen soll. Der gemeinsame Rahmen ersetzt den
  // blossen Escape-Lauscher, der vorher hier stand.
  const rahmenRef = useFensterRahmen({ offen: open, aufSchliessen: onClose, gesperrt: submitting });

  const validAmount = /^\d{1,16}(\.\d{1,2})?$/.test(blindCountEur);
  const canSubmit = validAmount && !submitting && closed === null;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body =
        notes.trim().length > 0 ? { blindCountEur, notes: notes.trim() } : { blindCountEur };
      // The api client is wrapped with wrapWithStepUp — if step-up is
      // required the brand StepUpModal opens, the operator enters PIN,
      // and this call resolves once /api/auth/step-up succeeds.
      const result = await shiftsApi.close(api, shiftId, body);
      setClosed(result);
      const varianceCents = parseCents(result.varianceEur);
      addToast({
        tone: varianceCents === 0n ? 'success' : 'alert',
        title: 'Schicht abgeschlossen',
        // ⚠️ Der zweite Satz ist der eigentliche Schutz. Vorher hiess diese
        // Meldung „Z-Bon ausgegeben", und der Händler ging nach Hause. Der
        // Kassentag war damit NICHT abgeschlossen.
        body:
          varianceCents === 0n
            ? 'Kassensturz ohne Differenz. Der Tagesabschluss folgt noch.'
            : `Differenz: ${result.varianceEur} €. Der Tagesabschluss folgt noch.`,
      });
      await invalidateShiftScope();

      // ── DIE SICHERUNG NACH DEM ABSCHLUSS ─────────────────────────────
      //
      // Basels Auftrag vom 12.08.2026. Gemessener Befund davor: es gab
      // GENAU EINEN Auslöser für eine Sicherung im ganzen Baum — den Knopf
      // in den Einstellungen. Kein Zeitgeber, kein Nachtlauf. Wer ihn nie
      // drückte, hatte nie eine Sicherung und merkte es an dem Tag, an dem
      // die Platte stirbt. § 147 AO verlangt zehn Jahre Vorlagefähigkeit.
      //
      // ⚠️ OHNE `await` und in einem eigenen Zweig: die Sicherung darf den
      // Kassenschluss weder aufhalten noch scheitern lassen. Der Abschluss
      // ist der fiskalische Akt, die Sicherung ist Hygiene. Ein Kassierer,
      // der abends vor einer roten Meldung steht, weil ein USB-Stick fehlt,
      // drückt beim nächsten Mal gar nicht mehr ab.
      void sichereNachAbschluss(meldeSicherung);
    } catch (err) {
      // Sicher eingereiht ist ein ERFOLG, kein Fehler. Siehe
      // src/lib/eingereiht.ts: ApiOfflineQueuedError erbt von `Error`
      // und NICHT von `ApiError`, deshalb fiel dieser Zweig bisher
      // durch und die Kassiererin las „Netzwerk pruefen" — worauf
      // sie folgerichtig erneut drueckte.
      if (istSicherEingereiht(err)) {
        addToast(eingereihtHinweis('Schichtschluss'));
        onClose();
        return;
      }
      if (err instanceof ApiError) {
        // STEP_UP_REQUIRED is handled by the interceptor (it never reaches
        // here unless the operator cancelled the modal). All other API
        // errors land as inline messages.
        if (err.code === 'STEP_UP_REQUIRED') {
          setError('PIN-Bestätigung wurde abgebrochen.');
        } else {
          setError(describeError(err));
        }
      } else {
        setError(ohneApiFehlerSatz(err));
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    addToast,
    api,
    blindCountEur,
    canSubmit,
    invalidateShiftScope,
    meldeSicherung,
    notes,
    onClose,
    shiftId,
  ]);

  if (!open) return null;

  return (
    <Fensterboden><div
      ref={rahmenRef}
      role="dialog"
      aria-modal="true"
      aria-label="Schichtschluss"
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
          width: 'min(520px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          ...FENSTER_ROLLRAHMEN,
        }}
      >
        {closed === null ? (
          <BlindzaehlungEingabe
            blindCountEur={blindCountEur}
            setBlindCountEur={setBlindCountEur}
            notes={notes}
            setNotes={setNotes}
            error={error}
            submitting={submitting}
            canSubmit={canSubmit}
            onSubmit={() => void submit()}
            onCancel={onClose}
          />
        ) : (
          <KassensturzErgebnis shift={closed} onDismiss={onClose} />
        )}
      </ParchmentCard>
    </div></Fensterboden>
  );
}

function BlindzaehlungEingabe({
  blindCountEur,
  setBlindCountEur,
  notes,
  setNotes,
  error,
  submitting,
  canSubmit,
  onSubmit,
  onCancel,
}: {
  blindCountEur: string;
  setBlindCountEur: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  error: string | null;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-summe)',
          textAlign: 'center',
        }}
      >
        Schichtschluss · Blindzählung
      </h2>
      <p
        style={{
          margin: '6px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-betont)',
          textAlign: 'center',
        }}
      >
        Zählen Sie die Schublade jetzt körperlich. Geben Sie das Ergebnis ein, bevor das System den
        erwarteten Betrag enthüllt.
      </p>
      <Zwischentitel label="Gezählter Betrag" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-20)' }}>
        <EuroInput
          label="Bargeld in der Schublade (gezählt)"
          valueEur={blindCountEur}
          onValueChange={setBlindCountEur}
          autoFocus
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
          <label
            htmlFor="zbon-notes"
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)' }}
          >
            Notiz (optional)
          </label>
          <input
            id="zbon-notes"
            type="text"
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
            disabled={submitting}
            maxLength={1024}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              borderBottom: '2px solid var(--w14-tabellenlinie)',
              background: 'transparent',
              color: 'var(--w14-ink)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: 'var(--w14-schrift-betont)',
              padding: 'var(--w14-abstand-8) var(--w14-abstand-4)',
            }}
          />
        </div>
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

      <div
        style={{
          marginTop: 24,
          display: 'flex',
          gap: 'var(--w14-abstand-12)',
          justifyContent: 'flex-end',
        }}
      >
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Abbrechen
        </Button>
        <Button variant="destructive" onClick={onSubmit} disabled={!canSubmit}>
          {submitting ? 'Schließe…' : 'Schicht abschließen'}
        </Button>
      </div>
    </>
  );
}

/**
 * Visible comfort tolerance for the close-out readout. Mirrors the server
 * setting `cash_drawer.variance_alert_threshold_eur` (which drives the alert,
 * not enforcement). The signed Differenz is ALWAYS shown regardless — this only
 * frames whether the difference is worth worrying about.
 */
const VARIANCE_TOLERANCE_EUR = '5.00';

function KassensturzErgebnis({
  shift,
  onDismiss,
}: {
  shift: ShiftView;
  onDismiss: () => void;
}): JSX.Element {
  // Differenz from the SAME fiscal numbers the server returned
  // (systemExpectedEur, blindCountEur) — a math identity equal to the server's
  // generated varianceEur. Never recomputed-and-substituted, never hidden.
  const diff = classifyDifferenz({
    countedEur: shift.blindCountEur,
    expectedEur: shift.systemExpectedEur,
    toleranceEur: VARIANCE_TOLERANCE_EUR,
  });
  const diffColor =
    diff.tone === 'short'
      ? 'var(--w14-wax-red)'
      : diff.tone === 'over'
        ? 'var(--w14-gold)'
        : 'var(--w14-verdigris)';
  const statusLabel = diff.withinTolerance
    ? 'Im Rahmen'
    : diff.tone === 'short'
      ? 'Fehlbetrag'
      : 'Überschuss';

  return (
    <>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-summe)',
          textAlign: 'center',
        }}
      >
        Schicht geschlossen · Kassensturz
      </h2>
      <Zwischentitel />

      {/* Plain close-out readout (UX §4.3 B): Erwartet · Gezählt · Differenz. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-12)' }}>
        <ReadoutRow label="Erwartet" hint="laut System" valueEur={shift.systemExpectedEur ?? '0'} />
        <ReadoutRow label="Gezählt" hint="in der Schublade" valueEur={shift.blindCountEur ?? '0'} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            paddingTop: 'var(--w14-abstand-12)',
            borderTop: '1px solid var(--w14-tabellenlinie)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-2)' }}>
            <span
              className="w14-smallcaps"
              style={{
                fontSize: 'var(--w14-schrift-feld)',
                letterSpacing: '0.08em',
                color: 'var(--w14-ink-aged)',
              }}
            >
              Differenz
            </span>
            <span
              className="w14-smallcaps"
              style={{ fontSize: 'var(--w14-schrift-zeile)', color: diffColor }}
            >
              {statusLabel}
            </span>
          </div>
          <span
            className="w14-tabular"
            style={{
              fontSize: 'var(--w14-schrift-summe)',
              fontWeight: 600,
              color: diffColor,
            }}
          >
            {/* Die Differenz des Kassensturzes: signed faerbt ein negatives
                Vorzeichen, die Groesse kommt vom Elternteil (1em erbt die
                1.5rem oben). */}
            {diff.differenzEur !== null ? (
              <MoneyAmount valueEur={diff.differenzEur} signed style={{ fontWeight: 600 }} />
            ) : (
              '-'
            )}
          </span>
        </div>
      </div>

      <p
        style={{
          margin: '10px 0 0',
          textAlign: 'center',
          fontSize: 'var(--w14-schrift-feld)',
          color: 'var(--w14-ink-faded)',
        }}
      >
        Differenz bis ±5,00 € ist im Rahmen.
      </p>

      <p
        style={{
          margin: '14px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-text)',
          textAlign: 'center',
        }}
      >
        Geschlossen {shift.closedAt ? new Date(shift.closedAt).toLocaleString('de-DE') : ''}
        {' · ID '}
        {shift.id.slice(0, 8)}…
      </p>

      {/*
        ⚠️ DER SATZ, DER VORHER FEHLTE.
        Bis zum 13.08.2026 endete dieses Fenster mit „Z-Bon · Schicht
        geschlossen", und der Händler ging nach Hause. Der Kassentag war damit
        NICHT abgeschlossen: es entstand keine Zeile in `daily_closings`, also
        auch kein Kassenbericht, kein DATEV und kein DSFinV-K für den Tag.
        Hier steht jetzt, was wirklich noch aussteht, und wo es steht.
      */}
      <p
        style={{
          margin: '16px 0 0',
          padding: 'var(--space-3)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
          color: 'var(--w14-ink-aged)',
          fontSize: 'var(--w14-schrift-feld)',
          lineHeight: 1.5,
          textAlign: 'left',
        }}
      >
        Damit ist die Schicht abgerechnet. Der Abschluss des Kassentags ist ein eigener Schritt und
        steht noch aus. Er wartet in der Tageskasse, sobald keine Schicht mehr offen ist.
      </p>

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
        <Button variant="primary" onClick={onDismiss}>
          Schließen
        </Button>
      </div>
    </>
  );
}

/** A prominent close-out readout line: label (+ plain hint) and a large value. */
function ReadoutRow({
  label,
  hint,
  valueEur,
}: {
  label: string;
  hint: string;
  valueEur: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--w14-abstand-12)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-2)' }}>
        <span
          className="w14-smallcaps"
          style={{
            fontSize: 'var(--w14-schrift-feld)',
            letterSpacing: '0.08em',
            color: 'var(--w14-ink-aged)',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-aged)',
            fontStyle: 'italic',
          }}
        >
          {hint}
        </span>
      </div>
      <span
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: 'var(--w14-schrift-titel)',
          fontWeight: 600,
        }}
      >
        <MoneyAmount valueEur={valueEur} />
      </span>
    </div>
  );
}

/** Parse a decimal-string EUR amount into bigint cents (no float drift). */
function parseCents(raw: string | null | undefined): bigint {
  if (!raw) return 0n;
  const trimmed = raw.trim();
  const sign = trimmed.startsWith('-') ? -1n : 1n;
  const abs = sign === -1n ? trimmed.slice(1) : trimmed;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || '0'));
}
