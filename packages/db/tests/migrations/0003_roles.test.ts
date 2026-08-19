/**
 * Migration 0003 — Roles + default-deny grants integration test.
 *
 * Verifies the security posture from ADR-0008 §3 and ADR-0018 §10:
 *   • warehouse14_app exists, LOGIN, no SUPERUSER, NOINHERIT.
 *   • warehouse14_security exists, NOLOGIN.
 *   • Schema USAGE granted appropriately; PUBLIC has nothing.
 *   • Default privileges on future tables: SELECT + INSERT to app, NEVER DELETE.
 *   • An actual app-role connection cannot DELETE from a granted table.
 *   • The migration is idempotent.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0003_roles', () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
    await applyMigrations(testDb.migratorSql, 3);
    await setAppPasswordForTest(testDb.migratorSql);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  describe('roles', () => {
    it('warehouse14_app is LOGIN, NOINHERIT, NOT SUPERUSER', async () => {
      const [row] = await testDb.migratorSql<
        { canlogin: boolean; super: boolean; inherit: boolean }[]
      >`
        SELECT rolcanlogin AS canlogin,
               rolsuper    AS super,
               rolinherit  AS inherit
          FROM pg_roles
         WHERE rolname = 'warehouse14_app'
      `;
      expect(row.canlogin).toBe(true);
      expect(row.super).toBe(false);
      expect(row.inherit).toBe(false);
    });

    it('warehouse14_security is NOLOGIN', async () => {
      const [row] = await testDb.migratorSql<{ canlogin: boolean }[]>`
        SELECT rolcanlogin AS canlogin
          FROM pg_roles
         WHERE rolname = 'warehouse14_security'
      `;
      expect(row.canlogin).toBe(false);
    });
  });

  describe('schema grants', () => {
    it('PUBLIC has no USAGE on schema public', async () => {
      const [row] = await testDb.migratorSql<{ has: boolean }[]>`
        SELECT has_schema_privilege('public', 'public', 'USAGE') AS has
      `;
      expect(row.has).toBe(false);
    });

    it('warehouse14_app has USAGE on schema public', async () => {
      const [row] = await testDb.migratorSql<{ has: boolean }[]>`
        SELECT has_schema_privilege('warehouse14_app', 'public', 'USAGE') AS has
      `;
      expect(row.has).toBe(true);
    });

    it('warehouse14_security has USAGE on schema public', async () => {
      const [row] = await testDb.migratorSql<{ has: boolean }[]>`
        SELECT has_schema_privilege('warehouse14_security', 'public', 'USAGE') AS has
      `;
      expect(row.has).toBe(true);
    });
  });

  describe('function grants (backfill from migration 0002)', () => {
    it('warehouse14_app can EXECUTE berlin_business_day', async () => {
      const [row] = await testDb.migratorSql<{ has: boolean }[]>`
        SELECT has_function_privilege(
                 'warehouse14_app',
                 'berlin_business_day(timestamptz)',
                 'EXECUTE'
               ) AS has
      `;
      expect(row.has).toBe(true);
    });

    it('warehouse14_app can EXECUTE set_updated_at', async () => {
      const [row] = await testDb.migratorSql<{ has: boolean }[]>`
        SELECT has_function_privilege(
                 'warehouse14_app',
                 'set_updated_at()',
                 'EXECUTE'
               ) AS has
      `;
      expect(row.has).toBe(true);
    });
  });

  describe('default privileges on future tables', () => {
    it('warehouse14_app gets SELECT + INSERT, NOT UPDATE, NOT DELETE on tables created later', async () => {
      // Create a fresh table AS warehouse14_migrator (the role we are connected as).
      await testDb.migratorSql`
        CREATE TABLE tmp_perm_check (id int PRIMARY KEY, payload text)
      `;
      try {
        const [s] = await testDb.migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', 'tmp_perm_check', 'SELECT') AS has
        `;
        const [i] = await testDb.migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', 'tmp_perm_check', 'INSERT') AS has
        `;
        const [u] = await testDb.migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', 'tmp_perm_check', 'UPDATE') AS has
        `;
        const [d] = await testDb.migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', 'tmp_perm_check', 'DELETE') AS has
        `;
        expect(s.has).toBe(true);
        expect(i.has).toBe(true);
        // UPDATE deliberately NOT in default privileges — column-scoped UPDATE
        // is granted per-table in each table's own migration.
        expect(u.has).toBe(false);
        // DELETE NEVER — this is the cardinal rule.
        expect(d.has).toBe(false);
      } finally {
        await testDb.migratorSql`DROP TABLE tmp_perm_check`;
      }
    });

    it('warehouse14_app gets USAGE on future sequences (for SERIAL/BIGSERIAL columns)', async () => {
      await testDb.migratorSql`
        CREATE TABLE tmp_seq_check (id bigserial PRIMARY KEY, payload text)
      `;
      try {
        const [row] = await testDb.migratorSql<{ has: boolean }[]>`
          SELECT has_sequence_privilege(
                   'warehouse14_app',
                   'tmp_seq_check_id_seq',
                   'USAGE'
                 ) AS has
        `;
        expect(row.has).toBe(true);
      } finally {
        await testDb.migratorSql`DROP TABLE tmp_seq_check`;
      }
    });
  });

  describe('end-to-end app-role connection', () => {
    it('warehouse14_app can SELECT and INSERT but CANNOT DELETE from a granted table', async () => {
      await testDb.migratorSql`
        CREATE TABLE tmp_app_e2e (id int PRIMARY KEY, payload text)
      `;
      const appSql = testDb.appSql();
      try {
        // INSERT should succeed.
        await appSql`INSERT INTO tmp_app_e2e (id, payload) VALUES (1, 'a')`;

        // SELECT should succeed.
        const rows = await appSql<{ id: number; payload: string }[]>`
          SELECT id, payload FROM tmp_app_e2e WHERE id = 1
        `;
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toBe('a');

        // DELETE must fail with permission denied.
        await expect(appSql`DELETE FROM tmp_app_e2e WHERE id = 1`).rejects.toThrow(
          /permission denied/i,
        );

        // UPDATE without explicit column grant must fail.
        await expect(appSql`UPDATE tmp_app_e2e SET payload = 'b' WHERE id = 1`).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await appSql.end({ timeout: 5 });
        await testDb.migratorSql`DROP TABLE tmp_app_e2e`;
      }
    });

    it('warehouse14_app cannot CREATE objects in schema public', async () => {
      const appSql = testDb.appSql();
      try {
        await expect(appSql`CREATE TABLE tmp_app_should_not_create (id int)`).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });
  });

  describe('idempotency', () => {
    it('re-running migration 0003 does not throw', async () => {
      await expect(applyMigrations(testDb.migratorSql, 3)).resolves.not.toThrow();
    });
  });
});
