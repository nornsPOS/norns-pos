-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0009 — Transactions, items, payments + the Great Connection
--
-- This migration wires every previous layer into one fiscal flow:
--   • products (Day 4)             — RESERVED → SOLD via inventory-lock
--   • customers (Day 5)            — cumulative_spend / cumulative_ankauf updated
--   • tax_treatment_codes (Day 3)  — applied per line, immutable snapshot
--   • ledger_events (Day 6)        — every finalize / storno extends the chain
--
-- Storno discipline (ADR-0016 §1, ADR-0008 §5):
--   • A storno is a NEW row with `storno_of_transaction_id` FK to the original.
--   • Storno rows carry NEGATIVE money columns whose magnitudes mirror the
--     original — `SUM(total_eur)` over a business day naturally yields the
--     net revenue (storno just subtracts).
--   • Storno-of-storno is forbidden — enforced by trigger.
--   • The trigger that updates cumulative spend uses `+= NEW.total_eur`
--     uniformly; the negative storno value subtracts automatically.
--
-- Money precision (ADR-0008 §6, Day 3):
--   • All money is NUMERIC(18,2). Decimal.js does arithmetic on the TS side.
--   • DB-enforced invariant per row: subtotal_eur + vat_eur = total_eur.
--   • For §25a margin scheme, vat_eur = VAT-on-margin (computed by the app
--     via Decimal.js before INSERT). The CHECK still holds.
--
-- ADR references:
--   • ADR-0008 §5 §6 §9, §10 (defense-in-depth, trigger ownership)
--   • ADR-0016 §1 §3 §4 (state machine, finalize)
--   • ADR-0015 §7 (tax_treatment classifier output is locked at intake;
--                  applied per line is a copy that travels with the line)
--   • ADR-0013 (payment methods enum reflects future Mollie/Stripe/ZVT)
--
-- Basel Day-7 directives:
--   1. Storno via negative-amount rows + cumulative trigger uniform math
--   2. All-or-nothing finalize: products SOLD, transaction, ledger event
--      — all inside one DB transaction (caller orchestrates)
--   3. No float drift — Decimal.js TS-side + NUMERIC(18,2) DB-side + CHECK
--
-- Idempotent: tables / enums / functions all guarded.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. ENUMs
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_direction') THEN
    CREATE TYPE transaction_direction AS ENUM ('VERKAUF', 'ANKAUF');
    COMMENT ON TYPE transaction_direction IS 'VERKAUF=we sell to customer; ANKAUF=we buy from customer (always KYC per ADR-0007).';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE payment_method AS ENUM (
      'CASH',
      'ZVT_CARD',        -- German Kassenterminal (Verifone/Ingenico per ADR-0013 §6)
      'SUMUP',           -- SumUp Solo fallback
      'MOLLIE',          -- Storefront online checkout (EU)
      'STRIPE',          -- Storefront fallback for intl cards
      'EBAY',            -- eBay-handled payment
      'BANK_TRANSFER',   -- SEPA for high-value
      'VOUCHER'          -- Gift voucher / store credit
    );
  END IF;
END$$;

-- Sequence for human-readable receipt numbers (RCP-YYYY-NNNNNN)
CREATE SEQUENCE IF NOT EXISTS receipt_locator_seq;

-- ─────────────────────────────────────────────────────────────────────
-- 2. transactions
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id                          UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     UUID,                                  -- V1 NULL; multi-shop ready

  -- Direction + storno link
  direction                   transaction_direction   NOT NULL,
  storno_of_transaction_id    UUID                    REFERENCES transactions(id),

  -- Parties
  customer_id                 UUID                    REFERENCES customers(id),
  device_id                   UUID                    NOT NULL REFERENCES devices(id),
  cashier_user_id             UUID                    NOT NULL REFERENCES users(id),

  -- Money — all NUMERIC(18,2). Negative on storno rows.
  subtotal_eur                NUMERIC(18,2)           NOT NULL,
  vat_eur                     NUMERIC(18,2)           NOT NULL,
  total_eur                   NUMERIC(18,2)           NOT NULL,
  tax_treatment_code          TEXT                    NOT NULL REFERENCES tax_treatment_codes(code),

  -- Envelope (app-mutable)
  receipt_locator             TEXT                    NOT NULL DEFAULT (
    'RCP-' || to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY')
           || '-' || lpad(nextval('receipt_locator_seq')::text, 6, '0')
  ),
  printed_at                  TIMESTAMPTZ,
  notes_internal              TEXT,

  -- Lifecycle
  finalized_at                TIMESTAMPTZ             NOT NULL DEFAULT now(),
  created_at                  TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ             NOT NULL DEFAULT now(),

  -- Money balance invariant — holds for both positive (original) and negative (storno) rows.
  CONSTRAINT transactions_balance_equation
    CHECK (subtotal_eur + vat_eur = total_eur),

  -- Sign discipline: originals carry non-negative amounts; storno rows carry non-positive.
  CONSTRAINT transactions_sign_discipline
    CHECK (
      (storno_of_transaction_id IS NULL     AND total_eur >= 0 AND subtotal_eur >= 0 AND vat_eur >= 0)
      OR
      (storno_of_transaction_id IS NOT NULL AND total_eur <= 0 AND subtotal_eur <= 0 AND vat_eur <= 0)
    ),

  -- A storno cannot reference itself.
  CONSTRAINT transactions_storno_not_self
    CHECK (storno_of_transaction_id IS NULL OR storno_of_transaction_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_receipt_locator_uq
  ON transactions (receipt_locator);

CREATE INDEX IF NOT EXISTS transactions_business_day_idx
  ON transactions (berlin_business_day(finalized_at));

CREATE INDEX IF NOT EXISTS transactions_customer_idx
  ON transactions (customer_id, finalized_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_storno_idx
  ON transactions (storno_of_transaction_id)
  WHERE storno_of_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_direction_day_idx
  ON transactions (direction, berlin_business_day(finalized_at));

CREATE INDEX IF NOT EXISTS transactions_tax_treatment_idx
  ON transactions (tax_treatment_code);

CREATE INDEX IF NOT EXISTS transactions_cashier_day_idx
  ON transactions (cashier_user_id, berlin_business_day(finalized_at));

CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE transactions IS
  'Fiscal transaction master record. Storno via negative-amount row + FK to original. '
  'NEVER deleted by app role. Triggers update cumulative customer spend + emit ledger event.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. transaction_items
--    INSERT-only: lines are immutable snapshots of the sale.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_items (
  id                              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id                  UUID                NOT NULL REFERENCES transactions(id),
  product_id                      UUID                NOT NULL REFERENCES products(id),

  -- Line money (negative on storno lines)
  line_subtotal_eur               NUMERIC(18,2)       NOT NULL,
  line_vat_eur                    NUMERIC(18,2)       NOT NULL,
  line_total_eur                  NUMERIC(18,2)       NOT NULL,

  -- Tax treatment as APPLIED (snapshot — product's tax_treatment may evolve)
  applied_tax_treatment_code      TEXT                NOT NULL REFERENCES tax_treatment_codes(code),
  applied_vat_rate                NUMERIC(5,4),                         -- NULL for §25a margin scheme

  -- §25a context: acquisition + margin snapshot for DSFinV-K export
  acquisition_cost_eur_snapshot   NUMERIC(18,2),
  margin_eur                      NUMERIC(18,2),

  display_order                   SMALLINT            NOT NULL DEFAULT 0,
  created_at                      TIMESTAMPTZ         NOT NULL DEFAULT now(),

  CONSTRAINT transaction_items_balance_equation
    CHECK (line_subtotal_eur + line_vat_eur = line_total_eur),

  CONSTRAINT transaction_items_margin_implies_acquisition
    CHECK ((margin_eur IS NULL) = (acquisition_cost_eur_snapshot IS NULL)),

  -- VAT rate range matches the parent reference table.
  CONSTRAINT transaction_items_vat_rate_range
    CHECK (applied_vat_rate IS NULL OR (applied_vat_rate >= 0 AND applied_vat_rate <= 1.0000))
);

CREATE INDEX IF NOT EXISTS transaction_items_transaction_id_idx
  ON transaction_items (transaction_id, display_order);

CREATE INDEX IF NOT EXISTS transaction_items_product_id_idx
  ON transaction_items (product_id);

CREATE INDEX IF NOT EXISTS transaction_items_applied_tax_treatment_idx
  ON transaction_items (applied_tax_treatment_code);

COMMENT ON TABLE transaction_items IS
  'Per-line snapshot at sale time. INSERT-only — never UPDATE, never DELETE. '
  'Carries the applied tax treatment + margin (for §25a) frozen at sale moment.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. transaction_payments
--    INSERT-only: payment records are immutable evidence.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_payments (
  id                          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id              UUID                NOT NULL REFERENCES transactions(id),
  payment_method              payment_method      NOT NULL,
  amount_eur                  NUMERIC(18,2)       NOT NULL,

  external_ref                TEXT,
  zvt_terminal_id             TEXT,
  zvt_receipt_number          TEXT,
  zvt_card_brand              TEXT,
  zvt_card_pan_masked         TEXT,                            -- '****1234' only — never raw PAN
  mollie_payment_id           TEXT,

  created_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),

  -- ZVT card payments must carry a masked PAN (4 trailing digits)
  CONSTRAINT transaction_payments_zvt_masked_pan_shape
    CHECK (
      zvt_card_pan_masked IS NULL OR zvt_card_pan_masked ~ '^\*+\d{4}$'
    )
);

CREATE INDEX IF NOT EXISTS transaction_payments_transaction_id_idx
  ON transaction_payments (transaction_id);

CREATE INDEX IF NOT EXISTS transaction_payments_method_day_idx
  ON transaction_payments (payment_method, berlin_business_day(created_at));

COMMENT ON TABLE transaction_payments IS
  'Each payment leg (split-payment supported). INSERT-only. PCI scope avoided: '
  'we never store raw PAN — only the masked last-4 (ADR-0013).';

-- ─────────────────────────────────────────────────────────────────────
-- 5. The Storno trigger — BEFORE INSERT
--    Enforces the storno discipline:
--      • storno_of_transaction_id must reference a non-storno
--      • the storno's total must equal the negation of the original
--      • the storno's direction must match the original's direction
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION transactions_validate_storno() RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
DECLARE
  orig RECORD;
BEGIN
  IF NEW.storno_of_transaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT direction, total_eur, subtotal_eur, vat_eur, customer_id, storno_of_transaction_id
    INTO orig
    FROM transactions
   WHERE id = NEW.storno_of_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Storno references unknown transaction %', NEW.storno_of_transaction_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- No storno of storno.
  IF orig.storno_of_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot storno transaction % — it is itself a storno', NEW.storno_of_transaction_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Direction must match (Verkauf-storno reverses a Verkauf; Ankauf-storno reverses an Ankauf).
  IF orig.direction <> NEW.direction THEN
    RAISE EXCEPTION 'Storno direction (%) must match original direction (%)', NEW.direction, orig.direction
      USING ERRCODE = 'check_violation';
  END IF;

  -- Magnitudes must mirror exactly.
  IF NEW.total_eur    <> -orig.total_eur    OR
     NEW.subtotal_eur <> -orig.subtotal_eur OR
     NEW.vat_eur      <> -orig.vat_eur      THEN
    RAISE EXCEPTION 'Storno amounts must be the negation of the original (orig total=%, storno total=%)',
                    orig.total_eur, NEW.total_eur
      USING ERRCODE = 'check_violation';
  END IF;

  -- Customer must match (a storno can't move revenue between customers).
  IF orig.customer_id IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'Storno customer must match the original transaction''s customer'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_validate_storno ON transactions;
CREATE TRIGGER trg_transactions_validate_storno
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_validate_storno();

-- ─────────────────────────────────────────────────────────────────────
-- 6. The Great Connection trigger — AFTER INSERT
--    Two responsibilities, in order:
--      (a) update customer cumulative spend (uniform math; storno subtracts naturally)
--      (b) emit a ledger_events row (the chain extends; verify_ledger_chain() will see it)
--
--    SECURITY DEFINER, owned by warehouse14_security:
--      - needs UPDATE on customers.cumulative_*_eur (which app role lacks)
--      - INSERT on ledger_events (column-restricted, but our INSERT only uses allowed cols)
--
--    The trigger is idempotent in the sense that any single INSERT into
--    transactions fires it exactly once; for ALL-or-nothing the app must
--    wrap the multi-statement checkout in one DB transaction.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_transaction_finalized() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
BEGIN
  -- (a) Update customer cumulative spend / Ankauf.
  --     For storno, NEW.total_eur is negative → uniform `+= NEW.total_eur` subtracts.
  IF NEW.customer_id IS NOT NULL THEN
    IF NEW.direction = 'VERKAUF' THEN
      UPDATE customers
         SET cumulative_spend_eur = cumulative_spend_eur + NEW.total_eur
       WHERE id = NEW.customer_id;
    ELSIF NEW.direction = 'ANKAUF' THEN
      UPDATE customers
         SET cumulative_ankauf_eur = cumulative_ankauf_eur + NEW.total_eur
       WHERE id = NEW.customer_id;
    END IF;
  END IF;

  -- (b) Emit ledger_events. The hash-chain trigger from migration 0008 fires
  --     for this INSERT and extends the chain.
  INSERT INTO ledger_events (
    event_type, entity_table, entity_id,
    actor_user_id, device_id,
    payload
  )
  VALUES (
    CASE
      WHEN NEW.storno_of_transaction_id IS NULL THEN 'transaction.finalized'
      ELSE                                            'transaction.stornoed'
    END,
    'transactions',
    NEW.id,
    NEW.cashier_user_id,
    NEW.device_id,
    jsonb_build_object(
      'direction',          NEW.direction,
      'total_eur',          NEW.total_eur::text,
      'subtotal_eur',       NEW.subtotal_eur::text,
      'vat_eur',            NEW.vat_eur::text,
      'tax_treatment_code', NEW.tax_treatment_code,
      'customer_id',        NEW.customer_id,
      'receipt_locator',    NEW.receipt_locator,
      'storno_of',          NEW.storno_of_transaction_id,
      'finalized_at',       to_char(NEW.finalized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION on_transaction_finalized() OWNER TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_transactions_after_insert ON transactions;
CREATE TRIGGER trg_transactions_after_insert
  AFTER INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION on_transaction_finalized();

COMMENT ON FUNCTION on_transaction_finalized() IS
  'AFTER INSERT trigger on transactions. Updates customer cumulative_*_eur + emits ledger event. '
  'SECURITY DEFINER owned by warehouse14_security — app cannot bypass.';

-- Grant the security role the privileges its function needs.
-- (UPDATE on the two cumulative columns only — minimal.)
GRANT UPDATE (cumulative_spend_eur, cumulative_ankauf_eur) ON customers TO warehouse14_security;

-- The function INSERTs into ledger_events. The column-restricted INSERT
-- privilege granted to warehouse14_app in 0008 also needs to be available to
-- warehouse14_security so SECURITY DEFINER works.
GRANT INSERT (
  event_type, entity_table, entity_id, actor_user_id, device_id, ip_address, payload
) ON ledger_events TO warehouse14_security;
GRANT USAGE ON SEQUENCE ledger_events_id_seq TO warehouse14_security;

-- ─────────────────────────────────────────────────────────────────────
-- 7. App-role grants
--
-- transactions:
--   • SELECT + INSERT (default privileges)
--   • UPDATE only on envelope columns
--   • NO DELETE
--
-- transaction_items / transaction_payments:
--   • SELECT + INSERT (default privileges)
--   • NO UPDATE (lines + payments are immutable snapshots)
--   • NO DELETE
-- ─────────────────────────────────────────────────────────────────────

GRANT UPDATE (
  printed_at,
  receipt_locator,                                 -- TSE may rewrite if Fiskaly assigns
  notes_internal,
  updated_at
) ON transactions TO warehouse14_app;

-- transaction_items / transaction_payments: app cannot UPDATE anything.
-- (No GRANT UPDATE statements here — default-deny is what we want.)

-- Sequences for app inserts.
GRANT USAGE ON SEQUENCE receipt_locator_seq TO warehouse14_app;

COMMIT;
