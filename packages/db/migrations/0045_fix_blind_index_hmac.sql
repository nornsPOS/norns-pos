-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0045 — Fix blind_index(): pass the PII key to hmac() as bytea.
--
-- 0007 defined blind_index() as  hmac(bytea_data, text_key, 'sha256').  pgcrypto
-- only ships  hmac(bytea, bytea, text)  and  hmac(text, text, text)  — there is
-- NO  hmac(bytea, text, text)  overload, so the body throws at runtime:
--   "function hmac(bytea, text, unknown) does not exist".
-- It slipped into prod only because migrate.sh applies with
-- check_function_bodies=off (body validation deferred), so CREATE succeeded but
-- every CALL fails.  blind_index() is invoked on customer create
-- (routes/customers.ts), email/phone exact-match search (customer-list.ts), and
-- storefront shopper signup (0018) → a customer with an email or phone cannot be
-- saved today.
--
-- Fix: wrap the key in convert_to(..., 'UTF8') so the call resolves to the
-- hmac(bytea, bytea, text) overload.  This is the ONLY change — signature, body
-- shape, NULL handling and volatility are byte-for-byte identical to 0007.
-- Stays LANGUAGE SQL STABLE PARALLEL UNSAFE (it reads current_setting, so it is
-- NOT immutable).  Output is identical to what 0007 intended; no data migration
-- is needed because the broken function never successfully wrote a blind index.
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION blind_index(plaintext TEXT) RETURNS BYTEA
  LANGUAGE SQL STABLE PARALLEL UNSAFE
  AS $$
    SELECT CASE
      WHEN plaintext IS NULL THEN NULL
      ELSE hmac(
        convert_to(plaintext, 'UTF8'),
        convert_to(current_setting('warehouse14.pii_key'), 'UTF8'),
        'sha256'
      )
    END;
  $$;

COMMENT ON FUNCTION blind_index(TEXT) IS
  'HMAC-SHA256 over normalized PII for exact-match lookup without decryption. '
  'Caller MUST normalize (lowercase, E.164, trim) before calling.';
