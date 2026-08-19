/**
 * Migration 0014 — Owner flag + POS PIN columns.
 *
 * Focused tests for the schema-level invariants from ADR-0022:
 *   • exactly one Owner (partial UNIQUE on is_owner = TRUE)
 *   • Owner must be ADMIN (users_owner_implies_admin CHECK)
 *   • PIN hash + set-at land together (users_pin_hash_set_together)
 *   • PIN attempts cannot go negative (users_pin_attempts_nonneg)
 *   • App role can UPDATE pos_pin_* but CANNOT UPDATE is_owner
 *   • Step-up column lives on sessions
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0014_owner_and_pos_pin', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;

  async function makeUser(
    opts: { role?: 'ADMIN' | 'CASHIER' | 'READONLY'; isOwner?: boolean } = {},
  ): Promise<string> {
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X',
              ${(opts.role ?? 'ADMIN') as string}::user_role,
              ${opts.isOwner ?? false})
      RETURNING id`;
    return u!.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 14);
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
  // 1. is_owner — partial UNIQUE
  // ────────────────────────────────────────────────────────────────────

  describe('is_owner partial UNIQUE', () => {
    it('allows zero Owners (the default)', async () => {
      const id = await makeUser({ isOwner: false });
      expect(id).toBeDefined();
    });

    it('allows exactly one Owner', async () => {
      // Reset to a clean slate for this scenario.
      await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;
      const id = await makeUser({ isOwner: true });
      expect(id).toBeDefined();
    });

    it('refuses a second Owner', async () => {
      await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;
      await makeUser({ isOwner: true });
      await expect(makeUser({ isOwner: true })).rejects.toThrow(/users_only_one_owner_uq/);
    });

    it('many non-Owners coexist (NULL/FALSE excluded from partial index)', async () => {
      await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;
      for (let i = 0; i < 5; i++) await makeUser({ isOwner: false });
      const [{ count }] = await migratorSql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM users WHERE is_owner = FALSE`;
      expect(Number.parseInt(count, 10)).toBeGreaterThanOrEqual(5);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. Owner must be ADMIN
  // ────────────────────────────────────────────────────────────────────

  describe('users_owner_implies_admin CHECK', () => {
    it('rejects is_owner=TRUE with role=CASHIER', async () => {
      await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;
      await expect(makeUser({ role: 'CASHIER', isOwner: true })).rejects.toThrow(
        /users_owner_implies_admin/,
      );
    });

    it('rejects is_owner=TRUE with role=READONLY', async () => {
      await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;
      await expect(makeUser({ role: 'READONLY', isOwner: true })).rejects.toThrow(
        /users_owner_implies_admin/,
      );
    });

    it('accepts is_owner=TRUE with role=ADMIN', async () => {
      await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;
      const id = await makeUser({ role: 'ADMIN', isOwner: true });
      expect(id).toBeDefined();
    });

    it('refuses demoting an Owner to CASHIER', async () => {
      await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;
      const id = await makeUser({ role: 'ADMIN', isOwner: true });
      await expect(
        migratorSql`UPDATE users SET role = 'CASHIER'::user_role WHERE id = ${id}`,
      ).rejects.toThrow(/users_owner_implies_admin/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. POS PIN constraints
  // ────────────────────────────────────────────────────────────────────

  describe('users_pin_hash_set_together CHECK', () => {
    it('allows both NULL (no PIN yet)', async () => {
      const id = await makeUser();
      const [row] = await migratorSql<
        { pos_pin_hash: string | null; pos_pin_set_at: Date | null }[]
      >`
        SELECT pos_pin_hash, pos_pin_set_at FROM users WHERE id = ${id}`;
      expect(row!.pos_pin_hash).toBeNull();
      expect(row!.pos_pin_set_at).toBeNull();
    });

    it('allows both set together', async () => {
      const id = await makeUser();
      await migratorSql`
        UPDATE users SET pos_pin_hash = 'argon2id$...$abc', pos_pin_set_at = now() WHERE id = ${id}`;
      const [row] = await migratorSql<{ pos_pin_hash: string; pos_pin_set_at: Date }[]>`
        SELECT pos_pin_hash, pos_pin_set_at FROM users WHERE id = ${id}`;
      expect(row!.pos_pin_hash).toBe('argon2id$...$abc');
      expect(row!.pos_pin_set_at).toBeInstanceOf(Date);
    });

    it('rejects hash without set-at', async () => {
      const id = await makeUser();
      await expect(
        migratorSql`UPDATE users SET pos_pin_hash = 'argon2id$...$abc' WHERE id = ${id}`,
      ).rejects.toThrow(/users_pin_hash_set_together/);
    });

    it('rejects set-at without hash', async () => {
      const id = await makeUser();
      await expect(
        migratorSql`UPDATE users SET pos_pin_set_at = now() WHERE id = ${id}`,
      ).rejects.toThrow(/users_pin_hash_set_together/);
    });
  });

  describe('users_pin_attempts_nonneg CHECK', () => {
    it('default is 0', async () => {
      const id = await makeUser();
      const [row] = await migratorSql<{ pos_pin_failed_attempts: number }[]>`
        SELECT pos_pin_failed_attempts FROM users WHERE id = ${id}`;
      expect(row!.pos_pin_failed_attempts).toBe(0);
    });

    it('rejects negative attempt counter', async () => {
      const id = await makeUser();
      await expect(
        migratorSql`UPDATE users SET pos_pin_failed_attempts = -1 WHERE id = ${id}`,
      ).rejects.toThrow(/users_pin_attempts_nonneg/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. App-role grants — narrow surface
  // ────────────────────────────────────────────────────────────────────

  describe('app role grants — PIN columns writable, is_owner read-only', () => {
    it('app CAN update pos_pin_hash + pos_pin_set_at', async () => {
      const id = await makeUser();
      await expect(
        appSql`UPDATE users SET pos_pin_hash='abc', pos_pin_set_at=now() WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });

    it('app CAN update pos_pin_failed_attempts', async () => {
      const id = await makeUser();
      await expect(
        appSql`UPDATE users SET pos_pin_failed_attempts = 3 WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });

    it('app CAN update pos_pin_locked_until', async () => {
      const id = await makeUser();
      await expect(
        appSql`UPDATE users SET pos_pin_locked_until = now() + interval '30 minutes' WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });

    it('app CANNOT update is_owner', async () => {
      await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;
      const id = await makeUser();
      await expect(appSql`UPDATE users SET is_owner = TRUE WHERE id = ${id}`).rejects.toThrow(
        /permission denied/i,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. Step-up column on sessions
  // ────────────────────────────────────────────────────────────────────

  describe('sessions.last_pin_step_up_at', () => {
    it('exists and is nullable', async () => {
      const userId = await makeUser();
      const [s] = await migratorSql<{ id: string }[]>`
        INSERT INTO sessions (user_id, token, expires_at)
        VALUES (${userId}, ${`tok-${crypto.randomUUID()}`}, now() + interval '8 hours')
        RETURNING id`;
      const [row] = await migratorSql<{ last_pin_step_up_at: Date | null }[]>`
        SELECT last_pin_step_up_at FROM sessions WHERE id = ${s!.id}`;
      expect(row!.last_pin_step_up_at).toBeNull();
    });

    it('app role can UPDATE the step-up column', async () => {
      const userId = await makeUser();
      const [s] = await migratorSql<{ id: string }[]>`
        INSERT INTO sessions (user_id, token, expires_at)
        VALUES (${userId}, ${`tok-${crypto.randomUUID()}`}, now() + interval '8 hours')
        RETURNING id`;
      await expect(
        appSql`UPDATE sessions SET last_pin_step_up_at = now() WHERE id = ${s!.id}`,
      ).resolves.toBeDefined();
      const [row] = await migratorSql<{ last_pin_step_up_at: Date | null }[]>`
        SELECT last_pin_step_up_at FROM sessions WHERE id = ${s!.id}`;
      expect(row!.last_pin_step_up_at).toBeInstanceOf(Date);
    });
  });
});
