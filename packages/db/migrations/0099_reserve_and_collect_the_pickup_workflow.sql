-- 0099 — Reservieren und Abholen: der Abhol-Arbeitsablauf, den es nie gab
--
-- Drei unabhängige Prüfungen (Kundenshop, Server, Personal-Apps) stießen auf
-- dieselbe Lücke: eine Web-Reservierung konnte am Tresen weder angenommen noch
-- vorbereitet noch als abholbereit gemeldet noch übergeben werden. Es gab
-- keinen Zustand dafür und keine Route. Diese Migration legt den Zustand an;
-- die Routen folgen in derselben Auslieferung.
--
-- ENTWURFSENTSCHEIDUNG. Der Arbeitsablauf bekommt eine EIGENE Spalte
-- "pickup_stage", nicht neue Werte in "fulfilment_status". Damit bleibt die
-- CHECK aus 0098 unangetastet gueltig (fuer eine Abholung ist ein
-- Versand-Status wirklich NOT_REQUIRED), und kein einziger der vielen
-- "cart_status"-Filter im Code muss angefasst werden. "cart_status" bleibt der
-- Lebenslauf der Bestellung (RESERVED bis CONVERTED), "pickup_stage" traegt
-- die Vorbereitung.
--
-- Die Werte sind deutsch wie die Fachsprache dieses Hauses (vgl. ebay_state
-- BEENDET). Die Reihenfolge:
--   OFFEN -> ANGENOMMEN -> IN_VORBEREITUNG -> ABHOLBEREIT -> ABGEHOLT
-- Die gueltigen Uebergaenge bewacht die Route; die Datenbank sichert nur, dass
-- ein Versandauftrag NIE eine Abholstufe traegt.

-- == 1. Der Abhol-Arbeitsablauf als eigener Aufzaehlungstyp ===================
DO $mig$ BEGIN
  CREATE TYPE pickup_stage AS ENUM
    ('OFFEN', 'ANGENOMMEN', 'IN_VORBEREITUNG', 'ABHOLBEREIT', 'ABGEHOLT');
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

ALTER TABLE carts
  ADD COLUMN IF NOT EXISTS pickup_stage           pickup_stage,
  ADD COLUMN IF NOT EXISTS approved_at            timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_user_id    uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS preparation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at               timestamptz,
  ADD COLUMN IF NOT EXISTS collected_at           timestamptz,
  ADD COLUMN IF NOT EXISTS collected_by_user_id   uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS anonymized_at          timestamptz;

-- Eine Versandbestellung traegt NIE eine Abholstufe. Eine Abholung darf eine
-- tragen, muss aber nicht (ein Warenkorb im Aufbau hat noch keine). Genau das
-- sichert diese CHECK, und mehr nicht: die Reihenfolge bewacht die Route.
DO $mig$ BEGIN
  ALTER TABLE carts ADD CONSTRAINT carts_pickup_stage_only_for_pickup
    CHECK (pickup_stage IS NULL OR fulfilment_method = 'PICKUP');
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

-- Bestehende offene Reservierungen stehen ab jetzt am Anfang des Ablaufs.
-- Nur die noch laufenden (RESERVED); erledigte oder verfallene ruehrt es nicht
-- an, damit ihre Geschichte bleibt, wie sie war.
UPDATE carts
   SET pickup_stage = 'OFFEN'
 WHERE status = 'RESERVED' AND fulfilment_method = 'PICKUP' AND pickup_stage IS NULL;

-- Die Loeschung darf die Versandadresse auch bei einer noch nicht stornierten
-- Versandbestellung entfernen. Die CHECK aus 0098 verlangte fuer eine aktive
-- Versandbestellung eine Adresse; eine ANONYMISIERTE Bestellung ist davon
-- ausgenommen, denn sie hat bewusst keine mehr. Ohne diese Ausnahme haette
-- eine Personal-Loeschung (die anders als die Kunden-Loeschung die Warenkoerbe
-- nicht vorher storniert) an genau dieser CHECK abgebrochen. Die Trockenprobe
-- auf einer Prod-Kopie hat das gefunden, bevor es die Produktion je sah.
ALTER TABLE carts DROP CONSTRAINT IF EXISTS carts_shipping_needs_destination;
ALTER TABLE carts ADD CONSTRAINT carts_shipping_needs_destination
  CHECK (
    fulfilment_method <> 'SHIPPING'
    OR status IN ('ACTIVE', 'ABANDONED', 'CANCELLED')
    OR anonymized_at IS NOT NULL
    OR (shipping_address_encrypted IS NOT NULL AND shipping_country IS NOT NULL)
  );

-- Die Warteschlange am Tresen liest genau diese Zeilen.
CREATE INDEX IF NOT EXISTS carts_pickup_queue_idx
  ON carts (pickup_stage, reserved_at)
  WHERE status = 'RESERVED' AND fulfilment_method = 'PICKUP';

-- == 2. erase_customer erreicht jetzt auch carts =============================
-- Unveraendert aus 0097 uebernommen, ERGAENZT um den carts-Block. Siehe die
-- Begruendung im Rumpf. Der Selbsttest in tests/ bricht, falls je wieder eine
-- Tabelle mit PII unbeachtet bleibt.

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
  -- ── The reservation carts ────────────────────────────────────────────────
  -- ADDED 0099, and it is the SAME mistake a third time: 0094 found `shoppers`
  -- unswept, 0096 found `email_outbox` unswept, and on 2026-07-22 migration
  -- 0098 added `carts.shipping_address_encrypted` without teaching erasure
  -- about it. A cart is reached through its shopper, and a shipping order
  -- carries the delivery address in clear-once-decrypted form. The fiscal life
  -- of a paid order lives on `transactions`, not here, so a cart's PII may go
  -- entirely: the encrypted address is nulled, and the pickup order number is
  -- kept only where it is already anonymous.
  UPDATE carts
     SET shipping_address_encrypted = NULL,
         anonymized_at = COALESCE(anonymized_at, now())
   WHERE shopper_id IN (SELECT id FROM shoppers WHERE customer_id = p_customer_id);

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

-- == 3. Eigentum und geringste Rechte ========================================
ALTER FUNCTION public.erase_customer(uuid, uuid) OWNER TO warehouse14_migrator;
