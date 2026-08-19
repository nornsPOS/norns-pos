-- ═══════════════════════════════════════════════════════════════════════════
--  0149 — Das Kanalerbe des Webshops zieht aus (19.08.2026, Basels Anweisung)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Norns POS ist NUR die schlanke Kasse (Dekret vom 14.08.2026). Diese neun
-- Tabellen und eine Spalte gehörten den ausgebauten Webshop-Kanälen: der
-- Bildannahme-Strecke (Fotos per Nachricht, automatische Entwürfe), den
-- Nachrichtenkanälen selbst und dem Protokoll eines Fernwerkzeug-Endpunkts,
-- dessen Oberfläche längst ausgebaut war. GEMESSEN vor dem Auszug: kein
-- einziger Weg der Kasse liest oder schreibt eine davon — der letzte Leser
-- (zwei Zähler im Übersichts-Schnappschuss) wurde am selben Tag ehrlich
-- entfernt, denn er zählte für immer null.
--
-- Der Auszug ist vollständig dokumentiert in
-- docs/AUSGEZOGEN-NICHTS-IST-VERLOREN.md; die Git-Geschichte trägt jede
-- Zeile. IF EXISTS überall: eine frische Kasse, deren Grundriss diese
-- Tabellen nie enthielt, läuft hier wirkungslos durch.
--
-- ⚠️ KEINE Fiskaldaten berührt: transactions, tse_*, daily_closings,
-- audit_log und ledger_events bleiben unangetastet. Die ausziehenden
-- Tabellen tragen keine Belege und keine Kassenbewegungen.

-- ── 1. Die Tabellen der ausgebauten Kanäle ─────────────────────────────────
DROP TABLE IF EXISTS ai_calls CASCADE;
DROP TABLE IF EXISTS intake_messages CASCADE;
DROP TABLE IF EXISTS intake_drafts CASCADE;
DROP TABLE IF EXISTS intake_sessions CASCADE;
DROP TABLE IF EXISTS staff_phone_numbers CASCADE;
DROP TABLE IF EXISTS mcp_tool_invocations CASCADE;
DROP TABLE IF EXISTS whatsapp_outbound_messages CASCADE;
DROP TABLE IF EXISTS whatsapp_inbound_messages CASCADE;
DROP TABLE IF EXISTS whatsapp_conversations CASCADE;

-- Die verwaisten Aufzähltypen der ausgezogenen Tabellen.
DROP TYPE IF EXISTS intake_status;
DROP TYPE IF EXISTS mcp_invocation_outcome;

-- ── 2. Die Ähnlichkeits-Spalte der Kanal-Suche ─────────────────────────────
-- Nie von einem Weg dieser Kasse gefüllt oder gelesen; ihr Index fällt mit.
ALTER TABLE products DROP COLUMN IF EXISTS embedding;

-- Zwei Erkennungs-Spalten der Ausweisaufnahme, gesät in 0007 für eine
-- automatische Bilderkennung, die nie gebaut wurde: kein Weg liest oder
-- schreibt sie (die Ausweisdaten liest der Rumpf lokal aus der MRZ).
ALTER TABLE kyc_documents DROP COLUMN IF EXISTS ai_ocr_confidence;
ALTER TABLE kyc_documents DROP COLUMN IF EXISTS ai_ocr_used;

-- ── 2b. Die Saat-Schlüssel der ausgebauten Kanäle ──────────────────────────
-- Drei Budget-Regler und ein Gruppierungsfenster, gesät in 0011 für die
-- Bildannahme-Strecke. Ihre Regler-Definitionen sind aus der Einstellungs-
-- Route entfernt; die Zeilen selbst ziehen hier aus.
DELETE FROM system_settings
 WHERE key IN ('ai_budget.daily_eur.total',
               'ai_budget.alert_threshold_pct',
               'ai_budget.hard_stop_threshold_pct',
               'intake.grouping_window_seconds');

-- ── 3. Die Löschung kennt die ausgezogenen Tabellen nicht mehr ─────────────
-- erase_customer() fegte bisher auch die Kanal-Nachrichten und das
-- Fernwerkzeug-Protokoll. Diese Kehrblöcke griffen nach dem Auszug ins
-- Leere und hätten JEDE Löschung scheitern lassen (relation does not exist).
-- Die Funktion wird deshalb VOLLSTÄNDIG neu gesetzt — Wortlaut identisch mit
-- dem Stand nach 0148, nur ohne die Blöcke der ausgezogenen Tabellen und
-- ohne die nur dafür aufgelöste Telefonnummer.
CREATE OR REPLACE FUNCTION public.erase_customer(p_customer_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kyc_keys  TEXT[] := '{}';
  v_r2_keys   TEXT[] := '{}';
BEGIN
  -- The subject must exist.
  PERFORM 1 FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = 'no_data_found';
  END IF;

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

  -- 19.08.2026 (0149): hier fegte die Funktion die Nachrichtenkanäle des
  -- Webshops und das Fernwerkzeug-Protokoll. Die Tabellen sind ausgezogen;
  -- die Blöcke gingen mit, samt der nur dafür aufgelösten Telefonnummer.

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
     SET full_name_encrypted   = encrypt_pii('GELOESCHT'), name_such_tokens = NULL,
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
