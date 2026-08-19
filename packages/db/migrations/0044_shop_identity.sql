-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0044 — Seed Owner-editable shop identity (receipt header).
--
-- The shop name / address / USt-IdNr. / phone printed on every Kassenbon were
-- hardcoded in the POS (lib/shop-info.ts). These keys make them Owner-editable
-- from the Owner Desktop (Einstellungen) via PATCH /api/settings/:key, and the
-- POS reads them from GET /api/shop-info, falling back to the bundled constant.
--
-- Stored as JSON strings (quoted), matching the kyc.* threshold convention.
-- Keys are seeded by migration; the app role only ever UPDATEs the value
-- (system_settings design). Values are PROVISIONAL — Basel replaces the VAT id
-- + phone with the real ones from the Owner Desktop.
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO system_settings (key, value, description) VALUES
  ('shop.name',          '"WAREHOUSE 14"'::jsonb,                 'Shop name printed on the receipt header.'),
  ('shop.tagline',       '"Antiquitäten · Briefmarken · Münzen"'::jsonb, 'Short trade line under the shop name on the receipt.'),
  ('shop.address_line1', '"Schornbacher Weg 66"'::jsonb,          'Receipt address line 1 (street + number).'),
  ('shop.address_line2', '"73614 Schorndorf"'::jsonb,             'Receipt address line 2 (PLZ + Ort).'),
  ('shop.vat_id',        '"DE123456789"'::jsonb,                  'USt-IdNr. printed on the receipt. PROVISIONAL — replace with the real id.'),
  ('shop.phone',         '"+49 7181 0000000"'::jsonb,             'Shop phone printed on the receipt. PROVISIONAL — replace with the real number.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
