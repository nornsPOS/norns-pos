/**
 * Kunden — Tier-1 surface #7 (Day 10). Customer identity + trust + AML hub.
 *
 * Layout: split view.
 *   Left  : CustomerListPanel — search input + result rows (Day-8 list route)
 *   Right : CustomerDetailPanel — full customer record OR empty-state hint
 *
 * Selected id lives in URL search-param `?id=` so:
 *   • browser back / forward works,
 *   • refreshes preserve selection,
 *   • Spotlight can jump to /kunden?id=<uuid>.
 *
 * The detail panel composes:
 *   • Personal data card + Edit dialog (PUT /api/customers/:id)
 *   • KYC status panel + "KYC bestätigen" action (PATCH /kyc, step-up)
 *   • Trust level chip + change dialog (PATCH /trust, step-up)
 *   • Ankauf history (GET /api/customers/:id/products)
 *   • Verkauf history (GET /api/customers/:id/transactions)
 *
 * No shift gate — Kunden is a read-mostly observability/admin surface.
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { CustomerDetailPanel } from './CustomerDetailPanel.js';
import { CustomerListPanel } from './CustomerListPanel.js';

export function Kunden(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const onSelect = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id === null) next.delete('id');
      else next.set('id', id);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(340px, 1fr) minmax(0, 2fr)',
        height: '100%',
        minHeight: 0,
        flex: 1,
      }}
    >
      <CustomerListPanel selectedId={selectedId} onSelect={onSelect} />
      <CustomerDetailPanel customerId={selectedId} />
    </div>
  );
}
