/**
 * AppraisalItemsList — left column of the Bewertung workspace.
 *
 * Roman-numbered list of items + remove buttons + running totals.
 * Status-gated: DRAFT shows "Vollständig — Angebot machen" CTA;
 * COMPLETED shows "Kunde nimmt an" + "Ablehnen".
 */

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  ApiError,
  type AppraisalItemView,
  type AppraisalView,
  appraisalsApi,
} from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, MoneyAmount, ParchmentCard, RomanIndex } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import { itemTypeLabel } from '../../lib/item-type-label.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';

export interface AppraisalItemsListProps {
  appraisal: AppraisalView;
  totalAppraisedEur: string;
  editable: boolean;
  onOpenAcceptance: () => void;
}

export function AppraisalItemsList({
  appraisal,
  totalAppraisedEur,
  editable,
  onOpenAcceptance,
}: AppraisalItemsListProps): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [completeOpen, setCompleteOpen] = useState<boolean>(false);
  const [offerEur, setOfferEur] = useState<string>('');
  const [completing, setCompleting] = useState<boolean>(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const removeItem = async (itemId: string): Promise<void> => {
    try {
      const next = await appraisalsApi.removeItem(api, appraisal.id, itemId);
      qc.setQueryData(['appraisals', appraisal.id], next);
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Entfernen fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Netzwerk prüfen.',
      });
    }
  };

  const completeAppraisal = async (): Promise<void> => {
    if (!isMoneyInput(offerEur) || Number(normalizeDecimal(offerEur)) <= 0) {
      setCompleteError('Bitte Angebotswert > 0 eingeben.');
      return;
    }
    setCompleting(true);
    setCompleteError(null);
    try {
      const next = await appraisalsApi.complete(api, appraisal.id, {
        totalOfferedEur: normalizeDecimal(offerEur),
      });
      qc.setQueryData(['appraisals', appraisal.id], next);
      setCompleteOpen(false);
      onOpenAcceptance();
    } catch (err) {
      setCompleteError(err instanceof ApiError ? describeError(err) : 'Netzwerk prüfen.');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <section
      aria-label="Konvolut"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--w14-abstand-20)',
        gap: 'var(--w14-abstand-14)',
        borderRight: '1px solid var(--w14-rule)',
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
          Konvolut
        </h2>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)' }}
        >
          {appraisal.items.length === 0
            ? 'leer'
            : `${appraisal.items.length} Stück${appraisal.items.length === 1 ? '' : 'e'}`}
        </span>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w14-abstand-10)',
        }}
      >
        {appraisal.items.length === 0 ? (
          <EmptyList />
        ) : (
          appraisal.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              editable={editable}
              onRemove={() => void removeItem(item.id)}
            />
          ))
        )}
      </div>

      <ParchmentCard padding="md" style={{ flexShrink: 0 }}>
        <Zwischentitel label="Summe der Einzelschätzungen" />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            padding: 'var(--w14-abstand-8) 0',
          }}
        >
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-aged)', letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-betont)' }}
          >
            Gesamt
          </span>
          <MoneyAmount valueEur={totalAppraisedEur} emphasis />
        </div>

        {appraisal.totalOfferedEur && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: 'var(--w14-abstand-4) 0',
            }}
          >
            <span
              className="w14-smallcaps"
              style={{ color: 'var(--w14-gold)', letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-text)' }}
            >
              Angebotswert (verhandelt)
            </span>
            <MoneyAmount valueEur={appraisal.totalOfferedEur} emphasis />
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'flex-end' }}>
          {editable && (
            <Button
              variant="primary"
              size="lg"
              onClick={() => setCompleteOpen(true)}
              disabled={appraisal.items.length === 0}
            >
              Vollständig: Angebot machen
            </Button>
          )}
          {appraisal.status === 'COMPLETED' && (
            <Button variant="primary" size="lg" onClick={onOpenAcceptance}>
              Kunde nimmt an
            </Button>
          )}
        </div>
      </ParchmentCard>

      {completeOpen && (
        <CompleteDialog
          totalAppraised={totalAppraisedEur}
          offerEur={offerEur}
          setOfferEur={setOfferEur}
          completing={completing}
          error={completeError}
          onCancel={() => setCompleteOpen(false)}
          onConfirm={() => void completeAppraisal()}
        />
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Row + Empty + Complete dialog
// ────────────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  editable,
  onRemove,
}: {
  item: AppraisalItemView;
  editable: boolean;
  onRemove: () => void;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="md"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 'var(--w14-abstand-12)',
        alignItems: 'start',
      }}
    >
      <RomanIndex value={item.sequenceInLot} tone="gold" />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-grund)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </div>
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)', alignItems: 'baseline', marginTop: 4 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
          >
            {itemTypeLabel(item.itemType)}
          </span>
          {item.weightGrams && (
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {item.weightGrams} g
            </span>
          )}
          {item.finenessDecimal && (
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {item.finenessDecimal}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)', alignItems: 'flex-end' }}>
        <MoneyAmount valueEur={item.individualAppraisedEur} emphasis />
        {editable && (
          <button
            type="button"
            onClick={onRemove}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: 'var(--w14-schrift-zeile)',
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            entfernen
          </button>
        )}
      </div>
    </ParchmentCard>
  );
}

function EmptyList(): JSX.Element {
  return (
    <div
      style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 'var(--w14-abstand-24)', textAlign: 'center' }}
    >
      <p
        style={{
          margin: 0,
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-betont)',
        }}
      >
        Noch keine Stücke erfasst.
        <br />
        Beginnen Sie rechts mit dem ersten Stück.
      </p>
    </div>
  );
}

function CompleteDialog({
  totalAppraised,
  offerEur,
  setOfferEur,
  completing,
  error,
  onCancel,
  onConfirm,
}: {
  totalAppraised: string;
  offerEur: string;
  setOfferEur: (v: string) => void;
  completing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!completing) onCancel();
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
        style={{ width: 'min(460px, 100%)' }}
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
          Angebot festlegen
        </h2>
        <p
          style={{
            margin: '6px 0 0',
            textAlign: 'center',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-text)',
          }}
        >
          Schätzung: <MoneyAmount valueEur={totalAppraised} />
        </p>
        <Zwischentitel label="Angebot an den Kunden" />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
          >
            Lump-Sum-Angebot (€)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={offerEur}
            onChange={(ev) => setOfferEur(ev.target.value.replace(',', '.'))}
            placeholder="z. B. 12500.00"
            autoFocus
            style={{
              border: 'none',
              outline: 'none',
              borderBottom: '2px solid var(--w14-feldlinie)',
              background: 'transparent',
              padding: 'var(--w14-abstand-8) var(--w14-abstand-4)',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-titel)',
              color: 'var(--w14-ink)',
            }}
          />
        </label>
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
          <Button variant="ghost" onClick={onCancel} disabled={completing}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={completing}>
            {completing ? 'Bestätigt…' : 'Angebot bestätigen'}
          </Button>
        </div>
      </ParchmentCard>
    </div></Fensterboden>
  );
}
