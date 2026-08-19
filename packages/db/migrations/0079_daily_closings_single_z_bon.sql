-- 0079: enforce EXACTLY ONE daily closing (Z-Bon) per business day in the V1
-- single-shop model.
--
-- The 0011 constraint `daily_closings_business_day_shop_uq UNIQUE (business_day,
-- shop_id)` does NOT prevent duplicates while shop_id is NULL (the V1 case). On
-- PostgreSQL a plain UNIQUE treats NULLs as DISTINCT, so two (business_day, NULL)
-- rows are both accepted. That defeats the guard for the whole V1 lifetime: two
-- concurrent or outbox-replayed POST /api/closings/finalize calls both pass the
-- check-then-insert and commit TWO FINALIZED Z-Bons for the same day, after which
-- every DSFinV-K / DATEV / Kassenbericht export double-counts that day (a
-- Kassen-Nachschau finding).
--
-- Fix: a PARTIAL unique index over business_day for the NULL-shop rows. Together
-- with the existing (business_day, shop_id) constraint this guarantees exactly
-- one closing per day in both the single-shop (NULL) and the future multi-shop
-- (non-NULL) cases. The finalize route already converts the resulting SQLSTATE
-- 23505 into a clean 409 (Der Tagesabschluss besteht bereits).
--
-- Precondition: if the production table already holds duplicate NULL-shop
-- closings for a day, the index cannot be created. We fail LOUDLY with a clear
-- message so the operator resolves the duplicates first, rather than silently
-- skipping the guard.

DO $$
DECLARE dup_days int;
BEGIN
  SELECT count(*) INTO dup_days FROM (
    SELECT business_day
      FROM daily_closings
     WHERE shop_id IS NULL
     GROUP BY business_day
    HAVING count(*) > 1
  ) d;
  IF dup_days > 0 THEN
    RAISE EXCEPTION
      'daily_closings has % business day(s) with duplicate NULL-shop closings; resolve the duplicates before applying migration 0079', dup_days;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS daily_closings_business_day_null_shop_uq
  ON daily_closings (business_day)
  WHERE shop_id IS NULL;

COMMENT ON INDEX daily_closings_business_day_null_shop_uq IS
  'One Z-Bon per business day in the V1 single-shop model (shop_id NULL); closes the NULLS-DISTINCT gap in daily_closings_business_day_shop_uq.';
