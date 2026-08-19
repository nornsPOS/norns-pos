/**
 * CustomerHistoryPanels — Ankauf + Verkauf history sub-panels (Day 10).
 *
 * Each panel runs an independent TanStack query so one slow endpoint
 * doesn't block the other. The data shapes are inlined here because
 * the routes (`GET /api/customers/:id/products` and `.../transactions`)
 * pre-date the api-client domain extraction; they're stable and not
 * worth promoting to typed methods just for Day 10 read-only use.
 *
 * Both panels render the latest 10 entries with a "alle anzeigen"
 * link for future detail-page navigation (Phase 1.5).
 */

import { StaleBadge, useCachedQuery } from '../../offline/index.js';

import { Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

interface CustomerProductRow {
  id: string;
  sku: string;
  name: string;
  status: string;
  listPriceEur: string;
  acquisitionCostEur: string;
  createdAt: string;
}

interface CustomerTransactionRow {
  id: string;
  receiptLocator: string;
  direction: 'VERKAUF' | 'ANKAUF';
  totalEur: string;
  /** Optional so an older server that omits it never breaks the row. */
  salesChannel?: 'POS' | 'WEB' | 'EBAY' | 'PHONE';
  finalizedAt: string;
  storno: boolean;
}

/** Non-POS orders get a channel tag so online vs counter is obvious. */
const CHANNEL_LABEL: Record<'WEB' | 'EBAY' | 'PHONE', string> = {
  WEB: 'Online',
  EBAY: 'eBay',
  PHONE: 'Telefon',
};

export function CustomerAnkaufHistory({ customerId }: { customerId: string }): JSX.Element {
  const api = useApiClient();
  const q = useCachedQuery({
    queryKey: ['customers', customerId, 'products'],
    queryFn: () =>
      api.request<{ items: CustomerProductRow[]; total: number }>(
        'GET',
        `/api/customers/${encodeURIComponent(customerId)}/products`,
      ),
    cacheKey: `customer:products:${customerId}`,
    staleTime: 30_000,
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  return (
    <ParchmentCard padding="md">
      <Zwischentitel label={`Ankauf-Historie · ${total} Stück${total === 1 ? '' : 'e'}`} />
      {q.fromCache && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <StaleBadge cachedAt={q.cachedAt} stale={q.isStale} />
        </div>
      )}
      {q.isLoading ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <EmptyHint text="Noch keine Ankäufe von diesem Kunden." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-6)' }}>
          {items.slice(0, 10).map((row) => (
            <div
              key={row.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: 'var(--w14-abstand-10)',
                alignItems: 'baseline',
                padding: 'var(--w14-abstand-4) 0',
                borderBottom: '1px solid var(--w14-rule)',
              }}
            >
              <span
                className="w14-tabular"
                style={{
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: 'var(--w14-schrift-zeile)',
                  color: 'var(--w14-ink-faded)',
                }}
              >
                {row.sku}
              </span>
              <span
                style={{
                  fontFamily: 'var(--w14-font-display)',
                  fontSize: 'var(--w14-schrift-betont)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {row.name}
              </span>
              <MoneyAmount valueEur={row.acquisitionCostEur} />
            </div>
          ))}
        </div>
      )}
    </ParchmentCard>
  );
}

export function CustomerSalesHistory({ customerId }: { customerId: string }): JSX.Element {
  const api = useApiClient();
  const q = useCachedQuery({
    queryKey: ['customers', customerId, 'transactions'],
    queryFn: () =>
      api.request<{ items: CustomerTransactionRow[]; total: number }>(
        'GET',
        `/api/customers/${encodeURIComponent(customerId)}/transactions`,
      ),
    cacheKey: `customer:transactions:${customerId}`,
    staleTime: 30_000,
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  return (
    <ParchmentCard padding="md">
      <Zwischentitel label={`Transaktionen · ${total}`} />
      {q.fromCache && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <StaleBadge cachedAt={q.cachedAt} stale={q.isStale} />
        </div>
      )}
      {q.isLoading ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <EmptyHint text="Noch keine Transaktionen mit diesem Kunden." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-6)' }}>
          {items.slice(0, 10).map((row) => (
            <div
              key={row.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto auto 1fr auto',
                gap: 'var(--w14-abstand-10)',
                alignItems: 'baseline',
                padding: 'var(--w14-abstand-4) 0',
                borderBottom: '1px solid var(--w14-rule)',
              }}
            >
              <span
                className="w14-tabular"
                style={{
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: 'var(--w14-schrift-zeile)',
                  color: 'var(--w14-ink-faded)',
                }}
              >
                {new Date(row.finalizedAt).toLocaleDateString('de-DE')}
              </span>
              <span
                className="w14-smallcaps"
                style={{
                  fontSize: 'var(--w14-schrift-zeile)',
                  letterSpacing: '0.08em',
                  color: row.direction === 'VERKAUF' ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
                }}
              >
                {row.direction}
              </span>
              {row.salesChannel && row.salesChannel !== 'POS' && (
                <span
                  className="w14-smallcaps"
                  style={{
                    fontSize: 'var(--w14-schrift-kuerzel)',
                    letterSpacing: '0.06em',
                    padding: 'var(--w14-abstand-2) var(--w14-abstand-6)',
                    borderRadius: 'var(--w14-radius-pille)',
                    color: 'var(--w14-gilt)',
                    border: '1px solid var(--w14-rule)',
                  }}
                >
                  {CHANNEL_LABEL[row.salesChannel]}
                </span>
              )}
              <span
                className="w14-tabular"
                style={{ fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-feld)' }}
              >
                {row.receiptLocator}
                {row.storno && (
                  <span style={{ marginLeft: 6, color: 'var(--w14-wax-red)' }}>(storno)</span>
                )}
              </span>
              <MoneyAmount valueEur={row.totalEur} signed={row.direction === 'ANKAUF'} />
            </div>
          ))}
        </div>
      )}
    </ParchmentCard>
  );
}

function Skeleton(): JSX.Element {
  return (
    <p
      style={{
        margin: '6px 0 0',
        color: 'var(--w14-ink-faded)',
        fontStyle: 'italic',
        fontSize: 'var(--w14-schrift-text)',
      }}
    >
      Lädt…
    </p>
  );
}

function EmptyHint({ text }: { text: string }): JSX.Element {
  return (
    <p
      style={{
        margin: '6px 0 0',
        color: 'var(--w14-ink-faded)',
        fontFamily: 'var(--w14-font-display)',
        fontStyle: 'italic',
        fontSize: 'var(--w14-schrift-text)',
        textAlign: 'center',
      }}
    >
      {text}
    </p>
  );
}

// 15.08.2026 (0.6.0 Spur E): hier stand CustomerWebOrders, die Kachel
// "Online-Bestellungen" ueber der carts/shoppers-Welt des alten Webshops.
// Seit dem 0.4.0-Kahlschlag schreibt nichts mehr in diese Welt; die Kachel
// konnte nur noch fuer immer "noch nichts online bestellt" zeigen.
