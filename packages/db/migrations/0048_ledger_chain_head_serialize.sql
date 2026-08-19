-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0048 — Fix the ledger hash-chain fork under concurrency (GoBD).
--
-- BUG (ground truth: duplicate prev_hash committed, verify_ledger_chain() breaks
-- after 100 concurrent emits): 0008's ledger_compute_hash() did
--   pg_advisory_xact_lock(14000000);
--   SELECT row_hash ... ORDER BY id DESC LIMIT 1;   -- plain snapshot read
-- The advisory lock serializes EXECUTION, but the SELECT reads the INSERT
-- command's MVCC snapshot, frozen at statement start — BEFORE the lock was
-- acquired. A waiter therefore reads a tail that predates its predecessor's
-- commit, and two rows write the SAME prev_hash → the chain physically forks.
-- Compounding: id (BIGSERIAL default) is assigned before the lock, so id-order
-- ≠ chain-order and verify_ledger_chain() (ORDER BY id) fails even fork-free.
--
-- FIX:
--   1. A singleton head row (ledger_chain_head.last_row_hash). The trigger reads
--      it `FOR UPDATE` — a row-lock read that, unlike a snapshot SELECT, re-reads
--      the latest COMMITTED value via EvalPlanQual after the lock wait. This
--      serializes AND reads fresh → no fork. The advisory lock is removed.
--   2. NEW.id := nextval(...) is assigned INSIDE the serialized section so
--      id-order == chain-order (the BIGSERIAL default still fires first but is
--      overwritten; harmless sequence gaps, no consumer needs gaplessness —
--      readers only assume monotonicity, which is preserved, and DSFinV-K /
--      closings export `transactions`, not this internal chain).
--   3. warehouse14_security (the SECURITY DEFINER trigger's owner) gets the
--      minimal grants it now needs: SELECT+UPDATE on the head, USAGE on the id
--      sequence (it previously never called nextval itself).
--
-- Backfill: seed the head from the REAL current tail (else 32 zero-bytes for an
-- empty ledger), so the first post-migration emit chains onto the existing
-- chain. Apply during quiescence (no concurrent emit) so the seeded tail is
-- exact; at single-shop scale the deploy already pauses writes.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- 0. Block concurrent ledger_events INSERTs for the duration of this migration
--    so nothing can land BETWEEN the head seed (step 2) and the trigger swap
--    (step 3) — such a row would chain off the old trigger and fork the chain
--    once. SHARE ROW EXCLUSIVE conflicts with the ROW EXCLUSIVE that INSERT
--    takes, so emits wait for COMMIT. Makes 0048 correct even without an
--    external write-quiescent window.
LOCK TABLE ledger_events IN SHARE ROW EXCLUSIVE MODE;

-- 1. Singleton chain-head pointer.
CREATE TABLE IF NOT EXISTS ledger_chain_head (
  only_row      BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (only_row),
  last_row_hash BYTEA   NOT NULL
);

COMMENT ON TABLE ledger_chain_head IS
  'Singleton pointer to the tail row_hash of ledger_events. Read FOR UPDATE by '
  'ledger_compute_hash() to serialize + freshly read the chain head (replaces a '
  'snapshot-bound tail SELECT that forked under concurrency). Migration 0048.';

-- 2. Seed from the real tail (genesis zero-bytes when the ledger is empty).
INSERT INTO ledger_chain_head (only_row, last_row_hash)
SELECT TRUE,
       COALESCE(
         (SELECT row_hash FROM ledger_events ORDER BY id DESC LIMIT 1),
         decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex')
       )
ON CONFLICT (only_row) DO NOTHING;

-- 3. Rewrite the trigger function: head FOR UPDATE + in-lock id, no advisory lock.
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

  -- 2. Serialize AND read the latest committed tail in one step. FOR UPDATE
  --    row-locks the singleton head; a concurrent waiter re-reads the freshly
  --    committed last_row_hash via EvalPlanQual (a plain snapshot SELECT would
  --    read the INSERT statement's frozen snapshot → stale tail → forked chain).
  SELECT last_row_hash INTO last_hash
    FROM ledger_chain_head
   WHERE only_row
     FOR UPDATE;

  -- 3. Assign the id INSIDE the serialized section so id-order == chain-order.
  --    (The BIGSERIAL column default fires before this BEFORE-trigger / before
  --    the lock, so it cannot order the chain; overwrite it here.)
  NEW.id := nextval('ledger_events_id_seq');

  NEW.prev_hash := last_hash;

  -- 4. Canonical form — byte-for-byte identical to 0008.
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

  -- 5. Compute the row hash and advance the head pointer (still inside the lock).
  NEW.row_hash := digest(canonical, 'sha256');

  UPDATE ledger_chain_head
     SET last_row_hash = NEW.row_hash
   WHERE only_row;

  RETURN NEW;
END;
$$;

ALTER FUNCTION ledger_compute_hash() OWNER TO warehouse14_security;

-- 4. Minimal grants for the SECURITY DEFINER trigger (runs as warehouse14_security).
GRANT SELECT, UPDATE ON ledger_chain_head TO warehouse14_security;
GRANT USAGE ON SEQUENCE ledger_events_id_seq TO warehouse14_security;

COMMIT;
