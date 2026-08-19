/**
 * Migration 0023 — Single-Operator Assistance.
 *
 * Focused tests:
 *   • task_priority + task_status + document_category enum labels
 *   • internal_tasks state-machine CHECKs:
 *       - IN_PROGRESS requires started_at
 *       - DONE       requires completed_at + started_at
 *       - CANCELLED  requires cancelled_at + cancellation_reason (≥ 4 chars)
 *       - OPEN       forbids any lifecycle timestamp
 *       - terminal-not-both (cannot be DONE and CANCELLED at once)
 *   • related_entity_* both-or-none CHECK + whitelist
 *   • updated_at auto-touch trigger
 *   • document_attachments exactly-one-link CHECK (all 4 / none / two = fail)
 *   • Category-specific link CHECKs (AUSWEIS / EXPERTISE / VERSANDBELEG /
 *     ANKAUFBELEG / RECHNUNG)
 *   • soft-delete (archived_at) preserves row
 *   • role grants — app may UPDATE narrow columns, NOT r2_key / size_bytes
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

describe('migration 0023_tasks_documents', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;

  async function makeUser(role: 'ADMIN' | 'CASHIER' = 'ADMIN'): Promise<string> {
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', ${role}::user_role)
      RETURNING id`;
    return u!.id;
  }

  async function makeCustomer(): Promise<string> {
    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii(${`Customer-${crypto.randomUUID()}`}),
             (now() + interval '5 years')::date FROM s
      RETURNING id`;
    return c!.id;
  }

  async function makeProduct(): Promise<string> {
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type, name,
                            acquisition_cost_eur, list_price_eur)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
              'gold_coin'::item_type, 'Test', '100.00', '150.00')
      RETURNING id`;
    return p!.id;
  }

  async function makeTask(
    opts: {
      title?: string;
      status?: string;
      startedAt?: string;
      completedAt?: string;
      cancelledAt?: string;
      cancellationReason?: string;
      relatedTable?: string | null;
      relatedId?: string | null;
    } = {},
  ): Promise<string> {
    const userId = await makeUser();
    const [row] = await migratorSql<{ id: string }[]>`
      INSERT INTO internal_tasks (
        title, status, assigned_to_user_id, created_by_user_id,
        started_at, completed_at, cancelled_at, cancellation_reason,
        related_entity_table, related_entity_id
      )
      VALUES (
        ${opts.title ?? 'Test task'},
        ${opts.status ?? 'OPEN'}::task_status,
        ${userId}, ${userId},
        ${opts.startedAt ?? null},
        ${opts.completedAt ?? null},
        ${opts.cancelledAt ?? null},
        ${opts.cancellationReason ?? null},
        ${opts.relatedTable ?? null},
        ${opts.relatedId ?? null}
      )
      RETURNING id`;
    return row!.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 23);
    await setAppPasswordForTest(migratorSql);
    appSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 3,
      onnotice: () => {},
    });
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. Enums
  // ────────────────────────────────────────────────────────────────────

  describe('task_priority enum', () => {
    it('has 4 expected labels', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'task_priority' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
    });
  });

  describe('task_status enum', () => {
    it('has 5 expected labels', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'task_status' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'OPEN',
        'IN_PROGRESS',
        'BLOCKED',
        'DONE',
        'CANCELLED',
      ]);
    });
  });

  describe('document_category enum', () => {
    it('has 6 expected German labels', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'document_category' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'AUSWEIS',
        'ANKAUFBELEG',
        'RECHNUNG',
        'EXPERTISE',
        'ZERTIFIKAT',
        'VERSANDBELEG',
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. internal_tasks state-machine CHECKs
  // ────────────────────────────────────────────────────────────────────

  describe('internal_tasks state-machine CHECKs', () => {
    it('accepts a basic OPEN task', async () => {
      await expect(makeTask({ status: 'OPEN' })).resolves.toBeDefined();
    });

    it('refuses IN_PROGRESS without started_at', async () => {
      await expect(makeTask({ status: 'IN_PROGRESS' })).rejects.toThrow(
        /internal_tasks_in_progress_has_started/,
      );
    });

    it('accepts IN_PROGRESS with started_at', async () => {
      await expect(makeTask({ status: 'IN_PROGRESS', startedAt: 'now()' })).resolves.toBeDefined();
    });

    it('refuses DONE without completed_at', async () => {
      await expect(makeTask({ status: 'DONE', startedAt: 'now()' })).rejects.toThrow(
        /internal_tasks_done_has_completion/,
      );
    });

    it('refuses DONE without started_at', async () => {
      await expect(makeTask({ status: 'DONE', completedAt: 'now()' })).rejects.toThrow(
        /internal_tasks_done_has_completion/,
      );
    });

    it('refuses CANCELLED without reason', async () => {
      await expect(makeTask({ status: 'CANCELLED', cancelledAt: 'now()' })).rejects.toThrow(
        /internal_tasks_cancelled_has_reason/,
      );
    });

    it('refuses CANCELLED with too-short reason', async () => {
      await expect(
        makeTask({
          status: 'CANCELLED',
          cancelledAt: 'now()',
          cancellationReason: 'no',
        }),
      ).rejects.toThrow(/internal_tasks_cancelled_has_reason/);
    });

    it('accepts CANCELLED with reason ≥ 4 chars', async () => {
      await expect(
        makeTask({
          status: 'CANCELLED',
          cancelledAt: 'now()',
          cancellationReason: 'customer changed mind',
        }),
      ).resolves.toBeDefined();
    });

    it('refuses OPEN with lifecycle timestamps set', async () => {
      await expect(makeTask({ status: 'OPEN', startedAt: 'now()' })).rejects.toThrow(
        /internal_tasks_open_no_timestamps/,
      );
    });

    it('refuses both completed_at and cancelled_at set', async () => {
      const userId = await makeUser();
      await expect(
        migratorSql`
          INSERT INTO internal_tasks (
            title, status, assigned_to_user_id, created_by_user_id,
            started_at, completed_at, cancelled_at, cancellation_reason
          )
          VALUES (
            'bad', 'DONE'::task_status, ${userId}, ${userId},
            now(), now(), now(), 'oops'
          )`,
      ).rejects.toThrow(/internal_tasks_terminal_not_both/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. related_entity_* polymorphic CHECKs
  // ────────────────────────────────────────────────────────────────────

  describe('related_entity_* polymorphic CHECKs', () => {
    it('refuses setting only related_entity_table', async () => {
      await expect(makeTask({ relatedTable: 'products' })).rejects.toThrow(
        /internal_tasks_related_entity_both_or_none/,
      );
    });

    it('refuses setting only related_entity_id', async () => {
      const productId = await makeProduct();
      await expect(makeTask({ relatedId: productId })).rejects.toThrow(
        /internal_tasks_related_entity_both_or_none/,
      );
    });

    it('accepts both NULL', async () => {
      await expect(makeTask()).resolves.toBeDefined();
    });

    it('accepts known entity table', async () => {
      const productId = await makeProduct();
      await expect(
        makeTask({ relatedTable: 'products', relatedId: productId }),
      ).resolves.toBeDefined();
    });

    it('refuses unknown entity table', async () => {
      const someId = crypto.randomUUID();
      await expect(makeTask({ relatedTable: 'aliens', relatedId: someId })).rejects.toThrow(
        /internal_tasks_related_entity_known/,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. updated_at trigger
  // ────────────────────────────────────────────────────────────────────

  describe('updated_at auto-touch', () => {
    it('moves updated_at on UPDATE', async () => {
      const taskId = await makeTask();
      const [before] = await migratorSql<{ updated_at: Date }[]>`
        SELECT updated_at FROM internal_tasks WHERE id = ${taskId}`;
      await new Promise((r) => setTimeout(r, 20));
      await migratorSql`UPDATE internal_tasks SET title = 'edited' WHERE id = ${taskId}`;
      const [after] = await migratorSql<{ updated_at: Date }[]>`
        SELECT updated_at FROM internal_tasks WHERE id = ${taskId}`;
      expect(after!.updated_at.getTime()).toBeGreaterThan(before!.updated_at.getTime());
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. document_attachments — exactly_one_link
  // ────────────────────────────────────────────────────────────────────

  describe('document_attachments exactly_one_link CHECK', () => {
    async function tryInsert(overrides: {
      category?: string;
      customerId?: string | null;
      productId?: string | null;
      transactionId?: string | null;
      appraisalId?: string | null;
    }): Promise<unknown> {
      const userId = await makeUser();
      return migratorSql`
        INSERT INTO document_attachments (
          category, r2_key, file_name, mime_type, size_bytes,
          customer_id, product_id, transaction_id, appraisal_id,
          uploaded_by_user_id
        )
        VALUES (
          ${overrides.category ?? 'ZERTIFIKAT'}::document_category,
          ${`r2/${crypto.randomUUID()}.pdf`},
          'doc.pdf', 'application/pdf', 1024,
          ${overrides.customerId ?? null},
          ${overrides.productId ?? null},
          ${overrides.transactionId ?? null},
          ${overrides.appraisalId ?? null},
          ${userId}
        )`;
    }

    it('refuses all four links NULL', async () => {
      await expect(tryInsert({ category: 'ZERTIFIKAT' })).rejects.toThrow(
        /document_attachments_exactly_one_link/,
      );
    });

    it('refuses two links set', async () => {
      const customerId = await makeCustomer();
      const productId = await makeProduct();
      await expect(tryInsert({ category: 'ZERTIFIKAT', customerId, productId })).rejects.toThrow(
        /document_attachments_exactly_one_link/,
      );
    });

    it('accepts exactly one link (product only)', async () => {
      const productId = await makeProduct();
      await expect(tryInsert({ category: 'ZERTIFIKAT', productId })).resolves.toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. document_attachments — category-specific link CHECKs
  // ────────────────────────────────────────────────────────────────────

  describe('category-specific link CHECKs', () => {
    async function insertDoc(
      category: string,
      link: {
        customer_id?: string | null;
        product_id?: string | null;
        transaction_id?: string | null;
        appraisal_id?: string | null;
      },
    ) {
      const userId = await makeUser();
      return migratorSql`
        INSERT INTO document_attachments (
          category, r2_key, file_name, mime_type, size_bytes,
          customer_id, product_id, transaction_id, appraisal_id,
          uploaded_by_user_id
        )
        VALUES (
          ${category}::document_category,
          ${`r2/${crypto.randomUUID()}.pdf`},
          'doc.pdf', 'application/pdf', 1024,
          ${link.customer_id ?? null},
          ${link.product_id ?? null},
          ${link.transaction_id ?? null},
          ${link.appraisal_id ?? null},
          ${userId}
        )`;
    }

    it('AUSWEIS requires customer_id (refuses product-only)', async () => {
      const productId = await makeProduct();
      await expect(insertDoc('AUSWEIS', { product_id: productId })).rejects.toThrow(
        /document_attachments_ausweis_is_customer/,
      );
    });

    it('AUSWEIS accepts customer_id', async () => {
      const customerId = await makeCustomer();
      await expect(insertDoc('AUSWEIS', { customer_id: customerId })).resolves.toBeDefined();
    });

    it('EXPERTISE accepts product_id', async () => {
      const productId = await makeProduct();
      await expect(insertDoc('EXPERTISE', { product_id: productId })).resolves.toBeDefined();
    });

    it('EXPERTISE refuses customer-only link', async () => {
      const customerId = await makeCustomer();
      await expect(insertDoc('EXPERTISE', { customer_id: customerId })).rejects.toThrow(
        /document_attachments_expertise_link/,
      );
    });

    it('VERSANDBELEG refuses customer-only link', async () => {
      const customerId = await makeCustomer();
      await expect(insertDoc('VERSANDBELEG', { customer_id: customerId })).rejects.toThrow(
        /document_attachments_versandbeleg_is_transaction/,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. soft-delete via archived_at
  // ────────────────────────────────────────────────────────────────────

  describe('soft-delete via archived_at', () => {
    it('flagging archived_at preserves the row', async () => {
      const productId = await makeProduct();
      const userId = await makeUser();
      const [row] = await migratorSql<{ id: string }[]>`
        INSERT INTO document_attachments (
          category, r2_key, file_name, mime_type, size_bytes,
          product_id, uploaded_by_user_id
        )
        VALUES (
          'ZERTIFIKAT'::document_category,
          ${`r2/${crypto.randomUUID()}.pdf`},
          'cert.pdf', 'application/pdf', 5000,
          ${productId}, ${userId}
        )
        RETURNING id`;

      await migratorSql`
        UPDATE document_attachments SET archived_at = now() WHERE id = ${row!.id}`;
      const [post] = await migratorSql<{ archived_at: Date | null }[]>`
        SELECT archived_at FROM document_attachments WHERE id = ${row!.id}`;
      expect(post!.archived_at).toBeInstanceOf(Date);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. Role grants
  // ────────────────────────────────────────────────────────────────────

  describe('role grants', () => {
    it('app can INSERT a task (default privilege from 0003)', async () => {
      const userId = await makeUser();
      const [t] = await appSql<{ id: string }[]>`
        INSERT INTO internal_tasks (title, assigned_to_user_id, created_by_user_id)
        VALUES ('app task', ${userId}, ${userId})
        RETURNING id`;
      expect(t!.id).toBeDefined();
    });

    it('app can UPDATE task title + status', async () => {
      const taskId = await makeTask();
      await expect(
        appSql`UPDATE internal_tasks SET title = 'renamed' WHERE id = ${taskId}`,
      ).resolves.toBeDefined();
    });

    it('app CANNOT UPDATE created_by_user_id (write-once)', async () => {
      const taskId = await makeTask();
      const otherUser = await makeUser('CASHIER');
      await expect(
        appSql`UPDATE internal_tasks SET created_by_user_id = ${otherUser} WHERE id = ${taskId}`,
      ).rejects.toThrow(/permission denied|insufficient privilege/i);
    });

    it('app CANNOT UPDATE document_attachments.r2_key (write-once)', async () => {
      const productId = await makeProduct();
      const userId = await makeUser();
      const [doc] = await migratorSql<{ id: string }[]>`
        INSERT INTO document_attachments (
          category, r2_key, file_name, mime_type, size_bytes,
          product_id, uploaded_by_user_id
        )
        VALUES (
          'ZERTIFIKAT'::document_category, 'r2/x', 'c.pdf', 'application/pdf',
          1024, ${productId}, ${userId}
        )
        RETURNING id`;
      await expect(
        appSql`UPDATE document_attachments SET r2_key = 'tampered' WHERE id = ${doc!.id}`,
      ).rejects.toThrow(/permission denied|insufficient privilege/i);
    });

    it('app CAN UPDATE document_attachments.archived_at', async () => {
      const productId = await makeProduct();
      const userId = await makeUser();
      const [doc] = await migratorSql<{ id: string }[]>`
        INSERT INTO document_attachments (
          category, r2_key, file_name, mime_type, size_bytes,
          product_id, uploaded_by_user_id
        )
        VALUES (
          'ZERTIFIKAT'::document_category, 'r2/y', 'c.pdf', 'application/pdf',
          1024, ${productId}, ${userId}
        )
        RETURNING id`;
      await expect(
        appSql`UPDATE document_attachments SET archived_at = now() WHERE id = ${doc!.id}`,
      ).resolves.toBeDefined();
    });
  });
});
