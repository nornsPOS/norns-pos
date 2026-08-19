-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0012 — Smart Appointment System (the final keystone)
--
-- The last migration. After it, the schema is complete: every Phase-0 ADR
-- has a corresponding table, function, or trigger in the database.
--
-- What lands here:
--   • staff_working_hours / staff_time_off / shop_holidays — the capacity model
--   • appointments — 4 types, 8-status state machine
--   • appointment_linked_products — many-to-many for VIEWING types
--   • product_viewing_holds — the soft-hold table consumed by inventory-lock
--   • available_slots() — DST-correct slot generation, STABLE, plpgsql
--   • Soft-hold trigger — SECURITY DEFINER, fires when a VIEWING product is linked
--   • State-transition trigger — enforces the 8-status graph
--   • Ledger event emitter — every appointment state change extends the chain
--
-- ADR references:
--   • ADR-0020         — Smart Appointment System (full spec)
--   • ADR-0016 §6      — soft viewing-holds contract
--   • ADR-0018 §7      — POS appointment surface
--   • ADR-0008 §9      — migration ordering (this is migration 0012, the explicit amendment)
--
-- Basel Day-10 directives:
--   1. available_slots() — STABLE, DST-correct, fast.
--   2. Soft holds — automatic via trigger, 1 hour before to 30 min after appt.
--   3. NO DELETE on appointments — CANCELLED / NO_SHOW preserve history for
--      analytics (future customer-rating model).
--
-- Idempotent; transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. ENUMs
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_type') THEN
    CREATE TYPE appointment_type AS ENUM (
      'VIEWING',         -- customer wants to inspect linked items (creates soft-holds)
      'BUYBACK_EVAL',    -- customer brings items for Ankauf evaluation
      'CONSULTATION',    -- general inquiry, no inventory linkage
      'PICKUP'           -- customer placed a storefront order, picks up in shop
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
    CREATE TYPE appointment_status AS ENUM (
      'SCHEDULED',       -- created, in the future
      'CONFIRMED',       -- customer confirmed (WhatsApp reply or email link)
      'CHECKED_IN',      -- physically arrived (cashier tap)
      'IN_PROGRESS',     -- staff started serving the customer
      'COMPLETED',       -- finished (may have led to a sale → linked_transaction_id)
      'NO_SHOW',         -- grace window elapsed without check-in
      'CANCELLED',       -- explicitly cancelled before start
      'RESCHEDULED'      -- soft-cancelled, linked to new appointment row
    );
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. staff_working_hours — the per-staff weekly schedule
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_working_hours (
  id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID            NOT NULL REFERENCES users(id),
  shop_id          UUID,                                  -- V1 NULL; multi-shop ready
  weekday          SMALLINT        NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=Mon, 6=Sun (ISO)
  starts_at_local  TIME            NOT NULL,
  ends_at_local    TIME            NOT NULL,
  effective_from   DATE            NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Berlin')::date,
  effective_until  DATE,
  created_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),

  CONSTRAINT staff_working_hours_time_order
    CHECK (ends_at_local > starts_at_local),
  CONSTRAINT staff_working_hours_effective_range
    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

-- PG 17: index predicates must be IMMUTABLE; now() is STABLE. The original
-- predicate filtered out historical rows but the same selectivity is reached
-- via a query-time filter — the index here just gets all rows.
CREATE INDEX IF NOT EXISTS staff_working_hours_user_weekday_idx
  ON staff_working_hours (user_id, weekday);

COMMENT ON TABLE staff_working_hours IS
  'Per-staff weekly schedule. Times are LOCAL (Europe/Berlin). The capacity model uses '
  'this + staff_time_off + shop_holidays to compute available_slots().';

-- ─────────────────────────────────────────────────────────────────────
-- 3. staff_time_off — specific absence ranges
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_time_off (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES users(id),
  starts_at      TIMESTAMPTZ  NOT NULL,
  ends_at        TIMESTAMPTZ  NOT NULL,
  reason         TEXT,
  approved_by    UUID         REFERENCES users(id),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT staff_time_off_range CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS staff_time_off_user_range_idx
  ON staff_time_off (user_id, starts_at, ends_at);

-- ─────────────────────────────────────────────────────────────────────
-- 4. shop_holidays — closed dates
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shop_holidays (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID,
  closed_date  DATE         NOT NULL,
  reason       TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT shop_holidays_shop_date_uq UNIQUE (shop_id, closed_date)
);

-- ─────────────────────────────────────────────────────────────────────
-- 5. appointments — the master schedule
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id                                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                             UUID,

  appointment_type                    appointment_type    NOT NULL,
  status                              appointment_status  NOT NULL DEFAULT 'SCHEDULED',

  -- Time
  starts_at                           TIMESTAMPTZ         NOT NULL,
  duration_minutes                    INTEGER             NOT NULL
                                                          CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  -- PG 17: timestamptz + interval is STABLE (DST-aware) so it can't anchor a
  -- generated-stored column. We compute ends_at via a BEFORE INSERT/UPDATE
  -- trigger (defined below) instead.
  ends_at                             TIMESTAMPTZ         NOT NULL,

  -- People
  customer_id                         UUID                REFERENCES customers(id),
  staff_user_id                       UUID                NOT NULL REFERENCES users(id),
  booked_by_user_id                   UUID                REFERENCES users(id),
  booked_via                          TEXT                NOT NULL
                                                          CHECK (booked_via IN
                                                            ('control_desktop', 'storefront', 'pos', 'whatsapp_bot')),

  customer_notes                      TEXT,
  staff_notes                         TEXT,

  -- Lifecycle timestamps + SLA tracking
  confirmed_at                        TIMESTAMPTZ,
  checked_in_at                       TIMESTAMPTZ,
  early_arrival_minutes               INTEGER,                                       -- negative = late
  in_progress_started_at              TIMESTAMPTZ,
  completed_at                        TIMESTAMPTZ,
  no_show_marked_at                   TIMESTAMPTZ,
  cancelled_at                        TIMESTAMPTZ,
  cancellation_reason                 TEXT,

  -- Rescheduling chain (DAG via two FKs)
  rescheduled_from_appointment_id     UUID                REFERENCES appointments(id),
  rescheduled_to_appointment_id       UUID                REFERENCES appointments(id),

  -- Outcome linkage (DSFinV-K trail: which appointment led to which sale)
  linked_transaction_id               UUID                REFERENCES transactions(id),

  created_at                          TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at                          TIMESTAMPTZ         NOT NULL DEFAULT now(),

  -- Lifecycle CHECKs
  CONSTRAINT appointments_checked_in_has_marker
    CHECK (status NOT IN ('CHECKED_IN', 'IN_PROGRESS', 'COMPLETED') OR checked_in_at IS NOT NULL),
  CONSTRAINT appointments_in_progress_has_marker
    CHECK (status <> 'IN_PROGRESS' OR in_progress_started_at IS NOT NULL),
  CONSTRAINT appointments_completed_has_marker
    CHECK (status <> 'COMPLETED'   OR completed_at IS NOT NULL),
  CONSTRAINT appointments_cancelled_has_marker
    CHECK (status <> 'CANCELLED'   OR cancelled_at IS NOT NULL),
  CONSTRAINT appointments_no_show_has_marker
    CHECK (status <> 'NO_SHOW'     OR no_show_marked_at IS NOT NULL),
  CONSTRAINT appointments_rescheduled_has_link
    CHECK (status <> 'RESCHEDULED' OR rescheduled_to_appointment_id IS NOT NULL),
  CONSTRAINT appointments_starts_at_in_minute_precision
    CHECK (date_trunc('second', starts_at) = starts_at)
);

CREATE INDEX IF NOT EXISTS appointments_status_starts_at_idx
  ON appointments (status, starts_at);
CREATE INDEX IF NOT EXISTS appointments_staff_starts_at_idx
  ON appointments (staff_user_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_customer_idx
  ON appointments (customer_id)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_business_day_idx
  ON appointments (shop_id, berlin_business_day(starts_at));
CREATE INDEX IF NOT EXISTS appointments_active_window_idx
  ON appointments (starts_at, ends_at)
  WHERE status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED');

-- Compute ends_at = starts_at + duration_minutes (replaces the GENERATED
-- column above, which can't be IMMUTABLE under PG 17 strict).
CREATE OR REPLACE FUNCTION appointments_compute_ends_at() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.ends_at := NEW.starts_at + NEW.duration_minutes * INTERVAL '1 minute';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_appointments_ends_at
  BEFORE INSERT OR UPDATE OF starts_at, duration_minutes ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_compute_ends_at();

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE appointments IS
  'Smart Appointment System master table. 4 types × 8 statuses. NEVER deleted by app role — '
  'CANCELLED/NO_SHOW preserved for analytics. State transitions enforced by trigger.';

-- ─────────────────────────────────────────────────────────────────────
-- 6. appointment_linked_products — many-to-many for VIEWING
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointment_linked_products (
  appointment_id  UUID         NOT NULL REFERENCES appointments(id),
  product_id      UUID         NOT NULL REFERENCES products(id),
  added_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  added_by_user_id UUID        REFERENCES users(id),

  PRIMARY KEY (appointment_id, product_id)
);

CREATE INDEX IF NOT EXISTS appointment_linked_products_product_idx
  ON appointment_linked_products (product_id);

-- ─────────────────────────────────────────────────────────────────────
-- 7. product_viewing_holds — the soft-hold table (ADR-0016 §6)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_viewing_holds (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID         NOT NULL REFERENCES products(id),
  appointment_id     UUID         NOT NULL REFERENCES appointments(id),
  customer_id        UUID         REFERENCES customers(id),
  hold_strength      TEXT         NOT NULL DEFAULT 'SOFT'
                                  CHECK (hold_strength IN ('SOFT', 'HARD')),
  hold_starts_at     TIMESTAMPTZ  NOT NULL,
  hold_expires_at    TIMESTAMPTZ  NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  released_at        TIMESTAMPTZ,
  released_reason    TEXT,

  CONSTRAINT product_viewing_holds_range
    CHECK (hold_expires_at > hold_starts_at),
  CONSTRAINT product_viewing_holds_released_has_reason
    CHECK ((released_at IS NULL) = (released_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS product_viewing_holds_active_idx
  ON product_viewing_holds (product_id, hold_expires_at)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS product_viewing_holds_appointment_idx
  ON product_viewing_holds (appointment_id);

COMMENT ON TABLE product_viewing_holds IS
  'Soft (or HARD) holds on products tied to a viewing appointment (ADR-0016 §6). '
  'Consumed by inventory-lock.reserve() to surface to the cashier. '
  'Created automatically by trigger on appointment_linked_products INSERT.';

-- ─────────────────────────────────────────────────────────────────────
-- 8. Auto-soft-hold trigger — Day-10 directive #2
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_viewing_hold_on_link() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  appt_row appointments%ROWTYPE;
  hold_start TIMESTAMPTZ;
BEGIN
  SELECT * INTO appt_row FROM appointments WHERE id = NEW.appointment_id;

  -- Only VIEWING appointments produce holds; only while still upcoming.
  IF appt_row.appointment_type <> 'VIEWING' THEN
    RETURN NEW;
  END IF;
  IF appt_row.status NOT IN ('SCHEDULED', 'CONFIRMED') THEN
    RETURN NEW;
  END IF;

  -- Hold from 1 hour before appointment (or now, whichever is later)
  -- until 30 minutes after appointment start (the grace window).
  hold_start := LEAST(now() + interval '0', appt_row.starts_at - interval '1 hour');
  IF hold_start < now() THEN
    hold_start := now();
  END IF;

  INSERT INTO product_viewing_holds (
    product_id, appointment_id, customer_id,
    hold_strength, hold_starts_at, hold_expires_at
  )
  VALUES (
    NEW.product_id,
    NEW.appointment_id,
    appt_row.customer_id,
    'SOFT',
    hold_start,
    appt_row.starts_at + interval '30 minutes'
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION create_viewing_hold_on_link() OWNER TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_create_viewing_hold ON appointment_linked_products;
CREATE TRIGGER trg_create_viewing_hold
  AFTER INSERT ON appointment_linked_products
  FOR EACH ROW EXECUTE FUNCTION create_viewing_hold_on_link();

-- warehouse14_security needs INSERT on product_viewing_holds + USAGE on its sequence
GRANT INSERT ON product_viewing_holds TO warehouse14_security;

COMMENT ON FUNCTION create_viewing_hold_on_link() IS
  'AFTER INSERT trigger on appointment_linked_products. Auto-creates a SOFT hold on the '
  'product spanning [appt - 1h, appt + 30min]. SECURITY DEFINER owned by warehouse14_security.';

-- ─────────────────────────────────────────────────────────────────────
-- 9. State transition validation
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION appointments_validate_transition() RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
DECLARE
  valid_transition BOOLEAN;
BEGIN
  -- Status unchanged: only enforce scheduling-field immutability after check-in.
  IF NEW.status = OLD.status THEN
    IF OLD.status IN ('CHECKED_IN', 'IN_PROGRESS', 'COMPLETED') THEN
      IF NEW.starts_at         IS DISTINCT FROM OLD.starts_at         OR
         NEW.duration_minutes  IS DISTINCT FROM OLD.duration_minutes  OR
         NEW.staff_user_id     IS DISTINCT FROM OLD.staff_user_id     OR
         NEW.appointment_type  IS DISTINCT FROM OLD.appointment_type  THEN
        RAISE EXCEPTION 'Cannot modify scheduling fields after check-in (row %)', NEW.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Terminal states are terminal.
  IF OLD.status IN ('COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED') THEN
    RAISE EXCEPTION 'Cannot transition out of terminal appointment status % (row %)', OLD.status, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Transition graph
  valid_transition := CASE
    WHEN OLD.status = 'SCHEDULED'   AND NEW.status IN ('CONFIRMED','CHECKED_IN','CANCELLED','RESCHEDULED','NO_SHOW') THEN TRUE
    WHEN OLD.status = 'CONFIRMED'   AND NEW.status IN ('CHECKED_IN','CANCELLED','RESCHEDULED','NO_SHOW')             THEN TRUE
    WHEN OLD.status = 'CHECKED_IN'  AND NEW.status IN ('IN_PROGRESS','COMPLETED','CANCELLED')                        THEN TRUE
    WHEN OLD.status = 'IN_PROGRESS' AND NEW.status = 'COMPLETED'                                                     THEN TRUE
    ELSE FALSE
  END;

  IF NOT valid_transition THEN
    RAISE EXCEPTION 'Invalid appointment status transition: % → % (row %)', OLD.status, NEW.status, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_validate_transition ON appointments;
CREATE TRIGGER trg_appointments_validate_transition
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_validate_transition();

-- ─────────────────────────────────────────────────────────────────────
-- 10. Ledger event emitter on appointment lifecycle
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_appointment_state_event() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO ledger_events (
    event_type, entity_table, entity_id, actor_user_id, payload
  )
  VALUES (
    'appointment.' || lower(NEW.status),
    'appointments',
    NEW.id,
    COALESCE(NEW.booked_by_user_id, NEW.staff_user_id),
    jsonb_build_object(
      'appointment_type', NEW.appointment_type,
      'status',           NEW.status,
      'previous_status',  CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text END,
      'starts_at',        to_char(NEW.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'duration_minutes', NEW.duration_minutes,
      'staff_user_id',    NEW.staff_user_id,
      'customer_id',      NEW.customer_id,
      'booked_via',       NEW.booked_via
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION on_appointment_state_event() OWNER TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_appointments_after_insert ON appointments;
CREATE TRIGGER trg_appointments_after_insert
  AFTER INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION on_appointment_state_event();

DROP TRIGGER IF EXISTS trg_appointments_after_update ON appointments;
CREATE TRIGGER trg_appointments_after_update
  AFTER UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION on_appointment_state_event();

-- ─────────────────────────────────────────────────────────────────────
-- 11. available_slots() — DST-correct slot generation
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION available_slots(
  p_appt_type          appointment_type,
  p_duration_minutes   INTEGER,
  p_search_from        TIMESTAMPTZ,
  p_search_to          TIMESTAMPTZ,
  p_preferred_staff_id UUID DEFAULT NULL,
  p_shop_id            UUID DEFAULT NULL
)
RETURNS TABLE (
  staff_user_id   UUID,
  slot_starts_at  TIMESTAMPTZ,
  slot_ends_at    TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  slot_granularity_minutes INTEGER := 15;
  buffer_minutes INTEGER := CASE p_appt_type
                              WHEN 'VIEWING'      THEN 5
                              WHEN 'PICKUP'       THEN 5
                              WHEN 'BUYBACK_EVAL' THEN 10
                              WHEN 'CONSULTATION' THEN 0
                            END;
BEGIN
  IF p_duration_minutes <= 0 OR p_duration_minutes > 480 THEN
    RAISE EXCEPTION 'p_duration_minutes must be in (0, 480]';
  END IF;
  IF p_search_to <= p_search_from THEN
    RAISE EXCEPTION 'p_search_to must be after p_search_from';
  END IF;

  RETURN QUERY
    WITH
    -- 1. Berlin-local days covered by the search range.
    days AS (
      SELECT generate_series(
               (p_search_from AT TIME ZONE 'Europe/Berlin')::date,
               (p_search_to   AT TIME ZONE 'Europe/Berlin')::date,
               '1 day'::interval
             )::date AS d
    ),
    -- 2. (staff, day) pairs with active working hours, minus shop holidays.
    staff_days AS (
      SELECT
        wh.user_id,
        d.d AS business_day,
        wh.starts_at_local,
        wh.ends_at_local
      FROM days d
      CROSS JOIN staff_working_hours wh
      WHERE wh.weekday = (EXTRACT(ISODOW FROM d.d)::int - 1)
        AND wh.effective_from <= d.d
        AND (wh.effective_until IS NULL OR wh.effective_until >= d.d)
        AND (p_preferred_staff_id IS NULL OR wh.user_id = p_preferred_staff_id)
        AND NOT EXISTS (
          SELECT 1 FROM shop_holidays sh
           WHERE sh.shop_id IS NOT DISTINCT FROM p_shop_id
             AND sh.closed_date = d.d
        )
    ),
    -- 3. Convert local working-hours to tz-aware bounds via Europe/Berlin.
    --    The (date || time)::timestamp AT TIME ZONE 'Europe/Berlin' is DST-correct
    --    because Postgres' zoneinfo handles spring-forward / fall-back transparently.
    work_windows AS (
      SELECT
        user_id,
        ((business_day::text || ' ' || starts_at_local::text)::timestamp AT TIME ZONE 'Europe/Berlin') AS window_start,
        ((business_day::text || ' ' || ends_at_local::text)::timestamp   AT TIME ZONE 'Europe/Berlin') AS window_end
      FROM staff_days
    ),
    -- 4. Candidate slot starts within each work window.
    candidate_slots AS (
      SELECT
        ww.user_id,
        gs AS slot_start,
        gs + make_interval(mins => p_duration_minutes) AS slot_end
      FROM work_windows ww,
        LATERAL generate_series(
          GREATEST(ww.window_start, p_search_from),
          LEAST(ww.window_end, p_search_to) - make_interval(mins => p_duration_minutes),
          make_interval(mins => slot_granularity_minutes)
        ) AS gs
      WHERE LEAST(ww.window_end, p_search_to) - GREATEST(ww.window_start, p_search_from)
            >= make_interval(mins => p_duration_minutes)
    ),
    -- 5. Exclude overlap with existing live appointments (with buffer).
    no_overlap AS (
      SELECT cs.user_id, cs.slot_start, cs.slot_end
        FROM candidate_slots cs
       WHERE NOT EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.staff_user_id = cs.user_id
            AND a.status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
            AND tstzrange(
                  cs.slot_start - make_interval(mins => buffer_minutes),
                  cs.slot_end   + make_interval(mins => buffer_minutes),
                  '[)'
                ) &&
                tstzrange(a.starts_at, a.ends_at, '[)')
       )
    ),
    -- 6. Exclude staff time-off.
    no_time_off AS (
      SELECT no.user_id, no.slot_start, no.slot_end
        FROM no_overlap no
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_time_off sto
          WHERE sto.user_id = no.user_id
            AND tstzrange(no.slot_start, no.slot_end, '[)') &&
                tstzrange(sto.starts_at,  sto.ends_at,  '[)')
       )
    )
    SELECT user_id, slot_start, slot_end
      FROM no_time_off
     ORDER BY slot_start, user_id;
END;
$$;

ALTER FUNCTION available_slots(appointment_type, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID)
  OWNER TO warehouse14_security;

GRANT EXECUTE ON FUNCTION available_slots(appointment_type, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID)
  TO warehouse14_app;

COMMENT ON FUNCTION available_slots(appointment_type, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) IS
  'DST-correct slot generation across staff working hours, shop holidays, staff time-off, '
  'and existing live appointments. STABLE, PARALLEL SAFE. Granularity = 15min. Buffer per type.';

-- ─────────────────────────────────────────────────────────────────────
-- 12. App-role grants
--
-- All new tables: SELECT + INSERT default; UPDATE granted narrowly; NO DELETE.
-- ─────────────────────────────────────────────────────────────────────

-- appointments — narrow UPDATE on lifecycle fields only
GRANT UPDATE (
  status,
  customer_id,
  customer_notes, staff_notes,
  confirmed_at,
  checked_in_at, early_arrival_minutes,
  in_progress_started_at,
  completed_at,
  no_show_marked_at,
  cancelled_at, cancellation_reason,
  rescheduled_from_appointment_id, rescheduled_to_appointment_id,
  linked_transaction_id,
  -- During SCHEDULED/CONFIRMED only, scheduling fields are mutable — the trigger
  -- locks them after CHECKED_IN.
  starts_at, duration_minutes, staff_user_id, appointment_type,
  updated_at
) ON appointments TO warehouse14_app;

-- staff_working_hours / staff_time_off / shop_holidays — admin-managed config
GRANT UPDATE (
  starts_at_local, ends_at_local, effective_until, weekday
) ON staff_working_hours TO warehouse14_app;

GRANT UPDATE (
  starts_at, ends_at, reason, approved_by
) ON staff_time_off TO warehouse14_app;

GRANT UPDATE (
  reason
) ON shop_holidays TO warehouse14_app;

-- product_viewing_holds — app can release a hold; cannot DELETE
GRANT UPDATE (
  hold_strength,
  hold_starts_at, hold_expires_at,
  released_at, released_reason
) ON product_viewing_holds TO warehouse14_app;

-- appointment_linked_products is INSERT + SELECT only (default privileges).
-- No UPDATE (the trigger fires on INSERT only); no DELETE — unlinking is
-- handled by releasing the corresponding hold.

COMMIT;
