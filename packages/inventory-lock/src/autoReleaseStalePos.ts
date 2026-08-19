/**
 * Auto-release POS reservations abandoned past a stale-hold window.
 *
 * POS holds are intentionally TTL-less (`reservation_expires_at = NULL`) — the
 * cashier owns them and `autoReleaseExpired` deliberately skips them. But a hold
 * whose release never reached the server (Tauri window SIGKILL / power loss
 * before the `beforeunload` beacon flushed) would otherwise leak forever, and
 * nothing reclaims it (P1.4). This is the durable backstop: a row RESERVED on
 * the POS channel whose `reserved_at` is older than `staleAfterMinutes` is
 * returned to AVAILABLE.
 *
 * The window MUST be comfortably longer than a shift (default 12h) so a legit
 * parked cart is never yanked mid-sale. Keyed on `reserved_at` (POS has no
 * `reservation_expires_at`), backed by `products_pos_reserved_at_idx` (0072).
 *
 * Idempotent — a second pass in the same window releases nothing. Returns the
 * released ids so the caller can emit a ledger event per row.
 */

import type { AnyDb } from '@norns/db/client';
import { sql } from 'drizzle-orm';

export interface AutoReleaseStalePosOptions {
  /** Reclaim POS holds older than this many minutes. Default 720 (12h). */
  staleAfterMinutes?: number;
}

export async function autoReleaseStalePos(
  db: AnyDb,
  opts: AutoReleaseStalePosOptions = {},
): Promise<string[]> {
  const staleAfterMinutes = opts.staleAfterMinutes ?? 720;
  const result = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    UPDATE products
       SET status                 = 'AVAILABLE',
           reserved_by_channel    = NULL,
           reserved_by_session_id = NULL,
           reserved_by_user_id    = NULL,
           reserved_at            = NULL,
           reservation_expires_at = NULL
     WHERE status              = 'RESERVED'
       AND reserved_by_channel = 'POS'
       AND reserved_at IS NOT NULL
       AND reserved_at < now() - make_interval(mins => ${staleAfterMinutes})
   RETURNING id
  `);

  return result.map((r) => r.id);
}
