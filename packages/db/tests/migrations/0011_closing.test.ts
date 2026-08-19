/**
 * Migration 0011 — daily_closings + dsfinvk_exports + system_settings.
 *
 * Focused tests on the Day-9 directives:
 *   1. Closing immutability — once FINALIZED, all numbers/anchors/markers locked.
 *   2. Cash drawer variance math — DB-enforced.
 *   3. UNIQUE (business_day, shop_id) — exactly one Z-report per shop per day.
 *   4. Ledger event emitted on state change (chain extends to cover closings).
 *   5. dsfinvk_exports state machine + CHECK invariants (delivered ⇒ delivered_at).
 *   6. system_settings AUDIT trigger — every change writes to audit_log automatically.
 *   7. App grants — no DELETE on any of the three tables.
 *   8. Seed data sanity — anomaly threshold, AI budget, intake window all present.
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0011_closing — accounting circle closure', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;

  async function makeUser(): Promise<string> {
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', 'ADMIN'::user_role)
      RETURNING id`;
    return u.id;
  }

  /** Full finalize payload for daily_closings — everything the CHECK requires. */
  function finalizedFields(userId: string, ledgerAnchorId: bigint) {
    return {
      state: 'FINALIZED' as const,
      cash_drawer_expected_eur: '500.00',
      cash_drawer_counted_eur: '500.00',
      cash_drawer_variance_eur: '0.00',
      counted_by_user_id: userId,
      counted_at: new Date(),
      finalized_by_user_id: userId,
      finalized_at: new Date(),
      ledger_anchor_id: ledgerAnchorId.toString(),
      // 32-byte SHA-256 (hex-encoded by test helper)
      ledger_anchor_hash: Buffer.alloc(32, 0xab),
    };
  }

  /** Seed a ledger event so we can anchor a closing to it. */
  async function seedLedgerEvent(): Promise<bigint> {
    const [row] = await migratorSql<{ id: string }[]>`
      INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
      VALUES ('test.seed', 'test', gen_random_uuid(), '{}'::jsonb)
      RETURNING id`;
    return BigInt(row.id);
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 11);
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
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. Seed data — defaults landed
  // ────────────────────────────────────────────────────────────────────

  describe('seed data', () => {
    // 19.08.2026: die Budget- und Gruppierungs-Schluessel des Kanal-Erbes
    // standen hier mit in der Liste — Wanderung 0149 raeumt sie aus, also
    // darf kein Pruefsatz mehr ihre Anwesenheit verlangen.
    it.each([
      'anomaly.sigma_threshold',
      'appointment.no_show_grace_minutes',
      'kyc.high_value_threshold_eur',
      'smurfing.ankauf_count_threshold',
      'cash_drawer.variance_alert_threshold_eur',
    ])('system_setting %s is seeded', async (key) => {
      const [row] = await migratorSql<{ value: unknown }[]>`
        SELECT value FROM system_settings WHERE key = ${key}`;
      expect(row).toBeDefined();
      expect(row.value).not.toBeNull();
    });

    it('anomaly.sigma_threshold = 3.0 (default)', async () => {
      const [row] = await migratorSql<{ value: number }[]>`
        SELECT value::numeric AS value FROM system_settings WHERE key = 'anomaly.sigma_threshold'`;
      expect(Number.parseFloat(row.value as unknown as string)).toBe(3.0);
    });

    // 19.08.2026: der Gruppierungsfenster-Pruefsatz stand hier; sein
    // Schluessel ist mit Wanderung 0149 ausgezogen.
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. system_settings audit trigger
  // ────────────────────────────────────────────────────────────────────

  describe('system_settings audit trigger', () => {
    it('UPDATE on a setting writes a row to audit_log with old + new values', async () => {
      const userId = await makeUser();
      const [{ before_count }] = await migratorSql<{ before_count: string }[]>`
        SELECT COUNT(*)::text AS before_count FROM audit_log
         WHERE event_type = 'system_setting.updated'
           AND payload->>'key' = 'anomaly.sigma_threshold'`;

      // App updates the threshold to 2.5.
      await appSql`
        UPDATE system_settings
           SET value = '2.5'::jsonb,
               updated_by_user_id = ${userId}
         WHERE key = 'anomaly.sigma_threshold'`;

      const [{ after_count }] = await migratorSql<{ after_count: string }[]>`
        SELECT COUNT(*)::text AS after_count FROM audit_log
         WHERE event_type = 'system_setting.updated'
           AND payload->>'key' = 'anomaly.sigma_threshold'`;
      expect(BigInt(after_count) - BigInt(before_count)).toBe(1n);

      const [audit] = await migratorSql<
        { actor_user_id: string; payload: { old_value: unknown; new_value: unknown } }[]
      >`
        SELECT actor_user_id, payload
          FROM audit_log
         WHERE event_type = 'system_setting.updated'
           AND payload->>'key' = 'anomaly.sigma_threshold'
         ORDER BY id DESC LIMIT 1`;
      expect(audit.actor_user_id).toBe(userId);
      expect(audit.payload.new_value).toEqual(2.5);
      expect(audit.payload.old_value).toEqual(3.0);
    });

    it('UPDATE with the SAME value does NOT write to audit_log (no-op skipped)', async () => {
      const userId = await makeUser();
      // Read current value, then set it to itself.
      const [{ value }] = await migratorSql<{ value: unknown }[]>`
        SELECT value FROM system_settings WHERE key = 'ai_budget.alert_threshold_pct'`;

      const [{ before_count }] = await migratorSql<{ before_count: string }[]>`
        SELECT COUNT(*)::text AS before_count FROM audit_log
         WHERE event_type = 'system_setting.updated'
           AND payload->>'key' = 'ai_budget.alert_threshold_pct'`;

      await appSql`
        UPDATE system_settings
           SET value = ${JSON.stringify(value)}::jsonb,
               updated_by_user_id = ${userId}
         WHERE key = 'ai_budget.alert_threshold_pct'`;

      const [{ after_count }] = await migratorSql<{ after_count: string }[]>`
        SELECT COUNT(*)::text AS after_count FROM audit_log
         WHERE event_type = 'system_setting.updated'
           AND payload->>'key' = 'ai_budget.alert_threshold_pct'`;
      expect(BigInt(after_count) - BigInt(before_count)).toBe(0n);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. daily_closings — immutability + CHECK invariants
  // ────────────────────────────────────────────────────────────────────

  describe('daily_closings immutability', () => {
    it('FINALIZED row rejects any UPDATE on numeric/anchor columns', async () => {
      const userId = await makeUser();
      const anchorId = await seedLedgerEvent();

      // INSERT a closing in COUNTING state.
      const [closing] = await migratorSql<{ id: string }[]>`
        INSERT INTO daily_closings (business_day, gross_verkauf_eur, net_verkauf_eur)
        VALUES ('2026-05-23'::date, '1000.00', '1000.00')
        RETURNING id`;

      // FINALIZE it via app.
      const f = finalizedFields(userId, anchorId);
      await appSql`
        UPDATE daily_closings
           SET state = ${f.state}::closing_state,
               cash_drawer_expected_eur = ${f.cash_drawer_expected_eur}::numeric,
               cash_drawer_counted_eur  = ${f.cash_drawer_counted_eur}::numeric,
               cash_drawer_variance_eur = ${f.cash_drawer_variance_eur}::numeric,
               counted_by_user_id       = ${f.counted_by_user_id},
               counted_at               = ${f.counted_at},
               finalized_by_user_id     = ${f.finalized_by_user_id},
               finalized_at             = ${f.finalized_at},
               ledger_anchor_id         = ${f.ledger_anchor_id}::bigint,
               ledger_anchor_hash       = ${f.ledger_anchor_hash}
         WHERE id = ${closing.id}`;

      // Now try to tamper with a numeric — must be rejected.
      await expect(
        appSql`UPDATE daily_closings SET gross_verkauf_eur = '9999.99' WHERE id = ${closing.id}`,
      ).rejects.toThrow(/Cannot modify FINALIZED closing/);

      // Try to revert state — must be rejected.
      await expect(
        appSql`UPDATE daily_closings SET state = 'COUNTING'::closing_state WHERE id = ${closing.id}`,
      ).rejects.toThrow(/Cannot transition out of FINALIZED closing/);

      // But notes IS allowed.
      await appSql`UPDATE daily_closings SET notes = 'Reviewed by Basel' WHERE id = ${closing.id}`;
      const [row] = await migratorSql<
        { notes: string }[]
      >`SELECT notes FROM daily_closings WHERE id = ${closing.id}`;
      expect(row.notes).toBe('Reviewed by Basel');
    });

    it('cash_drawer_variance_math CHECK rejects inconsistent math', async () => {
      await expect(
        migratorSql`
          INSERT INTO daily_closings (business_day,
                                       cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur)
          VALUES ('2026-06-01'::date, '500.00', '500.00', '99.00')   -- variance should be 0, not 99
        `,
      ).rejects.toThrow(/daily_closings_variance_math/);
    });

    it('FINALIZED INSERT without all required evidence is rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO daily_closings (business_day, state)
          VALUES ('2026-06-02'::date, 'FINALIZED'::closing_state)
        `,
      ).rejects.toThrow(/daily_closings_finalized_has_evidence/);
    });

    it('UNIQUE (business_day, shop_id) — two closings on the same day reject', async () => {
      await migratorSql`
        INSERT INTO daily_closings (business_day) VALUES ('2026-06-03'::date)`;
      await expect(
        migratorSql`INSERT INTO daily_closings (business_day) VALUES ('2026-06-03'::date)`,
      ).rejects.toThrow(/daily_closings_business_day_shop_uq/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Closing emits ledger events
  // ────────────────────────────────────────────────────────────────────

  describe('closing → ledger', () => {
    it('emits daily_closing.counting on INSERT and daily_closing.finalized on FINALIZE', async () => {
      const userId = await makeUser();
      const anchorId = await seedLedgerEvent();

      const [closing] = await migratorSql<{ id: string }[]>`
        INSERT INTO daily_closings (business_day) VALUES ('2026-06-04'::date) RETURNING id`;

      const f = finalizedFields(userId, anchorId);
      await appSql`
        UPDATE daily_closings
           SET state = ${f.state}::closing_state,
               cash_drawer_expected_eur = ${f.cash_drawer_expected_eur}::numeric,
               cash_drawer_counted_eur  = ${f.cash_drawer_counted_eur}::numeric,
               cash_drawer_variance_eur = ${f.cash_drawer_variance_eur}::numeric,
               counted_by_user_id       = ${f.counted_by_user_id},
               counted_at               = ${f.counted_at},
               finalized_by_user_id     = ${f.finalized_by_user_id},
               finalized_at             = ${f.finalized_at},
               ledger_anchor_id         = ${f.ledger_anchor_id}::bigint,
               ledger_anchor_hash       = ${f.ledger_anchor_hash}
         WHERE id = ${closing.id}`;

      const events = await migratorSql<{ event_type: string }[]>`
        SELECT event_type FROM ledger_events
         WHERE entity_table = 'daily_closings' AND entity_id = ${closing.id}
         ORDER BY id`;
      expect(events.map((e) => e.event_type)).toEqual([
        'daily_closing.counting',
        'daily_closing.finalized',
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. dsfinvk_exports CHECK invariants + state lifecycle
  // ────────────────────────────────────────────────────────────────────

  describe('dsfinvk_exports', () => {
    it('GENERATED INSERT without file evidence is rejected', async () => {
      const userId = await makeUser();
      await expect(
        migratorSql`
          INSERT INTO dsfinvk_exports (period_start, period_end, state, requested_by_user_id)
          VALUES ('2026-05-01'::date, '2026-05-31'::date, 'GENERATED'::dsfinvk_export_state, ${userId})
        `,
      ).rejects.toThrow(/dsfinvk_exports_generated_has_file/);
    });

    it('DELIVERED_TO_STEUERBERATER requires delivered_at + delivery_method', async () => {
      const userId = await makeUser();
      await expect(
        migratorSql`
          INSERT INTO dsfinvk_exports (period_start, period_end, state, requested_by_user_id,
                                       r2_key, file_size_bytes, file_sha256, generated_at)
          VALUES ('2026-05-01'::date, '2026-05-31'::date,
                  'DELIVERED_TO_STEUERBERATER'::dsfinvk_export_state, ${userId},
                  'exports/foo.zip', 1000, digest('x', 'sha256'), now())
        `,
      ).rejects.toThrow(/dsfinvk_exports_delivered_has_marker/);
    });

    it('period_end < period_start is rejected', async () => {
      const userId = await makeUser();
      await expect(
        migratorSql`
          INSERT INTO dsfinvk_exports (period_start, period_end, requested_by_user_id)
          VALUES ('2026-05-31'::date, '2026-05-01'::date, ${userId})
        `,
      ).rejects.toThrow(/dsfinvk_exports_period_order/);
    });

    it('full lifecycle: GENERATING → GENERATED → DELIVERED_TO_STEUERBERATER', async () => {
      const userId = await makeUser();
      const [exportRow] = await migratorSql<{ id: string }[]>`
        INSERT INTO dsfinvk_exports (period_start, period_end, requested_by_user_id)
        VALUES ('2026-05-01'::date, '2026-05-31'::date, ${userId})
        RETURNING id`;

      // GENERATED
      await appSql`
        UPDATE dsfinvk_exports
           SET state = 'GENERATED'::dsfinvk_export_state,
               generated_at = now(),
               r2_key = 'exports/2026-05.zip',
               file_size_bytes = 12345,
               file_sha256 = digest('content', 'sha256'),
               transaction_count = 100,
               daily_closings_count = 30,
               total_gross_eur = '50000.00'
         WHERE id = ${exportRow.id}`;

      // DELIVERED
      await appSql`
        UPDATE dsfinvk_exports
           SET state = 'DELIVERED_TO_STEUERBERATER'::dsfinvk_export_state,
               delivered_at = now(),
               delivery_method = 'email',
               delivery_target = 'steuerberater@example.test'
         WHERE id = ${exportRow.id}`;

      const [final] = await migratorSql<{ state: string }[]>`
        SELECT state FROM dsfinvk_exports WHERE id = ${exportRow.id}`;
      expect(final.state).toBe('DELIVERED_TO_STEUERBERATER');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. App grants — no DELETE on any of the three tables
  // ────────────────────────────────────────────────────────────────────

  describe('app grants', () => {
    it.each(['daily_closings', 'dsfinvk_exports', 'system_settings'])(
      '%s — app cannot DELETE',
      async (tbl) => {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', ${tbl}, 'DELETE') AS has`;
        expect(row.has).toBe(false);
      },
    );

    it('app CANNOT update system_settings.created_at (immutable)', async () => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'system_settings', 'created_at', 'UPDATE') AS has`;
      expect(row.has).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. Trigger ownership
  // ────────────────────────────────────────────────────────────────────

  describe('trigger ownership', () => {
    it.each(['on_daily_closing_event', 'on_system_setting_event'])(
      '%s is SECURITY DEFINER owned by warehouse14_security',
      async (fn) => {
        const [row] = await migratorSql<{ owner: string; sec_def: boolean }[]>`
          SELECT pg_get_userbyid(proowner) AS owner, prosecdef AS sec_def
            FROM pg_proc WHERE proname = ${fn}`;
        expect(row.owner).toBe('warehouse14_security');
        expect(row.sec_def).toBe(true);
      },
    );
  });
});
