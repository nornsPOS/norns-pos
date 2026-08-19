-- Migration 0028 — transactions.idempotency_key
--
-- §19.2 C-4 fix: client-supplied idempotency token for fiscal POSTs.
--
-- WHY
-- ───
-- The natural protection at finalize() — `WHERE status = 'RESERVED'
-- AND reserved_by_session_id = $1` — catches double-execute ONLY when
-- the same reservationSessionId is used twice. It does NOT protect
-- against:
--   1. A lost response (server committed, client never saw it) followed
--      by the operator clearing the cart, re-reserving the same goods,
--      and retrying — the second finalize uses NEW sessionIds and
--      posts a second transaction.
--   2. ANY ankauf flow — Ankauf doesn't reserve inventory, so the
--      sessionId race-guard doesn't apply at all.
--
-- WHAT
-- ────
-- Optional NULL column + partial UNIQUE INDEX on non-null values. Old
-- rows (pre-V1) keep NULL; new rows from V1 clients MUST supply a UUID,
-- enforced at the route schema layer (Fastify TypeBox). The partial
-- UNIQUE means two different transactions can both be NULL, but two
-- transactions with the SAME non-null key cannot coexist.
--
-- The handler does `INSERT … ON CONFLICT (idempotency_key) DO NOTHING
-- RETURNING *` — if conflict, it then SELECTs the existing row and
-- returns the SAME response body the original call returned.
--
-- DURATION
-- ────────
-- Single ADD COLUMN + CREATE INDEX. ~ms on the salon DB (< 1 M rows).
-- No data backfill — pre-V1 rows stay NULL forever.

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

-- Partial unique index: enforce uniqueness only when the key is set.
-- Old rows (NULL) coexist; every new V1 row gets a key.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_idempotency_key_uniq
  ON transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN transactions.idempotency_key IS
  'Client-supplied UUID for at-most-once finalize. Partial unique index '
  '(transactions_idempotency_key_uniq) guarantees a second POST with the '
  'same key returns the original transaction instead of creating a duplicate. '
  'NULL is permitted for pre-V1 rows and worker-generated transactions.';

COMMIT;
