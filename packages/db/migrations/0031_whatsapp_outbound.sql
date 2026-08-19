-- Migration 0031 — WhatsApp Outbound + Inbound Triage (Phase 2 Day 9)
--
-- WHY
-- ───
-- Day 21 / migration 0019 shipped only the INBOUND receiver
-- (`whatsapp_inbound_messages`) — Meta delivers, we ack, the row sits.
-- The operator had no way to (a) see the conversation, (b) send a reply,
-- or (c) close the loop on a handled message. This migration adds the
-- two missing axes:
--
--   1. OUTBOUND log    — every reply we send (or would have sent in
--                        dev) is one append-only row. Status mirrors
--                        the Meta Cloud API delivery lifecycle.
--   2. INBOUND triage  — the operator marks each inbound as "done" and
--                        optionally attaches it to a known customer.
--                        Both stamps are tracked for audit (who/when).
--
-- WHAT
-- ────
--   (A) New table `whatsapp_outbound_messages` — provider-mirroring log
--       with `status` enum (TEXT + CHECK to stay portable / migratable),
--       template fields (nullable; templates land later), and a JSONB
--       `provider_error` blob populated on Meta-side rejection. Indexed
--       `(to_phone, sent_at DESC)` for thread reads.
--
--   (B) ALTER `whatsapp_inbound_messages` ADD three triage columns:
--       handled_at / handled_by_user_id / linked_customer_id. Nullable
--       so existing rows stay valid.
--
--   (C) Role grants:
--       - app role: SELECT + INSERT on the new table; column-level UPDATE
--         on the new inbound triage columns only (NOT on the receiver
--         columns that the webhook owns).
--
-- WHAT THIS TABLE IS NOT
-- ──────────────────────
-- Not a queue (no retry-after column). A failed send is a row with
-- status=failed; the operator decides whether to resend manually. Phase
-- 1.5 can lift this into the worker if Meta's webhook delivery acks land
-- async.
--
-- DURATION
-- ────────
-- CREATE TABLE + 3 ALTER ADD COLUMN (all NULL-default = metadata-only).
-- < 100 ms on the salon DB.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- (A) Outbound log
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS whatsapp_outbound_messages (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

  -- E.164 phone of the recipient. We do not encrypt because Meta sees
  -- the same number — it's not novel PII from our side.
  to_phone              TEXT            NOT NULL,
  body                  TEXT            NOT NULL,

  -- WhatsApp template metadata (nullable; freeform-text sends leave both NULL).
  template_name         TEXT,
  template_params       JSONB,

  -- Mirror of the Meta delivery lifecycle. `queued` covers the dev-mode
  -- "would have been sent but env not configured" case too.
  status                TEXT            NOT NULL
                                        CHECK (status IN ('queued','sent','delivered','read','failed')),

  -- Meta's message id returned by POST /messages — used to correlate
  -- delivery-status webhooks in a future iteration.
  provider_message_id   TEXT,

  -- Raw Meta error envelope on failure (JSON: code + title + details).
  -- Never surfaced verbatim to the client (the route translates).
  provider_error        JSONB,

  sent_by_user_id       UUID            REFERENCES users(id),
  sent_at               TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- Template fields must be both-or-none (a name with no params is a
  -- valid template — params can be NULL). Just enforce body-non-empty.
  CONSTRAINT whatsapp_outbound_body_nonempty CHECK (length(body) > 0),
  -- Failed sends must carry an error blob; success states must not.
  CONSTRAINT whatsapp_outbound_error_status_check CHECK (
    (status = 'failed' AND provider_error IS NOT NULL)
    OR
    (status <> 'failed')
  )
);

COMMENT ON TABLE whatsapp_outbound_messages IS
  'Phase 2 Day 9 — append-only log of every WhatsApp reply the operator '
  'sent (or staged in dev). Mirrors Meta Cloud API delivery lifecycle.';

COMMENT ON COLUMN whatsapp_outbound_messages.status IS
  'queued = staged but Meta env not configured; sent = POST accepted; '
  'delivered / read = future delivery-status webhook updates; '
  'failed = Meta rejected (provider_error populated).';

CREATE INDEX IF NOT EXISTS whatsapp_outbound_thread_idx
  ON whatsapp_outbound_messages (to_phone, sent_at DESC);

COMMENT ON INDEX whatsapp_outbound_thread_idx IS
  'Phase 2 Day 9 — covers the per-thread timeline read '
  '(GET /api/whatsapp/threads/:phone). Newest first.';

-- ════════════════════════════════════════════════════════════════════════
-- (B) Inbound triage columns
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE whatsapp_inbound_messages
  ADD COLUMN IF NOT EXISTS handled_at         TIMESTAMPTZ;

ALTER TABLE whatsapp_inbound_messages
  ADD COLUMN IF NOT EXISTS handled_by_user_id UUID REFERENCES users(id);

ALTER TABLE whatsapp_inbound_messages
  ADD COLUMN IF NOT EXISTS linked_customer_id UUID REFERENCES customers(id);

COMMENT ON COLUMN whatsapp_inbound_messages.handled_at IS
  'Phase 2 Day 9 — set when the operator marks this message as triaged. '
  'NULL means it still appears in the unread count.';

COMMENT ON COLUMN whatsapp_inbound_messages.handled_by_user_id IS
  'Phase 2 Day 9 — actor who marked the message as handled.';

COMMENT ON COLUMN whatsapp_inbound_messages.linked_customer_id IS
  'Phase 2 Day 9 — operator-attached customer link. Allows the WhatsApp '
  'thread to surface a customer name instead of a raw phone number.';

-- Unread-count read pattern: WHERE handled_at IS NULL.
CREATE INDEX IF NOT EXISTS whatsapp_inbound_unhandled_idx
  ON whatsapp_inbound_messages (from_phone, received_at DESC)
  WHERE handled_at IS NULL;

COMMENT ON INDEX whatsapp_inbound_unhandled_idx IS
  'Phase 2 Day 9 — partial index for unhandled-message counts per thread.';

-- ════════════════════════════════════════════════════════════════════════
-- (C) Role grants — least-privilege for warehouse14_app
-- ════════════════════════════════════════════════════════════════════════

-- Outbound: SELECT + INSERT only. The webhook delivery-status updater
-- (future) would need column-level UPDATE on status/provider_message_id;
-- intentionally NOT granted today.
GRANT SELECT, INSERT ON whatsapp_outbound_messages TO warehouse14_app;

-- Inbound: SELECT was already granted by 0019. Add UPDATE on the new
-- triage columns ONLY — the webhook-owned columns (signature_verified,
-- raw_payload, processed_at, etc.) remain off-limits.
GRANT UPDATE (handled_at, handled_by_user_id, linked_customer_id)
  ON whatsapp_inbound_messages TO warehouse14_app;

COMMIT;
