/**
 * Migration 0045 — blind_index() hmac() key-arg fix (forward migration).
 *
 * 0007 defined blind_index() with hmac(bytea_data, TEXT_key, 'sha256'); pgcrypto
 * has no hmac(bytea, text, …) overload, so EVERY call threw
 * "function hmac(bytea, text, unknown) does not exist". The per-migration 0007
 * test (pinned at upTo=7) correctly still shows that broken history — a forward
 * fix must NOT rewrite it.
 *
 * This suite reproduces the broken state (migrations 0001..0007) and then applies
 * ONLY 0045 on top (CREATE OR REPLACE) — exactly what a prod forward-migrate does
 * — and proves blind_index now works: deterministic, keyed, NULL-passthrough,
 * and the actual prod symptom (a customer carrying an email/phone can be saved
 * and looked up by hash). 0045 is applied on top of 0007 rather than via the full
 * chain because an UNRELATED later migration (belegtext_kind enum) can't apply
 * under the harness's one-transaction-per-file semantics — a separate pre-existing
 * issue, not blind_index.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';
const FIX_SQL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
  '0045_fix_blind_index_hmac.sql',
);

describe('migration 0045_fix_blind_index_hmac', () => {
  let testDb: TestDb;
  let sql: Sql;

  beforeAll(async () => {
    testDb = await startTestDb();
    sql = testDb.migratorSql;
    // Reproduce the broken state: blind_index() as 0007 defined it.
    await applyMigrations(sql, 7);
    // Apply ONLY the forward fix on top. If the file is absent (red-state proof),
    // leave the broken function in place so the assertions fail with the real
    // hmac error instead of skipping the whole suite.
    try {
      const fixSql = await readFile(FIX_SQL, 'utf8');
      await sql.unsafe('SET check_function_bodies = off');
      await sql.unsafe(fixSql);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    // Set the PII key session-wide (is_local=false) on the single pooled
    // connection (max:1) so every statement below sees the same key — the app
    // sets it per-request the same way.
    await sql`SELECT set_config('warehouse14.pii_key', ${PII_KEY}, false)`;
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it('blind_index is deterministic and non-null for the same input + key', async () => {
    const [row] = await sql<{ a: Buffer; b: Buffer }[]>`
      SELECT blind_index('erika@example.test') AS a,
             blind_index('erika@example.test') AS b
    `;
    expect(row?.a).not.toBeNull();
    expect(row?.a.length).toBe(32); // HMAC-SHA256 → 32 bytes
    expect(row?.a.equals(row?.b as Buffer)).toBe(true);
  });

  it('different inputs → different hashes', async () => {
    const [row] = await sql<{ a: Buffer; b: Buffer }[]>`
      SELECT blind_index('a@x.test') AS a, blind_index('b@x.test') AS b
    `;
    expect(row?.a.equals(row?.b as Buffer)).toBe(false);
  });

  it('same input under different keys → different hashes (the key is actually used)', async () => {
    const [first] = await sql<{ h: Buffer }[]>`SELECT blind_index('joe@x.test') AS h`;
    // Swap the session key, recompute, then restore so later tests are unaffected.
    await sql`SELECT set_config('warehouse14.pii_key', ${'a-totally-different-pii-key-value-9'}, false)`;
    const [second] = await sql<{ h: Buffer }[]>`SELECT blind_index('joe@x.test') AS h`;
    await sql`SELECT set_config('warehouse14.pii_key', ${PII_KEY}, false)`;
    expect(first?.h.equals(second?.h as Buffer)).toBe(false);
  });

  it('NULL input passes through as NULL', async () => {
    const [row] = await sql<{ h: Buffer | null }[]>`SELECT blind_index(NULL) AS h`;
    expect(row?.h).toBeNull();
  });

  it('the prod symptom is gone: a customer with email + phone can be saved and found by phone hash', async () => {
    const email = 'kunde@example.test';
    const phone = '+491701234567';
    const [inserted] = await sql<{ id: string }[]>`
      INSERT INTO customers (
        full_name_encrypted, email_encrypted, phone_encrypted,
        email_blind_index, phone_blind_index, retention_until
      )
      VALUES (
        encrypt_pii('Erika Mustermann'),
        encrypt_pii(${email}),
        encrypt_pii(${phone}),
        blind_index(${email.toLowerCase()}),
        blind_index(${phone}),
        (now() + interval '5 years')::date
      )
      RETURNING id
    `;
    expect(inserted?.id).toBeTruthy();

    const [found] = await sql<{ id: string }[]>`
      SELECT c.id FROM customers c
      WHERE c.phone_blind_index = blind_index(${phone})
    `;
    expect(found?.id).toBe(inserted?.id);
  });
});
