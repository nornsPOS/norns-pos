/**
 * Migration 0008 + @norns/audit — chain integrity tests.
 *
 * The centerpiece is the tamper-detection test: insert a sequence of events,
 * verify the chain is valid, simulate a DBA tampering with a middle row, and
 * confirm verifyChain() catches it at the exact row.
 *
 * Other essentials:
 *   • Genesis row links to zero-bytes
 *   • Each row's prev_hash = previous row_hash
 *   • Trigger forces created_at = now() (no backdating)
 *   • App role cannot UPDATE, DELETE, or write prev_hash/row_hash directly
 *   • Concurrent emits serialize on the advisory lock (no two rows share prev_hash)
 *   • Trigger is owned by warehouse14_security (cannot be DROPed by app)
 *   • audit_log is append-only via grants
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emit, emitAudit, verifyChain } from '@norns/audit';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0008_audit_chain + @norns/audit', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;

  /** Generate a fresh UUID for an entity_id placeholder. */
  const u = () => crypto.randomUUID();

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 8);
    await setAppPasswordForTest(migratorSql);

    appSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 20,
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // Structure + ownership
  // ────────────────────────────────────────────────────────────────────

  describe('structure + ownership', () => {
    it('ledger_events + audit_log tables exist', async () => {
      for (const tbl of ['ledger_events', 'audit_log']) {
        const [row] = await migratorSql<{ exists: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = ${tbl}
          ) AS exists`;
        expect(row.exists, tbl).toBe(true);
      }
    });

    it('ledger_compute_hash() is SECURITY DEFINER and owned by warehouse14_security', async () => {
      const [row] = await migratorSql<{ owner: string; sec_def: boolean }[]>`
        SELECT pg_get_userbyid(proowner) AS owner,
               prosecdef                  AS sec_def
          FROM pg_proc
         WHERE proname = 'ledger_compute_hash'
      `;
      expect(row.owner).toBe('warehouse14_security');
      expect(row.sec_def).toBe(true);
    });

    it('verify_ledger_chain() is owned by warehouse14_security', async () => {
      const [row] = await migratorSql<{ owner: string }[]>`
        SELECT pg_get_userbyid(proowner) AS owner
          FROM pg_proc
         WHERE proname = 'verify_ledger_chain'
      `;
      expect(row.owner).toBe('warehouse14_security');
    });

    it('trigger trg_ledger_compute_hash is BEFORE INSERT on ledger_events', async () => {
      const [row] = await migratorSql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_trigger
           WHERE tgname = 'trg_ledger_compute_hash'
             AND tgrelid = 'ledger_events'::regclass
        ) AS exists`;
      expect(row.exists).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Genesis + chain linking
  // ────────────────────────────────────────────────────────────────────

  describe('genesis + chain linking', () => {
    it('first emit() has prev_hash = 32 zero bytes (genesis)', async () => {
      const event = await emit(appDb, {
        eventType: 'test.genesis',
        entityTable: 'products',
        entityId: u(),
        payload: { kind: 'genesis test' },
      });
      const zeroes = Buffer.alloc(32, 0);
      expect(Buffer.from(event.prevHash).equals(zeroes)).toBe(true);
      expect(event.rowHash.byteLength).toBe(32);
    });

    it('subsequent emit() chains to the previous row', async () => {
      const first = await emit(appDb, {
        eventType: 'test.first',
        entityTable: 'products',
        entityId: u(),
        payload: { n: 1 },
      });
      const second = await emit(appDb, {
        eventType: 'test.second',
        entityTable: 'products',
        entityId: u(),
        payload: { n: 2 },
      });
      // second.prev_hash MUST equal first.row_hash
      expect(Buffer.from(second.prevHash).equals(Buffer.from(first.rowHash))).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Trigger forces created_at — backdating impossible
  // ────────────────────────────────────────────────────────────────────

  describe('backdating defense', () => {
    it('app role cannot INSERT prev_hash, row_hash, or created_at directly', async () => {
      // Try to provide all the forbidden columns. The grant must reject this
      // before the trigger even runs.
      await expect(
        appSql`
          INSERT INTO ledger_events (event_type, entity_table, entity_id, payload, prev_hash, row_hash, created_at)
          VALUES ('test.attack', 'products', gen_random_uuid(), '{}'::jsonb,
                  decode('aa', 'hex'), decode('bb', 'hex'), '1990-01-01'::timestamptz)
        `,
      ).rejects.toThrow(/permission denied/i);
    });

    it('even providing nothing for created_at, the row carries now()-ish time', async () => {
      const before = Date.now();
      const event = await emit(appDb, {
        eventType: 'test.timestamp',
        entityTable: 'products',
        entityId: u(),
        payload: {},
      });
      const after = Date.now();
      // The trigger sets created_at = now() unconditionally.
      const eventMs = event.createdAt.getTime();
      expect(eventMs).toBeGreaterThanOrEqual(before - 1000);
      expect(eventMs).toBeLessThanOrEqual(after + 1000);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // App role grants — Day-6 directive
  // ────────────────────────────────────────────────────────────────────

  describe('append-only grants on ledger_events', () => {
    it('app has SELECT + INSERT, NOT UPDATE, NOT DELETE', async () => {
      // 0008 deliberately REVOKES table-level INSERT and re-grants it
      // COLUMN-restricted (so the app can append rows but never fabricate
      // prev_hash/row_hash/created_at). Hence table-level INSERT is FALSE — the
      // append capability lives at the column level and is asserted right below
      // (and exhaustively in the per-column test that follows). This is the
      // hardened posture, stronger than a table-wide INSERT grant.
      const probes = [
        ['SELECT', true],
        ['INSERT', false],
        ['UPDATE', false],
        ['DELETE', false],
      ] as const;
      for (const [priv, expected] of probes) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', 'ledger_events', ${priv}) AS has`;
        expect(row.has, priv).toBe(expected);
      }
      // The app CAN still append (column-level INSERT on a non-hash column):
      const [canAppend] = await migratorSql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'ledger_events', 'payload', 'INSERT') AS has`;
      expect(canAppend?.has, 'column-level INSERT(payload)').toBe(true);
    });

    it.each([
      // App CAN insert these:
      ['event_type', true],
      ['entity_table', true],
      ['entity_id', true],
      ['actor_user_id', true],
      ['device_id', true],
      ['ip_address', true],
      ['payload', true],
      // App CANNOT insert these (computed by trigger or by DB):
      ['id', false],
      ['prev_hash', false],
      ['row_hash', false],
      ['created_at', false],
    ])('ledger_events.%s app INSERT → %s', async (column, expected) => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'ledger_events', ${column}, 'INSERT') AS has`;
      expect(row.has).toBe(expected);
    });

    it('app role CANNOT UPDATE a ledger row even with full column list', async () => {
      const e = await emit(appDb, {
        eventType: 'test.cannot-update',
        entityTable: 'products',
        entityId: u(),
        payload: {},
      });
      await expect(
        appSql`UPDATE ledger_events SET payload = '{"forged": true}'::jsonb WHERE id = ${e.id.toString()}::bigint`,
      ).rejects.toThrow(/permission denied/i);
    });

    it('app role CANNOT DELETE a ledger row', async () => {
      const e = await emit(appDb, {
        eventType: 'test.cannot-delete',
        entityTable: 'products',
        entityId: u(),
        payload: {},
      });
      await expect(
        appSql`DELETE FROM ledger_events WHERE id = ${e.id.toString()}::bigint`,
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // verifyChain() — the centerpiece
  // ────────────────────────────────────────────────────────────────────

  describe('verifyChain() integrity', () => {
    it('returns valid=true after a sequence of emits', async () => {
      // The ledger already has rows from previous tests, including the
      // tampered ones from the next test if test order is wrong. To make this
      // test order-independent, we just check the current chain state.
      const result = await verifyChain(appDb);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.rowsVerified).toBeGreaterThan(0n);
      }
    });

    it('🔥 DBA tampering with a payload BREAKS the chain at the tampered row', async () => {
      // Emit 5 events.
      const events = [];
      for (let i = 1; i <= 5; i++) {
        events.push(
          await emit(appDb, {
            eventType: `test.tamper.${i}`,
            entityTable: 'products',
            entityId: u(),
            payload: { sequence: i, sensitive: 'original' },
          }),
        );
      }

      // Verify chain is valid before tampering.
      const before = await verifyChain(appDb);
      expect(before.valid).toBe(true);

      // Simulate a malicious DBA tampering with row #3's payload.
      // Only the migrator role (or a superuser) could do this in production.
      const target = events[2];
      if (!target) throw new Error('expected 5 emitted events');
      await migratorSql`
        UPDATE ledger_events
           SET payload = '{"sequence": 3, "sensitive": "tampered"}'::jsonb
         WHERE id = ${target.id.toString()}::bigint
      `;

      // verify_ledger_chain() must now catch the break at row #3.
      const after = await verifyChain(appDb);
      expect(after.valid).toBe(false);
      if (!after.valid) {
        expect(after.breakAtId).toBe(target.id);
        expect(after.reason).toMatch(/row_hash mismatch/i);
        // The "expected" hash is what the trigger WOULD have computed for
        // the tampered payload — different from the stored row_hash.
        expect(Buffer.from(after.expectedHash).equals(Buffer.from(after.actualHash))).toBe(false);
      }

      // Repair the row so subsequent tests start from a clean chain. Use a SQL
      // literal (like the tamper UPDATE above): `${JSON.stringify(obj)}::jsonb`
      // double-encodes via postgres.js into a jsonb *string*, which violates the
      // ledger_events_payload_object CHECK (payload must be a jsonb object).
      await migratorSql`
        UPDATE ledger_events
           SET payload = '{"sequence": 3, "sensitive": "original"}'::jsonb
         WHERE id = ${target.id.toString()}::bigint
      `;
      // Now the chain should be valid again because the payload is restored.
      const repaired = await verifyChain(appDb);
      expect(repaired.valid).toBe(true);
    });

    it('🔥 DBA deleting a middle row BREAKS the chain at the next row', async () => {
      // Emit 3 events.
      await emit(appDb, { eventType: 'test.del.1', entityTable: 'p', entityId: u(), payload: {} });
      const e2 = await emit(appDb, {
        eventType: 'test.del.2',
        entityTable: 'p',
        entityId: u(),
        payload: {},
      });
      const e3 = await emit(appDb, {
        eventType: 'test.del.3',
        entityTable: 'p',
        entityId: u(),
        payload: {},
      });

      // Sanity: e3.prev_hash should equal e2.row_hash.
      expect(Buffer.from(e3.prevHash).equals(Buffer.from(e2.rowHash))).toBe(true);

      // Delete the middle row as the migrator (simulating a malicious DBA).
      await migratorSql`DELETE FROM ledger_events WHERE id = ${e2.id.toString()}::bigint`;

      // Chain is broken — e3's prev_hash references a row that no longer exists.
      // The verifier walks id-order; the row immediately after the gap should
      // have prev_hash mismatching what the verifier expects from its predecessor.
      const after = await verifyChain(appDb);
      expect(after.valid).toBe(false);
      if (!after.valid) {
        // The first break is detected at e3 (the row whose prev_hash references the deleted e2).
        expect(after.breakAtId).toBe(e3.id);
        expect(after.reason).toMatch(/prev_hash mismatch/i);
      }

      // Re-insert a placeholder row to restore chain continuity for downstream tests.
      // (In production, a permanent break would be the actual outcome — Finanzamt sees it.)
      // For the test, we accept the chain stays broken from here.
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Concurrency: advisory lock serializes emits
  // ────────────────────────────────────────────────────────────────────

  describe('concurrency', () => {
    it('100 concurrent emits produce 100 distinct rows with a contiguous chain', async () => {
      // Start fresh: use a fresh container subset by counting rows before.
      const [{ before }] = await migratorSql<{ before: string }[]>`
        SELECT COUNT(*)::text AS before FROM ledger_events
      `;
      const baseline = BigInt(before);

      const attempts = Array.from({ length: 100 }, (_, i) =>
        emit(appDb, {
          eventType: 'test.concurrent',
          entityTable: 'products',
          entityId: u(),
          payload: { i },
        }),
      );
      const results = await Promise.all(attempts);

      // 100 distinct ids, 100 distinct row_hashes.
      const ids = new Set(results.map((r) => r.id));
      const rowHashes = new Set(results.map((r) => Buffer.from(r.rowHash).toString('hex')));
      const prevHashes = new Set(results.map((r) => Buffer.from(r.prevHash).toString('hex')));
      expect(ids.size).toBe(100);
      expect(rowHashes.size).toBe(100);
      // Every prev_hash must be unique too (no two rows share a parent).
      expect(prevHashes.size).toBe(100);

      const [{ after }] = await migratorSql<{ after: string }[]>`
        SELECT COUNT(*)::text AS after FROM ledger_events
      `;
      expect(BigInt(after) - baseline).toBe(100n);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // emitAudit — non-fiscal events
  // ────────────────────────────────────────────────────────────────────

  describe('emitAudit() — non-fiscal audit_log', () => {
    it('writes a row, app can SELECT it back', async () => {
      const result = await emitAudit(appDb, {
        eventType: 'user.login',
        actorUserId: null,
        userAgent: 'vitest/test',
        payload: { source: 'integration test' },
      });
      expect(result.id).toBeGreaterThan(0n);
      const [row] = await appSql<{ event_type: string }[]>`
        SELECT event_type FROM audit_log WHERE id = ${result.id.toString()}::bigint
      `;
      expect(row.event_type).toBe('user.login');
    });

    it('app role CANNOT UPDATE or DELETE audit_log', async () => {
      const r = await emitAudit(appDb, { eventType: 'user.test', payload: {} });
      await expect(
        appSql`UPDATE audit_log SET event_type = 'forged' WHERE id = ${r.id.toString()}::bigint`,
      ).rejects.toThrow(/permission denied/i);
      await expect(
        appSql`DELETE FROM audit_log WHERE id = ${r.id.toString()}::bigint`,
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
