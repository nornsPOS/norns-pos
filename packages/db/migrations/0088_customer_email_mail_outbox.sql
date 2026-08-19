-- 0088 — Online customers become fully visible to staff + the mail outbox.
--
-- 1) BACKFILL: online registrations (email sign-up AND Google) wrote the
--    email/phone only onto the SHOPPER row; the customers row — the one the
--    POS, Owner Desktop and owner app read — stayed empty except the name.
--    Mirror the contact of every non-guest shopper onto its customer row
--    (guests keep their synthetic address OFF the customer record; their
--    real contact arrives via the reservation form). Runtime write-through
--    lands in the same release (sign-up, Google callback, account PATCH).
--
-- 2) EMAIL OUTBOX: transactional mail (welcome, reservation confirmation
--    with the order number, cancellation notice) is composed at the moment
--    of the event and queued here; the worker delivers via SMTP when the
--    SMTP env is configured. Recipient is PII → encrypted like every other
--    address in this schema.
--
-- 3) LEDGER: on_cart_reserved() learns the CANCELLED branch so staff see a
--    customer cancellation LIVE on the same stream as new reservations.

-- ── 1) Backfill customer contact from non-guest shoppers ─────────────────
UPDATE customers c
   SET email_encrypted   = s.email_encrypted,
       email_blind_index = COALESCE(c.email_blind_index, s.email_blind_index),
       phone_encrypted   = COALESCE(c.phone_encrypted, s.phone_encrypted),
       phone_blind_index = COALESCE(c.phone_blind_index, s.phone_blind_index),
       updated_at        = now()
  FROM shoppers s
 WHERE s.customer_id = c.id
   AND s.is_guest = FALSE
   AND s.soft_deleted_at IS NULL
   AND c.email_encrypted IS NULL;

-- ── 2) email_outbox ──────────────────────────────────────────────────────
CREATE TABLE email_outbox (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_encrypted bytea NOT NULL,
  template            text  NOT NULL,
  subject             text  NOT NULL,
  body_text           text  NOT NULL,
  body_html           text,
  status              text  NOT NULL DEFAULT 'PENDING'
                      CONSTRAINT email_outbox_status_domain
                      CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts            int   NOT NULL DEFAULT 0
                      CONSTRAINT email_outbox_attempts_nonneg CHECK (attempts >= 0),
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  CONSTRAINT email_outbox_sent_has_timestamp
    CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
);

CREATE INDEX email_outbox_pending_idx ON email_outbox (created_at) WHERE status = 'PENDING';

GRANT SELECT, INSERT ON email_outbox TO warehouse14_app;
GRANT SELECT, UPDATE ON email_outbox TO warehouse14_worker;

-- ── 3) Ledger event on customer cancellation ─────────────────────────────
CREATE OR REPLACE FUNCTION on_cart_reserved() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.status = 'RESERVED' AND (OLD.status IS DISTINCT FROM 'RESERVED') THEN
    INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
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
  IF NEW.status = 'CANCELLED' AND (OLD.status IS DISTINCT FROM 'CANCELLED') THEN
    INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
    VALUES (
      'web_order.cancelled',
      'carts',
      NEW.id,
      jsonb_build_object(
        'shopper_id',    NEW.shopper_id,
        'cancelled_at',  to_char(now() AT TIME ZONE 'UTC',
                                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'status',        NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION on_cart_reserved() OWNER TO warehouse14_security;
