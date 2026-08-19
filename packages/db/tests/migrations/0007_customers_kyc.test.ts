/**
 * Migration 0007 — customers + kyc_documents + PII encryption.
 *
 * Focused tests on what matters most:
 *   • Encryption roundtrip via encrypt_pii / decrypt_pii
 *   • Blind index lookup (HMAC-SHA256, exact match without decryption)
 *   • App-role grants — NO DELETE on either table, NO UPDATE on cumulative_* + date_of_birth
 *   • GDPR semantics — soft-deleted customer doesn't block re-signup on email/phone
 *   • CHECK constraints — anonymized chain, verified-has-dates, sha256 length
 *   • Helper function presence + EXECUTE grants
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

describe('migration 0007_customers_kyc', () => {
  let testDb: TestDb;
  let migratorSql: Sql;

  /** Insert a minimum-viable customer with the given email/phone (encrypted + blind-indexed). */
  async function makeCustomer(
    opts: {
      name?: string;
      email?: string | null;
      phone?: string | null;
    } = {},
  ): Promise<string> {
    const name = opts.name ?? 'Test Person';
    const email = opts.email === undefined ? `c-${crypto.randomUUID()}@x.test` : opts.email;
    const phone =
      opts.phone === undefined ? `+49170${Math.floor(Math.random() * 1e7)}` : opts.phone;

    const [row] = await migratorSql<{ id: string }[]>`
      WITH set_key AS (
        SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true)
      )
      INSERT INTO customers (
        full_name_encrypted, email_encrypted, phone_encrypted,
        email_blind_index, phone_blind_index,
        retention_until
      )
      SELECT
        encrypt_pii(${name}),
        ${email}::text IS NOT NULL ? encrypt_pii(${email}) : NULL,
        ${phone}::text IS NOT NULL ? encrypt_pii(${phone}) : NULL,
        ${email}::text IS NOT NULL ? blind_index(lower(${email})) : NULL,
        ${phone}::text IS NOT NULL ? blind_index(${phone}) : NULL,
        (now() + interval '5 years')::date
      FROM set_key
      RETURNING id
    `;
    return row.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 7);
    await setAppPasswordForTest(migratorSql);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // Structure + helper functions
  // ────────────────────────────────────────────────────────────────────

  describe('structure', () => {
    it.each(['customers', 'kyc_documents'])('table %s exists', async (name) => {
      const [row] = await migratorSql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ${name}
        ) AS exists`;
      expect(row.exists).toBe(true);
    });

    it.each(['encrypt_pii', 'decrypt_pii', 'blind_index'])(
      'helper function %s exists',
      async (fn) => {
        const [row] = await migratorSql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = ${fn}
        ) AS exists`;
        expect(row.exists).toBe(true);
      },
    );

    it('customer_number is auto-generated with CUST-YYYY-NNNNNN format', async () => {
      const id = await makeCustomer({ email: null, phone: null });
      const [row] = await migratorSql<{ customer_number: string }[]>`
        SELECT customer_number FROM customers WHERE id = ${id}
      `;
      expect(row.customer_number).toMatch(/^CUST-\d{4}-\d{6}$/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Encryption roundtrip — the centerpiece
  // ────────────────────────────────────────────────────────────────────

  describe('encryption roundtrip via encrypt_pii / decrypt_pii', () => {
    it('plaintext → encrypted bytea → plaintext (same key)', async () => {
      const plaintext = 'Erika Mustermann · Hauptstr. 42 · Berlin';
      const [row] = await migratorSql<{ decrypted: string; ciphertext: Uint8Array }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true)),
             enc AS (SELECT encrypt_pii(${plaintext}) AS c FROM s)
        SELECT decrypt_pii(c) AS decrypted, c AS ciphertext FROM enc
      `;
      expect(row.decrypted).toBe(plaintext);
      // pgp output is binary; >50 bytes overhead means the cipher actually wrapped the payload.
      expect(row.ciphertext.byteLength).toBeGreaterThan(plaintext.length);
    });

    it('two encryptions of the same plaintext produce DIFFERENT ciphertext (random IV)', async () => {
      const plaintext = 'Same Text';
      const [row] = await migratorSql<{ a: Uint8Array; b: Uint8Array }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        SELECT encrypt_pii(${plaintext}) AS a, encrypt_pii(${plaintext}) AS b FROM s
      `;
      // The whole point of probabilistic encryption: a ≠ b.
      expect(Buffer.from(row.a).equals(Buffer.from(row.b))).toBe(false);
    });

    it('NULL plaintext → NULL ciphertext (graceful passthrough)', async () => {
      const [row] = await migratorSql<{ enc: Uint8Array | null; dec: string | null }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        SELECT encrypt_pii(NULL) AS enc, decrypt_pii(NULL) AS dec FROM s
      `;
      expect(row.enc).toBeNull();
      expect(row.dec).toBeNull();
    });

    it('decrypt with the WRONG key raises an error', async () => {
      // Encrypt under PII_KEY, then try to decrypt with a different key in a separate tx.
      const [enc] = await migratorSql<{ c: Uint8Array }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        SELECT encrypt_pii('secret') AS c FROM s
      `;
      const ciphertext = enc.c;

      await expect(
        migratorSql`
          WITH s AS (SELECT set_config('warehouse14.pii_key', 'WRONG-KEY-WRONG-KEY-WRONG-KEY-WRONG', true))
          SELECT decrypt_pii(${ciphertext}) FROM s
        `,
      ).rejects.toThrow(/Wrong key|decryption|decrypt/i);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Blind index — exact-match lookup without decryption
  // ────────────────────────────────────────────────────────────────────

  describe('blind index — HMAC-SHA256 lookup', () => {
    it('same input + same key → same hash', async () => {
      const [row] = await migratorSql<{ a: Uint8Array; b: Uint8Array }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        SELECT blind_index('erika@example.test') AS a,
               blind_index('erika@example.test') AS b
          FROM s
      `;
      expect(Buffer.from(row.a).equals(Buffer.from(row.b))).toBe(true);
      expect(row.a.byteLength).toBe(32); // SHA-256 = 32 bytes
    });

    it('different inputs → different hashes', async () => {
      const [row] = await migratorSql<{ a: Uint8Array; b: Uint8Array }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        SELECT blind_index('a@x.test') AS a, blind_index('b@x.test') AS b FROM s
      `;
      expect(Buffer.from(row.a).equals(Buffer.from(row.b))).toBe(false);
    });

    it('same input + different keys → different hashes (HMAC keyed)', async () => {
      const [row1] = await migratorSql<{ h: Uint8Array }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        SELECT blind_index('joe@x.test') AS h FROM s
      `;
      const [row2] = await migratorSql<{ h: Uint8Array }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', 'A-DIFFERENT-KEY-WITH-SAME-LENGTH-XX', true))
        SELECT blind_index('joe@x.test') AS h FROM s
      `;
      expect(Buffer.from(row1.h).equals(Buffer.from(row2.h))).toBe(false);
    });

    it('lookup by phone hash retrieves the customer without decryption', async () => {
      const phone = '+491701234567';
      const id = await makeCustomer({ phone });

      const [row] = await migratorSql<{ id: string; decrypted_phone: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        SELECT c.id, decrypt_pii(c.phone_encrypted) AS decrypted_phone
          FROM customers c, s
         WHERE c.phone_blind_index = blind_index(${phone})
      `;
      expect(row.id).toBe(id);
      expect(row.decrypted_phone).toBe(phone);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // App-role grants — Day-5 discipline
  // ────────────────────────────────────────────────────────────────────

  describe('app-role grants', () => {
    it.each(['customers', 'kyc_documents'])(
      '%s — app has SELECT + INSERT, NOT DELETE',
      async (tbl) => {
        const [s] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', ${tbl}, 'SELECT') AS has`;
        const [i] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', ${tbl}, 'INSERT') AS has`;
        const [d] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', ${tbl}, 'DELETE') AS has`;
        expect(s.has).toBe(true);
        expect(i.has).toBe(true);
        expect(d.has).toBe(false);
      },
    );

    it.each([
      // Permitted UPDATE columns
      ['full_name_encrypted', true],
      ['email_encrypted', true],
      ['phone_encrypted', true],
      ['email_blind_index', true],
      ['kyc_status', true],
      ['sanctions_match', true],
      ['soft_deleted_at', true],
      ['anonymized_at', true],
      ['preferred_language', true],
      // Forbidden UPDATE columns
      ['id', false],
      ['customer_number', false],
      ['shop_id', false],
      ['date_of_birth_encrypted', false], // DOB immutable after first capture
      ['cumulative_spend_eur', false], // trigger-only
      ['cumulative_ankauf_eur', false], // trigger-only
      ['created_at', false],
    ])('customers.%s app UPDATE → %s', async (column, expected) => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'customers', ${column}, 'UPDATE') AS has`;
      expect(row.has).toBe(expected);
    });

    it.each([
      // Permitted on kyc_documents
      ['verified_at', true],
      ['verified_by_user_id', true],
      // 19.08.2026: die zwei Erkennungs-Spalten sind mit Wanderung 0149
      // ausgezogen (nie gebaute Bilderkennung).
      ['retention_until', true],
      // Forbidden — document evidence is INSERT-once
      ['document_number_encrypted', false],
      ['document_type', false],
      ['document_photo_r2_key', false],
      ['document_photo_sha256', false],
      ['issued_on', false],
      ['expires_on', false],
      ['captured_by_user_id', false],
      ['captured_at', false],
      ['customer_id', false],
    ])('kyc_documents.%s app UPDATE → %s', async (column, expected) => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'kyc_documents', ${column}, 'UPDATE') AS has`;
      expect(row.has).toBe(expected);
    });

    it.each(['encrypt_pii(text)', 'decrypt_pii(bytea)', 'blind_index(text)'])(
      'app has EXECUTE on %s',
      async (signature) => {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_function_privilege('warehouse14_app', ${signature}, 'EXECUTE') AS has`;
        expect(row.has).toBe(true);
      },
    );

    it('app role CANNOT DELETE customers (GwG/§259 evidence)', async () => {
      const id = await makeCustomer();
      const appSql = testDb.appSql();
      try {
        await expect(appSql`DELETE FROM customers WHERE id = ${id}`).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role CANNOT UPDATE cumulative_spend_eur (trigger-only)', async () => {
      const id = await makeCustomer();
      const appSql = testDb.appSql();
      try {
        await expect(
          appSql`UPDATE customers SET cumulative_spend_eur = 9999.99 WHERE id = ${id}`,
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // GDPR semantics — partial unique blind index allows post-purge re-signup
  // ────────────────────────────────────────────────────────────────────

  describe("GDPR — soft-deleted customer doesn't block re-signup", () => {
    it('two ACTIVE customers with the same email_blind_index collide', async () => {
      const email = `dup-${crypto.randomUUID()}@x.test`;
      await makeCustomer({ email });
      await expect(makeCustomer({ email })).rejects.toThrow(
        /customers_email_blind_index_active_uq/,
      );
    });

    it("a soft-deleted customer's blind index does not block a new active customer", async () => {
      const email = `resignup-${crypto.randomUUID()}@x.test`;
      const firstId = await makeCustomer({ email });
      await migratorSql`UPDATE customers SET soft_deleted_at = now() WHERE id = ${firstId}`;

      // Re-signup with the same email is permitted.
      const secondId = await makeCustomer({ email });
      expect(secondId).not.toBe(firstId);
    });

    it('NULL blind index does not participate in uniqueness (anonymous customer allowed)', async () => {
      // Two customers without email/phone — no uniqueness collision.
      const a = await makeCustomer({ email: null, phone: null });
      const b = await makeCustomer({ email: null, phone: null });
      expect(a).not.toBe(b);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // CHECK constraints (minimal — catch the most dangerous misuse)
  // ────────────────────────────────────────────────────────────────────

  describe('CHECK constraints', () => {
    it('customers — anonymized_at without soft_deleted_at is rejected', async () => {
      await expect(
        migratorSql`
          WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
          INSERT INTO customers (full_name_encrypted, retention_until, anonymized_at)
          SELECT encrypt_pii('X'), (now() + interval '5 years')::date, now() FROM s
        `,
      ).rejects.toThrow(/customers_anonymized_implies_soft_deleted/);
    });

    it('customers — kyc_status=VERIFIED without kyc_completed_at is rejected', async () => {
      await expect(
        migratorSql`
          WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
          INSERT INTO customers (full_name_encrypted, retention_until, kyc_status)
          SELECT encrypt_pii('X'), (now() + interval '5 years')::date, 'VERIFIED'::kyc_status FROM s
        `,
      ).rejects.toThrow(/customers_verified_has_kyc_dates/);
    });

    it('kyc_documents — document_photo_sha256 length ≠ 32 is rejected', async () => {
      const customerId = await makeCustomer();
      const userId = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`v-${crypto.randomUUID()}@x.test`}, 'Verifier', 'ADMIN'::user_role)
        RETURNING id
      `.then((rows) => rows[0]!.id);

      await expect(
        migratorSql`
          WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
          INSERT INTO kyc_documents (
            customer_id, document_type, issuing_country_iso2,
            document_number_encrypted, expires_on,
            document_photo_r2_key, document_photo_sha256,
            captured_by_user_id, retention_until
          )
          SELECT ${customerId}, 'PERSONALAUSWEIS'::id_document_type, 'DE',
                 encrypt_pii('IDN-12345'), '2030-01-01'::date,
                 'kyc/photo.jpg', '\\x1234',         -- only 2 bytes, not 32
                 ${userId}, '2031-01-01'::date
          FROM s
        `,
      ).rejects.toThrow(/kyc_documents_sha256_length/);
    });

    it('kyc_documents — verified_at set but verified_by_user_id NULL → rejected', async () => {
      const customerId = await makeCustomer();
      const userId = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`v2-${crypto.randomUUID()}@x.test`}, 'V', 'CASHIER'::user_role)
        RETURNING id
      `.then((rows) => rows[0]!.id);

      await expect(
        migratorSql`
          WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
          INSERT INTO kyc_documents (
            customer_id, document_type, issuing_country_iso2,
            document_number_encrypted, expires_on,
            document_photo_r2_key, document_photo_sha256,
            captured_by_user_id, retention_until,
            verified_at
          )
          SELECT ${customerId}, 'PERSONALAUSWEIS'::id_document_type, 'DE',
                 encrypt_pii('IDN-X'), '2030-01-01'::date,
                 'kyc/photo.jpg', digest('photo-bytes', 'sha256'),
                 ${userId}, '2031-01-01'::date,
                 now()        -- verified_at set, but verified_by_user_id NULL
          FROM s
        `,
      ).rejects.toThrow(/kyc_documents_verified_has_verifier/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // End-to-end: capture a KYC document, retrieve via blind index lookup
  // ────────────────────────────────────────────────────────────────────

  describe('end-to-end Ankauf KYC scenario', () => {
    it('captures KYC + retrieves customer by phone hash + decrypts the document number', async () => {
      const phone = '+491701112222';
      const customerId = await makeCustomer({
        name: 'Karl Mustermann',
        email: 'karl@example.test',
        phone,
      });

      const userId = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`cashier-${crypto.randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
        RETURNING id
      `.then((rows) => rows[0]!.id);

      // Capture KYC document under the same encryption key.
      await migratorSql`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO kyc_documents (
          customer_id, document_type, issuing_country_iso2, issuing_authority,
          document_number_encrypted, issued_on, expires_on,
          document_photo_r2_key, document_photo_sha256,
          captured_by_user_id, retention_until
        )
        SELECT ${customerId}, 'PERSONALAUSWEIS'::id_document_type, 'DE', 'Stadtverwaltung Berlin',
               encrypt_pii('T22000129'), '2024-05-01'::date, '2034-05-01'::date,
               'kyc/abc.jpg', digest('photo-bytes', 'sha256'),
               ${userId}, '2029-05-01'::date
        FROM s
      `;

      // Now retrieve: find the customer by phone (no decryption), then decrypt the document number.
      const [row] = await migratorSql<
        {
          customer_number: string;
          name: string;
          doc_number: string;
        }[]
      >`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        SELECT c.customer_number,
               decrypt_pii(c.full_name_encrypted)        AS name,
               decrypt_pii(k.document_number_encrypted)  AS doc_number
          FROM customers c
          JOIN kyc_documents k ON k.customer_id = c.id
          CROSS JOIN s
         WHERE c.phone_blind_index = blind_index(${phone})
      `;

      expect(row.name).toBe('Karl Mustermann');
      expect(row.doc_number).toBe('T22000129');
      expect(row.customer_number).toMatch(/^CUST-\d{4}-\d{6}$/);
    });
  });
});
