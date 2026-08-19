-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0063 — Owner taxonomy seed + Briefmarken stamp attributes.
--
-- 1. Relaxes the category depth cap from 2 → 3 levels. The owner's tree
--    needs Briefmarken → Altdeutschland → <18 states>, which the 0025
--    trigger `enforce_no_grandparent_category` refused. The function body
--    is replaced in place (same name, same SECURITY DEFINER + owner
--    pattern as 0025/0032/0055) so existing trigger wiring is untouched:
--    a parent is now acceptable as long as it sits at depth ≤ 2, i.e. a
--    4th level (great-grandchild) still raises check_violation.
--
-- 2. Seeds the owner's FULL taxonomy (19 roots; Münzen ×16, Schmuck ×15,
--    Barren ×10, Briefmarken ×5 incl. Altdeutschland ×18 third-level
--    states with their MiNr ranges in description_de). Idempotent by slug
--    via ON CONFLICT (slug) DO NOTHING (arbiter = categories_slug_uq).
--    All rows storefront-visible (hidden_from_storefront defaults FALSE).
--
-- 3. Adds the stamp attributes to products (both NULL-able — only
--    Briefmarken rows carry them):
--      • stamp_erhaltung TEXT  — POSTFRISCH (**) / FALZ (*) /
--        GESTEMPELT (,) / AUF_BRIEF, the dealer notation
--      • stamp_minr INTEGER    — Michel catalog number (e.g. 'MiNr. 27')
--    + CHECKs, + column-scoped UPDATE grant for warehouse14_app (SELECT/
--    INSERT on products are table-level since 0003, so the new columns
--    are covered automatically; warehouse14_worker has table-level SELECT
--    since 0035; no SECURITY DEFINER trigger reads these columns, so no
--    warehouse14_security grant is needed — the 0055/0056/0057 class
--    checked).
--
-- Idempotent + transactional (no ALTER TYPE … ADD VALUE in this file).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 1. Depth cap 2 → 3 (root + child + grandchild).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_no_grandparent_category() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  parent_parent_id UUID;
  grandparent_parent_id UUID;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT parent_id INTO parent_parent_id
      FROM categories
      WHERE id = NEW.parent_id;
    IF parent_parent_id IS NOT NULL THEN
      SELECT parent_id INTO grandparent_parent_id
        FROM categories
        WHERE id = parent_parent_id;
      IF grandparent_parent_id IS NOT NULL THEN
        RAISE EXCEPTION
          'Categories are capped at 3 levels (root + child + grandchild). '
          'Cannot nest a 4th level under category %.', NEW.parent_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION enforce_no_grandparent_category() OWNER TO warehouse14_security;
GRANT EXECUTE ON FUNCTION enforce_no_grandparent_category() TO warehouse14_app;

COMMENT ON FUNCTION enforce_no_grandparent_category() IS
  '3-level depth cap (0063; was 2-level in 0025). SECURITY DEFINER — owner warehouse14_security has SELECT on categories (0032).';

-- ════════════════════════════════════════════════════════════════════════
-- 2. products: Briefmarken stamp attributes.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS stamp_erhaltung TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stamp_minr INTEGER;

COMMENT ON COLUMN products.stamp_erhaltung IS
  'Briefmarken-Erhaltung: POSTFRISCH (**), FALZ (*), GESTEMPELT (,), AUF_BRIEF. NULL für Nicht-Briefmarken.';
COMMENT ON COLUMN products.stamp_minr IS
  'Michel-Katalognummer (MiNr.), z. B. 27 → "MiNr. 27". NULL für Nicht-Briefmarken.';

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stamp_erhaltung_check;
ALTER TABLE products ADD CONSTRAINT products_stamp_erhaltung_check
  CHECK (stamp_erhaltung IS NULL
         OR stamp_erhaltung IN ('POSTFRISCH', 'FALZ', 'GESTEMPELT', 'AUF_BRIEF'));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stamp_minr_positive;
ALTER TABLE products ADD CONSTRAINT products_stamp_minr_positive
  CHECK (stamp_minr IS NULL OR stamp_minr > 0);

-- Column-scoped UPDATE (least privilege, mirrors 0006/0060). SELECT/INSERT
-- on products are table-level (0003 default privileges) → auto-covered.
GRANT UPDATE (stamp_erhaltung, stamp_minr) ON products TO warehouse14_app;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Taxonomy seed — idempotent by slug.
-- ════════════════════════════════════════════════════════════════════════

-- 3a. The 19 roots, in the owner's order (display_order 10..190).
INSERT INTO categories (slug, name_de, display_order) VALUES
  ('gold',               'Gold',                 10),
  ('silber',             'Silber',               20),
  ('platin',             'Platin',               30),
  ('palladium',          'Palladium',            40),
  ('muenzen',            'Münzen',               50),
  ('briefmarken',        'Briefmarken',          60),
  ('schmuck',            'Schmuck',              70),
  ('barren',             'Barren',               80),
  ('medaillen',          'Medaillen',            90),
  ('banknoten',          'Banknoten',           100),
  ('postkarten',         'Postkarten',          110),
  ('militaria',          'Militaria',           120),
  ('antiquitaeten',      'Antiquitäten',        130),
  ('uhren',              'Uhren',               140),
  ('orden-ehrenzeichen', 'Orden & Ehrenzeichen', 150),
  ('ansichtskarten',     'Ansichtskarten',      160),
  ('konvolute',          'Konvolute',           170),
  ('neuheiten',          'Neuheiten',           180),
  ('ankauf',             'Ankauf',              190)
ON CONFLICT (slug) DO NOTHING;

-- 3b. Münzen → 16 children.
INSERT INTO categories (parent_id, slug, name_de, display_order)
SELECT p.id, v.slug, v.name_de, v.display_order
FROM (VALUES
  ('goldmuenzen',       'Goldmünzen',        10),
  ('silbermuenzen',     'Silbermünzen',      20),
  ('platinmuenzen',     'Platinmünzen',      30),
  ('palladiummuenzen',  'Palladiummünzen',   40),
  ('kaiserreich',       'Kaiserreich',       50),
  ('weimarer-republik', 'Weimarer Republik', 60),
  ('deutsches-reich',   'Deutsches Reich',   70),
  ('ddr',               'DDR',               80),
  ('bund',              'Bund',              90),
  ('berlin',            'Berlin',           100),
  ('euro',              'Euro',             110),
  ('ausland',           'Ausland',          120),
  ('antike-muenzen',    'Antike Münzen',    130),
  ('notmuenzen',        'Notmünzen',        140),
  ('muenzen-medaillen', 'Medaillen',        150),
  ('muenzen-konvolute', 'Konvolute',        160)
) AS v(slug, name_de, display_order)
CROSS JOIN (SELECT id FROM categories WHERE slug = 'muenzen') AS p
ON CONFLICT (slug) DO NOTHING;

-- 3c. Schmuck → 15 children.
INSERT INTO categories (parent_id, slug, name_de, display_order)
SELECT p.id, v.slug, v.name_de, v.display_order
FROM (VALUES
  ('goldschmuck',      'Goldschmuck',       10),
  ('silberschmuck',    'Silberschmuck',     20),
  ('platinschmuck',    'Platinschmuck',     30),
  ('vintage-schmuck',  'Vintage Schmuck',   40),
  ('antiker-schmuck',  'Antiker Schmuck',   50),
  ('designerschmuck',  'Designerschmuck',   60),
  ('ringe',            'Ringe',             70),
  ('ketten',           'Ketten',            80),
  ('armbaender',       'Armbänder',         90),
  ('ohrringe',         'Ohrringe',         100),
  ('broschen',         'Broschen',         110),
  ('anhaenger',        'Anhänger',         120),
  ('edelsteinschmuck', 'Edelsteinschmuck', 130),
  ('bernsteinschmuck', 'Bernsteinschmuck', 140),
  ('schmuckkonvolute', 'Schmuckkonvolute', 150)
) AS v(slug, name_de, display_order)
CROSS JOIN (SELECT id FROM categories WHERE slug = 'schmuck') AS p
ON CONFLICT (slug) DO NOTHING;

-- 3d. Barren → 10 children.
INSERT INTO categories (parent_id, slug, name_de, display_order)
SELECT p.id, v.slug, v.name_de, v.display_order
FROM (VALUES
  ('goldbarren',          'Goldbarren',           10),
  ('silberbarren',        'Silberbarren',         20),
  ('platinbarren',        'Platinbarren',         30),
  ('palladiumbarren',     'Palladiumbarren',      40),
  ('geiger',              'Geiger',               50),
  ('heraeus',             'Heraeus',              60),
  ('degussa',             'Degussa',              70),
  ('umicore',             'Umicore',              80),
  ('argor-heraeus',       'Argor Heraeus',        90),
  ('diverse-hersteller',  'Diverse Hersteller',  100)
) AS v(slug, name_de, display_order)
CROSS JOIN (SELECT id FROM categories WHERE slug = 'barren') AS p
ON CONFLICT (slug) DO NOTHING;

-- 3e. Briefmarken → 5 children (the German collecting areas, MiNr ranges
--     per the owner's Michel reference).
INSERT INTO categories (parent_id, slug, name_de, description_de, display_order)
SELECT p.id, v.slug, v.name_de, v.description_de, v.display_order
FROM (VALUES
  ('briefmarken-deutsches-reich', 'Deutsches Reich', 'MiNr. 1–910 · Block 1–11',          10),
  ('briefmarken-berlin',          'Berlin (West)',   'MiNr. 1–879 · Block 1–8',           20),
  ('briefmarken-bund',            'Bund',            'MiNr. 111–laufend · Block 2–laufend', 30),
  ('briefmarken-ddr',             'DDR',             'MiNr. 242–3365 · Block 7–100',      40),
  ('altdeutschland',              'Altdeutschland',  NULL,                                 50)
) AS v(slug, name_de, description_de, display_order)
CROSS JOIN (SELECT id FROM categories WHERE slug = 'briefmarken') AS p
ON CONFLICT (slug) DO NOTHING;

-- 3f. Altdeutschland → 18 third-level states (depth 3 — needs the relaxed
--     trigger above). MiNr range per state in description_de.
INSERT INTO categories (parent_id, slug, name_de, description_de, display_order)
SELECT p.id, v.slug, v.name_de, v.description_de, v.display_order
FROM (VALUES
  ('baden',                   'Baden',                   'MiNr. 1–25',   10),
  ('bayern',                  'Bayern',                  'MiNr. 1–191',  20),
  ('bergedorf',               'Bergedorf',               'MiNr. 1–5',    30),
  ('braunschweig',            'Braunschweig',            'MiNr. 1–20',   40),
  ('bremen',                  'Bremen',                  'MiNr. 1–19',   50),
  ('hamburg',                 'Hamburg',                 'MiNr. 1–20',   60),
  ('hannover',                'Hannover',                'MiNr. 1–25',   70),
  ('helgoland',               'Helgoland',               'MiNr. 1–20',   80),
  ('luebeck',                 'Lübeck',                  'MiNr. 1–20',   90),
  ('mecklenburg-schwerin',    'Mecklenburg-Schwerin',    'MiNr. 1–25',  100),
  ('mecklenburg-strelitz',    'Mecklenburg-Strelitz',    'MiNr. 1–6',   110),
  ('oldenburg',               'Oldenburg',               'MiNr. 1–19',  120),
  ('preussen',                'Preußen',                 'MiNr. 1–32',  130),
  ('sachsen',                 'Sachsen',                 'MiNr. 1–21',  140),
  ('schleswig-holstein',      'Schleswig-Holstein',      'MiNr. 1–15',  150),
  ('thurn-und-taxis',         'Thurn und Taxis',         'MiNr. 1–54',  160),
  ('wuerttemberg',            'Württemberg',             'MiNr. 1–52',  170),
  ('norddeutscher-postbezirk','Norddeutscher Postbezirk','MiNr. 1–26',  180)
) AS v(slug, name_de, description_de, display_order)
CROSS JOIN (SELECT id FROM categories WHERE slug = 'altdeutschland') AS p
ON CONFLICT (slug) DO NOTHING;

COMMIT;
