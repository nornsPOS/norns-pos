/**
 * Tagebuch — the live ledger feed on the Werkstatt right column.
 *
 * Reads `events` from the Zustand `ledger-feed-store` via a SHALLOW
 * selector — only re-renders when the visible array reference changes.
 * Each `<LedgerEntry/>` is a separate child, so individual fresh entries
 * animate without disturbing the surrounding rows.
 *
 *   The visual metaphor (memory.md §10.5): ink being written onto an old
 *   broadside. New rows fade in from a gold-soft tint to the resting hue.
 *
 * Empty state quotes the broadside motto.
 *
 * The feed is capped at 50 visible rows (the store keeps 200 in memory);
 * older entries scroll out of view but remain inside the buffer.
 */

import { useMemo } from 'react';

import { type LedgerEvent, isAlertEvent } from '@norns/api-client';
import { Zwischentitel, LedgerEntry, MoneyAmount, ParchmentCard } from '@norns/ui-kit';
import { entityLabel, eventLabel } from '@norns/i18n-de';

import { selectEvents, selectLastEventId, useLedgerFeed } from '../../state/ledger-feed-store.js';

const VISIBLE_LIMIT = 50;
const COMPACT_VISIBLE_LIMIT = 20;

export interface TagebuchFeedProps {
  /** Thin-rail mode: fewer visible rows, tighter padding for the left column. */
  compact?: boolean;
}

export function TagebuchFeed({ compact = false }: TagebuchFeedProps): JSX.Element {
  // `selectEvents` returns the same array reference until a new event arrives
  // → only re-renders the feed on actual change.
  const events = useLedgerFeed(selectEvents);
  const lastId = useLedgerFeed(selectLastEventId);

  const limit = compact ? COMPACT_VISIBLE_LIMIT : VISIBLE_LIMIT;
  const visible = useMemo(() => events.slice(0, limit), [events, limit]);

  return (
    <section
      aria-label="Tagebuch, lebendige Ereignisse"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Zwischentitel label="Tagebuch" />
      <ParchmentCard
        padding="sm"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {visible.length === 0 ? (
          <EmptyState />
        ) : (
          <ul
            role="list"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-1)',
              overflowY: 'auto',
              maxHeight: '100%',
            }}
          >
            {visible.map((event) => (
              <li key={event.id} style={{ margin: 0, padding: 0 }}>
                <LedgerEntryRow event={event} fresh={event.id === lastId} />
              </li>
            ))}
          </ul>
        )}
      </ParchmentCard>
    </section>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        padding: 'var(--space-7)',
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-grund)',
          }}
        >
          Was lange ruht, spricht leise.
        </p>
        {/* 19.08.2026: hier stand eine einzelne Raute als Schlusszeichen —
            Basels Anweisung verbannt die Raute aus dem ganzen Programm.
            Der Leitsatz steht für sich; er braucht kein Ornament. */}
      </div>
    </div>
  );
}

/**
 * Per-row component — translates a raw LedgerEvent into the LedgerEntry's
 * presentation props. Memo-friendly (no closures over the parent's state).
 */
function LedgerEntryRow({
  event,
  fresh,
}: {
  event: LedgerEvent;
  fresh: boolean;
}): JSX.Element {
  const alert = isAlertEvent(event);
  const hint = extractRightHint(event);
  const subtitle = extractSubtitle(event);

  return (
    <LedgerEntry
      timestamp={event.created_at}
      eventType={
        // ⚠️ 01.08.2026: hier stand der ROHE Ereignisname aus der Datenbank
        // („product.photo_uploaded"). Die deutsche Überschrift dafür gibt es
        // im Haus seit Langem, die Fläche hat sie nur nie benutzt.
        eventLabel(String(event.event_type))
      }
      alert={alert}
      fresh={fresh}
      rightHint={hint}
      subtitle={subtitle}
    />
  );
}

/**
 * Pull a money-shaped right-hint out of the payload for the events that
 * carry one. Defensive — payload is `unknown` on the wire.
 */
function extractRightHint(event: LedgerEvent): JSX.Element | undefined {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return undefined;
  const total =
    typeof p.total_eur === 'string'
      ? p.total_eur
      : typeof p.totalEur === 'string'
        ? p.totalEur
        : null;
  if (total) {
    const negative = total.startsWith('-');
    return <MoneyAmount valueEur={total} signed={negative} />;
  }
  if (typeof p.metal === 'string' && typeof p.newPricePerGramEur === 'string') {
    return (
      <span
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: 'var(--w14-schrift-feld)',
          color: 'var(--w14-ink-aged)',
        }}
      >
        {p.metal} {p.newPricePerGramEur} €/g
      </span>
    );
  }
  if (typeof p.localReservationChannel === 'string') {
    return (
      <span
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: 'var(--w14-schrift-zeile)',
          color: 'var(--w14-wax-red)',
        }}
      >
        ⚠ {p.localReservationChannel}
      </span>
    );
  }
  return undefined;
}

function extractSubtitle(event: LedgerEvent): string | undefined {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return undefined;

  const bits: string[] = [];
  if (typeof p.receipt_locator === 'string') bits.push(`Beleg ${p.receipt_locator}`);
  if (typeof p.customer_id === 'string') bits.push('Kunde · …');
  if (typeof p.productId === 'string') bits.push(`Produkt ${shortenId(p.productId)}`);
  if (typeof p.tax_treatment_code === 'string') bits.push(String(p.tax_treatment_code));
  if (bits.length === 0) {
    if (typeof event.entity_id === 'string') {
      // Ebenso der rohe Tabellenname („worker_job_runs"). `entityLabel`
      // übersetzt die bekannten und humanisiert den Rest — nie roh.
      bits.push(`${entityLabel(String(event.entity_table))} · ${shortenId(event.entity_id)}`);
    } else {
      bits.push(entityLabel(String(event.entity_table)));
    }
  }
  return bits.join(' · ');
}

function shortenId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
