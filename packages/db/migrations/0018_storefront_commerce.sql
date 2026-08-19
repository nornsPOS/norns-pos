-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0018 — Storefront commerce: B2C identity + carts + payments (Day 19)
--
-- The foundation that lets warehouse14.de accept online orders end-to-end.
--
-- Architectural axiom (memory.md #64): the existing `customers` table is the
-- SINGLE customer-of-record (KYC, Ankauf, cumulative spend). `shoppers` is an
-- overlay 1:1 linked to `customers` that adds online-account credentials +
-- shipping/billing addresses.
--
-- ──────────────────────────────────────────────────────────────────────────
-- Tables introduced
--
--   shoppers              — argon2id pw + encrypted PII (shipping/billing)
--   shopper_sessions      — cookie-backed sessions, separate from staff
--   carts + cart_items    — shopper baskets; ACTIVE/CHECKOUT/ABANDONED/CONVERTED
--   payment_intents       — provider-agnostic intent rows (Stripe/PayPal/Mollie)
--   webhook_events        — idempotency table for every inbound provider hook
--
-- Tables extended
--
--   transactions          — sales_channel + shipping_status + shipping fields
--
-- Enums introduced
--
--   cart_status           — ACTIVE / CHECKOUT / ABANDONED / CONVERTED
--   payment_provider      — STRIPE / PAYPAL / MOLLIE
--   payment_intent_status — CREATED / PENDING / SUCCEEDED / FAILED / CANCELED / EXPIRED
--   sales_channel         — POS / WEB / EBAY / PHONE
--   shipping_status       — NOT_REQUIRED / PENDING / PROCESSING / SHIPPED / DELIVERED / RETURNED
--
-- Bypass-proof discipline (ADR-0008 §10):
--   • Channel + shipping CHECK at the DB level — POS sales NEVER carry shipping;
--     WEB sales ALWAYS do.
--   • One ACTIVE cart per shopper enforced by partial UNIQUE.
--   • Webhook idempotency enforced by UNIQUE (provider, provider_event_id).
--   • Payment-intent uniqueness per provider event enforced by UNIQUE.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Enums
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cart_status') THEN
    CREATE TYPE cart_status AS ENUM ('ACTIVE', 'CHECKOUT', 'ABANDONED', 'CONVERTED');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_provider') THEN
    CREATE TYPE payment_provider AS ENUM ('STRIPE', 'PAYPAL', 'MOLLIE');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_intent_status') THEN
    CREATE TYPE payment_intent_status AS ENUM (
      'CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED'
    );
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_channel') THEN
    CREATE TYPE sales_channel AS ENUM ('POS', 'WEB', 'EBAY', 'PHONE');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipping_status') THEN
    CREATE TYPE shipping_status AS ENUM (
      'NOT_REQUIRED', 'PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'RETURNED'
    );
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. shoppers — B2C online accounts
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shoppers (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  /** 1:1 link — every shopper has a customer row underneath. */
  customer_id              UUID         NOT NULL UNIQUE REFERENCES customers(id),

  -- Credentials
  email_encrypted          BYTEA        NOT NULL,
  email_blind_index        BYTEA        NOT NULL,
  /** Argon2id hash via @warehouse14/auth-pin's hash function. */
  password_hash            TEXT         NOT NULL,

  -- Email verification (best-effort V1; verified-email-required on checkout is Phase 1)
  email_verified_at        TIMESTAMPTZ,
  email_verification_token TEXT,

  phone_encrypted          BYTEA,
  phone_blind_index        BYTEA,

  -- Shipping address (encrypted; nullable until first checkout)
  shipping_recipient_name_encrypted  BYTEA,
  shipping_address_line1_encrypted   BYTEA,
  shipping_address_line2_encrypted   BYTEA,
  shipping_postal_code_encrypted     BYTEA,
  shipping_city_encrypted            BYTEA,
  /** ISO 3166-1 alpha-2 country — NOT PII (no person-identifying value alone). */
  shipping_country                   CHAR(2),

  -- Billing address (NULL means "same as shipping")
  billing_recipient_name_encrypted   BYTEA,
  billing_address_line1_encrypted    BYTEA,
  billing_address_line2_encrypted    BYTEA,
  billing_postal_code_encrypted      BYTEA,
  billing_city_encrypted             BYTEA,
  billing_country                    CHAR(2),

  preferred_language       CHAR(2)      NOT NULL DEFAULT 'de'
                                        CHECK (preferred_language IN ('de', 'en', 'ar')),
  marketing_consent        BOOLEAN      NOT NULL DEFAULT FALSE,
  marketing_consent_at     TIMESTAMPTZ,

  -- Brute-force defense — mirrors POS PIN lockout
  failed_login_attempts    INTEGER      NOT NULL DEFAULT 0
                                        CHECK (failed_login_attempts >= 0),
  locked_until             TIMESTAMPTZ,

  -- GDPR
  soft_deleted_at          TIMESTAMPTZ,
  anonymized_at            TIMESTAMPTZ,

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT shoppers_country_iso2_shipping
    CHECK (shipping_country IS NULL OR shipping_country ~ '^[A-Z]{2}$'),
  CONSTRAINT shoppers_country_iso2_billing
    CHECK (billing_country IS NULL OR billing_country ~ '^[A-Z]{2}$'),
  CONSTRAINT shoppers_anonymized_implies_soft_deleted
    CHECK (anonymized_at IS NULL OR soft_deleted_at IS NOT NULL),
  /** Marketing consent is opt-in; if TRUE we must have a timestamp (GDPR audit trail). */
  CONSTRAINT shoppers_marketing_consent_has_timestamp
    CHECK (marketing_consent = FALSE OR marketing_consent_at IS NOT NULL)
);

/* Active-shopper email is unique; soft-deleted rows don't block re-signup. */
CREATE UNIQUE INDEX IF NOT EXISTS shoppers_email_blind_active_uq
  ON shoppers (email_blind_index)
  WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS shoppers_customer_idx
  ON shoppers (customer_id);

CREATE INDEX IF NOT EXISTS shoppers_locked_idx
  ON shoppers (locked_until)
  WHERE locked_until IS NOT NULL;

CREATE TRIGGER trg_shoppers_updated_at
  BEFORE UPDATE ON shoppers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE shoppers IS
  'B2C online accounts. 1:1 with customers (the canonical KYC + spend row). '
  'NEVER deleted — soft_deleted_at + anonymized_at (mirrors users discipline).';

-- ═════════════════════════════════════════════════════════════════════════
-- 3. shopper_sessions — cookie-backed sessions (separate from staff sessions)
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shopper_sessions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  shopper_id   UUID         NOT NULL REFERENCES shoppers(id),
  token        TEXT         NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ  NOT NULL,
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT shopper_sessions_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS shopper_sessions_shopper_idx
  ON shopper_sessions (shopper_id);

CREATE INDEX IF NOT EXISTS shopper_sessions_expires_idx
  ON shopper_sessions (expires_at);

CREATE TRIGGER trg_shopper_sessions_updated_at
  BEFORE UPDATE ON shopper_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE shopper_sessions IS
  'B2C session table. NOT the same shape/discipline as `sessions` (staff). '
  'Cookie name: warehouse14.shopper_session. TTL: 30 days rolling.';

-- ═════════════════════════════════════════════════════════════════════════
-- 4. carts + cart_items
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS carts (
  id                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  shopper_id                    UUID          NOT NULL REFERENCES shoppers(id),
  status                        cart_status   NOT NULL DEFAULT 'ACTIVE',

  /** UUID passed to inventory-lock.reserve() as session_id for every item. */
  reservation_session_id        UUID          UNIQUE,
  checkout_started_at           TIMESTAMPTZ,
  /** 15 min after checkout_started_at — matches inventory-lock STOREFRONT TTL. */
  checkout_expires_at           TIMESTAMPTZ,

  /** Set when the webhook converts the cart to a transaction. */
  converted_to_transaction_id   UUID          UNIQUE REFERENCES transactions(id),

  created_at                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ   NOT NULL DEFAULT now(),

  /** CHECKOUT must carry reservation evidence. */
  CONSTRAINT carts_checkout_evidence CHECK (
    status <> 'CHECKOUT' OR (
      reservation_session_id IS NOT NULL AND
      checkout_started_at    IS NOT NULL AND
      checkout_expires_at    IS NOT NULL AND
      checkout_expires_at > checkout_started_at
    )
  ),
  CONSTRAINT carts_converted_has_transaction CHECK (
    status <> 'CONVERTED' OR converted_to_transaction_id IS NOT NULL
  )
);

/* At most one ACTIVE cart per shopper — Phase 1.5 may relax for multi-store/multi-device. */
CREATE UNIQUE INDEX IF NOT EXISTS carts_one_active_per_shopper_uq
  ON carts (shopper_id)
  WHERE status = 'ACTIVE';

/* Hot path: list all CHECKOUT carts (the worker / sweeper view). */
CREATE INDEX IF NOT EXISTS carts_checkout_expires_idx
  ON carts (checkout_expires_at)
  WHERE status = 'CHECKOUT';

CREATE TRIGGER trg_carts_updated_at
  BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS cart_items (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id         UUID           NOT NULL REFERENCES carts(id),
  product_id      UUID           NOT NULL REFERENCES products(id),
  /** Snapshot of list_price_eur at the time the item was added. */
  unit_price_eur  NUMERIC(18,2)  NOT NULL CHECK (unit_price_eur >= 0),
  /** Always 1 in V1 (each product row is unique). Future fungible items might bump this. */
  quantity        INTEGER        NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),

  /** A product appears at most once per cart. */
  CONSTRAINT cart_items_one_product_per_cart UNIQUE (cart_id, product_id)
);

CREATE INDEX IF NOT EXISTS cart_items_cart_idx ON cart_items (cart_id);

-- ═════════════════════════════════════════════════════════════════════════
-- 5. payment_intents
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_intents (
  id                  UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  /** A cart has at most one ACTIVE intent at a time. UNIQUE on cart_id. */
  cart_id             UUID                   NOT NULL UNIQUE REFERENCES carts(id),
  provider            payment_provider       NOT NULL,
  /** The provider's own intent id (Stripe pi_*, Mollie tr_*, PayPal order id). */
  provider_intent_id  TEXT                   NOT NULL,
  status              payment_intent_status  NOT NULL DEFAULT 'CREATED',
  amount_eur          NUMERIC(18,2)          NOT NULL CHECK (amount_eur >= 0),

  /** Stripe-style: client_secret returned to the browser for inline payment. */
  client_secret       TEXT,
  /** Mollie / PayPal style: hosted checkout URL to redirect the browser to. */
  redirect_url        TEXT,
  /** Provider-reported outcome details (last 4 PAN, brand, etc.) on SUCCEEDED. */
  outcome             JSONB                  NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT payment_intents_outcome_is_object CHECK (jsonb_typeof(outcome) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_provider_intent_uq
  ON payment_intents (provider, provider_intent_id);

CREATE INDEX IF NOT EXISTS payment_intents_status_idx
  ON payment_intents (status, created_at DESC);

CREATE TRIGGER trg_payment_intents_updated_at
  BEFORE UPDATE ON payment_intents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════
-- 6. webhook_events — idempotency table (closes Phase 1.5 I-3)
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS webhook_events (
  id                  BIGSERIAL    PRIMARY KEY,
  provider            TEXT         NOT NULL,
  /** The provider's event id (Stripe evt_*, Mollie tr_*, etc.). */
  provider_event_id   TEXT         NOT NULL,
  event_type          TEXT         NOT NULL,

  /** Raw body kept for forensics + post-hoc signature re-verification. Capped 64 KiB at app layer. */
  raw_body            TEXT         NOT NULL,
  payload             JSONB        NOT NULL,

  /** TRUE only after we successfully verified the HMAC / signature against the provider's secret. */
  signature_verified  BOOLEAN      NOT NULL,

  /** When the handler actually ran the business logic (idempotent — only first delivery does). */
  processed_at        TIMESTAMPTZ,
  processing_error    TEXT,

  received_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT webhook_events_payload_is_object CHECK (jsonb_typeof(payload) = 'object')
);

/* The dedupe key — first delivery wins; retries from the provider RAISE on this UNIQUE. */
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_event_uq
  ON webhook_events (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS webhook_events_unprocessed_idx
  ON webhook_events (provider, received_at DESC)
  WHERE processed_at IS NULL;

COMMENT ON TABLE webhook_events IS
  'Idempotency + audit trail for every provider webhook. UNIQUE (provider, '
  'provider_event_id) means duplicate deliveries from Stripe/etc. are no-ops. '
  'NEVER DELETE — fiscal/forensic record.';

-- ═════════════════════════════════════════════════════════════════════════
-- 7. transactions — sales_channel + shipping fields
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS sales_channel sales_channel NOT NULL DEFAULT 'POS';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS shipping_status shipping_status NOT NULL DEFAULT 'NOT_REQUIRED';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS shipping_address_encrypted BYTEA;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS shipping_carrier TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS tracking_number TEXT;

/** POS sales NEVER require shipping; WEB sales ALWAYS do.
    EBAY/PHONE are flexible (the operator decides at sale time). */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'transactions_shipping_status_per_channel'
       AND conrelid = 'transactions'::regclass
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_shipping_status_per_channel CHECK (
        (sales_channel = 'POS' AND shipping_status = 'NOT_REQUIRED') OR
        (sales_channel = 'WEB' AND shipping_status <> 'NOT_REQUIRED') OR
        (sales_channel IN ('EBAY', 'PHONE'))
      );
  END IF;
END$$;

/** Hot path: orders awaiting fulfilment (Bridge UX shipping queue). */
CREATE INDEX IF NOT EXISTS transactions_shipping_pending_idx
  ON transactions (finalized_at DESC)
  WHERE sales_channel = 'WEB' AND shipping_status IN ('PENDING', 'PROCESSING');

CREATE INDEX IF NOT EXISTS transactions_sales_channel_day_idx
  ON transactions (sales_channel, berlin_business_day(finalized_at));

COMMENT ON COLUMN transactions.sales_channel IS
  'Where the sale happened. POS = in-shop cashier; WEB = warehouse14.de; '
  'EBAY = eBay listing; PHONE = phone order recorded manually.';
COMMENT ON COLUMN transactions.shipping_status IS
  'Fulfilment state for WEB/EBAY/PHONE orders. POS is always NOT_REQUIRED.';

-- ═════════════════════════════════════════════════════════════════════════
-- 8. Role grants
-- ═════════════════════════════════════════════════════════════════════════

/* Default privileges from migration 0003 gave warehouse14_app SELECT + INSERT
   on these new tables. Add per-column UPDATE for the storefront mutations. */

-- shoppers: account self-service can UPDATE password + email-verification + addresses + lockout.
GRANT UPDATE (
  password_hash,
  email_verified_at,
  email_verification_token,
  phone_encrypted, phone_blind_index,
  shipping_recipient_name_encrypted, shipping_address_line1_encrypted,
  shipping_address_line2_encrypted, shipping_postal_code_encrypted,
  shipping_city_encrypted, shipping_country,
  billing_recipient_name_encrypted, billing_address_line1_encrypted,
  billing_address_line2_encrypted, billing_postal_code_encrypted,
  billing_city_encrypted, billing_country,
  preferred_language, marketing_consent, marketing_consent_at,
  failed_login_attempts, locked_until,
  soft_deleted_at, anonymized_at,
  updated_at
) ON shoppers TO warehouse14_app;

/* shopper_sessions — full lifecycle including DELETE (logout). */
GRANT UPDATE, DELETE ON shopper_sessions TO warehouse14_app;

/* carts — status + checkout fields + conversion link are mutable. */
GRANT UPDATE (
  status, reservation_session_id,
  checkout_started_at, checkout_expires_at,
  converted_to_transaction_id,
  updated_at
) ON carts TO warehouse14_app;

/* cart_items — DELETE for "remove from cart" UX. INSERT via default privileges. */
GRANT DELETE ON cart_items TO warehouse14_app;

/* payment_intents — provider_intent_id, status, secrets, outcome can change. */
GRANT UPDATE (
  provider_intent_id, status,
  client_secret, redirect_url,
  outcome, updated_at
) ON payment_intents TO warehouse14_app;

/* webhook_events — append-then-process pattern: signature_verified + processed_at + error get UPDATEd by the handler. */
GRANT UPDATE (processed_at, processing_error) ON webhook_events TO warehouse14_app;

/* transactions — add the new columns to the existing UPDATE grant (shipping is mutable). */
GRANT UPDATE (
  shipping_status, shipping_carrier, tracking_number
) ON transactions TO warehouse14_app;
/* sales_channel + shipping_address_encrypted are SET AT INSERT ONLY — no UPDATE grant. */

/* Worker role (from migration 0017) — needs to release expired CHECKOUT carts. */
GRANT UPDATE (status, updated_at) ON carts TO warehouse14_worker;
GRANT SELECT ON carts TO warehouse14_worker;
GRANT SELECT ON cart_items TO warehouse14_worker;
GRANT SELECT ON shoppers TO warehouse14_worker;
GRANT SELECT, INSERT, UPDATE ON payment_intents TO warehouse14_worker;
GRANT SELECT ON shopper_sessions TO warehouse14_worker;
GRANT DELETE ON shopper_sessions TO warehouse14_worker;  -- expired-session sweeper

GRANT USAGE ON SEQUENCE webhook_events_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE webhook_events_id_seq TO warehouse14_worker;

COMMIT;
