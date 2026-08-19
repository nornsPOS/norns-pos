-- Phase 1.3 — durable TSE signature replay queue.
--
-- Forward-only, like 0001/0002. This table holds FISCAL records (KassenSichV
-- §146a signatures that could not be finished or recorded online), so a
-- destructive rollback is prohibited by §25a UStG / GoBD retention — never edit
-- a shipped migration, add 0004+ instead.
--
-- Replaces the old localStorage TSE queue (`warehouse14.tse-queue.v1`), which
-- was volatile (wiped on sign-out / cleared storage) and silently rolled off at
-- 200 rows — both fatal for fiscal records. This durable SQLite table survives
-- crash + refresh + sign-out and NEVER drops a row.
--
-- Declared STRICT (SQLite ≥ 3.37, bundled with tauri-plugin-sql — do NOT switch
-- the plugin to system SQLite, an older libsqlite would throw on `STRICT` at
-- startup before the UI mounts and brick the till). STRICT makes every INTEGER
-- column REJECT a non-integer at write time instead of silently coercing a bad
-- value to 0/NULL — this is what preserves the end-to-end integer-cents money
-- invariant (never a lossy float, never a string) across the replay boundary.
--
-- Registered with tauri-plugin-sql via `add_migrations` in src/lib.rs (version 3)
-- and applied on app startup before any UI mounts.

CREATE TABLE IF NOT EXISTS tse_signature_queue (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  monotonic_seq           INTEGER NOT NULL,          -- per-device counter — authoritative FIFO drain order
  intention_id            TEXT NOT NULL UNIQUE,      -- one FINISH per fiscal intention; ON CONFLICT target
  fiskaly_transaction_id  TEXT NOT NULL,             -- FINISH param + recordTseSignature body
  tss_id                  TEXT NOT NULL,             -- recordTseSignature.fiskalyTssId
  client_id               TEXT NOT NULL,             -- recordTseSignature.fiskalyClientId
  server_transaction_id   TEXT NOT NULL,             -- the :id in POST /api/transactions/:id/tse-signature
  amount_cents            INTEGER NOT NULL,          -- integer cents, never float (STRICT enforces)
  payment_kind            TEXT NOT NULL,             -- 'Bar' | 'Unbar'
  amounts_per_vat_id_json TEXT NOT NULL,             -- VatAmount[] (integer cents per bucket) — signed body §146a
  process_type            TEXT NOT NULL,             -- e.g. 'Kassenbeleg-V1'
  receipt_locator         TEXT,                      -- audit / receipt link
  signature_json          TEXT,                      -- NULL = finish-failed (replay path a); populated = record-failed (path b, never re-finish)
  status                  TEXT NOT NULL DEFAULT 'pending',  -- pending | in_flight | succeeded | failed_terminal
  attempt_count           INTEGER NOT NULL DEFAULT 0,
  last_attempt_at         INTEGER,                   -- ms epoch; stale-in_flight re-selection + backoff
  last_error_json         TEXT,                      -- honest surface, never a silent drop
  created_at              INTEGER NOT NULL,          -- ms epoch, device clock
  retention_until         INTEGER NOT NULL           -- ms epoch; always +10y (fiscal-only table)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tsq_status_seq ON tse_signature_queue (status, monotonic_seq);
CREATE INDEX IF NOT EXISTS idx_tsq_retention  ON tse_signature_queue (retention_until);
