-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0008 — Append-only ledger with SHA-256 hash chain + audit log
--
-- The most security-critical migration in the project. After it:
--   • `ledger_events` is THE tamper-evident journal. Every fiscally-relevant
--     state change in the entire system writes a row here. The trigger
--     computes prev_hash + row_hash chaining each row to its predecessor.
--     A motivated DBA with UPDATE rights cannot tamper with history without
--     breaking the chain — `verify_ledger_chain()` exposes the break.
--   • `audit_log` is the non-fiscal who-when-what (logins, role changes,
--     settings updates). Append-only via grants, no hash chain (the chain
--     is for fiscal evidence; security events have different threat model).
--
-- ADR references:
--   • ADR-0008 §1 §2  — schema + canonical hash form + trigger pattern
--   • ADR-0008 §10    — five-walls defense, trigger ownership
--   • ADR-0018 §10    — bypass-proof discipline
--
-- Basel Day-6 directives (2026-05-24):
--   1. True append-only on ledger_events — app role gets SELECT + INSERT only.
--      NO UPDATE, NO DELETE. Ever.
--   2. SECURITY DEFINER trigger owned by warehouse14_security so a compromised
--      warehouse14_app cannot DROP, ALTER, or otherwise bypass the chain.
--   3. Cryptographic chaining — every row's prev_hash references the previous
--      row's row_hash, so any tampering after-the-fact breaks the chain at
--      the tampered row.
--
-- Idempotent: tables IF NOT EXISTS, function CREATE OR REPLACE, trigger DROP+CREATE.
-- Transactional: BEGIN/COMMIT.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. ledger_events — the tamper-evident journal
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_events (
  id              BIGSERIAL     PRIMARY KEY,

  -- Event identity
  event_type      TEXT          NOT NULL,                 -- 'transaction.finalized', 'product.reserved', etc.
  entity_table    TEXT          NOT NULL,                 -- 'transactions', 'products', …
  entity_id       UUID          NOT NULL,                 -- target row's id (NO FK — entity_table varies)

  -- Actor context
  actor_user_id   UUID          REFERENCES users(id),     -- nullable for system-emitted events
  device_id       UUID          REFERENCES devices(id),
  ip_address      INET,

  -- Payload — canonical snapshot of what changed
  payload         JSONB         NOT NULL,

  -- The chain (computed by the trigger; app cannot write these columns)
  prev_hash       BYTEA         NOT NULL,
  row_hash        BYTEA         NOT NULL,

  -- Audit timestamp (forced to now() by the trigger; app cannot backdate)
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT ledger_events_prev_hash_length CHECK (octet_length(prev_hash) = 32),
  CONSTRAINT ledger_events_row_hash_length  CHECK (octet_length(row_hash)  = 32),
  CONSTRAINT ledger_events_payload_object   CHECK (jsonb_typeof(payload) = 'object')
);

-- Hot-path indexes for the most common reads.
CREATE INDEX IF NOT EXISTS ledger_events_entity_idx
  ON ledger_events (entity_table, entity_id);

CREATE INDEX IF NOT EXISTS ledger_events_event_type_idx
  ON ledger_events (event_type, id DESC);

CREATE INDEX IF NOT EXISTS ledger_events_business_day_idx
  ON ledger_events (berlin_business_day(created_at));

CREATE INDEX IF NOT EXISTS ledger_events_actor_idx
  ON ledger_events (actor_user_id, id DESC)
  WHERE actor_user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. The trigger function — SECURITY DEFINER, owned by warehouse14_security.
--
-- Concurrency: `pg_advisory_xact_lock(14000000)` serializes concurrent
-- ledger_events INSERTs. The lock is transaction-scoped — released on COMMIT
-- or ROLLBACK. Using an advisory lock (vs SELECT ... FOR UPDATE) means the
-- security role does not need UPDATE privilege on ledger_events — a smaller
-- privilege surface.
--
-- Canonical form: ASCII Unit Separator (char 31) is illegal inside any of
-- the fields, so the serialization is unambiguous. The payload is hashed
-- separately to avoid jsonb::text version drift.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ledger_compute_hash() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  last_hash BYTEA;
  canonical TEXT;
BEGIN
  -- 1. Force created_at = now() — the app cannot backdate.
  NEW.created_at := now();

  -- 2. Serialize concurrent INSERTs on the ledger.
  -- 14_000_000 = arbitrary distinctive constant ("warehouse14, ledger").
  PERFORM pg_advisory_xact_lock(14000000);

  -- 3. Read the tail row's hash (genesis = 32 zero bytes).
  SELECT row_hash INTO last_hash
    FROM ledger_events
   ORDER BY id DESC
   LIMIT 1;

  IF last_hash IS NULL THEN
    last_hash := decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
  END IF;

  NEW.prev_hash := last_hash;

  -- 4. Build the canonical form. ASCII Unit Separator (char 31) as field
  --    delimiter — illegal in any UTF-8 textual identifier we use.
  canonical := concat_ws(
    chr(31),
    encode(NEW.prev_hash, 'hex'),
    NEW.event_type,
    NEW.entity_table,
    NEW.entity_id::TEXT,
    COALESCE(NEW.actor_user_id::TEXT, ''),
    COALESCE(NEW.device_id::TEXT,     ''),
    COALESCE(host(NEW.ip_address),     ''),
    encode(digest(NEW.payload::TEXT, 'sha256'), 'hex'),
    to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );

  -- 5. Compute the row hash.
  NEW.row_hash := digest(canonical, 'sha256');

  RETURN NEW;
END;
$$;

-- Transfer ownership to warehouse14_security so a compromised warehouse14_app
-- cannot DROP, ALTER, or REVOKE EXECUTE on this function. The migrator role
-- still owns nothing — it just created it on behalf of security.
ALTER FUNCTION ledger_compute_hash() OWNER TO warehouse14_security;

-- The trigger itself.
DROP TRIGGER IF EXISTS trg_ledger_compute_hash ON ledger_events;
CREATE TRIGGER trg_ledger_compute_hash
  BEFORE INSERT ON ledger_events
  FOR EACH ROW EXECUTE FUNCTION ledger_compute_hash();

COMMENT ON FUNCTION ledger_compute_hash() IS
  'BEFORE INSERT trigger fn for ledger_events. Computes prev_hash + row_hash, '
  'forces created_at = now(). SECURITY DEFINER owned by warehouse14_security '
  '— app role cannot bypass or DROP. See ADR-0008 §2.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. verify_ledger_chain() — walk the chain, recompute every hash,
--    report the first break.
--
-- Returns the empty set when the chain is intact. Returns one row per
-- detected break with the row id and the expected vs actual hash.
--
-- Runs nightly in CI + on-demand from Control Desktop. O(n) walk; at
-- single-shop scale this is sub-second up to ~100k events. For longer
-- horizons we anchor a daily checkpoint (ADR-0008 §Known limits #2).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_ledger_chain()
RETURNS TABLE (
  break_at_id    BIGINT,
  reason         TEXT,
  expected_hash  BYTEA,
  actual_hash    BYTEA
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  rec RECORD;
  expected_prev BYTEA;
  recomputed_canonical TEXT;
  recomputed_hash BYTEA;
BEGIN
  expected_prev := decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex');

  FOR rec IN
    SELECT id, event_type, entity_table, entity_id, actor_user_id, device_id,
           ip_address, payload, prev_hash, row_hash, created_at
      FROM ledger_events
     ORDER BY id
  LOOP
    -- 1. prev_hash must link to the previous row's row_hash.
    IF rec.prev_hash <> expected_prev THEN
      break_at_id   := rec.id;
      reason        := 'prev_hash mismatch — row was deleted, reordered, or its predecessor was tampered with';
      expected_hash := expected_prev;
      actual_hash   := rec.prev_hash;
      RETURN NEXT;
      RETURN;
    END IF;

    -- 2. Recompute row_hash and compare.
    recomputed_canonical := concat_ws(
      chr(31),
      encode(rec.prev_hash, 'hex'),
      rec.event_type,
      rec.entity_table,
      rec.entity_id::TEXT,
      COALESCE(rec.actor_user_id::TEXT, ''),
      COALESCE(rec.device_id::TEXT,     ''),
      COALESCE(host(rec.ip_address),     ''),
      encode(digest(rec.payload::TEXT, 'sha256'), 'hex'),
      to_char(rec.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    recomputed_hash := digest(recomputed_canonical, 'sha256');

    IF rec.row_hash <> recomputed_hash THEN
      break_at_id   := rec.id;
      reason        := 'row_hash mismatch — this row''s payload was tampered with after insertion';
      expected_hash := recomputed_hash;
      actual_hash   := rec.row_hash;
      RETURN NEXT;
      RETURN;
    END IF;

    expected_prev := rec.row_hash;
  END LOOP;

  -- All rows verified, no breaks.
  RETURN;
END;
$$;

ALTER FUNCTION verify_ledger_chain() OWNER TO warehouse14_security;

COMMENT ON FUNCTION verify_ledger_chain() IS
  'Walks the ledger from row 1 to N, recomputes each hash, reports the first break. '
  'Empty result = chain intact. Used by nightly CI + Control Desktop on-demand audit.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. ledger_events GRANTS — Day-6 directive: SELECT + INSERT only,
--    and INSERT is column-restricted so app cannot fabricate hashes.
-- ─────────────────────────────────────────────────────────────────────

-- Migration 0003's default privileges granted table-level SELECT + INSERT
-- to warehouse14_app. We REVOKE INSERT then re-GRANT it column-restricted.
REVOKE INSERT ON ledger_events FROM warehouse14_app;

GRANT INSERT (
  event_type,
  entity_table,
  entity_id,
  actor_user_id,
  device_id,
  ip_address,
  payload
) ON ledger_events TO warehouse14_app;

-- The chain columns + auto-id + auto-timestamp are NEVER writable by the app.
-- Even if the app tried to provide them, the trigger overwrites them; this
-- column-level deny is belt-and-braces defense in depth.

-- The sequence for the BIGSERIAL primary key.
GRANT USAGE ON SEQUENCE ledger_events_id_seq TO warehouse14_app;

-- warehouse14_security needs SELECT to run the trigger function as SECURITY DEFINER.
-- It does NOT need INSERT/UPDATE/DELETE — those happen as the calling role.
GRANT SELECT ON ledger_events TO warehouse14_security;

-- Verifier function: any role with EXECUTE can run a chain audit.
GRANT EXECUTE ON FUNCTION verify_ledger_chain() TO warehouse14_app;

-- (NO GRANT UPDATE, NO GRANT DELETE on ledger_events. Ever.)

-- ─────────────────────────────────────────────────────────────────────
-- 5. audit_log — non-fiscal who-when-what.
--
-- For login/logout, role changes, settings updates, AML alerts, etc.
-- Append-only via grants (no UPDATE, no DELETE). No hash chain — the
-- threat model is different (security events, not fiscal records).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL     PRIMARY KEY,
  event_type      TEXT          NOT NULL,            -- 'user.login', 'user.logout', 'role.changed', 'settings.updated'
  actor_user_id   UUID          REFERENCES users(id),
  device_id       UUID          REFERENCES devices(id),
  ip_address      INET,
  user_agent      TEXT,
  payload         JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT audit_log_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS audit_log_event_type_created_at_idx
  ON audit_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_actor_created_at_idx
  ON audit_log (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_business_day_idx
  ON audit_log (berlin_business_day(created_at));

COMMENT ON TABLE audit_log IS
  'Non-fiscal who-when-what (logins, role changes, settings). Append-only via grants. '
  'No hash chain — security events are not the §259 StGB defense surface.';

-- audit_log: app has SELECT + INSERT from default privileges. NO UPDATE/DELETE
-- (default privileges do not grant either). This is sufficient — explicit
-- REVOKE statements would be no-ops.

COMMIT;
