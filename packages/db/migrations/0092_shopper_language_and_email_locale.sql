-- ═════════════════════════════════════════════════════════════════════════
-- 0092 — a shopper may finally SAY which of the thirteen languages they read,
--        and every queued letter records the language it was written in.
-- ═════════════════════════════════════════════════════════════════════════
--
-- THE BUG THIS FIXES, in one sentence: the storefront ships thirteen
-- languages, but shoppers.preferred_language was constrained to exactly three
-- (de, en, ar), so a Turkish or Polish customer could not be stored as such
-- even if the app tried. Every account was German by construction, and the
-- transactional emails followed that lie: the shopper read the whole app in
-- Turkish and then received the pickup number in German.
--
-- The new rule is the same discipline the translation tables already use: any
-- two lowercase letters. The set of app languages changes over time and the
-- database is the wrong place to hold that list, but "is a language tag at
-- all" is a genuine integrity rule worth keeping.
--
-- email_outbox.locale is observability, not behaviour: it lets anyone answer
-- "which language did we actually send that in" without parsing the body.
-- Existing rows were all German, which is exactly what the default records.
-- ═════════════════════════════════════════════════════════════════════════

-- ── shoppers ──────────────────────────────────────────────────────────────
ALTER TABLE shoppers
  DROP CONSTRAINT IF EXISTS shoppers_preferred_language_check;

ALTER TABLE shoppers
  ADD CONSTRAINT shoppers_preferred_language_check
  CHECK (preferred_language ~ '^[a-z]{2}$');

COMMENT ON COLUMN shoppers.preferred_language IS
  'ISO 639 1 code the shopper reads. Drives catalog language and the language of every email we send them. Defaults to de.';

-- ── email_outbox ──────────────────────────────────────────────────────────
ALTER TABLE email_outbox
  ADD COLUMN IF NOT EXISTS locale character(2) NOT NULL DEFAULT 'de';

ALTER TABLE email_outbox
  DROP CONSTRAINT IF EXISTS email_outbox_locale_format;

ALTER TABLE email_outbox
  ADD CONSTRAINT email_outbox_locale_format
  CHECK (locale ~ '^[a-z]{2}$');

COMMENT ON COLUMN email_outbox.locale IS
  'Language this letter was composed in. Recorded so the sent language is answerable without reading the body.';
