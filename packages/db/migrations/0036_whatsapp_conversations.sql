-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0036 — Epic E: WhatsApp conversations, Kostenbuch der Annahmestrecke, encrypted
-- message bodies.
--
--   • whatsapp_conversations — one row per phone: Automatik an/aus + human-takeover
--     cooldown + GDPR retention (5 years).
--   • ai_calls — one row per Textentwurf-Aufruf for cost tracking + per-conversation
--     daily budget enforcement (ADR-0010 §3).
--   • body_encrypted (bytea) on both message tables — pgcrypto-encrypted bodies
--     at rest (written via encrypt_pii inside app.withPii). The plaintext `body`
--     stays for now; dropping it is a separate post-backfill migration.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone_e164 TEXT NOT NULL UNIQUE,
  customer_id         UUID REFERENCES customers(id),
  ai_active           BOOLEAN NOT NULL DEFAULT TRUE,
  cooldown_until      TIMESTAMPTZ,
  last_inbound_at     TIMESTAMPTZ,
  -- GDPR: default 5-year retention; anonymized_at stamped on an erase request.
  retention_until     TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 years'),
  anonymized_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_conversations_cooldown_idx
  ON whatsapp_conversations (ai_active, cooldown_until);

DROP TRIGGER IF EXISTS trg_whatsapp_conversations_updated_at ON whatsapp_conversations;
CREATE TRIGGER trg_whatsapp_conversations_updated_at
  BEFORE UPDATE ON whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Encrypted bodies at rest.
ALTER TABLE whatsapp_inbound_messages  ADD COLUMN IF NOT EXISTS body_encrypted BYTEA;
ALTER TABLE whatsapp_outbound_messages ADD COLUMN IF NOT EXISTS body_encrypted BYTEA;

-- Kostenbuch der Annahmestrecke.
CREATE TABLE IF NOT EXISTS ai_calls (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID REFERENCES whatsapp_conversations(id),
  kind            TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_eur        NUMERIC(10,6) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_calls_kind_check CHECK (kind IN ('classify', 'compose', 'tool'))
);

CREATE INDEX IF NOT EXISTS ai_calls_conversation_day_idx
  ON ai_calls (conversation_id, created_at DESC);

-- App role: SELECT + INSERT come from migration 0003 default privileges; add
-- the narrow UPDATE columns the bot/cooldown paths need.
GRANT UPDATE (ai_active, cooldown_until, last_inbound_at, customer_id, anonymized_at, updated_at)
  ON whatsapp_conversations TO warehouse14_app;
GRANT USAGE ON SEQUENCE ai_calls_id_seq TO warehouse14_app;
GRANT UPDATE (body_encrypted) ON whatsapp_inbound_messages  TO warehouse14_app;
GRANT UPDATE (body_encrypted) ON whatsapp_outbound_messages TO warehouse14_app;

COMMIT;
