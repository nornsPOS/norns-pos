-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0027 — Business locations (Day 13, Phase 2.B)
--
-- Closes audit §11 W-5 of `commerce-seo-audit.md`: the platform has no
-- canonical concept of "where the shop is". This migration lands the
-- `business_locations` table with the address + lat/lng + Google Business
-- Profile binding + opening hours + service-area postal codes. Powers:
--   • Local SEO JSON-LD (LocalBusiness / JewelryStore / CollectiblesStore)
--   • Google Business Profile sync worker (Phase 1.5 #I-39)
--   • Future /goldankauf/<city> landing pages (audit §6.areaServed)
--   • Multi-location growth: more than one row supported from day one
--
-- The partial UNIQUE `is_primary WHERE is_primary=TRUE AND active=TRUE`
-- enforces exactly one primary location at a time — the storefront
-- footer reads the primary; non-primaries are surfaced only when the
-- operator opens the "alle Standorte" page (Phase 2.C).
--
-- Idempotent + transactional. No PII — the shop's own address is public.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS business_locations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Operator-facing name. Distinct from the legal entity; used for
  -- Spotlight search + admin disambiguation when more than one shop.
  name                        TEXT NOT NULL,

  -- Postal address.
  street                      TEXT NOT NULL,
  postal_code                 TEXT NOT NULL,
  city                        TEXT NOT NULL,
  region                      TEXT,
  country_code                CHAR(2) NOT NULL DEFAULT 'DE',

  -- Geo-coordinates for "in der Nähe" + LocalBusiness JSON-LD.
  -- NUMERIC(9,6) gives ~10 cm precision globally — overkill for retail
  -- but harmless.
  lat                         NUMERIC(9,6),
  lng                         NUMERIC(9,6),

  -- Contact channels.
  phone                       TEXT,
  email                       TEXT,

  -- Google Business Profile binding. NULL until the operator links the
  -- shop's GBP entry. Drives the Phase 1.5 #I-39 sync worker.
  google_place_id             TEXT,

  -- Opening hours as JSONB. Shape (V1 convention):
  --   {
  --     "monday":    [{"open": "09:00", "close": "13:00"},
  --                   {"open": "14:30", "close": "18:00"}],
  --     "tuesday":   [...],
  --     "wednesday": [...],
  --     "thursday":  [...],
  --     "friday":    [...],
  --     "saturday":  [{"open": "09:00", "close": "14:00"}],
  --     "sunday":    [],
  --     "exceptions": [{"date":"2026-12-24","note":"Heiligabend","open":null}]
  --   }
  opening_hours               JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Postal codes this location serves for at-home estate pickups /
  -- /goldankauf/<city> routing. Empty = no service-area (operator only
  -- buys at the counter).
  service_area_postal_codes   TEXT[] NOT NULL DEFAULT '{}',

  -- schema.org business type. JewelryStore is the default for Goldhandel;
  -- alternatives: CollectiblesStore, AntiqueStore, Store.
  schema_org_business_type    TEXT NOT NULL DEFAULT 'JewelryStore',

  -- Exactly one primary at a time (partial UNIQUE below).
  is_primary                  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Soft-deactivate without delete (so historical receipt links survive).
  active                      BOOLEAN NOT NULL DEFAULT TRUE,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT business_locations_country_format
    CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT business_locations_lat_range
    CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  CONSTRAINT business_locations_lng_range
    CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)),
  CONSTRAINT business_locations_lat_lng_together
    CHECK (
      (lat IS NULL AND lng IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL)
    )
);

COMMENT ON TABLE business_locations IS
  'The shop''s own canonical address + Google Business binding. Day 13.';
COMMENT ON COLUMN business_locations.is_primary IS
  'Exactly one TRUE across active rows (partial UNIQUE). Drives storefront footer.';
COMMENT ON COLUMN business_locations.service_area_postal_codes IS
  'Postal codes the shop accepts estate pickups from. Drives /goldankauf/<city>.';

-- Partial UNIQUE: exactly one primary location active at a time.
CREATE UNIQUE INDEX IF NOT EXISTS business_locations_one_primary_uq
  ON business_locations ((TRUE))
  WHERE is_primary = TRUE AND active = TRUE;

CREATE INDEX IF NOT EXISTS business_locations_active_idx
  ON business_locations (active);

CREATE INDEX IF NOT EXISTS business_locations_city_idx
  ON business_locations (city)
  WHERE active = TRUE;

-- updated_at touch trigger (touch_updated_at landed in migration 0025).
DROP TRIGGER IF EXISTS trg_business_locations_touch_updated_at ON business_locations;
CREATE TRIGGER trg_business_locations_touch_updated_at
  BEFORE UPDATE ON business_locations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Role grants.
GRANT SELECT, INSERT, UPDATE ON business_locations TO warehouse14_app;
-- No DELETE — soft-deactivate via `active = FALSE` to preserve historical
-- references in past receipts / footer audit trails.

COMMIT;
