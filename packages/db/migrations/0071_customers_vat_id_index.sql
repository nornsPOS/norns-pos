-- ═════════════════════════════════════════════════════════════════════════
-- 0071 — Customers: functional index for the normalised VAT-id lookup
-- ═════════════════════════════════════════════════════════════════════════
--
-- The POS B2B checkout resolves the company customer by VAT id via the new
-- GET /api/customers/by-vat-id route, whose predicate is
--   upper(regexp_replace(vat_id, '[^A-Za-z0-9]', '', 'g')) = $cleanVat
-- `vat_id` (0039) had NO index, so that lookup was a sequential scan on every
-- B2B sale. This adds a FUNCTIONAL index whose expression byte-matches the route
-- predicate (Postgres only uses a functional index when the expression matches
-- exactly), partial on the rows the lookup can ever return.
--
-- No grant change (the app role already SELECTs `customers`). Idempotent,
-- append-only. Pure index → runs inside one implicit transaction.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'customers_vat_id_normalized_idx'
  ) THEN
    CREATE INDEX customers_vat_id_normalized_idx
      ON customers (upper(regexp_replace(vat_id, '[^A-Za-z0-9]', '', 'g')))
      WHERE vat_id IS NOT NULL AND soft_deleted_at IS NULL;
  END IF;
END$$;

COMMENT ON INDEX customers_vat_id_normalized_idx IS
  'Normalised VAT-id lookup for the POS B2B checkout (GET /api/customers/by-vat-id).';
