-- ═════════════════════════════════════════════════════════════════════════
-- 0068 — Web reservation → ledger event (staff live notification)
-- ═════════════════════════════════════════════════════════════════════════
--
-- When a cart flips to RESERVED (a customer's reserve-and-pickup request), emit a
-- `ledger_events` row so the POS Bestellungen surface + the Owner Control Desktop
-- see the new order LIVE over the existing /api/sse/ledger stream — the same
-- mechanism appointments use (migration 0012 `on_appointment_state_event`).
--
-- SECURITY DEFINER + owned by warehouse14_security so it may INSERT into the
-- hash-chained, append-only `ledger_events` (warehouse14_app cannot). The app
-- only does the UPDATE carts SET status='RESERVED' (already granted); this
-- trigger does the audit emit. The chain trigger computes prev_hash/row_hash; the
-- notify trigger fires pg_notify('warehouse14_ledger', id) for the SSE push.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION on_cart_reserved() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.status = 'RESERVED' AND (OLD.status IS DISTINCT FROM 'RESERVED') THEN
    INSERT INTO ledger_events (
      event_type, entity_table, entity_id, payload
    )
    VALUES (
      'web_order.reserved',
      'carts',
      NEW.id,
      jsonb_build_object(
        'shopper_id',  NEW.shopper_id,
        'reserved_at', to_char(COALESCE(NEW.reserved_at, now()) AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'status',      NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION on_cart_reserved() OWNER TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_carts_after_reserve ON carts;
CREATE TRIGGER trg_carts_after_reserve
  AFTER UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION on_cart_reserved();
