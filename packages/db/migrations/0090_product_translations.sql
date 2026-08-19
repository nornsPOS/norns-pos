-- ═════════════════════════════════════════════════════════════════════════
-- 0090 — product_translations: the shop writes German once, every customer
--        reads their own language.
-- ═════════════════════════════════════════════════════════════════════════
--
-- The owner enters a product ONCE, in German. A Turkish or Arabic customer
-- must still understand what the piece IS and why it is worth having. Doing
-- that per request would mean paying a translation provider on every page
-- view and making the catalog as slow as the slowest external call.
--
-- So translation is a CACHE, filled by a background worker:
--
--   • one row per (product, locale)
--   • `source_fingerprint` is a hash of the German name + description the
--     translation was made FROM. When the owner edits the German text the
--     fingerprint stops matching and the worker retranslates just that row.
--     Nothing else has to remember to invalidate anything.
--   • the storefront LEFT JOINs this table. A missing or stale row is not an
--     error: the customer transparently sees the German original until the
--     worker catches up, which is at most one sweep away.
--
-- This table holds NO personal data and nothing fiscal. It is derived, and
-- may be deleted and rebuilt at any time without loss.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_translations (
  product_id          uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  locale              text        NOT NULL,
  name                text,
  description         text,
  -- Hash of the German source this row was translated from. Mismatch with
  -- the product's current German text = stale = retranslate.
  source_fingerprint  text        NOT NULL,
  -- Which provider/model produced it, for forensics when a phrasing looks off.
  provider            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (product_id, locale),

  -- Two letter language code, lowercase. Keeps junk locales out of the cache.
  CONSTRAINT product_translations_locale_format
    CHECK (locale ~ '^[a-z]{2}$'),
  -- A row exists to carry text; an all NULL row would be a silent hole that
  -- the sweeper would keep reconsidering forever.
  CONSTRAINT product_translations_has_text
    CHECK (name IS NOT NULL OR description IS NOT NULL)
);

-- The sweeper's hot path: "give me products missing a translation for locale X".
CREATE INDEX IF NOT EXISTS product_translations_locale_idx
  ON product_translations (locale);

COMMENT ON TABLE product_translations IS
  'Derived cache of per locale product name/description. Rebuildable; no personal or fiscal data.';
COMMENT ON COLUMN product_translations.source_fingerprint IS
  'Hash of the German source text this row was translated from. Mismatch means stale.';

-- ── Grants ───────────────────────────────────────────────────────────────
-- The api only ever READS translations (it serves the storefront).
GRANT SELECT ON product_translations TO warehouse14_app;
-- The worker fills and refreshes the cache, and prunes rows for locales we
-- stop supporting.
GRANT SELECT, INSERT, UPDATE, DELETE ON product_translations TO warehouse14_worker;
