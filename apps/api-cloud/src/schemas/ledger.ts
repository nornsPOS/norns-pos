/**
 * TypeBox schemas for the ledger query API surface.
 *
 * The SSE feed (routes/sse-ledger.ts) provides live + replay; this route
 * adds a paged, filterable read of the same `ledger_events` table for the
 * Tagebuch screen. Append-only, never mutated.
 */

import { type Static, Type } from '@sinclair/typebox';

export const ListLedgerQuery = Type.Object({
  eventType: Type.Optional(Type.String({ maxLength: 100 })),
  actorUserId: Type.Optional(Type.String({ format: 'uuid' })),
  entityTable: Type.Optional(Type.String({ maxLength: 100 })),
  /** ISO date inclusive lower bound on created_at (e.g. "2026-05-01"). */
  fromBusinessDay: Type.Optional(Type.String({ format: 'date' })),
  /** ISO date inclusive upper bound on created_at (e.g. "2026-05-31"). */
  toBusinessDay: Type.Optional(Type.String({ format: 'date' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const LedgerRow = Type.Object({
  id: Type.Integer(),
  eventType: Type.String(),
  entityTable: Type.String(),
  entityId: Type.String({ format: 'uuid' }),
  actorUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  deviceId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  payload: Type.Unknown(),
  /** Hex-encoded SHA-256 hash for the row, for forensic correlation. */
  rowHashHex: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

export const ListLedgerResponse = Type.Object({
  items: Type.Array(LedgerRow),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});

export type TListLedgerQuery = Static<typeof ListLedgerQuery>;
