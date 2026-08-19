/**
 * DeleteProductDialog — „Endgültig löschen" from the Lager row action.
 *
 * Three calm states, decided by the row the operator picked:
 *
 *   • DRAFT / AVAILABLE (never transacted) → the gentle, honest warning
 *     („Wird unwiderruflich gelöscht — Fotos und Zuordnungen eingeschlossen.")
 *     plus an explicit no-undo line. Confirm calls DELETE /api/products/:id;
 *     the api-client step-up interceptor opens the PIN modal automatically on
 *     STEP_UP_REQUIRED — no PIN plumbing here.
 *
 *   • SOLD → cannot be deleted (fiscal record). The dialog says so and offers
 *     the existing archive flow (POST /api/products/:id/archive) instead.
 *
 *   • RESERVED / already archived → explain why nothing destructive is
 *     possible right now.
 *
 * The server re-checks everything (status, fiscal items, appointment links,
 * live eBay listing) and answers with German 409 messages — those are shown
 * verbatim in the failure toast. Cache surgery (optimistic row removal +
 * invalidation) is the caller's job via `onDeleted` / `onArchived`.
 */

import { useState } from 'react';

import { ApiError, type ProductListRow, productsApi } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Button, Dialog, DialogBody, DialogFooter, Icon, TriangleAlert } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';

export interface DeleteProductDialogProps {
  open: boolean;
  /** The Lager row the action was invoked on; null while closed. */
  product: ProductListRow | null;
  onClose: () => void;
  /** Fired after the server confirmed the hard delete. */
  onDeleted: (productId: string) => void;
  /** Fired after the server confirmed the archive (SOLD fallback path). */
  onArchived: (productId: string) => void;
}

type Verdict = 'deletable' | 'sold' | 'reserved' | 'archived';

function verdictFor(product: ProductListRow): Verdict {
  if (product.archivedAt) return 'archived';
  if (product.status === 'SOLD') return 'sold';
  if (product.status === 'DRAFT' || product.status === 'AVAILABLE') return 'deletable';
  return 'reserved';
}

export function DeleteProductDialog({
  open,
  product,
  onClose,
  onDeleted,
  onArchived,
}: DeleteProductDialogProps): JSX.Element | null {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);

  if (!product) return null;
  const verdict = verdictFor(product);

  async function removeForever(p: ProductListRow): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      // Step-up PIN: the api-client interceptor opens the StepUpModal on
      // STEP_UP_REQUIRED and replays this request — nothing to do here.
      await productsApi.remove(api, p.id);
      addToast({
        tone: 'success',
        title: 'Endgültig gelöscht',
        body: `${p.sku} wurde unwiderruflich entfernt, inklusive Fotos und Zuordnungen.`,
      });
      onDeleted(p.id);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError ? describeError(err) : ohneApiFehlerSatz(err);
      addToast({ tone: 'alert', title: 'Löschen nicht möglich', body: msg });
    } finally {
      setBusy(false);
    }
  }

  async function archiveInstead(p: ProductListRow): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await api.request('POST', `/api/products/${encodeURIComponent(p.id)}/archive`);
      addToast({
        tone: 'success',
        title: 'Artikel archiviert',
        body: `${p.sku} bleibt in der fiskalischen Aufzeichnung erhalten und ist nun archiviert.`,
      });
      onArchived(p.id);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError ? describeError(err) : ohneApiFehlerSatz(err);
      addToast({ tone: 'alert', title: 'Archivieren nicht möglich', body: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={verdict === 'deletable' ? 'Endgültig löschen' : 'Löschen nicht möglich'}
      size="sm"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      <DialogBody style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <ProductLine product={product} />

        {verdict === 'deletable' && (
          <>
            <p style={BODY_TEXT}>
              Wird unwiderruflich gelöscht, Fotos und Zuordnungen eingeschlossen. Der Artikel
              verschwindet damit auch aus dem Web-Shop.
            </p>
            <p
              style={{
                ...BODY_TEXT,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-2)',
                color: 'var(--w14-wax-red)',
              }}
            >
              <Icon icon={TriangleAlert} size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Es gibt kein Rückgängig und keinen Papierkorb. Zur Sicherheit wird die PIN
                abgefragt.
              </span>
            </p>
          </>
        )}

        {verdict === 'sold' && (
          <p style={BODY_TEXT}>
            Dieses Stück wurde verkauft und ist Teil der fiskalischen Aufzeichnung (GoBD). Es kann
            deshalb nicht gelöscht, sondern nur <strong>archiviert</strong> werden. Es verschwindet
            damit aus den Listen, bleibt aber für Prüfungen erhalten.
          </p>
        )}

        {verdict === 'reserved' && (
          <p style={BODY_TEXT}>
            Dieses Stück ist derzeit <strong>reserviert</strong> und kann nicht gelöscht werden.
            Bitte zuerst die Reservierung aufheben. Danach ist das endgültige Löschen möglich.
          </p>
        )}

        {verdict === 'archived' && (
          <p style={BODY_TEXT}>
            Dieses Stück ist bereits <strong>archiviert</strong> und bleibt als Teil der
            Aufzeichnung erhalten. Ein endgültiges Löschen ist nicht möglich.
          </p>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {verdict === 'deletable' || verdict === 'sold' ? 'Abbrechen' : 'Schließen'}
        </Button>
        {verdict === 'deletable' && (
          <Button variant="destructive" disabled={busy} onClick={() => void removeForever(product)}>
            {busy ? 'Wird gelöscht…' : 'Endgültig löschen'}
          </Button>
        )}
        {verdict === 'sold' && (
          <Button variant="primary" disabled={busy} onClick={() => void archiveInstead(product)}>
            {busy ? 'Wird archiviert…' : 'Stattdessen archivieren'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}

/** Calm identity line so the operator sees WHICH piece is affected. */
function ProductLine({ product }: { product: ProductListRow }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-abstand-2)',
        padding: 'var(--space-3)',
        background: 'var(--w14-parchment-1)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-betont)',
          color: 'var(--w14-ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={product.name}
      >
        {product.name}
      </span>
      <span
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: 'var(--w14-schrift-zeile)',
          color: 'var(--w14-ink-faded)',
        }}
      >
        SKU {product.sku}
      </span>
    </div>
  );
}

const BODY_TEXT = {
  margin: 0,
  fontSize: 'var(--w14-schrift-text)',
  lineHeight: 1.5,
  color: 'var(--w14-ink-aged)',
  fontFamily: 'var(--w14-font-display)',
} as const;
