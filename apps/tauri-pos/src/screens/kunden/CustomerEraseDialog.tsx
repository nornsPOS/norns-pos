/**
 * CustomerEraseDialog — DSGVO Art. 17 (Recht auf Löschung).
 *
 * Calls `POST /api/customers/:id/erase` (ADMIN + step-up; the wrapWithStepUp
 * interceptor drives the PIN dialog + retry, exactly as CustomerTrustDialog does).
 * The server anonymizes the customer IN PLACE and deletes their server-side KYC
 * images; fiscal / GoBD / GwG records are kept with PII redacted and the
 * `customer_number` survives as a pseudonym.
 *
 * IRREVERSIBLE, so two gates guard it: the operator must type the confirm word,
 * AND the server enforces a step-up PIN. On success we also purge the LOCAL
 * encrypted Ausweis-Tresor for this customer (the Phase 3.2 delete), so the
 * erase is total — no at-rest PII copy survives on this till either.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError, type CustomerDetail, customersApi } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Fensterboden, Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { FENSTER_ROLLRAHMEN, useFensterRahmen } from '../../lib/fenster-rahmen.js';
import { deleteKycDocument, isRunningInTauri } from '../../lib/hardware-client.js';
import { deleteKycRecord, listKycForCustomer } from '../../lib/kyc-store.js';
import { useToastStore } from '../../state/toast-store.js';

import { kycLocalQueryKey } from './KycLocalDocs.js';
import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';

/** The word the operator types to arm the irreversible erase. */
const CONFIRM_WORD = 'LÖSCHEN';

/**
 * The honest outcome of purging this customer's local encrypted Ausweis files.
 * The server erase is the authoritative action; this reports what actually
 * happened to the offline cached copies on THIS till.
 *
 *  - `none`    — not a Tauri till, so there is no local vault to purge.
 *  - `cleared` — every local file for this customer was removed (or there were none).
 *  - `partial` — one or more files could not be removed; at-rest copies may remain.
 *  - `unknown` — the local index could not even be READ, so the state is
 *                indeterminate. Crucially this is NOT the same as "empty": we must
 *                never claim the vault was emptied when we could not look inside it.
 */
type LocalPurge =
  | { kind: 'none' }
  | { kind: 'cleared' }
  | { kind: 'partial'; failed: number }
  | { kind: 'unknown' };

async function purgeLocalVault(customerId: string): Promise<LocalPurge> {
  // Outside a Tauri webview (browser / Vitest) there is no local vault at all.
  if (!isRunningInTauri()) return { kind: 'none' };

  let records: Awaited<ReturnType<typeof listKycForCustomer>>;
  try {
    records = await listKycForCustomer(customerId);
  } catch {
    // Inside Tauri but the local index could not be read — we cannot honestly
    // claim the vault is empty, so report the indeterminate state.
    return { kind: 'unknown' };
  }

  let failed = 0;
  for (const rec of records) {
    try {
      await deleteKycDocument(rec.filePath);
      await deleteKycRecord(rec.id);
    } catch {
      failed += 1;
    }
  }
  return failed > 0 ? { kind: 'partial', failed } : { kind: 'cleared' };
}

export interface CustomerEraseDialogProps {
  open: boolean;
  customer: CustomerDetail;
  onClose: () => void;
}

export function CustomerEraseDialog({
  open,
  customer,
  onClose,
}: CustomerEraseDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [confirmText, setConfirmText] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmText('');
    setSubmitting(false);
    setError(null);
  }, [open]);

  // Escape, Anfangsfokus, Fokusfang und Höhenbegrenzung kommen jetzt aus dem
  // gemeinsamen Rahmen. Vorher lag hier nur der Escape-Lauscher: das Fenster
  // hatte weder eine Höhenbegrenzung noch einen Rollbereich, und da der
  // Wurzelkasten auf `overflow: hidden` steht, war die rote Überschrift
  // „Kundendaten löschen" bei kleinem Schirm oberhalb der Bildkante — also
  // unerreichbar. Ausgerechnet bei dem Fenster, das unwiderruflich löscht.
  const rahmenRef = useFensterRahmen({ offen: open, aufSchliessen: onClose, gesperrt: submitting });

  const armed = confirmText.trim().toUpperCase() === CONFIRM_WORD && !submitting;

  const submit = async (): Promise<void> => {
    if (!armed) return;
    setSubmitting(true);
    setError(null);
    try {
      await customersApi.erase(api, customer.id);
      // Server erase succeeded — now purge the local at-rest copies and report
      // exactly what happened to them (never a blanket "geleert").
      const purge = await purgeLocalVault(customer.id);
      const localLine =
        purge.kind === 'cleared'
          ? 'Lokaler Ausweis-Tresor geleert.'
          : purge.kind === 'partial'
            ? `${purge.failed} lokale Tresor-Datei(en) konnten nicht entfernt werden.`
            : purge.kind === 'unknown'
              ? 'Lokaler Ausweis-Tresor konnte nicht geprüft werden. Bitte an dieser Kasse manuell kontrollieren.'
              : ''; // 'none' — no local vault on this till, nothing to mention.
      const clean = purge.kind === 'cleared' || purge.kind === 'none';

      addToast({
        tone: clean ? 'success' : 'alert',
        title: 'Kundendaten gelöscht',
        body: localLine ? `Serverseitig anonymisiert. ${localLine}` : 'Serverseitig anonymisiert.',
      });
      await qc.invalidateQueries({ queryKey: ['customers', customer.id] });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      await qc.invalidateQueries({ queryKey: kycLocalQueryKey(customer.id) });
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
      aria-label="Kundendaten löschen"
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
          width: 'min(480px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          border: '2px solid var(--w14-wax-red)',
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
            color: 'var(--w14-wax-red)',
          }}
        >
          Kundendaten löschen
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
          {customer.fullName} · {customer.customerNumber}
        </p>

        <Zwischentitel label="Recht auf Löschung (Art. 17)" />

        <p style={{ margin: '4px 0 0', fontSize: 'var(--w14-schrift-text)', lineHeight: 1.5 }}>
          Alle personenbezogenen Daten dieses Kunden werden unwiderruflich
          anonymisiert und die gespeicherten Ausweisbilder gelöscht, server- und
          geräteseitig. Steuer-, GoBD- und GwG-Belege bleiben mit geschwärzten
          Daten erhalten; die Kundennummer bleibt als Pseudonym bestehen.
        </p>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 'var(--w14-schrift-text)',
            color: 'var(--w14-wax-red)',
            fontStyle: 'italic',
          }}
        >
          Dieser Schritt kann nicht rückgängig gemacht werden.
        </p>

        <label
          htmlFor="w14-erase-confirm"
          className="w14-smallcaps"
          style={{
            display: 'block',
            color: 'var(--w14-ink-aged)',
            fontSize: 'var(--w14-schrift-zeile)',
            letterSpacing: '0.08em',
            marginTop: 16,
          }}
        >
          Zum Bestätigen »{CONFIRM_WORD}« eingeben
        </label>
        <input
          id="w14-erase-confirm"
          type="text"
          value={confirmText}
          onChange={(ev) => setConfirmText(ev.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={submitting}
          style={{
            width: '100%',
            marginTop: 6,
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-feldlinie)',
            background: 'transparent',
            padding: 'var(--w14-abstand-6) var(--w14-abstand-4)',
            // Zielfläche: das Feld war rund 30 Pixel hoch, also unter der
            // Grenze von 44. Wer den Bestätigungstext eintippen muss, soll
            // nicht erst zielen müssen.
            minHeight: 'var(--w14-touch-min)',
            fontFamily: 'var(--w14-font-mono)',
            letterSpacing: '0.12em',
            fontSize: 'var(--w14-schrift-grund)',
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

        <div style={{ marginTop: 22, display: 'flex', gap: 'var(--w14-abstand-12)', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={!armed}>
            {submitting ? 'Löscht…' : 'Endgültig löschen'}
          </Button>
        </div>
      </ParchmentCard>
    </div></Fensterboden>
  );
}
