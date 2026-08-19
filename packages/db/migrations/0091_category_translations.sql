-- ═════════════════════════════════════════════════════════════════════════
-- 0091 — category_translations: the last German text the customer could see.
-- ═════════════════════════════════════════════════════════════════════════
--
-- 0090 taught product name/description to speak the reader's language. The
-- CATEGORY name stayed German (or English at best), so a Turkish shopper read
-- "Altın" on the metal filter but "Uhren" on the catalog section right above
-- it. Same table shape, same fingerprint discipline, same worker.
--
-- Categories are NOT enum-like facets (metal, Erhaltung) — those live in the
-- app's locale files because their set is fixed and known. A category is
-- created and named by the owner at runtime, so it cannot be pre-translated
-- and has to go through the cache like product text does.
--
-- Derived data: no personal or fiscal rows, rebuildable at any time.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS category_translations (
  category_id         uuid        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  locale              text        NOT NULL,
  name                text,
  description         text,
  -- Hash of the German source this row was translated from. Mismatch with the
  -- category's current German text = stale = retranslate. Identical rule to
  -- product_translations so one worker can serve both.
  source_fingerprint  text        NOT NULL,
  provider            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (category_id, locale),

  CONSTRAINT category_translations_locale_format
    CHECK (locale ~ '^[a-z]{2}$'),
  CONSTRAINT category_translations_has_text
    CHECK (name IS NOT NULL OR description IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS category_translations_locale_idx
  ON category_translations (locale);

COMMENT ON TABLE category_translations IS
  'Derived cache of per locale category name/description. Rebuildable; no personal or fiscal data.';

GRANT SELECT ON category_translations TO warehouse14_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON category_translations TO warehouse14_worker;
