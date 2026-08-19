-- ADR-0044 Phase 3 — local durable outbox for offline mutations.
--
-- Forward-only. For financial-record tables a destructive rollback is
-- prohibited by §25a UStG documentation requirements (ADR-0044 §5), so this
-- file is append-only history: never edit a shipped migration, add 0002+.
--
-- Registered with tauri-plugin-sql via `add_migrations` in src/lib.rs and
-- applied on app startup before any UI mounts.

CREATE TABLE IF NOT EXISTS outbox_mutations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  trace_id            TEXT,
  method              TEXT NOT NULL,
  path                TEXT NOT NULL,
  url                 TEXT NOT NULL,
  headers_json        TEXT NOT NULL,          -- sealed at enqueue; replay uses these exact headers
  body_json           TEXT NOT NULL,          -- JSON; zlib compression deferred (ADR-0044 §5)
  enqueued_at         INTEGER NOT NULL,       -- ms epoch, device clock
  monotonic_seq       INTEGER NOT NULL,       -- per-device counter — authoritative replay order
  last_attempt_at     INTEGER,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending|in_flight|succeeded|failed_terminal|conflict|deferred
  last_error_json     TEXT,
  response_json       TEXT,
  resolved_at         INTEGER,
  gobd_relevant       INTEGER NOT NULL DEFAULT 0,
  retention_until     INTEGER NOT NULL,       -- ms epoch; +10y if gobd_relevant else +30d
  caller_supplied_key INTEGER NOT NULL DEFAULT 0,
  device_id           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_seq ON outbox_mutations (status, monotonic_seq);
CREATE INDEX IF NOT EXISTS idx_outbox_retention  ON outbox_mutations (retention_until);
CREATE INDEX IF NOT EXISTS idx_outbox_trace      ON outbox_mutations (trace_id);

-- Caller-side intent log for FISCAL paths only. The fiscal call site writes
-- here BEFORE invoking the client so a crash between intent-crystallization
-- and the network call leaves a recoverable orphan (ADR-0044 §4 crash-recovery).
CREATE TABLE IF NOT EXISTS pos_intents (
  key             TEXT PRIMARY KEY,
  intent_type     TEXT NOT NULL,              -- ankauf|sale|storno|cash_movement|shift_close
  payload_json    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  resolved_at     INTEGER,
  response_json   TEXT,
  failed_at       INTEGER,
  error_json      TEXT,
  retention_until INTEGER NOT NULL            -- always +10y; fiscal-only table
);

CREATE INDEX IF NOT EXISTS idx_intents_unresolved ON pos_intents (resolved_at, failed_at);
