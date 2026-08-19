/**
 * emit() — append one row to ledger_events.
 *
 * The single discipline boundary for writes to `ledger_events`. Every fiscal
 * state change in Warehouse14 calls this. The DB trigger (migration 0008,
 * SECURITY DEFINER, owned by warehouse14_security) computes prev_hash,
 * row_hash, and forces created_at = now() — callers cannot influence the
 * chain shape.
 *
 * Idempotency: this is plain INSERT. Callers that need exactly-once semantics
 * (webhook handlers, replay-safe workers) must include their own dedupe key
 * in the payload and check for the prior event before emitting.
 */

import type { AnyDb } from '@norns/db';
import { sql } from 'drizzle-orm';

import type { EmitInput, EmittedEvent } from './types.js';

type Row = {
  id: string;
  row_hash: Uint8Array;
  prev_hash: Uint8Array;
  created_at: Date;
} & Record<string, unknown>;

export async function emit(db: AnyDb, input: EmitInput): Promise<EmittedEvent> {
  const {
    eventType,
    entityTable,
    entityId,
    actorUserId = null,
    deviceId = null,
    ipAddress = null,
    payload,
  } = input;

  const result = await db.execute<Row>(sql`
    INSERT INTO ledger_events (
      event_type, entity_table, entity_id,
      actor_user_id, device_id, ip_address,
      payload
    )
    VALUES (
      ${eventType},
      ${entityTable},
      ${entityId}::uuid,
      ${actorUserId}::uuid,
      ${deviceId}::uuid,
      ${ipAddress}::inet,
      ${JSON.stringify(payload)}::jsonb
    )
    RETURNING id, row_hash, prev_hash, created_at
  `);

  const row = result[0]!;
  return {
    id: BigInt(row.id),
    rowHash: row.row_hash,
    prevHash: row.prev_hash,
    createdAt: row.created_at,
  };
}
