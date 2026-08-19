/**
 * pos-intents-store — the caller-side FISCAL intent log (Phase 1.4).
 *
 * The `pos_intents` table (created by `0001_outbox.sql`) is written the instant
 * the operator commits to a fiscal write, BEFORE the network call fires. It
 * closes the one gap `outbox_mutations` can't: a crash BETWEEN intent-
 * crystallisation and the request actually leaving. On next launch the startup
 * reconcile (Step 8) turns any unresolved intent into an `outbox_mutations` row
 * on the SAME idempotency key and lets `drainOutbox` carry it — so recovery
 * rides the one at-most-once FIFO path and the server's partial-UNIQUE index
 * dedups. There is never a double-finalize.
 *
 * `payload_json` holds the SEALED REQUEST (not just the body): the exact fields
 * `offlineQueueMiddleware` seals into an `OutboxRecord` — method, path, url,
 * headers, body, deviceId, idempotencyKey, gobdRelevant. That makes an intent
 * self-sufficient: the reconcile can reconstruct a valid outbox row without
 * hitting the `url` / `headers_json` / `device_id` NOT NULL columns.
 *
 * Modeled on `outbox-store.ts` / `kyc-store.ts`: lazy `db()`, `$N` placeholders,
 * and the same "outside a Tauri webview `Database.load` rejects" contract — the
 * store propagates, the callers degrade (the intent-write is a best-effort
 * safety net that must never block a finalized sale; the reconcile runs inside
 * the replay controller's never-throw try/finally).
 */

import type Database from '@tauri-apps/plugin-sql';

import type { OutboxRecord } from '@norns/api-client';

const DB_PATH = 'sqlite:warehouse14.db';
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** Mirrors the `intent_type` CHECK vocabulary in `0001_outbox.sql`. */
export type PosIntentType = 'sale' | 'ankauf' | 'storno' | 'cash_movement' | 'shift_close';

export interface NewPosIntent {
  /** The idempotency key — SHARED with the eventual outbox row (the bridge). */
  key: string;
  intentType: PosIntentType;
  /** JSON.stringify of the sealed request (a `SealedFiscalRequest`, self-sufficient). */
  sealedRequestJson: string;
  /** ms epoch, device clock. Retention is stamped internally at +10y. */
  createdAt: number;
}

/**
 * The self-sufficient sealed request stored in `pos_intents.payload_json` — the
 * exact fields the reconcile needs to rebuild a valid `outbox_mutations` row
 * (every NOT-NULL outbox column) without recomputing anything from live state.
 */
export interface SealedFiscalRequest {
  method: 'POST';
  path: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  deviceId: string;
  idempotencyKey: string;
  gobdRelevant: boolean;
}

/** Seal a fiscal request at intent-crystallisation time (before the network). */
export function sealFiscalRequest(input: {
  baseUrl: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
  deviceId: string;
}): SealedFiscalRequest {
  return {
    method: 'POST',
    path: input.path,
    url: `${input.baseUrl.replace(/\/+$/, '')}${input.path}`,
    // Only the Idempotency-Key must be sealed — the client re-attaches a fresh
    // Authorization at replay time, and Content-Type is added when a body is set.
    headers: { 'Idempotency-Key': input.idempotencyKey },
    body: input.body,
    deviceId: input.deviceId,
    idempotencyKey: input.idempotencyKey,
    gobdRelevant: true,
  };
}

/** Rebuild an OutboxRecord from a sealed request (the reconcile mapping, Step 8). */
export function sealedToOutboxRecord(sealed: SealedFiscalRequest, enqueuedAt: number): OutboxRecord {
  return {
    idempotencyKey: sealed.idempotencyKey,
    traceId: null,
    method: sealed.method,
    path: sealed.path,
    url: sealed.url,
    headers: sealed.headers,
    body: sealed.body,
    enqueuedAt,
    gobdRelevant: sealed.gobdRelevant,
    callerSuppliedKey: true, // a fiscal call site supplied the key
    deviceId: sealed.deviceId,
  };
}

/** An intent still needing recovery (neither resolved nor terminally failed). */
export interface UnresolvedPosIntent {
  key: string;
  intentType: string;
  /** The sealed request, verbatim, to reconstruct an outbox row from. */
  sealedRequestJson: string;
  createdAt: number;
}

interface PosIntentRow {
  key: string;
  intent_type: string;
  payload_json: string;
  created_at: number;
}

export interface PosIntentsStore {
  create(intent: NewPosIntent): Promise<void>;
  markResolved(key: string, response: unknown): Promise<void>;
  markHandedOff(key: string): Promise<void>;
  markFailed(key: string, error: unknown): Promise<void>;
  listUnresolved(): Promise<UnresolvedPosIntent[]>;
}

export class TauriSqlPosIntentsStore implements PosIntentsStore {
  private dbPromise: Promise<Database> | null = null;

  private db(): Promise<Database> {
    if (!this.dbPromise) {
      this.dbPromise = import('@tauri-apps/plugin-sql').then(({ default: Db }) => Db.load(DB_PATH));
    }
    return this.dbPromise;
  }

  async create(intent: NewPosIntent): Promise<void> {
    const db = await this.db();
    // UPSERT that RE-SEALS the body while the intent is still open. The
    // idempotency key is frozen per dialog-open, but finalizeWithTse re-runs this
    // on every attempt — if the operator edits the cart (B2B toggle, voucher, line
    // change) after a rejected attempt and retries, the persisted sealed request
    // MUST match the body that was actually sent. `INSERT OR IGNORE` would freeze
    // the FIRST body, so a crash-recovery reconcile would book a STALE request.
    // The `WHERE resolved_at IS NULL AND failed_at IS NULL` guard means a
    // resolved / handed-off / failed intent is NEVER resurrected or overwritten.
    // Retention is always +10y — pos_intents is a fiscal-only table.
    await db.execute(
      `INSERT INTO pos_intents (key, intent_type, payload_json, created_at, retention_until)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(key) DO UPDATE SET
         payload_json    = excluded.payload_json,
         created_at      = excluded.created_at,
         retention_until = excluded.retention_until
       WHERE pos_intents.resolved_at IS NULL AND pos_intents.failed_at IS NULL`,
      [intent.key, intent.intentType, intent.sealedRequestJson, intent.createdAt, intent.createdAt + TEN_YEARS_MS],
    );
  }

  async markResolved(key: string, response: unknown): Promise<void> {
    const db = await this.db();
    await db.execute(
      `UPDATE pos_intents SET resolved_at = $1, response_json = $2 WHERE key = $3`,
      [Date.now(), JSON.stringify(response ?? null), key],
    );
  }

  async markHandedOff(key: string): Promise<void> {
    const db = await this.db();
    // The outbox now owns this key — the intent is resolved-into-outbox, NOT
    // failed. Removing it from `listUnresolved` prevents the reconcile from
    // inserting a duplicate outbox row for a request already in the outbox.
    await db.execute(
      `UPDATE pos_intents SET resolved_at = $1, response_json = $2 WHERE key = $3`,
      [Date.now(), JSON.stringify({ handedOff: true }), key],
    );
  }

  async markFailed(key: string, error: unknown): Promise<void> {
    const db = await this.db();
    await db.execute(
      `UPDATE pos_intents SET failed_at = $1, error_json = $2 WHERE key = $3`,
      [Date.now(), JSON.stringify(serializeError(error)), key],
    );
  }

  async listUnresolved(): Promise<UnresolvedPosIntent[]> {
    const db = await this.db();
    // Uses idx_intents_unresolved (resolved_at, failed_at). FIFO by created_at.
    const rows = await db.select<PosIntentRow[]>(
      `SELECT key, intent_type, payload_json, created_at
         FROM pos_intents
        WHERE resolved_at IS NULL AND failed_at IS NULL
        ORDER BY created_at ASC`,
    );
    return rows.map((r) => ({
      key: r.key,
      intentType: r.intent_type,
      sealedRequestJson: r.payload_json,
      createdAt: r.created_at,
    }));
  }
}

/** Reduce an arbitrary thrown value to an audit-stable JSON shape (mirrors outbox-store). */
function serializeError(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; message?: unknown; serverCode?: unknown };
    return {
      name: typeof e.name === 'string' ? e.name : 'Error',
      message: typeof e.message === 'string' ? e.message : String(error),
      ...(e.serverCode !== undefined ? { serverCode: e.serverCode } : {}),
    };
  }
  return { name: 'Error', message: String(error) };
}

/** Process-wide singleton — one caller-side intent log per till. */
export const posIntentsStore: PosIntentsStore = new TauriSqlPosIntentsStore();
