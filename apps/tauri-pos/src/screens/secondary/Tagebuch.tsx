/**
 * Tagebuch — Tier-2 full-screen ledger viewer (Phase 2 Day 8).
 *
 * Top bar: event-type dropdown + date range + actor input + live SSE toggle.
 * Body: chronological list (newest first) of ledger_events rows. Each
 * row expands to show its payload as readable German field rows plus the
 * SHA-256 row hash.
 *
 * Every machine string the ledger carries (event type, entity table, actor id,
 * payload keys) is translated through `@norns/i18n-de` before it reaches
 * the operator. The audit trail is read by people, not by developers.
 *
 * The "Live" toggle subscribes to the Werkstatt ledger-feed-store so any
 * new event lands at the top while the user is on this screen.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  type LedgerEventType,
  type LedgerListQuery,
  type LedgerListRow,
  isAlertEvent,
  ledgerQueryApi,
} from '@norns/api-client';
import {
  actorInfo,
  entityLabel,
  eventLabel,
  formatEventDate,
  hasPayload,
  payloadEntries,
  shortId,
} from '@norns/i18n-de';
import { Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { selectEvents, useLedgerFeed } from '../../state/ledger-feed-store.js';

const EVENT_TYPE_GROUPS: ReadonlyArray<{ label: string; values: readonly LedgerEventType[] }> = [
  {
    label: 'Transaktionen',
    values: ['transaction.finalized', 'transaction.stornoed', 'transaction.returned'],
  },
  {
    label: 'Inventar',
    values: ['product.reserved', 'product.released', 'product.sold', 'product.archived'],
  },
  {
    label: 'Schichten / Kasse',
    values: ['shift.opened', 'shift.closed_with_variance', 'cash.movement_recorded'],
  },
  {
    label: 'Kunden',
    values: ['customer.kyc_verified', 'customer.trust_changed'],
  },
  {
    label: 'Sonstiges',
    values: [
      'metal_price.recorded',
      'metal_price.manual_override',
      'belegtext.published',
      'appraisal.accepted',
      'appraisal.rejected',
    ],
  },
  {
    label: 'Alarme',
    values: [
      'alert.suspicious_aml_flagged',
      'alert.worker_job_dead_letter',
      'alert.hash_chain_verification_failed',
      'alert.anomaly_detected',
      'alert.ebay_sale_conflict',
      'alert.ebay_double_sale_attempt',
      'alert.customer_marked_suspicious',
      'alert.customer_banned',
    ],
  },
];

export function Tagebuch(): JSX.Element {
  const api = useApiClient();

  const [eventType, setEventType] = useState<string>('');
  const [actorUserId, setActorUserId] = useState<string>('');
  const [fromBusinessDay, setFromBusinessDay] = useState<string>('');
  const [toBusinessDay, setToBusinessDay] = useState<string>('');
  const [liveOn, setLiveOn] = useState<boolean>(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const query: LedgerListQuery = {
    limit: 200,
    ...(eventType ? { eventType } : {}),
    ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}),
    ...(fromBusinessDay ? { fromBusinessDay } : {}),
    ...(toBusinessDay ? { toBusinessDay } : {}),
  };

  const listQ = useQuery({
    queryKey: ['ledger', 'list', query],
    queryFn: () => ledgerQueryApi.list(api, query),
    staleTime: 10_000,
  });

  const liveEvents = useLedgerFeed(selectEvents);

  const merged = useMemo(() => {
    const base = listQ.data?.items ?? [];
    if (!liveOn) return base;
    // De-dupe live events against the paged result by id; live first.
    const seen = new Set(base.map((r) => r.id));
    const overlay: LedgerListRow[] = [];
    for (const ev of liveEvents) {
      if (seen.has(ev.id)) continue;
      if (eventType && ev.event_type !== eventType) continue;
      if (actorUserId.trim() && ev.actor_user_id !== actorUserId.trim()) continue;
      overlay.push({
        id: ev.id,
        eventType: ev.event_type,
        entityTable: ev.entity_table,
        entityId: ev.entity_id,
        actorUserId: ev.actor_user_id,
        deviceId: ev.device_id,
        payload: ev.payload,
        rowHashHex: '',
        createdAt: ev.created_at,
      });
    }
    return [...overlay, ...base];
  }, [listQ.data, liveEvents, liveOn, eventType, actorUserId]);

  return (
    <section
      aria-label="Tagebuch"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--w14-abstand-16)',
        gap: 'var(--w14-abstand-12)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-flaeche)',
          }}
        >
          Tagebuch
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-16)' }}>
          {!listQ.isLoading && !listQ.isError && listQ.data && (
            <span
              className="w14-smallcaps"
              style={{
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.08em',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {listQ.data.hasMore
                ? `${listQ.data.items.length} von ${listQ.data.total} Einträgen`
                : `${listQ.data.total} ${listQ.data.total === 1 ? 'Eintrag' : 'Einträge'}`}
            </span>
          )}
          <label
            className="w14-smallcaps"
            style={{
              fontSize: 'var(--w14-schrift-zeile)',
              letterSpacing: '0.08em',
              color: liveOn ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
              display: 'flex',
              gap: 'var(--w14-abstand-6)',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
          <input
            type="checkbox"
            checked={liveOn}
            onChange={(e) => setLiveOn(e.target.checked)}
            style={{ accentColor: 'var(--w14-gold)' }}
          />
            Live-Stream
          </label>
        </div>
      </header>

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--w14-abstand-10)',
          padding: 'var(--w14-abstand-10)',
          background: 'var(--w14-parchment-2)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
        }}
      >
        <FilterField label="Ereignis-Typ">
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            style={{ ...inputStyle, minWidth: 220 }}
          >
            <option value="">Alle</option>
            {EVENT_TYPE_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.values.map((v) => (
                  <option key={v} value={v}>
                    {eventLabel(v)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </FilterField>
        <FilterField label="Von">
          <input
            type="date"
            value={fromBusinessDay}
            onChange={(e) => setFromBusinessDay(e.target.value)}
            style={inputStyle}
          />
        </FilterField>
        <FilterField label="Bis">
          <input
            type="date"
            value={toBusinessDay}
            onChange={(e) => setToBusinessDay(e.target.value)}
            style={inputStyle}
          />
        </FilterField>
        <FilterField label="Mitarbeiter-Kennung">
          <input
            type="text"
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
            placeholder="Kennung einfügen"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)', minWidth: 220 }}
          />
        </FilterField>
      </div>

      <Zwischentitel />

      {/* Results */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w14-abstand-4)',
        }}
      >
        {listQ.isLoading ? (
          <ListSkeleton />
        ) : listQ.isError ? (
          <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
            <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
              Tagebuch konnte nicht geladen werden.
            </p>
          </ParchmentCard>
        ) : merged.length === 0 ? (
          <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--w14-ink-faded)' }}>
              Keine Einträge im gewählten Zeitraum.
            </p>
          </ParchmentCard>
        ) : (
          merged.map((row) => (
            <EventRow
              key={row.id}
              row={row}
              expanded={expandedId === row.id}
              onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function EventRow({
  row,
  expanded,
  onToggle,
}: {
  row: LedgerListRow;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const isAlert = isAlertEvent({ event_type: row.eventType });
  const actor = actorInfo(row.actorUserId, row.payload);
  const entity = shortId(row.entityId);
  const stamp = formatEventDate(row.createdAt);
  const fields = expanded ? payloadEntries(row.payload) : [];

  return (
    <ParchmentCard
      padding="sm"
      onClick={onToggle}
      style={{
        cursor: 'pointer',
        border: isAlert ? '1px solid var(--w14-wax-red)' : '1px solid var(--w14-rule)',
        background: expanded ? 'var(--w14-parchment-2)' : 'var(--w14-parchment-1)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 'var(--w14-abstand-12)',
          alignItems: 'baseline',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontSize: 'var(--w14-schrift-betont)',
            fontWeight: isAlert ? 600 : 500,
            color: isAlert ? 'var(--w14-wax-red)' : 'var(--w14-ink)',
          }}
        >
          {isAlert && (
            <span
              className="w14-smallcaps"
              style={{
                marginRight: 8,
                fontSize: 'var(--w14-schrift-kuerzel)',
                letterSpacing: '0.08em',
                border: '1px solid var(--w14-wax-red)',
                borderRadius: 3,
                padding: 'var(--w14-abstand-2) var(--w14-abstand-4)',
                verticalAlign: '2px',
              }}
            >
              Alarm
            </span>
          )}
          {eventLabel(row.eventType)}
        </span>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-faded)',
            whiteSpace: 'nowrap',
          }}
        >
          {stamp ?? 'Zeit unbekannt'}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 'var(--w14-schrift-zeile)',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {entityLabel(row.entityTable)}
        {entity && <span style={{ fontFamily: 'var(--w14-font-mono)' }}> {entity}</span>} · von{' '}
        {actor.label}
      </div>

      {expanded && (
        <div style={{ marginTop: 10 }}>
          {!hasPayload(row.payload) ? (
            <p
              style={{
                margin: 0,
                fontStyle: 'italic',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              Keine weiteren Angaben zu diesem Eintrag.
            </p>
          ) : (
            <dl
              style={{
                margin: 0,
                display: 'grid',
                gridTemplateColumns: 'minmax(140px, max-content) 1fr',
                columnGap: 'var(--w14-abstand-12)',
                rowGap: 'var(--w14-abstand-4)',
                padding: 'var(--w14-abstand-10)',
                background: 'var(--w14-parchment)',
                border: '1px solid var(--w14-rule)',
                borderRadius: 'var(--w14-radius-fein)',
                maxHeight: 260,
                overflowY: 'auto',
                fontSize: 'var(--w14-schrift-zeile)',
              }}
            >
              {fields.map((f) => (
                <div key={f.key} style={{ display: 'contents' }}>
                  <dt style={{ color: 'var(--w14-ink-faded)' }}>{f.label}</dt>
                  <dd
                    className={f.mono ? 'w14-tabular' : undefined}
                    style={{
                      margin: 0,
                      color: 'var(--w14-ink-aged)',
                      fontFamily: f.mono ? 'var(--w14-font-mono)' : 'inherit',
                      wordBreak: f.mono ? 'break-all' : 'normal',
                    }}
                  >
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {row.rowHashHex && (
            <small
              className="w14-tabular"
              style={{
                display: 'block',
                marginTop: 6,
                fontSize: 'var(--w14-schrift-kuerzel)',
                color: 'var(--w14-ink-faded)',
                wordBreak: 'break-all',
              }}
            >
              Prüfsumme{' '}
              <span style={{ fontFamily: 'var(--w14-font-mono)' }}>{row.rowHashHex}</span>
            </small>
          )}
        </div>
      )}
    </ParchmentCard>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
      <span
        className="w14-smallcaps"
        style={{
          fontSize: 'var(--w14-schrift-kuerzel)',
          letterSpacing: '0.08em',
          color: 'var(--w14-ink-aged)',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function ListSkeleton(): JSX.Element {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: 48,
            borderRadius: 'var(--w14-radius-card)',
            background:
              'linear-gradient(90deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '200% 100%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
            opacity: 1 - i * 0.1,
          }}
        />
      ))}
      <style>{`@keyframes w14-skel { 0%,100%{background-position:0% 50%;} 50%{background-position:100% 50%;} }`}</style>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: 'var(--w14-abstand-6) var(--w14-abstand-8)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-fein)',
  backgroundColor: 'var(--w14-parchment)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-text)',
  color: 'var(--w14-ink)',
  outline: 'none',
};
