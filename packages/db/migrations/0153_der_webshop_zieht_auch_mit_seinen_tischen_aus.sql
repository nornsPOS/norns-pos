-- ════════════════════════════════════════════════════════════════════════
--  0153 — Der Webshop zieht auch mit seinen Tischen aus
-- ════════════════════════════════════════════════════════════════════════
--
--  ── BASELS ANWEISUNG VOM 22.08.2026 ─────────────────────────────────────
--
--  Woertlich, auf die Frage nach den fuenf Tabellen ohne einen einzigen
--  Aufrufer: „اقتلعها وتخلص منها. نبي قاعدة بيانات نظيفة وخفيفة تركز 100%
--  على الكاشير بس." — herausreissen und weg damit; eine saubere, leichte
--  Datenbank, die sich zu hundert Prozent auf die Kasse beschraenkt.
--
--  Das ist dieselbe Linie wie sein Dekret vom 14.08.: Norns POS ist NUR die
--  schlanke Kasse. Ein Tisch, den niemand deckt, ist kein Vorrat — er ist
--  eine Stelle, an der eine kuenftige Wanderung stolpert, eine Sicherung
--  laenger braucht und ein Pruefer fragt, wozu das da ist.
--
--  ── WAS GEMESSEN WURDE, BEVOR ETWAS FIEL ────────────────────────────────
--
--  Nicht „scheint ungenutzt", sondern gezaehlt, ueber `apps/api-cloud/src`,
--  `apps/tauri-pos/src` und alle Pakete:
--
--      cart_items        0 Aufrufer
--      shipping_zones    0 Aufrufer
--      shipping_rates    0 Aufrufer
--      shipments         0 Aufrufer
--      support_tickets   0 Aufrufer  (nur `erase_customer` nennt sie)
--      support_messages  0 Aufrufer  (nur `erase_customer` nennt sie)
--
--  ⚠️ UND WAS AUSDRUECKLICH BLEIBT: `carts` und `shoppers`. `carts` ist
--  LEBENDIG — `transactions-finalize.ts:1061` schreibt darauf,
--  `products-detail.ts:275` liest daraus, und `autoReleaseExpired.ts:84`
--  verbindet sich damit. Der Reservierungsweg der Kasse haengt daran. Wer
--  hier „Webshop" liest und mitnimmt, reisst die Abholung heraus.
--
--  ── ⚠️ DIE EINE SPALTE, DIE MITGEHEN MUSS ───────────────────────────────
--
--  `carts.shipping_rate_id` traegt einen Fremdschluessel auf
--  `shipping_rates` (0098, Zeile 202). Ohne ihren Wegfall stuerzt das
--  Ausziehen der Tabelle. Sie ist die EINZIGE Spalte, die diese Wanderung
--  an `carts` anfasst; `fulfilment_method`, `fulfilment_status`,
--  `shipping_address_encrypted`, `shipping_country`, `shipping_cost_eur`
--  und `shipping_vat_eur` bleiben unberuehrt. Sie zu entfernen waere ueber
--  Basels Anweisung hinausgegangen, und sie sitzen auf einem Tisch, an dem
--  der Verkauf haengt.
--
--  ── UND DIE LOESCHUNG MUSS ES ERFAHREN ──────────────────────────────────
--
--  `erase_customer` fegte `support_messages` und `support_tickets`. Bleibt
--  der Block stehen, scheitert JEDER Loeschantrag nach dieser Wanderung an
--  „relation does not exist" — nicht einer, jeder. Die Funktion wird
--  deshalb im selben Zug neu gesetzt, Wort fuer Wort wie nach 0149, nur
--  ohne diesen Block. Dasselbe Vorgehen wie damals bei den Kanaelen.
--
--  Der Waechter `erase-covers-all-pii` liest die DROP-Saetze der
--  Wanderungen mit und nimmt eine ausgezogene Tabelle von selbst aus der
--  Pflicht — er wurde 0149 dafuer gelehrt und traegt diese Wanderung ohne
--  eine Zeile Pflege.

BEGIN;

-- ── 1. Der Fremdschluessel, der das Ausziehen sonst blockiert ─────────────
ALTER TABLE carts DROP COLUMN IF EXISTS shipping_rate_id;

-- ── 2. Die Tische, Abhaengige zuerst ──────────────────────────────────────
--
-- ⚠️ OHNE CASCADE. Ein CASCADE nimmt stillschweigend mit, was daran haengt,
-- und genau das darf hier niemand entscheiden, ohne es zu sehen. Haengt
-- doch noch etwas dran, soll diese Wanderung LAUT scheitern.
DROP TABLE IF EXISTS support_messages;
DROP TABLE IF EXISTS support_tickets;
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS shipping_rates;
DROP TABLE IF EXISTS shipping_zones;
DROP TABLE IF EXISTS cart_items;

-- ── 3. Die verwaisten Aufzaehltypen ───────────────────────────────────────
--
-- Nur die, die AUSSCHLIESSLICH diesen Tischen gehoerten. `fulfilment_method`
-- und `fulfilment_status` bleiben: sie sitzen auf `carts` (zehn bzw. sechs
-- Verwendungen, gezaehlt).
DROP TYPE IF EXISTS shipment_status;
DROP TYPE IF EXISTS ticket_status;
DROP TYPE IF EXISTS ticket_category;

-- ── 4. Die Loeschung kennt die ausgezogenen Tische nicht mehr ─────────────

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


  -- ⚰️ 22.08.2026 (0153): hier fegte die Funktion die beiden Tische der
  -- Kundenanfragen. Sie sind ausgezogen (die Wanderung oben nennt sie beim
  -- Namen); der Block ging mit.
  --
  -- ⚠️ Er MUSS mitgehen. Eine Loeschung, die einen Tisch nennt, den es nicht
  -- mehr gibt, scheitert an „relation does not exist" — und zwar bei JEDEM
  -- Loeschantrag.
  --
  -- ⚠️ UND DIESER KOMMENTAR NENNT DIE NAMEN ABSICHTLICH NICHT. Der erste
  -- Entwurf schrieb sie hierher, als Erklaerung. Der Beweisblock unten liest
  -- `prosrc` — und `prosrc` traegt die Kommentare mit. Die Wanderung fiel mit
  -- ihrer eigenen Meldung, weil eine ERWAEHNUNG wie eine BENUTZUNG aussah.
  -- Genau die Verwechslung, gegen die dieses Haus sonst prueft.

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

-- ── 5. Der Beweis beim Einspielen ─────────────────────────────────────────
DO $$
DECLARE
  uebrig text;
  quelle text;
BEGIN
  SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO uebrig
    FROM unnest(ARRAY['cart_items','shipping_zones','shipping_rates',
                      'shipments','support_tickets','support_messages']) AS t(name)
   WHERE to_regclass('public.' || t.name) IS NOT NULL;
  IF uebrig IS NOT NULL THEN
    RAISE EXCEPTION
      'Diese Tische stehen noch: %. Das Ausziehen hat nicht gegriffen.', uebrig;
  END IF;

  -- ⛔ Und das Wichtigste: die Loeschung darf keinen davon mehr nennen.
  -- Taete sie es, scheiterte JEDER Loeschantrag nach dieser Wanderung.
  SELECT prosrc INTO quelle FROM pg_proc WHERE proname = 'erase_customer';
  IF quelle IS NULL THEN
    RAISE EXCEPTION '0153: erase_customer fehlt — eine fruehere Wanderung muss zuerst laufen';
  END IF;
  IF quelle LIKE '%support_messages%' OR quelle LIKE '%support_tickets%' THEN
    RAISE EXCEPTION
      'erase_customer nennt einen ausgezogenen Tisch. Jeder Loeschantrag '
      'wuerde an „relation does not exist" scheitern.';
  END IF;

  -- Und `carts` muss STEHEN. An ihm haengt der Reservierungsweg der Kasse.
  IF to_regclass('public.carts') IS NULL THEN
    RAISE EXCEPTION
      'carts ist verschwunden. Daran haengt die Abholung — Abbruch.';
  END IF;
END
$$;

COMMIT;
