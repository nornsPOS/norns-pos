-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0033 — Time-weighted N-day metal-price average (Epic A, Phase A2)
--
-- Adds `metal_price_avg_eur_per_gram(p_metal, p_days DEFAULT 10)` — a
-- mathematically rigorous TIME-WEIGHTED average of the price per gram over the
-- window [now() - p_days, now()].
--
-- Why time-weighted and not a plain AVG of rows: `metal_prices` is written
-- only when a price CHANGES (one CURRENT row per metal, append-only history),
-- so a naive row-average would over-weight volatile periods that happened to
-- produce more rows. The fiscally correct "average price over 10 days" weights
-- each price by how long it was the prevailing price inside the window.
--
--   avg = Σ(price × seconds_active_in_window) / Σ(seconds_active_in_window)
--
-- Each row's active interval [valid_from, COALESCE(valid_to, now())) is CLIPPED
-- to the window before weighting, so partial-overlap rows contribute only their
-- in-window seconds. Returns NULL when the metal has no coverage in the window.
--
-- Idempotent (CREATE OR REPLACE + idempotent GRANT). Read-only — no DDL on
-- existing tables.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION metal_price_avg_eur_per_gram(p_metal TEXT, p_days INT DEFAULT 10)
RETURNS NUMERIC(15,4)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
  WITH win AS (
    SELECT (now() - make_interval(days => p_days)) AS w_start, now() AS w_end
  ),
  seg AS (
    SELECT
      mp.price_per_gram_eur                              AS price,
      GREATEST(mp.valid_from, win.w_start)               AS seg_start,
      LEAST(COALESCE(mp.valid_to, win.w_end), win.w_end)  AS seg_end
    FROM metal_prices mp
    CROSS JOIN win
    WHERE mp.metal = p_metal
      -- Keep only rows whose active interval overlaps the window at all.
      AND mp.valid_from < win.w_end
      AND COALESCE(mp.valid_to, win.w_end) > win.w_start
  ),
  weighted AS (
    SELECT price, EXTRACT(EPOCH FROM (seg_end - seg_start))::numeric AS secs
    FROM seg
    WHERE seg_end > seg_start
  )
  SELECT CASE
           WHEN COALESCE(SUM(secs), 0) = 0 THEN NULL
           ELSE ROUND(SUM(price * secs) / SUM(secs), 4)
         END
  FROM weighted;
$$;

COMMENT ON FUNCTION metal_price_avg_eur_per_gram(TEXT, INT) IS
  'Time-weighted average price per gram (EUR) over the last p_days (default 10), '
  'clipped to the window. NULL when the metal has no in-window coverage. '
  'Epic A Phase A2.';

-- Read-only helper — both app and worker may call it.
GRANT EXECUTE ON FUNCTION metal_price_avg_eur_per_gram(TEXT, INT) TO warehouse14_app;
GRANT EXECUTE ON FUNCTION metal_price_avg_eur_per_gram(TEXT, INT) TO warehouse14_worker;

COMMIT;
