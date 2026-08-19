/**
 * Migration 0074 — KYC image storage R2 → local encrypted-at-rest.
 *
 * Asserts the column rename and — the compliance-critical part — that the
 * all-or-nothing `purgedConsistency` CHECK rejects a HALF-purged row on BOTH
 * arms with the renamed column: a LIVE row needs document_photo_storage_key
 * present; a purged SHELL needs it NULL. A missing arm would silently break
 * erasure in one direction.
 */
import crypto from 'node:crypto';

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

describe('migration 0074_kyc_local_storage', () => {
  let testDb: TestDb;
  let sql: Sql;

  async function makeCustomer(): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      WITH k AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Test Person'), (now() + interval '5 years')::date FROM k
      RETURNING id`;
    if (!row) throw new Error('makeCustomer: INSERT returned no row');
    return row.id;
  }

  async function makeAdmin(): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'Admin', 'ADMIN'::user_role)
      RETURNING id`;
    if (!row) throw new Error('makeAdmin: INSERT returned no row');
    return row.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    sql = testDb.migratorSql;
    await applyMigrations(sql, 74);
    await setAppPasswordForTest(sql);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it('renamed document_photo_r2_key → document_photo_storage_key (+ size column)', async () => {
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'kyc_documents' AND column_name LIKE 'document_photo%'`;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain('document_photo_storage_key');
    expect(names).toContain('document_photo_size_bytes');
    expect(names).not.toContain('document_photo_r2_key');
  });

  it('accepts a valid LIVE row', async () => {
    const customerId = await makeCustomer();
    const userId = await makeAdmin();
    await expect(
      sql`
        WITH k AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO kyc_documents (
          customer_id, document_type, issuing_country_iso2,
          document_number_encrypted, expires_on,
          document_photo_storage_key, document_photo_sha256, document_photo_size_bytes,
          captured_by_user_id, retention_until)
        SELECT ${customerId}, 'PERSONALAUSWEIS'::id_document_type, 'DE',
               encrypt_pii('IDN-1'), '2030-01-01'::date,
               ${crypto.randomUUID()}, sha256('photo'::bytea), 1234,
               ${userId}, '2031-01-01'::date FROM k`,
    ).resolves.toBeDefined();
  });

  it('rejects a LIVE row missing the storage key (live arm)', async () => {
    const customerId = await makeCustomer();
    const userId = await makeAdmin();
    await expect(
      sql`
        WITH k AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO kyc_documents (
          customer_id, document_type, issuing_country_iso2,
          document_number_encrypted, expires_on,
          document_photo_storage_key, document_photo_sha256,
          captured_by_user_id, retention_until)
        SELECT ${customerId}, 'PERSONALAUSWEIS'::id_document_type, 'DE',
               encrypt_pii('IDN-2'), '2030-01-01'::date,
               NULL, sha256('photo'::bytea),
               ${userId}, '2031-01-01'::date FROM k`,
    ).rejects.toThrow(/kyc_documents_purged_consistency/);
  });

  it('rejects a half-purged SHELL that still has the storage key (shell arm)', async () => {
    const customerId = await makeCustomer();
    const userId = await makeAdmin();
    await expect(
      sql`
        INSERT INTO kyc_documents (
          customer_id, document_type, issuing_country_iso2,
          document_number_encrypted, expires_on,
          document_photo_storage_key, document_photo_sha256,
          captured_by_user_id, retention_until,
          purged_at, purged_by_user_id)
        VALUES (${customerId}, 'PERSONALAUSWEIS'::id_document_type, 'DE',
                NULL, '2030-01-01'::date,
                ${crypto.randomUUID()}, NULL,        -- storage_key still set on a shell
                ${userId}, '2031-01-01'::date,
                now(), ${userId})`,
    ).rejects.toThrow(/kyc_documents_purged_consistency/);
  });

  it('accepts a LIVE → purged SHELL transition (all PII nulled in lock-step)', async () => {
    const customerId = await makeCustomer();
    const userId = await makeAdmin();
    const [row] = await sql<{ id: string }[]>`
      WITH k AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO kyc_documents (
        customer_id, document_type, issuing_country_iso2,
        document_number_encrypted, expires_on,
        document_photo_storage_key, document_photo_sha256, document_photo_size_bytes,
        captured_by_user_id, retention_until)
      SELECT ${customerId}, 'PERSONALAUSWEIS'::id_document_type, 'DE',
             encrypt_pii('IDN-3'), '2030-01-01'::date,
             ${crypto.randomUUID()}, sha256('photo'::bytea), 999,
             ${userId}, '2031-01-01'::date FROM k
      RETURNING id`;
    if (!row) throw new Error('transition test: INSERT returned no row');
    await expect(
      sql`
        UPDATE kyc_documents
           SET purged_at = now(), purged_by_user_id = ${userId},
               document_number_encrypted = NULL, document_photo_storage_key = NULL,
               document_photo_sha256 = NULL, document_photo_size_bytes = NULL
         WHERE id = ${row.id}`,
    ).resolves.toBeDefined();
  });
});
