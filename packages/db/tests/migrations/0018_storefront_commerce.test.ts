/**
 * Migration 0018 — Storefront commerce schema.
 *
 * Focused tests:
 *   • 5 new enums present with expected labels
 *   • shoppers: 1:1 with customers, email_blind_index partial UNIQUE active-only
 *   • carts: one ACTIVE per shopper enforced, CHECKOUT requires reservation evidence
 *   • cart_items: one product per cart UNIQUE
 *   • payment_intents: provider+provider_intent_id UNIQUE
 *   • webhook_events: provider+provider_event_id UNIQUE (idempotency)
 *   • transactions.sales_channel default POS + shipping CHECK (POS<>NOT_REQUIRED refused, etc.)
 *   • App role grants — narrow column UPDATEs
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

describe('migration 0018_storefront_commerce', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;
  let customerId: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 18);
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

    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Day-19 shopper customer'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    customerId = c!.id;
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  async function makeShopper(opts: { customerId?: string; email?: string } = {}): Promise<string> {
    const cust = opts.customerId ?? customerId;
    const email = opts.email ?? `shopper-${crypto.randomUUID()}@x.test`;
    const [row] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO shoppers (customer_id, email_encrypted, email_blind_index, password_hash)
      SELECT ${cust}, encrypt_pii(${email}), blind_index(${email}), 'argon2id$mock'
        FROM s
      RETURNING id`;
    return row!.id;
  }

  async function makeProduct(): Promise<string> {
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at,
                            listed_on_storefront)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
              'gold_jewelry'::item_type, '50.00', '100.00', 'Online ring', now(), TRUE)
      RETURNING id`;
    return p!.id;
  }

  // ────────────────────────────────────────────────────────────────────
  // 1. Enums
  // ────────────────────────────────────────────────────────────────────

  describe('enums', () => {
    it.each([
      ['cart_status', ['ACTIVE', 'CHECKOUT', 'ABANDONED', 'CONVERTED']],
      ['payment_provider', ['STRIPE', 'PAYPAL', 'MOLLIE']],
      [
        'payment_intent_status',
        ['CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED'],
      ],
      ['sales_channel', ['POS', 'WEB', 'EBAY', 'PHONE']],
      [
        'shipping_status',
        ['NOT_REQUIRED', 'PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'RETURNED'],
      ],
    ] as const)('enum %s has labels %j', async (enumName, expected) => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = ${enumName} ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([...expected]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. shoppers
  // ────────────────────────────────────────────────────────────────────

  describe('shoppers', () => {
    it('1:1 with customers — duplicate customer_id refused', async () => {
      const id = await makeShopper();
      expect(id).toBeDefined();
      await expect(makeShopper({ customerId })).rejects.toThrow(/unique|customer_id/i);
    });

    it('email_blind_index partial UNIQUE allows re-signup after soft delete', async () => {
      // Fresh customer + shopper.
      const [c] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('Soft-delete tester'), (now() + interval '5 years')::date FROM s
        RETURNING id`;
      const email = `reuse-${crypto.randomUUID()}@x.test`;
      const sid = await makeShopper({ customerId: c!.id, email });

      // Soft-delete the shopper.
      await migratorSql`UPDATE shoppers SET soft_deleted_at = now() WHERE id = ${sid}`;

      // New customer + shopper with the SAME email — should succeed (active row is gone).
      const [c2] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('Re-signup'), (now() + interval '5 years')::date FROM s
        RETURNING id`;
      const sid2 = await makeShopper({ customerId: c2!.id, email });
      expect(sid2).toBeDefined();
    });

    it('marketing_consent=TRUE requires marketing_consent_at', async () => {
      const [c] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('No consent timestamp'), (now() + interval '5 years')::date FROM s
        RETURNING id`;
      const email = `nopconsent-${crypto.randomUUID()}@x.test`;
      await expect(
        migratorSql`
          WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
          INSERT INTO shoppers (customer_id, email_encrypted, email_blind_index, password_hash, marketing_consent)
          SELECT ${c!.id}, encrypt_pii(${email}), blind_index(${email}), 'argon2id$x', TRUE FROM s`,
      ).rejects.toThrow(/shoppers_marketing_consent_has_timestamp/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. carts
  // ────────────────────────────────────────────────────────────────────

  describe('carts', () => {
    it('only one ACTIVE cart per shopper', async () => {
      const [c] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('Cart-active-test'), (now() + interval '5 years')::date FROM s
        RETURNING id`;
      const sid = await makeShopper({ customerId: c!.id });
      await migratorSql`INSERT INTO carts (shopper_id) VALUES (${sid})`;
      await expect(migratorSql`INSERT INTO carts (shopper_id) VALUES (${sid})`).rejects.toThrow(
        /carts_one_active_per_shopper_uq/,
      );
    });

    it('CHECKOUT without reservation evidence is refused', async () => {
      const [c] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('Checkout-evidence-test'), (now() + interval '5 years')::date FROM s
        RETURNING id`;
      const sid = await makeShopper({ customerId: c!.id });
      const [cart] = await migratorSql<{ id: string }[]>`
        INSERT INTO carts (shopper_id) VALUES (${sid}) RETURNING id`;
      // Try to flip to CHECKOUT without the three fields.
      await expect(
        migratorSql`UPDATE carts SET status = 'CHECKOUT'::cart_status WHERE id = ${cart!.id}`,
      ).rejects.toThrow(/carts_checkout_evidence/);
    });

    it('CHECKOUT with full evidence is accepted', async () => {
      const [c] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('Checkout-happy'), (now() + interval '5 years')::date FROM s
        RETURNING id`;
      const sid = await makeShopper({ customerId: c!.id });
      const [cart] = await migratorSql<{ id: string }[]>`
        INSERT INTO carts (shopper_id) VALUES (${sid}) RETURNING id`;
      await expect(
        migratorSql`
          UPDATE carts
             SET status = 'CHECKOUT'::cart_status,
                 reservation_session_id = gen_random_uuid(),
                 checkout_started_at = now(),
                 checkout_expires_at = now() + interval '15 minutes'
           WHERE id = ${cart!.id}`,
      ).resolves.toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. cart_items
  // ────────────────────────────────────────────────────────────────────

  describe('cart_items one-product-per-cart', () => {
    it('refuses duplicate product in the same cart', async () => {
      const [c] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('cart-items-test'), (now() + interval '5 years')::date FROM s
        RETURNING id`;
      const sid = await makeShopper({ customerId: c!.id });
      const [cart] = await migratorSql<{ id: string }[]>`
        INSERT INTO carts (shopper_id) VALUES (${sid}) RETURNING id`;
      const pid = await makeProduct();
      await migratorSql`
        INSERT INTO cart_items (cart_id, product_id, unit_price_eur)
        VALUES (${cart!.id}, ${pid}, '100.00')`;
      await expect(
        migratorSql`
          INSERT INTO cart_items (cart_id, product_id, unit_price_eur)
          VALUES (${cart!.id}, ${pid}, '100.00')`,
      ).rejects.toThrow(/cart_items_one_product_per_cart/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. payment_intents + webhook_events idempotency
  // ────────────────────────────────────────────────────────────────────

  describe('webhook_events idempotency', () => {
    it('duplicate (provider, provider_event_id) refused', async () => {
      await migratorSql`
        INSERT INTO webhook_events (provider, provider_event_id, event_type, raw_body, payload, signature_verified)
        VALUES ('stripe', 'evt_test_1', 'payment_intent.succeeded', '{}', '{"id":"evt_test_1"}'::jsonb, TRUE)`;
      await expect(
        migratorSql`
          INSERT INTO webhook_events (provider, provider_event_id, event_type, raw_body, payload, signature_verified)
          VALUES ('stripe', 'evt_test_1', 'payment_intent.succeeded', '{}', '{"id":"evt_test_1"}'::jsonb, TRUE)`,
      ).rejects.toThrow(/webhook_events_provider_event_uq/);
    });
  });

  describe('payment_intents UNIQUE per provider', () => {
    it('duplicate (provider, provider_intent_id) refused', async () => {
      const [c] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('pi-uq'), (now() + interval '5 years')::date FROM s
        RETURNING id`;
      const sid = await makeShopper({ customerId: c!.id });
      const [a] = await migratorSql<
        { id: string }[]
      >`INSERT INTO carts (shopper_id) VALUES (${sid}) RETURNING id`;
      await migratorSql`UPDATE carts SET status='ABANDONED'::cart_status WHERE id=${a!.id}`;
      const [b] = await migratorSql<
        { id: string }[]
      >`INSERT INTO carts (shopper_id) VALUES (${sid}) RETURNING id`;
      await migratorSql`
        INSERT INTO payment_intents (cart_id, provider, provider_intent_id, amount_eur)
        VALUES (${a!.id}, 'STRIPE'::payment_provider, 'pi_dup_1', '100.00')`;
      await expect(
        migratorSql`
          INSERT INTO payment_intents (cart_id, provider, provider_intent_id, amount_eur)
          VALUES (${b!.id}, 'STRIPE'::payment_provider, 'pi_dup_1', '100.00')`,
      ).rejects.toThrow(/payment_intents_provider_intent_uq/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. transactions.sales_channel + shipping CHECK
  // ────────────────────────────────────────────────────────────────────

  describe('transactions sales_channel + shipping CHECK', () => {
    /** Build a balanced inserter to test the new constraints. */
    async function makeStaffFixtures(): Promise<{ deviceId: string; cashierId: string }> {
      const [u] = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`c-${crypto.randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
        RETURNING id`;
      const [d] = await migratorSql<{ id: string }[]>`
        INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
        VALUES ('POS_TERMINAL'::device_class, ${`CERT-${crypto.randomUUID()}`},
                now() - interval '1 day', now() + interval '365 days', ${u!.id})
        RETURNING id`;
      return { deviceId: d!.id, cashierId: u!.id };
    }

    it('POS default with shipping_status=NOT_REQUIRED is accepted', async () => {
      const { deviceId, cashierId } = await makeStaffFixtures();
      await expect(
        migratorSql.begin(async (sql) => {
          const pid = await (async () => {
            const [p] = await sql<{ id: string }[]>`
              INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                    acquisition_cost_eur, list_price_eur, name)
              VALUES (${`SKU-pos-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
                      'gold_jewelry'::item_type, '50.00', '100.00', 'x')
              RETURNING id`;
            return p!.id;
          })();
          const [tx] = await sql<{ id: string }[]>`
            INSERT INTO transactions (direction, device_id, cashier_user_id,
                                      subtotal_eur, vat_eur, total_eur, tax_treatment_code)
            VALUES ('VERKAUF'::transaction_direction, ${deviceId}, ${cashierId},
                    '84.03', '15.97', '100.00', 'STANDARD_19')
            RETURNING id`;
          await sql`
            INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                           line_vat_eur, line_total_eur,
                                           applied_tax_treatment_code, applied_vat_rate)
            VALUES (${tx!.id}, ${pid}, '84.03', '15.97', '100.00', 'STANDARD_19', '0.1900')`;
          await sql`
            INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
            VALUES (${tx!.id}, 'CASH'::payment_method, '100.00')`;
        }),
      ).resolves.toBeDefined();
    });

    it('POS with shipping_status=PENDING is REFUSED by the channel CHECK', async () => {
      const { deviceId, cashierId } = await makeStaffFixtures();
      await expect(
        migratorSql`
          INSERT INTO transactions (direction, device_id, cashier_user_id,
                                    subtotal_eur, vat_eur, total_eur, tax_treatment_code,
                                    sales_channel, shipping_status)
          VALUES ('VERKAUF'::transaction_direction, ${deviceId}, ${cashierId},
                  '84.03', '15.97', '100.00', 'STANDARD_19',
                  'POS'::sales_channel, 'PENDING'::shipping_status)`,
      ).rejects.toThrow(/transactions_shipping_status_per_channel/);
    });

    it('WEB with shipping_status=NOT_REQUIRED is REFUSED', async () => {
      const { deviceId, cashierId } = await makeStaffFixtures();
      await expect(
        migratorSql`
          INSERT INTO transactions (direction, device_id, cashier_user_id,
                                    subtotal_eur, vat_eur, total_eur, tax_treatment_code,
                                    sales_channel, shipping_status)
          VALUES ('VERKAUF'::transaction_direction, ${deviceId}, ${cashierId},
                  '84.03', '15.97', '100.00', 'STANDARD_19',
                  'WEB'::sales_channel, 'NOT_REQUIRED'::shipping_status)`,
      ).rejects.toThrow(/transactions_shipping_status_per_channel/);
    });

    it('app role CANNOT UPDATE sales_channel (intake-locked)', async () => {
      const { deviceId, cashierId } = await makeStaffFixtures();
      const pid = await (async () => {
        const [p] = await migratorSql<{ id: string }[]>`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name)
          VALUES (${`SKU-lock-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
                  'gold_jewelry'::item_type, '50.00', '100.00', 'x')
          RETURNING id`;
        return p!.id;
      })();
      const txId = await migratorSql.begin(async (sql) => {
        const [t] = await sql<{ id: string }[]>`
          INSERT INTO transactions (direction, device_id, cashier_user_id,
                                    subtotal_eur, vat_eur, total_eur, tax_treatment_code)
          VALUES ('VERKAUF'::transaction_direction, ${deviceId}, ${cashierId},
                  '84.03', '15.97', '100.00', 'STANDARD_19')
          RETURNING id`;
        await sql`
          INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                         line_vat_eur, line_total_eur,
                                         applied_tax_treatment_code, applied_vat_rate)
          VALUES (${t!.id}, ${pid}, '84.03', '15.97', '100.00', 'STANDARD_19', '0.1900')`;
        await sql`
          INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
          VALUES (${t!.id}, 'CASH'::payment_method, '100.00')`;
        return t!.id;
      });

      await expect(
        appSql`UPDATE transactions SET sales_channel = 'WEB'::sales_channel WHERE id = ${txId}`,
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
