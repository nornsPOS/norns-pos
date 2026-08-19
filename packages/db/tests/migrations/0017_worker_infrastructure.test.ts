/**
 * Migration 0017 — Worker infrastructure.
 *
 * Focused tests:
 *   • worker_job_status enum has the 5 expected labels
 *   • worker_job_runs CHECK: status=RUNNING ⇔ finished_at IS NULL
 *   • worker_job_runs CHECK: error_message only when FAILED|TIMEOUT
 *   • worker_job_dlq CHECK: ack pair (acked_at ⇔ acked_by_user_id)
 *   • Role grants — worker role can INSERT/UPDATE on its tables, app cannot INSERT
 *   • Role grants — worker can DELETE expired sessions, app cannot
 *   • Role grants — worker has narrow column UPDATEs (products, dsfinvk_exports)
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

const WORKER_PW = 'warehouse14_worker_test_pw';
const APP_PW = 'warehouse14_app_test_pw';

describe('migration 0017_worker_infrastructure', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let workerSql: Sql;
  let appSql: Sql;

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 17);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD '${APP_PW}'`);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_worker PASSWORD '${WORKER_PW}'`);

    const host = testDb.container.getHost();
    const port = testDb.container.getPort();
    workerSql = postgres({
      host,
      port,
      database: 'warehouse14_test',
      username: 'warehouse14_worker',
      password: WORKER_PW,
      max: 2,
      onnotice: () => {},
    });
    appSql = postgres({
      host,
      port,
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: APP_PW,
      max: 2,
      onnotice: () => {},
    });
  });

  afterAll(async () => {
    await workerSql.end({ timeout: 5 }).catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. Enum + CHECKs
  // ────────────────────────────────────────────────────────────────────

  describe('worker_job_status enum', () => {
    it('has 5 labels in the expected order', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'worker_job_status' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'RUNNING',
        'SUCCESS',
        'FAILED',
        'TIMEOUT',
        'SKIPPED',
      ]);
    });
  });

  describe('worker_job_runs CHECKs', () => {
    it('refuses RUNNING with finished_at set', async () => {
      await expect(
        migratorSql`
          INSERT INTO worker_job_runs (job_name, status, finished_at)
          VALUES ('test_job', 'RUNNING'::worker_job_status, now())`,
      ).rejects.toThrow(/worker_job_runs_finished_iff_terminal/);
    });

    it('refuses SUCCESS without finished_at', async () => {
      await expect(
        migratorSql`
          INSERT INTO worker_job_runs (job_name, status, finished_at)
          VALUES ('test_job', 'SUCCESS'::worker_job_status, NULL)`,
      ).rejects.toThrow(/worker_job_runs_finished_iff_terminal/);
    });

    it('refuses error_message on SUCCESS', async () => {
      await expect(
        migratorSql`
          INSERT INTO worker_job_runs (job_name, status, finished_at, error_message)
          VALUES ('test_job', 'SUCCESS'::worker_job_status, now(), 'oops')`,
      ).rejects.toThrow(/worker_job_runs_error_only_when_failing/);
    });

    it('accepts RUNNING row, then UPDATE to SUCCESS with finished_at', async () => {
      const [row] = await migratorSql<{ id: string }[]>`
        INSERT INTO worker_job_runs (job_name, status)
        VALUES ('happy_path', 'RUNNING'::worker_job_status)
        RETURNING id`;
      await migratorSql`
        UPDATE worker_job_runs
           SET status = 'SUCCESS'::worker_job_status, finished_at = now()
         WHERE id = ${row!.id}`;
      const [check] = await migratorSql<{ status: string; finished_at: Date }[]>`
        SELECT status, finished_at FROM worker_job_runs WHERE id = ${row!.id}`;
      expect(check!.status).toBe('SUCCESS');
      expect(check!.finished_at).toBeInstanceOf(Date);
    });
  });

  describe('worker_job_dlq CHECKs', () => {
    it('refuses acked_at without acked_by_user_id', async () => {
      await expect(
        migratorSql`
          INSERT INTO worker_job_dlq (job_name, failure_count, acked_at)
          VALUES ('test', 5, now())`,
      ).rejects.toThrow(/worker_job_dlq_ack_pair/);
    });

    it('refuses failure_count <= 0', async () => {
      await expect(
        migratorSql`
          INSERT INTO worker_job_dlq (job_name, failure_count)
          VALUES ('test', 0)`,
      ).rejects.toThrow(/worker_job_dlq_failure_count_pos/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. Worker role grants
  // ────────────────────────────────────────────────────────────────────

  describe('warehouse14_worker role grants', () => {
    it('worker CAN INSERT into worker_job_runs', async () => {
      await expect(
        workerSql`
          INSERT INTO worker_job_runs (job_name, status)
          VALUES ('worker_role_test', 'RUNNING'::worker_job_status)`,
      ).resolves.toBeDefined();
    });

    it('worker CAN INSERT into worker_job_dlq', async () => {
      await expect(
        workerSql`
          INSERT INTO worker_job_dlq (job_name, failure_count, last_error)
          VALUES ('test_dlq', 5, 'gave up')`,
      ).resolves.toBeDefined();
    });

    it('worker CAN DELETE expired sessions', async () => {
      const [u] = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', 'ADMIN'::user_role)
        RETURNING id`;
      const [s] = await migratorSql<{ id: string }[]>`
        INSERT INTO sessions (user_id, token, expires_at)
        VALUES (${u!.id}, ${`tok-${crypto.randomUUID()}`}, now() + interval '1 hour')
        RETURNING id`;
      await expect(workerSql`DELETE FROM sessions WHERE id = ${s!.id}`).resolves.toBeDefined();
    });

    it('worker CAN UPDATE products.status (reservation sweeper path)', async () => {
      const [p] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name,
                              reserved_by_channel, reserved_by_session_id, reserved_at,
                              reservation_expires_at, published_at)
        VALUES (${`SKU-${crypto.randomUUID()}`}, 'RESERVED'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '100.00', 'expired ring',
                'STOREFRONT'::reservation_channel, gen_random_uuid(), now(),
                now() - interval '1 minute', now())
        RETURNING id`;
      await expect(
        workerSql`
          UPDATE products
             SET status = 'AVAILABLE'::product_status,
                 reserved_by_channel    = NULL,
                 reserved_by_session_id = NULL,
                 reserved_by_user_id    = NULL,
                 reserved_at            = NULL,
                 reservation_expires_at = NULL
           WHERE id = ${p!.id}`,
      ).resolves.toBeDefined();
    });

    it('worker CANNOT UPDATE products.acquisition_cost_eur (intake-locked)', async () => {
      const [p] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name)
        VALUES (${`SKU-${crypto.randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '100.00', 'x')
        RETURNING id`;
      await expect(
        workerSql`UPDATE products SET acquisition_cost_eur = '99.99' WHERE id = ${p!.id}`,
      ).rejects.toThrow(/permission denied/i);
    });

    it('worker CAN INSERT into ledger_events (column-restricted)', async () => {
      await expect(
        workerSql`
          INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
          VALUES ('worker.test.event', 'worker_job_runs', gen_random_uuid(), '{"a":1}'::jsonb)`,
      ).resolves.toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. App role: read-only on worker tables, can ack DLQ
  // ────────────────────────────────────────────────────────────────────

  describe('warehouse14_app role on worker tables', () => {
    it('app CAN SELECT from worker_job_runs', async () => {
      await expect(appSql`SELECT 1 FROM worker_job_runs LIMIT 1`).resolves.toBeDefined();
    });

    it('app CANNOT INSERT into worker_job_runs', async () => {
      await expect(
        appSql`
          INSERT INTO worker_job_runs (job_name, status)
          VALUES ('app_should_not', 'RUNNING'::worker_job_status)`,
      ).rejects.toThrow(/permission denied/i);
    });

    it('app CAN UPDATE worker_job_dlq.acked_at (operator ack path)', async () => {
      const [u] = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'Op', 'ADMIN'::user_role)
        RETURNING id`;
      const [d] = await migratorSql<{ id: string }[]>`
        INSERT INTO worker_job_dlq (job_name, failure_count, last_error)
        VALUES ('test_app_ack', 5, 'manual op test')
        RETURNING id`;
      await expect(
        appSql`UPDATE worker_job_dlq
                  SET acked_at = now(), acked_by_user_id = ${u!.id}, ack_note = 'reviewed'
                WHERE id = ${d!.id}`,
      ).resolves.toBeDefined();
    });

    it('app CANNOT UPDATE worker_job_dlq.failure_count (only ack columns)', async () => {
      const [d] = await migratorSql<{ id: string }[]>`
        INSERT INTO worker_job_dlq (job_name, failure_count, last_error)
        VALUES ('test_app_no_failure_count', 5, 'x')
        RETURNING id`;
      await expect(
        appSql`UPDATE worker_job_dlq SET failure_count = 999 WHERE id = ${d!.id}`,
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Advisory-lock primitive — proves the pattern works
  // ────────────────────────────────────────────────────────────────────

  describe('pg_try_advisory_lock pattern', () => {
    it('two competing workers: one wins, other returns false', async () => {
      const LOCK_KEY = 999_888_777n; // arbitrary distinct constant
      // Hold the lock on workerSql (it is `max: 2`; we use one connection).
      const a = workerSql.reserve();
      const aSql = await a;
      try {
        const [first] = await aSql<[{ ok: boolean }]>`
          SELECT pg_try_advisory_lock(${LOCK_KEY}::bigint) AS ok`;
        expect(first!.ok).toBe(true);

        // Second worker tries — should fail.
        const b = workerSql.reserve();
        const bSql = await b;
        try {
          const [second] = await bSql<[{ ok: boolean }]>`
            SELECT pg_try_advisory_lock(${LOCK_KEY}::bigint) AS ok`;
          expect(second!.ok).toBe(false);
        } finally {
          bSql.release();
        }
      } finally {
        // Release the lock + the connection.
        await aSql`SELECT pg_advisory_unlock_all()`;
        aSql.release();
      }
    });
  });
});
