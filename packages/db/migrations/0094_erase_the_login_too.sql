-- ═════════════════════════════════════════════════════════════════════════
-- 0094 — erasure must also erase the login, not just the customer file.
-- ═════════════════════════════════════════════════════════════════════════
--
-- FOUND 2026-07-21 while wiring the customer's own Art. 17 button. The
-- erase_customer() function scrubs personal data across fourteen tables and
-- keeps the fiscal skeleton, which is correct. It never touched `shoppers`.
--
-- So a customer who exercised their right to erasure had their customer file
-- anonymised while their STOREFRONT LOGIN kept, in recoverable form: e-mail,
-- phone, both addresses, password hash, and the Google subject id that would
-- have let the same Google account sign straight back into the erased record.
-- Staff have been able to trigger this since 0078; it was never right.
--
-- The tell that this was an oversight and not a decision: shoppers already had
-- an `anonymized_at` column and a CHECK tying it to `soft_deleted_at`. The
-- schema was built for this block. The block was simply never written.
--
-- This migration replaces the function with the identical body plus that block.
-- Nothing else about erasure changes: the fiscal and GoBD records are still
-- kept with their embedded personal data removed, because § 147 AO and
-- § 257 HGB override Art. 17 via Art. 17(3)(b).
-- ═════════════════════════════════════════════════════════════════════════

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

  -- Any session still open dies with the identity.
  UPDATE shopper_sessions ss
     SET revoked_at = now()
    FROM shoppers s
   WHERE s.customer_id = p_customer_id
     AND ss.shopper_id = s.id
     AND ss.revoked_at IS NULL;

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
