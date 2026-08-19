-- Migration 0030 — mcp_tool_invocations (Phase 2.A Werkzeugprotokoll; Tabelle ausgezogen mit 0149)
--
-- WHY
-- ───
-- Jeder Fernwerkzeug-Aufruf that mutates Warehouse14 data must be auditable:
--   • GoBD §146 — operator-of-record on every fiscal-adjacent change
--   • DSGVO Art. 5 (1) (f) — integrity + traceability of personal data
--                            processing
--   • Owner sanity — if the LLM hallucinates an SEO description into
--                    production, we want a row that says "tool X, by
--                    actor Y, at time Z, with arguments {A, B}".
--
-- This table is the SINGLE log every Fernwerkzeug-Handler writes to. Future
-- tools that touch products / customers / appraisals MUST emit a row
-- here BEFORE applying their side-effect. The mcp/ server has a single
-- `recordInvocation` helper to make this hard to forget.
--
-- WHAT
-- ────
-- Append-only audit log keyed by ULID-ish UUID. Captures:
--   • Tool identity      → `tool_name`
--   • Fernwerkzeug request id     → `request_id` (client-supplied JSON-RPC id;
--                          UUID so it can be matched across logs)
--   • Actor              → `actor_user_id` (NULL for unauthenticated
--                          test runs; production requires ADMIN)
--   • Input              → `arguments` JSONB
--   • Output             → `result` JSONB (NULL on error)
--   • Error              → `error_code` + `error_message`
--   • Cost / latency     → `latency_ms`, `tokens_in`, `tokens_out`,
--                          `cost_usd_micros` (BIGINT μ-dollars; 1 USD
--                          = 1 000 000 μ$). Lets us bill / cap per-day
--                          spend without floats.
--   • Outcome            → `outcome` enum (SUCCESS, FAILED, REJECTED).
--
-- WHAT THIS TABLE IS NOT
-- ──────────────────────
-- Not a queue. Tool handlers run synchronously inside the HTTP request.
-- Not a cache. The result lives here for AUDIT, not for replay.
--
-- DURATION
-- ────────
-- Single CREATE TABLE + 3 indexes. < 100 ms on the salon DB.

BEGIN;

CREATE TYPE mcp_invocation_outcome AS ENUM ('SUCCESS', 'FAILED', 'REJECTED');

COMMENT ON TYPE mcp_invocation_outcome IS
  'Phase 2.A — terminal state of a Fernwerkzeug invocation. SUCCESS: tool ran '
  'and committed. FAILED: handler threw (model error, validation, etc.). '
  'REJECTED: actor not authorised OR rate-limited (handler never ran).';

CREATE TABLE IF NOT EXISTS mcp_tool_invocations (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

  tool_name           TEXT            NOT NULL,
  request_id          UUID            NOT NULL,
  actor_user_id       UUID            REFERENCES users(id),

  arguments           JSONB           NOT NULL DEFAULT '{}'::jsonb,
  result              JSONB,

  outcome             mcp_invocation_outcome NOT NULL,
  error_code          TEXT,
  error_message       TEXT,

  latency_ms          INTEGER         NOT NULL,
  tokens_in           INTEGER,
  tokens_out          INTEGER,
  cost_usd_micros     BIGINT,

  -- The tool's side-effect — typically the id of the row the tool
  -- mutated. NULL for tools that don't write (e.g. read-only valuation).
  affected_entity_table TEXT,
  affected_entity_id    UUID,

  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- Outcome ↔ result invariants. SUCCESS must have a result; FAILED
  -- must NOT (otherwise the partial commit is hidden).
  CONSTRAINT mcp_tool_invocations_outcome_result_check CHECK (
    (outcome = 'SUCCESS' AND result IS NOT NULL AND error_code IS NULL)
    OR
    (outcome IN ('FAILED', 'REJECTED') AND error_code IS NOT NULL)
  )
);

COMMENT ON TABLE mcp_tool_invocations IS
  'Phase 2.A append-only audit log for every Model Context Protocol tool '
  'call. Written by the mcp/ server BEFORE the tool''s side-effect commits, '
  'updated AFTER with the result. Read by the operator UI (future) for an '
  '"Werkzeugprotokoll"-Ansicht and by the worker for daily-cost reports.';

COMMENT ON COLUMN mcp_tool_invocations.request_id IS
  'JSON-RPC 2.0 request id (UUID). The Fernwerkzeug-Endpunkt echoes this back to the '
  'client so error-trace correlation works.';

COMMENT ON COLUMN mcp_tool_invocations.cost_usd_micros IS
  'Inference cost in μ-dollars (1 USD = 1 000 000 μ$). BIGINT keeps us off '
  'floats. Sum-grouped by day gives the running spend.';

-- Indexes — read patterns:
--   1. By tool + recency: "show me the last 50 generate_seo_description calls"
--   2. By actor + recency: "what did user X do yesterday"
--   3. Daily cost: SUM(cost_usd_micros) GROUP BY date(created_at)
CREATE INDEX IF NOT EXISTS mcp_tool_invocations_tool_recent_idx
  ON mcp_tool_invocations (tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS mcp_tool_invocations_actor_recent_idx
  ON mcp_tool_invocations (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mcp_tool_invocations_daily_cost_idx
  ON mcp_tool_invocations (created_at)
  WHERE cost_usd_micros IS NOT NULL;

COMMIT;
