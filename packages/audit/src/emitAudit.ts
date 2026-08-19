/**
 * emitAudit() — append one row to audit_log (non-fiscal).
 *
 * For login/logout, role changes, settings updates, AML alerts. No hash
 * chain — audit_log is append-only via grants but not cryptographically
 * linked. The threat model is different: security events, not §259 StGB
 * defense.
 */

import type { AnyDb } from '@norns/db';
import { sql } from 'drizzle-orm';

import type { AuditInput } from './types.js';

type Row = { id: string; created_at: Date } & Record<string, unknown>;

export async function emitAudit(
  db: AnyDb,
  input: AuditInput,
): Promise<{ id: bigint; createdAt: Date }> {
  const {
    eventType,
    actorUserId = null,
    deviceId = null,
    ipAddress = null,
    userAgent = null,
    payload = {},
  } = input;

  const result = await db.execute<Row>(sql`
    INSERT INTO audit_log (
      event_type, actor_user_id, device_id, ip_address, user_agent, payload
    )
    VALUES (
      ${eventType},
      ${actorUserId}::uuid,
      ${deviceId}::uuid,
      ${ipAddress}::inet,
      ${userAgent},
      ${JSON.stringify(payload)}::jsonb
    )
    RETURNING id, created_at
  `);

  const row = result[0]!;
  return { id: BigInt(row.id), createdAt: row.created_at };
}
