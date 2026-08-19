/**
 * Migration 0010 — TSE state machine + offline resilience.
 *
 * Focused tests on what matters:
 *   1. State machine transitions (valid + invalid)
 *   2. Offline-resilient flow: QUEUED_OFFLINE → ACTIVE → FINISHED
 *   3. Signature immutability after FINISHED
 *   4. UNIQUE (transaction_id) — exactly one TSE per fiscal transaction
 *   5. App grants — no DELETE, immutable transaction_id linkage
 *   6. Ledger event emitted on every state change (chain extends)
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verifyChain } from '@norns/audit';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0010_tse — Fiskaly state machine', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;

  /** Seed a transactions row to link the TSE record to. */
  async function makeTransaction(): Promise<string> {
    const [user] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`tse-u-${crypto.randomUUID()}@x.test`}, 'C', 'CASHIER'::user_role)
      RETURNING id`;
    const [device] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${`CERT-${crypto.randomUUID()}`},
              now() - interval '1 day', now() + interval '365 days', ${user.id})
      RETURNING id`;
    const [tr] = await migratorSql<{ id: string }[]>`
      INSERT INTO transactions (direction, device_id, cashier_user_id,
                                subtotal_eur, vat_eur, total_eur, tax_treatment_code)
      VALUES ('VERKAUF'::transaction_direction, ${device.id}, ${user.id},
              '10.00', '0.00', '10.00', 'INVESTMENT_GOLD_25C')
      RETURNING id`;
    return tr.id;
  }

  /** Minimal TSE row with just the required NOT NULL Fiskaly identifiers. */
  async function makeTse(transactionId: string, state = 'QUEUED_OFFLINE'): Promise<string> {
    const [row] = await migratorSql<{ id: string }[]>`
      INSERT INTO tse_transactions (transaction_id, state, fiskaly_tss_id, fiskaly_client_id, created_offline)
      VALUES (${transactionId}, ${state}::tse_state, gen_random_uuid(), gen_random_uuid(),
              ${state === 'QUEUED_OFFLINE'})
      RETURNING id`;
    return row.id;
  }

  /** Helper: full signature update payload (everything FINISHED needs). */
  function finishedFields(opts: { counter: bigint } = { counter: 1n }) {
    // postgres-js wants bigints as strings when interpolated via template literals.
    return {
      state: 'FINISHED' as const,
      signature_value: 'base64SIGNATURE',
      signature_counter: opts.counter.toString(),
      fiskaly_transaction_number: opts.counter.toString(),
      signature_algorithm: 'ecdsa-plain-SHA256',
      start_time: new Date(Date.now() - 1000),
      end_time: new Date(),
      signed_at: new Date(),
      qr_code_data: 'V0;Kassenbeleg-V1;...',
    };
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 10);
    await setAppPasswordForTest(migratorSql);

    appSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 5,
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. State machine — valid transitions
  // ────────────────────────────────────────────────────────────────────

  describe('valid state transitions', () => {
    it('QUEUED_OFFLINE → ACTIVE → FINISHED (the canonical offline-resilient flow)', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId, 'QUEUED_OFFLINE');

      // POS comes online; worker syncs the INTENTION to Fiskaly → ACTIVE.
      await appSql`
        UPDATE tse_transactions
           SET state = 'ACTIVE'::tse_state,
               fiskaly_transaction_id = gen_random_uuid()
         WHERE id = ${tseId}`;

      // Fiskaly returns the signature → FINISHED.
      const f = finishedFields({ counter: 42n });
      await appSql`
        UPDATE tse_transactions
           SET state = ${f.state}::tse_state,
               signature_value = ${f.signature_value},
               signature_counter = ${f.signature_counter}::bigint,
               fiskaly_transaction_number = ${f.fiskaly_transaction_number}::bigint,
               signature_algorithm = ${f.signature_algorithm},
               start_time = ${f.start_time},
               end_time = ${f.end_time},
               signed_at = ${f.signed_at},
               qr_code_data = ${f.qr_code_data}
         WHERE id = ${tseId}`;

      const [row] = await migratorSql<{ state: string; signature_counter: string }[]>`
        SELECT state, signature_counter::text FROM tse_transactions WHERE id = ${tseId}`;
      expect(row.state).toBe('FINISHED');
      expect(row.signature_counter).toBe('42');
    });

    it('QUEUED_OFFLINE → FAILED (when Fiskaly rejects after retries)', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);

      await appSql`
        UPDATE tse_transactions
           SET state = 'FAILED'::tse_state,
               state_reason = 'Fiskaly rejected: invalid client cert',
               last_error_at = now(),
               last_error_code = 'E_CERT_INVALID',
               last_error_message = 'Invalid client certificate',
               retry_count = 5
         WHERE id = ${tseId}`;

      const [row] = await migratorSql<{ state: string; retry_count: number }[]>`
        SELECT state, retry_count FROM tse_transactions WHERE id = ${tseId}`;
      expect(row.state).toBe('FAILED');
      expect(row.retry_count).toBe(5);
    });

    it('ACTIVE → CANCELLED (rare admin path)', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);

      await appSql`UPDATE tse_transactions SET state = 'ACTIVE'::tse_state WHERE id = ${tseId}`;
      await appSql`
        UPDATE tse_transactions
           SET state = 'CANCELLED'::tse_state,
               state_reason = 'Operator-initiated cancellation'
         WHERE id = ${tseId}`;

      const [row] = await migratorSql<{ state: string }[]>`
        SELECT state FROM tse_transactions WHERE id = ${tseId}`;
      expect(row.state).toBe('CANCELLED');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. State machine — invalid transitions
  // ────────────────────────────────────────────────────────────────────

  describe('invalid state transitions are rejected', () => {
    it('FINISHED → ACTIVE is rejected (terminal state)', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);

      const f = finishedFields();
      await appSql`
        UPDATE tse_transactions
           SET state = ${f.state}::tse_state,
               signature_value = ${f.signature_value},
               signature_counter = ${f.signature_counter}::bigint,
               fiskaly_transaction_number = ${f.fiskaly_transaction_number}::bigint,
               signature_algorithm = ${f.signature_algorithm},
               start_time = ${f.start_time},
               end_time = ${f.end_time},
               signed_at = ${f.signed_at},
               qr_code_data = ${f.qr_code_data}
         WHERE id = ${tseId}`;

      await expect(
        appSql`UPDATE tse_transactions SET state = 'ACTIVE'::tse_state WHERE id = ${tseId}`,
      ).rejects.toThrow(/Cannot transition out of terminal/i);
    });

    it('ACTIVE → QUEUED_OFFLINE is rejected (illegal regression)', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);
      await appSql`UPDATE tse_transactions SET state = 'ACTIVE'::tse_state WHERE id = ${tseId}`;
      await expect(
        appSql`UPDATE tse_transactions SET state = 'QUEUED_OFFLINE'::tse_state WHERE id = ${tseId}`,
      ).rejects.toThrow(/Invalid TSE state transition/);
    });

    it('FAILED → FINISHED is rejected (FAILED is terminal)', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);

      await appSql`
        UPDATE tse_transactions
           SET state = 'FAILED'::tse_state,
               last_error_at = now(),
               last_error_code = 'E_TIMEOUT'
         WHERE id = ${tseId}`;

      await expect(
        appSql`UPDATE tse_transactions SET state = 'FINISHED'::tse_state WHERE id = ${tseId}`,
      ).rejects.toThrow(/terminal/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Signature immutability after FINISHED
  // ────────────────────────────────────────────────────────────────────

  describe('signature immutability after FINISHED', () => {
    it('signature_value cannot be UPDATEd once FINISHED', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);
      const f = finishedFields({ counter: 100n });

      await appSql`
        UPDATE tse_transactions
           SET state = ${f.state}::tse_state,
               signature_value = ${f.signature_value},
               signature_counter = ${f.signature_counter}::bigint,
               fiskaly_transaction_number = ${f.fiskaly_transaction_number}::bigint,
               signature_algorithm = ${f.signature_algorithm},
               start_time = ${f.start_time},
               end_time = ${f.end_time},
               signed_at = ${f.signed_at},
               qr_code_data = ${f.qr_code_data}
         WHERE id = ${tseId}`;

      await expect(
        appSql`UPDATE tse_transactions SET signature_value = 'FORGED' WHERE id = ${tseId}`,
      ).rejects.toThrow(/immutable after FINISHED/);
    });

    it('qr_code_data cannot be UPDATEd once FINISHED', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);
      const f = finishedFields({ counter: 101n });

      await appSql`
        UPDATE tse_transactions
           SET state = ${f.state}::tse_state,
               signature_value = ${f.signature_value},
               signature_counter = ${f.signature_counter}::bigint,
               fiskaly_transaction_number = ${f.fiskaly_transaction_number}::bigint,
               signature_algorithm = ${f.signature_algorithm},
               start_time = ${f.start_time},
               end_time = ${f.end_time},
               signed_at = ${f.signed_at},
               qr_code_data = ${f.qr_code_data}
         WHERE id = ${tseId}`;

      await expect(
        appSql`UPDATE tse_transactions SET qr_code_data = 'forged-qr' WHERE id = ${tseId}`,
      ).rejects.toThrow(/immutable after FINISHED/);
    });

    it('state_reason CAN still be updated after FINISHED (annotation only)', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);
      const f = finishedFields({ counter: 102n });

      await appSql`
        UPDATE tse_transactions
           SET state = ${f.state}::tse_state,
               signature_value = ${f.signature_value},
               signature_counter = ${f.signature_counter}::bigint,
               fiskaly_transaction_number = ${f.fiskaly_transaction_number}::bigint,
               signature_algorithm = ${f.signature_algorithm},
               start_time = ${f.start_time},
               end_time = ${f.end_time},
               signed_at = ${f.signed_at},
               qr_code_data = ${f.qr_code_data}
         WHERE id = ${tseId}`;

      // Annotation should succeed (state_reason is not in the immutable set).
      await appSql`
        UPDATE tse_transactions
           SET state_reason = 'Note: archived 2026-05-25'
         WHERE id = ${tseId}`;
      const [row] = await migratorSql<{ state_reason: string }[]>`
        SELECT state_reason FROM tse_transactions WHERE id = ${tseId}`;
      expect(row.state_reason).toBe('Note: archived 2026-05-25');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Uniqueness + identity invariants
  // ────────────────────────────────────────────────────────────────────

  describe('uniqueness + identity', () => {
    it('only one TSE row per transaction (UNIQUE constraint)', async () => {
      const trId = await makeTransaction();
      await makeTse(trId);
      await expect(makeTse(trId)).rejects.toThrow(/tse_transactions_unique_per_transaction/);
    });

    it('transaction_id is immutable after INSERT', async () => {
      const trA = await makeTransaction();
      const trB = await makeTransaction();
      const tseId = await makeTse(trA);
      await expect(
        appSql`UPDATE tse_transactions SET transaction_id = ${trB} WHERE id = ${tseId}`,
      ).rejects.toThrow(/transaction_id is immutable/);
    });

    it('created_offline is immutable after INSERT', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);
      await expect(
        appSql`UPDATE tse_transactions SET created_offline = FALSE WHERE id = ${tseId}`,
      ).rejects.toThrow(/created_offline is set at INSERT and immutable/);
    });

    it('FINISHED INSERT without complete signature fields is rejected', async () => {
      const trId = await makeTransaction();
      await expect(
        migratorSql`
          INSERT INTO tse_transactions (transaction_id, state, fiskaly_tss_id, fiskaly_client_id)
          VALUES (${trId}, 'FINISHED'::tse_state, gen_random_uuid(), gen_random_uuid())
        `,
      ).rejects.toThrow(/tse_transactions_finished_has_signature/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. App grants — append-only + narrow UPDATE
  // ────────────────────────────────────────────────────────────────────

  describe('app-role grants', () => {
    it('app has SELECT + INSERT, NOT DELETE', async () => {
      for (const [priv, expected] of [
        ['SELECT', true],
        ['INSERT', true],
        ['DELETE', false],
      ] as const) {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', 'tse_transactions', ${priv}) AS has`;
        expect(row.has, priv).toBe(expected);
      }
    });

    it.each([
      // App CAN update lifecycle + signature + retry columns:
      ['state', true],
      ['signature_value', true],
      ['signature_counter', true],
      ['qr_code_data', true],
      ['retry_count', true],
      ['last_error_at', true],
      ['updated_at', true],
      // App CANNOT update identity / immutable columns:
      ['id', false],
      ['transaction_id', false],
      ['fiskaly_tss_id', false],
      ['fiskaly_client_id', false],
      ['process_type', false],
      ['created_offline', false],
      ['created_at', false],
    ])('tse_transactions.%s app UPDATE → %s', async (column, expected) => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'tse_transactions', ${column}, 'UPDATE') AS has`;
      expect(row.has).toBe(expected);
    });

    it('app CANNOT DELETE even when row exists', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId);
      await expect(appSql`DELETE FROM tse_transactions WHERE id = ${tseId}`).rejects.toThrow(
        /permission denied/i,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. Ledger events emitted on every state change
  // ────────────────────────────────────────────────────────────────────

  describe('ledger emission + chain integrity', () => {
    it('emits tse.queued_offline on INSERT, tse.active + tse.finished on state changes', async () => {
      const trId = await makeTransaction();
      const tseId = await makeTse(trId, 'QUEUED_OFFLINE');

      await appSql`UPDATE tse_transactions SET state = 'ACTIVE'::tse_state WHERE id = ${tseId}`;

      const f = finishedFields({ counter: 200n });
      await appSql`
        UPDATE tse_transactions
           SET state = ${f.state}::tse_state,
               signature_value = ${f.signature_value},
               signature_counter = ${f.signature_counter}::bigint,
               fiskaly_transaction_number = ${f.fiskaly_transaction_number}::bigint,
               signature_algorithm = ${f.signature_algorithm},
               start_time = ${f.start_time},
               end_time = ${f.end_time},
               signed_at = ${f.signed_at},
               qr_code_data = ${f.qr_code_data}
         WHERE id = ${tseId}`;

      const events = await migratorSql<{ event_type: string }[]>`
        SELECT event_type FROM ledger_events
         WHERE entity_table = 'tse_transactions' AND entity_id = ${tseId}
         ORDER BY id`;
      expect(events.map((e) => e.event_type)).toEqual([
        'tse.queued_offline',
        'tse.active',
        'tse.finished',
      ]);

      // Chain still valid after the TSE lifecycle.
      const result = await verifyChain(appDb);
      expect(result.valid).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. Trigger ownership (Day-6/Day-7 discipline carried forward)
  // ────────────────────────────────────────────────────────────────────

  describe('trigger ownership', () => {
    it('on_tse_state_event() is SECURITY DEFINER owned by warehouse14_security', async () => {
      const [row] = await migratorSql<{ owner: string; sec_def: boolean }[]>`
        SELECT pg_get_userbyid(proowner) AS owner, prosecdef AS sec_def
          FROM pg_proc WHERE proname = 'on_tse_state_event'`;
      expect(row.owner).toBe('warehouse14_security');
      expect(row.sec_def).toBe(true);
    });
  });
});
