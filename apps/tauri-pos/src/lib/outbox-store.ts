/**
 * Tauri-SQLite implementation of the pure `OutboxStore` interface from
 * `@norns/api-client` (ADR-0044 §5). This is the app-layer half of the
 * offline-queue middleware: the middleware decides WHAT to durably persist;
 * this decides HOW (a local SQLite table via `@tauri-apps/plugin-sql`).
 *
 * The connection loads lazily on first use — `Database.load` is async and the
 * provider builds the client synchronously, and we don't want to pay the
 * SQLite open on the happy online path where the store is never touched
 * (only failure / offline paths enqueue). The `0001_outbox.sql` migration is
 * applied Rust-side on startup, so the tables already exist by first use.
 *
 * Runtime prerequisite: the `tauri-plugin-sql` Rust plugin must be registered
 * (see src-tauri/src/lib.rs + Cargo.toml + capabilities). Outside a Tauri
 * webview the dynamic import / `Database.load` will reject — by design the
 * store is only exercised on a real till.
 */

import type Database from '@tauri-apps/plugin-sql';
import type { OutboxRecord, OutboxStore } from '@norns/api-client';

const DB_PATH = 'sqlite:warehouse14.db';

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Shape of the columns we read back when draining pending rows. */
interface OutboxRow {
  idempotency_key: string;
  trace_id: string | null;
  method: string;
  path: string;
  url: string;
  headers_json: string;
  body_json: string;
  enqueued_at: number;
  gobd_relevant: number;
  caller_supplied_key: number;
  device_id: string;
}

export class TauriSqlOutboxStore implements OutboxStore {
  private dbPromise: Promise<Database> | null = null;

  private db(): Promise<Database> {
    if (!this.dbPromise) {
      this.dbPromise = import('@tauri-apps/plugin-sql').then(({ default: Db }) => Db.load(DB_PATH));
    }
    return this.dbPromise;
  }

  async enqueue(record: OutboxRecord): Promise<void> {
    const db = await this.db();
    const retentionUntil =
      record.enqueuedAt + (record.gobdRelevant ? TEN_YEARS_MS : THIRTY_DAYS_MS);

    // INSERT OR IGNORE on the UNIQUE idempotency_key makes a crash-recovery
    // resubmit a no-op rather than a duplicate row. monotonic_seq is assigned
    // atomically inside the statement so concurrent enqueues can't collide.
    await db.execute(
      `INSERT OR IGNORE INTO outbox_mutations (
         idempotency_key, trace_id, method, path, url,
         headers_json, body_json, enqueued_at, monotonic_seq,
         status, gobd_relevant, retention_until, caller_supplied_key, device_id
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, (SELECT COALESCE(MAX(monotonic_seq), 0) + 1 FROM outbox_mutations),
         'pending', $9, $10, $11, $12
       )`,
      [
        record.idempotencyKey,
        record.traceId,
        record.method,
        record.path,
        record.url,
        JSON.stringify(record.headers),
        JSON.stringify(record.body ?? null),
        record.enqueuedAt,
        record.gobdRelevant ? 1 : 0,
        retentionUntil,
        record.callerSuppliedKey ? 1 : 0,
        record.deviceId,
      ],
    );
  }

  async markSucceeded(idempotencyKey: string, response: unknown): Promise<void> {
    const db = await this.db();
    await db.execute(
      `UPDATE outbox_mutations
         SET status = 'succeeded', response_json = $1, resolved_at = $2
       WHERE idempotency_key = $3`,
      [JSON.stringify(response ?? null), Date.now(), idempotencyKey],
    );
  }

  async markConflict(idempotencyKey: string, error: unknown): Promise<void> {
    const db = await this.db();
    // status='conflict' rows are never auto-pruned (ADR-0044 §7) — they await
    // human resolution in the Compliance Inbox. We do NOT set resolved_at.
    await db.execute(
      `UPDATE outbox_mutations
         SET status = 'conflict', last_error_json = $1, last_attempt_at = $2,
             attempt_count = attempt_count + 1
       WHERE idempotency_key = $3`,
      [JSON.stringify(serializeError(error)), Date.now(), idempotencyKey],
    );
  }

  async getStats(): Promise<{ pending: number; conflict: number }> {
    const db = await this.db();
    const pendingRows = await db.select<Array<{ count: number }>>(
      `SELECT COUNT(*) AS count FROM outbox_mutations WHERE status = 'pending'`,
    );
    const conflictRows = await db.select<Array<{ count: number }>>(
      `SELECT COUNT(*) AS count FROM outbox_mutations WHERE status = 'conflict'`,
    );
    return {
      pending: pendingRows[0]?.count ?? 0,
      conflict: conflictRows[0]?.count ?? 0,
    };
  }

  async listPending(): Promise<readonly OutboxRecord[]> {
    const db = await this.db();
    const rows = await db.select<OutboxRow[]>(
      `SELECT idempotency_key, trace_id, method, path, url,
              headers_json, body_json, enqueued_at,
              gobd_relevant, caller_supplied_key, device_id
         FROM outbox_mutations
        WHERE status = 'pending'
        ORDER BY monotonic_seq ASC`,
    );
    return rows.map(rowToRecord);
  }

  // ── Compliance Inbox (Phase 6.1) ──────────────────────────────────────────
  // A `status='conflict'` row halted the FIFO drain (drainOutbox stops at a
  // non-transient divergence). The Owner reviews it here and either DISCARDS it
  // (terminally closed) or RE-QUEUES it (another drain attempt at its original
  // monotonic_seq, so FIFO order still holds). Both writes are scoped to
  // `status='conflict'`, so they can NEVER touch a pending / in-flight /
  // succeeded / already-terminal row — the safety invariant the tests assert.

  /** Conflict rows awaiting human resolution, oldest first (FIFO order). */
  async listConflicts(): Promise<readonly ConflictRecord[]> {
    const db = await this.db();
    const rows = await db.select<ConflictRow[]>(
      `SELECT idempotency_key, method, path, last_error_json, enqueued_at,
              last_attempt_at, attempt_count, gobd_relevant
         FROM outbox_mutations
        WHERE status = 'conflict'
        ORDER BY monotonic_seq ASC`,
    );
    return rows.map(conflictRowToRecord);
  }

  /** Verwerfen — the reviewed conflict is terminally closed, never retried. */
  async discardConflict(idempotencyKey: string): Promise<void> {
    const db = await this.db();
    await db.execute(
      `UPDATE outbox_mutations
         SET status = 'failed_terminal', resolved_at = $1
       WHERE idempotency_key = $2 AND status = 'conflict'`,
      [Date.now(), idempotencyKey],
    );
  }

  /** Erneut senden — re-queue the reviewed conflict for another drain pass. It
   *  returns to `pending` at its original monotonic_seq, so the FIFO order is
   *  preserved (it is re-attempted before any later row). */
  async retryConflict(idempotencyKey: string): Promise<void> {
    const db = await this.db();
    await db.execute(
      `UPDATE outbox_mutations
         SET status = 'pending', last_error_json = NULL
       WHERE idempotency_key = $1 AND status = 'conflict'`,
      [idempotencyKey],
    );
  }

  /**
   * Retention pruner (Phase 6.4). Delete EXPIRED, NON-fiscal, already-`succeeded`
   * rows so the outbox table doesn't grow without bound. The WHERE clause is the
   * safety guarantee: only `status='succeeded'` (so a pending / in_flight /
   * conflict / failed_terminal row is never touched), only `gobd_relevant = 0`
   * (a GoBD/§25a fiscal row is legally retained 10 years and NEVER pruned), and
   * only past its own `retention_until`. Returns the number of rows removed.
   */
  async pruneExpired(now: number = Date.now()): Promise<number> {
    const db = await this.db();
    const res = await db.execute(
      `DELETE FROM outbox_mutations
        WHERE status = 'succeeded'
          AND gobd_relevant = 0
          AND retention_until < $1`,
      [now],
    );
    return res.rowsAffected ?? 0;
  }
}

/** One conflict row surfaced in the Compliance Inbox. */
export interface ConflictRecord {
  idempotencyKey: string;
  method: string;
  path: string;
  /**
   * Stable server error code that halted the drain (from the sealed conflict
   * error). We deliberately surface only the CODE, never the raw server message
   * — an English server string must not leak into the operator UI (honesty gate).
   */
  serverCode: string;
  enqueuedAt: number;
  lastAttemptAt: number | null;
  attemptCount: number;
  gobdRelevant: boolean;
}

interface ConflictRow {
  idempotency_key: string;
  method: string;
  path: string;
  last_error_json: string | null;
  enqueued_at: number;
  last_attempt_at: number | null;
  attempt_count: number;
  gobd_relevant: number;
}

function conflictRowToRecord(row: ConflictRow): ConflictRecord {
  const sealed = safeParse<{ serverCode?: unknown }>(row.last_error_json ?? '') ?? {};
  return {
    idempotencyKey: row.idempotency_key,
    method: row.method,
    path: row.path,
    serverCode: typeof sealed.serverCode === 'string' ? sealed.serverCode : 'UNKNOWN',
    enqueuedAt: row.enqueued_at,
    lastAttemptAt: row.last_attempt_at,
    attemptCount: row.attempt_count,
    gobdRelevant: row.gobd_relevant === 1,
  };
}

function rowToRecord(row: OutboxRow): OutboxRecord {
  return {
    idempotencyKey: row.idempotency_key,
    traceId: row.trace_id,
    method: row.method as OutboxRecord['method'],
    path: row.path,
    url: row.url,
    headers: safeParse<Record<string, string>>(row.headers_json) ?? {},
    body: safeParse<unknown>(row.body_json),
    enqueuedAt: row.enqueued_at,
    gobdRelevant: row.gobd_relevant === 1,
    callerSuppliedKey: row.caller_supplied_key === 1,
    deviceId: row.device_id,
  };
}

function safeParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Reduce an arbitrary thrown value to an audit-stable JSON shape. */
function serializeError(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const e = error as {
      name?: unknown;
      message?: unknown;
      serverCode?: unknown;
      serverDetails?: unknown;
    };
    return {
      name: typeof e.name === 'string' ? e.name : 'Error',
      message: typeof e.message === 'string' ? e.message : String(error),
      ...(e.serverCode !== undefined ? { serverCode: e.serverCode } : {}),
      ...(e.serverDetails !== undefined ? { serverDetails: e.serverDetails } : {}),
    };
  }
  return { name: 'Error', message: String(error) };
}
