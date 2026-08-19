-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0001 — Extensions
--
-- Purpose: enable the PostgreSQL extensions used by every downstream migration.
-- Idempotent: CREATE EXTENSION IF NOT EXISTS.
-- Transactional: wrapped in BEGIN/COMMIT so a partial install rolls back.
--
-- ADR references:
--   • ADR-0008 §2  — pgcrypto for SHA-256 in the ledger hash chain trigger
--   • ADR-0008 §10 — pgcrypto for column-level PII encryption (customers/kyc)
--   • ADR-0016 §6.bis — pgvector for product embeddings + HNSW similarity
--   • ADR-0020 §2  — btree_gist for slot-overlap exclusion constraints
--   • ADR-0012 §6  — pg_stat_statements for Grafana query observability
--
-- Prerequisites:
--   • Connection runs as warehouse14_migrator (or local-dev superuser).
--   • pg_stat_statements requires shared_preload_libraries='pg_stat_statements'
--     in postgresql.conf — set in ADR-0012 §4. If absent the EXTENSION still
--     creates but no stats are collected.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- pgcrypto
-- Provides:
--   • digest(text|bytea, 'sha256') — used by the ledger BEFORE INSERT trigger
--     to compute prev_hash and row_hash (ADR-0008 §2).
--   • gen_random_uuid() — DEFAULT on UUID primary keys across the schema.
--   • pgp_sym_encrypt() / pgp_sym_decrypt() — column-level PII encryption
--     in customers and kyc_documents (ADR-0008 §10 wall #5).
-- ─────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────
-- vector  (pgvector)
-- Provides:
--   • vector(N) column type — products.embedding vector(1536).
--   • Distance operators (<=>) cosine, (<->) L2, (<#>) inner product.
--   • HNSW + IVFFLAT index access methods.
-- Used by:
--   • ADR-0016 §6.bis intelligent walk-in compensation (cosine similarity
--     over AVAILABLE products, same tax_treatment_code).
--   • ADR-0017 bot tool `search_inventory` (semantic search).
-- ─────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────
-- citext
-- Provides:
--   • citext column type — case-insensitive text comparison.
-- Used by:
--   • better-auth users.email (case-insensitive uniqueness — see migration 0004).
--   • Generally for any human-typed identifier that should compare without case.
-- ─────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS citext;

-- ─────────────────────────────────────────────────────────────────────
-- btree_gist
-- Provides:
--   • GiST operator classes for scalar types — enables EXCLUDE USING gist
--     constraints mixing equality and range/interval predicates.
-- Used by:
--   • ADR-0020 §2 staff capacity model — prevents double-booking the same
--     staff member at the same time via EXCLUDE (staff_user_id WITH =,
--     during WITH &&).
-- ─────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────────────────────────────────────────────────────
-- pg_stat_statements
-- Provides:
--   • Per-query execution statistics surfaced to postgres-exporter.
-- Used by:
--   • ADR-0012 §6 Grafana dashboards (p95 query latency, top-N expensive
--     queries, query plan regression detection).
-- ─────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

COMMIT;
