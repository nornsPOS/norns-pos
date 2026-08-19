# Warehouse14 — DB migrations

Numerically-ordered SQL migrations. Applied via `pnpm db:migrate` from
`packages/db`, which delegates to `drizzle-kit migrate`.

## Discipline (per ADR-0008 §9)

1. **One logical concern per file.** Splitting or merging a committed migration
   is forbidden — append a new migration instead.
2. **Never modify a committed migration.** If a schema change is needed, add
   the next-numbered migration that `ALTER`s.
3. **Idempotent where possible.** `CREATE … IF NOT EXISTS` and `DO`/`EXISTS`
   guards. Idempotency is a strong preference; not every DDL supports it.
4. **Transactional per file.** Every migration is wrapped in `BEGIN`/`COMMIT`
   so a syntax error or constraint failure rolls back cleanly.
5. **Run as `warehouse14_migrator`.** The runtime `warehouse14_app` role has
   no DDL privileges. Pointing `DATABASE_URL` at the app role would fail
   migrations with `permission denied` — which is the intended safety net.

## Roster

| # | File | Concern | ADR |
|---|------|---------|-----|
| 0001 | `0001_extensions.sql` | pgcrypto, vector, citext, btree_gist, pg_stat_statements | ADR-0008 §9, ADR-0016 §6.bis, ADR-0020 §2 |
| 0002 | `0002_helpers.sql` | `berlin_business_day()` (IMMUTABLE), `set_updated_at()` trigger fn | ADR-0008 §7 §8 |
| 0003 | `0003_roles.sql` | `warehouse14_app`, `warehouse14_security`, default-deny grants | ADR-0008 §3, ADR-0018 §10 |
| 0004 | `0004_auth.sql` | users + devices + accounts + sessions + verifications + two_factors + Basel Day-2 grants | ADR-0006, ADR-0009, ADR-0014 §2, ADR-0008 §3 |
| 0005 | `0005_reference.sql` | tax_treatment_codes (4 BMF codes) + karat_grades (5 DIN 17760 grades) + hallmarks (17 stamps) + SELECT-only app grants | ADR-0008 §4, ADR-0015 §7, memory.md §7 |
| 0006 | `0006_products.sql` | products + product_photos + 4-state machine CHECKs + atomic reservation envelope + pgvector(1536) + HNSW partial index + intake-locked column grants | ADR-0016 §1 §2 §6.bis, ADR-0015 §7 |
| 0007 | `0007_customers_kyc.sql` | customers + kyc_documents + encrypt_pii/decrypt_pii/blind_index helpers + GwG/§259 evidence schema + GDPR soft-delete + sanctions/PEP flags + cumulative spend (trigger-only) | ADR-0007, ADR-0008 §3 §10, ADR-0018 §6 |
| 0008 | `0008_audit_chain.sql` | ledger_events + SHA-256 hash-chain trigger (SECURITY DEFINER, owned by warehouse14_security) + advisory-lock serialization + verify_ledger_chain() + audit_log (append-only) + column-restricted INSERT for app role | ADR-0008 §1 §2 §10, ADR-0018 §10 |
| 0009 | `0009_transactions.sql` | transactions + transaction_items + transaction_payments + storno-validation trigger + on_transaction_finalized SECURITY DEFINER trigger (cumulative spend + ledger emit) — the **Great Connection** | ADR-0008 §5 §6, ADR-0016 §1, ADR-0015 §7 |
| 0010 | `0010_tse.sql` | tse_transactions (Fiskaly SIGN DE V2 state machine: QUEUED_OFFLINE → ACTIVE → FINISHED / CANCELLED / FAILED) + transition trigger + signature-immutability-after-FINISHED + on_tse_state_event SECURITY DEFINER trigger (ledger emit) | ADR-0014, ADR-0018 §3, memory.md §3 |
| 0011 | `0011_closing.sql` | daily_closings (Z-report, immutable after FINALIZED, ledger checkpoint anchor) + dsfinvk_exports (legal paper trail, GENERATING→GENERATED→DELIVERED) + system_settings (with SECURITY DEFINER audit trigger to audit_log) + seed data | ADR-0008 §Known limits #2, ADR-0014, ADR-0018 §3, ADR-0019 §6 §9 |
| 0012 | `0012_appointments.sql` | Smart Appointment System: 4 types × 8 statuses + staff_working_hours / time_off / shop_holidays capacity model + available_slots() STABLE PARALLEL SAFE DST-correct + auto-soft-hold trigger SECURITY DEFINER + state-machine validation + ledger emit | ADR-0020, ADR-0016 §6, ADR-0018 §7 |
| 0013 | `0013_security_hardening.sql` | Red Team Audit fixes: ANKAUF-requires-customer CHECK + sanctions hard-block BEFORE INSERT trigger + FINALIZED closing-day guard BEFORE INSERT trigger + auto-release viewing-holds on terminal appointment states + partial UNIQUE on storno_of_transaction_id + partial UNIQUE on appointments.linked_transaction_id + pg_notify('warehouse14_ledger') substrate for SSE | ADR-0007, ADR-0008 §5, ADR-0014 §4, ADR-0016 §6, ADR-0018 §6, ADR-0020 §6, `docs/architecture/RED_TEAM_AUDIT_2026-05-25.md` |
| 0014 | `0014_owner_and_pos_pin.sql` | Owner UX foundation: `users.is_owner` partial-UNIQUE flag (exactly one Owner) + `users_owner_implies_admin` CHECK + `users.pos_pin_hash`/`pos_pin_set_at`/`pos_pin_failed_attempts`/`pos_pin_locked_until` for argon2id POS PIN auth + `sessions.last_pin_step_up_at` for sensitive-action step-up + column-level UPDATE grants (PIN columns writable by app, `is_owner` deliberately not) | ADR-0022 |
| 0015 | `0015_product_management.sql` | Product Management deltas (Day 16): `product_condition` enum (6 values: NEW / USED_EXCELLENT / USED_GOOD / USED_FAIR / ANTIQUE_RESTORED / ANTIQUE_AS_FOUND) + `is_commission` (Kommissionsware, intake-locked) + `acquired_from_customer_id` (Ankauf provenance FK to customers, intake-locked) + `archived_at` (SOLD-only CHECK + sold_at-ordering CHECK) + indexes (acquired-from / active / archived / commission-active / condition-available) + narrow grants (condition + archived_at writable; is_commission + acquired_from_customer_id explicitly REVOKE'd) | docs/architecture/RED_TEAM_API_AUDIT_2026-05-25.md + product-management notes |
| 0016 | `0016_debt_and_balance.sql` | 3rd-party audit fixes (Day 17): `customers.cumulative_debt_eur` with non-negative CHECK + BEFORE INSERT trigger `transaction_payments_debt_requires_customer` (refuses DEBT without customer_id) + AFTER INSERT trigger `transaction_payments_accumulate_debt` (bumps cumulative_debt_eur on DEBT rows; storno reverses via negative amount) + CONSTRAINT TRIGGER `verify_transaction_balance` DEFERRABLE INITIALLY DEFERRED on transactions/items/payments (Σ items = total = Σ payments AND ≥1 item AND ≥1 payment at COMMIT — bypass-proof balance invariant) | docs/architecture/RED_TEAM_API_AUDIT_2026-05-25.md (3rd-party addendum) |
| 0017 | `0017_worker_infrastructure.sql` | apps/worker substrate (Day 18): `warehouse14_worker` role (default-deny, narrow UPDATE grants on operational tables) + `worker_job_status` enum (RUNNING/SUCCESS/FAILED/TIMEOUT/SKIPPED) + `worker_job_runs` (per-attempt history with CHECK invariants) + `worker_job_dlq` (dead-letter queue with ack pair) + indexes for "last successful run", "stuck RUNNING", "unacked DLQ". App role gets SELECT-only + UPDATE on DLQ ack columns. **Supersedes ADR-0001 #14 BullMQ+Redis** for V1 (single-instance ADR-0012). | memory.md decision #63 |
| 0018 | `0018_storefront_commerce.sql` | E-commerce engine (Day 19): 5 new enums (`cart_status`, `payment_provider`, `payment_intent_status`, `sales_channel`, `shipping_status`) + `shoppers` (B2C 1:1 with customers, pgcrypto-encrypted addresses, argon2id password, partial UNIQUE email-when-active) + `shopper_sessions` (separate from staff `sessions`) + `carts` (one ACTIVE per shopper, CHECKOUT evidence CHECK) + `cart_items` (one-product-per-cart UNIQUE, unit_price snapshot) + `payment_intents` (provider+intent_id UNIQUE) + `webhook_events` (provider+event_id UNIQUE — closes Phase 1.5 I-3 idempotency) + transactions.{sales_channel, shipping_status, shipping_address_encrypted, shipping_carrier, tracking_number} + channel/shipping CHECK (POS⇒NOT_REQUIRED, WEB⇒requires shipping). Worker role grants for the reservation_sweeper to release expired CHECKOUT carts. | memory.md decisions #64 + #65 |
| 0019 | `0019_retail_compliance.sql` | Ultimate Retail Core (Day 21): 6 new enums (shift_status, cash_movement_direction, voucher_type/status, inventory_session_status, inventory_scan_match) + payment_method += TRADE_IN + `shifts` (per-device-per-cashier, Blindsturz with generated variance_eur, one OPEN per device) + `cash_movements` (Bank Drop / Safe Transit / Injection / Opening / Closing) + `vouchers` + `voucher_redemptions` (SINGLE/MULTI_PURPOSE VAT per § 3 Abs. 14 UStG) + `inventory_sessions` (one OPEN globally) + `inventory_scans` (5-state match) + `whatsapp_inbound_messages` (UNIQUE meta_message_id) + transactions.{paired_with_transaction_id, returned_at, suspicious_aml_flag*, receipt_*, shift_id} + transaction_items.{line_discount_eur, line_discount_reason} + transaction_payments.trade_in_ankauf_transaction_id + 15+ CHECK constraints. | memory.md decision #67 |
| 0020 | `0020_konvolut_appraisals_lagerort.sql` | Estate business foundation (Day 22): closes audit gaps #2 (Konvolut), #10 (Bewertung), #1.location. products extensions: `parent_product_id UUID REFERENCES products(id)` (self-FK, 1-level depth enforced by `enforce_no_grandparent` trigger) + 3-column Lagerort (location_storage_unit, location_drawer, location_position, location_assigned_at) + composite index `products_location_idx`. New `appraisal_status` enum (DRAFT/COMPLETED/ACCEPTED/REJECTED/EXPIRED) + `appraisals` (customer_id, appraised_by_user_id, total_offered_eur lump-sum, customer_expectation_eur, ankauf_transaction_id UNIQUE, 4 CHECKs for state machine evidence) + `appraisal_items` (per-piece valuation, photo_r2_keys[], product_id NULLABLE until ACCEPTED). Pro-rata cost allocation on ACCEPTED preserves §25a margin integrity per item (Basel's choice). | memory.md decision #68 |
| 0021 | `0021_metal_prices_engine.sql` | Edelmetall-Kursmodul (Day 23): closes audit gap #4. `metal_price_source` enum (LBMA / XAUEUR_VENDOR / MANUAL / INTERNAL_ESTIMATE) + `metal_prices` (append-only history with partial UNIQUE `(metal) WHERE valid_to IS NULL` → exactly one CURRENT row per metal, manual-evidence CHECK + payload-object CHECK + valid-range CHECK) + products extensions: `feingewicht_grams NUMERIC(10,4) GENERATED ALWAYS AS (weight × fineness) STORED` + `collector_premium_eur NUMERIC(18,2)` with ≥ 0 CHECK + partial index `products_feingewicht_idx` (AVAILABLE/RESERVED). SQL helpers `current_metal_price_eur_per_gram(text)` + `product_schmelzwert_eur(uuid)` (both STABLE, locked `search_path`). Worker + app role grants for the close-out + insert workflow. | memory.md decision #69 |
| 0022 | `0022_photo_ebay_workflow.sql` | Photo workflow + eBay listing state machine (Day 24): closes audit gaps #3 (Foto-Workflow) and #9 (eBay 9-state). **(A)** `photo_workflow_state` enum (`FOTOGRAFIERT \| BEARBEITET \| FREIGESTELLT \| ZUGEORDNET \| FUER_EBAY_BEREIT`) + product_photos.product_id becomes NULLABLE; new columns workflow_state / workflow_changed_at / workflow_changed_by_user_id; CHECKs `product_photos_assigned_state_has_product` (≥ ZUGEORDNET requires product_id) + `product_photos_bg_removed_state_has_key` (≥ FREIGESTELLT requires r2_key_bg_removed) + `product_photos_orphan_not_primary`; one-primary partial UNIQUE rescoped to assigned photos. New `product_photo_workflow_events` append-only event log. `photo_source` enum gains `photographer` + `phone_intake`. **(B)** `ebay_listing_state` enum with 9 Owner-defined stages (`ENTWURF \| GEPRUEFT \| ONLINE \| VERKAUFT \| BEZAHLT \| VERPACKT \| VERSENDET \| REKLAMIERT \| RETOURNIERT`) + products.ebay_state + ebay_state_changed_at + backfill from listed_on_ebay=TRUE → ebay_state='ONLINE'. New `product_ebay_listing_events` append-only log with source CHECK (OWNER / EBAY_WEBHOOK / WORKER / SYSTEM) + payload-object CHECK + OWNER-requires-user CHECK. **(C)** Cross-system trigger `enforce_ebay_sold_reserves_locally` (SECURITY DEFINER, owned by warehouse14_security, BEFORE UPDATE OF ebay_state): when state enters VERKAUFT / BEZAHLT / VERPACKT / VERSENDET, AVAILABLE → auto-RESERVE via EBAY channel (+7 days), RESERVED-by-EBAY → no-op, RESERVED-by-POS/STOREFRONT → leave + emit `alert.ebay_sale_conflict`, SOLD → leave + emit `alert.ebay_double_sale_attempt`. Role grants for both event logs (INSERT + SELECT to app + worker) + column-level UPDATE on products.ebay_state. | memory.md decision #70 |
| 0024 | `0024_customer_trust_belegtext.sql` | **Backend Finale (Day 26)**: closes audit gap #7 (Kundenhistorie + Trust) and the legal-text slice of #5 (Belegtexte). **(A)** `customer_trust_level` enum (NEW / VERIFIED / VIP / SUSPICIOUS / BANNED) + customers extensions: trust_level + kyc_verified_at + kyc_verified_by_user_id + price_expectation_notes. CHECKs: `customers_kyc_verified_evidence` (both-or-none), `customers_verified_trust_requires_kyc` (no promotion past NEW without a physical-ID stamp), `customers_banned_or_suspicious_has_note` (≥ 8-char rationale required). Partial index `customers_trust_active_idx` on (VIP, SUSPICIOUS, BANNED) for hot-path watch-lists. **(B)** `belegtext_kind` enum (8 values) + `belegtext_templates` (append-only versioning, partial UNIQUE `(kind, language) WHERE valid_to IS NULL`, body-length + language-format + valid-range CHECKs). **Seed at migration time** of 4 mandatory German texts (MARGIN_25A / STANDARD_19 / REDUCED_7 / INVESTMENT_GOLD_25C) + GENERIC_HEADER + GENERIC_FOOTER + ANKAUFBELEG_DECLARATION (GwG § 8). **(C)** `resolve_belegtext_for_tax_treatment(text, text)` SQL helper (STABLE, locked search_path) — maps tax_treatment_codes.code → current belegtext body. **(D)** Role grants: app gets column-restricted UPDATE on customers' trust columns + belegtext_templates.valid_to (close-out path); worker gets SELECT only. **After this migration: Phase 1 backend is officially FROZEN.** | memory.md decision #72 |
| 0023 | `0023_tasks_documents.sql` | Single-Operator Assistance (Day 25): closes audit gaps #8 (Aufgaben) and #9 (Dokumentenablage). **(A)** `task_priority` enum (LOW / NORMAL / HIGH / URGENT) + `task_status` enum (OPEN / IN_PROGRESS / BLOCKED / DONE / CANCELLED) + `internal_tasks` (title, description, priority, status, assigned_to_user_id NOT NULL, created_by_user_id NOT NULL, due_date, started_at / completed_at / cancelled_at + cancellation_reason, polymorphic related_entity_table + related_entity_id with whitelist CHECK). 6 state-machine CHECKs: IN_PROGRESS-has-started, DONE-has-completion, CANCELLED-has-reason (≥ 4 chars), OPEN-no-timestamps, terminal-not-both, related-both-or-none. Hot-path indexes "my open tasks" + due-soon + per-entity + status. Updated_at auto-touch via set_updated_at(). **(B)** `document_category` enum (AUSWEIS / ANKAUFBELEG / RECHNUNG / EXPERTISE / ZERTIFIKAT / VERSANDBELEG) + `document_attachments` (r2_key + file_name + mime_type + size_bytes + optional sha256_hex; polymorphic exactly-one of customer/product/transaction/appraisal enforced by CHECK; category-specific link discipline: AUSWEIS⇒customer, VERSANDBELEG⇒transaction, EXPERTISE⇒appraisal-or-product, ANKAUFBELEG/RECHNUNG⇒customer-or-transaction; soft-delete via archived_at). Hot-path partial indexes per linked entity. **(C)** Role grants: app gets column-restricted UPDATE on internal_tasks (write-once on created_by_user_id + created_at) and document_attachments.archived_at + notes (r2_key + size are write-once). Worker SELECT-only on both. **Auto-fill design (TypeScript, NOT SQL):** route layer fills assigned_to_user_id ← req.actor.id when omitted, keeping the DB schema multi-user-ready for zero-migration team expansion. | memory.md decision #71 |
| 0032 | `0032_fix_categories_security_grant.sql` | Permissions follow-up to 0025: `GRANT SELECT ON categories TO warehouse14_security` so the SECURITY DEFINER trigger `enforce_no_grandparent_category()` (owned by warehouse14_security) can read `parent_id` when invoked by non-app roles (warehouse14_migrator seed scripts, warehouse14_worker). Without this grant, child-category INSERTs via any non-app role failed with `42501 permission denied for table categories` from inside the trigger. Single-statement, idempotent. | ADR-0008 §3, ADR-0018 §10 |

## Bootstrap prerequisites

Before the very first `pnpm db:migrate` run, the database must already have a
`warehouse14_migrator` role with `CREATEROLE` privilege. The migrations
intentionally do NOT create the migrator role (chicken-and-egg).

- **Local dev:** the role is created automatically on `docker compose up` by
  `infrastructure/docker/postgres/initdb.d/00-create-migrator-role.sh`.
  Postgres only runs `initdb.d` scripts on a fresh data volume; to re-run on
  an existing volume, `docker compose down -v` first.
- **Production:** `scripts/bootstrap-oracle.sh` (ADR-0012 §9) provisions the
  role once when the Oracle VM is first set up.

## Secrets discipline (per ADR-0012 §7)

These migrations do **not** set passwords on any role they create. Passwords
are applied separately:

- **Local dev:** `infrastructure/docker/postgres/initdb.d/01-set-app-password.sh`.
- **Production:** the deploy bootstrap sources passwords from Oracle Vault and
  runs `ALTER ROLE warehouse14_app PASSWORD :app_password`.

Committing a password into a SQL file would leak it into git history forever.
This is enforced by the security review in every migration PR.

## Testing

Each migration has a matching integration test in
`packages/db/tests/migrations/`. Tests use `@testcontainers/postgresql` to
spin up a fresh `postgres:17-alpine` container per suite and apply the
migrations against it. The same SQL that production runs is the SQL the
tests run; there is no test-mode divergence.

Run all migration tests:

```bash
pnpm --filter @norns/db test
```

Requires Docker daemon reachable.
