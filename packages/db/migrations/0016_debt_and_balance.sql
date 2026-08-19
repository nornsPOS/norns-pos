-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0016 — Customer debt + DB-side transaction balance (Day 17)
--
-- Closes two gaps surfaced by the 3rd-party audit:
--
--   1. **Transaction balance was Node-only.** `validateTransactionMath()` in
--      `apps/api-cloud/src/lib/transaction-math.ts` verified that
--      Σ items = total = Σ payments AND ≥1 item AND ≥1 payment, but a
--      direct SQL bypass (compromised migrator role, future worker writing
--      transactions, bug in a new route) could land an unbalanced
--      transaction. ADR-0008 §10 says every fiscal invariant lives in the DB.
--      Fix: a DEFERRABLE INITIALLY DEFERRED constraint trigger evaluated at
--      COMMIT time on transactions / transaction_items / transaction_payments.
--
--   2. **DEBT payment had no debt-tracking semantics.** The payment_method
--      enum included DEBT but no column accumulated the customer's
--      outstanding balance. Fix: `customers.cumulative_debt_eur` + AFTER
--      INSERT trigger on transaction_payments that bumps the balance when
--      payment_method = 'DEBT'. Plus a guard trigger refusing DEBT payments
--      when transactions.customer_id IS NULL (can't extend credit to walk-in).
--
-- Storno discipline: storno transactions carry NEGATIVE payment amounts.
-- The same trigger uniformly adds NEW.amount_eur to cumulative_debt_eur, so
-- a storno of a DEBT sale naturally reverses the debt. The non-negative
-- CHECK on customers.cumulative_debt_eur ensures we never "over-storno" into
-- a negative debt (which would be nonsense).
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. customers.cumulative_debt_eur
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cumulative_debt_eur NUMERIC(18,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customers_cumulative_debt_non_negative'
       AND conrelid = 'customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_cumulative_debt_non_negative
      CHECK (cumulative_debt_eur >= 0);
  END IF;
END$$;

COMMENT ON COLUMN customers.cumulative_debt_eur IS
  'Outstanding debt balance — accumulated when transaction_payments lands a DEBT row, '
  'reversed when a storno of that transaction lands a negative DEBT row. '
  'NOT NULL CHECK >= 0 — over-reversal is refused.';

-- Index for "customers with outstanding debt" view (Bridge UX panel).
CREATE INDEX IF NOT EXISTS customers_with_debt_idx
  ON customers (cumulative_debt_eur DESC)
  WHERE cumulative_debt_eur > 0 AND soft_deleted_at IS NULL;

-- App role needs UPDATE on this column for the trigger function (SECURITY DEFINER
-- runs as warehouse14_security; grant accordingly).
GRANT UPDATE (cumulative_debt_eur) ON customers TO warehouse14_security;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. DEBT payment guard — refuse DEBT row if parent transaction has no customer
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION transaction_payments_debt_requires_customer() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  tx_customer_id UUID;
BEGIN
  IF NEW.payment_method <> 'DEBT' THEN
    RETURN NEW;
  END IF;
  SELECT customer_id INTO tx_customer_id FROM transactions WHERE id = NEW.transaction_id;
  IF tx_customer_id IS NULL THEN
    RAISE EXCEPTION 'DEBT payment requires customer_id on parent transaction (transaction %)', NEW.transaction_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION transaction_payments_debt_requires_customer() OWNER TO warehouse14_security;

GRANT SELECT (id, customer_id) ON transactions TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_transaction_payments_debt_guard ON transaction_payments;
CREATE TRIGGER trg_transaction_payments_debt_guard
  BEFORE INSERT ON transaction_payments
  FOR EACH ROW EXECUTE FUNCTION transaction_payments_debt_requires_customer();

COMMENT ON FUNCTION transaction_payments_debt_requires_customer() IS
  'Day-17 audit fix: DEBT payment is meaningless without a customer to owe it. '
  'Refuse the INSERT if transactions.customer_id IS NULL.';

-- ═════════════════════════════════════════════════════════════════════════
-- 3. DEBT accumulation trigger
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION transaction_payments_accumulate_debt() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  tx_customer_id UUID;
BEGIN
  IF NEW.payment_method <> 'DEBT' THEN
    RETURN NEW;
  END IF;
  SELECT customer_id INTO tx_customer_id FROM transactions WHERE id = NEW.transaction_id;
  -- Guard trigger above ensures tx_customer_id IS NOT NULL when we get here.
  UPDATE customers
     SET cumulative_debt_eur = cumulative_debt_eur + NEW.amount_eur
   WHERE id = tx_customer_id;
  RETURN NEW;
END;
$$;

ALTER FUNCTION transaction_payments_accumulate_debt() OWNER TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_transaction_payments_accumulate_debt ON transaction_payments;
CREATE TRIGGER trg_transaction_payments_accumulate_debt
  AFTER INSERT ON transaction_payments
  FOR EACH ROW EXECUTE FUNCTION transaction_payments_accumulate_debt();

COMMENT ON FUNCTION transaction_payments_accumulate_debt() IS
  'Day-17: bumps customers.cumulative_debt_eur when a DEBT payment row lands. '
  'Storno reverses naturally via the negative-amount rows. The non-negative CHECK '
  'on cumulative_debt_eur refuses over-reversal.';

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Transaction balance constraint trigger (audit finding #2)
--
-- Verifies at COMMIT time:
--   • Σ transaction_items.line_total_eur     = transactions.total_eur
--   • Σ transaction_items.line_subtotal_eur  = transactions.subtotal_eur
--   • Σ transaction_items.line_vat_eur       = transactions.vat_eur
--   • Σ transaction_payments.amount_eur      = transactions.total_eur
--   • ≥1 item     for each transactions row
--   • ≥1 payment  for each transactions row
--
-- The trigger is DEFERRABLE INITIALLY DEFERRED — it fires once per
-- transactions row at COMMIT, after items + payments have all landed.
--
-- One function with two attachment points: fires when transactions row is
-- inserted (to know the new tx id) OR when items/payments land for an
-- already-inserted tx. We dedupe across the same statement by using a
-- single statement-level check with FOR EACH ROW + DEFERRABLE — Postgres
-- coalesces deferred constraint checks of identical (function, args) into
-- one evaluation per row at COMMIT.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION verify_transaction_balance() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  tx_id UUID;
  header RECORD;
  items_total NUMERIC(18,2);
  items_subtotal NUMERIC(18,2);
  items_vat NUMERIC(18,2);
  payments_total NUMERIC(18,2);
  item_count INTEGER;
  payment_count INTEGER;
BEGIN
  -- Resolve the transaction id from whichever table fired the trigger.
  -- TG_TABLE_NAME is the table the trigger is attached to.
  IF TG_TABLE_NAME = 'transactions' THEN
    tx_id := NEW.id;
  ELSE
    tx_id := NEW.transaction_id;
  END IF;

  SELECT subtotal_eur, vat_eur, total_eur
    INTO header
    FROM transactions
   WHERE id = tx_id;

  -- Header gone: a parallel ROLLBACK removed it; nothing to verify.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(line_total_eur),    0),
    COALESCE(SUM(line_subtotal_eur), 0),
    COALESCE(SUM(line_vat_eur),      0),
    COUNT(*)
  INTO items_total, items_subtotal, items_vat, item_count
  FROM transaction_items
  WHERE transaction_id = tx_id;

  SELECT
    COALESCE(SUM(amount_eur), 0),
    COUNT(*)
  INTO payments_total, payment_count
  FROM transaction_payments
  WHERE transaction_id = tx_id;

  IF item_count = 0 THEN
    RAISE EXCEPTION 'Transaction balance: transaction % has no items at COMMIT', tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF payment_count = 0 THEN
    RAISE EXCEPTION 'Transaction balance: transaction % has no payments at COMMIT', tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF items_total <> header.total_eur THEN
    RAISE EXCEPTION 'Transaction balance: items total (%) <> header total (%) for transaction %',
      items_total, header.total_eur, tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF items_subtotal <> header.subtotal_eur THEN
    RAISE EXCEPTION 'Transaction balance: items subtotal (%) <> header subtotal (%) for transaction %',
      items_subtotal, header.subtotal_eur, tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF items_vat <> header.vat_eur THEN
    RAISE EXCEPTION 'Transaction balance: items vat (%) <> header vat (%) for transaction %',
      items_vat, header.vat_eur, tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF payments_total <> header.total_eur THEN
    RAISE EXCEPTION 'Transaction balance: payments total (%) <> header total (%) for transaction %',
      payments_total, header.total_eur, tx_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION verify_transaction_balance() OWNER TO warehouse14_security;

-- The function needs SELECT on items + payments.
GRANT SELECT ON transaction_items TO warehouse14_security;
GRANT SELECT ON transaction_payments TO warehouse14_security;
GRANT SELECT (id, subtotal_eur, vat_eur, total_eur) ON transactions TO warehouse14_security;

-- Attach as DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER on all three tables.
DROP TRIGGER IF EXISTS trg_verify_transaction_balance_tx ON transactions;
CREATE CONSTRAINT TRIGGER trg_verify_transaction_balance_tx
  AFTER INSERT ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verify_transaction_balance();

DROP TRIGGER IF EXISTS trg_verify_transaction_balance_items ON transaction_items;
CREATE CONSTRAINT TRIGGER trg_verify_transaction_balance_items
  AFTER INSERT ON transaction_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verify_transaction_balance();

DROP TRIGGER IF EXISTS trg_verify_transaction_balance_payments ON transaction_payments;
CREATE CONSTRAINT TRIGGER trg_verify_transaction_balance_payments
  AFTER INSERT ON transaction_payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verify_transaction_balance();

COMMIT;
