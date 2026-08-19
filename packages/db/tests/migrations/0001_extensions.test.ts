/**
 * Migration 0001 — Extensions integration test.
 *
 * Verifies that every extension named in the migration is actually installed
 * and behaves as the schema downstream will rely on.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

describe('migration 0001_extensions', () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
    await applyMigrations(testDb.migratorSql, 1);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it.each([
    ['pgcrypto', 'ADR-0008 §2: ledger hash chain digest(); §10: PII encryption'],
    ['vector', 'ADR-0016 §6.bis: products.embedding vector(1536) + HNSW'],
    ['citext', 'better-auth + case-insensitive identifiers'],
    ['btree_gist', 'ADR-0020 §2: slot-overlap exclusion constraint'],
    ['pg_stat_statements', 'ADR-0012 §6: Grafana query observability'],
  ])('extension %s is installed (%s)', async (name) => {
    const rows = await testDb.migratorSql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = ${name}
    `;
    expect(rows).toHaveLength(1);
  });

  it('pgcrypto.digest() returns SHA-256 as 32-byte bytea', async () => {
    const [row] = await testDb.migratorSql<{ hash: Uint8Array }[]>`
      SELECT digest('warehouse14', 'sha256') AS hash
    `;
    expect(row.hash).toBeInstanceOf(Uint8Array);
    expect(row.hash.byteLength).toBe(32);
  });

  it('pgcrypto.gen_random_uuid() returns distinct UUIDs', async () => {
    const [row] = await testDb.migratorSql<{ a: string; b: string }[]>`
      SELECT gen_random_uuid() AS a, gen_random_uuid() AS b
    `;
    expect(row.a).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.b).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.a).not.toBe(row.b);
  });

  it('pgvector supports vector(N) columns and cosine distance', async () => {
    await testDb.migratorSql`CREATE TEMP TABLE tmp_vec (id int PRIMARY KEY, embedding vector(3))`;
    await testDb.migratorSql`
      INSERT INTO tmp_vec (id, embedding) VALUES
        (1, ${'[1,0,0]'}::vector),
        (2, ${'[0,1,0]'}::vector)
    `;
    // Cosine distance between [1,0,0] and [1,0,0] should be 0; between [1,0,0] and [0,1,0] should be 1.
    const rows = await testDb.migratorSql<{ id: number; dist: number }[]>`
      SELECT id, (embedding <=> ${'[1,0,0]'}::vector)::float AS dist
        FROM tmp_vec
       ORDER BY id
    `;
    expect(rows[0].dist).toBeCloseTo(0, 6);
    expect(rows[1].dist).toBeCloseTo(1, 6);
  });

  it('citext compares case-insensitively', async () => {
    const [row] = await testDb.migratorSql<{ eq: boolean }[]>`
      SELECT 'HELLO'::citext = 'hello'::citext AS eq
    `;
    expect(row.eq).toBe(true);
  });

  it('btree_gist allows EXCLUDE constraints mixing = and overlap (&&) for slot models', async () => {
    await testDb.migratorSql`
      CREATE TEMP TABLE tmp_slots (
        staff_id int,
        during tsrange,
        EXCLUDE USING gist (staff_id WITH =, during WITH &&)
      )
    `;
    await testDb.migratorSql`
      INSERT INTO tmp_slots VALUES (1, tsrange('2026-01-01 10:00','2026-01-01 11:00'))
    `;

    // Overlapping booking for the same staff → must be rejected.
    await expect(
      testDb.migratorSql`
        INSERT INTO tmp_slots VALUES (1, tsrange('2026-01-01 10:30','2026-01-01 11:30'))
      `,
    ).rejects.toThrow(/conflicting key value violates exclusion constraint/);

    // Same time slot for a different staff member → must be allowed.
    await expect(
      testDb.migratorSql`
        INSERT INTO tmp_slots VALUES (2, tsrange('2026-01-01 10:30','2026-01-01 11:30'))
      `,
    ).resolves.toBeDefined();
  });

  it('pg_stat_statements view is queryable (extension is preloaded)', async () => {
    // We do not assert specific contents — just that the view exists, which
    // requires the extension to have been loaded via shared_preload_libraries.
    const [row] = await testDb.migratorSql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM pg_stat_statements LIMIT 1
    `;
    expect(typeof row.count).toBe('number');
  });
});
