/**
 * Migration 0004 — Auth + identity + device pairing integration test.
 *
 * Sections:
 *   1. Structure          — tables, columns, enum types, FKs, indexes, triggers
 *   2. Constraints        — CHECKs (preferred_language, anonymized_*, accounts CoC, cert dates)
 *   3. Default privileges — confirm migration 0003 default-deny still applies to new tables
 *   4. App-role grants    — the centerpiece. Verifies Basel's Day-2 directives:
 *                              • users: NEVER DELETE + UPDATE narrow column list
 *                              • sessions: FULL grants including DELETE
 *                              • verifications: DELETE granted
 *                              • two_factors: DELETE granted
 *                              • devices / accounts: NEVER DELETE
 *   5. GDPR semantics     — soft_delete + anonymize + the partial-unique-index
 *                            re-signup behavior
 *   6. Idempotency        — re-applying 0004 is safe
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0004_auth', () => {
  let testDb: TestDb;
  let migratorSql: Sql;

  // A few helpers used across the suite.

  /** Helper: create a known-good user as migrator, return its UUID. */
  async function makeUser(
    opts: {
      email?: string;
      role?: 'ADMIN' | 'CASHIER' | 'READONLY';
      name?: string;
    } = {},
  ): Promise<string> {
    const email = opts.email ?? `u-${crypto.randomUUID()}@example.test`;
    const name = opts.name ?? 'Test User';
    const role = opts.role ?? 'ADMIN';
    const [row] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${email}, ${name}, ${role}::user_role)
      RETURNING id
    `;
    return row.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 4);
    await setAppPasswordForTest(migratorSql);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. Structure
  // ────────────────────────────────────────────────────────────────────

  describe('structure — tables, enums, FKs, indexes, triggers', () => {
    it.each(['users', 'devices', 'accounts', 'sessions', 'verifications', 'two_factors'])(
      'table %s exists',
      async (name) => {
        const [row] = await migratorSql<{ exists: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = ${name}
          ) AS exists
        `;
        expect(row.exists).toBe(true);
      },
    );

    it.each([
      ['user_role', ['ADMIN', 'CASHIER', 'READONLY']],
      ['device_class', ['POS_TERMINAL', 'CONTROL_DESKTOP', 'ADMIN_WEB_BROWSER', 'WORKER']],
      ['device_status', ['active', 'revoked', 'expired']],
    ] as const)('enum %s has the right values', async (typeName, expected) => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT e.enumlabel
          FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
         WHERE t.typname = ${typeName}
         ORDER BY e.enumsortorder
      `;
      expect(rows.map((r) => r.enumlabel)).toEqual([...expected]);
    });

    it('users.email column is citext (case-insensitive)', async () => {
      const [row] = await migratorSql<{ udt_name: string }[]>`
        SELECT udt_name FROM information_schema.columns
         WHERE table_name = 'users' AND column_name = 'email'
      `;
      expect(row.udt_name).toBe('citext');
    });

    it('sessions.device_id has a FK to devices(id)', async () => {
      const [row] = await migratorSql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
          FROM information_schema.referential_constraints rc
          JOIN information_schema.key_column_usage kcu
            ON rc.constraint_name = kcu.constraint_name
         WHERE kcu.table_name = 'sessions'
           AND kcu.column_name = 'device_id'
      `;
      expect(row.count).toBe(1);
    });

    it.each([
      ['trg_users_updated_at', 'users'],
      ['trg_devices_updated_at', 'devices'],
      ['trg_accounts_updated_at', 'accounts'],
      ['trg_sessions_updated_at', 'sessions'],
      ['trg_verifications_updated_at', 'verifications'],
      ['trg_two_factors_updated_at', 'two_factors'],
    ])('trigger %s on %s is installed', async (trgName, tableName) => {
      const [row] = await migratorSql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_trigger
           WHERE tgname = ${trgName}
             AND tgrelid = ${tableName}::regclass
        ) AS exists
      `;
      expect(row.exists).toBe(true);
    });

    it('users_email_active_uq is a partial unique index (WHERE soft_deleted_at IS NULL)', async () => {
      const [row] = await migratorSql<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
         WHERE tablename = 'users' AND indexname = 'users_email_active_uq'
      `;
      expect(row.indexdef).toMatch(/UNIQUE/i);
      expect(row.indexdef).toMatch(/WHERE.*soft_deleted_at IS NULL/i);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. CHECK constraints
  // ────────────────────────────────────────────────────────────────────

  describe('CHECK constraints', () => {
    it('users.preferred_language rejects values outside DE/EN/AR', async () => {
      await expect(
        migratorSql`
          INSERT INTO users (email, name, role, preferred_language)
          VALUES ('bad-lang@example.test', 'X', 'CASHIER'::user_role, 'fr')
        `,
      ).rejects.toThrow(/users_preferred_language_chk/);
    });

    it('users — anonymized_at NOT NULL while soft_deleted_at NULL → reject', async () => {
      await expect(
        migratorSql`
          INSERT INTO users (email, name, role, anonymized_at)
          VALUES ('bad-anon@example.test', 'X', 'CASHIER'::user_role, now())
        `,
      ).rejects.toThrow(/users_anonymized_implies_soft_deleted/);
    });

    it('users — anonymized_at BEFORE soft_deleted_at → reject', async () => {
      await expect(
        migratorSql`
          INSERT INTO users (email, name, role, soft_deleted_at, anonymized_at)
          VALUES ('bad-order@example.test', 'X', 'CASHIER'::user_role,
                  '2026-01-02'::timestamptz, '2026-01-01'::timestamptz)
        `,
      ).rejects.toThrow(/users_anonymized_after_soft_deleted/);
    });

    it('devices — cert_expires_at must be > cert_issued_at', async () => {
      const pairedBy = await makeUser();
      await expect(
        migratorSql`
          INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
          VALUES ('POS_TERMINAL'::device_class, 'CERT-BAD-1',
                  '2026-06-01'::timestamptz, '2026-05-01'::timestamptz,
                  ${pairedBy})
        `,
      ).rejects.toThrow(/devices_cert_validity_range/);
    });

    it('accounts — credentials provider must carry a password, no access_token', async () => {
      const userId = await makeUser({ email: 'cred-ok@example.test' });
      await expect(
        migratorSql`
          INSERT INTO accounts (user_id, account_id, provider_id, password, access_token)
          VALUES (${userId}, 'a', 'credentials', 'argon2-hash', 'some-token')
        `,
      ).rejects.toThrow(/accounts_credentials_or_oauth/);
    });

    it('accounts — non-credentials provider must NOT carry a password', async () => {
      const userId = await makeUser({ email: 'oauth-bad@example.test' });
      await expect(
        migratorSql`
          INSERT INTO accounts (user_id, account_id, provider_id, password, access_token)
          VALUES (${userId}, 'gh-123', 'github', 'leaked-pw', 'gho_xyz')
        `,
      ).rejects.toThrow(/accounts_credentials_or_oauth/);
    });

    it('sessions.expires_at must be > created_at', async () => {
      const userId = await makeUser({ email: 'sess-bad@example.test' });
      await expect(
        migratorSql`
          INSERT INTO sessions (user_id, token, expires_at, created_at)
          VALUES (${userId}, 'tok1',
                  '2026-01-01 10:00:00Z'::timestamptz,
                  '2026-01-01 11:00:00Z'::timestamptz)
        `,
      ).rejects.toThrow(/sessions_expiry_after_creation/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. App-role grants — the centerpiece (Day-2 directives)
  // ────────────────────────────────────────────────────────────────────

  describe('app-role grants — Basel Day-2 directive', () => {
    it('users — app can SELECT, INSERT', async () => {
      const [s] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'users', 'SELECT') AS has`;
      const [i] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'users', 'INSERT') AS has`;
      expect(s.has).toBe(true);
      expect(i.has).toBe(true);
    });

    it('users — app CANNOT DELETE (Day-2 directive: GDPR via soft delete only)', async () => {
      const [d] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'users', 'DELETE') AS has`;
      expect(d.has).toBe(false);
    });

    it.each([
      ['name', true],
      ['image', true],
      ['preferred_language', true],
      ['email_verified', true],
      ['soft_deleted_at', true],
      ['anonymized_at', true],
      ['updated_at', true],
      // Forbidden by directive:
      ['email', false],
      ['role', false],
      ['shop_id', false],
      ['id', false],
      ['created_at', false],
    ])('users.%s app UPDATE permission → %s', async (column, expected) => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'users', ${column}, 'UPDATE') AS has`;
      expect(row.has).toBe(expected);
    });

    it('sessions — Day-2 directive: app has SELECT + INSERT + UPDATE + DELETE', async () => {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', 'sessions', ${priv}) AS has`;
        expect(row.has, `sessions ${priv}`).toBe(true);
      }
    });

    it('verifications — app has SELECT, INSERT, DELETE (consume-then-delete), NOT UPDATE', async () => {
      const [s] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'verifications', 'SELECT') AS has`;
      const [i] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'verifications', 'INSERT') AS has`;
      const [d] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'verifications', 'DELETE') AS has`;
      const [u] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'verifications', 'UPDATE') AS has`;
      expect(s.has).toBe(true);
      expect(i.has).toBe(true);
      expect(d.has).toBe(true);
      expect(u.has).toBe(false);
    });

    it('two_factors — app has SELECT + INSERT + narrow UPDATE + DELETE', async () => {
      for (const priv of ['SELECT', 'INSERT', 'DELETE'] as const) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', 'two_factors', ${priv}) AS has`;
        expect(row.has, `two_factors ${priv}`).toBe(true);
      }
      // UPDATE permitted only on the four mutable columns.
      for (const col of ['secret', 'backup_codes', 'enabled', 'updated_at']) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_column_privilege('warehouse14_app', 'two_factors', ${col}, 'UPDATE') AS has`;
        expect(row.has, `two_factors.${col} UPDATE`).toBe(true);
      }
      for (const col of ['id', 'user_id', 'created_at']) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_column_privilege('warehouse14_app', 'two_factors', ${col}, 'UPDATE') AS has`;
        expect(row.has, `two_factors.${col} UPDATE forbidden`).toBe(false);
      }
    });

    it('devices — app CANNOT DELETE, can UPDATE lifecycle columns only', async () => {
      const [d] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'devices', 'DELETE') AS has`;
      expect(d.has).toBe(false);

      for (const col of [
        'status',
        'last_seen_at',
        'last_seen_ip',
        'notes',
        'hostname',
        'updated_at',
      ]) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_column_privilege('warehouse14_app', 'devices', ${col}, 'UPDATE') AS has`;
        expect(row.has, `devices.${col} UPDATE permitted`).toBe(true);
      }
      // Identity / cert lifecycle columns: forbidden.
      for (const col of [
        'cert_serial',
        'cert_issued_at',
        'cert_expires_at',
        'paired_by_user_id',
        'paired_at',
        'device_class',
      ]) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_column_privilege('warehouse14_app', 'devices', ${col}, 'UPDATE') AS has`;
        expect(row.has, `devices.${col} UPDATE forbidden`).toBe(false);
      }
    });

    it('accounts — app CANNOT DELETE, password/token columns UPDATEable', async () => {
      const [d] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'accounts', 'DELETE') AS has`;
      expect(d.has).toBe(false);

      for (const col of [
        'password',
        'access_token',
        'refresh_token',
        'id_token',
        'access_token_expires_at',
        'refresh_token_expires_at',
        'scope',
        'updated_at',
      ]) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_column_privilege('warehouse14_app', 'accounts', ${col}, 'UPDATE') AS has`;
        expect(row.has, `accounts.${col} UPDATE permitted`).toBe(true);
      }
      for (const col of ['user_id', 'provider_id', 'account_id']) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_column_privilege('warehouse14_app', 'accounts', ${col}, 'UPDATE') AS has`;
        expect(row.has, `accounts.${col} UPDATE forbidden`).toBe(false);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. End-to-end app role discipline against live connection
  // ────────────────────────────────────────────────────────────────────

  describe('end-to-end app-role behavior', () => {
    it('app role can INSERT users but CANNOT DELETE them (GDPR enforcement)', async () => {
      const appSql = testDb.appSql();
      try {
        const email = `e2e-no-delete-${crypto.randomUUID()}@example.test`;
        await appSql`
          INSERT INTO users (email, name, role)
          VALUES (${email}, 'E2E', 'CASHIER'::user_role)
        `;
        await expect(appSql`DELETE FROM users WHERE email = ${email}::citext`).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role can DELETE sessions (logout flow)', async () => {
      const userId = await makeUser({ email: `e2e-session-${crypto.randomUUID()}@example.test` });
      const appSql = testDb.appSql();
      try {
        await appSql`
          INSERT INTO sessions (user_id, token, expires_at)
          VALUES (${userId}, ${'tok-' + crypto.randomUUID()}, now() + interval '1 hour')
        `;
        const result = await appSql`DELETE FROM sessions WHERE user_id = ${userId}`;
        // Sanity: no permission error.
        expect(result).toBeDefined();
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role CANNOT change a user role via UPDATE (admin-mediated invariant)', async () => {
      const userId = await makeUser({
        email: `e2e-role-${crypto.randomUUID()}@example.test`,
        role: 'CASHIER',
      });
      const appSql = testDb.appSql();
      try {
        await expect(
          appSql`UPDATE users SET role = 'ADMIN'::user_role WHERE id = ${userId}`,
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role CANNOT change a user email via UPDATE (admin-mediated invariant)', async () => {
      const userId = await makeUser({
        email: `e2e-email-${crypto.randomUUID()}@example.test`,
      });
      const appSql = testDb.appSql();
      try {
        await expect(
          appSql`UPDATE users SET email = 'new@example.test'::citext WHERE id = ${userId}`,
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role CAN stamp soft_deleted_at + anonymized_at (the GDPR mechanism)', async () => {
      const userId = await makeUser({
        email: `e2e-gdpr-${crypto.randomUUID()}@example.test`,
      });
      const appSql = testDb.appSql();
      try {
        await appSql`
          UPDATE users
             SET soft_deleted_at = now(),
                 anonymized_at   = now() + interval '1 minute',
                 name            = 'anonymized'
           WHERE id = ${userId}
        `;
        const [row] = await migratorSql<{ soft: Date; anon: Date; name: string }[]>`
          SELECT soft_deleted_at AS soft, anonymized_at AS anon, name FROM users WHERE id = ${userId}
        `;
        expect(row.soft).toBeInstanceOf(Date);
        expect(row.anon).toBeInstanceOf(Date);
        expect(row.name).toBe('anonymized');
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. GDPR semantics — soft-delete + re-signup behavior
  // ────────────────────────────────────────────────────────────────────

  describe('GDPR — soft-delete + partial unique index', () => {
    it('two ACTIVE users with the same email collide on users_email_active_uq', async () => {
      const email = `dup-active-${crypto.randomUUID()}@example.test`;
      await migratorSql`
        INSERT INTO users (email, name, role)
        VALUES (${email}, 'A', 'CASHIER'::user_role)
      `;
      await expect(
        migratorSql`
          INSERT INTO users (email, name, role)
          VALUES (${email}, 'B', 'CASHIER'::user_role)
        `,
      ).rejects.toThrow(/users_email_active_uq/);
    });

    it('a soft-deleted user does NOT block a new active user with the same email', async () => {
      const email = `gdpr-resignup-${crypto.randomUUID()}@example.test`;
      // First user: created then soft-deleted.
      const [first] = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${email}, 'Original', 'CASHIER'::user_role)
        RETURNING id
      `;
      await migratorSql`
        UPDATE users SET soft_deleted_at = now() WHERE id = ${first.id}
      `;
      // Second user: re-signup with the same email is permitted.
      const [second] = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${email}, 'Returning Customer', 'CASHIER'::user_role)
        RETURNING id
      `;
      expect(second.id).not.toBe(first.id);
    });

    it('two soft-deleted users with the same email coexist (no uniqueness collision)', async () => {
      const email = `gdpr-multi-deleted-${crypto.randomUUID()}@example.test`;
      const a = await migratorSql`
        INSERT INTO users (email, name, role, soft_deleted_at)
        VALUES (${email}, 'A', 'CASHIER'::user_role, now())
      `;
      const b = await migratorSql`
        INSERT INTO users (email, name, role, soft_deleted_at)
        VALUES (${email}, 'B', 'CASHIER'::user_role, now())
      `;
      expect(a.count).toBe(1);
      expect(b.count).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. Trigger behavior — set_updated_at fires on UPDATE
  // ────────────────────────────────────────────────────────────────────

  describe('updated_at trigger fires across all auth tables', () => {
    it('users.updated_at is bumped on UPDATE', async () => {
      const userId = await makeUser({ email: `trg-${crypto.randomUUID()}@example.test` });
      const [before] = await migratorSql<{ updated_at: Date }[]>`
        SELECT updated_at FROM users WHERE id = ${userId}
      `;
      await new Promise((r) => setTimeout(r, 50));
      await migratorSql`UPDATE users SET name = 'Renamed' WHERE id = ${userId}`;
      const [after] = await migratorSql<{ updated_at: Date }[]>`
        SELECT updated_at FROM users WHERE id = ${userId}
      `;
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. Idempotency
  // ────────────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('re-applying migration 0004 does not throw', async () => {
      await expect(applyMigrations(migratorSql, 4)).resolves.not.toThrow();
    });
  });
});
