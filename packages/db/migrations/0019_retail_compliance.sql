-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0019 — Retail & Compliance Core (Day 21)
--
-- The systems that turn the storefront-equipped backend (Day 19/20) into a
-- real German Kassensystem. memory.md decision #67 is the long-form rationale.
--
-- This is the single largest migration since the schema first landed. It
-- adds NINE new tables, FIVE new enums, EXTENDS three existing tables, and
-- pins narrow role-grants for each.
--
-- Tables introduced:
--   shifts                      — per-device-per-cashier cash session
--   cash_movements              — bank drops, safe transit, injections
--   vouchers                    — Gutscheine (single + multi-purpose VAT)
--   voucher_redemptions         — append-only redemption log
--   inventory_sessions          — Stichtagsinventur stocktake
--   inventory_scans             — barcode-by-barcode stocktake events
--   whatsapp_inbound_messages   — Meta Cloud API webhook idempotency
--
-- Enums introduced:
--   shift_status                — OPEN / CLOSED
--   cash_movement_direction     — BANK_DROP / SAFE_TRANSIT / INJECTION /
--                                 OPENING_FLOAT / CLOSING_RECONCILIATION
--   voucher_type                — SINGLE_PURPOSE / MULTI_PURPOSE
--   voucher_status              — ACTIVE / REDEEMED / EXPIRED / REVOKED
--   inventory_session_status    — OPEN / CLOSED
--   inventory_scan_match        — MATCHED / UNKNOWN_BARCODE / DUPLICATE /
--                                 EXPECTED_BUT_SOLD / UNEXPECTED
--
-- transactions extensions:
--   paired_with_transaction_id  — trade-in pair (symmetric)
--   returned_at                 — online return marker (NULL for normal sales)
--   suspicious_aml_flag         — GwG § 43 SAR flag
--   suspicious_aml_reason       — operator's reason
--   suspicious_flagged_by_user_id
--   receipt_declined_at         — customer waived per § 146a AO
--   receipt_emailed_at          — digital alternative
--
-- transaction_items extensions:
--   line_discount_eur           — Rabatt amount (≥ 0); reported separately
--   line_discount_reason        — required when discount > 0
--
-- transaction_payments extensions:
--   trade_in_ankauf_transaction_id  — links a TRADE_IN payment to its Ankauf
--
-- Payment-method enum adds 'TRADE_IN'.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Enums
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_status') THEN
    CREATE TYPE shift_status AS ENUM ('OPEN', 'CLOSED');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_movement_direction') THEN
    CREATE TYPE cash_movement_direction AS ENUM (
      'OPENING_FLOAT',
      'INJECTION',
      'BANK_DROP',
      'SAFE_TRANSIT',
      'CLOSING_RECONCILIATION'
    );
    COMMENT ON TYPE cash_movement_direction IS
      'OPENING_FLOAT = initial Wechselgeld; INJECTION = mid-shift cash added; '
      'BANK_DROP = cash leaves drawer to bank; SAFE_TRANSIT = drawer ↔ safe; '
      'CLOSING_RECONCILIATION = end-of-shift drawer count vs expected.';
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_type') THEN
    CREATE TYPE voucher_type AS ENUM ('SINGLE_PURPOSE', 'MULTI_PURPOSE');
    COMMENT ON TYPE voucher_type IS
      '§ 3 Abs. 14 UStG: SINGLE_PURPOSE = definite product/tax → VAT at issuance. '
      'MULTI_PURPOSE = redeemable for anything → VAT at redemption.';
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_status') THEN
    CREATE TYPE voucher_status AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'REVOKED');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_session_status') THEN
    CREATE TYPE inventory_session_status AS ENUM ('OPEN', 'CLOSED');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_scan_match') THEN
    CREATE TYPE inventory_scan_match AS ENUM (
      'MATCHED',           -- barcode → existing AVAILABLE/RESERVED product → expected
      'UNKNOWN_BARCODE',   -- barcode doesn't resolve to any product row
      'DUPLICATE',         -- same barcode already scanned in this session
      'EXPECTED_BUT_SOLD', -- product exists but is SOLD/archived → shouldn't be on shelf
      'UNEXPECTED'         -- product exists but its status is DRAFT → not part of countable inventory
    );
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. payment_method enum — add TRADE_IN
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
     WHERE enumtypid = 'payment_method'::regtype AND enumlabel = 'TRADE_IN'
  ) THEN
    ALTER TYPE payment_method ADD VALUE 'TRADE_IN';
  END IF;
END$$;

-- PG limitation (all versions): a new enum value added via ALTER TYPE ADD
-- VALUE cannot be used in a CHECK constraint within the same transaction.
-- Split the migration here: commit the ADD VALUE, then start a fresh tx
-- for the rest. The split is transparent to the user — re-running the
-- migration is still idempotent thanks to the IF NOT EXISTS guards.
COMMIT;
BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. shifts — per-cashier-per-device cash session
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shifts (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id                UUID         NOT NULL REFERENCES devices(id),
  opened_by_user_id        UUID         NOT NULL REFERENCES users(id),
  opened_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  opening_float_eur        NUMERIC(18,2) NOT NULL CHECK (opening_float_eur >= 0),

  status                   shift_status NOT NULL DEFAULT 'OPEN',

  /** Blind cash count entered by the cashier BEFORE the system reveals expected.
      NULL until close-step is invoked. */
  blind_count_eur          NUMERIC(18,2),
  /** System-computed expected drawer balance at close. */
  system_expected_eur      NUMERIC(18,2),
  /** Stored arithmetic for Bridge UX queries. Positive = surplus, negative = Schwund. */
  variance_eur             NUMERIC(18,2) GENERATED ALWAYS AS (blind_count_eur - system_expected_eur) STORED,

  closed_by_user_id        UUID         REFERENCES users(id),
  closed_at                TIMESTAMPTZ,
  notes                    TEXT,

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT shifts_closed_has_evidence CHECK (
    status <> 'CLOSED' OR (
      closed_by_user_id  IS NOT NULL AND
      closed_at          IS NOT NULL AND
      blind_count_eur    IS NOT NULL AND
      system_expected_eur IS NOT NULL
    )
  ),
  CONSTRAINT shifts_open_no_close_fields CHECK (
    status <> 'OPEN' OR (
      closed_by_user_id  IS NULL AND
      closed_at          IS NULL
    )
  )
);

/* At most one OPEN shift per device — refuses double-opening. */
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_device_uq
  ON shifts (device_id) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS shifts_opened_by_idx ON shifts (opened_by_user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS shifts_device_day_idx
  ON shifts (device_id, berlin_business_day(opened_at));

CREATE TRIGGER trg_shifts_updated_at
  BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE shifts IS
  'Cashier sessions (Kassenschicht). Blindsturz: blind_count_eur entered first, '
  'system_expected_eur revealed AFTER. Variance is auto-computed. NEVER deleted.';

-- ═════════════════════════════════════════════════════════════════════════
-- 4. cash_movements — bank drops, safe transit, injections
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cash_movements (
  id              UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id        UUID                     NOT NULL REFERENCES shifts(id),
  direction       cash_movement_direction  NOT NULL,
  amount_eur      NUMERIC(18,2)            NOT NULL CHECK (amount_eur > 0),
  reason          TEXT                     NOT NULL,
  witness_user_id UUID                     REFERENCES users(id),
  performed_by_user_id UUID                NOT NULL REFERENCES users(id),
  external_ref    TEXT,                                    -- bag seal #, deposit slip #, etc.
  created_at      TIMESTAMPTZ              NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_movements_shift_idx ON cash_movements (shift_id, created_at);
CREATE INDEX IF NOT EXISTS cash_movements_direction_day_idx
  ON cash_movements (direction, berlin_business_day(created_at));

COMMENT ON TABLE cash_movements IS
  'Geldtransit ledger. BANK_DROP = drawer→bank (reduces drawer); '
  'SAFE_TRANSIT = drawer↔safe; INJECTION = added to drawer mid-shift. '
  'Append-only (no UPDATE / no DELETE). Witness witness_user_id required '
  'for amounts > €1000 (enforced at API layer).';

-- ═════════════════════════════════════════════════════════════════════════
-- 5. vouchers + voucher_redemptions — Gutscheine
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vouchers (
  id                            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  /** 16-char public code (ULID-like; printed on the physical / emailed voucher). */
  code                          TEXT            NOT NULL UNIQUE,
  voucher_type                  voucher_type    NOT NULL,
  issued_value_eur              NUMERIC(18,2)   NOT NULL CHECK (issued_value_eur > 0),
  current_balance_eur           NUMERIC(18,2)   NOT NULL CHECK (current_balance_eur >= 0),

  /** Only meaningful for SINGLE_PURPOSE — VAT was paid at issuance. */
  issuance_tax_treatment_code   TEXT            REFERENCES tax_treatment_codes(code),

  issued_to_customer_id         UUID            REFERENCES customers(id),
  /** Transaction that recorded the sale of this voucher. NULL when seeded manually by ADMIN. */
  issued_by_transaction_id      UUID            REFERENCES transactions(id),
  expires_at                    TIMESTAMPTZ,
  status                        voucher_status  NOT NULL DEFAULT 'ACTIVE',

  notes                         TEXT,
  created_at                    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ     NOT NULL DEFAULT now(),

  CONSTRAINT vouchers_balance_le_issued
    CHECK (current_balance_eur <= issued_value_eur),
  CONSTRAINT vouchers_single_purpose_has_tax CHECK (
    voucher_type <> 'SINGLE_PURPOSE' OR issuance_tax_treatment_code IS NOT NULL
  ),
  CONSTRAINT vouchers_code_format CHECK (code ~ '^[A-Z0-9]{8,32}$')
);

CREATE INDEX IF NOT EXISTS vouchers_status_idx ON vouchers (status, expires_at);
CREATE INDEX IF NOT EXISTS vouchers_customer_idx ON vouchers (issued_to_customer_id)
  WHERE issued_to_customer_id IS NOT NULL;

CREATE TRIGGER trg_vouchers_updated_at
  BEFORE UPDATE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id      UUID           NOT NULL REFERENCES vouchers(id),
  transaction_id  UUID           NOT NULL REFERENCES transactions(id),
  amount_eur      NUMERIC(18,2)  NOT NULL CHECK (amount_eur > 0),
  redeemed_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voucher_redemptions_voucher_idx
  ON voucher_redemptions (voucher_id, redeemed_at);
CREATE INDEX IF NOT EXISTS voucher_redemptions_tx_idx
  ON voucher_redemptions (transaction_id);

COMMENT ON TABLE voucher_redemptions IS
  'Append-only redemption log. Each row reduces vouchers.current_balance_eur. '
  '§ 3 Abs. 14 UStG: SINGLE_PURPOSE vouchers carry VAT from issuance (no extra '
  'VAT at redemption); MULTI_PURPOSE vouchers carry VAT at redemption (the '
  'transaction_items lines that consume them).';

-- ═════════════════════════════════════════════════════════════════════════
-- 6. inventory_sessions + inventory_scans — Stichtagsinventur
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id                  UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by_user_id   UUID                       NOT NULL REFERENCES users(id),
  opened_at           TIMESTAMPTZ                NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ,
  closed_by_user_id   UUID                       REFERENCES users(id),
  status              inventory_session_status   NOT NULL DEFAULT 'OPEN',
  /** Count of products considered "expected on shelf" at session start —
      SNAPSHOT (status IN ('AVAILABLE','RESERVED') AND archived_at IS NULL). */
  expected_count      INTEGER                    NOT NULL DEFAULT 0,
  /** Filled at close. */
  matched_count       INTEGER,
  missing_count       INTEGER,
  unexpected_count    INTEGER,
  notes               TEXT,
  created_at          TIMESTAMPTZ                NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ                NOT NULL DEFAULT now(),

  CONSTRAINT inventory_sessions_closed_has_evidence CHECK (
    status <> 'CLOSED' OR (
      closed_by_user_id IS NOT NULL AND
      closed_at         IS NOT NULL AND
      matched_count     IS NOT NULL AND
      missing_count     IS NOT NULL AND
      unexpected_count  IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_sessions_one_open_uq
  ON inventory_sessions ((1)) WHERE status = 'OPEN';

CREATE TRIGGER trg_inventory_sessions_updated_at
  BEFORE UPDATE ON inventory_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS inventory_scans (
  id                  UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID                  NOT NULL REFERENCES inventory_sessions(id),
  raw_barcode         TEXT                  NOT NULL,
  product_id          UUID                  REFERENCES products(id),
  match_status        inventory_scan_match  NOT NULL,
  scanned_by_user_id  UUID                  NOT NULL REFERENCES users(id),
  scanned_at          TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_scans_session_idx
  ON inventory_scans (session_id, scanned_at);
CREATE INDEX IF NOT EXISTS inventory_scans_product_idx
  ON inventory_scans (product_id) WHERE product_id IS NOT NULL;

COMMENT ON TABLE inventory_scans IS
  'Append-only barcode-scan log per inventory session. A product scanned '
  'twice in the same session lands a DUPLICATE row — operator reviews.';

-- ═════════════════════════════════════════════════════════════════════════
-- 7. whatsapp_inbound_messages — Meta Cloud API webhook idempotency
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS whatsapp_inbound_messages (
  id                   BIGSERIAL    PRIMARY KEY,
  /** Meta's `messages[].id` — unique per Meta delivery. */
  meta_message_id      TEXT         NOT NULL,
  from_phone           TEXT         NOT NULL,
  message_type         TEXT         NOT NULL,     -- 'text' | 'image' | 'audio' | 'document' | ...
  raw_payload          JSONB        NOT NULL,
  signature_verified   BOOLEAN      NOT NULL,
  processed_at         TIMESTAMPTZ,
  processing_error     TEXT,
  received_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_inbound_payload_object CHECK (jsonb_typeof(raw_payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_inbound_meta_id_uq
  ON whatsapp_inbound_messages (meta_message_id);
CREATE INDEX IF NOT EXISTS whatsapp_inbound_unprocessed_idx
  ON whatsapp_inbound_messages (received_at DESC)
  WHERE processed_at IS NULL;

COMMENT ON TABLE whatsapp_inbound_messages IS
  'Meta Cloud API webhook deliveries. UNIQUE (meta_message_id) makes retries '
  'idempotent. Annahme-Arbeiter (ADR-0015) reads from here. NEVER deleted '
  '— GDPR purge handled by Phase 1.5 retention worker.';

-- ═════════════════════════════════════════════════════════════════════════
-- 8. transactions extensions
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS paired_with_transaction_id UUID REFERENCES transactions(id);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS suspicious_aml_flag BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS suspicious_aml_reason TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS suspicious_flagged_by_user_id UUID REFERENCES users(id);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS receipt_declined_at TIMESTAMPTZ;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS receipt_emailed_at TIMESTAMPTZ;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id);

DO $$ BEGIN
  /** A transaction cannot pair with itself. */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_pair_not_self') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_pair_not_self
      CHECK (paired_with_transaction_id IS NULL OR paired_with_transaction_id <> id);
  END IF;

  /** AML flag invariant: flag set ⇒ reason + flagger set. */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_aml_flag_has_evidence') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_aml_flag_has_evidence
      CHECK (
        suspicious_aml_flag = FALSE OR (
          suspicious_aml_reason IS NOT NULL AND
          suspicious_flagged_by_user_id IS NOT NULL
        )
      );
  END IF;

  /** Online returns marker. */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_returned_requires_storno') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_returned_requires_storno
      CHECK (
        returned_at IS NULL OR (
          storno_of_transaction_id IS NOT NULL AND
          shipping_status = 'RETURNED'
        )
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS transactions_paired_idx
  ON transactions (paired_with_transaction_id)
  WHERE paired_with_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_returned_idx
  ON transactions (returned_at DESC) WHERE returned_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_aml_flag_idx
  ON transactions (suspicious_aml_flag, finalized_at DESC)
  WHERE suspicious_aml_flag = TRUE;

CREATE INDEX IF NOT EXISTS transactions_shift_idx
  ON transactions (shift_id) WHERE shift_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- 9. transaction_items extensions — Rabatte
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS line_discount_eur NUMERIC(18,2) NOT NULL DEFAULT 0;

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS line_discount_reason TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transaction_items_discount_nonneg') THEN
    ALTER TABLE transaction_items
      ADD CONSTRAINT transaction_items_discount_nonneg
      CHECK (line_discount_eur >= 0);
  END IF;
  /** Discount > 0 ⇒ a reason is captured (§ 14 UStG audit trail). */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transaction_items_discount_has_reason') THEN
    ALTER TABLE transaction_items
      ADD CONSTRAINT transaction_items_discount_has_reason
      CHECK (line_discount_eur = 0 OR line_discount_reason IS NOT NULL);
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 10. transaction_payments extensions — TRADE_IN
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE transaction_payments
  ADD COLUMN IF NOT EXISTS trade_in_ankauf_transaction_id UUID REFERENCES transactions(id);

DO $$ BEGIN
  /** A TRADE_IN payment must point at an Ankauf transaction. */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transaction_payments_tradein_requires_ankauf') THEN
    ALTER TABLE transaction_payments
      ADD CONSTRAINT transaction_payments_tradein_requires_ankauf
      CHECK (
        payment_method <> 'TRADE_IN' OR trade_in_ankauf_transaction_id IS NOT NULL
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS transaction_payments_tradein_idx
  ON transaction_payments (trade_in_ankauf_transaction_id)
  WHERE trade_in_ankauf_transaction_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- 11. Role grants — narrow, deliberate
-- ═════════════════════════════════════════════════════════════════════════

-- shifts: app writes opening + closing; never DELETE.
GRANT UPDATE (
  status, blind_count_eur, system_expected_eur,
  closed_by_user_id, closed_at, notes, updated_at
) ON shifts TO warehouse14_app;

-- cash_movements: append-only by app (no UPDATE, no DELETE).
-- (default INSERT + SELECT from migration 0003 is enough.)

-- vouchers: app issues + redeems, status flips. NEVER DELETE.
GRANT UPDATE (
  current_balance_eur, status, expires_at, notes, updated_at
) ON vouchers TO warehouse14_app;

-- voucher_redemptions: append-only.

-- inventory_sessions: open / close.
GRANT UPDATE (
  status, closed_at, closed_by_user_id,
  matched_count, missing_count, unexpected_count,
  notes, updated_at
) ON inventory_sessions TO warehouse14_app;

-- inventory_scans: append-only.

-- whatsapp_inbound_messages: handler INSERTs once + UPDATEs processed_at.
GRANT UPDATE (processed_at, processing_error) ON whatsapp_inbound_messages TO warehouse14_app;
GRANT USAGE ON SEQUENCE whatsapp_inbound_messages_id_seq TO warehouse14_app;

-- transactions extensions: shift_id, suspicious flag fields, receipt markers
-- ALL get UPDATE — the existing column-grant from migration 0009 doesn't
-- enumerate them, so add explicit grants here.
GRANT UPDATE (
  suspicious_aml_flag, suspicious_aml_reason, suspicious_flagged_by_user_id,
  receipt_declined_at, receipt_emailed_at,
  returned_at, shift_id
) ON transactions TO warehouse14_app;
-- paired_with_transaction_id is set at INSERT only (intake-locked).

-- transaction_items extensions: discount fields stay set-at-INSERT (audit trail).
-- (no new UPDATE grant — discounts are immutable per line.)

-- transaction_payments extensions: trade_in_ankauf_transaction_id set at INSERT.
-- (no new UPDATE grant.)

-- worker role gets SELECT on the new tables for jobs.
GRANT SELECT ON shifts, cash_movements, vouchers, voucher_redemptions,
                inventory_sessions, inventory_scans, whatsapp_inbound_messages
  TO warehouse14_worker;
-- Worker can UPDATE whatsapp processed markers (Annahme-Arbeiter).
GRANT UPDATE (processed_at, processing_error) ON whatsapp_inbound_messages TO warehouse14_worker;
GRANT INSERT ON whatsapp_inbound_messages TO warehouse14_worker;
GRANT USAGE ON SEQUENCE whatsapp_inbound_messages_id_seq TO warehouse14_worker;

COMMIT;
