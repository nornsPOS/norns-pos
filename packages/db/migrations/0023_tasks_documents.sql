-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0023 — Single-Operator Assistance (Day 25)
--
-- Basel's vision shift: the system is operated by ONE person today; the
-- schema stays multi-user-shaped so the day a Lehrling is hired,
-- assignment "just works" without any DB migration.
--
-- What lands:
--   (A) internal_tasks — operator's day-list:
--         priority + status enums, polymorphic related_entity_*,
--         state-machine CHECKs (IN_PROGRESS / DONE / CANCELLED evidence),
--         indexes for "my open tasks" + "due-soon" + "tasks about entity X".
--   (B) document_attachments — German document discipline:
--         document_category enum (6 values), polymorphic link to ONE of
--         customer / product / transaction / appraisal, category-specific
--         CHECKs, soft-delete via archived_at, R2-backed bytes.
--   (C) Role grants: app gets INSERT + SELECT + narrow UPDATE on both
--       tables; worker gets SELECT only.
--
-- The auto-fill behaviour for "assigned_to_user_id ← req.actor.id" lives
-- in the route layer (TypeScript), NOT in the DB — keeping the DB agnostic
-- of front-of-house policy.
--
-- See memory.md decision #71 for the long-form rationale.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Enums
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_priority') THEN
    CREATE TYPE task_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
    COMMENT ON TYPE task_priority IS
      'Operator-set urgency. URGENT surfaces on the dashboard banner.';
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM (
      'OPEN',         -- not started
      'IN_PROGRESS',  -- operator clicked "start"
      'BLOCKED',      -- waiting on external dep (customer reply, courier, …)
      'DONE',         -- completed
      'CANCELLED'     -- abandoned with reason
    );
    COMMENT ON TYPE task_status IS
      '5-state lifecycle. CHECK constraints enforce evidence per transition.';
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_category') THEN
    CREATE TYPE document_category AS ENUM (
      'AUSWEIS',       -- ID document (Personalausweis / Pass / Aufenthaltstitel)
      'ANKAUFBELEG',   -- Ankaufbeleg — we are the buyer
      'RECHNUNG',      -- Rechnung — we are the seller
      'EXPERTISE',     -- Bewertung / Gutachten
      'ZERTIFIKAT',    -- Echtheitszertifikat / Hallmark certificate
      'VERSANDBELEG'   -- shipping label / proof
    );
    COMMENT ON TYPE document_category IS
      'Six German document classes Owner needs to file against an entity. '
      'Category-specific CHECKs encode required link semantics '
      '(AUSWEIS ⇒ customer; VERSANDBELEG ⇒ transaction; etc.).';
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. internal_tasks
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS internal_tasks (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),

  title                 TEXT                NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description           TEXT,
  priority              task_priority       NOT NULL DEFAULT 'NORMAL',
  status                task_status         NOT NULL DEFAULT 'OPEN',

  -- Multi-user-ready: in single-operator mode the route layer fills these
  -- with req.actor.id; in team mode the Owner explicitly assigns.
  assigned_to_user_id   UUID                NOT NULL REFERENCES users(id),
  created_by_user_id    UUID                NOT NULL REFERENCES users(id),

  due_date              DATE,

  -- Lifecycle timestamps — set by state-machine route, validated by CHECKs.
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,

  -- Polymorphic link — both NULL or both set.
  -- entity_table values follow the same convention as ledger_events.
  related_entity_table  TEXT,
  related_entity_id     UUID,

  created_at            TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT now(),

  CONSTRAINT internal_tasks_in_progress_has_started CHECK (
    status <> 'IN_PROGRESS' OR started_at IS NOT NULL
  ),
  CONSTRAINT internal_tasks_done_has_completion CHECK (
    status <> 'DONE' OR (completed_at IS NOT NULL AND started_at IS NOT NULL)
  ),
  CONSTRAINT internal_tasks_cancelled_has_reason CHECK (
    status <> 'CANCELLED'
    OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL
        AND length(cancellation_reason) >= 4)
  ),
  CONSTRAINT internal_tasks_open_no_timestamps CHECK (
    status <> 'OPEN'
    OR (started_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL)
  ),
  CONSTRAINT internal_tasks_terminal_not_both CHECK (
    completed_at IS NULL OR cancelled_at IS NULL
  ),
  CONSTRAINT internal_tasks_related_entity_both_or_none CHECK (
    (related_entity_table IS NULL) = (related_entity_id IS NULL)
  ),
  CONSTRAINT internal_tasks_related_entity_known CHECK (
    related_entity_table IS NULL
    OR related_entity_table IN (
      'products', 'customers', 'transactions', 'appraisals',
      'product_photos', 'shifts', 'inventory_sessions'
    )
  )
);

-- Hot-path indexes
CREATE INDEX IF NOT EXISTS internal_tasks_assignee_active_idx
  ON internal_tasks (assigned_to_user_id, priority DESC, due_date NULLS LAST, created_at DESC)
  WHERE status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED');

CREATE INDEX IF NOT EXISTS internal_tasks_due_soon_idx
  ON internal_tasks (due_date)
  WHERE due_date IS NOT NULL AND status IN ('OPEN', 'IN_PROGRESS');

CREATE INDEX IF NOT EXISTS internal_tasks_related_idx
  ON internal_tasks (related_entity_table, related_entity_id)
  WHERE related_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS internal_tasks_status_idx
  ON internal_tasks (status, created_at DESC);

-- updated_at auto-touch — reuse the helper from migration 0002.
DROP TRIGGER IF EXISTS internal_tasks_set_updated_at_trg ON internal_tasks;
CREATE TRIGGER internal_tasks_set_updated_at_trg
  BEFORE UPDATE ON internal_tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE internal_tasks IS
  'Operator day-list. In single-operator V1 the route layer auto-assigns to '
  'req.actor.id when the body omits assigned_to_user_id; the DB stays '
  'agnostic so adding a Lehrling needs zero migration.';
COMMENT ON COLUMN internal_tasks.related_entity_table IS
  'Polymorphic link. Allowed values match a whitelist of domain tables — '
  'extend when new domains need attached tasks.';

-- ═════════════════════════════════════════════════════════════════════════
-- 3. document_attachments
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS document_attachments (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  category              document_category   NOT NULL,

  -- R2 storage — bytes elsewhere, DB carries metadata only.
  r2_key                TEXT                NOT NULL CHECK (length(r2_key) BETWEEN 1 AND 1024),
  file_name             TEXT                NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  mime_type             TEXT                NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 255),
  size_bytes            BIGINT              NOT NULL CHECK (size_bytes > 0),
  sha256_hex            TEXT                CHECK (sha256_hex IS NULL OR length(sha256_hex) = 64),

  -- Polymorphic context — exactly ONE must be set.
  customer_id           UUID                REFERENCES customers(id),
  product_id            UUID                REFERENCES products(id),
  transaction_id        UUID                REFERENCES transactions(id),
  appraisal_id          UUID                REFERENCES appraisals(id),

  uploaded_by_user_id   UUID                NOT NULL REFERENCES users(id),
  notes                 TEXT,

  archived_at           TIMESTAMPTZ,                -- soft-delete (Owner-only)
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT now(),

  CONSTRAINT document_attachments_exactly_one_link CHECK (
    (
      (customer_id IS NOT NULL)::int
      + (product_id IS NOT NULL)::int
      + (transaction_id IS NOT NULL)::int
      + (appraisal_id IS NOT NULL)::int
    ) = 1
  ),
  -- Category-specific link discipline.
  CONSTRAINT document_attachments_ausweis_is_customer CHECK (
    category <> 'AUSWEIS' OR customer_id IS NOT NULL
  ),
  CONSTRAINT document_attachments_versandbeleg_is_transaction CHECK (
    category <> 'VERSANDBELEG' OR transaction_id IS NOT NULL
  ),
  CONSTRAINT document_attachments_expertise_link CHECK (
    category <> 'EXPERTISE' OR (appraisal_id IS NOT NULL OR product_id IS NOT NULL)
  ),
  CONSTRAINT document_attachments_ankaufbeleg_link CHECK (
    category <> 'ANKAUFBELEG' OR (customer_id IS NOT NULL OR transaction_id IS NOT NULL)
  ),
  CONSTRAINT document_attachments_rechnung_link CHECK (
    category <> 'RECHNUNG' OR (customer_id IS NOT NULL OR transaction_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS document_attachments_customer_idx
  ON document_attachments (customer_id, category, created_at DESC)
  WHERE customer_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS document_attachments_product_idx
  ON document_attachments (product_id, category, created_at DESC)
  WHERE product_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS document_attachments_transaction_idx
  ON document_attachments (transaction_id, category, created_at DESC)
  WHERE transaction_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS document_attachments_appraisal_idx
  ON document_attachments (appraisal_id, category, created_at DESC)
  WHERE appraisal_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS document_attachments_category_idx
  ON document_attachments (category, created_at DESC)
  WHERE archived_at IS NULL;

COMMENT ON TABLE document_attachments IS
  'PDFs / images / scans linked to ONE business entity (customer, product, '
  'transaction, or appraisal). Bytes live in R2; rows are forensic context. '
  'Soft-delete via archived_at — never hard delete (evidentiary).';

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Role grants
-- ═════════════════════════════════════════════════════════════════════════

/* internal_tasks — app needs INSERT + SELECT + narrow UPDATE on the
   editable columns. SELECT + INSERT come from migration 0003 default privs;
   UPDATE is column-locked here so fiscal anchors (created_by_user_id,
   created_at) cannot be retroactively rewritten. */
GRANT UPDATE (
  title, description, priority, status,
  assigned_to_user_id, due_date,
  started_at, completed_at, cancelled_at, cancellation_reason,
  related_entity_table, related_entity_id,
  updated_at
) ON internal_tasks TO warehouse14_app;

/* document_attachments — app may flip archived_at + edit notes only.
   r2_key / size / sha256 / category / link columns are write-once. */
GRANT UPDATE (archived_at, notes) ON document_attachments TO warehouse14_app;

/* Worker role — SELECT only (future virus-scan job needs to read R2 keys). */
GRANT SELECT ON internal_tasks         TO warehouse14_worker;
GRANT SELECT ON document_attachments   TO warehouse14_worker;

COMMIT;
