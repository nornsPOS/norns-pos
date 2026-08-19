-- ═════════════════════════════════════════════════════════════════════════
-- 0093 — keep what Google actually tells us about a customer, not a third of it.
-- ═════════════════════════════════════════════════════════════════════════
--
-- A Google sign in hands over a verified identity: subject id, email, whether
-- that email is verified, the display name, given and family name separately,
-- a profile picture and the reader's locale. We were keeping the subject, the
-- email and the display name, and throwing the rest away. The counter then had
-- to ask a customer standing in front of them for details Google had already
-- confirmed.
--
-- What each column is for, because storing personal data without a purpose is
-- exactly what data minimisation forbids:
--   • given/family name — so staff can address someone correctly, and so a
--     name can be searched by either part. The display name alone cannot be
--     split reliably across the twelve cultures this shop serves.
--   • picture — recognising the right person at the counter when they come to
--     collect a reservation. NOTE: this is a Google CDN URL, so rendering it
--     means the staff app makes a request to Google. That is a deliberate
--     trade for counter recognition, not an accident.
--   • last_seen_at — "is this a live customer or a dormant account", the first
--     question staff ask when a reservation is old.
--
-- All three names are PII and go through encrypt_pii like every other name in
-- this schema. The picture URL identifies a person just as directly, so it is
-- encrypted too rather than sitting in the clear because it happens to be a
-- URL. erase_customer() (migration 0078) already NULLs shopper PII columns by
-- name, so these are covered by the existing Art. 17 path.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE shoppers
  ADD COLUMN IF NOT EXISTS given_name_encrypted  bytea,
  ADD COLUMN IF NOT EXISTS family_name_encrypted bytea,
  ADD COLUMN IF NOT EXISTS picture_url_encrypted bytea,
  ADD COLUMN IF NOT EXISTS last_seen_at          timestamptz;

COMMENT ON COLUMN shoppers.given_name_encrypted IS
  'Given name as verified by the identity provider. Encrypted PII. Lets staff address a customer correctly instead of guessing at a display name.';
COMMENT ON COLUMN shoppers.family_name_encrypted IS
  'Family name as verified by the identity provider. Encrypted PII.';
COMMENT ON COLUMN shoppers.picture_url_encrypted IS
  'Profile picture URL from the identity provider. Encrypted: a photo URL identifies a person as directly as their name. Purpose is recognising the customer at the counter.';
COMMENT ON COLUMN shoppers.last_seen_at IS
  'Last successful sign in. Answers "is this account still live" when staff look at an ageing reservation.';

-- Staff read these through the customer file; the app role already holds the
-- PII key inside withPii(), so no new grant is needed beyond the table's.
