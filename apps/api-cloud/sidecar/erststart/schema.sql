--
-- PostgreSQL database dump
--


-- Dumped from database version 17.10 (Debian 17.10-1.pgdg12+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: appointment_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.appointment_status AS ENUM (
    'SCHEDULED',
    'CONFIRMED',
    'CHECKED_IN',
    'IN_PROGRESS',
    'COMPLETED',
    'NO_SHOW',
    'CANCELLED',
    'RESCHEDULED'
);


ALTER TYPE public.appointment_status OWNER TO warehouse14_migrator;

--
-- Name: appointment_type; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.appointment_type AS ENUM (
    'VIEWING',
    'BUYBACK_EVAL',
    'CONSULTATION',
    'PICKUP'
);


ALTER TYPE public.appointment_type OWNER TO warehouse14_migrator;

--
-- Name: appraisal_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.appraisal_status AS ENUM (
    'DRAFT',
    'COMPLETED',
    'ACCEPTED',
    'REJECTED',
    'EXPIRED'
);


ALTER TYPE public.appraisal_status OWNER TO warehouse14_migrator;

--
-- Name: TYPE appraisal_status; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.appraisal_status IS 'State machine for the estate appraisal (Bewertung) workflow. Day 22.';


--
-- Name: belegtext_kind; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.belegtext_kind AS ENUM (
    'MARGIN_25A',
    'STANDARD_19',
    'REDUCED_7',
    'INVESTMENT_GOLD_25C',
    'KLEINUNTERNEHMER_19',
    'ANKAUFBELEG_DECLARATION',
    'GENERIC_HEADER',
    'GENERIC_FOOTER',
    'REVERSE_CHARGE_13B'
);


ALTER TYPE public.belegtext_kind OWNER TO warehouse14_migrator;

--
-- Name: TYPE belegtext_kind; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.belegtext_kind IS 'Discriminator for receipt/invoice legal-text blocks. The first four mirror tax_treatment_codes; the last four are universal.';


--
-- Name: cart_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.cart_status AS ENUM (
    'ACTIVE',
    'CHECKOUT',
    'ABANDONED',
    'CONVERTED',
    'RESERVED',
    'CANCELLED'
);


ALTER TYPE public.cart_status OWNER TO warehouse14_migrator;

--
-- Name: cash_movement_direction; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.cash_movement_direction AS ENUM (
    'OPENING_FLOAT',
    'INJECTION',
    'BANK_DROP',
    'SAFE_TRANSIT',
    'CLOSING_RECONCILIATION'
);


ALTER TYPE public.cash_movement_direction OWNER TO warehouse14_migrator;

--
-- Name: TYPE cash_movement_direction; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.cash_movement_direction IS 'OPENING_FLOAT = initial Wechselgeld; INJECTION = mid-shift cash added; BANK_DROP = cash leaves drawer to bank; SAFE_TRANSIT = drawer ↔ safe; CLOSING_RECONCILIATION = end-of-shift drawer count vs expected.';


--
-- Name: closing_state; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.closing_state AS ENUM (
    'COUNTING',
    'FINALIZED'
);


ALTER TYPE public.closing_state OWNER TO warehouse14_migrator;

--
-- Name: customer_trust_level; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.customer_trust_level AS ENUM (
    'NEW',
    'VERIFIED',
    'VIP',
    'SUSPICIOUS',
    'BANNED'
);


ALTER TYPE public.customer_trust_level OWNER TO warehouse14_migrator;

--
-- Name: TYPE customer_trust_level; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.customer_trust_level IS 'Operator business judgement of the customer. Orthogonal to kyc_status (legal document state). Promotion to VERIFIED/VIP requires a physical ID check (kyc_verified_at set).';


--
-- Name: device_class; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.device_class AS ENUM (
    'POS_TERMINAL',
    'CONTROL_DESKTOP',
    'ADMIN_WEB_BROWSER',
    'WORKER'
);


ALTER TYPE public.device_class OWNER TO warehouse14_migrator;

--
-- Name: TYPE device_class; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.device_class IS 'Physical/logical device categories with distinct mTLS lifetimes (ADR-0014 §2).';


--
-- Name: device_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.device_status AS ENUM (
    'active',
    'revoked',
    'expired'
);


ALTER TYPE public.device_status OWNER TO warehouse14_migrator;

--
-- Name: TYPE device_status; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.device_status IS 'Lifecycle state of a paired device. Revoked devices are blocked at the API guard (ADR-0014 §3).';


--
-- Name: document_category; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.document_category AS ENUM (
    'AUSWEIS',
    'ANKAUFBELEG',
    'RECHNUNG',
    'EXPERTISE',
    'ZERTIFIKAT',
    'VERSANDBELEG'
);


ALTER TYPE public.document_category OWNER TO warehouse14_migrator;

--
-- Name: TYPE document_category; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.document_category IS 'Six German document classes Owner needs to file against an entity. Category-specific CHECKs encode required link semantics (AUSWEIS ⇒ customer; VERSANDBELEG ⇒ transaction; etc.).';


--
-- Name: dsfinvk_export_state; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.dsfinvk_export_state AS ENUM (
    'GENERATING',
    'GENERATED',
    'DELIVERED_TO_STEUERBERATER',
    'FAILED'
);


ALTER TYPE public.dsfinvk_export_state OWNER TO warehouse14_migrator;

--
-- Name: ebay_listing_state; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.ebay_listing_state AS ENUM (
    'ENTWURF',
    'GEPRUEFT',
    'ONLINE',
    'VERKAUFT',
    'BEZAHLT',
    'VERPACKT',
    'VERSENDET',
    'REKLAMIERT',
    'RETOURNIERT',
    'BEENDET'
);


ALTER TYPE public.ebay_listing_state OWNER TO warehouse14_migrator;

--
-- Name: TYPE ebay_listing_state; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.ebay_listing_state IS 'Owner-defined 9-stage eBay listing lifecycle. Transitions audited via product_ebay_listing_events. State VERKAUFT and beyond auto-reserves the local product via enforce_ebay_sold_reserves_locally trigger.';


--
-- Name: expense_category; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.expense_category AS ENUM (
    'WARENEINKAUF',
    'MIETE',
    'MARKETING',
    'VERSAND',
    'BUEROMATERIAL',
    'REPARATUR',
    'GEBUEHREN',
    'REISEKOSTEN',
    'SONSTIGES'
);


ALTER TYPE public.expense_category OWNER TO warehouse14_migrator;

--
-- Name: TYPE expense_category; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.expense_category IS 'Nine broad Betriebsausgaben classes for one-off operating_expenses rows.';


--
-- Name: fulfilment_method; Type: TYPE; Schema: public; Owner: warehouse14
--

CREATE TYPE public.fulfilment_method AS ENUM (
    'PICKUP',
    'SHIPPING'
);


ALTER TYPE public.fulfilment_method OWNER TO warehouse14;

--
-- Name: fulfilment_status; Type: TYPE; Schema: public; Owner: warehouse14
--

CREATE TYPE public.fulfilment_status AS ENUM (
    'NOT_REQUIRED',
    'AWAITING_PAYMENT',
    'READY_TO_PACK',
    'PACKED',
    'SHIPPED',
    'DELIVERED',
    'RETURNED'
);


ALTER TYPE public.fulfilment_status OWNER TO warehouse14;

--
-- Name: id_document_type; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.id_document_type AS ENUM (
    'PERSONALAUSWEIS',
    'REISEPASS',
    'EU_NATIONAL_ID',
    'AUFENTHALTSTITEL',
    'PASSPORT_NON_EU'
);


ALTER TYPE public.id_document_type OWNER TO warehouse14_migrator;

--
-- Name: inventory_scan_match; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.inventory_scan_match AS ENUM (
    'MATCHED',
    'UNKNOWN_BARCODE',
    'DUPLICATE',
    'EXPECTED_BUT_SOLD',
    'UNEXPECTED'
);


ALTER TYPE public.inventory_scan_match OWNER TO warehouse14_migrator;

--
-- Name: inventory_session_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.inventory_session_status AS ENUM (
    'OPEN',
    'CLOSED'
);


ALTER TYPE public.inventory_session_status OWNER TO warehouse14_migrator;

--
-- Name: item_type; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.item_type AS ENUM (
    'gold_jewelry',
    'gold_coin',
    'gold_bar',
    'silver_jewelry',
    'silver_coin',
    'silver_bar',
    'platinum_jewelry',
    'platinum_coin',
    'platinum_bar',
    'antique',
    'watch',
    'other'
);


ALTER TYPE public.item_type OWNER TO warehouse14_migrator;

--
-- Name: kyc_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.kyc_status AS ENUM (
    'NOT_REQUIRED',
    'PENDING',
    'CAPTURED',
    'VERIFIED',
    'EXPIRED',
    'REJECTED'
);


ALTER TYPE public.kyc_status OWNER TO warehouse14_migrator;

--
-- Name: TYPE kyc_status; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.kyc_status IS 'Customer KYC lifecycle (ADR-0007, ADR-0018 §6).';


--
-- Name: metal_price_source; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.metal_price_source AS ENUM (
    'LBMA',
    'XAUEUR_VENDOR',
    'MANUAL',
    'INTERNAL_ESTIMATE'
);


ALTER TYPE public.metal_price_source OWNER TO warehouse14_migrator;

--
-- Name: TYPE metal_price_source; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.metal_price_source IS 'Provenance of a metal_prices row. MANUAL requires audit_log + reason.';


--
-- Name: order_origin; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.order_origin AS ENUM (
    'WEBSHOP',
    'APP'
);


ALTER TYPE public.order_origin OWNER TO warehouse14_migrator;

--
-- Name: payment_intent_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.payment_intent_status AS ENUM (
    'CREATED',
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'CANCELED',
    'EXPIRED'
);


ALTER TYPE public.payment_intent_status OWNER TO warehouse14_migrator;

--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.payment_method AS ENUM (
    'CASH',
    'ZVT_CARD',
    'SUMUP',
    'MOLLIE',
    'STRIPE',
    'EBAY',
    'BANK_TRANSFER',
    'VOUCHER',
    'TRADE_IN',
    'DEBT',
    'STRIPE_TERMINAL'
);


ALTER TYPE public.payment_method OWNER TO warehouse14_migrator;

--
-- Name: payment_provider; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.payment_provider AS ENUM (
    'STRIPE',
    'PAYPAL',
    'MOLLIE'
);


ALTER TYPE public.payment_provider OWNER TO warehouse14_migrator;

--
-- Name: photo_source; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.photo_source AS ENUM (
    'intake',
    'admin_upload',
    'storefront_user',
    'photographer',
    'phone_intake'
);


ALTER TYPE public.photo_source OWNER TO warehouse14_migrator;

--
-- Name: photo_workflow_state; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.photo_workflow_state AS ENUM (
    'FOTOGRAFIERT',
    'BEARBEITET',
    'FREIGESTELLT',
    'ZUGEORDNET',
    'FUER_EBAY_BEREIT'
);


ALTER TYPE public.photo_workflow_state OWNER TO warehouse14_migrator;

--
-- Name: TYPE photo_workflow_state; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.photo_workflow_state IS 'Owner-defined 5-stage photo lifecycle. NEVER skip a state; the route layer is the gatekeeper for transitions.';


--
-- Name: pickup_stage; Type: TYPE; Schema: public; Owner: warehouse14
--

CREATE TYPE public.pickup_stage AS ENUM (
    'OFFEN',
    'ANGENOMMEN',
    'IN_VORBEREITUNG',
    'ABHOLBEREIT',
    'ABGEHOLT'
);


ALTER TYPE public.pickup_stage OWNER TO warehouse14;

--
-- Name: product_condition; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.product_condition AS ENUM (
    'NEW',
    'USED_EXCELLENT',
    'USED_GOOD',
    'USED_FAIR',
    'ANTIQUE_RESTORED',
    'ANTIQUE_AS_FOUND'
);


ALTER TYPE public.product_condition OWNER TO warehouse14_migrator;

--
-- Name: TYPE product_condition; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.product_condition IS 'Physical condition. 6 values cover gold + coin + antique + watch grading. ADR-0023.';


--
-- Name: product_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.product_status AS ENUM (
    'DRAFT',
    'AVAILABLE',
    'RESERVED',
    'SOLD'
);


ALTER TYPE public.product_status OWNER TO warehouse14_migrator;

--
-- Name: TYPE product_status; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.product_status IS '4-state machine per ADR-0016 §1. No other states exist.';


--
-- Name: reservation_channel; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.reservation_channel AS ENUM (
    'POS',
    'STOREFRONT',
    'EBAY',
    'WEB_RESERVATION'
);


ALTER TYPE public.reservation_channel OWNER TO warehouse14_migrator;

--
-- Name: TYPE reservation_channel; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.reservation_channel IS 'The 3 channels permitted to win a reservation race (ADR-0016 §4).';


--
-- Name: sales_channel; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.sales_channel AS ENUM (
    'POS',
    'WEB',
    'EBAY',
    'PHONE'
);


ALTER TYPE public.sales_channel OWNER TO warehouse14_migrator;

--
-- Name: shift_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.shift_status AS ENUM (
    'OPEN',
    'CLOSED'
);


ALTER TYPE public.shift_status OWNER TO warehouse14_migrator;

--
-- Name: shipment_status; Type: TYPE; Schema: public; Owner: warehouse14
--

CREATE TYPE public.shipment_status AS ENUM (
    'DRAFT',
    'LABEL_PURCHASED',
    'HANDED_OVER',
    'IN_TRANSIT',
    'DELIVERED',
    'RETURNED',
    'CANCELLED',
    'FAILED'
);


ALTER TYPE public.shipment_status OWNER TO warehouse14;

--
-- Name: shipping_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.shipping_status AS ENUM (
    'NOT_REQUIRED',
    'PENDING',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'RETURNED'
);


ALTER TYPE public.shipping_status OWNER TO warehouse14_migrator;

--
-- Name: task_priority; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.task_priority AS ENUM (
    'LOW',
    'NORMAL',
    'HIGH',
    'URGENT'
);


ALTER TYPE public.task_priority OWNER TO warehouse14_migrator;

--
-- Name: TYPE task_priority; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.task_priority IS 'Operator-set urgency. URGENT surfaces on the dashboard banner.';


--
-- Name: task_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.task_status AS ENUM (
    'OPEN',
    'IN_PROGRESS',
    'BLOCKED',
    'DONE',
    'CANCELLED'
);


ALTER TYPE public.task_status OWNER TO warehouse14_migrator;

--
-- Name: TYPE task_status; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.task_status IS '5-state lifecycle. CHECK constraints enforce evidence per transition.';


--
-- Name: transaction_direction; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.transaction_direction AS ENUM (
    'VERKAUF',
    'ANKAUF'
);


ALTER TYPE public.transaction_direction OWNER TO warehouse14_migrator;

--
-- Name: TYPE transaction_direction; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.transaction_direction IS 'VERKAUF=we sell to customer; ANKAUF=we buy from customer (always KYC per ADR-0007).';


--
-- Name: tse_archive_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.tse_archive_status AS ENUM (
    'GENERATING',
    'GENERATED',
    'FAILED'
);


ALTER TYPE public.tse_archive_status OWNER TO warehouse14_migrator;

--
-- Name: tse_state; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.tse_state AS ENUM (
    'QUEUED_OFFLINE',
    'ACTIVE',
    'FINISHED',
    'CANCELLED',
    'FAILED'
);


ALTER TYPE public.tse_state OWNER TO warehouse14_migrator;

--
-- Name: TYPE tse_state; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.tse_state IS 'TSE lifecycle. QUEUED_OFFLINE supports offline-resilient sales per memory.md §3. Terminal states: FINISHED, CANCELLED, FAILED.';


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.user_role AS ENUM (
    'ADMIN',
    'CASHIER',
    'READONLY'
);


ALTER TYPE public.user_role OWNER TO warehouse14_migrator;

--
-- Name: TYPE user_role; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.user_role IS 'Warehouse14 RBAC roles (ADR-0008 §3, memory.md §3).';


--
-- Name: vat_check_result; Type: TYPE; Schema: public; Owner: t001_migrator
--

CREATE TYPE public.vat_check_result AS ENUM (
    'GUELTIG',
    'UNGUELTIG',
    'NICHT_ERREICHBAR',
    'FORMFEHLER'
);


ALTER TYPE public.vat_check_result OWNER TO t001_migrator;

--
-- Name: voucher_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.voucher_status AS ENUM (
    'ACTIVE',
    'REDEEMED',
    'EXPIRED',
    'REVOKED'
);


ALTER TYPE public.voucher_status OWNER TO warehouse14_migrator;

--
-- Name: voucher_type; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.voucher_type AS ENUM (
    'SINGLE_PURPOSE',
    'MULTI_PURPOSE'
);


ALTER TYPE public.voucher_type OWNER TO warehouse14_migrator;

--
-- Name: TYPE voucher_type; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TYPE public.voucher_type IS '§ 3 Abs. 14 UStG: SINGLE_PURPOSE = definite product/tax → VAT at issuance. MULTI_PURPOSE = redeemable for anything → VAT at redemption.';


--
-- Name: worker_job_status; Type: TYPE; Schema: public; Owner: warehouse14_migrator
--

CREATE TYPE public.worker_job_status AS ENUM (
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'TIMEOUT',
    'SKIPPED'
);


ALTER TYPE public.worker_job_status OWNER TO warehouse14_migrator;

--
-- Name: appointments_compute_ends_at(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.appointments_compute_ends_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.ends_at := NEW.starts_at + NEW.duration_minutes * INTERVAL '1 minute';
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.appointments_compute_ends_at() OWNER TO warehouse14_migrator;

--
-- Name: appointments_validate_transition(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.appointments_validate_transition() RETURNS trigger
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


ALTER FUNCTION public.appointments_validate_transition() OWNER TO warehouse14_migrator;

--
-- Name: assign_order_number(); Type: FUNCTION; Schema: public; Owner: warehouse14
--

CREATE FUNCTION public.assign_order_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.order_number IS NULL AND NEW.reserved_at IS NOT NULL THEN
    NEW.order_number :=
      'BST-' || to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY')
            || '-' || lpad(nextval('order_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.assign_order_number() OWNER TO warehouse14;

--
-- Name: available_slots(public.appointment_type, integer, timestamp with time zone, timestamp with time zone, uuid, uuid); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.available_slots(p_appt_type public.appointment_type, p_duration_minutes integer, p_search_from timestamp with time zone, p_search_to timestamp with time zone, p_preferred_staff_id uuid DEFAULT NULL::uuid, p_shop_id uuid DEFAULT NULL::uuid) RETURNS TABLE(staff_user_id uuid, slot_starts_at timestamp with time zone, slot_ends_at timestamp with time zone)
    LANGUAGE plpgsql STABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
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


ALTER FUNCTION public.available_slots(p_appt_type public.appointment_type, p_duration_minutes integer, p_search_from timestamp with time zone, p_search_to timestamp with time zone, p_preferred_staff_id uuid, p_shop_id uuid) OWNER TO warehouse14_security;

--
-- Name: FUNCTION available_slots(p_appt_type public.appointment_type, p_duration_minutes integer, p_search_from timestamp with time zone, p_search_to timestamp with time zone, p_preferred_staff_id uuid, p_shop_id uuid); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.available_slots(p_appt_type public.appointment_type, p_duration_minutes integer, p_search_from timestamp with time zone, p_search_to timestamp with time zone, p_preferred_staff_id uuid, p_shop_id uuid) IS 'DST-correct slot generation across staff working hours, shop holidays, staff time-off, and existing live appointments. STABLE, PARALLEL SAFE. Granularity = 15min. Buffer per type.';


--
-- Name: berlin_business_day(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.berlin_business_day(ts timestamp with time zone) RETURNS date
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN ((ts AT TIME ZONE 'Europe/Berlin'::text))::date;


ALTER FUNCTION public.berlin_business_day(ts timestamp with time zone) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION berlin_business_day(ts timestamp with time zone); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.berlin_business_day(ts timestamp with time zone) IS 'Convert a tz-aware timestamp to the Europe/Berlin business day it falls on. IMMUTABLE — usable in functional indexes. DST-correct via PG zoneinfo. See ADR-0008 §7.';


--
-- Name: blind_index(text); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.blind_index(plaintext text) RETURNS bytea
    LANGUAGE sql STABLE
    AS $$
    SELECT CASE
      WHEN plaintext IS NULL THEN NULL
      ELSE hmac(
        convert_to(plaintext, 'UTF8'),
        convert_to(current_setting('warehouse14.pii_key'), 'UTF8'),
        'sha256'
      )
    END;
  $$;


ALTER FUNCTION public.blind_index(plaintext text) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION blind_index(plaintext text); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.blind_index(plaintext text) IS 'HMAC-SHA256 over normalized PII for exact-match lookup without decryption. Caller MUST normalize (lowercase, E.164, trim) before calling.';


--
-- Name: create_viewing_hold_on_link(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.create_viewing_hold_on_link() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
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


ALTER FUNCTION public.create_viewing_hold_on_link() OWNER TO warehouse14_security;

--
-- Name: FUNCTION create_viewing_hold_on_link(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.create_viewing_hold_on_link() IS 'AFTER INSERT trigger on appointment_linked_products. Auto-creates a SOFT hold on the product spanning [appt - 1h, appt + 30min]. SECURITY DEFINER owned by warehouse14_security.';


--
-- Name: current_metal_price_eur_per_gram(text); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.current_metal_price_eur_per_gram(p_metal text) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
  SELECT price_per_gram_eur
    FROM metal_prices
   WHERE metal = p_metal AND valid_to IS NULL
   LIMIT 1
$$;


ALTER FUNCTION public.current_metal_price_eur_per_gram(p_metal text) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION current_metal_price_eur_per_gram(p_metal text); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.current_metal_price_eur_per_gram(p_metal text) IS 'Returns the CURRENT price per gram in EUR for the given metal. NULL if no row.';


--
-- Name: daily_closings_validate_state(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.daily_closings_validate_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Once FINALIZED → all numeric/count/anchor fields are LOCKED.
  -- Only `notes` (and `updated_at` via trigger) may change.
  IF OLD.state = 'FINALIZED' THEN
    IF NEW.state <> 'FINALIZED' THEN
      RAISE EXCEPTION 'Cannot transition out of FINALIZED closing (row %)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF
      NEW.business_day              IS DISTINCT FROM OLD.business_day              OR
      NEW.shop_id                   IS DISTINCT FROM OLD.shop_id                   OR
      NEW.verkauf_count             IS DISTINCT FROM OLD.verkauf_count             OR
      NEW.ankauf_count              IS DISTINCT FROM OLD.ankauf_count              OR
      NEW.storno_count              IS DISTINCT FROM OLD.storno_count              OR
      NEW.gross_verkauf_eur         IS DISTINCT FROM OLD.gross_verkauf_eur         OR
      NEW.gross_ankauf_eur          IS DISTINCT FROM OLD.gross_ankauf_eur          OR
      NEW.net_verkauf_eur           IS DISTINCT FROM OLD.net_verkauf_eur           OR
      NEW.net_ankauf_eur            IS DISTINCT FROM OLD.net_ankauf_eur            OR
      NEW.vat_by_treatment          IS DISTINCT FROM OLD.vat_by_treatment          OR
      NEW.payments_by_method        IS DISTINCT FROM OLD.payments_by_method        OR
      NEW.cash_drawer_expected_eur  IS DISTINCT FROM OLD.cash_drawer_expected_eur  OR
      NEW.cash_drawer_counted_eur   IS DISTINCT FROM OLD.cash_drawer_counted_eur   OR
      NEW.cash_drawer_variance_eur  IS DISTINCT FROM OLD.cash_drawer_variance_eur  OR
      NEW.tse_finished_count        IS DISTINCT FROM OLD.tse_finished_count        OR
      NEW.tse_pending_count         IS DISTINCT FROM OLD.tse_pending_count         OR
      NEW.tse_failed_count          IS DISTINCT FROM OLD.tse_failed_count          OR
      NEW.ledger_anchor_id          IS DISTINCT FROM OLD.ledger_anchor_id          OR
      NEW.ledger_anchor_hash        IS DISTINCT FROM OLD.ledger_anchor_hash        OR
      NEW.counted_by_user_id        IS DISTINCT FROM OLD.counted_by_user_id        OR
      NEW.counted_at                IS DISTINCT FROM OLD.counted_at                OR
      NEW.finalized_by_user_id      IS DISTINCT FROM OLD.finalized_by_user_id      OR
      NEW.finalized_at              IS DISTINCT FROM OLD.finalized_at              OR
      NEW.created_at                IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Cannot modify FINALIZED closing (row %) — only notes is mutable after finalization', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Valid state transitions: COUNTING → FINALIZED only.
  IF NEW.state <> OLD.state THEN
    IF NOT (OLD.state = 'COUNTING' AND NEW.state = 'FINALIZED') THEN
      RAISE EXCEPTION 'Invalid closing state transition: % → % (row %)', OLD.state, NEW.state, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.daily_closings_validate_state() OWNER TO warehouse14_migrator;

--
-- Name: decrypt_pii(bytea); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.decrypt_pii(ciphertext bytea) RETURNS text
    LANGUAGE sql STABLE
    AS $$
    SELECT CASE
      WHEN ciphertext IS NULL THEN NULL
      ELSE pgp_sym_decrypt(
        ciphertext,
        current_setting('warehouse14.pii_key')
      )
    END;
  $$;


ALTER FUNCTION public.decrypt_pii(ciphertext bytea) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION decrypt_pii(ciphertext bytea); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.decrypt_pii(ciphertext bytea) IS 'Decrypt PII ciphertext using the session-scoped warehouse14.pii_key. NULL passes through. Raises on wrong key or corrupted ciphertext — the app surfaces that as an internal error (never to the user).';


--
-- Name: encrypt_pii(text); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.encrypt_pii(plaintext text) RETURNS bytea
    LANGUAGE sql
    AS $$
    SELECT CASE
      WHEN plaintext IS NULL THEN NULL
      ELSE pgp_sym_encrypt(
        plaintext,
        current_setting('warehouse14.pii_key'),
        'cipher-algo=aes256, compress-algo=2'
      )
    END;
  $$;


ALTER FUNCTION public.encrypt_pii(plaintext text) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION encrypt_pii(plaintext text); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.encrypt_pii(plaintext text) IS 'Encrypt PII text using AES-256 + the session-scoped warehouse14.pii_key. NULL passes through. The key must be set via SET LOCAL before the call (or the function raises). PARALLEL UNSAFE because it reads a GUC.';


--
-- Name: enforce_ebay_sold_reserves_locally(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.enforce_ebay_sold_reserves_locally() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  v_sold_states ebay_listing_state[] := ARRAY[
    'VERKAUFT', 'BEZAHLT', 'VERPACKT', 'VERSENDET'
  ]::ebay_listing_state[];
  v_entering_sold BOOLEAN;
BEGIN
  -- Only act when the state actually moved into the sold-cluster.
  v_entering_sold :=
       NEW.ebay_state IS NOT NULL
   AND NEW.ebay_state = ANY(v_sold_states)
   AND (OLD.ebay_state IS NULL OR OLD.ebay_state <> NEW.ebay_state);

  IF NOT v_entering_sold THEN
    -- Still update timestamp if ebay_state changed at all (e.g. ENTWURF→GEPRUEFT).
    IF NEW.ebay_state IS DISTINCT FROM OLD.ebay_state THEN
      NEW.ebay_state_changed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Stamp the transition time.
  NEW.ebay_state_changed_at := now();

  -- Case 1: locally AVAILABLE → auto-reserve via EBAY channel.
  IF NEW.status = 'AVAILABLE' THEN
    NEW.status                  := 'RESERVED';
    NEW.reserved_by_channel     := 'EBAY';
    NEW.reserved_at             := now();
    NEW.reservation_expires_at  := now() + interval '7 days';
    -- POS/STOREFRONT reservation envelope fields stay NULL — this is an EBAY hold.
    RETURN NEW;
  END IF;

  -- Case 2: already RESERVED by EBAY → no-op (idempotent re-tick).
  IF NEW.status = 'RESERVED' AND NEW.reserved_by_channel = 'EBAY' THEN
    RETURN NEW;
  END IF;

  -- Case 3: RESERVED by POS or STOREFRONT → local cashier wins, but record alert.
  IF NEW.status = 'RESERVED' AND NEW.reserved_by_channel IN ('POS', 'STOREFRONT') THEN
    INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
    VALUES (
      'alert.ebay_sale_conflict',
      'products',
      NEW.id,
      jsonb_build_object(
        'productId',                NEW.id,
        'localReservationChannel',  NEW.reserved_by_channel,
        'localReservedAt',          NEW.reserved_at,
        'newEbayState',             NEW.ebay_state,
        'priorEbayState',           OLD.ebay_state
      )
    );
    RETURN NEW;
  END IF;

  -- Case 4: locally SOLD → record alert; do not mutate.
  IF NEW.status = 'SOLD' THEN
    INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
    VALUES (
      'alert.ebay_double_sale_attempt',
      'products',
      NEW.id,
      jsonb_build_object(
        'productId',      NEW.id,
        'localSoldAt',    NEW.sold_at,
        'newEbayState',   NEW.ebay_state,
        'priorEbayState', OLD.ebay_state
      )
    );
    RETURN NEW;
  END IF;

  -- DRAFT or unknown — leave alone.
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.enforce_ebay_sold_reserves_locally() OWNER TO warehouse14_security;

--
-- Name: FUNCTION enforce_ebay_sold_reserves_locally(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.enforce_ebay_sold_reserves_locally() IS 'BEFORE UPDATE OF ebay_state trigger. When the state enters the "buyer-committed" cluster (VERKAUFT/BEZAHLT/VERPACKT/VERSENDET), auto-RESERVE the local product via EBAY channel (if AVAILABLE) or emit a ledger alert (if locally claimed). Idempotent. SECURITY DEFINER owned by warehouse14_security so the app role cannot DROP it.';


--
-- Name: enforce_no_grandparent(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.enforce_no_grandparent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  parent_has_parent BOOLEAN;
BEGIN
  IF NEW.parent_product_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_product_id = NEW.id THEN
    RAISE EXCEPTION 'products.parent_product_id cannot point to self (id=%)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  -- Refuse if the referenced parent ALREADY has a parent of its own.
  SELECT (parent_product_id IS NOT NULL)
    INTO parent_has_parent
    FROM products
   WHERE id = NEW.parent_product_id;
  IF parent_has_parent IS TRUE THEN
    RAISE EXCEPTION 'products.parent_product_id depth limit exceeded — V1 allows only 1 level of nesting (Phase 1.5 #I-19)'
      USING ERRCODE = 'check_violation';
  END IF;
  -- A row that IS a child cannot become a parent.
  IF NEW.parent_product_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM products WHERE parent_product_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'products.parent_product_id: row % already has children — cannot also be a child', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.enforce_no_grandparent() OWNER TO warehouse14_migrator;

--
-- Name: enforce_no_grandparent_category(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.enforce_no_grandparent_category() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
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


ALTER FUNCTION public.enforce_no_grandparent_category() OWNER TO warehouse14_security;

--
-- Name: FUNCTION enforce_no_grandparent_category(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.enforce_no_grandparent_category() IS '3-level depth cap (0063; was 2-level in 0025). SECURITY DEFINER — owner warehouse14_security has SELECT on categories (0032).';


--
-- Name: erase_customer(uuid, uuid); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.erase_customer(p_customer_id uuid, p_actor uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_kyc_keys  TEXT[] := '{}';
  v_r2_keys   TEXT[] := '{}';
BEGIN
  -- The subject must exist.
  PERFORM 1 FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Collect file keys BEFORE scrubbing (caller unlinks post-commit) ──────────
  SELECT COALESCE(array_agg(document_photo_storage_key)
           FILTER (WHERE document_photo_storage_key IS NOT NULL), '{}')
    INTO v_kyc_keys FROM kyc_documents WHERE customer_id = p_customer_id;

  SELECT COALESCE(array_agg(r2_key) FILTER (WHERE r2_key IS NOT NULL), '{}')
    INTO v_r2_keys FROM document_attachments WHERE customer_id = p_customer_id;
  v_r2_keys := v_r2_keys || COALESCE((
    SELECT array_agg(k)
      FROM appraisal_items ai
      JOIN appraisals a ON a.id = ai.appraisal_id
      CROSS JOIN LATERAL unnest(ai.photo_r2_keys) AS k
     WHERE a.customer_id = p_customer_id
  ), '{}');

  -- ── Phase 2 — scrub CHILDREN first (so a failure never leaves the master
  --    flagged-anonymized while children still hold PII) ────────────────────────

  -- appointments: registered + walk-in plaintext contact fields + free-text notes
  UPDATE appointments
     SET contact_name = NULL, contact_phone = NULL, contact_email = NULL,
         customer_notes = NULL, staff_notes = NULL, cancellation_reason = NULL
   WHERE customer_id = p_customer_id;

  -- appointment_notifications: recipient is NOT NULL → sentinel, never NULL
  UPDATE appointment_notifications
     SET recipient = 'REDACTED', external_ref = NULL
   WHERE appointment_id IN (SELECT id FROM appointments WHERE customer_id = p_customer_id);

  -- 19.08.2026 (0149): hier fegte die Funktion die Nachrichtenkanäle des
  -- Webshops und das Fernwerkzeug-Protokoll. Die Tabellen sind ausgezogen;
  -- die Blöcke gingen mit, samt der nur dafür aufgelösten Telefonnummer.

  -- appraisals / appraisal_items
  UPDATE appraisals
     SET notes = NULL,
         rejection_reason = CASE WHEN status = 'REJECTED' THEN 'GELOESCHT' ELSE NULL END
   WHERE customer_id = p_customer_id;
  UPDATE appraisal_items
     SET notes = NULL, description = NULL, photo_r2_keys = '{}'
   WHERE appraisal_id IN (SELECT id FROM appraisals WHERE customer_id = p_customer_id);

  -- products acquired from this customer
  UPDATE products
     SET provenance_notes = NULL, acquired_from_customer_id = NULL
   WHERE acquired_from_customer_id = p_customer_id;

  -- vouchers (keep the row — §3(14) UStG — only the free-text note is PII)
  UPDATE vouchers SET notes = NULL WHERE issued_to_customer_id = p_customer_id;

  -- document_attachments: keep customer_id (link CHECKs) + fiscal category; the
  -- file refs are NOT NULL with length CHECKs → sentinel, never NULL.
  UPDATE document_attachments
     SET r2_key = 'erased', file_name = 'erased', sha256_hex = NULL,
         notes = NULL, archived_at = COALESCE(archived_at, now())
   WHERE customer_id = p_customer_id;

  -- kyc_documents purge — ALL-OR-NOTHING per kyc_documents_purged_consistency;
  -- purged_by_user_id is NOT NULL in the purged branch.
  UPDATE kyc_documents
     SET document_number_encrypted = NULL, document_photo_sha256 = NULL,
         document_photo_storage_key = NULL, document_photo_size_bytes = NULL,
         purged_at = now(), purged_by_user_id = p_actor
   WHERE customer_id = p_customer_id AND purged_at IS NULL;

  -- transactions: keep the fiscal row; NULL only the embedded PII. NEVER NULL
  -- customer_id (the storno-validator trigger matches on it).
  UPDATE transactions
     SET shipping_address_encrypted = NULL, notes_internal = NULL
   WHERE customer_id = p_customer_id;

  -- internal_tasks pointing at the customer (clear the pointer as a PAIR)
  UPDATE internal_tasks
     SET related_entity_table = NULL, related_entity_id = NULL,
         title = 'Gelöscht', description = NULL,
         cancellation_reason = CASE WHEN status = 'CANCELLED'
                                    THEN COALESCE(cancellation_reason, 'gelöscht') ELSE NULL END
   WHERE related_entity_table = 'customers' AND related_entity_id = p_customer_id;

  -- ── The transactional mail queue ────────────────────────────────────────
  -- ADDED 0096, and it had misfired in production before it was found.
  -- email_outbox stores the recipient address encrypted, and the rendered
  -- subject and body carry the person's name and reservation number in clear
  -- text. Erasure never touched this table, so two things were true at once:
  -- an erased customer's address and name survived here in full, and any
  -- letter still PENDING was delivered to them AFTER they had exercised
  -- Art. 17. The second one actually happened on 2026-07-22, when the Google
  -- relay was switched on and a two-day backlog flushed, including letters
  -- belonging to an account erased the night before.
  --
  -- The table could not even be swept before now: it carried no customer_id.
  -- This migration adds one, which is what makes the block below possible.
  --
  -- PENDING letters are dropped outright — there is no lawful basis for
  -- writing to someone who has asked to be forgotten. SENT and FAILED rows
  -- keep their skeleton so the delivery log stays auditable, with every
  -- personal field overwritten and the link to the person cut.
  DELETE FROM email_outbox
   WHERE customer_id = p_customer_id AND status = 'PENDING';

  UPDATE email_outbox
     SET recipient_encrypted = encrypt_pii('GELOESCHT'),
         subject     = 'Geloescht',
         body_text   = '-',
         body_html   = NULL,
         last_error  = NULL,
         customer_id = NULL
   WHERE customer_id = p_customer_id;


  -- ── Support tickets and their messages ──────────────────────────────────
  -- ADDED 0097 IN THE SAME MIGRATION THAT CREATES THESE TABLES. That is the
  -- whole point: 0094 found `shoppers` unswept and 0096 found `email_outbox`
  -- unswept, both discovered long after the fact and both the same mistake.
  -- A table that stores a person's words is not finished until erasure knows
  -- about it.
  --
  -- Messages carry the customer's own sentences, their address, and whatever
  -- they chose to tell us, so the bodies go entirely. The ticket keeps its
  -- number and status so the support history stays countable, with the
  -- subject line (customer written, therefore personal) replaced and the
  -- link to the person cut.
  DELETE FROM support_messages
   WHERE ticket_id IN (SELECT id FROM support_tickets WHERE customer_id = p_customer_id);

  UPDATE support_tickets
     SET subject       = 'Geloescht',
         gmail_thread_id = NULL,
         customer_id   = NULL,
         anonymized_at = now(),
         updated_at    = now()
   WHERE customer_id = p_customer_id;
  -- ── The reservation carts ────────────────────────────────────────────────
  -- ADDED 0099, and it is the SAME mistake a third time: 0094 found `shoppers`
  -- unswept, 0096 found `email_outbox` unswept, and on 2026-07-22 migration
  -- 0098 added `carts.shipping_address_encrypted` without teaching erasure
  -- about it. A cart is reached through its shopper, and a shipping order
  -- carries the delivery address in clear-once-decrypted form. The fiscal life
  -- of a paid order lives on `transactions`, not here, so a cart's PII may go
  -- entirely: the encrypted address is nulled, and the pickup order number is
  -- kept only where it is already anonymous.
  UPDATE carts
     SET shipping_address_encrypted = NULL,
         anonymized_at = COALESCE(anonymized_at, now())
   WHERE shopper_id IN (SELECT id FROM shoppers WHERE customer_id = p_customer_id);

  -- ── Phase 3 — the customers MASTER last, one UPDATE satisfying all CHECKs ─────
  --  • full_name_encrypted is NOT NULL → encrypted tombstone, never NULL.
  --  • trust_level reset to NEW so customers_banned_or_suspicious_has_note holds
  --    once price_expectation_notes is NULLed.
  --  • soft_deleted_at THEN anonymized_at (ordering CHECKs; equal ts satisfies >=).
  --  • customer_number + cumulative_* (trigger-only) are kept untouched.
  -- ── The storefront login row ────────────────────────────────────────────
  -- ADDED 0094. This block did not exist, and its absence was the whole hole:
  -- erasure scrubbed fourteen tables and left `shoppers` untouched, so an
  -- "erased" customer kept their e-mail, phone, shipping address, password
  -- hash and Google subject id in full. The schema had clearly intended
  -- otherwise: shoppers.anonymized_at and the CHECK that pairs it with
  -- soft_deleted_at were already there, waiting for a writer that never came.
  --
  -- email_encrypted and email_blind_index are NOT NULL, so they take a
  -- tombstone rather than NULL. That is safe against the unique index because
  -- shoppers_email_blind_active_uq is PARTIAL (WHERE soft_deleted_at IS NULL),
  -- so every erased row drops out of it.
  --
  -- Both credentials are cleared, which would violate shoppers_has_credential
  -- on its own; is_guest = TRUE satisfies it and is the honest description of
  -- what the row now is. Clearing google_sub also matters on its own: leaving
  -- it would let the same Google account sign back in and land on the erased
  -- record.
  UPDATE shoppers
     SET email_encrypted    = encrypt_pii('GELOESCHT'),
         email_blind_index  = blind_index('geloescht'),
         phone_encrypted    = NULL,
         phone_blind_index  = NULL,
         given_name_encrypted  = NULL,
         family_name_encrypted = NULL,
         picture_url_encrypted = NULL,
         shipping_recipient_name_encrypted = NULL,
         shipping_address_line1_encrypted  = NULL,
         shipping_address_line2_encrypted  = NULL,
         shipping_postal_code_encrypted    = NULL,
         shipping_city_encrypted           = NULL,
         shipping_country                  = NULL,
         billing_recipient_name_encrypted  = NULL,
         billing_address_line1_encrypted   = NULL,
         billing_address_line2_encrypted   = NULL,
         billing_postal_code_encrypted     = NULL,
         billing_city_encrypted            = NULL,
         billing_country                   = NULL,
         password_hash             = NULL,
         google_sub                = NULL,
         email_verification_token  = NULL,
         email_verified_at         = NULL,
         marketing_consent         = FALSE,
         is_guest                  = TRUE,
         last_seen_at              = NULL,
         soft_deleted_at = COALESCE(soft_deleted_at, now()),
         anonymized_at   = now(),
         updated_at      = now()
   WHERE customer_id = p_customer_id;

  -- Any session still open dies with the identity. shopper_sessions has no
  -- revoked_at: that column belongs to the STAFF sessions table (0089), not
  -- this one. A shopper session is a bearer token and nothing else, so the
  -- row is simply deleted, which is stronger than expiring it anyway.
  DELETE FROM shopper_sessions ss
   USING shoppers s
   WHERE s.customer_id = p_customer_id
     AND ss.shopper_id = s.id;

  UPDATE customers
     SET full_name_encrypted   = encrypt_pii('GELOESCHT'), name_such_tokens = NULL,
         date_of_birth_encrypted = NULL, email_encrypted = NULL, phone_encrypted = NULL,
         address_encrypted = NULL, notes_encrypted = NULL,
         email_blind_index = NULL, phone_blind_index = NULL,
         vat_id = NULL, customer_tags = '{}', price_expectation_notes = NULL,
         trust_level = 'NEW',
         soft_deleted_at = COALESCE(soft_deleted_at, now()),
         anonymized_at = now()
   WHERE id = p_customer_id;

  RETURN jsonb_build_object(
    'kyc_storage_keys', to_jsonb(v_kyc_keys),
    'r2_keys',          to_jsonb(v_r2_keys)
  );
END;
$$;


--
-- Name: FUNCTION erase_customer(p_customer_id uuid, p_actor uuid); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.erase_customer(p_customer_id uuid, p_actor uuid) IS 'GDPR Art.17 anonymize-in-place erasure of one customer. SECURITY DEFINER (owner warehouse14_migrator) to write app-barred PII columns; PII key GUC from the caller withPii() tx feeds encrypt_pii(). Returns {kyc_storage_keys, r2_keys} for the caller to unlink post-commit. Fiscal/GoBD/GwG rows kept, embedded PII NULLed.';


--
-- Name: ledger_compute_hash(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.ledger_compute_hash() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  last_hash BYTEA;
  canonical TEXT;
BEGIN
  -- 1. Force created_at = now() — the app cannot backdate.
  NEW.created_at := now();

  -- 2. Serialize AND read the latest committed tail in one step. FOR UPDATE
  --    row-locks the singleton head; a concurrent waiter re-reads the freshly
  --    committed last_row_hash via EvalPlanQual (a plain snapshot SELECT would
  --    read the INSERT statement's frozen snapshot → stale tail → forked chain).
  SELECT last_row_hash INTO last_hash
    FROM ledger_chain_head
   WHERE only_row
     FOR UPDATE;

  -- 3. Assign the id INSIDE the serialized section so id-order == chain-order.
  --    (The BIGSERIAL column default fires before this BEFORE-trigger / before
  --    the lock, so it cannot order the chain; overwrite it here.)
  NEW.id := nextval('ledger_events_id_seq');

  NEW.prev_hash := last_hash;

  -- 4. Canonical form — byte-for-byte identical to 0008.
  canonical := concat_ws(
    chr(31),
    encode(NEW.prev_hash, 'hex'),
    NEW.event_type,
    NEW.entity_table,
    NEW.entity_id::TEXT,
    COALESCE(NEW.actor_user_id::TEXT, ''),
    COALESCE(NEW.device_id::TEXT,     ''),
    COALESCE(host(NEW.ip_address),     ''),
    encode(digest(NEW.payload::TEXT, 'sha256'), 'hex'),
    to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );

  -- 5. Compute the row hash and advance the head pointer (still inside the lock).
  NEW.row_hash := digest(canonical, 'sha256');

  UPDATE ledger_chain_head
     SET last_row_hash = NEW.row_hash
   WHERE only_row;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.ledger_compute_hash() OWNER TO warehouse14_security;

--
-- Name: FUNCTION ledger_compute_hash(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.ledger_compute_hash() IS 'BEFORE INSERT trigger fn for ledger_events. Computes prev_hash + row_hash, forces created_at = now(). SECURITY DEFINER owned by warehouse14_security — app role cannot bypass or DROP. See ADR-0008 §2.';


--
-- Name: ledger_events_notify(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.ledger_events_notify() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
BEGIN
  PERFORM pg_notify('warehouse14_ledger', NEW.id::text);
  RETURN NULL;  -- AFTER trigger return value is ignored
END;
$$;


ALTER FUNCTION public.ledger_events_notify() OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION ledger_events_notify(); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.ledger_events_notify() IS 'Red Team Audit C-6: pg_notify(''warehouse14_ledger'', NEW.id::text) on every ledger_events INSERT. Substrate for SSE push (ADR-0014 §4). Payload = id only; subscribers fetch the row by primary key.';


--
-- Name: metal_price_avg_eur_per_gram(text, integer); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.metal_price_avg_eur_per_gram(p_metal text, p_days integer DEFAULT 10) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
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


ALTER FUNCTION public.metal_price_avg_eur_per_gram(p_metal text, p_days integer) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION metal_price_avg_eur_per_gram(p_metal text, p_days integer); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.metal_price_avg_eur_per_gram(p_metal text, p_days integer) IS 'Time-weighted average price per gram (EUR) over the last p_days (default 10), clipped to the window. NULL when the metal has no in-window coverage. Epic A Phase A2.';


--
-- Name: on_appointment_state_event(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.on_appointment_state_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO ledger_events (
    event_type, entity_table, entity_id, actor_user_id, payload
  )
  VALUES (
    'appointment.' || lower(NEW.status::text),
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


ALTER FUNCTION public.on_appointment_state_event() OWNER TO warehouse14_security;

--
-- Name: on_cart_reserved(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.on_cart_reserved() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
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


ALTER FUNCTION public.on_cart_reserved() OWNER TO warehouse14_security;

--
-- Name: on_daily_closing_event(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.on_daily_closing_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
BEGIN
  -- Skip non-state UPDATEs.
  IF TG_OP = 'UPDATE' AND NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  INSERT INTO ledger_events (
    event_type, entity_table, entity_id, actor_user_id, payload
  )
  VALUES (
    'daily_closing.' || lower(NEW.state::text),
    'daily_closings',
    NEW.id,
    COALESCE(NEW.finalized_by_user_id, NEW.counted_by_user_id),
    jsonb_build_object(
      'business_day',             to_char(NEW.business_day, 'YYYY-MM-DD'),
      'state',                    NEW.state,
      'verkauf_count',            NEW.verkauf_count,
      'ankauf_count',             NEW.ankauf_count,
      'storno_count',             NEW.storno_count,
      'gross_verkauf_eur',        NEW.gross_verkauf_eur::text,
      'gross_ankauf_eur',         NEW.gross_ankauf_eur::text,
      'net_verkauf_eur',          NEW.net_verkauf_eur::text,
      'net_ankauf_eur',           NEW.net_ankauf_eur::text,
      'cash_drawer_variance_eur', NEW.cash_drawer_variance_eur::text,
      'tse_finished_count',       NEW.tse_finished_count,
      'tse_pending_count',        NEW.tse_pending_count,
      'tse_failed_count',         NEW.tse_failed_count,
      'ledger_anchor_id',         NEW.ledger_anchor_id
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.on_daily_closing_event() OWNER TO warehouse14_security;

--
-- Name: on_products_autogen_slug(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.on_products_autogen_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  base_slug  TEXT;
  candidate  TEXT;
BEGIN
  -- Only act when the row is (becoming) public AND has no slug yet.
  IF NEW.slug IS NOT NULL AND length(btrim(NEW.slug)) > 0 THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.is_published_to_web = TRUE OR NEW.status = 'AVAILABLE') THEN
    RETURN NEW;
  END IF;

  -- Build the base from the display name, fall back to the sku.
  base_slug := slugify_de(COALESCE(NEW.name, ''));
  IF base_slug IS NULL OR base_slug = '' THEN
    base_slug := slugify_de(COALESCE(NEW.sku, ''));
  END IF;
  -- Last-resort base so a row with an empty name AND empty sku still gets a slug.
  IF base_slug IS NULL OR base_slug = '' THEN
    base_slug := 'artikel';
  END IF;

  -- Try the bare base first; only suffix on a real collision with a DIFFERENT row.
  candidate := base_slug;
  IF EXISTS (
    SELECT 1 FROM products p
    WHERE p.slug = candidate AND p.id <> NEW.id
  ) THEN
    -- Deterministic short suffix from THIS row's id (stable across re-publishes).
    candidate := base_slug || '-' || substr(replace(NEW.id::text, '-', ''), 1, 6);
    IF EXISTS (
      SELECT 1 FROM products p
      WHERE p.slug = candidate AND p.id <> NEW.id
    ) THEN
      -- Astronomically unlikely; widen to the full id for a guaranteed-unique slug.
      candidate := base_slug || '-' || replace(NEW.id::text, '-', '');
    END IF;
  END IF;

  NEW.slug := candidate;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.on_products_autogen_slug() OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION on_products_autogen_slug(); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.on_products_autogen_slug() IS 'BEFORE INSERT/UPDATE on products: when the row is (becoming) published (is_published_to_web=TRUE OR status=AVAILABLE) and slug IS NULL, auto-fills a collision-free slugify_de(name) (sku fallback). Idempotent on re-publish.';


--
-- Name: on_products_publish_to_web(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.on_products_publish_to_web() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_published_to_web = TRUE
     AND (OLD.is_published_to_web = FALSE OR OLD.is_published_to_web IS NULL)
     AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.on_products_publish_to_web() OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION on_products_publish_to_web(); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.on_products_publish_to_web() IS 'Phase 2.A trigger — stamps published_at on the first time is_published_to_web flips to TRUE. Idempotent on subsequent flips.';


--
-- Name: on_system_setting_event(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.on_system_setting_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  evt_type TEXT;
  payload  JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    evt_type := 'system_setting.created';
    payload  := jsonb_build_object(
      'key',       NEW.key,
      'new_value', NEW.value
    );
  ELSE
    -- Skip no-op UPDATEs (e.g. value unchanged but row touched).
    IF NEW.value = OLD.value THEN
      RETURN NEW;
    END IF;
    evt_type := 'system_setting.updated';
    payload  := jsonb_build_object(
      'key',       NEW.key,
      'old_value', OLD.value,
      'new_value', NEW.value
    );
  END IF;

  INSERT INTO audit_log (event_type, actor_user_id, payload)
  VALUES (evt_type, NEW.updated_by_user_id, payload);

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.on_system_setting_event() OWNER TO warehouse14_security;

--
-- Name: on_transaction_finalized(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.on_transaction_finalized() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
BEGIN
  -- (a) Update customer cumulative spend / Ankauf.
  --     For storno, NEW.total_eur is negative → uniform `+= NEW.total_eur` subtracts.
  IF NEW.customer_id IS NOT NULL THEN
    IF NEW.direction = 'VERKAUF' THEN
      UPDATE customers
         SET cumulative_spend_eur = cumulative_spend_eur + NEW.total_eur
       WHERE id = NEW.customer_id;
    ELSIF NEW.direction = 'ANKAUF' THEN
      UPDATE customers
         SET cumulative_ankauf_eur = cumulative_ankauf_eur + NEW.total_eur
       WHERE id = NEW.customer_id;
    END IF;
  END IF;

  -- (b) Emit ledger_events. The hash-chain trigger from migration 0008 fires
  --     for this INSERT and extends the chain.
  INSERT INTO ledger_events (
    event_type, entity_table, entity_id,
    actor_user_id, device_id,
    payload
  )
  VALUES (
    CASE
      WHEN NEW.storno_of_transaction_id IS NULL THEN 'transaction.finalized'
      ELSE                                            'transaction.stornoed'
    END,
    'transactions',
    NEW.id,
    NEW.cashier_user_id,
    NEW.device_id,
    jsonb_build_object(
      'direction',          NEW.direction,
      'total_eur',          NEW.total_eur::text,
      'subtotal_eur',       NEW.subtotal_eur::text,
      'vat_eur',            NEW.vat_eur::text,
      'tax_treatment_code', NEW.tax_treatment_code,
      'customer_id',        NEW.customer_id,
      'receipt_locator',    NEW.receipt_locator,
      'storno_of',          NEW.storno_of_transaction_id,
      'finalized_at',       to_char(NEW.finalized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      -- 0118: die drei neuen Angaben. `erfasst_am` ist die Kassenzeit,
      -- `eingegangen_am` die Serverzeit, und `nachtrag_bezugstag` steht nur
      -- dann drin, wenn der Vorgang nach dem Abschluss seines Tages eintraf.
      'erfasst_am',         CASE WHEN NEW.erfasst_am IS NULL THEN NULL
                                 ELSE to_char(NEW.erfasst_am AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
      'eingegangen_am',     to_char(NEW.eingegangen_am AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'nachtrag_bezugstag', NEW.nachtrag_bezugstag
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.on_transaction_finalized() OWNER TO warehouse14_security;

--
-- Name: FUNCTION on_transaction_finalized(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.on_transaction_finalized() IS 'AFTER INSERT trigger on transactions. Updates customer cumulative_*_eur + emits ledger event. Wanderung 0118: die Nutzlast traegt erfasst_am, eingegangen_am und nachtrag_bezugstag mit.';


--
-- Name: on_tse_signature_recorded(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.on_tse_signature_recorded() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  cashier UUID;
  device  UUID;
BEGIN
  -- Prefer the provenance carried on the row; fall back to the linked
  -- transaction's cashier/device for the audit trail.
  SELECT cashier_user_id, device_id INTO cashier, device
    FROM transactions WHERE id = NEW.transaction_id;

  INSERT INTO ledger_events (
    event_type, entity_table, entity_id,
    actor_user_id, device_id,
    payload
  )
  VALUES (
    'tse.signature_recorded',
    'tse_signatures',
    NEW.id,
    COALESCE(NEW.recorded_by_user_id, cashier),
    COALESCE(NEW.device_id, device),
    jsonb_build_object(
      'transaction_id',             NEW.transaction_id,
      'fiskaly_tss_id',             NEW.fiskaly_tss_id,
      'fiskaly_client_id',          NEW.fiskaly_client_id,
      'fiskaly_transaction_number', NEW.fiskaly_transaction_number,
      'signature_counter',          NEW.signature_counter,
      'signature_algorithm',        NEW.signature_algorithm,
      'process_type',               NEW.process_type
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.on_tse_signature_recorded() OWNER TO warehouse14_security;

--
-- Name: FUNCTION on_tse_signature_recorded(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.on_tse_signature_recorded() IS 'AFTER INSERT on tse_signatures. Emits a ledger_event ''tse.signature_recorded'' so the hash chain captures the durable TSE signature evidence. SECURITY DEFINER owned by warehouse14_security.';


--
-- Name: on_tse_state_event(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.on_tse_state_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  evt_type TEXT;
  cashier UUID;
  device  UUID;
BEGIN
  -- Skip non-state UPDATEs (e.g. updated_at-only touches).
  IF TG_OP = 'UPDATE' AND NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  evt_type := 'tse.' || lower(NEW.state::text);   -- e.g. 'tse.finished', 'tse.failed'

  -- Pull actor + device from the linked transaction for the audit trail.
  SELECT cashier_user_id, device_id INTO cashier, device
    FROM transactions WHERE id = NEW.transaction_id;

  INSERT INTO ledger_events (
    event_type, entity_table, entity_id,
    actor_user_id, device_id,
    payload
  )
  VALUES (
    evt_type,
    'tse_transactions',
    NEW.id,
    cashier,
    device,
    jsonb_build_object(
      'transaction_id',             NEW.transaction_id,
      'state',                      NEW.state,
      'previous_state',             CASE WHEN TG_OP = 'UPDATE' THEN OLD.state::text ELSE NULL END,
      'fiskaly_tss_id',             NEW.fiskaly_tss_id,
      'fiskaly_transaction_number', NEW.fiskaly_transaction_number,
      'signature_counter',          NEW.signature_counter,
      'created_offline',            NEW.created_offline,
      'state_reason',               NEW.state_reason
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.on_tse_state_event() OWNER TO warehouse14_security;

--
-- Name: FUNCTION on_tse_state_event(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.on_tse_state_event() IS 'AFTER trigger on tse_transactions INSERT + state UPDATE. Emits a ledger_event ''tse.<state>'' so the hash chain captures the full TSE lifecycle. SECURITY DEFINER owned by warehouse14_security.';


--
-- Name: product_schmelzwert_eur(uuid); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.product_schmelzwert_eur(p_product_id uuid) RETURNS numeric
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  v_metal TEXT;
  v_fein  NUMERIC(10,4);
  v_price NUMERIC(15,4);
BEGIN
  SELECT metal, feingewicht_grams
    INTO v_metal, v_fein
    FROM products
   WHERE id = p_product_id
   LIMIT 1;

  IF v_metal IS NULL OR v_fein IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT current_metal_price_eur_per_gram(v_metal) INTO v_price;
  IF v_price IS NULL THEN
    RETURN NULL;
  END IF;

  -- Round HALF_EVEN to 2 decimal places using built-in NUMERIC rounding.
  RETURN ROUND(v_fein * v_price, 2);
END;
$$;


ALTER FUNCTION public.product_schmelzwert_eur(p_product_id uuid) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION product_schmelzwert_eur(p_product_id uuid); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.product_schmelzwert_eur(p_product_id uuid) IS 'Current melt value (Schmelzwert) = feingewicht × current metal price. NULL when metal / weight / fineness / price unset.';


--
-- Name: provision_staff(public.citext, text, public.user_role); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.provision_staff(p_email public.citext, p_name text, p_role public.user_role) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_role NOT IN ('ADMIN', 'CASHIER', 'READONLY') THEN
    RAISE EXCEPTION 'invalid role %', p_role;
  END IF;
  IF length(coalesce(p_name, '')) = 0 THEN
    RAISE EXCEPTION 'name required';
  END IF;

  INSERT INTO users (email, email_verified, name, role, is_owner)
  VALUES (p_email, TRUE, p_name, p_role, FALSE)
  ON CONFLICT (email) WHERE (soft_deleted_at IS NULL)
  DO UPDATE SET
    role = EXCLUDED.role,
    name = EXCLUDED.name,
    email_verified = TRUE,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION public.provision_staff(p_email public.citext, p_name text, p_role public.user_role) OWNER TO warehouse14_migrator;

--
-- Name: release_holds_on_terminal_appointment(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.release_holds_on_terminal_appointment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
BEGIN
  -- Status unchanged: nothing to do.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Only act on transitions into terminal states.
  IF NEW.status NOT IN ('COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED') THEN
    RETURN NEW;
  END IF;

  UPDATE product_viewing_holds
     SET released_at     = now(),
         released_reason = 'appointment_' || lower(NEW.status::text)
   WHERE appointment_id = NEW.id
     AND released_at IS NULL;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.release_holds_on_terminal_appointment() OWNER TO warehouse14_security;

--
-- Name: FUNCTION release_holds_on_terminal_appointment(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.release_holds_on_terminal_appointment() IS 'Red Team Audit C-4: on appointment status → terminal (CANCELLED/NO_SHOW/RESCHEDULED/COMPLETED), release every unreleased viewing-hold for that appointment. AFTER UPDATE OF status. SECURITY DEFINER, owned by warehouse14_security.';


--
-- Name: resolve_belegtext_for_tax_treatment(text, text); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.resolve_belegtext_for_tax_treatment(p_code text, p_language text DEFAULT 'de'::text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
  SELECT body_text
    FROM belegtext_templates
   WHERE language = p_language
     AND valid_to IS NULL
     AND kind = CASE p_code
       WHEN 'MARGIN_25A'          THEN 'MARGIN_25A'::belegtext_kind
       WHEN 'STANDARD_19'         THEN 'STANDARD_19'::belegtext_kind
       WHEN 'REDUCED_7'           THEN 'REDUCED_7'::belegtext_kind
       WHEN 'INVESTMENT_GOLD_25C' THEN 'INVESTMENT_GOLD_25C'::belegtext_kind
       WHEN 'REVERSE_CHARGE_13B'  THEN 'REVERSE_CHARGE_13B'::belegtext_kind
       ELSE NULL
     END
   LIMIT 1
$$;


ALTER FUNCTION public.resolve_belegtext_for_tax_treatment(p_code text, p_language text) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION resolve_belegtext_for_tax_treatment(p_code text, p_language text); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.resolve_belegtext_for_tax_treatment(p_code text, p_language text) IS 'Returns the current belegtext.body_text for a tax_treatment_codes.code. NULL when no template is configured (caller must fall back to a default).';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION set_updated_at(); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.set_updated_at() IS 'BEFORE UPDATE trigger fn. Stamps updated_at = now() on every row. Apply via CREATE TRIGGER ... BEFORE UPDATE ... EXECUTE FUNCTION set_updated_at(). See ADR-0008 §8.';


--
-- Name: slugify(text); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.slugify(input text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT
    -- 3. trim leading / trailing hyphens left by edge punctuation
    btrim(
      -- 2. collapse every run of non [a-z0-9] into a single '-'
      regexp_replace(
        -- 1. lower-case
        lower(input),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-'
    )
$$;


ALTER FUNCTION public.slugify(input text) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION slugify(input text); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.slugify(input text) IS 'URL-safe slug from already-ASCII text. Lower-case, [a-z0-9-] only, no leading/trailing hyphen. Non-ASCII (e.g. unexpanded accents) is dropped to a separator — use slugify_de() for German umlaut/eszett EXPANSION. IMMUTABLE.';


--
-- Name: slugify_de(text); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.slugify_de(input text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT slugify(
    replace(replace(replace(replace(replace(replace(replace(
      input,
      'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'),
      'Ä', 'Ae'), 'Ö', 'Oe'), 'Ü', 'Ue'),
      'ß', 'ss')
  )
$$;


ALTER FUNCTION public.slugify_de(input text) OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION slugify_de(input text); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.slugify_de(input text) IS 'German-aware slug: expands ä/ö/ü→ae/oe/ue and ß→ss, then slugify(). Used by the product slug-autogen trigger.';


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.touch_updated_at() OWNER TO warehouse14_migrator;

--
-- Name: transaction_payments_accumulate_debt(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.transaction_payments_accumulate_debt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  tx_customer_id UUID;
BEGIN
  IF NEW.payment_method <> 'DEBT' THEN
    RETURN NEW;
  END IF;
  SELECT customer_id INTO tx_customer_id FROM transactions WHERE id = NEW.transaction_id;
  -- Guard trigger above ensures tx_customer_id IS NOT NULL when we get here.
  UPDATE customers
     SET cumulative_debt_eur = cumulative_debt_eur + NEW.amount_eur
   WHERE id = tx_customer_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.transaction_payments_accumulate_debt() OWNER TO warehouse14_security;

--
-- Name: FUNCTION transaction_payments_accumulate_debt(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.transaction_payments_accumulate_debt() IS 'Day-17: bumps customers.cumulative_debt_eur when a DEBT payment row lands. Storno reverses naturally via the negative-amount rows. The non-negative CHECK on cumulative_debt_eur refuses over-reversal.';


--
-- Name: transaction_payments_debt_requires_customer(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.transaction_payments_debt_requires_customer() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  tx_customer_id UUID;
BEGIN
  IF NEW.payment_method <> 'DEBT' THEN
    RETURN NEW;
  END IF;
  SELECT customer_id INTO tx_customer_id FROM transactions WHERE id = NEW.transaction_id;
  IF tx_customer_id IS NULL THEN
    RAISE EXCEPTION 'DEBT payment requires customer_id on parent transaction (transaction %)', NEW.transaction_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.transaction_payments_debt_requires_customer() OWNER TO warehouse14_security;

--
-- Name: FUNCTION transaction_payments_debt_requires_customer(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.transaction_payments_debt_requires_customer() IS 'Day-17 audit fix: DEBT payment is meaningless without a customer to owe it. Refuse the INSERT if transactions.customer_id IS NULL.';


--
-- Name: transaction_payments_validate_cash_kyc(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.transaction_payments_validate_cash_kyc() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  t_direction       text;
  t_total           numeric;
  t_customer_id     uuid;
  t_storno_of       uuid;
  c_kyc_verified_at timestamptz;
  bar_threshold     numeric;
BEGIN
  IF NEW.payment_method <> 'CASH' THEN
    RETURN NEW;
  END IF;

  SELECT direction::text, total_eur, customer_id, storno_of_transaction_id
    INTO t_direction, t_total, t_customer_id, t_storno_of
    FROM transactions WHERE id = NEW.transaction_id;

  -- Ein Storno kehrt einen bereits geprüften Vorgang um.
  IF t_storno_of IS NOT NULL OR t_direction <> 'VERKAUF' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((value #>> '{}')::numeric, 2000.00)
    INTO bar_threshold
    FROM system_settings WHERE key = 'gwg.verkauf_identity_threshold_eur';
  bar_threshold := COALESCE(bar_threshold, 2000.00);

  -- Gemessen wird am GESAMTBETRAG des Verkaufs, nicht am bar gezahlten Teil.
  -- Sonst liesse sich die Schwelle durch Stückelung umgehen: 1.900 Euro bar
  -- plus Rest per Karte wäre sonst prüfungsfrei, und genau diese Stückelung
  -- ist der Vorgang, den das Gesetz treffen will.
  IF t_total >= bar_threshold THEN
    IF t_customer_id IS NULL THEN
      RAISE EXCEPTION 'KYC hard-block (Barzahlung): Verkauf ueber % >= % mit Bargeld erfordert einen ausweisgeprueften Kaeufer (§ 10 Abs. 6a GwG); kein Kunde hinterlegt', t_total, bar_threshold
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT kyc_verified_at INTO c_kyc_verified_at
      FROM customers WHERE id = t_customer_id;
    IF c_kyc_verified_at IS NULL THEN
      RAISE EXCEPTION 'KYC hard-block (Barzahlung): Kaeufer % ist nicht ausweisgeprueft; ein Verkauf ueber % >= % mit Bargeld erfordert Identifizierung (§ 10 Abs. 6a GwG)', t_customer_id, t_total, bar_threshold
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.transaction_payments_validate_cash_kyc() OWNER TO warehouse14_security;

--
-- Name: transactions_validate_closing_day(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.transactions_validate_closing_day() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  buchungstag    DATE;
  erfassungstag  DATE;
BEGIN
  buchungstag := berlin_business_day(NEW.finalized_at);

  -- Arm 1 (unveraendert seit 0013 C-3): der Buchungstag selbst darf nicht
  -- abgeschlossen sein. ADR-0008 + KassenSichV: der Z-Bon ist fest.
  IF EXISTS (
    SELECT 1 FROM daily_closings dc
     WHERE dc.business_day = buchungstag
       AND dc.shop_id IS NOT DISTINCT FROM NEW.shop_id
       AND dc.state = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION
      'Closing-day guard: business day % is FINALIZED (shop %); cannot insert transaction (ADR-0008 + KassenSichV)',
      buchungstag, COALESCE(NEW.shop_id::text, 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Arm 2 (neu, 0118): die ERFASSUNGSZEIT liegt auf einem abgeschlossenen
  -- Tag. Das ist erlaubt — aber nur als ausgewiesener Nachtrag.
  IF NEW.erfasst_am IS NOT NULL THEN
    erfassungstag := berlin_business_day(NEW.erfasst_am);

    IF erfassungstag <> buchungstag
       AND EXISTS (
         SELECT 1 FROM daily_closings dc
          WHERE dc.business_day = erfassungstag
            AND dc.shop_id IS NOT DISTINCT FROM NEW.shop_id
            AND dc.state = 'FINALIZED'
       )
       AND NEW.nachtrag_bezugstag IS DISTINCT FROM erfassungstag
    THEN
      RAISE EXCEPTION
        'Nachtrag-Wächter: Erfassungstag % ist bereits abgeschlossen (shop %); ein solcher Vorgang muss als Nachtrag ausgewiesen werden (nachtrag_bezugstag)',
        erfassungstag, COALESCE(NEW.shop_id::text, 'NULL')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.transactions_validate_closing_day() OWNER TO warehouse14_security;

--
-- Name: FUNCTION transactions_validate_closing_day(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.transactions_validate_closing_day() IS 'Red Team Audit C-3 + Wanderung 0118: refuse any transaction whose BOOKING day is FINALIZED, and refuse a transaction whose CAPTURE day is FINALIZED unless it is declared as a Nachtrag (nachtrag_bezugstag). SECURITY DEFINER, owned by warehouse14_security.';


--
-- Name: transactions_validate_kyc(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.transactions_validate_kyc() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  c_kyc_verified_at timestamptz;
  verkauf_threshold numeric;
  ist_unbarer_kanal boolean;
BEGIN
  -- Stornos reverse an already-validated transaction — never re-block a reversal.
  IF NEW.storno_of_transaction_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- ── ANKAUF: ID ALWAYS required, from EUR 0.01 (hard §259 StGB) ──
  IF NEW.direction = 'ANKAUF' THEN
    SELECT kyc_verified_at INTO c_kyc_verified_at
      FROM customers WHERE id = NEW.customer_id;
    IF c_kyc_verified_at IS NULL THEN
      RAISE EXCEPTION 'KYC hard-block (Ankauf): seller % is not ID-verified; every Ankauf requires identification (§ 259 StGB)', NEW.customer_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.direction = 'VERKAUF' THEN

    -- ── NEU: Verdacht sticht jede Schwelle ────────────────────────────────
    --
    -- Wer einen Vorgang als geldwäscheverdächtig markiert, darf ihn nicht
    -- gleichzeitig anonym abschliessen. Das gilt ab dem ersten Cent und ohne
    -- Rücksicht auf Kanal oder Zahlungsart.
    IF COALESCE(NEW.suspicious_aml_flag, false) THEN
      IF NEW.customer_id IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): als geldwaescheverdaechtig markierter Verkauf erfordert einen ausweisgeprueften Kaeufer, unabhaengig vom Betrag (§ 10 GwG); kein Kunde hinterlegt'
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT kyc_verified_at INTO c_kyc_verified_at
        FROM customers WHERE id = NEW.customer_id;
      IF c_kyc_verified_at IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): Kaeufer % ist nicht ausweisgeprueft, und der Vorgang ist als geldwaescheverdaechtig markiert (§ 10 GwG)', NEW.customer_id
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;

    -- ── Welche Schwelle gilt? ─────────────────────────────────────────────
    --
    -- Über das Netz kann niemand bar bezahlen. Nur deshalb, und nur dort,
    -- gilt die unbare Schwelle. An der Theke bleibt alles wie bisher.
    ist_unbarer_kanal := NEW.sales_channel IN ('WEB', 'EBAY');

    IF ist_unbarer_kanal THEN
      SELECT COALESCE((value #>> '{}')::numeric, 15000.00)
        INTO verkauf_threshold
        FROM system_settings WHERE key = 'gwg.verkauf_identity_threshold_unbar_eur';
      verkauf_threshold := COALESCE(verkauf_threshold, 15000.00);
    ELSE
      SELECT COALESCE((value #>> '{}')::numeric, 2000.00)
        INTO verkauf_threshold
        FROM system_settings WHERE key = 'gwg.verkauf_identity_threshold_eur';
      verkauf_threshold := COALESCE(verkauf_threshold, 2000.00);
    END IF;

    IF NEW.total_eur >= verkauf_threshold THEN
      IF NEW.customer_id IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): sale total % >= % (Kanal %) requires an ID-verified buyer (§ 10 GwG); no customer attached', NEW.total_eur, verkauf_threshold, NEW.sales_channel
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT kyc_verified_at INTO c_kyc_verified_at
        FROM customers WHERE id = NEW.customer_id;
      IF c_kyc_verified_at IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): buyer % is not ID-verified; a sale total % >= % (Kanal %) requires identification (§ 10 GwG)', NEW.customer_id, NEW.total_eur, verkauf_threshold, NEW.sales_channel
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.transactions_validate_kyc() OWNER TO warehouse14_security;

--
-- Name: transactions_validate_sanctions(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.transactions_validate_sanctions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  c_sanctioned BOOLEAN;
BEGIN
  -- Walk-in cash sale below KYC threshold: no customer attached. Nothing to check.
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sanctions_match
    INTO c_sanctioned
    FROM customers
   WHERE id = NEW.customer_id;

  -- A non-existent customer_id will be rejected by the FK; we only act on TRUE.
  IF c_sanctioned IS TRUE THEN
    RAISE EXCEPTION 'Sanctions hard-block: customer % is sanctions-flagged; transaction refused (ADR-0018 §6)', NEW.customer_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.transactions_validate_sanctions() OWNER TO warehouse14_security;

--
-- Name: FUNCTION transactions_validate_sanctions(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.transactions_validate_sanctions() IS 'Red Team Audit C-2: hard-block any transaction for a sanctions-flagged customer. BEFORE INSERT. SECURITY DEFINER, owned by warehouse14_security.';


--
-- Name: transactions_validate_storno(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.transactions_validate_storno() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  orig RECORD;
BEGIN
  IF NEW.storno_of_transaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT direction, total_eur, subtotal_eur, vat_eur, customer_id, storno_of_transaction_id
    INTO orig
    FROM transactions
   WHERE id = NEW.storno_of_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Storno references unknown transaction %', NEW.storno_of_transaction_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- No storno of storno.
  IF orig.storno_of_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot storno transaction % — it is itself a storno', NEW.storno_of_transaction_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Direction must match (Verkauf-storno reverses a Verkauf; Ankauf-storno reverses an Ankauf).
  IF orig.direction <> NEW.direction THEN
    RAISE EXCEPTION 'Storno direction (%) must match original direction (%)', NEW.direction, orig.direction
      USING ERRCODE = 'check_violation';
  END IF;

  -- Magnitudes must mirror exactly.
  IF NEW.total_eur    <> -orig.total_eur    OR
     NEW.subtotal_eur <> -orig.subtotal_eur OR
     NEW.vat_eur      <> -orig.vat_eur      THEN
    RAISE EXCEPTION 'Storno amounts must be the negation of the original (orig total=%, storno total=%)',
                    orig.total_eur, NEW.total_eur
      USING ERRCODE = 'check_violation';
  END IF;

  -- Customer must match (a storno can't move revenue between customers).
  IF orig.customer_id IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'Storno customer must match the original transaction''s customer'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.transactions_validate_storno() OWNER TO warehouse14_migrator;

--
-- Name: transactions_validate_trust_level(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.transactions_validate_trust_level() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  c_trust customer_trust_level;
BEGIN
  -- Walk-in cash sale below KYC threshold: no customer attached. Nothing to check.
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT trust_level
    INTO c_trust
    FROM customers
   WHERE id = NEW.customer_id;

  -- A non-existent customer_id is rejected by the FK; we only act on BANNED.
  IF c_trust = 'BANNED' THEN
    RAISE EXCEPTION
      'Trust-level hard-block: customer % is BANNED (refused service); transaction refused (ADR-0024)',
      NEW.customer_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.transactions_validate_trust_level() OWNER TO warehouse14_security;

--
-- Name: FUNCTION transactions_validate_trust_level(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.transactions_validate_trust_level() IS 'Migration 0059: hard-block any transaction for a BANNED customer (ADR-0024 "refused service"). BEFORE INSERT. SECURITY DEFINER, owned by warehouse14_security. Defense-in-depth complement to the sanctions (0013 C-2) + KYC (0050) walls.';


--
-- Name: tse_signatures_immutable(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.tse_signatures_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Allow ONLY the set_updated_at() touch (no business column changed). Any
  -- other UPDATE, and every DELETE, is refused.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tse_signatures rows are immutable fiscal evidence and cannot be deleted (row %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.transaction_id              IS DISTINCT FROM OLD.transaction_id              OR
       NEW.fiskaly_tss_id              IS DISTINCT FROM OLD.fiskaly_tss_id              OR
       NEW.fiskaly_client_id           IS DISTINCT FROM OLD.fiskaly_client_id           OR
       NEW.fiskaly_transaction_id      IS DISTINCT FROM OLD.fiskaly_transaction_id      OR
       NEW.fiskaly_transaction_number  IS DISTINCT FROM OLD.fiskaly_transaction_number  OR
       NEW.signature_value             IS DISTINCT FROM OLD.signature_value             OR
       NEW.signature_counter           IS DISTINCT FROM OLD.signature_counter           OR
       NEW.signature_algorithm         IS DISTINCT FROM OLD.signature_algorithm         OR
       NEW.process_type                IS DISTINCT FROM OLD.process_type                OR
       NEW.qr_code_data                IS DISTINCT FROM OLD.qr_code_data                OR
       NEW.tse_start_time              IS DISTINCT FROM OLD.tse_start_time              OR
       NEW.tse_end_time                IS DISTINCT FROM OLD.tse_end_time                OR
       NEW.recorded_at                 IS DISTINCT FROM OLD.recorded_at                 OR
       NEW.device_id                   IS DISTINCT FROM OLD.device_id                   OR
       NEW.recorded_by_user_id         IS DISTINCT FROM OLD.recorded_by_user_id THEN
      RAISE EXCEPTION 'tse_signatures rows are immutable fiscal evidence and cannot be modified (row %)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.tse_signatures_immutable() OWNER TO warehouse14_migrator;

--
-- Name: FUNCTION tse_signatures_immutable(); Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON FUNCTION public.tse_signatures_immutable() IS 'Refuses any business-column UPDATE and every DELETE on tse_signatures. The signature is append-only fiscal evidence (GoBD). Only the set_updated_at() no-op touch is permitted.';


--
-- Name: tse_validate_transition(); Type: FUNCTION; Schema: public; Owner: warehouse14_migrator
--

CREATE FUNCTION public.tse_validate_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  is_terminal_old BOOLEAN;
  valid_transition BOOLEAN;
BEGIN
  -- Terminal states cannot transition further.
  is_terminal_old := OLD.state IN ('FINISHED', 'CANCELLED', 'FAILED');

  IF is_terminal_old AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'Cannot transition out of terminal TSE state % (row %)', OLD.state, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validate the transition graph when state actually changes.
  IF NEW.state <> OLD.state THEN
    valid_transition :=
      (OLD.state = 'QUEUED_OFFLINE' AND NEW.state IN ('ACTIVE', 'FINISHED', 'FAILED'))
      OR
      (OLD.state = 'ACTIVE'         AND NEW.state IN ('FINISHED', 'CANCELLED', 'FAILED'));

    IF NOT valid_transition THEN
      RAISE EXCEPTION 'Invalid TSE state transition: % → % (row %)', OLD.state, NEW.state, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- After FINISHED, signature columns are immutable.
  IF OLD.state = 'FINISHED' THEN
    IF NEW.signature_value             IS DISTINCT FROM OLD.signature_value             OR
       NEW.signature_counter           IS DISTINCT FROM OLD.signature_counter           OR
       NEW.signature_algorithm         IS DISTINCT FROM OLD.signature_algorithm         OR
       NEW.fiskaly_transaction_number  IS DISTINCT FROM OLD.fiskaly_transaction_number  OR
       NEW.certificate_serial          IS DISTINCT FROM OLD.certificate_serial          OR
       NEW.certificate_public_key      IS DISTINCT FROM OLD.certificate_public_key      OR
       NEW.start_time                  IS DISTINCT FROM OLD.start_time                  OR
       NEW.end_time                    IS DISTINCT FROM OLD.end_time                    OR
       NEW.qr_code_data                IS DISTINCT FROM OLD.qr_code_data                OR
       NEW.process_data_hash           IS DISTINCT FROM OLD.process_data_hash           OR
       NEW.signed_at                   IS DISTINCT FROM OLD.signed_at THEN
      RAISE EXCEPTION 'TSE signature columns are immutable after FINISHED (row %)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- transaction_id linkage is immutable from INSERT — no UPDATE allowed.
  IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
    RAISE EXCEPTION 'tse_transactions.transaction_id is immutable (row %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- created_offline is set at INSERT time only.
  IF NEW.created_offline IS DISTINCT FROM OLD.created_offline THEN
    RAISE EXCEPTION 'tse_transactions.created_offline is set at INSERT and immutable (row %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.tse_validate_transition() OWNER TO warehouse14_migrator;

--
-- Name: verify_ledger_chain(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.verify_ledger_chain() RETURNS TABLE(break_at_id bigint, reason text, expected_hash bytea, actual_hash bytea)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  rec RECORD;
  expected_prev BYTEA;
  recomputed_canonical TEXT;
  recomputed_hash BYTEA;
BEGIN
  expected_prev := decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex');

  FOR rec IN
    SELECT id, event_type, entity_table, entity_id, actor_user_id, device_id,
           ip_address, payload, prev_hash, row_hash, created_at
      FROM ledger_events
     ORDER BY id
  LOOP
    -- 1. prev_hash must link to the previous row's row_hash.
    IF rec.prev_hash <> expected_prev THEN
      break_at_id   := rec.id;
      reason        := 'prev_hash mismatch — row was deleted, reordered, or its predecessor was tampered with';
      expected_hash := expected_prev;
      actual_hash   := rec.prev_hash;
      RETURN NEXT;
      RETURN;
    END IF;

    -- 2. Recompute row_hash and compare.
    recomputed_canonical := concat_ws(
      chr(31),
      encode(rec.prev_hash, 'hex'),
      rec.event_type,
      rec.entity_table,
      rec.entity_id::TEXT,
      COALESCE(rec.actor_user_id::TEXT, ''),
      COALESCE(rec.device_id::TEXT,     ''),
      COALESCE(host(rec.ip_address),     ''),
      encode(digest(rec.payload::TEXT, 'sha256'), 'hex'),
      to_char(rec.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    recomputed_hash := digest(recomputed_canonical, 'sha256');

    IF rec.row_hash <> recomputed_hash THEN
      break_at_id   := rec.id;
      reason        := 'row_hash mismatch — this row''s payload was tampered with after insertion';
      expected_hash := recomputed_hash;
      actual_hash   := rec.row_hash;
      RETURN NEXT;
      RETURN;
    END IF;

    expected_prev := rec.row_hash;
  END LOOP;

  -- All rows verified, no breaks.
  RETURN;
END;
$$;


ALTER FUNCTION public.verify_ledger_chain() OWNER TO warehouse14_security;

--
-- Name: FUNCTION verify_ledger_chain(); Type: COMMENT; Schema: public; Owner: warehouse14_security
--

COMMENT ON FUNCTION public.verify_ledger_chain() IS 'Walks the ledger from row 1 to N, recomputes each hash, reports the first break. Empty result = chain intact. Used by nightly CI + Control Desktop on-demand audit.';


--
-- Name: verify_transaction_balance(); Type: FUNCTION; Schema: public; Owner: warehouse14_security
--

CREATE FUNCTION public.verify_transaction_balance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  tx_id UUID;
  header RECORD;
  items_total NUMERIC(18,2);
  items_subtotal NUMERIC(18,2);
  items_vat NUMERIC(18,2);
  payments_total NUMERIC(18,2);
  item_count INTEGER;
  payment_count INTEGER;
BEGIN
  -- Resolve the transaction id from whichever table fired the trigger.
  -- TG_TABLE_NAME is the table the trigger is attached to.
  IF TG_TABLE_NAME = 'transactions' THEN
    tx_id := NEW.id;
  ELSE
    tx_id := NEW.transaction_id;
  END IF;

  SELECT subtotal_eur, vat_eur, total_eur
    INTO header
    FROM transactions
   WHERE id = tx_id;

  -- Header gone: a parallel ROLLBACK removed it; nothing to verify.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(line_total_eur),    0),
    COALESCE(SUM(line_subtotal_eur), 0),
    COALESCE(SUM(line_vat_eur),      0),
    COUNT(*)
  INTO items_total, items_subtotal, items_vat, item_count
  FROM transaction_items
  WHERE transaction_id = tx_id;

  SELECT
    COALESCE(SUM(amount_eur), 0),
    COUNT(*)
  INTO payments_total, payment_count
  FROM transaction_payments
  WHERE transaction_id = tx_id;

  IF item_count = 0 THEN
    RAISE EXCEPTION 'Transaction balance: transaction % has no items at COMMIT', tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF payment_count = 0 THEN
    RAISE EXCEPTION 'Transaction balance: transaction % has no payments at COMMIT', tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF items_total <> header.total_eur THEN
    RAISE EXCEPTION 'Transaction balance: items total (%) <> header total (%) for transaction %',
      items_total, header.total_eur, tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF items_subtotal <> header.subtotal_eur THEN
    RAISE EXCEPTION 'Transaction balance: items subtotal (%) <> header subtotal (%) for transaction %',
      items_subtotal, header.subtotal_eur, tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF items_vat <> header.vat_eur THEN
    RAISE EXCEPTION 'Transaction balance: items vat (%) <> header vat (%) for transaction %',
      items_vat, header.vat_eur, tx_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF payments_total <> header.total_eur THEN
    RAISE EXCEPTION 'Transaction balance: payments total (%) <> header total (%) for transaction %',
      payments_total, header.total_eur, tx_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION public.verify_transaction_balance() OWNER TO warehouse14_security;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _w14_schema_migrations; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public._w14_schema_migrations (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public._w14_schema_migrations OWNER TO warehouse14_migrator;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    password text,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_credentials_or_oauth CHECK ((((provider_id = 'credentials'::text) AND (password IS NOT NULL) AND (access_token IS NULL)) OR ((provider_id <> 'credentials'::text) AND (password IS NULL))))
);


ALTER TABLE public.accounts OWNER TO warehouse14_migrator;

--
-- Name: TABLE accounts; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.accounts IS 'better-auth account records. One row per (provider, user). NEVER deleted by app role — unlink-provider is mediated.';


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    role public.user_role NOT NULL,
    read_only boolean DEFAULT true NOT NULL,
    scopes jsonb,
    created_by_user_id uuid NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    last_used_ip inet,
    revoked_at timestamp with time zone,
    revoked_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT api_keys_label_len CHECK (((char_length(label) >= 1) AND (char_length(label) <= 120)))
);


ALTER TABLE public.api_keys OWNER TO warehouse14_migrator;

--
-- Name: appointment_linked_products; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.appointment_linked_products (
    appointment_id uuid NOT NULL,
    product_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    added_by_user_id uuid
);


ALTER TABLE public.appointment_linked_products OWNER TO warehouse14_migrator;

--
-- Name: appointment_notifications; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.appointment_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    notification_type text NOT NULL,
    channel text NOT NULL,
    recipient text NOT NULL,
    template_id text,
    scheduled_for timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    delivery_status text,
    external_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appt_notif_channel_domain CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'email'::text, 'sse'::text, 'sms'::text]))),
    CONSTRAINT appt_notif_sent_has_status CHECK (((sent_at IS NULL) OR (delivery_status IS NOT NULL))),
    CONSTRAINT appt_notif_type_domain CHECK ((notification_type = ANY (ARRAY['booking_confirmation'::text, 'reminder_24h'::text, 'reminder_2h'::text, 'reminder_30min'::text, 'no_show_followup'::text, 'rescheduled'::text, 'cancelled'::text])))
);


ALTER TABLE public.appointment_notifications OWNER TO warehouse14_migrator;

--
-- Name: appointments; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    appointment_type public.appointment_type NOT NULL,
    status public.appointment_status DEFAULT 'SCHEDULED'::public.appointment_status NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    duration_minutes integer NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    customer_id uuid,
    staff_user_id uuid NOT NULL,
    booked_by_user_id uuid,
    booked_via text NOT NULL,
    customer_notes text,
    staff_notes text,
    confirmed_at timestamp with time zone,
    checked_in_at timestamp with time zone,
    early_arrival_minutes integer,
    in_progress_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    no_show_marked_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    rescheduled_from_appointment_id uuid,
    rescheduled_to_appointment_id uuid,
    linked_transaction_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'POS'::text NOT NULL,
    contact_name text,
    contact_phone text,
    contact_email text,
    google_event_id text,
    CONSTRAINT appointments_booked_via_domain CHECK ((booked_via = ANY (ARRAY['control_desktop'::text, 'storefront'::text, 'pos'::text, 'whatsapp_bot'::text, 'google_calendar'::text]))),
    CONSTRAINT appointments_cancelled_has_marker CHECK (((status <> 'CANCELLED'::public.appointment_status) OR (cancelled_at IS NOT NULL))),
    CONSTRAINT appointments_checked_in_has_marker CHECK (((status <> ALL (ARRAY['CHECKED_IN'::public.appointment_status, 'IN_PROGRESS'::public.appointment_status, 'COMPLETED'::public.appointment_status])) OR (checked_in_at IS NOT NULL))),
    CONSTRAINT appointments_completed_has_marker CHECK (((status <> 'COMPLETED'::public.appointment_status) OR (completed_at IS NOT NULL))),
    CONSTRAINT appointments_duration_minutes_check CHECK (((duration_minutes > 0) AND (duration_minutes <= 480))),
    CONSTRAINT appointments_in_progress_has_marker CHECK (((status <> 'IN_PROGRESS'::public.appointment_status) OR (in_progress_started_at IS NOT NULL))),
    CONSTRAINT appointments_no_show_has_marker CHECK (((status <> 'NO_SHOW'::public.appointment_status) OR (no_show_marked_at IS NOT NULL))),
    CONSTRAINT appointments_rescheduled_has_link CHECK (((status <> 'RESCHEDULED'::public.appointment_status) OR (rescheduled_to_appointment_id IS NOT NULL))),
    CONSTRAINT appointments_source_domain CHECK ((source = ANY (ARRAY['POS'::text, 'WEB'::text, 'WHATSAPP'::text, 'GOOGLE'::text]))),
    CONSTRAINT appointments_starts_at_in_minute_precision CHECK ((date_trunc('second'::text, starts_at) = starts_at))
);


ALTER TABLE public.appointments OWNER TO warehouse14_migrator;

--
-- Name: TABLE appointments; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.appointments IS 'Smart Appointment System master table. 4 types × 8 statuses. NEVER deleted by app role — CANCELLED/NO_SHOW preserved for analytics. State transitions enforced by trigger.';


--
-- Name: COLUMN appointments.source; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.appointments.source IS 'Booking origin per the cross-team CONTRACT: POS (default, staff-made), WEB (public storefront), WHATSAPP (bot).';


--
-- Name: COLUMN appointments.contact_name; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.appointments.contact_name IS 'Walk-in contact name for bookings without a customer record (public web booking). Operational data, not KYC PII.';


--
-- Name: COLUMN appointments.contact_phone; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.appointments.contact_phone IS 'Walk-in contact phone — the confirmation/reminder recipient for source=WEB bookings.';


--
-- Name: COLUMN appointments.contact_email; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.appointments.contact_email IS 'Optional walk-in contact email for source=WEB bookings.';


--
-- Name: appraisal_items; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.appraisal_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appraisal_id uuid NOT NULL,
    sequence_in_lot integer DEFAULT 0 NOT NULL,
    name text NOT NULL,
    description text,
    item_type public.item_type NOT NULL,
    metal text,
    karat_code text,
    fineness_decimal numeric(5,4),
    weight_grams numeric(10,4),
    condition public.product_condition,
    hallmark_stamps text[] DEFAULT '{}'::text[] NOT NULL,
    individual_appraised_eur numeric(18,2) NOT NULL,
    photo_r2_keys text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    product_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appraisal_items_fineness_decimal_check CHECK (((fineness_decimal IS NULL) OR ((fineness_decimal > (0)::numeric) AND (fineness_decimal <= 1.0000)))),
    CONSTRAINT appraisal_items_individual_appraised_eur_check CHECK ((individual_appraised_eur >= (0)::numeric)),
    CONSTRAINT appraisal_items_metal_check CHECK (((metal IS NULL) OR (metal = ANY (ARRAY['gold'::text, 'silver'::text, 'platinum'::text, 'palladium'::text])))),
    CONSTRAINT appraisal_items_weight_grams_check CHECK (((weight_grams IS NULL) OR (weight_grams > (0)::numeric)))
);


ALTER TABLE public.appraisal_items OWNER TO warehouse14_migrator;

--
-- Name: TABLE appraisal_items; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.appraisal_items IS 'Per-piece valuation in an estate appraisal. individual_appraised_eur is the operator''s market estimate; the per-piece acquisition_cost is derived at ACCEPTED by pro-rata allocation of appraisals.total_offered_eur.';


--
-- Name: appraisals; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.appraisals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    appraised_by_user_id uuid NOT NULL,
    status public.appraisal_status DEFAULT 'DRAFT'::public.appraisal_status NOT NULL,
    total_appraised_eur numeric(18,2) DEFAULT 0 NOT NULL,
    total_offered_eur numeric(18,2),
    customer_expectation_eur numeric(18,2),
    ankauf_transaction_id uuid,
    notes text,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    accepted_at timestamp with time zone,
    rejected_at timestamp with time zone,
    rejection_reason text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appraisals_accepted_has_evidence CHECK (((status <> 'ACCEPTED'::public.appraisal_status) OR ((accepted_at IS NOT NULL) AND (ankauf_transaction_id IS NOT NULL) AND (total_offered_eur IS NOT NULL)))),
    CONSTRAINT appraisals_completed_has_timestamp CHECK (((status <> ALL (ARRAY['COMPLETED'::public.appraisal_status, 'ACCEPTED'::public.appraisal_status, 'REJECTED'::public.appraisal_status])) OR (completed_at IS NOT NULL))),
    CONSTRAINT appraisals_customer_expectation_eur_check CHECK (((customer_expectation_eur IS NULL) OR (customer_expectation_eur >= (0)::numeric))),
    CONSTRAINT appraisals_rejected_has_reason CHECK (((status <> 'REJECTED'::public.appraisal_status) OR (rejection_reason IS NOT NULL))),
    CONSTRAINT appraisals_rejected_has_timestamp CHECK (((status <> 'REJECTED'::public.appraisal_status) OR (rejected_at IS NOT NULL))),
    CONSTRAINT appraisals_total_appraised_eur_check CHECK ((total_appraised_eur >= (0)::numeric)),
    CONSTRAINT appraisals_total_offered_eur_check CHECK (((total_offered_eur IS NULL) OR (total_offered_eur >= (0)::numeric)))
);


ALTER TABLE public.appraisals OWNER TO warehouse14_migrator;

--
-- Name: TABLE appraisals; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.appraisals IS 'Pre-Ankauf valuation workflow. One row per Nachlass/Konvolut appraisal session. On ACCEPTED, the route runs pro-rata allocation: each child product gets acquisition_cost = (item.individual_appraised / Σ items_appraised) × total_offered, with last child absorbing rounding remainder so Σ children = total_offered exactly. Never deleted (NO DELETE app grant).';


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    event_type text NOT NULL,
    actor_user_id uuid,
    device_id uuid,
    ip_address inet,
    user_agent text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_payload_object CHECK ((jsonb_typeof(payload) = 'object'::text))
);


ALTER TABLE public.audit_log OWNER TO warehouse14_migrator;

--
-- Name: TABLE audit_log; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.audit_log IS 'Non-fiscal who-when-what (logins, role changes, settings). Append-only via grants. No hash chain — security events are not the §259 StGB defense surface.';


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_log_id_seq OWNER TO warehouse14_migrator;

--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: warehouse14_migrator
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: beleg_logo; Type: TABLE; Schema: public; Owner: warehouse14
--

CREATE TABLE public.beleg_logo (
    id smallint DEFAULT 1 NOT NULL,
    format text NOT NULL,
    daten bytea NOT NULL,
    hochgeladen_am timestamp with time zone DEFAULT now() NOT NULL,
    hochgeladen_von uuid,
    CONSTRAINT beleg_logo_format CHECK ((format = ANY (ARRAY['svg'::text, 'png'::text, 'jpeg'::text]))),
    CONSTRAINT beleg_logo_groesse CHECK (((octet_length(daten) >= 1) AND (octet_length(daten) <= 262144))),
    CONSTRAINT beleg_logo_nur_eine_zeile CHECK ((id = 1))
);


ALTER TABLE public.beleg_logo OWNER TO warehouse14;

--
-- Name: TABLE beleg_logo; Type: COMMENT; Schema: public; Owner: warehouse14
--

COMMENT ON TABLE public.beleg_logo IS 'Das Beleg-Logo des Haendlers (Mandantendatum, eine Zeile). Bereinigtes Original; ohne Zeile druckt der Bon die norns.de-Systemzeile.';


--
-- Name: belegtext_templates; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.belegtext_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.belegtext_kind NOT NULL,
    language text DEFAULT 'de'::text NOT NULL,
    body_text text NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    created_by_user_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT belegtext_body_length CHECK (((length(body_text) >= 1) AND (length(body_text) <= 4000))),
    CONSTRAINT belegtext_language_format CHECK ((language ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)),
    CONSTRAINT belegtext_valid_range CHECK (((valid_to IS NULL) OR (valid_to > valid_from)))
);


ALTER TABLE public.belegtext_templates OWNER TO warehouse14_migrator;

--
-- Name: TABLE belegtext_templates; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.belegtext_templates IS 'Append-only history of receipt/invoice legal texts. New version: UPDATE existing CURRENT row SET valid_to = now(); then INSERT new row. NEVER DELETE — Finanzamt may audit which text printed on which receipt.';


--
-- Name: business_locations; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.business_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    street text NOT NULL,
    postal_code text NOT NULL,
    city text NOT NULL,
    region text,
    country_code character(2) DEFAULT 'DE'::bpchar NOT NULL,
    lat numeric(9,6),
    lng numeric(9,6),
    phone text,
    email text,
    google_place_id text,
    opening_hours jsonb DEFAULT '{}'::jsonb NOT NULL,
    service_area_postal_codes text[] DEFAULT '{}'::text[] NOT NULL,
    schema_org_business_type text DEFAULT 'JewelryStore'::text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_locations_country_format CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT business_locations_lat_lng_together CHECK ((((lat IS NULL) AND (lng IS NULL)) OR ((lat IS NOT NULL) AND (lng IS NOT NULL)))),
    CONSTRAINT business_locations_lat_range CHECK (((lat IS NULL) OR ((lat >= ('-90'::integer)::numeric) AND (lat <= (90)::numeric)))),
    CONSTRAINT business_locations_lng_range CHECK (((lng IS NULL) OR ((lng >= ('-180'::integer)::numeric) AND (lng <= (180)::numeric))))
);


ALTER TABLE public.business_locations OWNER TO warehouse14_migrator;

--
-- Name: TABLE business_locations; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.business_locations IS 'The shop''s own canonical address + Google Business binding. Day 13.';


--
-- Name: COLUMN business_locations.service_area_postal_codes; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.business_locations.service_area_postal_codes IS 'Postal codes the shop accepts estate pickups from. Drives /goldankauf/<city>.';


--
-- Name: COLUMN business_locations.is_primary; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.business_locations.is_primary IS 'Exactly one TRUE across active rows (partial UNIQUE). Drives storefront footer.';


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid NOT NULL,
    unit_price_eur numeric(18,2) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cart_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT cart_items_unit_price_eur_check CHECK ((unit_price_eur >= (0)::numeric))
);


ALTER TABLE public.cart_items OWNER TO warehouse14_migrator;

--
-- Name: carts; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.carts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shopper_id uuid NOT NULL,
    status public.cart_status DEFAULT 'ACTIVE'::public.cart_status NOT NULL,
    reservation_session_id uuid,
    checkout_started_at timestamp with time zone,
    checkout_expires_at timestamp with time zone,
    converted_to_transaction_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reserved_at timestamp with time zone,
    order_number text,
    fulfilment_method public.fulfilment_method DEFAULT 'PICKUP'::public.fulfilment_method NOT NULL,
    fulfilment_status public.fulfilment_status DEFAULT 'NOT_REQUIRED'::public.fulfilment_status NOT NULL,
    shipping_address_encrypted bytea,
    shipping_country character(2),
    shipping_rate_id uuid,
    shipping_cost_eur numeric(18,2),
    shipping_vat_eur numeric(18,2),
    pickup_stage public.pickup_stage,
    approved_at timestamp with time zone,
    approved_by_user_id uuid,
    preparation_started_at timestamp with time zone,
    ready_at timestamp with time zone,
    collected_at timestamp with time zone,
    collected_by_user_id uuid,
    anonymized_at timestamp with time zone,
    expiry_reminder_sent_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by_user_id uuid,
    cancellation_reason text,
    cancelled_by_role text,
    order_origin public.order_origin DEFAULT 'WEBSHOP'::public.order_origin NOT NULL,
    CONSTRAINT carts_cancellation_role_known CHECK (((cancelled_by_role IS NULL) OR (cancelled_by_role = ANY (ARRAY['CUSTOMER'::text, 'STAFF'::text])))),
    CONSTRAINT carts_checkout_evidence CHECK (((status <> 'CHECKOUT'::public.cart_status) OR ((reservation_session_id IS NOT NULL) AND (checkout_started_at IS NOT NULL) AND (checkout_expires_at IS NOT NULL) AND (checkout_expires_at > checkout_started_at)))),
    CONSTRAINT carts_converted_has_transaction CHECK (((status <> 'CONVERTED'::public.cart_status) OR (converted_to_transaction_id IS NOT NULL))),
    CONSTRAINT carts_fulfilment_pair_sane CHECK ((((fulfilment_method = 'PICKUP'::public.fulfilment_method) AND (fulfilment_status = 'NOT_REQUIRED'::public.fulfilment_status)) OR ((fulfilment_method = 'SHIPPING'::public.fulfilment_method) AND (fulfilment_status <> 'NOT_REQUIRED'::public.fulfilment_status)))),
    CONSTRAINT carts_pickup_stage_only_for_pickup CHECK (((pickup_stage IS NULL) OR (fulfilment_method = 'PICKUP'::public.fulfilment_method))),
    CONSTRAINT carts_shipping_needs_destination CHECK (((fulfilment_method <> 'SHIPPING'::public.fulfilment_method) OR (status = ANY (ARRAY['ACTIVE'::public.cart_status, 'ABANDONED'::public.cart_status, 'CANCELLED'::public.cart_status])) OR (anonymized_at IS NOT NULL) OR ((shipping_address_encrypted IS NOT NULL) AND (shipping_country IS NOT NULL))))
);


ALTER TABLE public.carts OWNER TO warehouse14_migrator;

--
-- Name: COLUMN carts.expiry_reminder_sent_at; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.carts.expiry_reminder_sent_at IS 'Wann die Erinnerung vor Fristablauf hinausging. NULL heisst: noch nicht erinnert. Verhindert einen zweiten Brief.';


--
-- Name: COLUMN carts.cancelled_by_role; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.carts.cancelled_by_role IS 'CUSTOMER wenn die Kundschaft selbst storniert hat, STAFF wenn das Haus abgelehnt oder storniert hat. Wer es war, steht in cancelled_by_user_id; bei CUSTOMER bleibt der NULL, weil kein Mitarbeiter gehandelt hat.';


--
-- Name: cash_movements; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.cash_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shift_id uuid NOT NULL,
    direction public.cash_movement_direction NOT NULL,
    amount_eur numeric(18,2) NOT NULL,
    reason text NOT NULL,
    witness_user_id uuid,
    performed_by_user_id uuid NOT NULL,
    external_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_movements_amount_eur_check CHECK ((amount_eur > (0)::numeric))
);


ALTER TABLE public.cash_movements OWNER TO warehouse14_migrator;

--
-- Name: TABLE cash_movements; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.cash_movements IS 'Geldtransit ledger. BANK_DROP = drawer→bank (reduces drawer); SAFE_TRANSIT = drawer↔safe; INJECTION = added to drawer mid-shift. Append-only (no UPDATE / no DELETE). Witness witness_user_id required for amounts > €1000 (enforced at API layer).';


--
-- Name: COLUMN cash_movements.external_ref; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.cash_movements.external_ref IS 'Der Idempotenzschluessel des Aufrufers. Ein zweiter Aufruf mit demselben Wert erzeugt KEINE zweite Zeile, sondern liefert die bestehende zurueck. NULL ist erlaubt (Altbestand und Wege ohne Schluessel).';


--
-- Name: categories; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    slug text NOT NULL,
    name_de text NOT NULL,
    name_en text,
    description_de text,
    description_en text,
    schema_org_type text,
    display_order integer DEFAULT 0 NOT NULL,
    hidden_from_storefront boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT categories_no_self_parent CHECK ((id <> parent_id)),
    CONSTRAINT categories_slug_format CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


ALTER TABLE public.categories OWNER TO warehouse14_migrator;

--
-- Name: TABLE categories; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.categories IS '2-level hierarchical taxonomy. parent_id NULL = top-level. Day 13 — Phase 2.B.';


--
-- Name: category_translations; Type: TABLE; Schema: public; Owner: warehouse14
--

CREATE TABLE public.category_translations (
    category_id uuid NOT NULL,
    locale text NOT NULL,
    name text,
    description text,
    source_fingerprint text NOT NULL,
    provider text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT category_translations_has_text CHECK (((name IS NOT NULL) OR (description IS NOT NULL))),
    CONSTRAINT category_translations_locale_format CHECK ((locale ~ '^[a-z]{2}$'::text))
);


ALTER TABLE public.category_translations OWNER TO warehouse14;

--
-- Name: TABLE category_translations; Type: COMMENT; Schema: public; Owner: warehouse14
--

COMMENT ON TABLE public.category_translations IS 'Derived cache of per locale category name/description. Rebuildable; no personal or fiscal data.';


--
-- Name: customer_broadcasts; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.customer_broadcasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    via_push boolean DEFAULT false NOT NULL,
    via_email boolean DEFAULT false NOT NULL,
    audience text NOT NULL,
    content jsonb NOT NULL,
    deep_link text,
    queued_push integer DEFAULT 0 NOT NULL,
    queued_email integer DEFAULT 0 NOT NULL,
    skipped_no_consent integer DEFAULT 0 NOT NULL,
    CONSTRAINT customer_broadcasts_audience_check CHECK ((audience = ANY (ARRAY['ALL'::text, 'MARKETING'::text]))),
    CONSTRAINT customer_broadcasts_has_channel CHECK ((via_push OR via_email)),
    CONSTRAINT customer_broadcasts_has_german CHECK ((content ? 'de'::text))
);


ALTER TABLE public.customer_broadcasts OWNER TO warehouse14_migrator;

--
-- Name: customer_number_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.customer_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_number_seq OWNER TO warehouse14_migrator;

--
-- Name: customers; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    customer_number text DEFAULT ((('CUST-'::text || to_char((now() AT TIME ZONE 'Europe/Berlin'::text), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.customer_number_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    full_name_encrypted bytea NOT NULL,
    date_of_birth_encrypted bytea,
    email_encrypted bytea,
    phone_encrypted bytea,
    address_encrypted bytea,
    notes_encrypted bytea,
    email_blind_index bytea,
    phone_blind_index bytea,
    preferred_language character(2) DEFAULT 'de'::bpchar NOT NULL,
    customer_tags text[] DEFAULT '{}'::text[] NOT NULL,
    kyc_status public.kyc_status DEFAULT 'NOT_REQUIRED'::public.kyc_status NOT NULL,
    kyc_completed_at timestamp with time zone,
    kyc_expires_at timestamp with time zone,
    sanctions_screened_at timestamp with time zone,
    sanctions_match boolean DEFAULT false NOT NULL,
    pep_match boolean DEFAULT false NOT NULL,
    cumulative_spend_eur numeric(18,2) DEFAULT 0 NOT NULL,
    cumulative_ankauf_eur numeric(18,2) DEFAULT 0 NOT NULL,
    retention_until date NOT NULL,
    soft_deleted_at timestamp with time zone,
    anonymized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cumulative_debt_eur numeric(18,2) DEFAULT 0 NOT NULL,
    trust_level public.customer_trust_level DEFAULT 'NEW'::public.customer_trust_level NOT NULL,
    kyc_verified_at timestamp with time zone,
    kyc_verified_by_user_id uuid,
    price_expectation_notes text,
    vat_id text,
    erasure_initiated_by text,
    vat_id_checked_at timestamp with time zone,
    vat_id_check_result public.vat_check_result,
    vat_id_check_name text,
    vat_id_check_address text,
    vat_id_checked_value text,
    CONSTRAINT customers_anonymized_after_soft_deleted CHECK (((anonymized_at IS NULL) OR (anonymized_at >= soft_deleted_at))),
    CONSTRAINT customers_anonymized_implies_soft_deleted CHECK (((anonymized_at IS NULL) OR (soft_deleted_at IS NOT NULL))),
    CONSTRAINT customers_banned_or_suspicious_has_note CHECK (((trust_level <> ALL (ARRAY['SUSPICIOUS'::public.customer_trust_level, 'BANNED'::public.customer_trust_level])) OR ((price_expectation_notes IS NOT NULL) AND (length(price_expectation_notes) >= 8)))),
    CONSTRAINT customers_cumulative_ankauf_eur_check CHECK ((cumulative_ankauf_eur >= (0)::numeric)),
    CONSTRAINT customers_cumulative_debt_non_negative CHECK ((cumulative_debt_eur >= (0)::numeric)),
    CONSTRAINT customers_cumulative_spend_eur_check CHECK ((cumulative_spend_eur >= (0)::numeric)),
    CONSTRAINT customers_erasure_origin_known CHECK (((erasure_initiated_by IS NULL) OR (erasure_initiated_by = ANY (ARRAY['CUSTOMER'::text, 'STAFF'::text])))),
    CONSTRAINT customers_kyc_verified_evidence CHECK (((kyc_verified_at IS NULL) = (kyc_verified_by_user_id IS NULL))),
    CONSTRAINT customers_preferred_language_check CHECK ((preferred_language = ANY (ARRAY['de'::bpchar, 'en'::bpchar, 'ar'::bpchar]))),
    CONSTRAINT customers_verified_has_kyc_dates CHECK (((kyc_status <> ALL (ARRAY['VERIFIED'::public.kyc_status, 'EXPIRED'::public.kyc_status])) OR ((kyc_completed_at IS NOT NULL) AND (kyc_expires_at IS NOT NULL)))),
    CONSTRAINT customers_verified_trust_requires_kyc CHECK (((trust_level <> ALL (ARRAY['VERIFIED'::public.customer_trust_level, 'VIP'::public.customer_trust_level])) OR (kyc_verified_at IS NOT NULL)))
);


ALTER TABLE public.customers OWNER TO warehouse14_migrator;

--
-- Name: TABLE customers; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.customers IS 'Customer records with encrypted PII (pgcrypto). NEVER deleted by app role — GDPR via soft_deleted_at + anonymized_at. See ADR-0007 (GwG), ADR-0008 §10 (defense-in-depth).';


--
-- Name: COLUMN customers.cumulative_spend_eur; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.customers.cumulative_spend_eur IS 'Denormalized total Verkauf revenue from this customer. Written by trigger in migration 0009. App role has NO UPDATE.';


--
-- Name: COLUMN customers.cumulative_ankauf_eur; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.customers.cumulative_ankauf_eur IS 'Denormalized total Ankauf payouts to this customer. Drives the GwG enhanced-due-diligence threshold (€15k/12mo).';


--
-- Name: COLUMN customers.cumulative_debt_eur; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.customers.cumulative_debt_eur IS 'Outstanding debt balance — accumulated when transaction_payments lands a DEBT row, reversed when a storno of that transaction lands a negative DEBT row. NOT NULL CHECK >= 0 — over-reversal is refused.';


--
-- Name: COLUMN customers.trust_level; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.customers.trust_level IS 'Operator business judgement. Distinct from kyc_status (legal state). Promotion to VERIFIED/VIP requires kyc_verified_at to be set.';


--
-- Name: COLUMN customers.kyc_verified_at; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.customers.kyc_verified_at IS 'When the operator personally inspected the physical ID. Different from kyc_completed_at, which records when the document upload pipeline finished.';


--
-- Name: COLUMN customers.price_expectation_notes; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.customers.price_expectation_notes IS 'Free-text notes about haggling patterns, payment-term preferences, etc. Mandatory when trust_level IN (SUSPICIOUS, BANNED).';


--
-- Name: COLUMN customers.vat_id; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.customers.vat_id IS 'European Union B2B VAT ID (VIES verified).';


--
-- Name: COLUMN customers.erasure_initiated_by; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.customers.erasure_initiated_by IS 'CUSTOMER wenn die Person ihr Konto selbst gelöscht hat, STAFF wenn das Haus es getan hat. NULL solange nichts gelöscht wurde. Die Kundennummer und alle Vorgänge bleiben in jedem Fall.';


--
-- Name: COLUMN customers.vat_id_checked_value; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.customers.vat_id_checked_value IS 'Die normalisierte USt-IdNr., die tatsächlich abgefragt wurde. Weicht sie von vat_id ab, gilt die Prüfung nicht mehr.';


--
-- Name: daily_closings; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.daily_closings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    business_day date NOT NULL,
    state public.closing_state DEFAULT 'COUNTING'::public.closing_state NOT NULL,
    verkauf_count integer DEFAULT 0 NOT NULL,
    ankauf_count integer DEFAULT 0 NOT NULL,
    storno_count integer DEFAULT 0 NOT NULL,
    gross_verkauf_eur numeric(18,2) DEFAULT 0 NOT NULL,
    gross_ankauf_eur numeric(18,2) DEFAULT 0 NOT NULL,
    net_verkauf_eur numeric(18,2) DEFAULT 0 NOT NULL,
    net_ankauf_eur numeric(18,2) DEFAULT 0 NOT NULL,
    vat_by_treatment jsonb DEFAULT '{}'::jsonb NOT NULL,
    payments_by_method jsonb DEFAULT '{}'::jsonb NOT NULL,
    cash_drawer_expected_eur numeric(18,2),
    cash_drawer_counted_eur numeric(18,2),
    cash_drawer_variance_eur numeric(18,2),
    tse_finished_count integer DEFAULT 0 NOT NULL,
    tse_pending_count integer DEFAULT 0 NOT NULL,
    tse_failed_count integer DEFAULT 0 NOT NULL,
    ledger_anchor_id bigint,
    ledger_anchor_hash bytea,
    counted_by_user_id uuid,
    counted_at timestamp with time zone,
    finalized_by_user_id uuid,
    finalized_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    storno_verkauf_eur numeric(18,2) DEFAULT 0 NOT NULL,
    storno_ankauf_eur numeric(18,2) DEFAULT 0 NOT NULL,
    z_nr bigint,
    umsatz_by_treatment jsonb,
    CONSTRAINT daily_closings_counts_non_negative CHECK (((verkauf_count >= 0) AND (ankauf_count >= 0) AND (storno_count >= 0) AND (tse_finished_count >= 0) AND (tse_pending_count >= 0) AND (tse_failed_count >= 0))),
    CONSTRAINT daily_closings_finalized_has_evidence CHECK (((state <> 'FINALIZED'::public.closing_state) OR ((finalized_by_user_id IS NOT NULL) AND (finalized_at IS NOT NULL) AND (counted_by_user_id IS NOT NULL) AND (counted_at IS NOT NULL) AND (cash_drawer_counted_eur IS NOT NULL) AND (cash_drawer_expected_eur IS NOT NULL) AND (cash_drawer_variance_eur IS NOT NULL) AND (ledger_anchor_id IS NOT NULL) AND (ledger_anchor_hash IS NOT NULL) AND (octet_length(ledger_anchor_hash) = 32)))),
    CONSTRAINT daily_closings_gross_non_negative CHECK (((gross_verkauf_eur >= (0)::numeric) AND (gross_ankauf_eur >= (0)::numeric))),
    CONSTRAINT daily_closings_payments_object CHECK ((jsonb_typeof(payments_by_method) = 'object'::text)),
    CONSTRAINT daily_closings_storno_non_negative CHECK (((storno_verkauf_eur >= (0)::numeric) AND (storno_ankauf_eur >= (0)::numeric))),
    CONSTRAINT daily_closings_variance_math CHECK (((cash_drawer_variance_eur IS NULL) OR ((cash_drawer_counted_eur IS NOT NULL) AND (cash_drawer_expected_eur IS NOT NULL) AND (cash_drawer_variance_eur = (cash_drawer_counted_eur - cash_drawer_expected_eur))))),
    CONSTRAINT daily_closings_vat_object CHECK ((jsonb_typeof(vat_by_treatment) = 'object'::text))
);


ALTER TABLE public.daily_closings OWNER TO warehouse14_migrator;

--
-- Name: TABLE daily_closings; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.daily_closings IS 'The Z-report. One row per (business_day, shop_id). Immutable once FINALIZED — all totals, counts, anchors, and finalization markers are locked. Only `notes` is editable after.';


--
-- Name: COLUMN daily_closings.gross_verkauf_eur; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.daily_closings.gross_verkauf_eur IS 'Verkäufe VOR Stornierung. Seit 0112 ohne die negativen Stornozeilen; davor war es die Summe MIT ihnen, was den Wert negativ werden liess und gegen daily_closings_gross_non_negative verstiess.';


--
-- Name: COLUMN daily_closings.ledger_anchor_hash; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.daily_closings.ledger_anchor_hash IS 'SHA-256 of the chain head at FINALIZED time — the daily checkpoint anchor (ADR-0008 §Known limits #2).';


--
-- Name: COLUMN daily_closings.storno_verkauf_eur; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.daily_closings.storno_verkauf_eur IS 'Stornierte Verkaufsbeträge des Tages, als positive Grösse. Tatsächlicher Umsatz = gross_verkauf_eur - storno_verkauf_eur. Pflicht nach BFH 29.07.2025 X R 23-24/21: der Betrag, nicht nur die Anzahl.';


--
-- Name: COLUMN daily_closings.storno_ankauf_eur; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.daily_closings.storno_ankauf_eur IS 'Stornierte Ankaufsbeträge des Tages, als positive Grösse.';


--
-- Name: COLUMN daily_closings.z_nr; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.daily_closings.z_nr IS 'DSFinV-K Z_NR: fortlaufende Nummer des Kassenabschlusses je Kasse, ab 1. NULL solange der Abschluss nicht festgeschrieben ist. Wird in derselben Transaktion wie finalized_at aus max(z_nr)+1 gebildet, nie aus einer SEQUENCE — die risse bei einem Rollback eine Lücke, und eine Lücke muss einen FEHLENDEN Abschluss bedeuten.';


--
-- Name: COLUMN daily_closings.umsatz_by_treatment; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.daily_closings.umsatz_by_treatment IS 'Umsatz je Steuerbehandlung, als {code: {brutto, netto}}. Gegenstück zu vat_by_treatment. Wird beim Festschreiben AUFGEZEICHNET, nie aus der Steuer zurückgerechnet: bei § 25a ist die Bemessungsgrundlage die Marge, und bei steuerfreien Umsätzen führt der Rückweg ins Leere. Gebraucht für businesscases.csv (DSFinV-K), die Datei, aus der ein Prüfer den Tagesumsatz je Steuersatz liest.';


--
-- Name: device_push_tokens; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.device_push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    token text NOT NULL,
    platform text NOT NULL,
    app text NOT NULL,
    device_label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    shopper_id uuid,
    CONSTRAINT device_push_tokens_app_known CHECK ((app = ANY (ARRAY['owner'::text, 'cashier'::text, 'shop'::text]))),
    CONSTRAINT device_push_tokens_owner_matches_app CHECK ((((app = 'shop'::text) AND (shopper_id IS NOT NULL) AND (user_id IS NULL)) OR ((app = ANY (ARRAY['owner'::text, 'cashier'::text])) AND (user_id IS NOT NULL) AND (shopper_id IS NULL)))),
    CONSTRAINT device_push_tokens_platform_known CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])))
);


ALTER TABLE public.device_push_tokens OWNER TO warehouse14_migrator;

--
-- Name: devices; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_class public.device_class NOT NULL,
    hostname text,
    cert_serial text NOT NULL,
    cert_issued_at timestamp with time zone NOT NULL,
    cert_expires_at timestamp with time zone NOT NULL,
    status public.device_status DEFAULT 'active'::public.device_status NOT NULL,
    paired_by_user_id uuid NOT NULL,
    paired_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    last_seen_ip inet,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT devices_cert_validity_range CHECK ((cert_expires_at > cert_issued_at))
);


ALTER TABLE public.devices OWNER TO warehouse14_migrator;

--
-- Name: TABLE devices; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.devices IS 'mTLS-paired terminals + Control Desktop instances. Cert serial maps the TLS handshake to a row (ADR-0009 §3).';


--
-- Name: document_attachments; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.document_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category public.document_category NOT NULL,
    r2_key text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256_hex text,
    customer_id uuid,
    product_id uuid,
    transaction_id uuid,
    appraisal_id uuid,
    uploaded_by_user_id uuid NOT NULL,
    notes text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_attachments_ankaufbeleg_link CHECK (((category <> 'ANKAUFBELEG'::public.document_category) OR ((customer_id IS NOT NULL) OR (transaction_id IS NOT NULL)))),
    CONSTRAINT document_attachments_ausweis_is_customer CHECK (((category <> 'AUSWEIS'::public.document_category) OR (customer_id IS NOT NULL))),
    CONSTRAINT document_attachments_exactly_one_link CHECK (((((((customer_id IS NOT NULL))::integer + ((product_id IS NOT NULL))::integer) + ((transaction_id IS NOT NULL))::integer) + ((appraisal_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT document_attachments_expertise_link CHECK (((category <> 'EXPERTISE'::public.document_category) OR ((appraisal_id IS NOT NULL) OR (product_id IS NOT NULL)))),
    CONSTRAINT document_attachments_file_name_check CHECK (((length(file_name) >= 1) AND (length(file_name) <= 255))),
    CONSTRAINT document_attachments_mime_type_check CHECK (((length(mime_type) >= 1) AND (length(mime_type) <= 255))),
    CONSTRAINT document_attachments_r2_key_check CHECK (((length(r2_key) >= 1) AND (length(r2_key) <= 1024))),
    CONSTRAINT document_attachments_rechnung_link CHECK (((category <> 'RECHNUNG'::public.document_category) OR ((customer_id IS NOT NULL) OR (transaction_id IS NOT NULL)))),
    CONSTRAINT document_attachments_sha256_hex_check CHECK (((sha256_hex IS NULL) OR (length(sha256_hex) = 64))),
    CONSTRAINT document_attachments_size_bytes_check CHECK ((size_bytes > 0)),
    CONSTRAINT document_attachments_versandbeleg_is_transaction CHECK (((category <> 'VERSANDBELEG'::public.document_category) OR (transaction_id IS NOT NULL)))
);


ALTER TABLE public.document_attachments OWNER TO warehouse14_migrator;

--
-- Name: TABLE document_attachments; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.document_attachments IS 'PDFs / images / scans linked to ONE business entity (customer, product, transaction, or appraisal). Bytes live in R2; rows are forensic context. Soft-delete via archived_at — never hard delete (evidentiary).';


--
-- Name: dsfinvk_exports; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.dsfinvk_exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    period_start date NOT NULL,
    period_end date NOT NULL,
    state public.dsfinvk_export_state DEFAULT 'GENERATING'::public.dsfinvk_export_state NOT NULL,
    requested_by_user_id uuid NOT NULL,
    generated_at timestamp with time zone,
    delivered_at timestamp with time zone,
    delivery_method text,
    delivery_target text,
    r2_key text,
    file_size_bytes bigint,
    file_sha256 bytea,
    transaction_count integer,
    daily_closings_count integer,
    total_gross_eur numeric(18,2),
    daily_closing_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    last_error_at timestamp with time zone,
    last_error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dsfinvk_exports_delivered_has_marker CHECK (((state <> 'DELIVERED_TO_STEUERBERATER'::public.dsfinvk_export_state) OR ((delivered_at IS NOT NULL) AND (delivery_method IS NOT NULL)))),
    CONSTRAINT dsfinvk_exports_generated_has_file CHECK (((state <> ALL (ARRAY['GENERATED'::public.dsfinvk_export_state, 'DELIVERED_TO_STEUERBERATER'::public.dsfinvk_export_state])) OR ((r2_key IS NOT NULL) AND (file_sha256 IS NOT NULL) AND (file_size_bytes IS NOT NULL) AND (generated_at IS NOT NULL)))),
    CONSTRAINT dsfinvk_exports_period_order CHECK ((period_end >= period_start)),
    CONSTRAINT dsfinvk_exports_sha256_length CHECK (((file_sha256 IS NULL) OR (octet_length(file_sha256) = 32)))
);


ALTER TABLE public.dsfinvk_exports OWNER TO warehouse14_migrator;

--
-- Name: TABLE dsfinvk_exports; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.dsfinvk_exports IS 'The legal paper trail of DSFinV-K bundle generation and delivery to the Steuerberater. NEVER deleted by app role. Each row carries the SHA-256 of the bundle, the requester, the period, and the delivery evidence.';


--
-- Name: email_outbox; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.email_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_encrypted bytea NOT NULL,
    template text NOT NULL,
    subject text NOT NULL,
    body_text text NOT NULL,
    body_html text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    locale character(2) DEFAULT 'de'::bpchar NOT NULL,
    customer_id uuid,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    thread_key text,
    CONSTRAINT email_outbox_attempts_nonneg CHECK ((attempts >= 0)),
    CONSTRAINT email_outbox_locale_format CHECK ((locale ~ '^[a-z]{2}$'::text)),
    CONSTRAINT email_outbox_sent_has_timestamp CHECK (((status <> 'SENT'::text) OR (sent_at IS NOT NULL))),
    CONSTRAINT email_outbox_status_domain CHECK ((status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'FAILED'::text]))),
    CONSTRAINT email_outbox_thread_key_sane CHECK (((thread_key IS NULL) OR (thread_key ~ '^[A-Za-z0-9._-]{1,120}$'::text)))
);


ALTER TABLE public.email_outbox OWNER TO warehouse14_migrator;

--
-- Name: COLUMN email_outbox.locale; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.email_outbox.locale IS 'Language this letter was composed in. Recorded so the sent language is answerable without reading the body.';


--
-- Name: fixed_costs; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.fixed_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    monthly_amount_cents integer NOT NULL,
    active_from date NOT NULL,
    active_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fixed_costs_amount_positive CHECK ((monthly_amount_cents > 0)),
    CONSTRAINT fixed_costs_label_check CHECK (((length(label) >= 1) AND (length(label) <= 200))),
    CONSTRAINT fixed_costs_range_ordered CHECK (((active_to IS NULL) OR (active_to >= active_from)))
);


ALTER TABLE public.fixed_costs OWNER TO warehouse14_migrator;

--
-- Name: TABLE fixed_costs; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.fixed_costs IS 'Recurring monthly Fixkosten (Miete, Strom, Versicherung, Abos). Money in integer cents. Close a line with active_to — never delete (past months keep their allocation).';


--
-- Name: hallmarks; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.hallmarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stamp text NOT NULL,
    metal text NOT NULL,
    fineness_per_1000 smallint NOT NULL,
    fineness_decimal numeric(5,4) NOT NULL,
    description_de text NOT NULL,
    description_en text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hallmarks_decimal_matches_per_mille CHECK ((abs((fineness_decimal - ((fineness_per_1000)::numeric / (1000)::numeric))) < 0.00005)),
    CONSTRAINT hallmarks_decimal_range CHECK (((fineness_decimal > (0)::numeric) AND (fineness_decimal <= 1.0000))),
    CONSTRAINT hallmarks_fineness_range CHECK (((fineness_per_1000 >= 1) AND (fineness_per_1000 <= 1000))),
    CONSTRAINT hallmarks_metal_check CHECK ((metal = ANY (ARRAY['gold'::text, 'silver'::text, 'platinum'::text, 'palladium'::text])))
);


ALTER TABLE public.hallmarks OWNER TO warehouse14_migrator;

--
-- Name: TABLE hallmarks; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.hallmarks IS 'Visual hallmark → (metal, fineness) lookup. Used by intake Vision OCR (ADR-0015 §5). READ-ONLY for app role.';


--
-- Name: internal_tasks; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.internal_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    priority public.task_priority DEFAULT 'NORMAL'::public.task_priority NOT NULL,
    status public.task_status DEFAULT 'OPEN'::public.task_status NOT NULL,
    assigned_to_user_id uuid NOT NULL,
    created_by_user_id uuid NOT NULL,
    due_date date,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    related_entity_table text,
    related_entity_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT internal_tasks_cancelled_has_reason CHECK (((status <> 'CANCELLED'::public.task_status) OR ((cancelled_at IS NOT NULL) AND (cancellation_reason IS NOT NULL) AND (length(cancellation_reason) >= 4)))),
    CONSTRAINT internal_tasks_done_has_completion CHECK (((status <> 'DONE'::public.task_status) OR ((completed_at IS NOT NULL) AND (started_at IS NOT NULL)))),
    CONSTRAINT internal_tasks_in_progress_has_started CHECK (((status <> 'IN_PROGRESS'::public.task_status) OR (started_at IS NOT NULL))),
    CONSTRAINT internal_tasks_open_no_timestamps CHECK (((status <> 'OPEN'::public.task_status) OR ((started_at IS NULL) AND (completed_at IS NULL) AND (cancelled_at IS NULL)))),
    CONSTRAINT internal_tasks_related_entity_both_or_none CHECK (((related_entity_table IS NULL) = (related_entity_id IS NULL))),
    CONSTRAINT internal_tasks_related_entity_known CHECK (((related_entity_table IS NULL) OR (related_entity_table = ANY (ARRAY['products'::text, 'customers'::text, 'transactions'::text, 'appraisals'::text, 'product_photos'::text, 'shifts'::text, 'inventory_sessions'::text])))),
    CONSTRAINT internal_tasks_terminal_not_both CHECK (((completed_at IS NULL) OR (cancelled_at IS NULL))),
    CONSTRAINT internal_tasks_title_check CHECK (((length(title) >= 1) AND (length(title) <= 200)))
);


ALTER TABLE public.internal_tasks OWNER TO warehouse14_migrator;

--
-- Name: TABLE internal_tasks; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.internal_tasks IS 'Operator day-list. In single-operator V1 the route layer auto-assigns to req.actor.id when the body omits assigned_to_user_id; the DB stays agnostic so adding a Lehrling needs zero migration.';


--
-- Name: COLUMN internal_tasks.related_entity_table; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.internal_tasks.related_entity_table IS 'Polymorphic link. Allowed values match a whitelist of domain tables — extend when new domains need attached tasks.';


--
-- Name: inventory_scans; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.inventory_scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    raw_barcode text NOT NULL,
    product_id uuid,
    match_status public.inventory_scan_match NOT NULL,
    scanned_by_user_id uuid NOT NULL,
    scanned_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.inventory_scans OWNER TO warehouse14_migrator;

--
-- Name: TABLE inventory_scans; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.inventory_scans IS 'Append-only barcode-scan log per inventory session. A product scanned twice in the same session lands a DUPLICATE row — operator reviews.';


--
-- Name: inventory_sessions; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.inventory_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opened_by_user_id uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    closed_by_user_id uuid,
    status public.inventory_session_status DEFAULT 'OPEN'::public.inventory_session_status NOT NULL,
    expected_count integer DEFAULT 0 NOT NULL,
    matched_count integer,
    missing_count integer,
    unexpected_count integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_sessions_closed_has_evidence CHECK (((status <> 'CLOSED'::public.inventory_session_status) OR ((closed_by_user_id IS NOT NULL) AND (closed_at IS NOT NULL) AND (matched_count IS NOT NULL) AND (missing_count IS NOT NULL) AND (unexpected_count IS NOT NULL))))
);


ALTER TABLE public.inventory_sessions OWNER TO warehouse14_migrator;

--
-- Name: karat_grades; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.karat_grades (
    code text NOT NULL,
    karat_value smallint NOT NULL,
    fineness_per_1000 smallint NOT NULL,
    fineness_decimal numeric(5,4) NOT NULL,
    hallmark_stamp text NOT NULL,
    display_label_de text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT karat_grades_code_format CHECK ((code ~ '^[0-9]{1,2}K$'::text)),
    CONSTRAINT karat_grades_decimal_matches_per_mille CHECK ((abs((fineness_decimal - ((fineness_per_1000)::numeric / (1000)::numeric))) < 0.00005)),
    CONSTRAINT karat_grades_decimal_range CHECK (((fineness_decimal > (0)::numeric) AND (fineness_decimal <= 1.0000))),
    CONSTRAINT karat_grades_fineness_range CHECK (((fineness_per_1000 >= 1) AND (fineness_per_1000 <= 999))),
    CONSTRAINT karat_grades_value_range CHECK (((karat_value >= 1) AND (karat_value <= 24)))
);


ALTER TABLE public.karat_grades OWNER TO warehouse14_migrator;

--
-- Name: TABLE karat_grades; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.karat_grades IS 'Gold karat → fineness lookup. Standard DIN 17760 values. READ-ONLY for app role. See memory.md §7.13.';


--
-- Name: COLUMN karat_grades.fineness_decimal; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.karat_grades.fineness_decimal IS 'Fineness as NUMERIC(5,4) — 4-decimal precision. Used directly in price calcs via Decimal.js arithmetic. The CHECK constraint enforces consistency with fineness_per_1000.';


--
-- Name: kartenleser; Type: TABLE; Schema: public; Owner: warehouse14
--

CREATE TABLE public.kartenleser (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider public.payment_provider NOT NULL,
    provider_reader_id text NOT NULL,
    bezeichnung text NOT NULL,
    geraetetyp text,
    seriennummer text,
    provider_location_id text,
    zuletzt_gesehen_status text,
    registriert_am timestamp with time zone DEFAULT now() NOT NULL,
    registriert_von uuid,
    CONSTRAINT kartenleser_bezeichnung_laenge CHECK (((char_length(bezeichnung) >= 1) AND (char_length(bezeichnung) <= 100))),
    CONSTRAINT kartenleser_kennung_form CHECK ((provider_reader_id ~ '^tmr_[A-Za-z0-9]+$'::text)),
    CONSTRAINT kartenleser_standort_form CHECK (((provider_location_id IS NULL) OR (provider_location_id ~ '^tml_[A-Za-z0-9]+$'::text)))
);


ALTER TABLE public.kartenleser OWNER TO warehouse14;

--
-- Name: TABLE kartenleser; Type: COMMENT; Schema: public; Owner: warehouse14
--

COMMENT ON TABLE public.kartenleser IS 'Die beim Zahlungsanbieter registrierten Kartenleser des Haendlers (Mandantendaten, per API gefuellt — nie per Wanderung).';


--
-- Name: kyc_documents; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.kyc_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    document_type public.id_document_type NOT NULL,
    issuing_country_iso2 character(2) NOT NULL,
    issuing_authority text,
    document_number_encrypted bytea,
    issued_on date,
    expires_on date NOT NULL,
    document_photo_storage_key text,
    document_photo_sha256 bytea,
    captured_by_user_id uuid NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    captured_at_terminal_id uuid,
    verified_at timestamp with time zone,
    verified_by_user_id uuid,
    retention_until date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    purged_at timestamp with time zone,
    purged_by_user_id uuid,
    document_photo_size_bytes integer,
    CONSTRAINT kyc_documents_issuing_country_iso2_check CHECK ((issuing_country_iso2 ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT kyc_documents_purged_consistency CHECK ((((purged_at IS NULL) AND (document_number_encrypted IS NOT NULL) AND (document_photo_sha256 IS NOT NULL) AND (document_photo_storage_key IS NOT NULL) AND (purged_by_user_id IS NULL)) OR ((purged_at IS NOT NULL) AND (document_number_encrypted IS NULL) AND (document_photo_sha256 IS NULL) AND (document_photo_storage_key IS NULL) AND (purged_by_user_id IS NOT NULL)))),
    CONSTRAINT kyc_documents_sha256_length CHECK ((octet_length(document_photo_sha256) = 32)),
    CONSTRAINT kyc_documents_validity_range CHECK (((issued_on IS NULL) OR (expires_on > issued_on))),
    CONSTRAINT kyc_documents_verified_has_verifier CHECK (((verified_at IS NULL) = (verified_by_user_id IS NULL)))
);


ALTER TABLE public.kyc_documents OWNER TO warehouse14_migrator;

--
-- Name: TABLE kyc_documents; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.kyc_documents IS 'ID document evidence (Personalausweis, Reisepass, …). The §259 StGB defense surface. NEVER deleted by app role — these rows are the legal proof of good-faith Ankauf.';


--
-- Name: ledger_chain_head; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.ledger_chain_head (
    only_row boolean DEFAULT true NOT NULL,
    last_row_hash bytea NOT NULL,
    CONSTRAINT ledger_chain_head_only_row_check CHECK (only_row)
);


ALTER TABLE public.ledger_chain_head OWNER TO warehouse14_migrator;

--
-- Name: TABLE ledger_chain_head; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.ledger_chain_head IS 'Singleton pointer to the tail row_hash of ledger_events. Read FOR UPDATE by ledger_compute_hash() to serialize + freshly read the chain head (replaces a snapshot-bound tail SELECT that forked under concurrency). Migration 0048.';


--
-- Name: ledger_events; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.ledger_events (
    id bigint NOT NULL,
    event_type text NOT NULL,
    entity_table text NOT NULL,
    entity_id uuid NOT NULL,
    actor_user_id uuid,
    device_id uuid,
    ip_address inet,
    payload jsonb NOT NULL,
    prev_hash bytea NOT NULL,
    row_hash bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_events_payload_object CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT ledger_events_prev_hash_length CHECK ((octet_length(prev_hash) = 32)),
    CONSTRAINT ledger_events_row_hash_length CHECK ((octet_length(row_hash) = 32))
);


ALTER TABLE public.ledger_events OWNER TO warehouse14_migrator;

--
-- Name: ledger_events_id_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.ledger_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ledger_events_id_seq OWNER TO warehouse14_migrator;

--
-- Name: ledger_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: warehouse14_migrator
--

ALTER SEQUENCE public.ledger_events_id_seq OWNED BY public.ledger_events.id;


--
-- Name: leser_zahlungen; Type: TABLE; Schema: public; Owner: warehouse14
--

CREATE TABLE public.leser_zahlungen (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    leser_id uuid,
    provider_reader_id text NOT NULL,
    provider public.payment_provider NOT NULL,
    provider_intent_id text NOT NULL,
    stripe_account_id text NOT NULL,
    betrag_cents bigint NOT NULL,
    steuer_cents bigint DEFAULT 0 NOT NULL,
    gebuehr_cents bigint DEFAULT 0 NOT NULL,
    gebuehr_bps integer,
    gebuehr_quelle text,
    status text DEFAULT 'PROCESSING'::text NOT NULL,
    fehlerbild text,
    fehler_meldung text,
    weiche_ablehnungen integer DEFAULT 0 NOT NULL,
    positionen jsonb NOT NULL,
    idempotenz_schluessel uuid NOT NULL,
    angelegt_von uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leser_zahlungen_betrag_positiv CHECK ((betrag_cents > 0)),
    CONSTRAINT leser_zahlungen_fehlerbild_erlaubt CHECK (((fehlerbild IS NULL) OR (fehlerbild = ANY (ARRAY['LESER_OFFLINE'::text, 'KARTE_ABGELEHNT'::text, 'ZEITUEBERSCHREITUNG'::text, 'ABBRUCH_AM_GERAET'::text])))),
    CONSTRAINT leser_zahlungen_gebuehr_bps_grenze CHECK (((gebuehr_bps IS NULL) OR ((gebuehr_bps >= 0) AND (gebuehr_bps <= 1000)))),
    CONSTRAINT leser_zahlungen_gebuehr_im_betrag CHECK (((gebuehr_cents >= 0) AND (gebuehr_cents <= betrag_cents))),
    CONSTRAINT leser_zahlungen_konto_form CHECK ((stripe_account_id ~ '^acct_[A-Za-z0-9]+$'::text)),
    CONSTRAINT leser_zahlungen_positionen_liste CHECK ((jsonb_typeof(positionen) = 'array'::text)),
    CONSTRAINT leser_zahlungen_status_erlaubt CHECK ((status = ANY (ARRAY['PROCESSING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CANCELED'::text]))),
    CONSTRAINT leser_zahlungen_steuer_im_betrag CHECK (((steuer_cents >= 0) AND (steuer_cents <= betrag_cents))),
    CONSTRAINT leser_zahlungen_weiche_nicht_negativ CHECK ((weiche_ablehnungen >= 0))
);


ALTER TABLE public.leser_zahlungen OWNER TO warehouse14;

--
-- Name: TABLE leser_zahlungen; Type: COMMENT; Schema: public; Owner: warehouse14
--

COMMENT ON TABLE public.leser_zahlungen IS 'Der Stand jeder servergesteuerten Leser-Zahlung (Stripe Terminal). SUCCEEDED ist endgueltig; die weiche girocard-Ablehnung wird gezaehlt, nie gebucht.';


--
-- Name: metal_prices; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.metal_prices (
    id bigint NOT NULL,
    metal text NOT NULL,
    price_per_gram_eur numeric(15,4) NOT NULL,
    source public.metal_price_source NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    source_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    manual_override_by_user_id uuid,
    manual_override_reason text,
    fetched_by_job_run_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT metal_prices_manual_evidence CHECK (((source <> 'MANUAL'::public.metal_price_source) OR ((manual_override_by_user_id IS NOT NULL) AND (manual_override_reason IS NOT NULL)))),
    CONSTRAINT metal_prices_metal_check CHECK ((metal = ANY (ARRAY['gold'::text, 'silver'::text, 'platinum'::text, 'palladium'::text]))),
    CONSTRAINT metal_prices_payload_object CHECK ((jsonb_typeof(source_payload) = 'object'::text)),
    CONSTRAINT metal_prices_price_per_gram_eur_check CHECK ((price_per_gram_eur > (0)::numeric)),
    CONSTRAINT metal_prices_valid_range CHECK (((valid_to IS NULL) OR (valid_to > valid_from)))
);


ALTER TABLE public.metal_prices OWNER TO warehouse14_migrator;

--
-- Name: TABLE metal_prices; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.metal_prices IS 'Append-only Edelmetallkurs history. Partial UNIQUE on (metal) WHERE valid_to IS NULL guarantees exactly one CURRENT price per metal. Workflow: open one tx, UPDATE existing current → SET valid_to = now(), then INSERT new row. NEVER DELETE — forensic audit + DSFinV-K context.';


--
-- Name: COLUMN metal_prices.fetched_by_job_run_id; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.metal_prices.fetched_by_job_run_id IS 'Herkunftsangabe: welcher Abruf diesen Kurs geholt hat. Wird leer, sobald das Betriebsprotokoll turnusmässig aufgeräumt wird. Der Kurs selbst bleibt unberührt.';


--
-- Name: metal_prices_id_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.metal_prices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.metal_prices_id_seq OWNER TO warehouse14_migrator;

--
-- Name: metal_prices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: warehouse14_migrator
--

ALTER SEQUENCE public.metal_prices_id_seq OWNED BY public.metal_prices.id;


--
-- Name: operating_expenses; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.operating_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_day date NOT NULL,
    category public.expense_category NOT NULL,
    amount_cents integer NOT NULL,
    note text,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operating_expenses_amount_positive CHECK ((amount_cents > 0)),
    CONSTRAINT operating_expenses_note_length CHECK (((note IS NULL) OR (length(note) <= 500)))
);


ALTER TABLE public.operating_expenses OWNER TO warehouse14_migrator;

--
-- Name: TABLE operating_expenses; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.operating_expenses IS 'One-off Betriebsausgaben booked against a Berlin-local business_day. Money in integer cents. Forensic — correct via UPDATE/new row, never delete (GoBD).';


--
-- Name: order_number_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.order_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.order_number_seq OWNER TO warehouse14_migrator;

--
-- Name: payment_commission_rates; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.payment_commission_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider public.payment_provider NOT NULL,
    account_ref text,
    channel text,
    fee_bps integer NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_commission_rates_account_ref_nonempty CHECK (((account_ref IS NULL) OR (length(btrim(account_ref)) > 0))),
    CONSTRAINT payment_commission_rates_channel_known CHECK (((channel IS NULL) OR (channel = ANY (ARRAY['POS'::text, 'WEB'::text, 'MARKETPLACE'::text, 'EBAY'::text])))),
    CONSTRAINT payment_commission_rates_fee_sane CHECK (((fee_bps > 0) AND (fee_bps <= 1000)))
);


ALTER TABLE public.payment_commission_rates OWNER TO warehouse14_migrator;

--
-- Name: TABLE payment_commission_rates; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.payment_commission_rates IS 'Die Vermittlungsgebuehr von Norns, je Anbieter, Konto und Kanal. NULL heisst "gilt fuer alle". Die Rangfolge steht in apps/api-cloud/src/lib/commission.ts, nicht hier.';


--
-- Name: payment_intents; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.payment_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    provider public.payment_provider NOT NULL,
    provider_intent_id text NOT NULL,
    status public.payment_intent_status DEFAULT 'CREATED'::public.payment_intent_status NOT NULL,
    amount_eur numeric(18,2) NOT NULL,
    client_secret text,
    redirect_url text,
    outcome jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_account_id text,
    application_fee_cents integer,
    CONSTRAINT payment_intents_account_shape CHECK (((stripe_account_id IS NULL) OR (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'::text))),
    CONSTRAINT payment_intents_amount_eur_check CHECK ((amount_eur >= (0)::numeric)),
    CONSTRAINT payment_intents_fee_nonneg CHECK (((application_fee_cents IS NULL) OR (application_fee_cents >= 0))),
    CONSTRAINT payment_intents_outcome_is_object CHECK ((jsonb_typeof(outcome) = 'object'::text))
);


ALTER TABLE public.payment_intents OWNER TO warehouse14_migrator;

--
-- Name: product_categories; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.product_categories (
    product_id uuid NOT NULL,
    category_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.product_categories OWNER TO warehouse14_migrator;

--
-- Name: TABLE product_categories; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.product_categories IS 'M:N product↔category. is_primary partial UNIQUE = at most one primary per product. ON DELETE CASCADE product side, RESTRICT category side.';


--
-- Name: product_ebay_listing_events; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.product_ebay_listing_events (
    id bigint NOT NULL,
    product_id uuid NOT NULL,
    from_state public.ebay_listing_state,
    to_state public.ebay_listing_state NOT NULL,
    changed_by_user_id uuid,
    changed_by_source text NOT NULL,
    ebay_order_id text,
    notes text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ebay_events_known_source CHECK ((changed_by_source = ANY (ARRAY['OWNER'::text, 'EBAY_WEBHOOK'::text, 'WORKER'::text, 'SYSTEM'::text]))),
    CONSTRAINT ebay_events_owner_has_user CHECK (((changed_by_source <> 'OWNER'::text) OR (changed_by_user_id IS NOT NULL))),
    CONSTRAINT ebay_events_payload_object CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT ebay_events_state_change CHECK (((from_state IS NULL) OR (from_state <> to_state)))
);


ALTER TABLE public.product_ebay_listing_events OWNER TO warehouse14_migrator;

--
-- Name: TABLE product_ebay_listing_events; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.product_ebay_listing_events IS 'Append-only audit trail of every products.ebay_state transition. NEVER DELETE. Source distinguishes OWNER manual flips from EBAY_WEBHOOK pushes (Phase 1.5) and WORKER reconciler updates (#36).';


--
-- Name: product_ebay_listing_events_id_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.product_ebay_listing_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.product_ebay_listing_events_id_seq OWNER TO warehouse14_migrator;

--
-- Name: product_ebay_listing_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: warehouse14_migrator
--

ALTER SEQUENCE public.product_ebay_listing_events_id_seq OWNED BY public.product_ebay_listing_events.id;


--
-- Name: product_photo_workflow_events; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.product_photo_workflow_events (
    id bigint NOT NULL,
    product_photo_id uuid NOT NULL,
    from_state public.photo_workflow_state,
    to_state public.photo_workflow_state NOT NULL,
    changed_by_user_id uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT photo_workflow_events_state_change CHECK (((from_state IS NULL) OR (from_state <> to_state)))
);


ALTER TABLE public.product_photo_workflow_events OWNER TO warehouse14_migrator;

--
-- Name: TABLE product_photo_workflow_events; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.product_photo_workflow_events IS 'Append-only audit trail of every product_photos.workflow_state transition. NEVER DELETE. The forensic surface for Owner reviews.';


--
-- Name: product_photo_workflow_events_id_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.product_photo_workflow_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.product_photo_workflow_events_id_seq OWNER TO warehouse14_migrator;

--
-- Name: product_photo_workflow_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: warehouse14_migrator
--

ALTER SEQUENCE public.product_photo_workflow_events_id_seq OWNED BY public.product_photo_workflow_events.id;


--
-- Name: product_photos; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.product_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    r2_key text NOT NULL,
    r2_key_bg_removed text,
    display_order smallint DEFAULT 0 NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    source public.photo_source DEFAULT 'intake'::public.photo_source NOT NULL,
    alt_text_de text,
    alt_text_en text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workflow_state public.photo_workflow_state DEFAULT 'FOTOGRAFIERT'::public.photo_workflow_state NOT NULL,
    workflow_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    workflow_changed_by_user_id uuid,
    storage_kind text DEFAULT 'r2'::text NOT NULL,
    size_bytes bigint,
    thumb_bytes bigint,
    width integer,
    height integer,
    content_type text,
    CONSTRAINT product_photos_assigned_state_has_product CHECK (((workflow_state <> ALL (ARRAY['ZUGEORDNET'::public.photo_workflow_state, 'FUER_EBAY_BEREIT'::public.photo_workflow_state])) OR (product_id IS NOT NULL))),
    CONSTRAINT product_photos_bg_removed_state_has_key CHECK (((workflow_state <> ALL (ARRAY['FREIGESTELLT'::public.photo_workflow_state, 'ZUGEORDNET'::public.photo_workflow_state, 'FUER_EBAY_BEREIT'::public.photo_workflow_state])) OR (r2_key_bg_removed IS NOT NULL))),
    CONSTRAINT product_photos_orphan_not_primary CHECK (((product_id IS NOT NULL) OR (is_primary = false))),
    CONSTRAINT product_photos_storage_kind_chk CHECK ((storage_kind = ANY (ARRAY['r2'::text, 'local'::text])))
);


ALTER TABLE public.product_photos OWNER TO warehouse14_migrator;

--
-- Name: TABLE product_photos; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.product_photos IS 'Per-product photo metadata. Bytes live in Cloudflare R2 (ADR-0005). is_primary is the storefront thumbnail; partial unique index enforces exactly one.';


--
-- Name: COLUMN product_photos.product_id; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.product_photos.product_id IS 'Nullable until workflow_state >= ZUGEORDNET. Enforced by product_photos_assigned_state_has_product CHECK.';


--
-- Name: COLUMN product_photos.workflow_state; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.product_photos.workflow_state IS '5-stage Owner-defined lifecycle. Transitions audited via product_photo_workflow_events. Never written directly outside the workflow-state route.';


--
-- Name: COLUMN product_photos.storage_kind; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.product_photos.storage_kind IS 'Where the bytes live: ''local'' = PHOTOS_DIR on the API server (compressed WebP); ''r2'' = legacy Cloudflare R2.';


--
-- Name: COLUMN product_photos.size_bytes; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.product_photos.size_bytes IS 'Compressed MAIN WebP size in bytes — the unit the PHOTO_STORE_MAX_BYTES cap counts.';


--
-- Name: product_translations; Type: TABLE; Schema: public; Owner: warehouse14
--

CREATE TABLE public.product_translations (
    product_id uuid NOT NULL,
    locale text NOT NULL,
    name text,
    description text,
    source_fingerprint text NOT NULL,
    provider text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_translations_has_text CHECK (((name IS NOT NULL) OR (description IS NOT NULL))),
    CONSTRAINT product_translations_locale_format CHECK ((locale ~ '^[a-z]{2}$'::text))
);


ALTER TABLE public.product_translations OWNER TO warehouse14;

--
-- Name: TABLE product_translations; Type: COMMENT; Schema: public; Owner: warehouse14
--

COMMENT ON TABLE public.product_translations IS 'Derived cache of per locale product name/description. Rebuildable; no personal or fiscal data.';


--
-- Name: COLUMN product_translations.source_fingerprint; Type: COMMENT; Schema: public; Owner: warehouse14
--

COMMENT ON COLUMN public.product_translations.source_fingerprint IS 'Hash of the German source text this row was translated from. Mismatch means stale.';


--
-- Name: product_viewing_holds; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.product_viewing_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    customer_id uuid,
    hold_strength text DEFAULT 'SOFT'::text NOT NULL,
    hold_starts_at timestamp with time zone NOT NULL,
    hold_expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone,
    released_reason text,
    CONSTRAINT product_viewing_holds_hold_strength_check CHECK ((hold_strength = ANY (ARRAY['SOFT'::text, 'HARD'::text]))),
    CONSTRAINT product_viewing_holds_range CHECK ((hold_expires_at > hold_starts_at)),
    CONSTRAINT product_viewing_holds_released_has_reason CHECK (((released_at IS NULL) = (released_reason IS NULL)))
);


ALTER TABLE public.product_viewing_holds OWNER TO warehouse14_migrator;

--
-- Name: TABLE product_viewing_holds; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.product_viewing_holds IS 'Soft (or HARD) holds on products tied to a viewing appointment (ADR-0016 §6). Consumed by inventory-lock.reserve() to surface to the cashier. Created automatically by trigger on appointment_linked_products INSERT.';


--
-- Name: products; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku text NOT NULL,
    barcode text,
    status public.product_status DEFAULT 'DRAFT'::public.product_status NOT NULL,
    reserved_by_channel public.reservation_channel,
    reserved_by_session_id uuid,
    reserved_by_user_id uuid,
    reserved_at timestamp with time zone,
    reservation_expires_at timestamp with time zone,
    tax_treatment_code text NOT NULL,
    item_type public.item_type NOT NULL,
    metal text,
    karat_code text,
    fineness_decimal numeric(5,4),
    weight_grams numeric(10,4),
    hallmark_stamps text[] DEFAULT '{}'::text[] NOT NULL,
    acquisition_cost_eur numeric(18,2) NOT NULL,
    list_price_eur numeric(18,2) NOT NULL,
    name text NOT NULL,
    description_de text,
    marketing_attributes jsonb DEFAULT '[]'::jsonb NOT NULL,
    listed_on_storefront boolean DEFAULT false NOT NULL,
    listed_on_ebay boolean DEFAULT false NOT NULL,
    ebay_listing_id text,
    intake_session_id uuid,
    published_at timestamp with time zone,
    sold_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ankauf_customer_id uuid,
    condition public.product_condition DEFAULT 'USED_GOOD'::public.product_condition NOT NULL,
    is_commission boolean DEFAULT false NOT NULL,
    acquired_from_customer_id uuid,
    archived_at timestamp with time zone,
    parent_product_id uuid,
    location_storage_unit text,
    location_drawer text,
    location_position text,
    location_assigned_at timestamp with time zone,
    feingewicht_grams numeric(10,4) GENERATED ALWAYS AS (
CASE
    WHEN ((weight_grams IS NULL) OR (fineness_decimal IS NULL)) THEN NULL::numeric
    ELSE (weight_grams * fineness_decimal)
END) STORED,
    collector_premium_eur numeric(18,2),
    ebay_state public.ebay_listing_state,
    ebay_state_changed_at timestamp with time zone,
    slug text,
    seo_title text,
    seo_description text,
    schema_org_type text,
    year_minted_from integer,
    year_minted_to integer,
    origin_country character(2),
    period text,
    catalog_reference text,
    provenance_notes text,
    description_en text,
    seo_title_en text,
    seo_description_en text,
    is_published_to_web boolean DEFAULT false NOT NULL,
    stamp_erhaltung text,
    stamp_minr integer,
    length_cm numeric(7,1),
    width_cm numeric(7,1),
    height_cm numeric(7,1),
    CONSTRAINT products_acquisition_cost_eur_check CHECK ((acquisition_cost_eur >= (0)::numeric)),
    CONSTRAINT products_archived_after_sold_at CHECK (((archived_at IS NULL) OR ((sold_at IS NOT NULL) AND (archived_at >= sold_at)))),
    CONSTRAINT products_archived_only_when_sold CHECK (((archived_at IS NULL) OR (status = 'SOLD'::public.product_status))),
    CONSTRAINT products_available_no_reservation CHECK (((status <> 'AVAILABLE'::public.product_status) OR ((reserved_by_channel IS NULL) AND (reserved_by_session_id IS NULL) AND (reserved_at IS NULL) AND (reservation_expires_at IS NULL)))),
    CONSTRAINT products_collector_premium_nonneg CHECK (((collector_premium_eur IS NULL) OR (collector_premium_eur >= (0)::numeric))),
    CONSTRAINT products_draft_unpublished CHECK (((status <> 'DRAFT'::public.product_status) OR (published_at IS NULL))),
    CONSTRAINT products_fineness_decimal_check CHECK (((fineness_decimal IS NULL) OR ((fineness_decimal > (0)::numeric) AND (fineness_decimal <= 1.0000)))),
    CONSTRAINT products_height_cm_positive CHECK (((height_cm IS NULL) OR (height_cm > (0)::numeric))),
    CONSTRAINT products_length_cm_positive CHECK (((length_cm IS NULL) OR (length_cm > (0)::numeric))),
    CONSTRAINT products_list_price_eur_check CHECK ((list_price_eur >= (0)::numeric)),
    CONSTRAINT products_metal_check CHECK (((metal IS NULL) OR (metal = ANY (ARRAY['gold'::text, 'silver'::text, 'platinum'::text, 'palladium'::text])))),
    CONSTRAINT products_non_draft_is_published CHECK (((status = 'DRAFT'::public.product_status) OR (published_at IS NOT NULL))),
    CONSTRAINT products_origin_country_format CHECK (((origin_country IS NULL) OR (origin_country ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT products_reservation_ttl_per_channel CHECK (((status <> 'RESERVED'::public.product_status) OR (((reserved_by_channel = 'POS'::public.reservation_channel) AND (reservation_expires_at IS NULL)) OR ((reserved_by_channel = 'STOREFRONT'::public.reservation_channel) AND (reservation_expires_at IS NOT NULL)) OR ((reserved_by_channel = 'EBAY'::public.reservation_channel) AND (reservation_expires_at IS NOT NULL)) OR ((reserved_by_channel = 'WEB_RESERVATION'::public.reservation_channel) AND (reservation_expires_at IS NOT NULL))))),
    CONSTRAINT products_reserved_has_envelope CHECK (((status <> 'RESERVED'::public.product_status) OR ((reserved_by_channel IS NOT NULL) AND (reserved_at IS NOT NULL)))),
    CONSTRAINT products_slug_format CHECK (((slug IS NULL) OR (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))),
    CONSTRAINT products_sold_has_sold_at CHECK (((status <> 'SOLD'::public.product_status) OR (sold_at IS NOT NULL))),
    CONSTRAINT products_stamp_erhaltung_check CHECK (((stamp_erhaltung IS NULL) OR (stamp_erhaltung = ANY (ARRAY['POSTFRISCH'::text, 'FALZ'::text, 'GESTEMPELT'::text, 'AUF_BRIEF'::text])))),
    CONSTRAINT products_stamp_minr_positive CHECK (((stamp_minr IS NULL) OR (stamp_minr > 0))),
    CONSTRAINT products_weight_grams_check CHECK (((weight_grams IS NULL) OR (weight_grams > (0)::numeric))),
    CONSTRAINT products_width_cm_positive CHECK (((width_cm IS NULL) OR (width_cm > (0)::numeric))),
    CONSTRAINT products_year_minted_range_valid CHECK (((year_minted_from IS NULL) OR (year_minted_to IS NULL) OR (year_minted_from <= year_minted_to)))
);


ALTER TABLE public.products OWNER TO warehouse14_migrator;

--
-- Name: TABLE products; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.products IS 'Inventory authority. 4-state machine. Atomic reservation via UPDATE WHERE status=''AVAILABLE''. See ADR-0016.';


--
-- Name: COLUMN products.acquisition_cost_eur; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.acquisition_cost_eur IS 'Immutable after intake — required for §25a margin tax integrity. App role cannot UPDATE this column.';


--
-- Name: COLUMN products.published_at; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.published_at IS 'When the row went storefront-public (NULL while DRAFT or pre-publish). Distinct from created_at so "neue Ankünfte" sort by intent.';


--
-- Name: COLUMN products.condition; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.condition IS 'Physical condition (Zustand). Defaults to USED_GOOD to match historical jewelry inventory.';


--
-- Name: COLUMN products.is_commission; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.is_commission IS 'TRUE = Kommissionsware (consignment goods owned by a third party we sell on behalf of). Drives a DIFFERENT tax treatment than shop-owned stock — see ADR-0015 §7. Intake-locked.';


--
-- Name: COLUMN products.acquired_from_customer_id; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.acquired_from_customer_id IS 'For Ankauf items: which customer we bought this product from. Intake-locked (immutable after creation) for §259 StGB Hehlerei evidence + GoBD provenance trail.';


--
-- Name: COLUMN products.archived_at; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.archived_at IS 'Hides sold products from the active-inventory view. Only SOLD products may be archived. Set NULL = active row; set to a timestamp = archived. CHECK enforces SOLD precondition.';


--
-- Name: COLUMN products.parent_product_id; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.parent_product_id IS 'Self-FK for Konvolut/Hauptposten. NULL = standalone item OR top-level lot. Set = this row is an Unterartikel under the referenced parent. 1-level depth enforced by trg_products_no_deep_nesting (Phase 1.5 may relax to recursive trees).';


--
-- Name: COLUMN products.location_storage_unit; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.location_storage_unit IS 'Top-level physical location: Tresor-1, Lager-A, Vitrine-B. Free-text V1.';


--
-- Name: COLUMN products.location_drawer; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.location_drawer IS 'Second-level: Fach-3, Schublade-7. Free-text V1.';


--
-- Name: COLUMN products.location_position; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.location_position IS 'Third-level micro-position: Position-12. Free-text V1.';


--
-- Name: COLUMN products.feingewicht_grams; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.feingewicht_grams IS 'GENERATED ALWAYS AS STORED = weight_grams × fineness_decimal. The fine-metal weight underpins Schmelzwert calculations. Never settable directly.';


--
-- Name: COLUMN products.collector_premium_eur; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.collector_premium_eur IS 'Sammleraufschlag — operator-set premium over scrap value for collectible items (numismatic premium, hallmark history, etc.). NULL means "use list_price − schmelzwert".';


--
-- Name: COLUMN products.ebay_state; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.ebay_state IS 'Realized eBay listing state (9 stages). The legacy `listed_on_ebay` boolean is the operator intent flag and is left alone in V1 — Phase 1.5 item I-19 will fold it into a GENERATED column derived from ebay_state.';


--
-- Name: COLUMN products.ebay_state_changed_at; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.ebay_state_changed_at IS 'When ebay_state last changed. Updated by the trigger that records the transition event row.';


--
-- Name: COLUMN products.slug; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.slug IS 'URL-safe identifier — drives /artikel/<slug>-<sku-tail>. Unique within active (archived_at IS NULL) rows. Day 13.';


--
-- Name: COLUMN products.is_published_to_web; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.is_published_to_web IS 'Phase 2.A storefront publication gate. TRUE = visible at warehouse14.de. FALSE = hidden from the public catalog regardless of SEO completeness. Default FALSE so existing rows stay private until the operator opts in.';


--
-- Name: COLUMN products.stamp_erhaltung; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.stamp_erhaltung IS 'Briefmarken-Erhaltung: POSTFRISCH (**), FALZ (*), GESTEMPELT (,), AUF_BRIEF. NULL für Nicht-Briefmarken.';


--
-- Name: COLUMN products.stamp_minr; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.products.stamp_minr IS 'Michel-Katalognummer (MiNr.), z. B. 27 → "MiNr. 27". NULL für Nicht-Briefmarken.';


--
-- Name: push_outbox; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.push_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    user_id uuid,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT push_outbox_status_known CHECK ((status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'FAILED'::text])))
);


ALTER TABLE public.push_outbox OWNER TO warehouse14_migrator;

--
-- Name: receipt_locator_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.receipt_locator_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.receipt_locator_seq OWNER TO warehouse14_migrator;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address inet,
    user_agent text,
    device_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_pin_step_up_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT sessions_expiry_after_creation CHECK ((expires_at > created_at))
);


ALTER TABLE public.sessions OWNER TO warehouse14_migrator;

--
-- Name: TABLE sessions; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.sessions IS 'Active auth sessions. DELETE permitted for app role (logout flow). Cleanup of expired rows is a worker job.';


--
-- Name: COLUMN sessions.last_pin_step_up_at; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.sessions.last_pin_step_up_at IS 'Most recent PIN step-up confirmation on this session. Compared against now() - 5min window for sensitive actions (ADR-0022 §4c).';


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    opened_by_user_id uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_float_eur numeric(18,2) NOT NULL,
    status public.shift_status DEFAULT 'OPEN'::public.shift_status NOT NULL,
    blind_count_eur numeric(18,2),
    system_expected_eur numeric(18,2),
    variance_eur numeric(18,2) GENERATED ALWAYS AS ((blind_count_eur - system_expected_eur)) STORED,
    closed_by_user_id uuid,
    closed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shifts_closed_has_evidence CHECK (((status <> 'CLOSED'::public.shift_status) OR ((closed_by_user_id IS NOT NULL) AND (closed_at IS NOT NULL) AND (blind_count_eur IS NOT NULL) AND (system_expected_eur IS NOT NULL)))),
    CONSTRAINT shifts_open_no_close_fields CHECK (((status <> 'OPEN'::public.shift_status) OR ((closed_by_user_id IS NULL) AND (closed_at IS NULL)))),
    CONSTRAINT shifts_opening_float_eur_check CHECK ((opening_float_eur >= (0)::numeric))
);


ALTER TABLE public.shifts OWNER TO warehouse14_migrator;

--
-- Name: TABLE shifts; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.shifts IS 'Cashier sessions (Kassenschicht). Blindsturz: blind_count_eur entered first, system_expected_eur revealed AFTER. Variance is auto-computed. NEVER deleted.';


--
-- Name: shipments; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid,
    transaction_id uuid,
    carrier text DEFAULT 'DHL'::text NOT NULL,
    service_code text NOT NULL,
    status public.shipment_status DEFAULT 'DRAFT'::public.shipment_status NOT NULL,
    tracking_number text,
    tracking_url text,
    label_attachment_id uuid,
    weight_g integer,
    insured_value_eur numeric(18,2),
    shipping_cost_eur numeric(18,2),
    shipping_vat_eur numeric(18,2),
    destination_country character(2),
    dispatched_at timestamp with time zone,
    delivered_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shipments_cost_nonneg CHECK (((shipping_cost_eur IS NULL) OR (shipping_cost_eur >= (0)::numeric))),
    CONSTRAINT shipments_tracking_needs_label CHECK (((tracking_number IS NULL) OR (status <> 'DRAFT'::public.shipment_status))),
    CONSTRAINT shipments_weight_pos CHECK (((weight_g IS NULL) OR (weight_g > 0)))
);


ALTER TABLE public.shipments OWNER TO warehouse14_migrator;

--
-- Name: shipping_rates; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.shipping_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_id uuid NOT NULL,
    service_code text NOT NULL,
    name_de text NOT NULL,
    min_weight_g integer DEFAULT 0 NOT NULL,
    max_weight_g integer,
    price_eur numeric(18,2) NOT NULL,
    insured_up_to_eur numeric(18,2),
    free_above_eur numeric(18,2),
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shipping_rates_price_nonneg CHECK ((price_eur >= (0)::numeric)),
    CONSTRAINT shipping_rates_weight_band_order CHECK (((max_weight_g IS NULL) OR (max_weight_g > min_weight_g))),
    CONSTRAINT shipping_rates_weight_band_sane CHECK ((min_weight_g >= 0))
);


ALTER TABLE public.shipping_rates OWNER TO warehouse14_migrator;

--
-- Name: shipping_zones; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.shipping_zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name_de text NOT NULL,
    country_codes character(2)[] DEFAULT '{}'::bpchar[] NOT NULL,
    is_catch_all boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shipping_zones_catch_all_has_no_list CHECK (((NOT is_catch_all) OR (cardinality(country_codes) = 0))),
    CONSTRAINT shipping_zones_code_shape CHECK ((code ~ '^[A-Z][A-Z0-9_]*$'::text))
);


ALTER TABLE public.shipping_zones OWNER TO warehouse14_migrator;

--
-- Name: shop_holidays; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.shop_holidays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    closed_date date NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.shop_holidays OWNER TO warehouse14_migrator;

--
-- Name: shopper_sessions; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.shopper_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shopper_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT shopper_sessions_expiry_after_creation CHECK ((expires_at > created_at))
);


ALTER TABLE public.shopper_sessions OWNER TO warehouse14_migrator;

--
-- Name: TABLE shopper_sessions; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.shopper_sessions IS 'B2C session table. NOT the same shape/discipline as `sessions` (staff). Cookie name: warehouse14.shopper_session. TTL: 30 days rolling.';


--
-- Name: shoppers; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.shoppers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    email_encrypted bytea NOT NULL,
    email_blind_index bytea NOT NULL,
    password_hash text,
    email_verified_at timestamp with time zone,
    email_verification_token text,
    phone_encrypted bytea,
    phone_blind_index bytea,
    shipping_recipient_name_encrypted bytea,
    shipping_address_line1_encrypted bytea,
    shipping_address_line2_encrypted bytea,
    shipping_postal_code_encrypted bytea,
    shipping_city_encrypted bytea,
    shipping_country character(2),
    billing_recipient_name_encrypted bytea,
    billing_address_line1_encrypted bytea,
    billing_address_line2_encrypted bytea,
    billing_postal_code_encrypted bytea,
    billing_city_encrypted bytea,
    billing_country character(2),
    preferred_language character(2) DEFAULT 'de'::bpchar NOT NULL,
    marketing_consent boolean DEFAULT false NOT NULL,
    marketing_consent_at timestamp with time zone,
    failed_login_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    soft_deleted_at timestamp with time zone,
    anonymized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    google_sub text,
    is_guest boolean DEFAULT false NOT NULL,
    given_name_encrypted bytea,
    family_name_encrypted bytea,
    picture_url_encrypted bytea,
    last_seen_at timestamp with time zone,
    CONSTRAINT shoppers_anonymized_implies_soft_deleted CHECK (((anonymized_at IS NULL) OR (soft_deleted_at IS NOT NULL))),
    CONSTRAINT shoppers_country_iso2_billing CHECK (((billing_country IS NULL) OR (billing_country ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT shoppers_country_iso2_shipping CHECK (((shipping_country IS NULL) OR (shipping_country ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT shoppers_failed_login_attempts_check CHECK ((failed_login_attempts >= 0)),
    CONSTRAINT shoppers_has_credential CHECK (((password_hash IS NOT NULL) OR (google_sub IS NOT NULL) OR is_guest)),
    CONSTRAINT shoppers_marketing_consent_has_timestamp CHECK (((marketing_consent = false) OR (marketing_consent_at IS NOT NULL))),
    CONSTRAINT shoppers_preferred_language_check CHECK ((preferred_language ~ '^[a-z]{2}$'::text))
);


ALTER TABLE public.shoppers OWNER TO warehouse14_migrator;

--
-- Name: TABLE shoppers; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.shoppers IS 'B2C online accounts. 1:1 with customers (the canonical KYC + spend row). NEVER deleted — soft_deleted_at + anonymized_at (mirrors users discipline).';


--
-- Name: COLUMN shoppers.preferred_language; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.shoppers.preferred_language IS 'ISO 639 1 code the shopper reads. Drives catalog language and the language of every email we send them. Defaults to de.';


--
-- Name: COLUMN shoppers.given_name_encrypted; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.shoppers.given_name_encrypted IS 'Given name as verified by the identity provider. Encrypted PII. Lets staff address a customer correctly instead of guessing at a display name.';


--
-- Name: COLUMN shoppers.family_name_encrypted; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.shoppers.family_name_encrypted IS 'Family name as verified by the identity provider. Encrypted PII.';


--
-- Name: COLUMN shoppers.picture_url_encrypted; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.shoppers.picture_url_encrypted IS 'Profile picture URL from the identity provider. Encrypted: a photo URL identifies a person as directly as their name. Purpose is recognising the customer at the counter.';


--
-- Name: COLUMN shoppers.last_seen_at; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.shoppers.last_seen_at IS 'Last successful sign in. Answers "is this account still live" when staff look at an ageing reservation.';


--
-- Name: staff_time_off; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.staff_time_off (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    reason text,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_time_off_range CHECK ((ends_at > starts_at))
);


ALTER TABLE public.staff_time_off OWNER TO warehouse14_migrator;

--
-- Name: staff_working_hours; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.staff_working_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid,
    weekday smallint NOT NULL,
    starts_at_local time without time zone NOT NULL,
    ends_at_local time without time zone NOT NULL,
    effective_from date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date NOT NULL,
    effective_until date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_working_hours_effective_range CHECK (((effective_until IS NULL) OR (effective_until >= effective_from))),
    CONSTRAINT staff_working_hours_time_order CHECK ((ends_at_local > starts_at_local)),
    CONSTRAINT staff_working_hours_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.staff_working_hours OWNER TO warehouse14_migrator;

--
-- Name: TABLE staff_working_hours; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.staff_working_hours IS 'Per-staff weekly schedule. Times are LOCAL (Europe/Berlin). The capacity model uses this + staff_time_off + shop_holidays to compute available_slots().';


--
-- Name: stripe_connected_accounts; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.stripe_connected_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stripe_account_id text NOT NULL,
    country text DEFAULT 'DE'::text NOT NULL,
    default_currency text DEFAULT 'eur'::text NOT NULL,
    charges_enabled boolean DEFAULT false NOT NULL,
    payouts_enabled boolean DEFAULT false NOT NULL,
    details_submitted boolean DEFAULT false NOT NULL,
    requirements jsonb DEFAULT '{}'::jsonb NOT NULL,
    application_fee_bps integer,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stripe_connected_accounts_fee_sane CHECK (((application_fee_bps IS NULL) OR ((application_fee_bps >= 0) AND (application_fee_bps <= 1000)))),
    CONSTRAINT stripe_connected_accounts_id_shape CHECK ((stripe_account_id ~ '^acct_[A-Za-z0-9]+$'::text)),
    CONSTRAINT stripe_connected_accounts_payouts_need_details CHECK (((payouts_enabled = false) OR (details_submitted = true)))
);


ALTER TABLE public.stripe_connected_accounts OWNER TO warehouse14_migrator;

--
-- Name: TABLE stripe_connected_accounts; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.stripe_connected_accounts IS 'Das Stripe-Konto des Händlers (Connect Standard). Das Geld läuft direkt dorthin, nie über uns.';


--
-- Name: COLUMN stripe_connected_accounts.charges_enabled; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.stripe_connected_accounts.charges_enabled IS 'Nur wenn wahr, darf eine Zahlung eröffnet werden. Wird ausschliesslich aus einer signierten Stripe-Meldung gesetzt.';


--
-- Name: COLUMN stripe_connected_accounts.application_fee_bps; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.stripe_connected_accounts.application_fee_bps IS 'ABGELOEST durch payment_commission_rates (0110). Wird nicht mehr gelesen. Spalte bleibt stehen, damit ein Ruecksetzen auf das vorige Abbild ohne Datenverlust moeglich ist.';


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    direction text NOT NULL,
    from_encrypted bytea NOT NULL,
    to_encrypted bytea NOT NULL,
    body_encrypted bytea NOT NULL,
    gmail_message_id text,
    author_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_messages_direction_domain CHECK ((direction = ANY (ARRAY['INBOUND'::text, 'OUTBOUND'::text]))),
    CONSTRAINT support_messages_inbound_has_gmail_id CHECK (((direction <> 'INBOUND'::text) OR (gmail_message_id IS NOT NULL))),
    CONSTRAINT support_messages_outbound_has_author CHECK (((direction <> 'OUTBOUND'::text) OR (author_user_id IS NOT NULL)))
);


ALTER TABLE public.support_messages OWNER TO warehouse14_migrator;

--
-- Name: ticket_number_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.ticket_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ticket_number_seq OWNER TO warehouse14_migrator;

--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_number text DEFAULT ((('TIC-'::text || to_char((now() AT TIME ZONE 'Europe/Berlin'::text), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.ticket_number_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    customer_id uuid,
    subject text NOT NULL,
    status text DEFAULT 'OFFEN'::text NOT NULL,
    priority text DEFAULT 'NORMAL'::text NOT NULL,
    channel text DEFAULT 'EMAIL'::text NOT NULL,
    assigned_to_user_id uuid,
    gmail_thread_id text,
    last_inbound_at timestamp with time zone,
    last_outbound_at timestamp with time zone,
    retention_until timestamp with time zone DEFAULT (now() + '3 years'::interval) NOT NULL,
    anonymized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_tickets_channel_domain CHECK ((channel = ANY (ARRAY['EMAIL'::text, 'WHATSAPP'::text, 'TELEFON'::text, 'LADEN'::text]))),
    CONSTRAINT support_tickets_priority_domain CHECK ((priority = ANY (ARRAY['NIEDRIG'::text, 'NORMAL'::text, 'HOCH'::text]))),
    CONSTRAINT support_tickets_status_domain CHECK ((status = ANY (ARRAY['OFFEN'::text, 'WARTET'::text, 'GESCHLOSSEN'::text])))
);


ALTER TABLE public.support_tickets OWNER TO warehouse14_migrator;

--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.system_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_settings_key_format CHECK ((key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'::text))
);


ALTER TABLE public.system_settings OWNER TO warehouse14_migrator;

--
-- Name: TABLE system_settings; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.system_settings IS 'Einstellungen je Mandant. ⚠️ Wanderungen legen hier SCHLÜSSEL an, niemals WERTE eines einzelnen Händlers — siehe 0123 und 0126. Ein leeres Feld sperrt den zugehörigen Export mit ehrlicher Meldung; ein Platzhalter erzeugte ein Paket, das vollständig aussieht und falsch ist.';


--
-- Name: tax_treatment_codes; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.tax_treatment_codes (
    code text NOT NULL,
    description_de text NOT NULL,
    description_en text NOT NULL,
    effective_vat_rate numeric(5,4),
    legal_reference text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tax_treatment_codes_code_format CHECK ((code ~ '^[A-Z][A-Z0-9_]*$'::text)),
    CONSTRAINT tax_treatment_codes_rate_range CHECK (((effective_vat_rate IS NULL) OR ((effective_vat_rate >= 0.0000) AND (effective_vat_rate <= 1.0000))))
);


ALTER TABLE public.tax_treatment_codes OWNER TO warehouse14_migrator;

--
-- Name: TABLE tax_treatment_codes; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.tax_treatment_codes IS 'BMF-derived German tax treatment categories. READ-ONLY for the app role. Updates land via migration only. See ADR-0008 §4 + ADR-0015 §7.';


--
-- Name: COLUMN tax_treatment_codes.effective_vat_rate; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.tax_treatment_codes.effective_vat_rate IS 'Scalar rate applied to gross sale. NULL → §25a margin scheme (rate applied to margin, not gross). 0 → exempt (e.g. §25c investment gold).';


--
-- Name: transaction_items; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.transaction_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    product_id uuid NOT NULL,
    line_subtotal_eur numeric(18,2) NOT NULL,
    line_vat_eur numeric(18,2) NOT NULL,
    line_total_eur numeric(18,2) NOT NULL,
    applied_tax_treatment_code text NOT NULL,
    applied_vat_rate numeric(5,4),
    acquisition_cost_eur_snapshot numeric(18,2),
    margin_eur numeric(18,2),
    display_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    line_discount_eur numeric(18,2) DEFAULT 0 NOT NULL,
    line_discount_reason text,
    CONSTRAINT transaction_items_balance_equation CHECK (((line_subtotal_eur + line_vat_eur) = line_total_eur)),
    CONSTRAINT transaction_items_discount_has_reason CHECK (((line_discount_eur = (0)::numeric) OR (line_discount_reason IS NOT NULL))),
    CONSTRAINT transaction_items_discount_nonneg CHECK ((line_discount_eur >= (0)::numeric)),
    CONSTRAINT transaction_items_margin_implies_acquisition CHECK (((margin_eur IS NULL) = (acquisition_cost_eur_snapshot IS NULL))),
    CONSTRAINT transaction_items_vat_rate_range CHECK (((applied_vat_rate IS NULL) OR ((applied_vat_rate >= (0)::numeric) AND (applied_vat_rate <= 1.0000))))
);


ALTER TABLE public.transaction_items OWNER TO warehouse14_migrator;

--
-- Name: TABLE transaction_items; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.transaction_items IS 'Per-line snapshot at sale time. INSERT-only — never UPDATE, never DELETE. Carries the applied tax treatment + margin (for §25a) frozen at sale moment.';


--
-- Name: transaction_payments; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.transaction_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    payment_method public.payment_method NOT NULL,
    amount_eur numeric(18,2) NOT NULL,
    external_ref text,
    zvt_terminal_id text,
    zvt_receipt_number text,
    zvt_card_brand text,
    zvt_card_pan_masked text,
    mollie_payment_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    trade_in_ankauf_transaction_id uuid,
    CONSTRAINT transaction_payments_tradein_requires_ankauf CHECK (((payment_method <> 'TRADE_IN'::public.payment_method) OR (trade_in_ankauf_transaction_id IS NOT NULL))),
    CONSTRAINT transaction_payments_zvt_masked_pan_shape CHECK (((zvt_card_pan_masked IS NULL) OR (zvt_card_pan_masked ~ '^\*+\d{4}$'::text)))
);


ALTER TABLE public.transaction_payments OWNER TO warehouse14_migrator;

--
-- Name: TABLE transaction_payments; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.transaction_payments IS 'Each payment leg (split-payment supported). INSERT-only. PCI scope avoided: we never store raw PAN — only the masked last-4 (ADR-0013).';


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    direction public.transaction_direction NOT NULL,
    storno_of_transaction_id uuid,
    customer_id uuid,
    device_id uuid NOT NULL,
    cashier_user_id uuid NOT NULL,
    subtotal_eur numeric(18,2) NOT NULL,
    vat_eur numeric(18,2) NOT NULL,
    total_eur numeric(18,2) NOT NULL,
    tax_treatment_code text NOT NULL,
    receipt_locator text DEFAULT ((('RCP-'::text || to_char((now() AT TIME ZONE 'Europe/Berlin'::text), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.receipt_locator_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    printed_at timestamp with time zone,
    notes_internal text,
    finalized_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sales_channel public.sales_channel DEFAULT 'POS'::public.sales_channel NOT NULL,
    shipping_status public.shipping_status DEFAULT 'NOT_REQUIRED'::public.shipping_status NOT NULL,
    shipping_address_encrypted bytea,
    shipping_carrier text,
    tracking_number text,
    paired_with_transaction_id uuid,
    returned_at timestamp with time zone,
    suspicious_aml_flag boolean DEFAULT false NOT NULL,
    suspicious_aml_reason text,
    suspicious_flagged_by_user_id uuid,
    receipt_declined_at timestamp with time zone,
    receipt_emailed_at timestamp with time zone,
    shift_id uuid,
    idempotency_key uuid,
    erfasst_am timestamp with time zone,
    eingegangen_am timestamp with time zone DEFAULT now() NOT NULL,
    nachtrag_bezugstag date,
    CONSTRAINT transactions_aml_flag_has_evidence CHECK (((suspicious_aml_flag = false) OR ((suspicious_aml_reason IS NOT NULL) AND (suspicious_flagged_by_user_id IS NOT NULL)))),
    CONSTRAINT transactions_ankauf_requires_customer CHECK (((direction <> 'ANKAUF'::public.transaction_direction) OR (customer_id IS NOT NULL))),
    CONSTRAINT transactions_balance_equation CHECK (((subtotal_eur + vat_eur) = total_eur)),
    CONSTRAINT transactions_nachtrag_passt_zur_erfassung CHECK (((nachtrag_bezugstag IS NULL) OR ((erfasst_am IS NOT NULL) AND (nachtrag_bezugstag = public.berlin_business_day(erfasst_am))))),
    CONSTRAINT transactions_pair_not_self CHECK (((paired_with_transaction_id IS NULL) OR (paired_with_transaction_id <> id))),
    CONSTRAINT transactions_returned_requires_storno CHECK (((returned_at IS NULL) OR ((storno_of_transaction_id IS NOT NULL) AND (shipping_status = 'RETURNED'::public.shipping_status)))),
    CONSTRAINT transactions_shipping_status_per_channel CHECK ((((sales_channel = 'POS'::public.sales_channel) AND (shipping_status = 'NOT_REQUIRED'::public.shipping_status)) OR ((sales_channel = 'WEB'::public.sales_channel) AND (shipping_status <> 'NOT_REQUIRED'::public.shipping_status)) OR (sales_channel = ANY (ARRAY['EBAY'::public.sales_channel, 'PHONE'::public.sales_channel])))),
    CONSTRAINT transactions_sign_discipline CHECK ((((storno_of_transaction_id IS NULL) AND (total_eur >= (0)::numeric) AND (subtotal_eur >= (0)::numeric) AND (vat_eur >= (0)::numeric)) OR ((storno_of_transaction_id IS NOT NULL) AND (total_eur <= (0)::numeric) AND (subtotal_eur <= (0)::numeric) AND (vat_eur <= (0)::numeric)))),
    CONSTRAINT transactions_storno_not_self CHECK (((storno_of_transaction_id IS NULL) OR (storno_of_transaction_id <> id)))
);


ALTER TABLE public.transactions OWNER TO warehouse14_migrator;

--
-- Name: TABLE transactions; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.transactions IS 'Fiscal transaction master record. Storno via negative-amount row + FK to original. NEVER deleted by app role. Triggers update cumulative customer spend + emit ledger event.';


--
-- Name: COLUMN transactions.sales_channel; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.transactions.sales_channel IS 'Where the sale happened. POS = in-shop cashier; WEB = warehouse14.de; EBAY = eBay listing; PHONE = phone order recorded manually.';


--
-- Name: COLUMN transactions.shipping_status; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.transactions.shipping_status IS 'Fulfilment state for WEB/EBAY/PHONE orders. POS is always NOT_REQUIRED.';


--
-- Name: COLUMN transactions.idempotency_key; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.transactions.idempotency_key IS 'Client-supplied UUID for at-most-once finalize. Partial unique index (transactions_idempotency_key_uniq) guarantees a second POST with the same key returns the original transaction instead of creating a duplicate. NULL is permitted for pre-V1 rows and worker-generated transactions.';


--
-- Name: COLUMN transactions.erfasst_am; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.transactions.erfasst_am IS 'Die vom Kassengeraet erfasste Vorgangszeit (§ 146a AO / DSFinV-K: die Kasse ist die Quelle). NULL fuer aeltere Kassen und fuer nicht-POS-Erzeuger (Webhooks, Arbeiter).';


--
-- Name: COLUMN transactions.eingegangen_am; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.transactions.eingegangen_am IS 'Die Eingangszeit des Servers. Getrennt von finalized_at, damit die Verschiebung zwischen Kassieren und Ankommen nachtraeglich feststellbar bleibt (§ 146 Abs. 4 AO).';


--
-- Name: COLUMN transactions.nachtrag_bezugstag; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.transactions.nachtrag_bezugstag IS 'Gesetzt NUR bei einem nachtraeglichen Eingang: der Kassentag, zu dem der Vorgang wirklich gehoert, dessen Abschluss aber schon FINALIZED war. Der Vorgang selbst ist auf dem laufenden Tag gebucht; diese Spalte macht den Nachtrag sichtbar und auffindbar.';


--
-- Name: CONSTRAINT transactions_ankauf_requires_customer ON transactions; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON CONSTRAINT transactions_ankauf_requires_customer ON public.transactions IS 'Red Team Audit C-1: every Ankauf (we buy from customer) MUST identify the seller. ADR-0007 + §259 StGB. The legal "ID always required" rule, now DB-enforced.';


--
-- Name: tse_clients; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.tse_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tss_id text NOT NULL,
    description text,
    cert_valid_to timestamp with time zone NOT NULL,
    last_checked timestamp with time zone,
    alert_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_alert_tier text
);


ALTER TABLE public.tse_clients OWNER TO warehouse14_migrator;

--
-- Name: COLUMN tse_clients.last_alert_tier; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.tse_clients.last_alert_tier IS 'The cert-expiry escalation tier (T-30/T-7/T-1/expired) most recently alerted on; NULL = never alerted. Drives escalation-only re-alerting.';


--
-- Name: tse_daily_archives; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.tse_daily_archives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    archive_date date NOT NULL,
    status public.tse_archive_status DEFAULT 'GENERATING'::public.tse_archive_status NOT NULL,
    file_r2_key text,
    sha256 text,
    error_message text,
    transaction_count integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tse_daily_archives_generated_has_evidence CHECK (((status <> 'GENERATED'::public.tse_archive_status) OR ((file_r2_key IS NOT NULL) AND (sha256 IS NOT NULL) AND (completed_at IS NOT NULL)))),
    CONSTRAINT tse_daily_archives_transaction_count_nonneg CHECK ((transaction_count >= 0))
);


ALTER TABLE public.tse_daily_archives OWNER TO warehouse14_migrator;

--
-- Name: tse_signatures; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.tse_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    fiskaly_tss_id uuid NOT NULL,
    fiskaly_client_id uuid NOT NULL,
    fiskaly_transaction_id uuid,
    fiskaly_transaction_number bigint NOT NULL,
    signature_value text NOT NULL,
    signature_counter bigint NOT NULL,
    signature_algorithm text,
    process_type text DEFAULT 'Kassenbeleg-V1'::text NOT NULL,
    qr_code_data text,
    tse_start_time timestamp with time zone,
    tse_end_time timestamp with time zone,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    device_id uuid,
    recorded_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tse_signatures_counter_positive CHECK ((signature_counter > 0)),
    CONSTRAINT tse_signatures_time_order CHECK (((tse_start_time IS NULL) OR (tse_end_time IS NULL) OR (tse_end_time >= tse_start_time))),
    CONSTRAINT tse_signatures_tx_number_positive CHECK ((fiskaly_transaction_number > 0))
);


ALTER TABLE public.tse_signatures OWNER TO warehouse14_migrator;

--
-- Name: TABLE tse_signatures; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.tse_signatures IS 'Durable, append-only server-side record of the Fiskaly SIGN DE V2 signature produced per fiscal transaction (GoBD / BSI TR-03153). One immutable row per transactions row; INSERTed by the POS after finalize+FINISH. NEVER updated or deleted by the app role — the BEFORE UPDATE/DELETE trigger enforces this.';


--
-- Name: tse_transactions; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.tse_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    state public.tse_state DEFAULT 'QUEUED_OFFLINE'::public.tse_state NOT NULL,
    state_reason text,
    fiskaly_tss_id uuid NOT NULL,
    fiskaly_client_id uuid NOT NULL,
    fiskaly_transaction_id uuid,
    fiskaly_transaction_number bigint,
    signature_value text,
    signature_counter bigint,
    signature_algorithm text,
    certificate_serial text,
    certificate_public_key text,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    process_type text DEFAULT 'Kassenbeleg-V1'::text NOT NULL,
    process_data_hash bytea,
    qr_code_data text,
    created_offline boolean DEFAULT false NOT NULL,
    signed_at timestamp with time zone,
    retry_count smallint DEFAULT 0 NOT NULL,
    last_error_at timestamp with time zone,
    last_error_code text,
    last_error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tse_transactions_counter_positive CHECK (((signature_counter IS NULL) OR (signature_counter > 0))),
    CONSTRAINT tse_transactions_error_consistency CHECK ((((last_error_at IS NULL) AND (last_error_code IS NULL)) OR ((last_error_at IS NOT NULL) AND (last_error_code IS NOT NULL)))),
    CONSTRAINT tse_transactions_finished_has_signature CHECK (((state <> 'FINISHED'::public.tse_state) OR ((signature_value IS NOT NULL) AND (signature_counter IS NOT NULL) AND (fiskaly_transaction_number IS NOT NULL) AND (signature_algorithm IS NOT NULL) AND (start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (signed_at IS NOT NULL) AND (qr_code_data IS NOT NULL)))),
    CONSTRAINT tse_transactions_retry_count_bounded CHECK (((retry_count >= 0) AND (retry_count <= 100))),
    CONSTRAINT tse_transactions_time_order CHECK (((start_time IS NULL) OR (end_time IS NULL) OR (end_time >= start_time)))
);


ALTER TABLE public.tse_transactions OWNER TO warehouse14_migrator;

--
-- Name: TABLE tse_transactions; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.tse_transactions IS 'TSE (Fiskaly SIGN DE V2) state machine and signature evidence. One row per fiscal transaction. NEVER deleted by app role. State transitions are enforced by trigger; signature fields immutable once FINISHED.';


--
-- Name: two_factors; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.two_factors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    secret text NOT NULL,
    backup_codes text,
    enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.two_factors OWNER TO warehouse14_migrator;

--
-- Name: TABLE two_factors; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.two_factors IS 'TOTP secrets per user. ADMIN/READONLY mandatory enabled=true. DELETE permitted on user-disable (app-mediated).';


--
-- Name: users; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    name text NOT NULL,
    image text,
    role public.user_role NOT NULL,
    preferred_language character(2) DEFAULT 'de'::bpchar NOT NULL,
    shop_id uuid,
    soft_deleted_at timestamp with time zone,
    anonymized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_owner boolean DEFAULT false NOT NULL,
    pos_pin_hash text,
    pos_pin_set_at timestamp with time zone,
    pos_pin_failed_attempts integer DEFAULT 0 NOT NULL,
    pos_pin_locked_until timestamp with time zone,
    duress_pin_hash text,
    duress_pin_set_at timestamp with time zone,
    CONSTRAINT users_anonymized_after_soft_deleted CHECK (((anonymized_at IS NULL) OR (anonymized_at >= soft_deleted_at))),
    CONSTRAINT users_anonymized_implies_soft_deleted CHECK (((anonymized_at IS NULL) OR (soft_deleted_at IS NOT NULL))),
    CONSTRAINT users_duress_pin_distinct CHECK (((duress_pin_hash IS NULL) OR (duress_pin_hash <> pos_pin_hash))),
    CONSTRAINT users_duress_pin_hash_set_together CHECK ((((duress_pin_hash IS NULL) AND (duress_pin_set_at IS NULL)) OR ((duress_pin_hash IS NOT NULL) AND (duress_pin_set_at IS NOT NULL)))),
    CONSTRAINT users_owner_implies_admin CHECK (((is_owner = false) OR (role = 'ADMIN'::public.user_role))),
    CONSTRAINT users_pin_attempts_nonneg CHECK ((pos_pin_failed_attempts >= 0)),
    CONSTRAINT users_pin_hash_set_together CHECK ((((pos_pin_hash IS NULL) AND (pos_pin_set_at IS NULL)) OR ((pos_pin_hash IS NOT NULL) AND (pos_pin_set_at IS NOT NULL)))),
    CONSTRAINT users_preferred_language_check CHECK ((preferred_language = ANY (ARRAY['de'::bpchar, 'en'::bpchar, 'ar'::bpchar])))
);


ALTER TABLE public.users OWNER TO warehouse14_migrator;

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.users IS 'Authenticated users (ADMIN/CASHIER/READONLY). NEVER deleted by app role — GDPR via soft_deleted_at + anonymized_at.';


--
-- Name: COLUMN users.soft_deleted_at; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.users.soft_deleted_at IS 'Set when the user is "deleted" by the app. The row remains for fiscal/audit referential integrity.';


--
-- Name: COLUMN users.anonymized_at; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.users.anonymized_at IS 'Set when PII has been scrubbed (email reset, name nullified, image deleted). Always >= soft_deleted_at.';


--
-- Name: COLUMN users.is_owner; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.users.is_owner IS 'TRUE for exactly one user (the business Owner). Gives UX bypasses at the API layer — never bypasses DB triggers / legal floor. Partial UNIQUE on TRUE.';


--
-- Name: COLUMN users.pos_pin_hash; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.users.pos_pin_hash IS 'Argon2id hash of the 4-digit PIN. NULL = no POS access yet (set on first device pairing).';


--
-- Name: COLUMN users.pos_pin_failed_attempts; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.users.pos_pin_failed_attempts IS 'Consecutive wrong-PIN count. Reset to 0 on successful PIN or Full Login.';


--
-- Name: COLUMN users.pos_pin_locked_until; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.users.pos_pin_locked_until IS 'When set, PIN auth refuses until now() ≥ this. Clear via Full Login (ADR-0022 §4d).';


--
-- Name: verifications; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.verifications OWNER TO warehouse14_migrator;

--
-- Name: TABLE verifications; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.verifications IS 'Email-verification / password-reset / magic-link tokens. Short-lived; DELETE permitted on consume.';


--
-- Name: voucher_redemptions; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.voucher_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voucher_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    amount_eur numeric(18,2) NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT voucher_redemptions_amount_eur_check CHECK ((amount_eur > (0)::numeric))
);


ALTER TABLE public.voucher_redemptions OWNER TO warehouse14_migrator;

--
-- Name: TABLE voucher_redemptions; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.voucher_redemptions IS 'Append-only redemption log. Each row reduces vouchers.current_balance_eur. § 3 Abs. 14 UStG: SINGLE_PURPOSE vouchers carry VAT from issuance (no extra VAT at redemption); MULTI_PURPOSE vouchers carry VAT at redemption (the transaction_items lines that consume them).';


--
-- Name: vouchers; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.vouchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    voucher_type public.voucher_type NOT NULL,
    issued_value_eur numeric(18,2) NOT NULL,
    current_balance_eur numeric(18,2) NOT NULL,
    issuance_tax_treatment_code text,
    issued_to_customer_id uuid,
    issued_by_transaction_id uuid,
    expires_at timestamp with time zone,
    status public.voucher_status DEFAULT 'ACTIVE'::public.voucher_status NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vouchers_balance_le_issued CHECK ((current_balance_eur <= issued_value_eur)),
    CONSTRAINT vouchers_code_format CHECK ((code ~ '^[A-Z0-9]{8,32}$'::text)),
    CONSTRAINT vouchers_current_balance_eur_check CHECK ((current_balance_eur >= (0)::numeric)),
    CONSTRAINT vouchers_issued_value_eur_check CHECK ((issued_value_eur > (0)::numeric)),
    CONSTRAINT vouchers_single_purpose_has_tax CHECK (((voucher_type <> 'SINGLE_PURPOSE'::public.voucher_type) OR (issuance_tax_treatment_code IS NOT NULL)))
);


ALTER TABLE public.vouchers OWNER TO warehouse14_migrator;

--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.webhook_events (
    id bigint NOT NULL,
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    event_type text NOT NULL,
    raw_body text NOT NULL,
    payload jsonb NOT NULL,
    signature_verified boolean NOT NULL,
    processed_at timestamp with time zone,
    processing_error text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT webhook_events_payload_is_object CHECK ((jsonb_typeof(payload) = 'object'::text))
);


ALTER TABLE public.webhook_events OWNER TO warehouse14_migrator;

--
-- Name: TABLE webhook_events; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.webhook_events IS 'Idempotency + audit trail for every provider webhook. UNIQUE (provider, provider_event_id) means duplicate deliveries from Stripe/etc. are no-ops. NEVER DELETE — fiscal/forensic record.';


--
-- Name: webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.webhook_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.webhook_events_id_seq OWNER TO warehouse14_migrator;

--
-- Name: webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: warehouse14_migrator
--

ALTER SEQUENCE public.webhook_events_id_seq OWNED BY public.webhook_events.id;


--
-- Name: worker_job_dlq; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.worker_job_dlq (
    id bigint NOT NULL,
    job_name text NOT NULL,
    failure_count integer NOT NULL,
    last_error text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_run_id bigint,
    pushed_at timestamp with time zone DEFAULT now() NOT NULL,
    acked_at timestamp with time zone,
    acked_by_user_id uuid,
    ack_note text,
    CONSTRAINT worker_job_dlq_ack_pair CHECK (((acked_at IS NULL) = (acked_by_user_id IS NULL))),
    CONSTRAINT worker_job_dlq_failure_count_pos CHECK ((failure_count > 0)),
    CONSTRAINT worker_job_dlq_payload_is_object CHECK ((jsonb_typeof(payload) = 'object'::text))
);


ALTER TABLE public.worker_job_dlq OWNER TO warehouse14_migrator;

--
-- Name: TABLE worker_job_dlq; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.worker_job_dlq IS 'Dead-letter queue for jobs whose consecutive-failures exceeded the runner budget. Operator acks via Bridge UX (sets acked_at + acked_by_user_id + ack_note). Persistent — fiscal compliance posture: NEVER DELETE.';


--
-- Name: COLUMN worker_job_dlq.last_run_id; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON COLUMN public.worker_job_dlq.last_run_id IS 'Verweis auf den Protokolleintrag des letzten Versuchs. Wird leer, sobald das Protokoll turnusmässig aufgeräumt wird; Jobname, Fehlertext und Nutzlast bleiben in dieser Zeile erhalten.';


--
-- Name: worker_job_dlq_id_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.worker_job_dlq_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.worker_job_dlq_id_seq OWNER TO warehouse14_migrator;

--
-- Name: worker_job_dlq_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: warehouse14_migrator
--

ALTER SEQUENCE public.worker_job_dlq_id_seq OWNED BY public.worker_job_dlq.id;


--
-- Name: worker_job_runs; Type: TABLE; Schema: public; Owner: warehouse14_migrator
--

CREATE TABLE public.worker_job_runs (
    id bigint NOT NULL,
    job_name text NOT NULL,
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status public.worker_job_status DEFAULT 'RUNNING'::public.worker_job_status NOT NULL,
    error_message text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT worker_job_runs_error_only_when_failing CHECK (((error_message IS NULL) OR (status = ANY (ARRAY['FAILED'::public.worker_job_status, 'TIMEOUT'::public.worker_job_status])))),
    CONSTRAINT worker_job_runs_finished_iff_terminal CHECK (((status = 'RUNNING'::public.worker_job_status) <> (finished_at IS NOT NULL))),
    CONSTRAINT worker_job_runs_payload_is_object CHECK ((jsonb_typeof(payload) = 'object'::text))
);


ALTER TABLE public.worker_job_runs OWNER TO warehouse14_migrator;

--
-- Name: TABLE worker_job_runs; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON TABLE public.worker_job_runs IS 'Append-then-update audit log for every apps/worker job attempt. The runner INSERTs a RUNNING row then UPDATEs to terminal status on completion. Old rows can be archived by a purge job (Phase 1.5); fiscal data never lives here.';


--
-- Name: worker_job_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: warehouse14_migrator
--

CREATE SEQUENCE public.worker_job_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.worker_job_runs_id_seq OWNER TO warehouse14_migrator;

--
-- Name: worker_job_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: warehouse14_migrator
--

ALTER SEQUENCE public.worker_job_runs_id_seq OWNED BY public.worker_job_runs.id;


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: ledger_events id; Type: DEFAULT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.ledger_events ALTER COLUMN id SET DEFAULT nextval('public.ledger_events_id_seq'::regclass);


--
-- Name: metal_prices id; Type: DEFAULT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.metal_prices ALTER COLUMN id SET DEFAULT nextval('public.metal_prices_id_seq'::regclass);


--
-- Name: product_ebay_listing_events id; Type: DEFAULT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_ebay_listing_events ALTER COLUMN id SET DEFAULT nextval('public.product_ebay_listing_events_id_seq'::regclass);


--
-- Name: product_photo_workflow_events id; Type: DEFAULT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_photo_workflow_events ALTER COLUMN id SET DEFAULT nextval('public.product_photo_workflow_events_id_seq'::regclass);


--
-- Name: webhook_events id; Type: DEFAULT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.webhook_events ALTER COLUMN id SET DEFAULT nextval('public.webhook_events_id_seq'::regclass);


--
-- Name: worker_job_dlq id; Type: DEFAULT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.worker_job_dlq ALTER COLUMN id SET DEFAULT nextval('public.worker_job_dlq_id_seq'::regclass);


--
-- Name: worker_job_runs id; Type: DEFAULT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.worker_job_runs ALTER COLUMN id SET DEFAULT nextval('public.worker_job_runs_id_seq'::regclass);


--
-- Name: _w14_schema_migrations _w14_schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public._w14_schema_migrations
    ADD CONSTRAINT _w14_schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_provider_account_uq; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_provider_account_uq UNIQUE (provider_id, account_id);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: appointment_linked_products appointment_linked_products_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointment_linked_products
    ADD CONSTRAINT appointment_linked_products_pkey PRIMARY KEY (appointment_id, product_id);


--
-- Name: appointment_notifications appointment_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointment_notifications
    ADD CONSTRAINT appointment_notifications_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_no_staff_overlap; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_no_staff_overlap EXCLUDE USING gist (staff_user_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE ((status <> ALL (ARRAY['CANCELLED'::public.appointment_status, 'NO_SHOW'::public.appointment_status, 'RESCHEDULED'::public.appointment_status]))) DEFERRABLE;


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: appraisal_items appraisal_items_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appraisal_items
    ADD CONSTRAINT appraisal_items_pkey PRIMARY KEY (id);


--
-- Name: appraisals appraisals_ankauf_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appraisals
    ADD CONSTRAINT appraisals_ankauf_transaction_id_key UNIQUE (ankauf_transaction_id);


--
-- Name: appraisals appraisals_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appraisals
    ADD CONSTRAINT appraisals_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: beleg_logo beleg_logo_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.beleg_logo
    ADD CONSTRAINT beleg_logo_pkey PRIMARY KEY (id);


--
-- Name: belegtext_templates belegtext_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.belegtext_templates
    ADD CONSTRAINT belegtext_templates_pkey PRIMARY KEY (id);


--
-- Name: business_locations business_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.business_locations
    ADD CONSTRAINT business_locations_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_one_product_per_cart; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_one_product_per_cart UNIQUE (cart_id, product_id);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);


--
-- Name: carts carts_converted_to_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_converted_to_transaction_id_key UNIQUE (converted_to_transaction_id);


--
-- Name: carts carts_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_pkey PRIMARY KEY (id);


--
-- Name: carts carts_reservation_session_id_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_reservation_session_id_key UNIQUE (reservation_session_id);


--
-- Name: cash_movements cash_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: category_translations category_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.category_translations
    ADD CONSTRAINT category_translations_pkey PRIMARY KEY (category_id, locale);


--
-- Name: customer_broadcasts customer_broadcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.customer_broadcasts
    ADD CONSTRAINT customer_broadcasts_pkey PRIMARY KEY (id);


--
-- Name: customers customers_customer_number_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_number_key UNIQUE (customer_number);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: daily_closings daily_closings_business_day_shop_uq; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.daily_closings
    ADD CONSTRAINT daily_closings_business_day_shop_uq UNIQUE (business_day, shop_id);


--
-- Name: daily_closings daily_closings_festgeschrieben_hat_z_nr; Type: CHECK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE public.daily_closings
    ADD CONSTRAINT daily_closings_festgeschrieben_hat_z_nr CHECK (((finalized_at IS NULL) OR (z_nr IS NOT NULL))) NOT VALID;


--
-- Name: daily_closings daily_closings_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.daily_closings
    ADD CONSTRAINT daily_closings_pkey PRIMARY KEY (id);


--
-- Name: device_push_tokens device_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_pkey PRIMARY KEY (id);


--
-- Name: devices devices_cert_serial_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_cert_serial_key UNIQUE (cert_serial);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: document_attachments document_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.document_attachments
    ADD CONSTRAINT document_attachments_pkey PRIMARY KEY (id);


--
-- Name: dsfinvk_exports dsfinvk_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.dsfinvk_exports
    ADD CONSTRAINT dsfinvk_exports_pkey PRIMARY KEY (id);


--
-- Name: email_outbox email_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_pkey PRIMARY KEY (id);


--
-- Name: fixed_costs fixed_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.fixed_costs
    ADD CONSTRAINT fixed_costs_pkey PRIMARY KEY (id);


--
-- Name: hallmarks hallmarks_metal_stamp_uq; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.hallmarks
    ADD CONSTRAINT hallmarks_metal_stamp_uq UNIQUE (metal, stamp);


--
-- Name: hallmarks hallmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.hallmarks
    ADD CONSTRAINT hallmarks_pkey PRIMARY KEY (id);


--
-- Name: internal_tasks internal_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.internal_tasks
    ADD CONSTRAINT internal_tasks_pkey PRIMARY KEY (id);


--
-- Name: inventory_scans inventory_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.inventory_scans
    ADD CONSTRAINT inventory_scans_pkey PRIMARY KEY (id);


--
-- Name: inventory_sessions inventory_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.inventory_sessions
    ADD CONSTRAINT inventory_sessions_pkey PRIMARY KEY (id);


--
-- Name: karat_grades karat_grades_fineness_decimal_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.karat_grades
    ADD CONSTRAINT karat_grades_fineness_decimal_key UNIQUE (fineness_decimal);


--
-- Name: karat_grades karat_grades_fineness_per_1000_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.karat_grades
    ADD CONSTRAINT karat_grades_fineness_per_1000_key UNIQUE (fineness_per_1000);


--
-- Name: karat_grades karat_grades_hallmark_stamp_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.karat_grades
    ADD CONSTRAINT karat_grades_hallmark_stamp_key UNIQUE (hallmark_stamp);


--
-- Name: karat_grades karat_grades_karat_value_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.karat_grades
    ADD CONSTRAINT karat_grades_karat_value_key UNIQUE (karat_value);


--
-- Name: karat_grades karat_grades_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.karat_grades
    ADD CONSTRAINT karat_grades_pkey PRIMARY KEY (code);


--
-- Name: kartenleser kartenleser_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.kartenleser
    ADD CONSTRAINT kartenleser_pkey PRIMARY KEY (id);


--
-- Name: kartenleser kartenleser_provider_reader_id_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.kartenleser
    ADD CONSTRAINT kartenleser_provider_reader_id_key UNIQUE (provider_reader_id);


--
-- Name: kyc_documents kyc_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_pkey PRIMARY KEY (id);


--
-- Name: ledger_chain_head ledger_chain_head_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.ledger_chain_head
    ADD CONSTRAINT ledger_chain_head_pkey PRIMARY KEY (only_row);


--
-- Name: ledger_events ledger_events_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.ledger_events
    ADD CONSTRAINT ledger_events_pkey PRIMARY KEY (id);


--
-- Name: leser_zahlungen leser_zahlungen_idempotenz_schluessel_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.leser_zahlungen
    ADD CONSTRAINT leser_zahlungen_idempotenz_schluessel_key UNIQUE (idempotenz_schluessel);


--
-- Name: leser_zahlungen leser_zahlungen_intent_je_anbieter; Type: CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.leser_zahlungen
    ADD CONSTRAINT leser_zahlungen_intent_je_anbieter UNIQUE (provider, provider_intent_id);


--
-- Name: leser_zahlungen leser_zahlungen_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.leser_zahlungen
    ADD CONSTRAINT leser_zahlungen_pkey PRIMARY KEY (id);


--
-- Name: metal_prices metal_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.metal_prices
    ADD CONSTRAINT metal_prices_pkey PRIMARY KEY (id);


--
-- Name: operating_expenses operating_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.operating_expenses
    ADD CONSTRAINT operating_expenses_pkey PRIMARY KEY (id);


--
-- Name: payment_commission_rates payment_commission_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.payment_commission_rates
    ADD CONSTRAINT payment_commission_rates_pkey PRIMARY KEY (id);


--
-- Name: payment_intents payment_intents_cart_id_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_cart_id_key UNIQUE (cart_id);


--
-- Name: payment_intents payment_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_pkey PRIMARY KEY (id);


--
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (product_id, category_id);


--
-- Name: product_ebay_listing_events product_ebay_listing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_ebay_listing_events
    ADD CONSTRAINT product_ebay_listing_events_pkey PRIMARY KEY (id);


--
-- Name: product_photo_workflow_events product_photo_workflow_events_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_photo_workflow_events
    ADD CONSTRAINT product_photo_workflow_events_pkey PRIMARY KEY (id);


--
-- Name: product_photos product_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_photos
    ADD CONSTRAINT product_photos_pkey PRIMARY KEY (id);


--
-- Name: product_translations product_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.product_translations
    ADD CONSTRAINT product_translations_pkey PRIMARY KEY (product_id, locale);


--
-- Name: product_viewing_holds product_viewing_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_viewing_holds
    ADD CONSTRAINT product_viewing_holds_pkey PRIMARY KEY (id);


--
-- Name: products products_barcode_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_barcode_key UNIQUE (barcode);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: push_outbox push_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.push_outbox
    ADD CONSTRAINT push_outbox_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_key UNIQUE (token);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: shipping_rates shipping_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shipping_rates
    ADD CONSTRAINT shipping_rates_pkey PRIMARY KEY (id);


--
-- Name: shipping_zones shipping_zones_code_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shipping_zones
    ADD CONSTRAINT shipping_zones_code_key UNIQUE (code);


--
-- Name: shipping_zones shipping_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shipping_zones
    ADD CONSTRAINT shipping_zones_pkey PRIMARY KEY (id);


--
-- Name: shop_holidays shop_holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shop_holidays
    ADD CONSTRAINT shop_holidays_pkey PRIMARY KEY (id);


--
-- Name: shop_holidays shop_holidays_shop_date_uq; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shop_holidays
    ADD CONSTRAINT shop_holidays_shop_date_uq UNIQUE (shop_id, closed_date);


--
-- Name: shopper_sessions shopper_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shopper_sessions
    ADD CONSTRAINT shopper_sessions_pkey PRIMARY KEY (id);


--
-- Name: shopper_sessions shopper_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shopper_sessions
    ADD CONSTRAINT shopper_sessions_token_key UNIQUE (token);


--
-- Name: shoppers shoppers_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shoppers
    ADD CONSTRAINT shoppers_customer_id_key UNIQUE (customer_id);


--
-- Name: shoppers shoppers_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shoppers
    ADD CONSTRAINT shoppers_pkey PRIMARY KEY (id);


--
-- Name: staff_time_off staff_time_off_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.staff_time_off
    ADD CONSTRAINT staff_time_off_pkey PRIMARY KEY (id);


--
-- Name: staff_working_hours staff_working_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.staff_working_hours
    ADD CONSTRAINT staff_working_hours_pkey PRIMARY KEY (id);


--
-- Name: stripe_connected_accounts stripe_connected_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.stripe_connected_accounts
    ADD CONSTRAINT stripe_connected_accounts_pkey PRIMARY KEY (id);


--
-- Name: stripe_connected_accounts stripe_connected_accounts_stripe_account_id_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.stripe_connected_accounts
    ADD CONSTRAINT stripe_connected_accounts_stripe_account_id_key UNIQUE (stripe_account_id);


--
-- Name: support_messages support_messages_gmail_message_id_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_gmail_message_id_key UNIQUE (gmail_message_id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_ticket_number_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_ticket_number_key UNIQUE (ticket_number);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: tax_treatment_codes tax_treatment_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.tax_treatment_codes
    ADD CONSTRAINT tax_treatment_codes_pkey PRIMARY KEY (code);


--
-- Name: transaction_items transaction_items_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_pkey PRIMARY KEY (id);


--
-- Name: transaction_payments transaction_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: tse_clients tse_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.tse_clients
    ADD CONSTRAINT tse_clients_pkey PRIMARY KEY (id);


--
-- Name: tse_daily_archives tse_daily_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.tse_daily_archives
    ADD CONSTRAINT tse_daily_archives_pkey PRIMARY KEY (id);


--
-- Name: tse_signatures tse_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.tse_signatures
    ADD CONSTRAINT tse_signatures_pkey PRIMARY KEY (id);


--
-- Name: tse_signatures tse_signatures_unique_per_transaction; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.tse_signatures
    ADD CONSTRAINT tse_signatures_unique_per_transaction UNIQUE (transaction_id);


--
-- Name: tse_transactions tse_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.tse_transactions
    ADD CONSTRAINT tse_transactions_pkey PRIMARY KEY (id);


--
-- Name: tse_transactions tse_transactions_unique_per_transaction; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.tse_transactions
    ADD CONSTRAINT tse_transactions_unique_per_transaction UNIQUE (transaction_id);


--
-- Name: two_factors two_factors_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.two_factors
    ADD CONSTRAINT two_factors_pkey PRIMARY KEY (id);


--
-- Name: two_factors two_factors_user_id_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.two_factors
    ADD CONSTRAINT two_factors_user_id_key UNIQUE (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verifications verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT verifications_pkey PRIMARY KEY (id);


--
-- Name: voucher_redemptions voucher_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_pkey PRIMARY KEY (id);


--
-- Name: vouchers vouchers_code_key; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_code_key UNIQUE (code);


--
-- Name: vouchers vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: worker_job_dlq worker_job_dlq_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.worker_job_dlq
    ADD CONSTRAINT worker_job_dlq_pkey PRIMARY KEY (id);


--
-- Name: worker_job_runs worker_job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.worker_job_runs
    ADD CONSTRAINT worker_job_runs_pkey PRIMARY KEY (id);


--
-- Name: accounts_user_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX accounts_user_id_idx ON public.accounts USING btree (user_id);


--
-- Name: api_keys_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX api_keys_active_idx ON public.api_keys USING btree (id) WHERE (revoked_at IS NULL);


--
-- Name: api_keys_created_by_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX api_keys_created_by_idx ON public.api_keys USING btree (created_by_user_id);


--
-- Name: api_keys_token_hash_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX api_keys_token_hash_uq ON public.api_keys USING btree (token_hash);


--
-- Name: appointment_linked_products_product_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appointment_linked_products_product_idx ON public.appointment_linked_products USING btree (product_id);


--
-- Name: appointments_active_window_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appointments_active_window_idx ON public.appointments USING btree (starts_at, ends_at) WHERE (status <> ALL (ARRAY['CANCELLED'::public.appointment_status, 'NO_SHOW'::public.appointment_status, 'RESCHEDULED'::public.appointment_status]));


--
-- Name: appointments_business_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appointments_business_day_idx ON public.appointments USING btree (shop_id, public.berlin_business_day(starts_at));


--
-- Name: appointments_customer_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appointments_customer_idx ON public.appointments USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: appointments_google_event_id_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX appointments_google_event_id_uq ON public.appointments USING btree (google_event_id);


--
-- Name: INDEX appointments_google_event_id_uq; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON INDEX public.appointments_google_event_id_uq IS 'Inbound calendar-pull idempotency key — at most one appointment per Google event.';


--
-- Name: appointments_missing_google_event_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appointments_missing_google_event_idx ON public.appointments USING btree (starts_at) WHERE ((google_event_id IS NULL) AND (status <> ALL (ARRAY['CANCELLED'::public.appointment_status, 'NO_SHOW'::public.appointment_status, 'RESCHEDULED'::public.appointment_status])));


--
-- Name: appointments_one_transaction_link_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX appointments_one_transaction_link_uq ON public.appointments USING btree (linked_transaction_id) WHERE (linked_transaction_id IS NOT NULL);


--
-- Name: INDEX appointments_one_transaction_link_uq; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON INDEX public.appointments_one_transaction_link_uq IS 'Red Team Audit C-5: an appointment can result in at most one transaction. Partial UNIQUE — NULLs (no sale yet) excluded. ADR-0020.';


--
-- Name: appointments_staff_starts_at_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appointments_staff_starts_at_idx ON public.appointments USING btree (staff_user_id, starts_at);


--
-- Name: appointments_status_starts_at_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appointments_status_starts_at_idx ON public.appointments USING btree (status, starts_at);


--
-- Name: appraisal_items_appraisal_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appraisal_items_appraisal_idx ON public.appraisal_items USING btree (appraisal_id, sequence_in_lot);


--
-- Name: appraisal_items_product_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appraisal_items_product_idx ON public.appraisal_items USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: appraisals_ankauf_tx_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appraisals_ankauf_tx_idx ON public.appraisals USING btree (ankauf_transaction_id) WHERE (ankauf_transaction_id IS NOT NULL);


--
-- Name: appraisals_customer_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appraisals_customer_idx ON public.appraisals USING btree (customer_id, opened_at DESC);


--
-- Name: appraisals_status_opened_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX appraisals_status_opened_idx ON public.appraisals USING btree (status, opened_at DESC);


--
-- Name: audit_log_actor_created_at_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX audit_log_actor_created_at_idx ON public.audit_log USING btree (actor_user_id, created_at DESC) WHERE (actor_user_id IS NOT NULL);


--
-- Name: audit_log_business_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX audit_log_business_day_idx ON public.audit_log USING btree (public.berlin_business_day(created_at));


--
-- Name: audit_log_event_type_created_at_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX audit_log_event_type_created_at_idx ON public.audit_log USING btree (event_type, created_at DESC);


--
-- Name: belegtext_kind_language_validfrom_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX belegtext_kind_language_validfrom_idx ON public.belegtext_templates USING btree (kind, language, valid_from DESC);


--
-- Name: belegtext_one_current_per_kind_lang_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX belegtext_one_current_per_kind_lang_uq ON public.belegtext_templates USING btree (kind, language) WHERE (valid_to IS NULL);


--
-- Name: business_locations_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX business_locations_active_idx ON public.business_locations USING btree (active);


--
-- Name: business_locations_city_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX business_locations_city_idx ON public.business_locations USING btree (city) WHERE (active = true);


--
-- Name: business_locations_one_primary_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX business_locations_one_primary_uq ON public.business_locations USING btree ((true)) WHERE ((is_primary = true) AND (active = true));


--
-- Name: cart_items_cart_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX cart_items_cart_idx ON public.cart_items USING btree (cart_id);


--
-- Name: carts_awaiting_fulfilment_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX carts_awaiting_fulfilment_idx ON public.carts USING btree (fulfilment_status, reserved_at) WHERE ((fulfilment_method = 'SHIPPING'::public.fulfilment_method) AND (fulfilment_status = ANY (ARRAY['READY_TO_PACK'::public.fulfilment_status, 'PACKED'::public.fulfilment_status])));


--
-- Name: carts_checkout_expires_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX carts_checkout_expires_idx ON public.carts USING btree (checkout_expires_at) WHERE (status = 'CHECKOUT'::public.cart_status);


--
-- Name: carts_one_active_per_shopper_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX carts_one_active_per_shopper_uq ON public.carts USING btree (shopper_id) WHERE (status = 'ACTIVE'::public.cart_status);


--
-- Name: carts_order_number_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX carts_order_number_uq ON public.carts USING btree (order_number) WHERE (order_number IS NOT NULL);


--
-- Name: carts_pending_expiry_reminder_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX carts_pending_expiry_reminder_idx ON public.carts USING btree (reserved_at) WHERE ((status = 'RESERVED'::public.cart_status) AND (fulfilment_method = 'PICKUP'::public.fulfilment_method) AND (expiry_reminder_sent_at IS NULL));


--
-- Name: carts_pickup_queue_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX carts_pickup_queue_idx ON public.carts USING btree (pickup_stage, reserved_at) WHERE ((status = 'RESERVED'::public.cart_status) AND (fulfilment_method = 'PICKUP'::public.fulfilment_method));


--
-- Name: cash_movements_direction_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX cash_movements_direction_day_idx ON public.cash_movements USING btree (direction, public.berlin_business_day(created_at));


--
-- Name: cash_movements_external_ref_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX cash_movements_external_ref_uq ON public.cash_movements USING btree (external_ref) WHERE (external_ref IS NOT NULL);


--
-- Name: cash_movements_shift_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX cash_movements_shift_idx ON public.cash_movements USING btree (shift_id, created_at);


--
-- Name: categories_display_order_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX categories_display_order_idx ON public.categories USING btree (parent_id, display_order, name_de);


--
-- Name: categories_parent_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX categories_parent_idx ON public.categories USING btree (parent_id);


--
-- Name: categories_slug_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX categories_slug_uq ON public.categories USING btree (slug);


--
-- Name: category_translations_locale_idx; Type: INDEX; Schema: public; Owner: warehouse14
--

CREATE INDEX category_translations_locale_idx ON public.category_translations USING btree (locale);


--
-- Name: customer_broadcasts_recent_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX customer_broadcasts_recent_idx ON public.customer_broadcasts USING btree (created_at DESC);


--
-- Name: customers_email_blind_index_active_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX customers_email_blind_index_active_uq ON public.customers USING btree (email_blind_index) WHERE ((email_blind_index IS NOT NULL) AND (soft_deleted_at IS NULL));


--
-- Name: customers_kyc_expiring_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX customers_kyc_expiring_idx ON public.customers USING btree (kyc_expires_at) WHERE ((kyc_status = 'VERIFIED'::public.kyc_status) AND (soft_deleted_at IS NULL));


--
-- Name: customers_phone_blind_index_active_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX customers_phone_blind_index_active_uq ON public.customers USING btree (phone_blind_index) WHERE ((phone_blind_index IS NOT NULL) AND (soft_deleted_at IS NULL));


--
-- Name: customers_retention_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX customers_retention_idx ON public.customers USING btree (retention_until) WHERE (soft_deleted_at IS NULL);


--
-- Name: customers_sanctions_flags_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX customers_sanctions_flags_idx ON public.customers USING btree (sanctions_match, pep_match) WHERE (((sanctions_match = true) OR (pep_match = true)) AND (soft_deleted_at IS NULL));


--
-- Name: customers_shop_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX customers_shop_id_idx ON public.customers USING btree (shop_id) WHERE (shop_id IS NOT NULL);


--
-- Name: customers_trust_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX customers_trust_active_idx ON public.customers USING btree (trust_level, updated_at DESC) WHERE ((soft_deleted_at IS NULL) AND (trust_level = ANY (ARRAY['VIP'::public.customer_trust_level, 'SUSPICIOUS'::public.customer_trust_level, 'BANNED'::public.customer_trust_level])));


--
-- Name: customers_vat_check_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX customers_vat_check_idx ON public.customers USING btree (vat_id_check_result, vat_id_checked_at) WHERE (vat_id IS NOT NULL);


--
-- Name: customers_vat_id_normalized_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX customers_vat_id_normalized_idx ON public.customers USING btree (upper(regexp_replace(vat_id, '[^A-Za-z0-9]'::text, ''::text, 'g'::text))) WHERE ((vat_id IS NOT NULL) AND (soft_deleted_at IS NULL));


--
-- Name: INDEX customers_vat_id_normalized_idx; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON INDEX public.customers_vat_id_normalized_idx IS 'Normalised VAT-id lookup for the POS B2B checkout (GET /api/customers/by-vat-id).';


--
-- Name: customers_with_debt_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX customers_with_debt_idx ON public.customers USING btree (cumulative_debt_eur DESC) WHERE ((cumulative_debt_eur > (0)::numeric) AND (soft_deleted_at IS NULL));


--
-- Name: daily_closings_business_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX daily_closings_business_day_idx ON public.daily_closings USING btree (business_day DESC);


--
-- Name: daily_closings_business_day_null_shop_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX daily_closings_business_day_null_shop_uq ON public.daily_closings USING btree (business_day) WHERE (shop_id IS NULL);


--
-- Name: INDEX daily_closings_business_day_null_shop_uq; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON INDEX public.daily_closings_business_day_null_shop_uq IS 'One Z-Bon per business day in the V1 single-shop model (shop_id NULL); closes the NULLS-DISTINCT gap in daily_closings_business_day_shop_uq.';


--
-- Name: daily_closings_finalized_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX daily_closings_finalized_idx ON public.daily_closings USING btree (finalized_at DESC) WHERE (state = 'FINALIZED'::public.closing_state);


--
-- Name: daily_closings_state_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX daily_closings_state_idx ON public.daily_closings USING btree (state, business_day DESC);


--
-- Name: daily_closings_z_nr_null_shop_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX daily_closings_z_nr_null_shop_uq ON public.daily_closings USING btree (z_nr) WHERE ((shop_id IS NULL) AND (z_nr IS NOT NULL));


--
-- Name: daily_closings_z_nr_shop_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX daily_closings_z_nr_shop_uq ON public.daily_closings USING btree (shop_id, z_nr) WHERE ((shop_id IS NOT NULL) AND (z_nr IS NOT NULL));


--
-- Name: device_push_tokens_live_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX device_push_tokens_live_idx ON public.device_push_tokens USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: device_push_tokens_shopper_live_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX device_push_tokens_shopper_live_idx ON public.device_push_tokens USING btree (shopper_id) WHERE ((revoked_at IS NULL) AND (shopper_id IS NOT NULL));


--
-- Name: device_push_tokens_token_key; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX device_push_tokens_token_key ON public.device_push_tokens USING btree (token);


--
-- Name: devices_expiring_soon_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX devices_expiring_soon_idx ON public.devices USING btree (cert_expires_at) WHERE (status = 'active'::public.device_status);


--
-- Name: devices_status_class_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX devices_status_class_idx ON public.devices USING btree (status, device_class);


--
-- Name: document_attachments_appraisal_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX document_attachments_appraisal_idx ON public.document_attachments USING btree (appraisal_id, category, created_at DESC) WHERE ((appraisal_id IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: document_attachments_category_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX document_attachments_category_idx ON public.document_attachments USING btree (category, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: document_attachments_customer_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX document_attachments_customer_idx ON public.document_attachments USING btree (customer_id, category, created_at DESC) WHERE ((customer_id IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: document_attachments_product_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX document_attachments_product_idx ON public.document_attachments USING btree (product_id, category, created_at DESC) WHERE ((product_id IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: document_attachments_transaction_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX document_attachments_transaction_idx ON public.document_attachments USING btree (transaction_id, category, created_at DESC) WHERE ((transaction_id IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: dsfinvk_exports_period_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX dsfinvk_exports_period_idx ON public.dsfinvk_exports USING btree (period_start, period_end);


--
-- Name: dsfinvk_exports_requested_by_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX dsfinvk_exports_requested_by_idx ON public.dsfinvk_exports USING btree (requested_by_user_id, created_at DESC);


--
-- Name: dsfinvk_exports_state_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX dsfinvk_exports_state_idx ON public.dsfinvk_exports USING btree (state, created_at DESC);


--
-- Name: ebay_events_order_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX ebay_events_order_idx ON public.product_ebay_listing_events USING btree (ebay_order_id) WHERE (ebay_order_id IS NOT NULL);


--
-- Name: ebay_events_product_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX ebay_events_product_idx ON public.product_ebay_listing_events USING btree (product_id, created_at DESC);


--
-- Name: email_outbox_customer_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX email_outbox_customer_idx ON public.email_outbox USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: email_outbox_due_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX email_outbox_due_idx ON public.email_outbox USING btree (next_attempt_at) WHERE (status = 'PENDING'::text);


--
-- Name: fixed_costs_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX fixed_costs_active_idx ON public.fixed_costs USING btree (active_from) WHERE (active_to IS NULL);


--
-- Name: fixed_costs_range_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX fixed_costs_range_idx ON public.fixed_costs USING btree (active_from, active_to);


--
-- Name: hallmarks_metal_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX hallmarks_metal_idx ON public.hallmarks USING btree (metal) WHERE (active = true);


--
-- Name: hallmarks_stamp_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX hallmarks_stamp_idx ON public.hallmarks USING btree (stamp) WHERE (active = true);


--
-- Name: idx_appt_notif_appointment; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX idx_appt_notif_appointment ON public.appointment_notifications USING btree (appointment_id);


--
-- Name: idx_appt_notif_scheduled; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX idx_appt_notif_scheduled ON public.appointment_notifications USING btree (scheduled_for) WHERE (sent_at IS NULL);


--
-- Name: internal_tasks_assignee_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX internal_tasks_assignee_active_idx ON public.internal_tasks USING btree (assigned_to_user_id, priority DESC, due_date, created_at DESC) WHERE (status = ANY (ARRAY['OPEN'::public.task_status, 'IN_PROGRESS'::public.task_status, 'BLOCKED'::public.task_status]));


--
-- Name: internal_tasks_due_soon_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX internal_tasks_due_soon_idx ON public.internal_tasks USING btree (due_date) WHERE ((due_date IS NOT NULL) AND (status = ANY (ARRAY['OPEN'::public.task_status, 'IN_PROGRESS'::public.task_status])));


--
-- Name: internal_tasks_related_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX internal_tasks_related_idx ON public.internal_tasks USING btree (related_entity_table, related_entity_id) WHERE (related_entity_id IS NOT NULL);


--
-- Name: internal_tasks_status_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX internal_tasks_status_idx ON public.internal_tasks USING btree (status, created_at DESC);


--
-- Name: inventory_scans_product_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX inventory_scans_product_idx ON public.inventory_scans USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: inventory_scans_session_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX inventory_scans_session_idx ON public.inventory_scans USING btree (session_id, scanned_at);


--
-- Name: inventory_sessions_one_open_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX inventory_sessions_one_open_uq ON public.inventory_sessions USING btree ((1)) WHERE (status = 'OPEN'::public.inventory_session_status);


--
-- Name: karat_grades_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX karat_grades_active_idx ON public.karat_grades USING btree (karat_value) WHERE (active = true);


--
-- Name: kyc_documents_customer_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX kyc_documents_customer_id_idx ON public.kyc_documents USING btree (customer_id);


--
-- Name: kyc_documents_expires_on_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX kyc_documents_expires_on_idx ON public.kyc_documents USING btree (expires_on);


--
-- Name: kyc_documents_retention_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX kyc_documents_retention_idx ON public.kyc_documents USING btree (retention_until);


--
-- Name: kyc_documents_unverified_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX kyc_documents_unverified_idx ON public.kyc_documents USING btree (created_at DESC) WHERE (verified_at IS NULL);


--
-- Name: ledger_events_actor_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX ledger_events_actor_idx ON public.ledger_events USING btree (actor_user_id, id DESC) WHERE (actor_user_id IS NOT NULL);


--
-- Name: ledger_events_business_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX ledger_events_business_day_idx ON public.ledger_events USING btree (public.berlin_business_day(created_at));


--
-- Name: ledger_events_entity_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX ledger_events_entity_idx ON public.ledger_events USING btree (entity_table, entity_id);


--
-- Name: ledger_events_event_type_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX ledger_events_event_type_idx ON public.ledger_events USING btree (event_type, id DESC);


--
-- Name: leser_zahlungen_status_idx; Type: INDEX; Schema: public; Owner: warehouse14
--

CREATE INDEX leser_zahlungen_status_idx ON public.leser_zahlungen USING btree (status, created_at DESC);


--
-- Name: metal_prices_fetched_by_job_run_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX metal_prices_fetched_by_job_run_id_idx ON public.metal_prices USING btree (fetched_by_job_run_id) WHERE (fetched_by_job_run_id IS NOT NULL);


--
-- Name: metal_prices_metal_validfrom_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX metal_prices_metal_validfrom_idx ON public.metal_prices USING btree (metal, valid_from DESC);


--
-- Name: metal_prices_one_current_per_metal_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX metal_prices_one_current_per_metal_uq ON public.metal_prices USING btree (metal) WHERE (valid_to IS NULL);


--
-- Name: metal_prices_source_fetched_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX metal_prices_source_fetched_idx ON public.metal_prices USING btree (source, fetched_at DESC);


--
-- Name: operating_expenses_business_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX operating_expenses_business_day_idx ON public.operating_expenses USING btree (business_day, category);


--
-- Name: payment_commission_rates_lookup_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX payment_commission_rates_lookup_idx ON public.payment_commission_rates USING btree (provider, account_ref);


--
-- Name: payment_commission_rates_scope_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX payment_commission_rates_scope_uq ON public.payment_commission_rates USING btree (provider, account_ref, channel) NULLS NOT DISTINCT;


--
-- Name: payment_intents_provider_intent_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX payment_intents_provider_intent_uq ON public.payment_intents USING btree (provider, provider_intent_id);


--
-- Name: payment_intents_status_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX payment_intents_status_idx ON public.payment_intents USING btree (status, created_at DESC);


--
-- Name: photo_workflow_events_photo_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX photo_workflow_events_photo_idx ON public.product_photo_workflow_events USING btree (product_photo_id, created_at DESC);


--
-- Name: product_categories_category_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX product_categories_category_idx ON public.product_categories USING btree (category_id);


--
-- Name: product_categories_one_primary_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX product_categories_one_primary_uq ON public.product_categories USING btree (product_id) WHERE (is_primary = true);


--
-- Name: product_photos_local_size_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX product_photos_local_size_idx ON public.product_photos USING btree (storage_kind) WHERE (storage_kind = 'local'::text);


--
-- Name: product_photos_one_primary_per_product_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX product_photos_one_primary_per_product_uq ON public.product_photos USING btree (product_id) WHERE ((is_primary = true) AND (product_id IS NOT NULL));


--
-- Name: product_photos_product_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX product_photos_product_id_idx ON public.product_photos USING btree (product_id, display_order);


--
-- Name: product_photos_unassigned_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX product_photos_unassigned_idx ON public.product_photos USING btree (workflow_state, created_at DESC) WHERE (product_id IS NULL);


--
-- Name: product_photos_workflow_state_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX product_photos_workflow_state_idx ON public.product_photos USING btree (workflow_state, workflow_changed_at DESC);


--
-- Name: product_translations_locale_idx; Type: INDEX; Schema: public; Owner: warehouse14
--

CREATE INDEX product_translations_locale_idx ON public.product_translations USING btree (locale);


--
-- Name: product_viewing_holds_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX product_viewing_holds_active_idx ON public.product_viewing_holds USING btree (product_id, hold_expires_at) WHERE (released_at IS NULL);


--
-- Name: product_viewing_holds_appointment_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX product_viewing_holds_appointment_idx ON public.product_viewing_holds USING btree (appointment_id);


--
-- Name: products_acquired_from_customer_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_acquired_from_customer_idx ON public.products USING btree (acquired_from_customer_id) WHERE (acquired_from_customer_id IS NOT NULL);


--
-- Name: products_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_active_idx ON public.products USING btree (created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: products_ankauf_customer_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_ankauf_customer_id_idx ON public.products USING btree (ankauf_customer_id) WHERE (ankauf_customer_id IS NOT NULL);


--
-- Name: products_archived_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_archived_idx ON public.products USING btree (archived_at DESC) WHERE (archived_at IS NOT NULL);


--
-- Name: products_commission_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_commission_active_idx ON public.products USING btree (status, created_at DESC) WHERE ((is_commission = true) AND (archived_at IS NULL));


--
-- Name: products_condition_available_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_condition_available_idx ON public.products USING btree (condition, created_at DESC) WHERE ((status = 'AVAILABLE'::public.product_status) AND (archived_at IS NULL));


--
-- Name: products_ebay_state_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_ebay_state_active_idx ON public.products USING btree (ebay_state, ebay_state_changed_at DESC) WHERE ((ebay_state IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: products_feingewicht_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_feingewicht_idx ON public.products USING btree (metal, feingewicht_grams) WHERE ((feingewicht_grams IS NOT NULL) AND (status = ANY (ARRAY['AVAILABLE'::public.product_status, 'RESERVED'::public.product_status])));


--
-- Name: products_listed_on_ebay_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_listed_on_ebay_idx ON public.products USING btree (listed_on_ebay) WHERE (listed_on_ebay = true);


--
-- Name: products_location_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_location_idx ON public.products USING btree (location_storage_unit, location_drawer) WHERE ((archived_at IS NULL) AND (status = ANY (ARRAY['AVAILABLE'::public.product_status, 'RESERVED'::public.product_status])));


--
-- Name: products_origin_country_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_origin_country_idx ON public.products USING btree (origin_country) WHERE ((archived_at IS NULL) AND (origin_country IS NOT NULL));


--
-- Name: products_parent_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_parent_idx ON public.products USING btree (parent_product_id) WHERE (parent_product_id IS NOT NULL);


--
-- Name: products_period_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_period_idx ON public.products USING btree (period) WHERE ((archived_at IS NULL) AND (period IS NOT NULL));


--
-- Name: products_pos_reserved_at_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_pos_reserved_at_idx ON public.products USING btree (reserved_at) WHERE ((status = 'RESERVED'::public.product_status) AND (reserved_by_channel = 'POS'::public.reservation_channel));


--
-- Name: INDEX products_pos_reserved_at_idx; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON INDEX public.products_pos_reserved_at_idx IS 'Backs the stale-POS-hold reclaim sweep (pos_reservation_sweeper / autoReleaseStalePos).';


--
-- Name: products_published_at_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_published_at_active_idx ON public.products USING btree (published_at) WHERE ((archived_at IS NULL) AND (published_at IS NOT NULL));


--
-- Name: products_reservation_expires_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_reservation_expires_idx ON public.products USING btree (reservation_expires_at) WHERE ((status = 'RESERVED'::public.product_status) AND (reservation_expires_at IS NOT NULL));


--
-- Name: products_slug_active_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX products_slug_active_uq ON public.products USING btree (slug) WHERE ((archived_at IS NULL) AND (slug IS NOT NULL));


--
-- Name: products_status_available_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_status_available_idx ON public.products USING btree (created_at DESC) WHERE (status = 'AVAILABLE'::public.product_status);


--
-- Name: products_storefront_catalog_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_storefront_catalog_idx ON public.products USING btree (is_published_to_web, status, published_at DESC NULLS LAST) INCLUDE (id, slug, name, list_price_eur, schema_org_type) WHERE ((is_published_to_web = true) AND (status = 'AVAILABLE'::public.product_status));


--
-- Name: INDEX products_storefront_catalog_idx; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON INDEX public.products_storefront_catalog_idx IS 'Phase 2.A — covers the GET /api/storefront/products catalog scan. Partial WHERE keeps the index narrow; INCLUDE list serves the listing as index-only (no heap fetch). Reads only.';


--
-- Name: products_tax_treatment_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_tax_treatment_idx ON public.products USING btree (tax_treatment_code);


--
-- Name: products_year_minted_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX products_year_minted_idx ON public.products USING btree (year_minted_from, year_minted_to) WHERE (archived_at IS NULL);


--
-- Name: push_outbox_pending_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX push_outbox_pending_idx ON public.push_outbox USING btree (created_at) WHERE (status = 'PENDING'::text);


--
-- Name: sessions_device_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX sessions_device_id_idx ON public.sessions USING btree (device_id) WHERE (device_id IS NOT NULL);


--
-- Name: sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX sessions_expires_at_idx ON public.sessions USING btree (expires_at);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);


--
-- Name: sessions_user_live_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX sessions_user_live_idx ON public.sessions USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: shifts_device_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shifts_device_day_idx ON public.shifts USING btree (device_id, public.berlin_business_day(opened_at));


--
-- Name: shifts_one_open_per_device_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX shifts_one_open_per_device_uq ON public.shifts USING btree (device_id) WHERE (status = 'OPEN'::public.shift_status);


--
-- Name: shifts_opened_by_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shifts_opened_by_idx ON public.shifts USING btree (opened_by_user_id, opened_at DESC);


--
-- Name: shipments_cart_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shipments_cart_idx ON public.shipments USING btree (cart_id) WHERE (cart_id IS NOT NULL);


--
-- Name: shipments_open_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shipments_open_idx ON public.shipments USING btree (status, created_at) WHERE (status = ANY (ARRAY['DRAFT'::public.shipment_status, 'LABEL_PURCHASED'::public.shipment_status, 'HANDED_OVER'::public.shipment_status, 'IN_TRANSIT'::public.shipment_status]));


--
-- Name: shipments_tracking_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX shipments_tracking_uq ON public.shipments USING btree (carrier, tracking_number) WHERE (tracking_number IS NOT NULL);


--
-- Name: shipments_transaction_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shipments_transaction_idx ON public.shipments USING btree (transaction_id) WHERE (transaction_id IS NOT NULL);


--
-- Name: shipping_rates_zone_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shipping_rates_zone_idx ON public.shipping_rates USING btree (zone_id, sort_order) WHERE active;


--
-- Name: shipping_zones_one_catch_all; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX shipping_zones_one_catch_all ON public.shipping_zones USING btree ((true)) WHERE is_catch_all;


--
-- Name: shopper_sessions_expires_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shopper_sessions_expires_idx ON public.shopper_sessions USING btree (expires_at);


--
-- Name: shopper_sessions_live_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shopper_sessions_live_idx ON public.shopper_sessions USING btree (token) WHERE (revoked_at IS NULL);


--
-- Name: shopper_sessions_shopper_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shopper_sessions_shopper_idx ON public.shopper_sessions USING btree (shopper_id);


--
-- Name: shoppers_customer_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shoppers_customer_idx ON public.shoppers USING btree (customer_id);


--
-- Name: shoppers_email_blind_active_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX shoppers_email_blind_active_uq ON public.shoppers USING btree (email_blind_index) WHERE (soft_deleted_at IS NULL);


--
-- Name: shoppers_google_sub_active_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX shoppers_google_sub_active_uq ON public.shoppers USING btree (google_sub) WHERE ((google_sub IS NOT NULL) AND (soft_deleted_at IS NULL));


--
-- Name: shoppers_guest_created_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shoppers_guest_created_idx ON public.shoppers USING btree (created_at) WHERE is_guest;


--
-- Name: shoppers_locked_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX shoppers_locked_idx ON public.shoppers USING btree (locked_until) WHERE (locked_until IS NOT NULL);


--
-- Name: staff_time_off_user_range_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX staff_time_off_user_range_idx ON public.staff_time_off USING btree (user_id, starts_at, ends_at);


--
-- Name: staff_working_hours_user_weekday_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX staff_working_hours_user_weekday_idx ON public.staff_working_hours USING btree (user_id, weekday);


--
-- Name: stripe_connected_accounts_ready_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX stripe_connected_accounts_ready_idx ON public.stripe_connected_accounts USING btree (charges_enabled, updated_at DESC);


--
-- Name: support_messages_ticket_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX support_messages_ticket_idx ON public.support_messages USING btree (ticket_id, created_at);


--
-- Name: support_tickets_customer_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX support_tickets_customer_idx ON public.support_tickets USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: support_tickets_gmail_thread_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX support_tickets_gmail_thread_idx ON public.support_tickets USING btree (gmail_thread_id) WHERE (gmail_thread_id IS NOT NULL);


--
-- Name: support_tickets_open_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX support_tickets_open_idx ON public.support_tickets USING btree (last_inbound_at DESC NULLS LAST) WHERE (status <> 'GESCHLOSSEN'::text);


--
-- Name: tax_treatment_codes_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX tax_treatment_codes_active_idx ON public.tax_treatment_codes USING btree (active) WHERE (active = true);


--
-- Name: transaction_items_applied_tax_treatment_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transaction_items_applied_tax_treatment_idx ON public.transaction_items USING btree (applied_tax_treatment_code);


--
-- Name: transaction_items_product_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transaction_items_product_id_idx ON public.transaction_items USING btree (product_id);


--
-- Name: transaction_items_transaction_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transaction_items_transaction_id_idx ON public.transaction_items USING btree (transaction_id, display_order);


--
-- Name: transaction_payments_method_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transaction_payments_method_day_idx ON public.transaction_payments USING btree (payment_method, public.berlin_business_day(created_at));


--
-- Name: transaction_payments_tradein_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transaction_payments_tradein_idx ON public.transaction_payments USING btree (trade_in_ankauf_transaction_id) WHERE (trade_in_ankauf_transaction_id IS NOT NULL);


--
-- Name: transaction_payments_transaction_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transaction_payments_transaction_id_idx ON public.transaction_payments USING btree (transaction_id);


--
-- Name: transactions_aml_flag_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_aml_flag_idx ON public.transactions USING btree (suspicious_aml_flag, finalized_at DESC) WHERE (suspicious_aml_flag = true);


--
-- Name: transactions_business_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_business_day_idx ON public.transactions USING btree (public.berlin_business_day(finalized_at));


--
-- Name: transactions_cashier_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_cashier_day_idx ON public.transactions USING btree (cashier_user_id, public.berlin_business_day(finalized_at));


--
-- Name: transactions_customer_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_customer_idx ON public.transactions USING btree (customer_id, finalized_at DESC) WHERE (customer_id IS NOT NULL);


--
-- Name: transactions_direction_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_direction_day_idx ON public.transactions USING btree (direction, public.berlin_business_day(finalized_at));


--
-- Name: transactions_idempotency_key_uniq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX transactions_idempotency_key_uniq ON public.transactions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: transactions_nachtrag_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_nachtrag_idx ON public.transactions USING btree (nachtrag_bezugstag) WHERE (nachtrag_bezugstag IS NOT NULL);


--
-- Name: transactions_one_storno_per_original_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX transactions_one_storno_per_original_uq ON public.transactions USING btree (storno_of_transaction_id) WHERE (storno_of_transaction_id IS NOT NULL);


--
-- Name: INDEX transactions_one_storno_per_original_uq; Type: COMMENT; Schema: public; Owner: warehouse14_migrator
--

COMMENT ON INDEX public.transactions_one_storno_per_original_uq IS 'Red Team Audit C-5: at most one storno row per original transaction. Partial UNIQUE — NULLs (originals) excluded. ADR-0008 §5 + GoBD.';


--
-- Name: transactions_paired_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_paired_idx ON public.transactions USING btree (paired_with_transaction_id) WHERE (paired_with_transaction_id IS NOT NULL);


--
-- Name: transactions_receipt_locator_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX transactions_receipt_locator_uq ON public.transactions USING btree (receipt_locator);


--
-- Name: transactions_returned_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_returned_idx ON public.transactions USING btree (returned_at DESC) WHERE (returned_at IS NOT NULL);


--
-- Name: transactions_sales_channel_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_sales_channel_day_idx ON public.transactions USING btree (sales_channel, public.berlin_business_day(finalized_at));


--
-- Name: transactions_shift_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_shift_idx ON public.transactions USING btree (shift_id) WHERE (shift_id IS NOT NULL);


--
-- Name: transactions_shipping_pending_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_shipping_pending_idx ON public.transactions USING btree (finalized_at DESC) WHERE ((sales_channel = 'WEB'::public.sales_channel) AND (shipping_status = ANY (ARRAY['PENDING'::public.shipping_status, 'PROCESSING'::public.shipping_status])));


--
-- Name: transactions_storno_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_storno_idx ON public.transactions USING btree (storno_of_transaction_id) WHERE (storno_of_transaction_id IS NOT NULL);


--
-- Name: transactions_tax_treatment_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX transactions_tax_treatment_idx ON public.transactions USING btree (tax_treatment_code);


--
-- Name: tse_clients_tss_id_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX tse_clients_tss_id_uq ON public.tse_clients USING btree (tss_id);


--
-- Name: tse_daily_archives_archive_date_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX tse_daily_archives_archive_date_uq ON public.tse_daily_archives USING btree (archive_date);


--
-- Name: tse_signatures_fiskaly_tx_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX tse_signatures_fiskaly_tx_uq ON public.tse_signatures USING btree (fiskaly_transaction_id) WHERE (fiskaly_transaction_id IS NOT NULL);


--
-- Name: tse_signatures_recorded_business_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX tse_signatures_recorded_business_day_idx ON public.tse_signatures USING btree (public.berlin_business_day(recorded_at));


--
-- Name: tse_signatures_signature_counter_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX tse_signatures_signature_counter_uq ON public.tse_signatures USING btree (fiskaly_tss_id, signature_counter);


--
-- Name: tse_signatures_tx_number_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX tse_signatures_tx_number_uq ON public.tse_signatures USING btree (fiskaly_tss_id, fiskaly_transaction_number);


--
-- Name: tse_transactions_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX tse_transactions_active_idx ON public.tse_transactions USING btree (updated_at) WHERE (state = 'ACTIVE'::public.tse_state);


--
-- Name: tse_transactions_failed_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX tse_transactions_failed_idx ON public.tse_transactions USING btree (last_error_at DESC) WHERE (state = 'FAILED'::public.tse_state);


--
-- Name: tse_transactions_finished_business_day_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX tse_transactions_finished_business_day_idx ON public.tse_transactions USING btree (public.berlin_business_day(signed_at)) WHERE (state = 'FINISHED'::public.tse_state);


--
-- Name: tse_transactions_fiskaly_tx_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX tse_transactions_fiskaly_tx_uq ON public.tse_transactions USING btree (fiskaly_transaction_id) WHERE (fiskaly_transaction_id IS NOT NULL);


--
-- Name: tse_transactions_queued_offline_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX tse_transactions_queued_offline_idx ON public.tse_transactions USING btree (created_at) WHERE (state = 'QUEUED_OFFLINE'::public.tse_state);


--
-- Name: tse_transactions_signature_counter_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX tse_transactions_signature_counter_uq ON public.tse_transactions USING btree (fiskaly_tss_id, signature_counter) WHERE (signature_counter IS NOT NULL);


--
-- Name: users_email_active_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX users_email_active_uq ON public.users USING btree (email) WHERE (soft_deleted_at IS NULL);


--
-- Name: users_only_one_owner_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX users_only_one_owner_uq ON public.users USING btree (is_owner) WHERE (is_owner = true);


--
-- Name: users_pos_pin_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX users_pos_pin_active_idx ON public.users USING btree (id) WHERE ((pos_pin_hash IS NOT NULL) AND (soft_deleted_at IS NULL));


--
-- Name: users_pos_pin_locked_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX users_pos_pin_locked_idx ON public.users USING btree (pos_pin_locked_until) WHERE (pos_pin_locked_until IS NOT NULL);


--
-- Name: users_role_active_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX users_role_active_idx ON public.users USING btree (role) WHERE (soft_deleted_at IS NULL);


--
-- Name: users_shop_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX users_shop_id_idx ON public.users USING btree (shop_id) WHERE (shop_id IS NOT NULL);


--
-- Name: verifications_expires_at_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX verifications_expires_at_idx ON public.verifications USING btree (expires_at);


--
-- Name: verifications_identifier_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX verifications_identifier_idx ON public.verifications USING btree (identifier);


--
-- Name: voucher_redemptions_tx_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX voucher_redemptions_tx_idx ON public.voucher_redemptions USING btree (transaction_id);


--
-- Name: voucher_redemptions_voucher_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX voucher_redemptions_voucher_idx ON public.voucher_redemptions USING btree (voucher_id, redeemed_at);


--
-- Name: vouchers_customer_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX vouchers_customer_idx ON public.vouchers USING btree (issued_to_customer_id) WHERE (issued_to_customer_id IS NOT NULL);


--
-- Name: vouchers_status_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX vouchers_status_idx ON public.vouchers USING btree (status, expires_at);


--
-- Name: webhook_events_provider_event_uq; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE UNIQUE INDEX webhook_events_provider_event_uq ON public.webhook_events USING btree (provider, provider_event_id);


--
-- Name: webhook_events_unprocessed_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX webhook_events_unprocessed_idx ON public.webhook_events USING btree (provider, received_at DESC) WHERE (processed_at IS NULL);


--
-- Name: worker_job_dlq_acked_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX worker_job_dlq_acked_idx ON public.worker_job_dlq USING btree (acked_at DESC) WHERE (acked_at IS NOT NULL);


--
-- Name: worker_job_dlq_last_run_id_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX worker_job_dlq_last_run_id_idx ON public.worker_job_dlq USING btree (last_run_id) WHERE (last_run_id IS NOT NULL);


--
-- Name: worker_job_dlq_unacked_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX worker_job_dlq_unacked_idx ON public.worker_job_dlq USING btree (job_name, pushed_at DESC) WHERE (acked_at IS NULL);


--
-- Name: worker_job_runs_job_status_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX worker_job_runs_job_status_idx ON public.worker_job_runs USING btree (job_name, status, started_at DESC);


--
-- Name: worker_job_runs_last_success_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX worker_job_runs_last_success_idx ON public.worker_job_runs USING btree (job_name, started_at DESC) WHERE (status = 'SUCCESS'::public.worker_job_status);


--
-- Name: worker_job_runs_retention_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX worker_job_runs_retention_idx ON public.worker_job_runs USING btree (status, started_at);


--
-- Name: worker_job_runs_running_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX worker_job_runs_running_idx ON public.worker_job_runs USING btree (job_name, started_at) WHERE (status = 'RUNNING'::public.worker_job_status);


--
-- Name: worker_job_runs_started_at_idx; Type: INDEX; Schema: public; Owner: warehouse14_migrator
--

CREATE INDEX worker_job_runs_started_at_idx ON public.worker_job_runs USING btree (started_at);


--
-- Name: carts carts_assign_order_number; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER carts_assign_order_number BEFORE INSERT OR UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION public.assign_order_number();


--
-- Name: products enforce_ebay_sold_reserves_locally_trg; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER enforce_ebay_sold_reserves_locally_trg BEFORE UPDATE OF ebay_state ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_ebay_sold_reserves_locally();


--
-- Name: fixed_costs fixed_costs_set_updated_at_trg; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER fixed_costs_set_updated_at_trg BEFORE UPDATE ON public.fixed_costs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: internal_tasks internal_tasks_set_updated_at_trg; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER internal_tasks_set_updated_at_trg BEFORE UPDATE ON public.internal_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: operating_expenses operating_expenses_set_updated_at_trg; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER operating_expenses_set_updated_at_trg BEFORE UPDATE ON public.operating_expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tse_clients set_tse_clients_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER set_tse_clients_updated_at BEFORE UPDATE ON public.tse_clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tse_daily_archives set_tse_daily_archives_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER set_tse_daily_archives_updated_at BEFORE UPDATE ON public.tse_daily_archives FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accounts trg_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: appointments trg_appointments_after_insert; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_appointments_after_insert AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.on_appointment_state_event();


--
-- Name: appointments trg_appointments_after_update; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_appointments_after_update AFTER UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.on_appointment_state_event();


--
-- Name: appointments trg_appointments_ends_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_appointments_ends_at BEFORE INSERT OR UPDATE OF starts_at, duration_minutes ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_compute_ends_at();


--
-- Name: appointments trg_appointments_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: appointments trg_appointments_validate_transition; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_appointments_validate_transition BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_validate_transition();


--
-- Name: appraisal_items trg_appraisal_items_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_appraisal_items_updated_at BEFORE UPDATE ON public.appraisal_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: appraisals trg_appraisals_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_appraisals_updated_at BEFORE UPDATE ON public.appraisals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: business_locations trg_business_locations_touch_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_business_locations_touch_updated_at BEFORE UPDATE ON public.business_locations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: carts trg_carts_after_reserve; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_carts_after_reserve AFTER UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION public.on_cart_reserved();


--
-- Name: carts trg_carts_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_carts_updated_at BEFORE UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: categories trg_categories_touch_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_categories_touch_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: appointment_linked_products trg_create_viewing_hold; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_create_viewing_hold AFTER INSERT ON public.appointment_linked_products FOR EACH ROW EXECUTE FUNCTION public.create_viewing_hold_on_link();


--
-- Name: customers trg_customers_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: daily_closings trg_daily_closings_after_insert; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_daily_closings_after_insert AFTER INSERT ON public.daily_closings FOR EACH ROW EXECUTE FUNCTION public.on_daily_closing_event();


--
-- Name: daily_closings trg_daily_closings_after_update; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_daily_closings_after_update AFTER UPDATE OF state ON public.daily_closings FOR EACH ROW EXECUTE FUNCTION public.on_daily_closing_event();


--
-- Name: daily_closings trg_daily_closings_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_daily_closings_updated_at BEFORE UPDATE ON public.daily_closings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: daily_closings trg_daily_closings_validate_state; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_daily_closings_validate_state BEFORE UPDATE ON public.daily_closings FOR EACH ROW EXECUTE FUNCTION public.daily_closings_validate_state();


--
-- Name: devices trg_devices_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_devices_updated_at BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: dsfinvk_exports trg_dsfinvk_exports_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_dsfinvk_exports_updated_at BEFORE UPDATE ON public.dsfinvk_exports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: categories trg_enforce_no_grandparent_category; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_enforce_no_grandparent_category BEFORE INSERT OR UPDATE OF parent_id ON public.categories FOR EACH ROW EXECUTE FUNCTION public.enforce_no_grandparent_category();


--
-- Name: hallmarks trg_hallmarks_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_hallmarks_updated_at BEFORE UPDATE ON public.hallmarks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: inventory_sessions trg_inventory_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_inventory_sessions_updated_at BEFORE UPDATE ON public.inventory_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: karat_grades trg_karat_grades_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_karat_grades_updated_at BEFORE UPDATE ON public.karat_grades FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: kyc_documents trg_kyc_documents_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_kyc_documents_updated_at BEFORE UPDATE ON public.kyc_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ledger_events trg_ledger_compute_hash; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_ledger_compute_hash BEFORE INSERT ON public.ledger_events FOR EACH ROW EXECUTE FUNCTION public.ledger_compute_hash();


--
-- Name: ledger_events trg_ledger_events_notify; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_ledger_events_notify AFTER INSERT ON public.ledger_events FOR EACH ROW EXECUTE FUNCTION public.ledger_events_notify();


--
-- Name: payment_intents trg_payment_intents_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_payment_intents_updated_at BEFORE UPDATE ON public.payment_intents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_photos trg_product_photos_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_product_photos_updated_at BEFORE UPDATE ON public.product_photos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products trg_products_no_deep_nesting; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_products_no_deep_nesting BEFORE INSERT OR UPDATE OF parent_product_id ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_no_grandparent();


--
-- Name: products trg_products_publish_to_web; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_products_publish_to_web BEFORE UPDATE ON public.products FOR EACH ROW WHEN ((new.is_published_to_web IS DISTINCT FROM old.is_published_to_web)) EXECUTE FUNCTION public.on_products_publish_to_web();


--
-- Name: products trg_products_slug_autogen; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_products_slug_autogen BEFORE INSERT OR UPDATE OF is_published_to_web, status, slug, name ON public.products FOR EACH ROW EXECUTE FUNCTION public.on_products_autogen_slug();


--
-- Name: products trg_products_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: appointments trg_release_holds_on_terminal_appointment; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_release_holds_on_terminal_appointment AFTER UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.release_holds_on_terminal_appointment();


--
-- Name: sessions trg_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: shifts trg_shifts_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: shopper_sessions trg_shopper_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_shopper_sessions_updated_at BEFORE UPDATE ON public.shopper_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: shoppers trg_shoppers_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_shoppers_updated_at BEFORE UPDATE ON public.shoppers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: system_settings trg_system_settings_audit; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_system_settings_audit AFTER INSERT OR UPDATE OF value ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.on_system_setting_event();


--
-- Name: system_settings trg_system_settings_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_system_settings_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tax_treatment_codes trg_tax_treatment_codes_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_tax_treatment_codes_updated_at BEFORE UPDATE ON public.tax_treatment_codes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: transaction_payments trg_transaction_payments_accumulate_debt; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transaction_payments_accumulate_debt AFTER INSERT ON public.transaction_payments FOR EACH ROW EXECUTE FUNCTION public.transaction_payments_accumulate_debt();


--
-- Name: transaction_payments trg_transaction_payments_debt_guard; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transaction_payments_debt_guard BEFORE INSERT ON public.transaction_payments FOR EACH ROW EXECUTE FUNCTION public.transaction_payments_debt_requires_customer();


--
-- Name: transaction_payments trg_transaction_payments_validate_cash_kyc; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transaction_payments_validate_cash_kyc BEFORE INSERT ON public.transaction_payments FOR EACH ROW EXECUTE FUNCTION public.transaction_payments_validate_cash_kyc();


--
-- Name: transactions trg_transactions_after_insert; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transactions_after_insert AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.on_transaction_finalized();


--
-- Name: transactions trg_transactions_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: transactions trg_transactions_validate_closing_day; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transactions_validate_closing_day BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.transactions_validate_closing_day();


--
-- Name: transactions trg_transactions_validate_kyc; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transactions_validate_kyc BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.transactions_validate_kyc();


--
-- Name: transactions trg_transactions_validate_sanctions; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transactions_validate_sanctions BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.transactions_validate_sanctions();


--
-- Name: transactions trg_transactions_validate_storno; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transactions_validate_storno BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.transactions_validate_storno();


--
-- Name: transactions trg_transactions_validate_trust_level; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_transactions_validate_trust_level BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.transactions_validate_trust_level();


--
-- Name: tse_transactions trg_tse_after_insert; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_tse_after_insert AFTER INSERT ON public.tse_transactions FOR EACH ROW EXECUTE FUNCTION public.on_tse_state_event();


--
-- Name: tse_transactions trg_tse_after_update; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_tse_after_update AFTER UPDATE OF state ON public.tse_transactions FOR EACH ROW EXECUTE FUNCTION public.on_tse_state_event();


--
-- Name: tse_signatures trg_tse_signatures_after_insert; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_tse_signatures_after_insert AFTER INSERT ON public.tse_signatures FOR EACH ROW EXECUTE FUNCTION public.on_tse_signature_recorded();


--
-- Name: tse_signatures trg_tse_signatures_immutable_delete; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_tse_signatures_immutable_delete BEFORE DELETE ON public.tse_signatures FOR EACH ROW EXECUTE FUNCTION public.tse_signatures_immutable();


--
-- Name: tse_signatures trg_tse_signatures_immutable_update; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_tse_signatures_immutable_update BEFORE UPDATE ON public.tse_signatures FOR EACH ROW EXECUTE FUNCTION public.tse_signatures_immutable();


--
-- Name: tse_signatures trg_tse_signatures_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_tse_signatures_updated_at BEFORE UPDATE ON public.tse_signatures FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tse_transactions trg_tse_transactions_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_tse_transactions_updated_at BEFORE UPDATE ON public.tse_transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tse_transactions trg_tse_validate_transition; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_tse_validate_transition BEFORE UPDATE ON public.tse_transactions FOR EACH ROW EXECUTE FUNCTION public.tse_validate_transition();


--
-- Name: two_factors trg_two_factors_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_two_factors_updated_at BEFORE UPDATE ON public.two_factors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: verifications trg_verifications_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_verifications_updated_at BEFORE UPDATE ON public.verifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: transaction_items trg_verify_transaction_balance_items; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE CONSTRAINT TRIGGER trg_verify_transaction_balance_items AFTER INSERT ON public.transaction_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.verify_transaction_balance();


--
-- Name: transaction_payments trg_verify_transaction_balance_payments; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE CONSTRAINT TRIGGER trg_verify_transaction_balance_payments AFTER INSERT ON public.transaction_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.verify_transaction_balance();


--
-- Name: transactions trg_verify_transaction_balance_tx; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE CONSTRAINT TRIGGER trg_verify_transaction_balance_tx AFTER INSERT ON public.transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.verify_transaction_balance();


--
-- Name: vouchers trg_vouchers_updated_at; Type: TRIGGER; Schema: public; Owner: warehouse14_migrator
--

CREATE TRIGGER trg_vouchers_updated_at BEFORE UPDATE ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: api_keys api_keys_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: api_keys api_keys_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id);


--
-- Name: appointment_linked_products appointment_linked_products_added_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointment_linked_products
    ADD CONSTRAINT appointment_linked_products_added_by_user_id_fkey FOREIGN KEY (added_by_user_id) REFERENCES public.users(id);


--
-- Name: appointment_linked_products appointment_linked_products_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointment_linked_products
    ADD CONSTRAINT appointment_linked_products_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: appointment_linked_products appointment_linked_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointment_linked_products
    ADD CONSTRAINT appointment_linked_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: appointment_notifications appointment_notifications_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointment_notifications
    ADD CONSTRAINT appointment_notifications_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: appointments appointments_booked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_booked_by_user_id_fkey FOREIGN KEY (booked_by_user_id) REFERENCES public.users(id);


--
-- Name: appointments appointments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: appointments appointments_linked_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_linked_transaction_id_fkey FOREIGN KEY (linked_transaction_id) REFERENCES public.transactions(id);


--
-- Name: appointments appointments_rescheduled_from_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_rescheduled_from_appointment_id_fkey FOREIGN KEY (rescheduled_from_appointment_id) REFERENCES public.appointments(id);


--
-- Name: appointments appointments_rescheduled_to_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_rescheduled_to_appointment_id_fkey FOREIGN KEY (rescheduled_to_appointment_id) REFERENCES public.appointments(id);


--
-- Name: appointments appointments_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_staff_user_id_fkey FOREIGN KEY (staff_user_id) REFERENCES public.users(id);


--
-- Name: appraisal_items appraisal_items_appraisal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appraisal_items
    ADD CONSTRAINT appraisal_items_appraisal_id_fkey FOREIGN KEY (appraisal_id) REFERENCES public.appraisals(id);


--
-- Name: appraisal_items appraisal_items_karat_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appraisal_items
    ADD CONSTRAINT appraisal_items_karat_code_fkey FOREIGN KEY (karat_code) REFERENCES public.karat_grades(code);


--
-- Name: appraisal_items appraisal_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appraisal_items
    ADD CONSTRAINT appraisal_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: appraisals appraisals_ankauf_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appraisals
    ADD CONSTRAINT appraisals_ankauf_transaction_id_fkey FOREIGN KEY (ankauf_transaction_id) REFERENCES public.transactions(id);


--
-- Name: appraisals appraisals_appraised_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appraisals
    ADD CONSTRAINT appraisals_appraised_by_user_id_fkey FOREIGN KEY (appraised_by_user_id) REFERENCES public.users(id);


--
-- Name: appraisals appraisals_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.appraisals
    ADD CONSTRAINT appraisals_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: audit_log audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: beleg_logo beleg_logo_hochgeladen_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.beleg_logo
    ADD CONSTRAINT beleg_logo_hochgeladen_von_fkey FOREIGN KEY (hochgeladen_von) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: belegtext_templates belegtext_templates_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.belegtext_templates
    ADD CONSTRAINT belegtext_templates_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: cart_items cart_items_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.carts(id);


--
-- Name: cart_items cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: carts carts_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.users(id);


--
-- Name: carts carts_cancelled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES public.users(id);


--
-- Name: carts carts_collected_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_collected_by_user_id_fkey FOREIGN KEY (collected_by_user_id) REFERENCES public.users(id);


--
-- Name: carts carts_converted_to_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_converted_to_transaction_id_fkey FOREIGN KEY (converted_to_transaction_id) REFERENCES public.transactions(id);


--
-- Name: carts carts_shipping_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_shipping_rate_id_fkey FOREIGN KEY (shipping_rate_id) REFERENCES public.shipping_rates(id) ON DELETE SET NULL;


--
-- Name: carts carts_shopper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_shopper_id_fkey FOREIGN KEY (shopper_id) REFERENCES public.shoppers(id);


--
-- Name: cash_movements cash_movements_performed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_performed_by_user_id_fkey FOREIGN KEY (performed_by_user_id) REFERENCES public.users(id);


--
-- Name: cash_movements cash_movements_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: cash_movements cash_movements_witness_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_witness_user_id_fkey FOREIGN KEY (witness_user_id) REFERENCES public.users(id);


--
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE RESTRICT;


--
-- Name: category_translations category_translations_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.category_translations
    ADD CONSTRAINT category_translations_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: customer_broadcasts customer_broadcasts_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.customer_broadcasts
    ADD CONSTRAINT customer_broadcasts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customers customers_kyc_verified_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_kyc_verified_by_user_id_fkey FOREIGN KEY (kyc_verified_by_user_id) REFERENCES public.users(id);


--
-- Name: daily_closings daily_closings_counted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.daily_closings
    ADD CONSTRAINT daily_closings_counted_by_user_id_fkey FOREIGN KEY (counted_by_user_id) REFERENCES public.users(id);


--
-- Name: daily_closings daily_closings_finalized_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.daily_closings
    ADD CONSTRAINT daily_closings_finalized_by_user_id_fkey FOREIGN KEY (finalized_by_user_id) REFERENCES public.users(id);


--
-- Name: daily_closings daily_closings_ledger_anchor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.daily_closings
    ADD CONSTRAINT daily_closings_ledger_anchor_id_fkey FOREIGN KEY (ledger_anchor_id) REFERENCES public.ledger_events(id);


--
-- Name: device_push_tokens device_push_tokens_shopper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_shopper_id_fkey FOREIGN KEY (shopper_id) REFERENCES public.shoppers(id) ON DELETE CASCADE;


--
-- Name: device_push_tokens device_push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: devices devices_paired_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_paired_by_user_id_fkey FOREIGN KEY (paired_by_user_id) REFERENCES public.users(id);


--
-- Name: document_attachments document_attachments_appraisal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.document_attachments
    ADD CONSTRAINT document_attachments_appraisal_id_fkey FOREIGN KEY (appraisal_id) REFERENCES public.appraisals(id);


--
-- Name: document_attachments document_attachments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.document_attachments
    ADD CONSTRAINT document_attachments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: document_attachments document_attachments_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.document_attachments
    ADD CONSTRAINT document_attachments_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: document_attachments document_attachments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.document_attachments
    ADD CONSTRAINT document_attachments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: document_attachments document_attachments_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.document_attachments
    ADD CONSTRAINT document_attachments_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id);


--
-- Name: dsfinvk_exports dsfinvk_exports_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.dsfinvk_exports
    ADD CONSTRAINT dsfinvk_exports_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: email_outbox email_outbox_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: internal_tasks internal_tasks_assigned_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.internal_tasks
    ADD CONSTRAINT internal_tasks_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES public.users(id);


--
-- Name: internal_tasks internal_tasks_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.internal_tasks
    ADD CONSTRAINT internal_tasks_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: inventory_scans inventory_scans_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.inventory_scans
    ADD CONSTRAINT inventory_scans_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: inventory_scans inventory_scans_scanned_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.inventory_scans
    ADD CONSTRAINT inventory_scans_scanned_by_user_id_fkey FOREIGN KEY (scanned_by_user_id) REFERENCES public.users(id);


--
-- Name: inventory_scans inventory_scans_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.inventory_scans
    ADD CONSTRAINT inventory_scans_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.inventory_sessions(id);


--
-- Name: inventory_sessions inventory_sessions_closed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.inventory_sessions
    ADD CONSTRAINT inventory_sessions_closed_by_user_id_fkey FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id);


--
-- Name: inventory_sessions inventory_sessions_opened_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.inventory_sessions
    ADD CONSTRAINT inventory_sessions_opened_by_user_id_fkey FOREIGN KEY (opened_by_user_id) REFERENCES public.users(id);


--
-- Name: kartenleser kartenleser_registriert_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.kartenleser
    ADD CONSTRAINT kartenleser_registriert_von_fkey FOREIGN KEY (registriert_von) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kyc_documents kyc_documents_captured_at_terminal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_captured_at_terminal_id_fkey FOREIGN KEY (captured_at_terminal_id) REFERENCES public.devices(id);


--
-- Name: kyc_documents kyc_documents_captured_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_captured_by_user_id_fkey FOREIGN KEY (captured_by_user_id) REFERENCES public.users(id);


--
-- Name: kyc_documents kyc_documents_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: kyc_documents kyc_documents_purged_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_purged_by_user_id_fkey FOREIGN KEY (purged_by_user_id) REFERENCES public.users(id);


--
-- Name: kyc_documents kyc_documents_verified_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES public.users(id);


--
-- Name: ledger_events ledger_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.ledger_events
    ADD CONSTRAINT ledger_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: ledger_events ledger_events_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.ledger_events
    ADD CONSTRAINT ledger_events_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: leser_zahlungen leser_zahlungen_angelegt_von_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.leser_zahlungen
    ADD CONSTRAINT leser_zahlungen_angelegt_von_fkey FOREIGN KEY (angelegt_von) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leser_zahlungen leser_zahlungen_leser_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.leser_zahlungen
    ADD CONSTRAINT leser_zahlungen_leser_id_fkey FOREIGN KEY (leser_id) REFERENCES public.kartenleser(id) ON DELETE SET NULL;


--
-- Name: metal_prices metal_prices_fetched_by_job_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.metal_prices
    ADD CONSTRAINT metal_prices_fetched_by_job_run_id_fkey FOREIGN KEY (fetched_by_job_run_id) REFERENCES public.worker_job_runs(id) ON DELETE SET NULL;


--
-- Name: metal_prices metal_prices_manual_override_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.metal_prices
    ADD CONSTRAINT metal_prices_manual_override_by_user_id_fkey FOREIGN KEY (manual_override_by_user_id) REFERENCES public.users(id);


--
-- Name: operating_expenses operating_expenses_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.operating_expenses
    ADD CONSTRAINT operating_expenses_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: payment_intents payment_intents_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.carts(id);


--
-- Name: product_categories product_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE RESTRICT;


--
-- Name: product_categories product_categories_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_ebay_listing_events product_ebay_listing_events_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_ebay_listing_events
    ADD CONSTRAINT product_ebay_listing_events_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id);


--
-- Name: product_ebay_listing_events product_ebay_listing_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_ebay_listing_events
    ADD CONSTRAINT product_ebay_listing_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: product_photo_workflow_events product_photo_workflow_events_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_photo_workflow_events
    ADD CONSTRAINT product_photo_workflow_events_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id);


--
-- Name: product_photo_workflow_events product_photo_workflow_events_product_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_photo_workflow_events
    ADD CONSTRAINT product_photo_workflow_events_product_photo_id_fkey FOREIGN KEY (product_photo_id) REFERENCES public.product_photos(id);


--
-- Name: product_photos product_photos_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_photos
    ADD CONSTRAINT product_photos_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: product_photos product_photos_workflow_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_photos
    ADD CONSTRAINT product_photos_workflow_changed_by_user_id_fkey FOREIGN KEY (workflow_changed_by_user_id) REFERENCES public.users(id);


--
-- Name: product_translations product_translations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14
--

ALTER TABLE ONLY public.product_translations
    ADD CONSTRAINT product_translations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_viewing_holds product_viewing_holds_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_viewing_holds
    ADD CONSTRAINT product_viewing_holds_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: product_viewing_holds product_viewing_holds_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_viewing_holds
    ADD CONSTRAINT product_viewing_holds_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: product_viewing_holds product_viewing_holds_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.product_viewing_holds
    ADD CONSTRAINT product_viewing_holds_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: products products_acquired_from_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_acquired_from_customer_id_fkey FOREIGN KEY (acquired_from_customer_id) REFERENCES public.customers(id);


--
-- Name: products products_ankauf_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_ankauf_customer_id_fkey FOREIGN KEY (ankauf_customer_id) REFERENCES public.customers(id);


--
-- Name: products products_karat_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_karat_code_fkey FOREIGN KEY (karat_code) REFERENCES public.karat_grades(code);


--
-- Name: products products_parent_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_parent_product_id_fkey FOREIGN KEY (parent_product_id) REFERENCES public.products(id);


--
-- Name: products products_reserved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_reserved_by_user_id_fkey FOREIGN KEY (reserved_by_user_id) REFERENCES public.users(id);


--
-- Name: products products_tax_treatment_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tax_treatment_code_fkey FOREIGN KEY (tax_treatment_code) REFERENCES public.tax_treatment_codes(code);


--
-- Name: push_outbox push_outbox_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.push_outbox
    ADD CONSTRAINT push_outbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: shifts shifts_closed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_closed_by_user_id_fkey FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id);


--
-- Name: shifts shifts_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: shifts shifts_opened_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_opened_by_user_id_fkey FOREIGN KEY (opened_by_user_id) REFERENCES public.users(id);


--
-- Name: shipments shipments_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.carts(id) ON DELETE SET NULL;


--
-- Name: shipments shipments_label_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_label_attachment_id_fkey FOREIGN KEY (label_attachment_id) REFERENCES public.document_attachments(id) ON DELETE SET NULL;


--
-- Name: shipments shipments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: shipping_rates shipping_rates_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shipping_rates
    ADD CONSTRAINT shipping_rates_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.shipping_zones(id) ON DELETE CASCADE;


--
-- Name: shopper_sessions shopper_sessions_shopper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shopper_sessions
    ADD CONSTRAINT shopper_sessions_shopper_id_fkey FOREIGN KEY (shopper_id) REFERENCES public.shoppers(id);


--
-- Name: shoppers shoppers_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.shoppers
    ADD CONSTRAINT shoppers_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: staff_time_off staff_time_off_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.staff_time_off
    ADD CONSTRAINT staff_time_off_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: staff_time_off staff_time_off_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.staff_time_off
    ADD CONSTRAINT staff_time_off_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: staff_working_hours staff_working_hours_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.staff_working_hours
    ADD CONSTRAINT staff_working_hours_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: support_messages support_messages_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_messages support_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_assigned_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: system_settings system_settings_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id);


--
-- Name: transaction_items transaction_items_applied_tax_treatment_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_applied_tax_treatment_code_fkey FOREIGN KEY (applied_tax_treatment_code) REFERENCES public.tax_treatment_codes(code);


--
-- Name: transaction_items transaction_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: transaction_items transaction_items_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: transaction_payments transaction_payments_trade_in_ankauf_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_trade_in_ankauf_transaction_id_fkey FOREIGN KEY (trade_in_ankauf_transaction_id) REFERENCES public.transactions(id);


--
-- Name: transaction_payments transaction_payments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: transactions transactions_cashier_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_cashier_user_id_fkey FOREIGN KEY (cashier_user_id) REFERENCES public.users(id);


--
-- Name: transactions transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: transactions transactions_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: transactions transactions_paired_with_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_paired_with_transaction_id_fkey FOREIGN KEY (paired_with_transaction_id) REFERENCES public.transactions(id);


--
-- Name: transactions transactions_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: transactions transactions_storno_of_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_storno_of_transaction_id_fkey FOREIGN KEY (storno_of_transaction_id) REFERENCES public.transactions(id);


--
-- Name: transactions transactions_suspicious_flagged_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_suspicious_flagged_by_user_id_fkey FOREIGN KEY (suspicious_flagged_by_user_id) REFERENCES public.users(id);


--
-- Name: transactions transactions_tax_treatment_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_tax_treatment_code_fkey FOREIGN KEY (tax_treatment_code) REFERENCES public.tax_treatment_codes(code);


--
-- Name: tse_signatures tse_signatures_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.tse_signatures
    ADD CONSTRAINT tse_signatures_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: tse_transactions tse_transactions_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.tse_transactions
    ADD CONSTRAINT tse_transactions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: two_factors two_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.two_factors
    ADD CONSTRAINT two_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: voucher_redemptions voucher_redemptions_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: voucher_redemptions voucher_redemptions_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES public.vouchers(id);


--
-- Name: vouchers vouchers_issuance_tax_treatment_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_issuance_tax_treatment_code_fkey FOREIGN KEY (issuance_tax_treatment_code) REFERENCES public.tax_treatment_codes(code);


--
-- Name: vouchers vouchers_issued_by_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_issued_by_transaction_id_fkey FOREIGN KEY (issued_by_transaction_id) REFERENCES public.transactions(id);


--
-- Name: vouchers vouchers_issued_to_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_issued_to_customer_id_fkey FOREIGN KEY (issued_to_customer_id) REFERENCES public.customers(id);


--
-- Name: worker_job_dlq worker_job_dlq_acked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.worker_job_dlq
    ADD CONSTRAINT worker_job_dlq_acked_by_user_id_fkey FOREIGN KEY (acked_by_user_id) REFERENCES public.users(id);


--
-- Name: worker_job_dlq worker_job_dlq_last_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: warehouse14_migrator
--

ALTER TABLE ONLY public.worker_job_dlq
    ADD CONSTRAINT worker_job_dlq_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES public.worker_job_runs(id) ON DELETE SET NULL;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT ALL ON SCHEMA public TO warehouse14_migrator;
GRANT ALL ON SCHEMA public TO warehouse14_security;
GRANT ALL ON SCHEMA public TO warehouse14_app;
GRANT USAGE ON SCHEMA public TO warehouse14_worker;


--
-- Name: FUNCTION appointments_compute_ends_at(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.appointments_compute_ends_at() TO warehouse14_app;


--
-- Name: FUNCTION appointments_validate_transition(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.appointments_validate_transition() TO warehouse14_app;


--
-- Name: FUNCTION available_slots(p_appt_type public.appointment_type, p_duration_minutes integer, p_search_from timestamp with time zone, p_search_to timestamp with time zone, p_preferred_staff_id uuid, p_shop_id uuid); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.available_slots(p_appt_type public.appointment_type, p_duration_minutes integer, p_search_from timestamp with time zone, p_search_to timestamp with time zone, p_preferred_staff_id uuid, p_shop_id uuid) TO warehouse14_app;


--
-- Name: FUNCTION berlin_business_day(ts timestamp with time zone); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.berlin_business_day(ts timestamp with time zone) TO warehouse14_app;
GRANT ALL ON FUNCTION public.berlin_business_day(ts timestamp with time zone) TO warehouse14_security;


--
-- Name: FUNCTION blind_index(plaintext text); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.blind_index(plaintext text) TO warehouse14_app;


--
-- Name: FUNCTION create_viewing_hold_on_link(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.create_viewing_hold_on_link() TO warehouse14_app;


--
-- Name: FUNCTION current_metal_price_eur_per_gram(p_metal text); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.current_metal_price_eur_per_gram(p_metal text) TO warehouse14_app;
GRANT ALL ON FUNCTION public.current_metal_price_eur_per_gram(p_metal text) TO warehouse14_worker;


--
-- Name: FUNCTION daily_closings_validate_state(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.daily_closings_validate_state() TO warehouse14_app;


--
-- Name: FUNCTION decrypt_pii(ciphertext bytea); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.decrypt_pii(ciphertext bytea) TO warehouse14_app;


--
-- Name: FUNCTION encrypt_pii(plaintext text); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.encrypt_pii(plaintext text) TO warehouse14_app;


--
-- Name: FUNCTION enforce_ebay_sold_reserves_locally(); Type: ACL; Schema: public; Owner: warehouse14_security
--

REVOKE ALL ON FUNCTION public.enforce_ebay_sold_reserves_locally() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_ebay_sold_reserves_locally() TO warehouse14_app;
GRANT ALL ON FUNCTION public.enforce_ebay_sold_reserves_locally() TO warehouse14_worker;


--
-- Name: FUNCTION enforce_no_grandparent(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.enforce_no_grandparent() TO warehouse14_app;
GRANT ALL ON FUNCTION public.enforce_no_grandparent() TO warehouse14_worker;


--
-- Name: FUNCTION enforce_no_grandparent_category(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.enforce_no_grandparent_category() TO warehouse14_app;
GRANT ALL ON FUNCTION public.enforce_no_grandparent_category() TO warehouse14_worker;


--
-- Name: FUNCTION erase_customer(p_customer_id uuid, p_actor uuid); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

REVOKE ALL ON FUNCTION public.erase_customer(p_customer_id uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.erase_customer(p_customer_id uuid, p_actor uuid) TO warehouse14_app;
GRANT ALL ON FUNCTION public.erase_customer(p_customer_id uuid, p_actor uuid) TO warehouse14_worker;


--
-- Name: FUNCTION ledger_compute_hash(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.ledger_compute_hash() TO warehouse14_app;


--
-- Name: FUNCTION ledger_events_notify(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.ledger_events_notify() TO warehouse14_app;


--
-- Name: FUNCTION metal_price_avg_eur_per_gram(p_metal text, p_days integer); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.metal_price_avg_eur_per_gram(p_metal text, p_days integer) TO warehouse14_app;
GRANT ALL ON FUNCTION public.metal_price_avg_eur_per_gram(p_metal text, p_days integer) TO warehouse14_worker;


--
-- Name: FUNCTION on_appointment_state_event(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.on_appointment_state_event() TO warehouse14_app;


--
-- Name: FUNCTION on_cart_reserved(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.on_cart_reserved() TO warehouse14_app;
GRANT ALL ON FUNCTION public.on_cart_reserved() TO warehouse14_worker;


--
-- Name: FUNCTION on_daily_closing_event(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.on_daily_closing_event() TO warehouse14_app;


--
-- Name: FUNCTION on_products_autogen_slug(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.on_products_autogen_slug() TO warehouse14_app;
GRANT ALL ON FUNCTION public.on_products_autogen_slug() TO warehouse14_worker;


--
-- Name: FUNCTION on_products_publish_to_web(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.on_products_publish_to_web() TO warehouse14_app;
GRANT ALL ON FUNCTION public.on_products_publish_to_web() TO warehouse14_worker;


--
-- Name: FUNCTION on_system_setting_event(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.on_system_setting_event() TO warehouse14_app;


--
-- Name: FUNCTION on_transaction_finalized(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.on_transaction_finalized() TO warehouse14_app;


--
-- Name: FUNCTION on_tse_signature_recorded(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.on_tse_signature_recorded() TO warehouse14_app;
GRANT ALL ON FUNCTION public.on_tse_signature_recorded() TO warehouse14_worker;


--
-- Name: FUNCTION on_tse_state_event(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.on_tse_state_event() TO warehouse14_app;


--
-- Name: FUNCTION product_schmelzwert_eur(p_product_id uuid); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.product_schmelzwert_eur(p_product_id uuid) TO warehouse14_app;
GRANT ALL ON FUNCTION public.product_schmelzwert_eur(p_product_id uuid) TO warehouse14_worker;


--
-- Name: FUNCTION provision_staff(p_email public.citext, p_name text, p_role public.user_role); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.provision_staff(p_email public.citext, p_name text, p_role public.user_role) TO warehouse14_app;
GRANT ALL ON FUNCTION public.provision_staff(p_email public.citext, p_name text, p_role public.user_role) TO warehouse14_worker;


--
-- Name: FUNCTION release_holds_on_terminal_appointment(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.release_holds_on_terminal_appointment() TO warehouse14_app;


--
-- Name: FUNCTION resolve_belegtext_for_tax_treatment(p_code text, p_language text); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.resolve_belegtext_for_tax_treatment(p_code text, p_language text) TO warehouse14_app;
GRANT ALL ON FUNCTION public.resolve_belegtext_for_tax_treatment(p_code text, p_language text) TO warehouse14_worker;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.set_updated_at() TO warehouse14_app;


--
-- Name: FUNCTION slugify(input text); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.slugify(input text) TO warehouse14_app;
GRANT ALL ON FUNCTION public.slugify(input text) TO warehouse14_worker;


--
-- Name: FUNCTION slugify_de(input text); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.slugify_de(input text) TO warehouse14_app;
GRANT ALL ON FUNCTION public.slugify_de(input text) TO warehouse14_worker;


--
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.touch_updated_at() TO warehouse14_app;
GRANT ALL ON FUNCTION public.touch_updated_at() TO warehouse14_worker;


--
-- Name: FUNCTION transaction_payments_accumulate_debt(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.transaction_payments_accumulate_debt() TO warehouse14_app;


--
-- Name: FUNCTION transaction_payments_debt_requires_customer(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.transaction_payments_debt_requires_customer() TO warehouse14_app;


--
-- Name: FUNCTION transactions_validate_closing_day(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.transactions_validate_closing_day() TO warehouse14_app;


--
-- Name: FUNCTION transactions_validate_kyc(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.transactions_validate_kyc() TO warehouse14_app;
GRANT ALL ON FUNCTION public.transactions_validate_kyc() TO warehouse14_worker;


--
-- Name: FUNCTION transactions_validate_sanctions(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.transactions_validate_sanctions() TO warehouse14_app;


--
-- Name: FUNCTION transactions_validate_storno(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.transactions_validate_storno() TO warehouse14_app;


--
-- Name: FUNCTION transactions_validate_trust_level(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.transactions_validate_trust_level() TO warehouse14_app;
GRANT ALL ON FUNCTION public.transactions_validate_trust_level() TO warehouse14_worker;


--
-- Name: FUNCTION tse_signatures_immutable(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.tse_signatures_immutable() TO warehouse14_app;
GRANT ALL ON FUNCTION public.tse_signatures_immutable() TO warehouse14_worker;


--
-- Name: FUNCTION tse_validate_transition(); Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT ALL ON FUNCTION public.tse_validate_transition() TO warehouse14_app;


--
-- Name: FUNCTION verify_ledger_chain(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.verify_ledger_chain() TO warehouse14_app;


--
-- Name: FUNCTION verify_transaction_balance(); Type: ACL; Schema: public; Owner: warehouse14_security
--

GRANT ALL ON FUNCTION public.verify_transaction_balance() TO warehouse14_app;


--
-- Name: TABLE accounts; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.accounts TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.accounts TO warehouse14_worker;


--
-- Name: COLUMN accounts.password; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(password) ON TABLE public.accounts TO warehouse14_app;


--
-- Name: COLUMN accounts.access_token; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(access_token) ON TABLE public.accounts TO warehouse14_app;


--
-- Name: COLUMN accounts.refresh_token; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(refresh_token) ON TABLE public.accounts TO warehouse14_app;


--
-- Name: COLUMN accounts.id_token; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(id_token) ON TABLE public.accounts TO warehouse14_app;


--
-- Name: COLUMN accounts.access_token_expires_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(access_token_expires_at) ON TABLE public.accounts TO warehouse14_app;


--
-- Name: COLUMN accounts.refresh_token_expires_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(refresh_token_expires_at) ON TABLE public.accounts TO warehouse14_app;


--
-- Name: COLUMN accounts.scope; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(scope) ON TABLE public.accounts TO warehouse14_app;


--
-- Name: COLUMN accounts.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.accounts TO warehouse14_app;


--
-- Name: TABLE api_keys; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.api_keys TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.api_keys TO warehouse14_worker;


--
-- Name: COLUMN api_keys.last_used_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_used_at) ON TABLE public.api_keys TO warehouse14_app;


--
-- Name: COLUMN api_keys.last_used_ip; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_used_ip) ON TABLE public.api_keys TO warehouse14_app;


--
-- Name: COLUMN api_keys.revoked_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(revoked_at) ON TABLE public.api_keys TO warehouse14_app;


--
-- Name: COLUMN api_keys.revoked_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(revoked_by_user_id) ON TABLE public.api_keys TO warehouse14_app;


--
-- Name: COLUMN api_keys.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.api_keys TO warehouse14_app;


--
-- Name: TABLE appointment_linked_products; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.appointment_linked_products TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.appointment_linked_products TO warehouse14_worker;


--
-- Name: TABLE appointment_notifications; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.appointment_notifications TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.appointment_notifications TO warehouse14_worker;


--
-- Name: COLUMN appointment_notifications.sent_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(sent_at) ON TABLE public.appointment_notifications TO warehouse14_app;
GRANT UPDATE(sent_at) ON TABLE public.appointment_notifications TO warehouse14_worker;


--
-- Name: COLUMN appointment_notifications.delivery_status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(delivery_status) ON TABLE public.appointment_notifications TO warehouse14_app;
GRANT UPDATE(delivery_status) ON TABLE public.appointment_notifications TO warehouse14_worker;


--
-- Name: COLUMN appointment_notifications.external_ref; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(external_ref) ON TABLE public.appointment_notifications TO warehouse14_app;
GRANT UPDATE(external_ref) ON TABLE public.appointment_notifications TO warehouse14_worker;


--
-- Name: TABLE appointments; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.appointments TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.appointments TO warehouse14_worker;
GRANT SELECT ON TABLE public.appointments TO warehouse14_security;


--
-- Name: COLUMN appointments.appointment_type; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(appointment_type) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.appointments TO warehouse14_app;
GRANT UPDATE(status) ON TABLE public.appointments TO warehouse14_worker;


--
-- Name: COLUMN appointments.starts_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(starts_at) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.duration_minutes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(duration_minutes) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.customer_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(customer_id) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.staff_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(staff_user_id) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.customer_notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(customer_notes) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.staff_notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(staff_notes) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.confirmed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(confirmed_at) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.checked_in_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(checked_in_at) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.early_arrival_minutes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(early_arrival_minutes) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.in_progress_started_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(in_progress_started_at) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.completed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(completed_at) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.no_show_marked_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(no_show_marked_at) ON TABLE public.appointments TO warehouse14_app;
GRANT UPDATE(no_show_marked_at) ON TABLE public.appointments TO warehouse14_worker;


--
-- Name: COLUMN appointments.cancelled_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cancelled_at) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.cancellation_reason; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cancellation_reason) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.rescheduled_from_appointment_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(rescheduled_from_appointment_id) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.rescheduled_to_appointment_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(rescheduled_to_appointment_id) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.linked_transaction_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(linked_transaction_id) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.appointments TO warehouse14_app;
GRANT UPDATE(updated_at) ON TABLE public.appointments TO warehouse14_worker;


--
-- Name: COLUMN appointments.source; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(source) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.contact_name; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(contact_name) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.contact_phone; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(contact_phone) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.contact_email; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(contact_email) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: COLUMN appointments.google_event_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(google_event_id) ON TABLE public.appointments TO warehouse14_app;


--
-- Name: TABLE appraisal_items; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE ON TABLE public.appraisal_items TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.appraisal_items TO warehouse14_worker;


--
-- Name: COLUMN appraisal_items.sequence_in_lot; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(sequence_in_lot) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.name; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(name) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.description; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(description) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.item_type; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(item_type) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.metal; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(metal) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.karat_code; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(karat_code) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.fineness_decimal; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(fineness_decimal) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.weight_grams; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(weight_grams) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.condition; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(condition) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.hallmark_stamps; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(hallmark_stamps) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.individual_appraised_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(individual_appraised_eur) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.photo_r2_keys; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(photo_r2_keys) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.product_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(product_id) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: COLUMN appraisal_items.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.appraisal_items TO warehouse14_app;


--
-- Name: TABLE appraisals; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.appraisals TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.appraisals TO warehouse14_worker;


--
-- Name: COLUMN appraisals.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.total_appraised_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(total_appraised_eur) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.total_offered_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(total_offered_eur) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.customer_expectation_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(customer_expectation_eur) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.ankauf_transaction_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ankauf_transaction_id) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.completed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(completed_at) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.accepted_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(accepted_at) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.rejected_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(rejected_at) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.rejection_reason; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(rejection_reason) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.expires_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(expires_at) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: COLUMN appraisals.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.appraisals TO warehouse14_app;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.audit_log TO warehouse14_app;
GRANT INSERT ON TABLE public.audit_log TO warehouse14_security;
GRANT SELECT,INSERT ON TABLE public.audit_log TO warehouse14_worker;


--
-- Name: COLUMN audit_log.ip_address; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ip_address) ON TABLE public.audit_log TO warehouse14_worker;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.audit_log_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.audit_log_id_seq TO warehouse14_security;
GRANT USAGE ON SEQUENCE public.audit_log_id_seq TO warehouse14_worker;


--
-- Name: TABLE beleg_logo; Type: ACL; Schema: public; Owner: warehouse14
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.beleg_logo TO warehouse14_app;


--
-- Name: TABLE belegtext_templates; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.belegtext_templates TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.belegtext_templates TO warehouse14_worker;


--
-- Name: COLUMN belegtext_templates.valid_to; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(valid_to) ON TABLE public.belegtext_templates TO warehouse14_app;


--
-- Name: TABLE business_locations; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.business_locations TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.business_locations TO warehouse14_worker;


--
-- Name: TABLE cart_items; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE ON TABLE public.cart_items TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.cart_items TO warehouse14_worker;


--
-- Name: TABLE carts; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.carts TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.carts TO warehouse14_worker;


--
-- Name: COLUMN carts.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.carts TO warehouse14_app;
GRANT UPDATE(status) ON TABLE public.carts TO warehouse14_worker;


--
-- Name: COLUMN carts.reservation_session_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(reservation_session_id) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.checkout_started_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(checkout_started_at) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.checkout_expires_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(checkout_expires_at) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.converted_to_transaction_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(converted_to_transaction_id) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.carts TO warehouse14_app;
GRANT UPDATE(updated_at) ON TABLE public.carts TO warehouse14_worker;


--
-- Name: COLUMN carts.reserved_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(reserved_at) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.pickup_stage; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(pickup_stage) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.approved_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(approved_at) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.approved_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(approved_by_user_id) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.preparation_started_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(preparation_started_at) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.ready_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ready_at) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.collected_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(collected_at) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.collected_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(collected_by_user_id) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.expiry_reminder_sent_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(expiry_reminder_sent_at) ON TABLE public.carts TO warehouse14_worker;
GRANT UPDATE(expiry_reminder_sent_at) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.cancelled_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cancelled_at) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.cancelled_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cancelled_by_user_id) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.cancellation_reason; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cancellation_reason) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.cancelled_by_role; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cancelled_by_role) ON TABLE public.carts TO warehouse14_app;


--
-- Name: COLUMN carts.order_origin; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(order_origin) ON TABLE public.carts TO warehouse14_app;


--
-- Name: TABLE cash_movements; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.cash_movements TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.cash_movements TO warehouse14_worker;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.categories TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.categories TO warehouse14_worker;
GRANT SELECT ON TABLE public.categories TO warehouse14_security;


--
-- Name: TABLE category_translations; Type: ACL; Schema: public; Owner: warehouse14
--

GRANT SELECT ON TABLE public.category_translations TO warehouse14_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.category_translations TO warehouse14_worker;


--
-- Name: TABLE customer_broadcasts; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.customer_broadcasts TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.customer_broadcasts TO warehouse14_worker;


--
-- Name: COLUMN customer_broadcasts.queued_push; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(queued_push) ON TABLE public.customer_broadcasts TO warehouse14_app;


--
-- Name: COLUMN customer_broadcasts.queued_email; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(queued_email) ON TABLE public.customer_broadcasts TO warehouse14_app;


--
-- Name: COLUMN customer_broadcasts.skipped_no_consent; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(skipped_no_consent) ON TABLE public.customer_broadcasts TO warehouse14_app;


--
-- Name: SEQUENCE customer_number_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.customer_number_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.customer_number_seq TO warehouse14_worker;


--
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.customers TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.customers TO warehouse14_worker;


--
-- Name: COLUMN customers.id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(id) ON TABLE public.customers TO warehouse14_security;


--
-- Name: COLUMN customers.full_name_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(full_name_encrypted) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.email_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(email_encrypted) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.phone_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(phone_encrypted) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.address_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(address_encrypted) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.notes_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes_encrypted) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.email_blind_index; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(email_blind_index) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.phone_blind_index; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(phone_blind_index) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.preferred_language; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(preferred_language) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.customer_tags; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(customer_tags) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.kyc_status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(kyc_status) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.kyc_completed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(kyc_completed_at) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.kyc_expires_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(kyc_expires_at) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.sanctions_screened_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(sanctions_screened_at) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.sanctions_match; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(sanctions_match) ON TABLE public.customers TO warehouse14_app;
GRANT SELECT(sanctions_match) ON TABLE public.customers TO warehouse14_security;


--
-- Name: COLUMN customers.pep_match; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(pep_match) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.cumulative_spend_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(cumulative_spend_eur),UPDATE(cumulative_spend_eur) ON TABLE public.customers TO warehouse14_security;


--
-- Name: COLUMN customers.cumulative_ankauf_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(cumulative_ankauf_eur),UPDATE(cumulative_ankauf_eur) ON TABLE public.customers TO warehouse14_security;


--
-- Name: COLUMN customers.retention_until; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(retention_until) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.soft_deleted_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(soft_deleted_at) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.anonymized_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(anonymized_at) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.cumulative_debt_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(cumulative_debt_eur),UPDATE(cumulative_debt_eur) ON TABLE public.customers TO warehouse14_security;


--
-- Name: COLUMN customers.trust_level; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(trust_level) ON TABLE public.customers TO warehouse14_app;
GRANT SELECT(trust_level) ON TABLE public.customers TO warehouse14_security;


--
-- Name: COLUMN customers.kyc_verified_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(kyc_verified_at) ON TABLE public.customers TO warehouse14_app;
GRANT SELECT(kyc_verified_at) ON TABLE public.customers TO warehouse14_security;


--
-- Name: COLUMN customers.kyc_verified_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(kyc_verified_by_user_id) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.price_expectation_notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(price_expectation_notes) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.vat_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(vat_id) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.erasure_initiated_by; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(erasure_initiated_by) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.vat_id_checked_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(vat_id_checked_at) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.vat_id_check_result; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(vat_id_check_result) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.vat_id_check_name; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(vat_id_check_name) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.vat_id_check_address; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(vat_id_check_address) ON TABLE public.customers TO warehouse14_app;


--
-- Name: COLUMN customers.vat_id_checked_value; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(vat_id_checked_value) ON TABLE public.customers TO warehouse14_app;


--
-- Name: TABLE daily_closings; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.daily_closings TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.daily_closings TO warehouse14_worker;


--
-- Name: COLUMN daily_closings.shop_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(shop_id) ON TABLE public.daily_closings TO warehouse14_security;


--
-- Name: COLUMN daily_closings.business_day; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(business_day) ON TABLE public.daily_closings TO warehouse14_security;


--
-- Name: COLUMN daily_closings.state; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(state) ON TABLE public.daily_closings TO warehouse14_app;
GRANT SELECT(state) ON TABLE public.daily_closings TO warehouse14_security;


--
-- Name: COLUMN daily_closings.verkauf_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(verkauf_count) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.ankauf_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ankauf_count) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.storno_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(storno_count) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.gross_verkauf_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(gross_verkauf_eur) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.gross_ankauf_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(gross_ankauf_eur) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.net_verkauf_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(net_verkauf_eur) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.net_ankauf_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(net_ankauf_eur) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.vat_by_treatment; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(vat_by_treatment) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.payments_by_method; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(payments_by_method) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.cash_drawer_expected_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cash_drawer_expected_eur) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.cash_drawer_counted_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cash_drawer_counted_eur) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.cash_drawer_variance_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cash_drawer_variance_eur) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.tse_finished_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(tse_finished_count) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.tse_pending_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(tse_pending_count) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.tse_failed_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(tse_failed_count) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.ledger_anchor_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ledger_anchor_id) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.ledger_anchor_hash; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ledger_anchor_hash) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.counted_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(counted_by_user_id) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.counted_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(counted_at) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.finalized_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(finalized_by_user_id) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.finalized_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(finalized_at) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.z_nr; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT INSERT(z_nr),UPDATE(z_nr) ON TABLE public.daily_closings TO warehouse14_migrator;
GRANT INSERT(z_nr),UPDATE(z_nr) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: COLUMN daily_closings.umsatz_by_treatment; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT INSERT(umsatz_by_treatment),UPDATE(umsatz_by_treatment) ON TABLE public.daily_closings TO warehouse14_migrator;
GRANT INSERT(umsatz_by_treatment),UPDATE(umsatz_by_treatment) ON TABLE public.daily_closings TO warehouse14_app;


--
-- Name: TABLE device_push_tokens; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.device_push_tokens TO warehouse14_app;
GRANT SELECT ON TABLE public.device_push_tokens TO warehouse14_worker;


--
-- Name: COLUMN device_push_tokens.user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(user_id) ON TABLE public.device_push_tokens TO warehouse14_app;


--
-- Name: COLUMN device_push_tokens.platform; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(platform) ON TABLE public.device_push_tokens TO warehouse14_app;


--
-- Name: COLUMN device_push_tokens.app; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(app) ON TABLE public.device_push_tokens TO warehouse14_app;


--
-- Name: COLUMN device_push_tokens.device_label; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(device_label) ON TABLE public.device_push_tokens TO warehouse14_app;


--
-- Name: COLUMN device_push_tokens.last_seen_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_seen_at) ON TABLE public.device_push_tokens TO warehouse14_app;


--
-- Name: COLUMN device_push_tokens.revoked_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(revoked_at) ON TABLE public.device_push_tokens TO warehouse14_app;
GRANT UPDATE(revoked_at) ON TABLE public.device_push_tokens TO warehouse14_worker;


--
-- Name: COLUMN device_push_tokens.shopper_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shopper_id) ON TABLE public.device_push_tokens TO warehouse14_app;


--
-- Name: TABLE devices; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.devices TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.devices TO warehouse14_worker;


--
-- Name: COLUMN devices.hostname; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(hostname) ON TABLE public.devices TO warehouse14_app;


--
-- Name: COLUMN devices.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.devices TO warehouse14_app;


--
-- Name: COLUMN devices.last_seen_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_seen_at) ON TABLE public.devices TO warehouse14_app;


--
-- Name: COLUMN devices.last_seen_ip; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_seen_ip) ON TABLE public.devices TO warehouse14_app;


--
-- Name: COLUMN devices.notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes) ON TABLE public.devices TO warehouse14_app;


--
-- Name: COLUMN devices.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.devices TO warehouse14_app;


--
-- Name: TABLE document_attachments; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.document_attachments TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.document_attachments TO warehouse14_worker;


--
-- Name: COLUMN document_attachments.notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes) ON TABLE public.document_attachments TO warehouse14_app;


--
-- Name: COLUMN document_attachments.archived_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(archived_at) ON TABLE public.document_attachments TO warehouse14_app;


--
-- Name: TABLE dsfinvk_exports; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.state; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(state) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(state) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.generated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(generated_at) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(generated_at) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.delivered_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(delivered_at) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(delivered_at) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.delivery_method; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(delivery_method) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(delivery_method) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.delivery_target; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(delivery_target) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(delivery_target) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.r2_key; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(r2_key) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(r2_key) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.file_size_bytes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(file_size_bytes) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(file_size_bytes) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.file_sha256; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(file_sha256) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(file_sha256) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.transaction_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(transaction_count) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(transaction_count) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.daily_closings_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(daily_closings_count) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(daily_closings_count) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.total_gross_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(total_gross_eur) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(total_gross_eur) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.daily_closing_ids; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(daily_closing_ids) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(daily_closing_ids) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.last_error_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_error_at) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(last_error_at) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.last_error_message; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_error_message) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(last_error_message) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: COLUMN dsfinvk_exports.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.dsfinvk_exports TO warehouse14_app;
GRANT UPDATE(updated_at) ON TABLE public.dsfinvk_exports TO warehouse14_worker;


--
-- Name: TABLE email_outbox; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.email_outbox TO warehouse14_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.email_outbox TO warehouse14_worker;


--
-- Name: TABLE fixed_costs; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT ON TABLE public.fixed_costs TO warehouse14_worker;
GRANT SELECT,INSERT ON TABLE public.fixed_costs TO warehouse14_app;


--
-- Name: COLUMN fixed_costs.label; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(label) ON TABLE public.fixed_costs TO warehouse14_app;


--
-- Name: COLUMN fixed_costs.monthly_amount_cents; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(monthly_amount_cents) ON TABLE public.fixed_costs TO warehouse14_app;


--
-- Name: COLUMN fixed_costs.active_from; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(active_from) ON TABLE public.fixed_costs TO warehouse14_app;


--
-- Name: COLUMN fixed_costs.active_to; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(active_to) ON TABLE public.fixed_costs TO warehouse14_app;


--
-- Name: COLUMN fixed_costs.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.fixed_costs TO warehouse14_app;


--
-- Name: TABLE hallmarks; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT ON TABLE public.hallmarks TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.hallmarks TO warehouse14_worker;


--
-- Name: TABLE internal_tasks; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.internal_tasks TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.internal_tasks TO warehouse14_worker;


--
-- Name: COLUMN internal_tasks.title; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(title) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.description; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(description) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.priority; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(priority) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.assigned_to_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(assigned_to_user_id) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.due_date; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(due_date) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.started_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(started_at) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.completed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(completed_at) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.cancelled_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cancelled_at) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.cancellation_reason; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(cancellation_reason) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.related_entity_table; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(related_entity_table) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.related_entity_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(related_entity_id) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: COLUMN internal_tasks.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.internal_tasks TO warehouse14_app;


--
-- Name: TABLE inventory_scans; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.inventory_scans TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.inventory_scans TO warehouse14_worker;


--
-- Name: TABLE inventory_sessions; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.inventory_sessions TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.inventory_sessions TO warehouse14_worker;


--
-- Name: COLUMN inventory_sessions.closed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(closed_at) ON TABLE public.inventory_sessions TO warehouse14_app;


--
-- Name: COLUMN inventory_sessions.closed_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(closed_by_user_id) ON TABLE public.inventory_sessions TO warehouse14_app;


--
-- Name: COLUMN inventory_sessions.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.inventory_sessions TO warehouse14_app;


--
-- Name: COLUMN inventory_sessions.matched_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(matched_count) ON TABLE public.inventory_sessions TO warehouse14_app;


--
-- Name: COLUMN inventory_sessions.missing_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(missing_count) ON TABLE public.inventory_sessions TO warehouse14_app;


--
-- Name: COLUMN inventory_sessions.unexpected_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(unexpected_count) ON TABLE public.inventory_sessions TO warehouse14_app;


--
-- Name: COLUMN inventory_sessions.notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes) ON TABLE public.inventory_sessions TO warehouse14_app;


--
-- Name: COLUMN inventory_sessions.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.inventory_sessions TO warehouse14_app;


--
-- Name: TABLE karat_grades; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT ON TABLE public.karat_grades TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.karat_grades TO warehouse14_worker;


--
-- Name: TABLE kartenleser; Type: ACL; Schema: public; Owner: warehouse14
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.kartenleser TO warehouse14_app;


--
-- Name: TABLE kyc_documents; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.kyc_documents TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.kyc_documents TO warehouse14_worker;


--
-- Name: COLUMN kyc_documents.document_number_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(document_number_encrypted) ON TABLE public.kyc_documents TO warehouse14_app;
GRANT UPDATE(document_number_encrypted) ON TABLE public.kyc_documents TO warehouse14_worker;


--
-- Name: COLUMN kyc_documents.document_photo_storage_key; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(document_photo_storage_key) ON TABLE public.kyc_documents TO warehouse14_app;
GRANT UPDATE(document_photo_storage_key) ON TABLE public.kyc_documents TO warehouse14_worker;


--
-- Name: COLUMN kyc_documents.document_photo_sha256; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(document_photo_sha256) ON TABLE public.kyc_documents TO warehouse14_app;
GRANT UPDATE(document_photo_sha256) ON TABLE public.kyc_documents TO warehouse14_worker;


--
-- Name: COLUMN kyc_documents.verified_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(verified_at) ON TABLE public.kyc_documents TO warehouse14_app;


--
-- Name: COLUMN kyc_documents.verified_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(verified_by_user_id) ON TABLE public.kyc_documents TO warehouse14_app;


--
-- Name: COLUMN kyc_documents.retention_until; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(retention_until) ON TABLE public.kyc_documents TO warehouse14_app;


--
-- Name: COLUMN kyc_documents.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.kyc_documents TO warehouse14_app;
GRANT UPDATE(updated_at) ON TABLE public.kyc_documents TO warehouse14_worker;


--
-- Name: COLUMN kyc_documents.purged_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(purged_at) ON TABLE public.kyc_documents TO warehouse14_app;
GRANT UPDATE(purged_at) ON TABLE public.kyc_documents TO warehouse14_worker;


--
-- Name: COLUMN kyc_documents.purged_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(purged_by_user_id) ON TABLE public.kyc_documents TO warehouse14_app;
GRANT UPDATE(purged_by_user_id) ON TABLE public.kyc_documents TO warehouse14_worker;


--
-- Name: COLUMN kyc_documents.document_photo_size_bytes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(document_photo_size_bytes) ON TABLE public.kyc_documents TO warehouse14_app;
GRANT UPDATE(document_photo_size_bytes) ON TABLE public.kyc_documents TO warehouse14_worker;


--
-- Name: TABLE ledger_chain_head; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.ledger_chain_head TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.ledger_chain_head TO warehouse14_worker;
GRANT SELECT,UPDATE ON TABLE public.ledger_chain_head TO warehouse14_security;


--
-- Name: TABLE ledger_events; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT ON TABLE public.ledger_events TO warehouse14_app;
GRANT SELECT ON TABLE public.ledger_events TO warehouse14_security;
GRANT SELECT ON TABLE public.ledger_events TO warehouse14_worker;


--
-- Name: COLUMN ledger_events.event_type; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT INSERT(event_type) ON TABLE public.ledger_events TO warehouse14_app;
GRANT INSERT(event_type) ON TABLE public.ledger_events TO warehouse14_security;
GRANT INSERT(event_type) ON TABLE public.ledger_events TO warehouse14_worker;


--
-- Name: COLUMN ledger_events.entity_table; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT INSERT(entity_table) ON TABLE public.ledger_events TO warehouse14_app;
GRANT INSERT(entity_table) ON TABLE public.ledger_events TO warehouse14_security;
GRANT INSERT(entity_table) ON TABLE public.ledger_events TO warehouse14_worker;


--
-- Name: COLUMN ledger_events.entity_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT INSERT(entity_id) ON TABLE public.ledger_events TO warehouse14_app;
GRANT INSERT(entity_id) ON TABLE public.ledger_events TO warehouse14_security;
GRANT INSERT(entity_id) ON TABLE public.ledger_events TO warehouse14_worker;


--
-- Name: COLUMN ledger_events.actor_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT INSERT(actor_user_id) ON TABLE public.ledger_events TO warehouse14_app;
GRANT INSERT(actor_user_id) ON TABLE public.ledger_events TO warehouse14_security;
GRANT INSERT(actor_user_id) ON TABLE public.ledger_events TO warehouse14_worker;


--
-- Name: COLUMN ledger_events.device_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT INSERT(device_id) ON TABLE public.ledger_events TO warehouse14_app;
GRANT INSERT(device_id) ON TABLE public.ledger_events TO warehouse14_security;
GRANT INSERT(device_id) ON TABLE public.ledger_events TO warehouse14_worker;


--
-- Name: COLUMN ledger_events.ip_address; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT INSERT(ip_address) ON TABLE public.ledger_events TO warehouse14_app;
GRANT INSERT(ip_address) ON TABLE public.ledger_events TO warehouse14_security;
GRANT INSERT(ip_address) ON TABLE public.ledger_events TO warehouse14_worker;


--
-- Name: COLUMN ledger_events.payload; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT INSERT(payload) ON TABLE public.ledger_events TO warehouse14_app;
GRANT INSERT(payload) ON TABLE public.ledger_events TO warehouse14_security;
GRANT INSERT(payload) ON TABLE public.ledger_events TO warehouse14_worker;


--
-- Name: SEQUENCE ledger_events_id_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.ledger_events_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.ledger_events_id_seq TO warehouse14_security;
GRANT USAGE ON SEQUENCE public.ledger_events_id_seq TO warehouse14_worker;


--
-- Name: TABLE leser_zahlungen; Type: ACL; Schema: public; Owner: warehouse14
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.leser_zahlungen TO warehouse14_app;


--
-- Name: TABLE metal_prices; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.metal_prices TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.metal_prices TO warehouse14_worker;


--
-- Name: COLUMN metal_prices.valid_to; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(valid_to) ON TABLE public.metal_prices TO warehouse14_app;
GRANT UPDATE(valid_to) ON TABLE public.metal_prices TO warehouse14_worker;


--
-- Name: SEQUENCE metal_prices_id_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.metal_prices_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.metal_prices_id_seq TO warehouse14_worker;


--
-- Name: TABLE operating_expenses; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT ON TABLE public.operating_expenses TO warehouse14_worker;
GRANT SELECT,INSERT ON TABLE public.operating_expenses TO warehouse14_app;


--
-- Name: COLUMN operating_expenses.business_day; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(business_day) ON TABLE public.operating_expenses TO warehouse14_app;


--
-- Name: COLUMN operating_expenses.category; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(category) ON TABLE public.operating_expenses TO warehouse14_app;


--
-- Name: COLUMN operating_expenses.amount_cents; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(amount_cents) ON TABLE public.operating_expenses TO warehouse14_app;


--
-- Name: COLUMN operating_expenses.note; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(note) ON TABLE public.operating_expenses TO warehouse14_app;


--
-- Name: COLUMN operating_expenses.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.operating_expenses TO warehouse14_app;


--
-- Name: SEQUENCE order_number_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.order_number_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.order_number_seq TO warehouse14_worker;


--
-- Name: TABLE payment_commission_rates; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT ON TABLE public.payment_commission_rates TO warehouse14_app;
GRANT SELECT ON TABLE public.payment_commission_rates TO warehouse14_worker;


--
-- Name: TABLE payment_intents; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.payment_intents TO warehouse14_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.payment_intents TO warehouse14_worker;


--
-- Name: COLUMN payment_intents.provider_intent_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(provider_intent_id) ON TABLE public.payment_intents TO warehouse14_app;


--
-- Name: COLUMN payment_intents.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.payment_intents TO warehouse14_app;


--
-- Name: COLUMN payment_intents.client_secret; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(client_secret) ON TABLE public.payment_intents TO warehouse14_app;


--
-- Name: COLUMN payment_intents.redirect_url; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(redirect_url) ON TABLE public.payment_intents TO warehouse14_app;


--
-- Name: COLUMN payment_intents.outcome; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(outcome) ON TABLE public.payment_intents TO warehouse14_app;


--
-- Name: COLUMN payment_intents.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.payment_intents TO warehouse14_app;


--
-- Name: COLUMN payment_intents.stripe_account_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(stripe_account_id),INSERT(stripe_account_id) ON TABLE public.payment_intents TO warehouse14_app;


--
-- Name: COLUMN payment_intents.application_fee_cents; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(application_fee_cents),INSERT(application_fee_cents),UPDATE(application_fee_cents) ON TABLE public.payment_intents TO warehouse14_app;


--
-- Name: TABLE product_categories; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_categories TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.product_categories TO warehouse14_worker;


--
-- Name: TABLE product_ebay_listing_events; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE ON TABLE public.product_ebay_listing_events TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.product_ebay_listing_events TO warehouse14_worker;


--
-- Name: SEQUENCE product_ebay_listing_events_id_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.product_ebay_listing_events_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.product_ebay_listing_events_id_seq TO warehouse14_worker;


--
-- Name: TABLE product_photo_workflow_events; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.product_photo_workflow_events TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.product_photo_workflow_events TO warehouse14_worker;


--
-- Name: SEQUENCE product_photo_workflow_events_id_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.product_photo_workflow_events_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.product_photo_workflow_events_id_seq TO warehouse14_worker;


--
-- Name: TABLE product_photos; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_photos TO warehouse14_app;
GRANT SELECT,INSERT,DELETE ON TABLE public.product_photos TO warehouse14_worker;


--
-- Name: COLUMN product_photos.product_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(product_id) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.r2_key_bg_removed; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(r2_key_bg_removed) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.display_order; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(display_order) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.is_primary; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(is_primary) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.alt_text_de; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(alt_text_de) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.alt_text_en; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(alt_text_en) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.workflow_state; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(workflow_state) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.workflow_changed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(workflow_changed_at) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.workflow_changed_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(workflow_changed_by_user_id) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.storage_kind; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(storage_kind) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.size_bytes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(size_bytes) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.thumb_bytes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(thumb_bytes) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.width; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(width) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.height; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(height) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: COLUMN product_photos.content_type; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(content_type) ON TABLE public.product_photos TO warehouse14_app;


--
-- Name: TABLE product_translations; Type: ACL; Schema: public; Owner: warehouse14
--

GRANT SELECT ON TABLE public.product_translations TO warehouse14_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_translations TO warehouse14_worker;


--
-- Name: TABLE product_viewing_holds; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.product_viewing_holds TO warehouse14_app;
GRANT INSERT ON TABLE public.product_viewing_holds TO warehouse14_security;
GRANT SELECT,INSERT ON TABLE public.product_viewing_holds TO warehouse14_worker;


--
-- Name: COLUMN product_viewing_holds.appointment_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(appointment_id) ON TABLE public.product_viewing_holds TO warehouse14_security;


--
-- Name: COLUMN product_viewing_holds.hold_strength; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(hold_strength) ON TABLE public.product_viewing_holds TO warehouse14_app;


--
-- Name: COLUMN product_viewing_holds.hold_starts_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(hold_starts_at) ON TABLE public.product_viewing_holds TO warehouse14_app;


--
-- Name: COLUMN product_viewing_holds.hold_expires_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(hold_expires_at) ON TABLE public.product_viewing_holds TO warehouse14_app;


--
-- Name: COLUMN product_viewing_holds.released_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(released_at) ON TABLE public.product_viewing_holds TO warehouse14_app;
GRANT SELECT(released_at),UPDATE(released_at) ON TABLE public.product_viewing_holds TO warehouse14_security;
GRANT UPDATE(released_at) ON TABLE public.product_viewing_holds TO warehouse14_worker;


--
-- Name: COLUMN product_viewing_holds.released_reason; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(released_reason) ON TABLE public.product_viewing_holds TO warehouse14_app;
GRANT SELECT(released_reason),UPDATE(released_reason) ON TABLE public.product_viewing_holds TO warehouse14_security;
GRANT UPDATE(released_reason) ON TABLE public.product_viewing_holds TO warehouse14_worker;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE ON TABLE public.products TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.products TO warehouse14_app;
GRANT UPDATE(status) ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.reserved_by_channel; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(reserved_by_channel) ON TABLE public.products TO warehouse14_app;
GRANT UPDATE(reserved_by_channel) ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.reserved_by_session_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(reserved_by_session_id) ON TABLE public.products TO warehouse14_app;
GRANT UPDATE(reserved_by_session_id) ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.reserved_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(reserved_by_user_id) ON TABLE public.products TO warehouse14_app;
GRANT UPDATE(reserved_by_user_id) ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.reserved_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(reserved_at) ON TABLE public.products TO warehouse14_app;
GRANT UPDATE(reserved_at) ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.reservation_expires_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(reservation_expires_at) ON TABLE public.products TO warehouse14_app;
GRANT UPDATE(reservation_expires_at) ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.list_price_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(list_price_eur) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.name; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(name) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.description_de; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(description_de) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.marketing_attributes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(marketing_attributes) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.listed_on_storefront; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(listed_on_storefront) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.listed_on_ebay; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(listed_on_ebay) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.ebay_listing_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ebay_listing_id) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.published_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(published_at) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.sold_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(sold_at) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.products TO warehouse14_app;
GRANT UPDATE(updated_at) ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.ankauf_customer_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ankauf_customer_id) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.condition; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(condition) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.archived_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(archived_at) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.parent_product_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(parent_product_id) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.location_storage_unit; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(location_storage_unit) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.location_drawer; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(location_drawer) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.location_position; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(location_position) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.location_assigned_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(location_assigned_at) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.collector_premium_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(collector_premium_eur) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.ebay_state; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ebay_state) ON TABLE public.products TO warehouse14_app;
GRANT UPDATE(ebay_state) ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.ebay_state_changed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ebay_state_changed_at) ON TABLE public.products TO warehouse14_app;
GRANT UPDATE(ebay_state_changed_at) ON TABLE public.products TO warehouse14_worker;


--
-- Name: COLUMN products.slug; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(slug) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.seo_title; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(seo_title) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.seo_description; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(seo_description) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.schema_org_type; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(schema_org_type) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.year_minted_from; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(year_minted_from) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.year_minted_to; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(year_minted_to) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.origin_country; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(origin_country) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.period; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(period) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.catalog_reference; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(catalog_reference) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.provenance_notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(provenance_notes) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.description_en; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(description_en) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.seo_title_en; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(seo_title_en) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.seo_description_en; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(seo_description_en) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.is_published_to_web; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(is_published_to_web) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.stamp_erhaltung; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(stamp_erhaltung) ON TABLE public.products TO warehouse14_app;


--
-- Name: COLUMN products.stamp_minr; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(stamp_minr) ON TABLE public.products TO warehouse14_app;


--
-- Name: TABLE push_outbox; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.push_outbox TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.push_outbox TO warehouse14_worker;


--
-- Name: COLUMN push_outbox.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.push_outbox TO warehouse14_worker;


--
-- Name: COLUMN push_outbox.attempts; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(attempts) ON TABLE public.push_outbox TO warehouse14_worker;


--
-- Name: COLUMN push_outbox.last_error; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_error) ON TABLE public.push_outbox TO warehouse14_worker;


--
-- Name: COLUMN push_outbox.sent_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(sent_at) ON TABLE public.push_outbox TO warehouse14_worker;


--
-- Name: SEQUENCE receipt_locator_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.receipt_locator_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.receipt_locator_seq TO warehouse14_worker;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sessions TO warehouse14_app;
GRANT SELECT,INSERT,DELETE ON TABLE public.sessions TO warehouse14_worker;


--
-- Name: TABLE shifts; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.shifts TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.shifts TO warehouse14_worker;


--
-- Name: COLUMN shifts.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.shifts TO warehouse14_app;


--
-- Name: COLUMN shifts.blind_count_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(blind_count_eur) ON TABLE public.shifts TO warehouse14_app;


--
-- Name: COLUMN shifts.system_expected_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(system_expected_eur) ON TABLE public.shifts TO warehouse14_app;


--
-- Name: COLUMN shifts.closed_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(closed_by_user_id) ON TABLE public.shifts TO warehouse14_app;


--
-- Name: COLUMN shifts.closed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(closed_at) ON TABLE public.shifts TO warehouse14_app;


--
-- Name: COLUMN shifts.notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes) ON TABLE public.shifts TO warehouse14_app;


--
-- Name: COLUMN shifts.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.shifts TO warehouse14_app;


--
-- Name: TABLE shipments; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.shipments TO warehouse14_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.shipments TO warehouse14_worker;


--
-- Name: TABLE shipping_rates; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shipping_rates TO warehouse14_app;
GRANT SELECT ON TABLE public.shipping_rates TO warehouse14_worker;


--
-- Name: TABLE shipping_zones; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shipping_zones TO warehouse14_app;
GRANT SELECT ON TABLE public.shipping_zones TO warehouse14_worker;


--
-- Name: TABLE shop_holidays; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.shop_holidays TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.shop_holidays TO warehouse14_worker;


--
-- Name: COLUMN shop_holidays.reason; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(reason) ON TABLE public.shop_holidays TO warehouse14_app;


--
-- Name: TABLE shopper_sessions; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shopper_sessions TO warehouse14_app;
GRANT SELECT,INSERT,DELETE ON TABLE public.shopper_sessions TO warehouse14_worker;


--
-- Name: TABLE shoppers; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.shoppers TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.shoppers TO warehouse14_worker;


--
-- Name: COLUMN shoppers.email_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(email_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.email_blind_index; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(email_blind_index) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.password_hash; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(password_hash) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.email_verified_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(email_verified_at) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.email_verification_token; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(email_verification_token) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.phone_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(phone_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.phone_blind_index; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(phone_blind_index) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.shipping_recipient_name_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shipping_recipient_name_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.shipping_address_line1_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shipping_address_line1_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.shipping_address_line2_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shipping_address_line2_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.shipping_postal_code_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shipping_postal_code_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.shipping_city_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shipping_city_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.shipping_country; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shipping_country) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.billing_recipient_name_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(billing_recipient_name_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.billing_address_line1_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(billing_address_line1_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.billing_address_line2_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(billing_address_line2_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.billing_postal_code_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(billing_postal_code_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.billing_city_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(billing_city_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.billing_country; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(billing_country) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.preferred_language; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(preferred_language) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.marketing_consent; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(marketing_consent) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.marketing_consent_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(marketing_consent_at) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.failed_login_attempts; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(failed_login_attempts) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.locked_until; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(locked_until) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.soft_deleted_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(soft_deleted_at) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.anonymized_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(anonymized_at) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.google_sub; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(google_sub) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.is_guest; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(is_guest) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.given_name_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(given_name_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.family_name_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(family_name_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.picture_url_encrypted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(picture_url_encrypted) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: COLUMN shoppers.last_seen_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_seen_at) ON TABLE public.shoppers TO warehouse14_app;


--
-- Name: TABLE staff_time_off; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.staff_time_off TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.staff_time_off TO warehouse14_worker;


--
-- Name: COLUMN staff_time_off.starts_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(starts_at) ON TABLE public.staff_time_off TO warehouse14_app;


--
-- Name: COLUMN staff_time_off.ends_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ends_at) ON TABLE public.staff_time_off TO warehouse14_app;


--
-- Name: COLUMN staff_time_off.reason; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(reason) ON TABLE public.staff_time_off TO warehouse14_app;


--
-- Name: COLUMN staff_time_off.approved_by; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(approved_by) ON TABLE public.staff_time_off TO warehouse14_app;


--
-- Name: TABLE staff_working_hours; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.staff_working_hours TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.staff_working_hours TO warehouse14_worker;


--
-- Name: COLUMN staff_working_hours.weekday; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(weekday) ON TABLE public.staff_working_hours TO warehouse14_app;


--
-- Name: COLUMN staff_working_hours.starts_at_local; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(starts_at_local) ON TABLE public.staff_working_hours TO warehouse14_app;


--
-- Name: COLUMN staff_working_hours.ends_at_local; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ends_at_local) ON TABLE public.staff_working_hours TO warehouse14_app;


--
-- Name: COLUMN staff_working_hours.effective_until; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(effective_until) ON TABLE public.staff_working_hours TO warehouse14_app;


--
-- Name: TABLE stripe_connected_accounts; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: COLUMN stripe_connected_accounts.country; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(country) ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: COLUMN stripe_connected_accounts.default_currency; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(default_currency) ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: COLUMN stripe_connected_accounts.charges_enabled; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(charges_enabled) ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: COLUMN stripe_connected_accounts.payouts_enabled; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(payouts_enabled) ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: COLUMN stripe_connected_accounts.details_submitted; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(details_submitted) ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: COLUMN stripe_connected_accounts.requirements; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(requirements) ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: COLUMN stripe_connected_accounts.application_fee_bps; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(application_fee_bps) ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: COLUMN stripe_connected_accounts.last_synced_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_synced_at) ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: COLUMN stripe_connected_accounts.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.stripe_connected_accounts TO warehouse14_app;


--
-- Name: TABLE support_messages; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.support_messages TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.support_messages TO warehouse14_worker;


--
-- Name: SEQUENCE ticket_number_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.ticket_number_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.ticket_number_seq TO warehouse14_worker;


--
-- Name: TABLE support_tickets; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.support_tickets TO warehouse14_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.support_tickets TO warehouse14_worker;


--
-- Name: TABLE system_settings; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.system_settings TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.system_settings TO warehouse14_worker;


--
-- Name: COLUMN system_settings.key; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(key) ON TABLE public.system_settings TO warehouse14_security;


--
-- Name: COLUMN system_settings.value; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(value) ON TABLE public.system_settings TO warehouse14_app;
GRANT UPDATE(value) ON TABLE public.system_settings TO warehouse14_worker;
GRANT SELECT(value) ON TABLE public.system_settings TO warehouse14_security;


--
-- Name: COLUMN system_settings.description; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(description) ON TABLE public.system_settings TO warehouse14_app;
GRANT UPDATE(description) ON TABLE public.system_settings TO warehouse14_worker;


--
-- Name: COLUMN system_settings.updated_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_by_user_id) ON TABLE public.system_settings TO warehouse14_app;
GRANT UPDATE(updated_by_user_id) ON TABLE public.system_settings TO warehouse14_worker;


--
-- Name: COLUMN system_settings.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.system_settings TO warehouse14_app;
GRANT UPDATE(updated_at) ON TABLE public.system_settings TO warehouse14_worker;


--
-- Name: TABLE tax_treatment_codes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT ON TABLE public.tax_treatment_codes TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.tax_treatment_codes TO warehouse14_worker;


--
-- Name: TABLE transaction_items; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.transaction_items TO warehouse14_app;
GRANT SELECT ON TABLE public.transaction_items TO warehouse14_security;
GRANT SELECT,INSERT ON TABLE public.transaction_items TO warehouse14_worker;


--
-- Name: TABLE transaction_payments; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.transaction_payments TO warehouse14_app;
GRANT SELECT ON TABLE public.transaction_payments TO warehouse14_security;
GRANT SELECT,INSERT ON TABLE public.transaction_payments TO warehouse14_worker;


--
-- Name: TABLE transactions; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.transactions TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.transactions TO warehouse14_worker;


--
-- Name: COLUMN transactions.id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(id) ON TABLE public.transactions TO warehouse14_security;


--
-- Name: COLUMN transactions.direction; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(direction) ON TABLE public.transactions TO warehouse14_security;


--
-- Name: COLUMN transactions.storno_of_transaction_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(storno_of_transaction_id) ON TABLE public.transactions TO warehouse14_security;


--
-- Name: COLUMN transactions.customer_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(customer_id) ON TABLE public.transactions TO warehouse14_security;


--
-- Name: COLUMN transactions.device_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(device_id) ON TABLE public.transactions TO warehouse14_security;


--
-- Name: COLUMN transactions.cashier_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(cashier_user_id) ON TABLE public.transactions TO warehouse14_security;


--
-- Name: COLUMN transactions.subtotal_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(subtotal_eur) ON TABLE public.transactions TO warehouse14_security;


--
-- Name: COLUMN transactions.vat_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(vat_eur) ON TABLE public.transactions TO warehouse14_security;


--
-- Name: COLUMN transactions.total_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT(total_eur) ON TABLE public.transactions TO warehouse14_security;


--
-- Name: COLUMN transactions.receipt_locator; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(receipt_locator) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.printed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(printed_at) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.notes_internal; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes_internal) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.shipping_status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shipping_status) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.shipping_carrier; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shipping_carrier) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.tracking_number; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(tracking_number) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.returned_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(returned_at) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.suspicious_aml_flag; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(suspicious_aml_flag) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.suspicious_aml_reason; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(suspicious_aml_reason) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.suspicious_flagged_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(suspicious_flagged_by_user_id) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.receipt_declined_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(receipt_declined_at) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.receipt_emailed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(receipt_emailed_at) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: COLUMN transactions.shift_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(shift_id) ON TABLE public.transactions TO warehouse14_app;


--
-- Name: TABLE tse_clients; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tse_clients TO warehouse14_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.tse_clients TO warehouse14_worker;


--
-- Name: TABLE tse_daily_archives; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.tse_daily_archives TO warehouse14_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.tse_daily_archives TO warehouse14_worker;


--
-- Name: TABLE tse_signatures; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.tse_signatures TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.tse_signatures TO warehouse14_worker;


--
-- Name: TABLE tse_transactions; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.tse_transactions TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.tse_transactions TO warehouse14_worker;


--
-- Name: COLUMN tse_transactions.state; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(state) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.state_reason; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(state_reason) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.fiskaly_transaction_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(fiskaly_transaction_id) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.fiskaly_transaction_number; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(fiskaly_transaction_number) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.signature_value; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(signature_value) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.signature_counter; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(signature_counter) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.signature_algorithm; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(signature_algorithm) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.certificate_serial; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(certificate_serial) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.certificate_public_key; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(certificate_public_key) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.start_time; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(start_time) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.end_time; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(end_time) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.process_data_hash; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(process_data_hash) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.qr_code_data; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(qr_code_data) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.signed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(signed_at) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.retry_count; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(retry_count) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.last_error_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_error_at) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.last_error_code; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_error_code) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.last_error_message; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(last_error_message) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: COLUMN tse_transactions.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.tse_transactions TO warehouse14_app;


--
-- Name: TABLE two_factors; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE ON TABLE public.two_factors TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.two_factors TO warehouse14_worker;


--
-- Name: COLUMN two_factors.secret; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(secret) ON TABLE public.two_factors TO warehouse14_app;


--
-- Name: COLUMN two_factors.backup_codes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(backup_codes) ON TABLE public.two_factors TO warehouse14_app;


--
-- Name: COLUMN two_factors.enabled; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(enabled) ON TABLE public.two_factors TO warehouse14_app;


--
-- Name: COLUMN two_factors.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.two_factors TO warehouse14_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.users TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.users TO warehouse14_worker;


--
-- Name: COLUMN users.email_verified; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(email_verified) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.name; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(name) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.image; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(image) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.preferred_language; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(preferred_language) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.soft_deleted_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(soft_deleted_at) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.anonymized_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(anonymized_at) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.pos_pin_hash; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(pos_pin_hash) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.pos_pin_set_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(pos_pin_set_at) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.pos_pin_failed_attempts; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(pos_pin_failed_attempts) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.pos_pin_locked_until; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(pos_pin_locked_until) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.duress_pin_hash; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(duress_pin_hash) ON TABLE public.users TO warehouse14_app;


--
-- Name: COLUMN users.duress_pin_set_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(duress_pin_set_at) ON TABLE public.users TO warehouse14_app;


--
-- Name: TABLE verifications; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT,DELETE ON TABLE public.verifications TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.verifications TO warehouse14_worker;


--
-- Name: TABLE voucher_redemptions; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.voucher_redemptions TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.voucher_redemptions TO warehouse14_worker;


--
-- Name: TABLE vouchers; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.vouchers TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.vouchers TO warehouse14_worker;


--
-- Name: COLUMN vouchers.current_balance_eur; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(current_balance_eur) ON TABLE public.vouchers TO warehouse14_app;


--
-- Name: COLUMN vouchers.expires_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(expires_at) ON TABLE public.vouchers TO warehouse14_app;


--
-- Name: COLUMN vouchers.status; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(status) ON TABLE public.vouchers TO warehouse14_app;


--
-- Name: COLUMN vouchers.notes; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(notes) ON TABLE public.vouchers TO warehouse14_app;


--
-- Name: COLUMN vouchers.updated_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(updated_at) ON TABLE public.vouchers TO warehouse14_app;


--
-- Name: TABLE webhook_events; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.webhook_events TO warehouse14_app;
GRANT SELECT,INSERT ON TABLE public.webhook_events TO warehouse14_worker;


--
-- Name: COLUMN webhook_events.processed_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(processed_at) ON TABLE public.webhook_events TO warehouse14_app;


--
-- Name: COLUMN webhook_events.processing_error; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(processing_error) ON TABLE public.webhook_events TO warehouse14_app;


--
-- Name: SEQUENCE webhook_events_id_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.webhook_events_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.webhook_events_id_seq TO warehouse14_worker;


--
-- Name: TABLE worker_job_dlq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.worker_job_dlq TO warehouse14_app;
GRANT SELECT,INSERT,UPDATE ON TABLE public.worker_job_dlq TO warehouse14_worker;
GRANT SELECT ON TABLE public.worker_job_dlq TO warehouse14_security;


--
-- Name: COLUMN worker_job_dlq.acked_at; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(acked_at) ON TABLE public.worker_job_dlq TO warehouse14_app;


--
-- Name: COLUMN worker_job_dlq.acked_by_user_id; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(acked_by_user_id) ON TABLE public.worker_job_dlq TO warehouse14_app;


--
-- Name: COLUMN worker_job_dlq.ack_note; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT UPDATE(ack_note) ON TABLE public.worker_job_dlq TO warehouse14_app;


--
-- Name: SEQUENCE worker_job_dlq_id_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.worker_job_dlq_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.worker_job_dlq_id_seq TO warehouse14_worker;


--
-- Name: TABLE worker_job_runs; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT SELECT,INSERT ON TABLE public.worker_job_runs TO warehouse14_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.worker_job_runs TO warehouse14_worker;
GRANT SELECT ON TABLE public.worker_job_runs TO warehouse14_security;


--
-- Name: SEQUENCE worker_job_runs_id_seq; Type: ACL; Schema: public; Owner: warehouse14_migrator
--

GRANT USAGE ON SEQUENCE public.worker_job_runs_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE public.worker_job_runs_id_seq TO warehouse14_worker;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: t001_migrator
--

ALTER DEFAULT PRIVILEGES FOR ROLE t001_migrator IN SCHEMA public GRANT USAGE ON SEQUENCES TO warehouse14_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: warehouse14_migrator
--

ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public GRANT USAGE ON SEQUENCES TO warehouse14_app;
ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public GRANT USAGE ON SEQUENCES TO warehouse14_worker;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: t001_migrator
--

ALTER DEFAULT PRIVILEGES FOR ROLE t001_migrator IN SCHEMA public GRANT ALL ON FUNCTIONS TO warehouse14_app;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: warehouse14_migrator
--

ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public GRANT ALL ON FUNCTIONS TO warehouse14_app;
ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public GRANT ALL ON FUNCTIONS TO warehouse14_worker;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: t001_migrator
--

ALTER DEFAULT PRIVILEGES FOR ROLE t001_migrator IN SCHEMA public GRANT SELECT,INSERT ON TABLES TO warehouse14_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: warehouse14_migrator
--

ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public GRANT SELECT,INSERT ON TABLES TO warehouse14_app;
ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public GRANT SELECT,INSERT ON TABLES TO warehouse14_worker;


--
-- PostgreSQL database dump complete
--


