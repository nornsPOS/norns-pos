-- 0078_customer_erasure.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- GDPR Art. 17 (Recht auf Löschung) — on-demand erasure of ONE dealer customer.
--
-- Model: ANONYMIZE-IN-PLACE, never row-delete. The customers row survives as a
-- shell (customer_number kept for fiscal-join integrity); all PII *content* is
-- scrubbed; fiscal/GoBD/GwG rows (transactions, tse_*, ledger, kyc_documents as
-- evidence shells) are kept with embedded PII NULLed. §147 AO / §257 HGB / GoBD
-- 10-year retention overrides Art.17 (Art.17(3)(b) — legal obligation).
--
-- Why a SECURITY DEFINER function: the app role (warehouse14_app) is deliberately
-- barred from writing most of these columns. The function runs as its OWNER
-- (warehouse14_migrator) so it can write them, while the transaction-scoped PII
-- key GUC the caller sets via withPii() still feeds encrypt_pii()/decrypt_pii().
-- Returns the object-store / disk keys the CALLER must unlink AFTER commit
-- (the DB only references them by key).
--
-- Tracked + applied by migrate.sh (ON_ERROR_STOP). Idempotent: re-running on an
-- already-anonymized customer is harmless (kyc purge guarded; stamps re-set).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION erase_customer(p_customer_id UUID, p_actor UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $erase$
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
$erase$;

COMMENT ON FUNCTION erase_customer(UUID, UUID) IS
  'GDPR Art.17 anonymize-in-place erasure of one customer. SECURITY DEFINER (owner '
  'warehouse14_migrator) to write app-barred PII columns; PII key GUC from the '
  'caller withPii() tx feeds encrypt_pii(). Returns {kyc_storage_keys, r2_keys} for '
  'the caller to unlink post-commit. Fiscal/GoBD/GwG rows kept, embedded PII NULLed.';

REVOKE ALL ON FUNCTION erase_customer(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_customer(UUID, UUID) TO warehouse14_app;
