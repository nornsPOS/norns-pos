/**
 * Ankauf — Tier-1 surface #3 (Day 8). Inventory-creation atom.
 *
 * State machine (mirrors Verkauf but with KYC gate added):
 *   • shift loading   → splash
 *   • shift === null  → ShiftGuard (no shift → no Ankauf)
 *   • shift OPEN      → AnkaufFloor (two-column layout)
 *
 * Within AnkaufFloor:
 *   • Left: CustomerPanel — lookup / create / KYC chip / sanctions guard
 *   • Right: IntakeList (Roman-numbered items) + add-item form + Bezahlen
 *
 * The items panel is LOCKED until a customer is selected. The Bezahlen
 * button is gated by KYC for high-value (GwG threshold) transactions.
 * All compliance gates documented in memory.md §12.3.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { zifferFuerFlaeche } from '../../app/chrome/surface-registry.js';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';
import {
  selectAnkaufCustomerId,
  selectAnkaufItems,
  useAnkaufCartStore,
} from '../../state/ankauf-cart-store.js';

import { ShiftGuard } from '../_shared/ShiftGuard.js';
import { ShiftReadError } from '../_shared/ShiftReadError.js';
import { describeError } from '@norns/i18n-de';
import { ApiError } from '@norns/api-client';

import { AnkaufBezahlenDialog } from './AnkaufBezahlenDialog.js';
import { CustomerPanel } from './CustomerPanel.js';
import { IntakeList } from './IntakeList.js';

export function Ankauf(): JSX.Element {
  const { data: shift, isLoading, isError, error, isFetching, refetch } = useCurrentShift();

  if (isLoading && shift === undefined) return <AnkaufSplash />;

  // Siehe Verkauf: eine unbeantwortete Abfrage ist keine geschlossene Schicht.
  if (shift === undefined) {
    return (
      <ShiftReadError
        digitLabel={zifferFuerFlaeche('/ankauf') ?? '◊'}
        detail={isError && error instanceof ApiError ? describeError(error) : null}
        busy={isFetching}
        onRetry={() => void refetch()}
      />
    );
  }
  if (shift === null) {
    return (
      <ShiftGuard
        digitLabel={zifferFuerFlaeche('/ankauf') ?? '◊'}
        surfaceTitle="Keine offene Schicht"
        lede="Ein Ankauf ohne Schicht hätte kein Kassenbuch-Zuhause. Das Bargeld könnte nicht im Z-Bon abgerechnet werden."
      />
    );
  }
  return <AnkaufFloor />;
}

// ────────────────────────────────────────────────────────────────────────
// Active floor
// ────────────────────────────────────────────────────────────────────────

function AnkaufFloor(): JSX.Element {
  const navigate = useNavigate();
  const customerId = useAnkaufCartStore(selectAnkaufCustomerId);
  const items = useAnkaufCartStore(selectAnkaufItems);
  const [bezahlenOpen, setBezahlenOpen] = useState<boolean>(false);

  const hasCustomer = customerId !== null;
  const hasItems = items.length > 0;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}
    >
      {/* A2 merge: the appraisal flow lives inside Ankauf — a lot is just a
          draft purchase with pro-rata distribution. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: '1px solid var(--w14-rule)',
          background: 'var(--w14-parchment-2)',
        }}
      >
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)' }}>
          Einzelankauf, Stück für Stück.
        </span>
        <button
          type="button"
          onClick={() => navigate('/bewertung')}
          className="w14-smallcaps"
          style={{
            background: 'none',
            border: '1px solid var(--w14-gold)',
            color: 'var(--w14-gold)',
            borderRadius: 'var(--w14-radius-button)',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--w14-schrift-feld)',
            letterSpacing: '0.06em',
            cursor: 'pointer',
            minHeight: 40,
          }}
        >
          Konvolut bewerten (mehrere Stücke) →
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 1fr) minmax(0, 1.6fr)',
          flex: 1,
          minHeight: 0,
        }}
      >
        <CustomerPanel />
        <IntakeList customerSelected={hasCustomer} onOpenBezahlen={() => setBezahlenOpen(true)} />
      </div>
      {bezahlenOpen && hasCustomer && hasItems && (
        <AnkaufBezahlenDialog open={bezahlenOpen} onClose={() => setBezahlenOpen(false)} />
      )}
    </div>
  );
}

function AnkaufSplash(): JSX.Element {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 'var(--space-7)' }}>
      <ParchmentCard padding="lg" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            margin: 'var(--space-4) 0 var(--space-1)',
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Ankauf wird vorbereitet…
        </h2>
        <Zwischentitel />
      </ParchmentCard>
    </div>
  );
}
