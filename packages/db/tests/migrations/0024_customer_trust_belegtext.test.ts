/**
 * Migration 0024 — Backend Finale (Day 26).
 *
 * Focused tests:
 *   • customer_trust_level enum labels (5)
 *   • customers extensions:
 *       - kyc_verified_evidence (both-or-none)
 *       - verified_trust_requires_kyc
 *       - banned_or_suspicious_has_note
 *   • belegtext_kind enum labels (8)
 *   • belegtext_templates one-CURRENT-per-(kind,language) partial UNIQUE
 *   • close-out + insert workflow keeps history append-only
 *   • valid_range, body_length, language_format CHECKs
 *   • Seed: all 4 mandatory DE texts + 2 generic blocks present at CURRENT
 *   • resolve_belegtext_for_tax_treatment() maps codes correctly
 *   • role grants: app can UPDATE valid_to (close-out) but not body_text;
 *     app can UPDATE customers.trust_level
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

describe('migration 0024_customer_trust_belegtext', () => {
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

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 24);
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

  describe('customer_trust_level enum', () => {
    it('has 5 expected labels in order', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'customer_trust_level' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'NEW',
        'VERIFIED',
        'VIP',
        'SUSPICIOUS',
        'BANNED',
      ]);
    });
  });

  describe('belegtext_kind enum', () => {
    it('has 8 expected labels in order', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'belegtext_kind' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'MARGIN_25A',
        'STANDARD_19',
        'REDUCED_7',
        'INVESTMENT_GOLD_25C',
        'KLEINUNTERNEHMER_19',
        'ANKAUFBELEG_DECLARATION',
        'GENERIC_HEADER',
        'GENERIC_FOOTER',
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. customers.trust_level + KYC verification CHECKs
  // ────────────────────────────────────────────────────────────────────

  describe('customers KYC + trust CHECKs', () => {
    it('default trust_level is NEW', async () => {
      const id = await makeCustomer();
      const [row] = await migratorSql<{ trust_level: string }[]>`
        SELECT trust_level FROM customers WHERE id = ${id}`;
      expect(row!.trust_level).toBe('NEW');
    });

    it('refuses kyc_verified_at without user', async () => {
      const id = await makeCustomer();
      await expect(
        migratorSql`UPDATE customers SET kyc_verified_at = now() WHERE id = ${id}`,
      ).rejects.toThrow(/customers_kyc_verified_evidence/);
    });

    it('refuses kyc_verified_by_user_id without timestamp', async () => {
      const id = await makeCustomer();
      const userId = await makeUser();
      await expect(
        migratorSql`UPDATE customers SET kyc_verified_by_user_id = ${userId} WHERE id = ${id}`,
      ).rejects.toThrow(/customers_kyc_verified_evidence/);
    });

    it('accepts both set together', async () => {
      const id = await makeCustomer();
      const userId = await makeUser();
      await expect(
        migratorSql`
          UPDATE customers
             SET kyc_verified_at = now(), kyc_verified_by_user_id = ${userId}
           WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });

    it('refuses promotion to VERIFIED without kyc_verified_at', async () => {
      const id = await makeCustomer();
      await expect(
        migratorSql`UPDATE customers SET trust_level = 'VERIFIED'::customer_trust_level WHERE id = ${id}`,
      ).rejects.toThrow(/customers_verified_trust_requires_kyc/);
    });

    it('refuses promotion to VIP without kyc_verified_at', async () => {
      const id = await makeCustomer();
      await expect(
        migratorSql`UPDATE customers SET trust_level = 'VIP'::customer_trust_level WHERE id = ${id}`,
      ).rejects.toThrow(/customers_verified_trust_requires_kyc/);
    });

    it('accepts VERIFIED once KYC is set', async () => {
      const id = await makeCustomer();
      const userId = await makeUser();
      await migratorSql`
        UPDATE customers
           SET kyc_verified_at = now(), kyc_verified_by_user_id = ${userId}
         WHERE id = ${id}`;
      await expect(
        migratorSql`UPDATE customers SET trust_level = 'VERIFIED'::customer_trust_level WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });

    it('refuses SUSPICIOUS without an ≥ 8-char note', async () => {
      const id = await makeCustomer();
      await expect(
        migratorSql`UPDATE customers SET trust_level = 'SUSPICIOUS'::customer_trust_level WHERE id = ${id}`,
      ).rejects.toThrow(/customers_banned_or_suspicious_has_note/);
      await expect(
        migratorSql`
          UPDATE customers
             SET trust_level = 'SUSPICIOUS'::customer_trust_level,
                 price_expectation_notes = 'short'
           WHERE id = ${id}`,
      ).rejects.toThrow(/customers_banned_or_suspicious_has_note/);
    });

    it('accepts SUSPICIOUS with reason', async () => {
      const id = await makeCustomer();
      await expect(
        migratorSql`
          UPDATE customers
             SET trust_level = 'SUSPICIOUS'::customer_trust_level,
                 price_expectation_notes = 'Multiple high-value cash purchases without ID; AML watch.'
           WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });

    it('refuses BANNED without note', async () => {
      const id = await makeCustomer();
      await expect(
        migratorSql`UPDATE customers SET trust_level = 'BANNED'::customer_trust_level WHERE id = ${id}`,
      ).rejects.toThrow(/customers_banned_or_suspicious_has_note/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. belegtext_templates — seed + invariants
  // ────────────────────────────────────────────────────────────────────

  describe('belegtext_templates seed', () => {
    it('the 4 mandatory German tax texts + 2 generic blocks are present', async () => {
      const rows = await migratorSql<{ kind: string; body_text: string }[]>`
        SELECT kind, body_text FROM belegtext_templates
         WHERE language = 'de' AND valid_to IS NULL
         ORDER BY kind`;
      const kinds = rows.map((r) => r.kind);
      expect(kinds).toContain('MARGIN_25A');
      expect(kinds).toContain('STANDARD_19');
      expect(kinds).toContain('REDUCED_7');
      expect(kinds).toContain('INVESTMENT_GOLD_25C');
      expect(kinds).toContain('ANKAUFBELEG_DECLARATION');
      expect(kinds).toContain('GENERIC_HEADER');
      expect(kinds).toContain('GENERIC_FOOTER');

      // Verify legal phrasing on a couple of the rows.
      const margin = rows.find((r) => r.kind === 'MARGIN_25A')!;
      expect(margin.body_text).toContain('§ 25a');

      const standard = rows.find((r) => r.kind === 'STANDARD_19')!;
      expect(standard.body_text).toContain('19');
    });
  });

  describe('belegtext_templates one-CURRENT-per-(kind,language) UNIQUE', () => {
    it('refuses a second CURRENT for the same (kind, language)', async () => {
      const userId = await makeUser();
      // STANDARD_19 / de is already seeded as CURRENT — second INSERT should fail.
      await expect(
        migratorSql`
          INSERT INTO belegtext_templates (kind, language, body_text, created_by_user_id)
          VALUES (
            'STANDARD_19'::belegtext_kind, 'de',
            'Duplicate STANDARD_19 / de',
            ${userId}
          )`,
      ).rejects.toThrow(/belegtext_one_current_per_kind_lang_uq|duplicate key/);
    });

    it('allows a different language for the same kind', async () => {
      const userId = await makeUser();
      await expect(
        migratorSql`
          INSERT INTO belegtext_templates (kind, language, body_text, created_by_user_id)
          VALUES (
            'STANDARD_19'::belegtext_kind, 'en',
            'The displayed price includes 19% VAT pursuant to § 12 (1) German VAT Act.',
            ${userId}
          )`,
      ).resolves.toBeDefined();
    });

    it('close-out + insert pattern produces a new CURRENT', async () => {
      const userId = await makeUser();
      // Close the seeded REDUCED_7 / de and insert a new one — in one TX.
      await migratorSql.begin(async (tx) => {
        await tx`
          UPDATE belegtext_templates SET valid_to = now()
           WHERE kind = 'REDUCED_7' AND language = 'de' AND valid_to IS NULL`;
        await tx`
          INSERT INTO belegtext_templates (kind, language, body_text, created_by_user_id)
          VALUES (
            'REDUCED_7'::belegtext_kind, 'de',
            'Im Preis ist die gesetzliche Umsatzsteuer von 7 % enthalten (überarbeitete Fassung).',
            ${userId}
          )`;
      });

      const rows = await migratorSql<{ body_text: string; valid_to: Date | null }[]>`
        SELECT body_text, valid_to FROM belegtext_templates
         WHERE kind = 'REDUCED_7' AND language = 'de'
         ORDER BY valid_from`;
      expect(rows.length).toBe(2);
      expect(rows[0]!.valid_to).not.toBeNull();
      expect(rows[1]!.valid_to).toBeNull();
      expect(rows[1]!.body_text).toContain('überarbeitete');
    });
  });

  describe('belegtext_templates CHECK constraints', () => {
    it('refuses empty body_text', async () => {
      const userId = await makeUser();
      // First close out the seeded INVESTMENT_GOLD_25C / de to avoid UNIQUE clash.
      await migratorSql`
        UPDATE belegtext_templates SET valid_to = now()
         WHERE kind = 'INVESTMENT_GOLD_25C' AND language = 'de' AND valid_to IS NULL`;
      await expect(
        migratorSql`
          INSERT INTO belegtext_templates (kind, language, body_text, created_by_user_id)
          VALUES ('INVESTMENT_GOLD_25C'::belegtext_kind, 'de', '', ${userId})`,
      ).rejects.toThrow(/belegtext_body_length/);
    });

    it('refuses invalid language code', async () => {
      const userId = await makeUser();
      await expect(
        migratorSql`
          INSERT INTO belegtext_templates (kind, language, body_text, created_by_user_id)
          VALUES ('GENERIC_HEADER'::belegtext_kind, 'GERMAN', 'x', ${userId})`,
      ).rejects.toThrow(/belegtext_language_format/);
    });

    it('refuses valid_to <= valid_from', async () => {
      const userId = await makeUser();
      await expect(
        migratorSql`
          INSERT INTO belegtext_templates
            (kind, language, body_text, created_by_user_id, valid_from, valid_to)
          VALUES (
            'GENERIC_HEADER'::belegtext_kind, 'fr',
            'En-tête', ${userId},
            '2026-01-01 12:00+00', '2026-01-01 11:00+00'
          )`,
      ).rejects.toThrow(/belegtext_valid_range/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. resolve_belegtext_for_tax_treatment()
  // ────────────────────────────────────────────────────────────────────

  describe('resolve_belegtext_for_tax_treatment()', () => {
    it('maps MARGIN_25A → the §25a text', async () => {
      const [row] = await migratorSql<{ body: string | null }[]>`
        SELECT resolve_belegtext_for_tax_treatment('MARGIN_25A', 'de') AS body`;
      expect(row!.body).toContain('§ 25a');
    });

    it('maps STANDARD_19 → the §12 Abs.1 text', async () => {
      const [row] = await migratorSql<{ body: string | null }[]>`
        SELECT resolve_belegtext_for_tax_treatment('STANDARD_19', 'de') AS body`;
      expect(row!.body).toContain('19');
      expect(row!.body).toContain('§ 12');
    });

    it('maps INVESTMENT_GOLD_25C → §25c text', async () => {
      const [row] = await migratorSql<{ body: string | null }[]>`
        SELECT resolve_belegtext_for_tax_treatment('INVESTMENT_GOLD_25C', 'de') AS body`;
      expect(row!.body).toContain('§ 25c');
    });

    it('returns NULL for unknown code', async () => {
      const [row] = await migratorSql<{ body: string | null }[]>`
        SELECT resolve_belegtext_for_tax_treatment('PLANET_X', 'de') AS body`;
      expect(row!.body).toBeNull();
    });

    it('returns NULL when language has no template', async () => {
      const [row] = await migratorSql<{ body: string | null }[]>`
        SELECT resolve_belegtext_for_tax_treatment('MARGIN_25A', 'ja') AS body`;
      expect(row!.body).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. Role grants
  // ────────────────────────────────────────────────────────────────────

  describe('role grants', () => {
    it('app can UPDATE customers.trust_level (with KYC already set)', async () => {
      const id = await makeCustomer();
      const userId = await makeUser();
      await migratorSql`
        UPDATE customers
           SET kyc_verified_at = now(), kyc_verified_by_user_id = ${userId}
         WHERE id = ${id}`;
      await expect(
        appSql`UPDATE customers SET trust_level = 'VERIFIED'::customer_trust_level WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });

    it('app can INSERT belegtext_templates (default privilege from 0003)', async () => {
      const userId = await makeUser();
      const [r] = await appSql<{ id: string }[]>`
        INSERT INTO belegtext_templates (kind, language, body_text, created_by_user_id)
        VALUES (
          'KLEINUNTERNEHMER_19'::belegtext_kind, 'de',
          'Hinweis: Im Preis ist gemäß § 19 UStG keine Umsatzsteuer enthalten.',
          ${userId}
        )
        RETURNING id`;
      expect(r!.id).toBeDefined();
    });

    it('app can UPDATE belegtext_templates.valid_to (close-out path)', async () => {
      // Use the GENERIC_FOOTER seed row — close it out via app role.
      const [seedRow] = await migratorSql<{ id: string }[]>`
        SELECT id FROM belegtext_templates
         WHERE kind = 'GENERIC_FOOTER' AND language = 'de' AND valid_to IS NULL
         LIMIT 1`;
      await expect(
        appSql`UPDATE belegtext_templates SET valid_to = now() WHERE id = ${seedRow!.id}`,
      ).resolves.toBeDefined();
    });

    it('app CANNOT UPDATE belegtext_templates.body_text (write-once)', async () => {
      const [seedRow] = await migratorSql<{ id: string }[]>`
        SELECT id FROM belegtext_templates
         WHERE kind = 'GENERIC_HEADER' AND language = 'de' AND valid_to IS NULL
         LIMIT 1`;
      await expect(
        appSql`UPDATE belegtext_templates SET body_text = 'TAMPERED' WHERE id = ${seedRow!.id}`,
      ).rejects.toThrow(/permission denied|insufficient privilege/i);
    });

    it('app can EXECUTE resolve_belegtext_for_tax_treatment()', async () => {
      const [row] = await appSql<{ body: string | null }[]>`
        SELECT resolve_belegtext_for_tax_treatment('STANDARD_19', 'de') AS body`;
      expect(row!.body).toContain('19');
    });
  });
});
