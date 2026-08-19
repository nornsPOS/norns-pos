/**
 * verifyChain() — call the SQL-side `verify_ledger_chain()` function.
 *
 * The SQL function walks the ledger in id order, recomputes each row's
 * canonical hash, and reports the first break. We keep the verification
 * logic INSIDE the DB so the trigger and the verifier share one source of
 * truth — there is no cross-language timestamp-formatting drift.
 *
 * Returns a discriminated-union outcome:
 *   • { valid: true,  rowsVerified } when the chain is intact
 *   • { valid: false, breakAtId, reason, expectedHash, actualHash } when broken
 */

import type { AnyDb } from '@norns/db';
import { sql } from 'drizzle-orm';

import type { ChainVerificationResult } from './types.js';

type BreakRow = {
  break_at_id: string;
  reason: string;
  expected_hash: Uint8Array;
  actual_hash: Uint8Array;
} & Record<string, unknown>;

export async function verifyChain(db: AnyDb): Promise<ChainVerificationResult> {
  const breaks = await db.execute<BreakRow>(sql`
    SELECT break_at_id, reason, expected_hash, actual_hash
      FROM verify_ledger_chain()
  `);

  if (breaks.length === 0) {
    const counted = await db.execute<{ count: string } & Record<string, unknown>>(
      sql`SELECT COUNT(*)::text AS count FROM ledger_events`,
    );
    return {
      valid: true,
      rowsVerified: BigInt(counted[0]!.count),
    };
  }

  const first = breaks[0]!;
  return {
    valid: false,
    breakAtId: BigInt(first.break_at_id),
    reason: first.reason,
    expectedHash: first.expected_hash,
    actualHash: first.actual_hash,
  };
}
