/**
 * AcceptanceDialog — the final strike (Day 11).
 *
 * Confirms the customer accepts the offer and triggers the atomic
 * `POST /api/appraisals/:id/accept` route. The route is:
 *   • Owner-only (route enforces requireOwner)
 *   • Step-up mandatory (route enforces requireStepUp; interceptor opens modal)
 *   • Paired-device required (route enforces req.deviceId)
 *   • Creates Ankauf transaction + parent + N child products + transaction_items
 *     + transaction_payments — all in one DB transaction (the Day-11 fix to #I-38)
 *
 * The dialog also surfaces:
 *   • GwG warning when totalOfferedEur ≥ €2,000 and KYC is missing
 *     — operator must stamp KYC first (we link to Kunden surface)
 *   • Sanctions / banned warning that disables the action entirely
 *
 * On success: cache invalidates, store resets, the outcome view appears.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, type AppraisalView, appraisalsApi, customersApi } from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { evaluateKycGate } from '../../lib/ankauf-kyc-gate.js';
import { useApiClient } from '../../lib/api-context.js';
import { FENSTER_ROLLRAHMEN, useFensterRahmen } from '../../lib/fenster-rahmen.js';
import { toCents } from '../../lib/bewertung-math.js';
import { etikettenFuerKonvolut, etikettenHinweis } from '../../lib/etiketten-fuer-konvolut.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';
import { useBewertungStore } from '../../state/bewertung-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';
import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';

export interface AcceptanceDialogProps {
  open: boolean;
  appraisal: AppraisalView;
  onClose: () => void;
}

export function AcceptanceDialog({
  open,
  appraisal,
  onClose,
}: AcceptanceDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const resetBewertung = useBewertungStore((s) => s.reset);
  const printer = useLabelPrinter();

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>('');

  /**
   * §19.3 W-1 — synchronous mutex shared by accept + reject. Both flip the
   * async `submitting` state, so a fast double-click can re-enter before React
   * commits it — accept could create two Ankauf transactions, reject could fire
   * two rejections. The ref is visible immediately on the next synchronous read.
   */
  const inFlightRef = useRef<boolean>(false);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setError(null);
      setRejecting(false);
      setRejectReason('');
      inFlightRef.current = false;
    }
  }, [open]);

  // Dieses Fenster zeigt eine Tabelle, die mit der Zahl der angekauften Stücke
  // wächst, dazu das Angebot, den KYC-Riegel und im Ablehnungsfall noch ein
  // Begründungsfeld. Bei einem Konvolut aus vielen Posten lief es ohne
  // Höhenbegrenzung oben aus dem Bild, und weil der Wurzelkasten auf
  // `overflow: hidden` steht, kam niemand mehr an die Überschrift. Der
  // gemeinsame Rahmen ersetzt den blossen Escape-Lauscher.
  const rahmenRef = useFensterRahmen({ offen: open, aufSchliessen: onClose, gesperrt: submitting });

  // Customer detail for KYC + sanctions check.
  const customerQ = useQuery({
    queryKey: ['customers', appraisal.customerId],
    queryFn: () => customersApi.get(api, appraisal.customerId),
    staleTime: 5_000,
  });
  const customer = customerQ.data;

  const totalOfferedEur = appraisal.totalOfferedEur ?? appraisal.totalAppraisedEur;
  const totalCents = toCents(totalOfferedEur);
  // Accepting a Konvolut IS an Ankauf, so it falls under the SAME identity rule
  // as the single-item buy: ID required from €0,01 (§259 StGB Hehlerei), NOT the
  // €2.000 §10 threshold. Use the shared gate, identical to AnkaufBezahlenDialog.
  const kycGate = evaluateKycGate({ direction: 'ANKAUF', totalCents, customer: customer ?? null });

  const sanctioned = customer?.sanctionsMatch === true;
  const banned = customer?.trustLevel === 'BANNED';
  const blocked = sanctioned || banned;
  const kycMissingForGwg = kycGate.required;

  const canAccept = customer !== undefined && !blocked && !kycMissingForGwg && !submitting;

  const accept = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    if (!canAccept) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await appraisalsApi.accept(api, appraisal.id);
      addToast({
        tone: 'success',
        title: 'Konvolut angenommen',
        body: `${appraisal.items.length} Stücke ins Lager überführt.`,
      });

      /*
       * Die ARTIKELNUMMER wird nachgeschlagen, nicht die Datensatz-Kennung
       * genommen. Siehe `lib/etiketten-fuer-konvolut.ts`: ein Etikett mit
       * einer UUID als Barcode ist am eigenen Tresen nicht scanbar.
       *
       * Das Ergebnis wird ABGEWARTET, obwohl der Druck nebenher laufen
       * koennte: nur so kann gesagt werden, wenn ein Stueck kein Etikett
       * bekommt. Ein stiller Teilerfolg faellt erst am Regal auf.
       */
      const ergebnis = await etikettenFuerKonvolut(api, result.items);
      const hinweis = etikettenHinweis(ergebnis);
      if (hinweis) {
        addToast({ tone: 'alert', title: 'Nicht alle Etiketten', body: hinweis });
      }
      if (ergebnis.etiketten.length > 0) {
        void printer.print(ergebnis.etiketten);
      }

      // Invalidate everything the acceptance touched.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['appraisals', appraisal.id] }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: ['customers', appraisal.customerId] }),
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') setError('PIN-Bestätigung wurde abgebrochen.');
        else if (err.code === 'SANCTIONS_BLOCK') setError('Sanktionen. Annahme verweigert.');
        else if (err.code === 'CLOSING_DAY_FINALIZED')
          setError('Heutiger Tagesabschluss ist bereits geschlossen.');
        else if (err.code === 'DEVICE_NOT_AUTHORIZED')
          setError('Dieses Gerät ist nicht autorisiert. Bitte am POS-Terminal annehmen.');
        else setError(describeError(err));
      } else {
        setError(ohneApiFehlerSatz(err));
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    api,
    appraisal.customerId,
    appraisal.id,
    appraisal.items.length,
    canAccept,
    onClose,
    qc,
    printer,
  ]);

  const reject = useCallback(async (): Promise<void> => {
    // §19.3 W-1 mutex — read+set SYNCHRONOUSLY before any async work so a
    // double-click on "Endgültig ablehnen" can't fire the rejection twice.
    if (inFlightRef.current) return;
    if (rejectReason.trim().length < 4) {
      setError('Begründung erforderlich (mind. 4 Zeichen).');
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await appraisalsApi.reject(api, appraisal.id, { reason: rejectReason.trim() });
      addToast({
        tone: 'info',
        title: 'Bewertung abgelehnt',
        body: 'Kunde nimmt das Angebot nicht an.',
      });
      await qc.invalidateQueries({ queryKey: ['appraisals', appraisal.id] });
      resetBewertung();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err) : 'Netzwerk prüfen.');
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [addToast, api, appraisal.id, onClose, qc, rejectReason, resetBewertung]);

  if (!open) return null;

  return (
    <Fensterboden><div
      ref={rahmenRef}
      role="dialog"
      aria-modal="true"
      aria-label="Bewertung annehmen"
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
          width: 'min(580px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          ...FENSTER_ROLLRAHMEN,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-summe)',
            textAlign: 'center',
          }}
        >
          Bewertung abschließen
        </h2>
        <p
          style={{
            margin: '6px 0 0',
            textAlign: 'center',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-betont)',
          }}
        >
          {appraisal.items.length} Stück{appraisal.items.length === 1 ? '' : 'e'} ·{' '}
          {customer?.fullName ?? '…'}
        </p>

        <Zwischentitel label="Angebot" />
        <table
          className="w14-tabular"
          style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--w14-font-mono)' }}
        >
          <tbody>
            <Row
              label="Summe der Einzelschätzungen"
              valueEl={<MoneyAmount valueEur={appraisal.totalAppraisedEur} />}
            />
            <Row
              label="Angebot an den Kunden"
              valueEl={<MoneyAmount valueEur={totalOfferedEur} emphasis />}
              emphasised
            />
          </tbody>
        </table>

        {blocked && (
          <ParchmentCard
            padding="md"
            style={{ marginTop: 12, border: '2px solid var(--w14-wax-red)' }}
          >
            <p style={{ margin: 0, color: 'var(--w14-wax-red)', fontWeight: 500 }}>
              Geschäft mit diesem Kunden nicht zulässig ({sanctioned ? 'Sanktion' : 'gesperrt'}).
            </p>
          </ParchmentCard>
        )}

        {kycMissingForGwg && !blocked && (
          <ParchmentCard
            padding="md"
            style={{ marginTop: 12, border: '1px solid var(--w14-wax-red)' }}
          >
            <p
              style={{
                margin: 0,
                color: 'var(--w14-wax-red)',
                fontFamily: 'var(--w14-font-display)',
              }}
            >
              Ankauf: Identität ab 0,01 € erforderlich (§ 259 StGB / § 10 GwG).
            </p>
            <p
              style={{
                margin: '4px 0 8px',
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: 'var(--w14-schrift-text)',
              }}
            >
              Bitte zuerst im Tab „Kunden" die Identität physisch prüfen und KYC bestätigen.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/kunden?id=${appraisal.customerId}`)}
            >
              → Zu Kunden öffnen
            </Button>
          </ParchmentCard>
        )}

        {!rejecting ? (
          <>
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
              style={{ marginTop: 22, display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'space-between' }}
            >
              <Button variant="ghost" onClick={() => setRejecting(true)} disabled={submitting}>
                Kunde lehnt ab
              </Button>
              <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)' }}>
                <Button variant="ghost" onClick={onClose} disabled={submitting}>
                  Abbrechen
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => void accept()}
                  disabled={!canAccept}
                >
                  {submitting ? 'Schließt ab…' : 'Annehmen & Ankauf erstellen'}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <Zwischentitel label="Ablehnung: Begründung" />
            <textarea
              value={rejectReason}
              onChange={(ev) => setRejectReason(ev.target.value)}
              rows={3}
              placeholder="Z. B. Kunde wollte mehr als unser Angebot."
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                borderBottom: '2px solid var(--w14-feldlinie)',
                background: 'transparent',
                padding: 'var(--w14-abstand-8) var(--w14-abstand-4)',
                fontFamily: 'var(--w14-font-body)',
                fontSize: 'var(--w14-schrift-betont)',
                resize: 'vertical',
                color: 'var(--w14-ink)',
              }}
            />
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
            <div style={{ marginTop: 22, display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setRejecting(false)} disabled={submitting}>
                Zurück
              </Button>
              <Button variant="destructive" onClick={() => void reject()} disabled={submitting}>
                {submitting ? 'Lehnt ab…' : 'Endgültig ablehnen'}
              </Button>
            </div>
          </>
        )}
      </ParchmentCard>
    </div></Fensterboden>
  );
}

function Row({
  label,
  valueEl,
  emphasised = false,
}: {
  label: string;
  valueEl: JSX.Element;
  emphasised?: boolean;
}): JSX.Element {
  return (
    <tr>
      <td
        style={{
          padding: 'var(--w14-abstand-8) 0',
          color: emphasised ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.08em',
          fontSize: emphasised ? 'var(--w14-schrift-betont)' : 'var(--w14-schrift-feld)',
        }}
      >
        {label}
      </td>
      <td style={{ padding: 'var(--w14-abstand-8) 0', textAlign: 'right' }}>{valueEl}</td>
    </tr>
  );
}
