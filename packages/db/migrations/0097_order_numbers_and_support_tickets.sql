-- ═════════════════════════════════════════════════════════════════════════
-- 0097 — numbers a human can say out loud, and a place for the conversation
--        that follows them.
-- ═════════════════════════════════════════════════════════════════════════
--
-- Two gaps, one root. The shop already mints `CUST-2026-000034` for people,
-- but an ORDER has only ever been a UUID, surfaced as an eight character
-- fragment like `7C1F9A02`. Nobody can read that down a telephone, remember
-- it walking to the shop, or search for it — and the cashier's own search box
-- already advertises "Bestellnr." with nothing behind it. Meanwhile a customer
-- who replies to one of our letters has nowhere to land: mail is outbound
-- only, and there is no record of a question ever having been asked.
--
-- So: give an order a number, give a conversation a number, and give the
-- conversation somewhere to live.
--
--   customers        CUST-2026-000034   (already existed)
--   orders           BST-2026-000001    (new — Bestellung)
--   support tickets  TIC-2026-000001    (new)
--
-- All three share one shape on purpose. A number the customer reads aloud
-- should look like it came from the same house.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1. Order numbers ────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

ALTER TABLE carts ADD COLUMN IF NOT EXISTS order_number text;

-- Nullable, and assigned by trigger rather than by DEFAULT, because a cart is
-- not an order. Twelve of the eighteen carts on production right now are live
-- shopping baskets that may never be reserved; a DEFAULT would burn a number
-- on each one and the first real order of the day would be BST-2026-000013.
-- The number is minted at the moment the basket becomes a commitment.
CREATE OR REPLACE FUNCTION public.assign_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.order_number IS NULL AND NEW.reserved_at IS NOT NULL THEN
    NEW.order_number :=
      'BST-' || to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY')
            || '-' || lpad(nextval('order_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS carts_assign_order_number ON carts;
CREATE TRIGGER carts_assign_order_number
  BEFORE INSERT OR UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION public.assign_order_number();

-- Backfill the orders that already exist, oldest first so the numbering runs
-- in the order the shop actually took them. `reserved_at IS NOT NULL` is the
-- honest test of "this was once a real order": a CANCELLED cart that was never
-- reserved is an abandoned basket and deserves no number.
-- The trigger above is a no-op here: it only fires when order_number IS NULL
-- and this statement sets it, so there is no double assignment.
WITH ordered AS (
  SELECT id,
         reserved_at,
         row_number() OVER (ORDER BY reserved_at, created_at) AS n
    FROM carts
   WHERE reserved_at IS NOT NULL AND order_number IS NULL
)
UPDATE carts c
   SET order_number = 'BST-'
                   || to_char(o.reserved_at AT TIME ZONE 'Europe/Berlin', 'YYYY')
                   || '-' || lpad(o.n::text, 6, '0')
  FROM ordered o
 WHERE c.id = o.id;

-- Move the sequence past whatever the backfill consumed.
SELECT setval('order_number_seq',
              GREATEST(1, (SELECT count(*) FROM carts WHERE order_number IS NOT NULL)),
              true);

CREATE UNIQUE INDEX IF NOT EXISTS carts_order_number_uq
  ON carts (order_number) WHERE order_number IS NOT NULL;

-- ── 2. Support tickets ──────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq;

CREATE TABLE IF NOT EXISTS support_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE
                DEFAULT ('TIC-' || to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY')
                               || '-' || lpad(nextval('ticket_number_seq')::text, 6, '0')),
  -- Nullable: a stranger can write in before they are anyone in our books,
  -- and erasure cuts this link while keeping the ticket countable.
  customer_id   uuid REFERENCES customers(id) ON DELETE SET NULL,
  -- The customer wrote this, so it is personal data and erasure replaces it.
  subject       text NOT NULL,
  status        text NOT NULL DEFAULT 'OFFEN',
  priority      text NOT NULL DEFAULT 'NORMAL',
  channel       text NOT NULL DEFAULT 'EMAIL',
  assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Which Gmail conversation this mirrors, so a reply threads correctly and
  -- the poller can attach a later message to the right ticket.
  gmail_thread_id text,
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  retention_until  timestamptz NOT NULL DEFAULT (now() + interval '3 years'),
  anonymized_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_status_domain
    CHECK (status IN ('OFFEN', 'WARTET', 'GESCHLOSSEN')),
  CONSTRAINT support_tickets_priority_domain
    CHECK (priority IN ('NIEDRIG', 'NORMAL', 'HOCH')),
  CONSTRAINT support_tickets_channel_domain
    CHECK (channel IN ('EMAIL', 'WHATSAPP', 'TELEFON', 'LADEN'))
);

CREATE INDEX IF NOT EXISTS support_tickets_open_idx
  ON support_tickets (last_inbound_at DESC NULLS LAST) WHERE status <> 'GESCHLOSSEN';
CREATE INDEX IF NOT EXISTS support_tickets_customer_idx
  ON support_tickets (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_tickets_gmail_thread_idx
  ON support_tickets (gmail_thread_id) WHERE gmail_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- One table for both directions rather than the two-table shape WhatsApp
  -- uses. A ticket is read as a single conversation and a single ordered
  -- read is what the reader wants.
  direction   text NOT NULL,
  -- Addresses and bodies are the person's own words: encrypted like every
  -- other piece of PII in this schema, decrypted only inside withPii.
  from_encrypted bytea NOT NULL,
  to_encrypted   bytea NOT NULL,
  body_encrypted bytea NOT NULL,
  -- Gmail's id for an inbound message. UNIQUE is the whole dedupe strategy:
  -- the poller may see the same message twice across restarts and the insert
  -- simply loses the race instead of duplicating the conversation.
  gmail_message_id text UNIQUE,
  -- Which member of staff wrote an outbound reply. NULL for inbound.
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_direction_domain
    CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  CONSTRAINT support_messages_inbound_has_gmail_id
    CHECK (direction <> 'INBOUND' OR gmail_message_id IS NOT NULL),
  CONSTRAINT support_messages_outbound_has_author
    CHECK (direction <> 'OUTBOUND' OR author_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS support_messages_ticket_idx
  ON support_messages (ticket_id, created_at);

-- ── 3. Teach erasure about them, NOW, not three migrations later ────────
CREATE OR REPLACE FUNCTION public.erase_customer(p_customer_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$


DECLARE
  v_phone     TEXT;
  v_kyc_keys  TEXT[] := '{}';
  v_r2_keys   TEXT[] := '{}';
BEGIN
  -- The subject must exist.
  PERFORM 1 FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Resolve the subject phone for the phone-keyed WhatsApp sweeps (best-effort;
  -- NULL if no phone on file → those sweeps are skipped).
  SELECT decrypt_pii(phone_encrypted) INTO v_phone FROM customers WHERE id = p_customer_id;

  -- ── Collect file keys BEFORE scrubbing (caller unlinks post-commit) ──────────
  SELECT COALESCE(array_agg(document_photo_storage_key)
           FILTER (WHERE document_photo_storage_key IS NOT NULL), '{}')
    INTO v_kyc_keys FROM kyc_documents WHERE customer_id = p_customer_id;

  SELECT COALESCE(array_agg(r2_key) FILTER (WHERE r2_key IS NOT NULL), '{}')
    INTO v_r2_keys FROM document_attachments WHERE customer_id = p_customer_id;
  v_r2_keys := v_r2_keys || COALESCE((
    SELECT array_agg(k)
      FROM appraisal_items ai
      JOIN appraisals a ON a.id = ai.appraisal_id
      CROSS JOIN LATERAL unnest(ai.photo_r2_keys) AS k
     WHERE a.customer_id = p_customer_id
  ), '{}');

  -- ── Phase 2 — scrub CHILDREN first (so a failure never leaves the master
  --    flagged-anonymized while children still hold PII) ────────────────────────

  -- appointments: registered + walk-in plaintext contact fields + free-text notes
  UPDATE appointments
     SET contact_name = NULL, contact_phone = NULL, contact_email = NULL,
         customer_notes = NULL, staff_notes = NULL, cancellation_reason = NULL
   WHERE customer_id = p_customer_id;

  -- appointment_notifications: recipient is NOT NULL → sentinel, never NULL
  UPDATE appointment_notifications
     SET recipient = 'REDACTED', external_ref = NULL
   WHERE appointment_id IN (SELECT id FROM appointments WHERE customer_id = p_customer_id);

  -- WhatsApp (phone-keyed). NOT NULL / non-empty / object CHECKs → sentinels.
  IF v_phone IS NOT NULL THEN
    UPDATE whatsapp_inbound_messages
       SET body_encrypted = NULL, processing_error = NULL,
           raw_payload = '{}'::jsonb, from_phone = 'REDACTED'
     WHERE from_phone = v_phone;
    UPDATE whatsapp_outbound_messages
       SET body = '–', body_encrypted = NULL, template_params = NULL,
           to_phone = 'REDACTED',
           provider_error = CASE WHEN status = 'failed' THEN '{}'::jsonb ELSE NULL END
     WHERE to_phone = v_phone;
  END IF;
  UPDATE whatsapp_conversations
     SET customer_id = NULL, anonymized_at = now(),
         customer_phone_e164 = 'erased:' || id
   WHERE customer_id = p_customer_id;

  -- appraisals / appraisal_items
  UPDATE appraisals
     SET notes = NULL,
         rejection_reason = CASE WHEN status = 'REJECTED' THEN 'GELOESCHT' ELSE NULL END
   WHERE customer_id = p_customer_id;
  UPDATE appraisal_items
     SET notes = NULL, description = NULL, photo_r2_keys = '{}'
   WHERE appraisal_id IN (SELECT id FROM appraisals WHERE customer_id = p_customer_id);

  -- products acquired from this customer
  UPDATE products
     SET provenance_notes = NULL, acquired_from_customer_id = NULL
   WHERE acquired_from_customer_id = p_customer_id;

  -- vouchers (keep the row — §3(14) UStG — only the free-text note is PII)
  UPDATE vouchers SET notes = NULL WHERE issued_to_customer_id = p_customer_id;

  -- document_attachments: keep customer_id (link CHECKs) + fiscal category; the
  -- file refs are NOT NULL with length CHECKs → sentinel, never NULL.
  UPDATE document_attachments
     SET r2_key = 'erased', file_name = 'erased', sha256_hex = NULL,
         notes = NULL, archived_at = COALESCE(archived_at, now())
   WHERE customer_id = p_customer_id;

  -- kyc_documents purge — ALL-OR-NOTHING per kyc_documents_purged_consistency;
  -- purged_by_user_id is NOT NULL in the purged branch.
  UPDATE kyc_documents
     SET document_number_encrypted = NULL, document_photo_sha256 = NULL,
         document_photo_storage_key = NULL, document_photo_size_bytes = NULL,
         purged_at = now(), purged_by_user_id = p_actor
   WHERE customer_id = p_customer_id AND purged_at IS NULL;

  -- transactions: keep the fiscal row; NULL only the embedded PII. NEVER NULL
  -- customer_id (the storno-validator trigger matches on it).
  UPDATE transactions
     SET shipping_address_encrypted = NULL, notes_internal = NULL
   WHERE customer_id = p_customer_id;

  -- internal_tasks pointing at the customer (clear the pointer as a PAIR)
  UPDATE internal_tasks
     SET related_entity_table = NULL, related_entity_id = NULL,
         title = 'Gelöscht', description = NULL,
         cancellation_reason = CASE WHEN status = 'CANCELLED'
                                    THEN COALESCE(cancellation_reason, 'gelöscht') ELSE NULL END
   WHERE related_entity_table = 'customers' AND related_entity_id = p_customer_id;

  -- mcp_tool_invocations referencing the subject
  UPDATE mcp_tool_invocations
     SET arguments = '{}'::jsonb, error_message = NULL,
         result = CASE WHEN outcome = 'SUCCESS' THEN '{}'::jsonb ELSE NULL END
   WHERE affected_entity_table IN ('customers', 'shoppers') AND affected_entity_id = p_customer_id;

  -- ── The transactional mail queue ────────────────────────────────────────
  -- ADDED 0096, and it had misfired in production before it was found.
  -- email_outbox stores the recipient address encrypted, and the rendered
  -- subject and body carry the person's name and reservation number in clear
  -- text. Erasure never touched this table, so two things were true at once:
  -- an erased customer's address and name survived here in full, and any
  -- letter still PENDING was delivered to them AFTER they had exercised
  -- Art. 17. The second one actually happened on 2026-07-22, when the Google
  -- relay was switched on and a two-day backlog flushed, including letters
  -- belonging to an account erased the night before.
  --
  -- The table could not even be swept before now: it carried no customer_id.
  -- This migration adds one, which is what makes the block below possible.
  --
  -- PENDING letters are dropped outright — there is no lawful basis for
  -- writing to someone who has asked to be forgotten. SENT and FAILED rows
  -- keep their skeleton so the delivery log stays auditable, with every
  -- personal field overwritten and the link to the person cut.
  DELETE FROM email_outbox
   WHERE customer_id = p_customer_id AND status = 'PENDING';

  UPDATE email_outbox
     SET recipient_encrypted = encrypt_pii('GELOESCHT'),
         subject     = 'Geloescht',
         body_text   = '-',
         body_html   = NULL,
         last_error  = NULL,
         customer_id = NULL
   WHERE customer_id = p_customer_id;


  -- ── Support tickets and their messages ──────────────────────────────────
  -- ADDED 0097 IN THE SAME MIGRATION THAT CREATES THESE TABLES. That is the
  -- whole point: 0094 found `shoppers` unswept and 0096 found `email_outbox`
  -- unswept, both discovered long after the fact and both the same mistake.
  -- A table that stores a person's words is not finished until erasure knows
  -- about it.
  --
  -- Messages carry the customer's own sentences, their address, and whatever
  -- they chose to tell us, so the bodies go entirely. The ticket keeps its
  -- number and status so the support history stays countable, with the
  -- subject line (customer written, therefore personal) replaced and the
  -- link to the person cut.
  DELETE FROM support_messages
   WHERE ticket_id IN (SELECT id FROM support_tickets WHERE customer_id = p_customer_id);

  UPDATE support_tickets
     SET subject       = 'Geloescht',
         gmail_thread_id = NULL,
         customer_id   = NULL,
         anonymized_at = now(),
         updated_at    = now()
   WHERE customer_id = p_customer_id;
  -- ── Phase 3 — the customers MASTER last, one UPDATE satisfying all CHECKs ─────
  --  • full_name_encrypted is NOT NULL → encrypted tombstone, never NULL.
  --  • trust_level reset to NEW so customers_banned_or_suspicious_has_note holds
  --    once price_expectation_notes is NULLed.
  --  • soft_deleted_at THEN anonymized_at (ordering CHECKs; equal ts satisfies >=).
  --  • customer_number + cumulative_* (trigger-only) are kept untouched.
  -- ── The storefront login row ────────────────────────────────────────────
  -- ADDED 0094. This block did not exist, and its absence was the whole hole:
  -- erasure scrubbed fourteen tables and left `shoppers` untouched, so an
  -- "erased" customer kept their e-mail, phone, shipping address, password
  -- hash and Google subject id in full. The schema had clearly intended
  -- otherwise: shoppers.anonymized_at and the CHECK that pairs it with
  -- soft_deleted_at were already there, waiting for a writer that never came.
  --
  -- email_encrypted and email_blind_index are NOT NULL, so they take a
  -- tombstone rather than NULL. That is safe against the unique index because
  -- shoppers_email_blind_active_uq is PARTIAL (WHERE soft_deleted_at IS NULL),
  -- so every erased row drops out of it.
  --
  -- Both credentials are cleared, which would violate shoppers_has_credential
  -- on its own; is_guest = TRUE satisfies it and is the honest description of
  -- what the row now is. Clearing google_sub also matters on its own: leaving
  -- it would let the same Google account sign back in and land on the erased
  -- record.
  UPDATE shoppers
     SET email_encrypted    = encrypt_pii('GELOESCHT'),
         email_blind_index  = blind_index('geloescht'),
         phone_encrypted    = NULL,
         phone_blind_index  = NULL,
         given_name_encrypted  = NULL,
         family_name_encrypted = NULL,
         picture_url_encrypted = NULL,
         shipping_recipient_name_encrypted = NULL,
         shipping_address_line1_encrypted  = NULL,
         shipping_address_line2_encrypted  = NULL,
         shipping_postal_code_encrypted    = NULL,
         shipping_city_encrypted           = NULL,
         shipping_country                  = NULL,
         billing_recipient_name_encrypted  = NULL,
         billing_address_line1_encrypted   = NULL,
         billing_address_line2_encrypted   = NULL,
         billing_postal_code_encrypted     = NULL,
         billing_city_encrypted            = NULL,
         billing_country                   = NULL,
         password_hash             = NULL,
         google_sub                = NULL,
         email_verification_token  = NULL,
         email_verified_at         = NULL,
         marketing_consent         = FALSE,
         is_guest                  = TRUE,
         last_seen_at              = NULL,
         soft_deleted_at = COALESCE(soft_deleted_at, now()),
         anonymized_at   = now(),
         updated_at      = now()
   WHERE customer_id = p_customer_id;

  -- Any session still open dies with the identity. shopper_sessions has no
  -- revoked_at: that column belongs to the STAFF sessions table (0089), not
  -- this one. A shopper session is a bearer token and nothing else, so the
  -- row is simply deleted, which is stronger than expiring it anyway.
  DELETE FROM shopper_sessions ss
   USING shoppers s
   WHERE s.customer_id = p_customer_id
     AND ss.shopper_id = s.id;

  UPDATE customers
     SET full_name_encrypted   = encrypt_pii('GELOESCHT'),
         date_of_birth_encrypted = NULL, email_encrypted = NULL, phone_encrypted = NULL,
         address_encrypted = NULL, notes_encrypted = NULL,
         email_blind_index = NULL, phone_blind_index = NULL,
         vat_id = NULL, customer_tags = '{}', price_expectation_notes = NULL,
         trust_level = 'NEW',
         soft_deleted_at = COALESCE(soft_deleted_at, now()),
         anonymized_at = now()
   WHERE id = p_customer_id;

  RETURN jsonb_build_object(
    'kyc_storage_keys', to_jsonb(v_kyc_keys),
    'r2_keys',          to_jsonb(v_r2_keys)
  );
END;


$function$;

-- ── 4. Ownership and least privilege ────────────────────────────────────
-- Learned the hard way while testing this very migration: created as the
-- superuser, the tables landed owned by `warehouse14` with no grants at all,
-- and erase_customer() (SECURITY DEFINER, owned by warehouse14_migrator)
-- failed with "permission denied for table support_messages". The app and the
-- worker would have been just as locked out. Every table in this schema is
-- owned by the migrator and granted explicitly; these must match.
ALTER TABLE support_tickets  OWNER TO warehouse14_migrator;
ALTER TABLE support_messages OWNER TO warehouse14_migrator;
ALTER SEQUENCE order_number_seq  OWNER TO warehouse14_migrator;
ALTER SEQUENCE ticket_number_seq OWNER TO warehouse14_migrator;

-- A ticket changes state (status, assignment, last activity), so both writers
-- need UPDATE. A message is append only by design, so nobody gets UPDATE or
-- DELETE on it: the conversation is evidence and must not be quietly edited.
-- Erasure still reaches it, because that runs as the owner.
GRANT SELECT, INSERT, UPDATE ON support_tickets  TO warehouse14_app, warehouse14_worker;
GRANT SELECT, INSERT         ON support_messages TO warehouse14_app, warehouse14_worker;

-- The order number trigger runs as the INVOKING role, not as the owner, so
-- whoever reserves a cart must be able to draw from the sequence.
GRANT USAGE ON SEQUENCE order_number_seq  TO warehouse14_app, warehouse14_worker;
GRANT USAGE ON SEQUENCE ticket_number_seq TO warehouse14_app, warehouse14_worker;
