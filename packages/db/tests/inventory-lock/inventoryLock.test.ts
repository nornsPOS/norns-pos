/**
 * @norns/inventory-lock — integration tests.
 *
 * The race condition test is the centerpiece. Everything else is a
 * structural / lifecycle smoke. Per Basel's directive, no test sprawl.
 *
 * Setup: full migrations 0001-0006 applied. The test acts as the API role
 * via the same connection model the runtime uses.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import {
  ReservationOwnershipError,
  autoReleaseExpired,
  finalize,
  release,
  reserve,
} from '@norns/inventory-lock';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('@norns/inventory-lock', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;
  // Drizzle bound to the warehouse14_app connection — the runtime surface.
  let appDb: AppDb;

  /** Insert an AVAILABLE product as migrator, return its id. */
  async function makeAvailableProduct(): Promise<string> {
    const [row] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status,
              'MARGIN_25A', 'gold_jewelry'::item_type,
              100, 250, 'Race Test', now())
      RETURNING id
    `;
    return row.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    // ⚠️ Hier stand `6`. Der Test baute also eine Datenbank im Stand von
    // Wanderung 0006, waehrend der Code bei 0111 steht: hundert Wanderungen
    // Rueckstand. Deshalb kannte der Typ `reservation_channel` den Wert
    // `WEB_RESERVATION` nicht (0067), und ALLE 17 Tests dieser Datei fielen
    // seit langem um. Aufgefallen ist es nie, weil der Handgriff `test` in
    // packages/db genau dieses Verzeichnis ausschliesst.
    //
    // Ein Test gegen ein Schema, das es nirgends gibt, prueft nichts.
    await applyMigrations(migratorSql, 9999);
    await setAppPasswordForTest(migratorSql);

    appSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 20, // headroom for the race tests
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. The race — the entire reason this package exists
  // ────────────────────────────────────────────────────────────────────

  describe('reserve() race condition', () => {
    it('100 concurrent reservations on one product → exactly one wins', async () => {
      const productId = await makeAvailableProduct();

      const attempts = Array.from({ length: 100 }, () =>
        reserve(appDb, {
          productId,
          channel: 'STOREFRONT',
          sessionId: crypto.randomUUID(),
        }),
      );
      const results = await Promise.all(attempts);

      const winners = results.filter((r) => r !== null);
      const losers = results.filter((r) => r === null);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(99);

      // The DB row reflects the winner's session.
      const [row] = await migratorSql<
        {
          status: string;
          reserved_by_session_id: string;
          reserved_by_channel: string;
        }[]
      >`
        SELECT status, reserved_by_session_id, reserved_by_channel FROM products WHERE id = ${productId}
      `;
      expect(row.status).toBe('RESERVED');
      expect(row.reserved_by_channel).toBe('STOREFRONT');
      expect(row.reserved_by_session_id).toBe(winners[0]!.sessionId);
    });

    it('mixed-channel race (POS + STOREFRONT + EBAY all bid for the same item) → exactly one wins', async () => {
      const productId = await makeAvailableProduct();
      const userId = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`race-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
        RETURNING id
      `.then((rows) => rows[0]!.id);

      const channels = ['POS', 'STOREFRONT', 'EBAY', 'STOREFRONT', 'EBAY'] as const;
      const attempts = channels.map((channel) =>
        reserve(appDb, {
          productId,
          channel,
          sessionId: crypto.randomUUID(),
          userId: channel === 'POS' ? userId : null,
        }),
      );
      const results = await Promise.all(attempts);
      const winners = results.filter((r) => r !== null);
      expect(winners).toHaveLength(1);
    });

    it('reserving a DRAFT product fails (status filter is strict)', async () => {
      const [row] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name)
        VALUES (${`DRAFT-${crypto.randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, 100, 250, 'Draft Item')
        RETURNING id
      `;
      const result = await reserve(appDb, {
        productId: row.id,
        channel: 'POS',
        sessionId: crypto.randomUUID(),
      });
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. TTL discipline per channel (ADR-0016 §3)
  // ────────────────────────────────────────────────────────────────────

  describe('reserve() TTL per channel', () => {
    it('POS → expiresAt is null (held indefinitely)', async () => {
      const productId = await makeAvailableProduct();
      const userId = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`pos-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
        RETURNING id
      `.then((rows) => rows[0]!.id);
      const r = await reserve(appDb, {
        productId,
        channel: 'POS',
        sessionId: crypto.randomUUID(),
        userId,
      });
      expect(r).not.toBeNull();
      expect(r!.expiresAt).toBeNull();
    });

    it('STOREFRONT → expiresAt ≈ reservedAt + 15 minutes', async () => {
      const productId = await makeAvailableProduct();
      const r = await reserve(appDb, {
        productId,
        channel: 'STOREFRONT',
        sessionId: crypto.randomUUID(),
      });
      expect(r).not.toBeNull();
      expect(r!.expiresAt).toBeInstanceOf(Date);
      const delta = r!.expiresAt!.getTime() - r!.reservedAt.getTime();
      expect(delta).toBeGreaterThan(14 * 60 * 1000);
      expect(delta).toBeLessThan(16 * 60 * 1000);
    });

    it('EBAY → expiresAt ≈ reservedAt + 10 minutes', async () => {
      const productId = await makeAvailableProduct();
      const r = await reserve(appDb, {
        productId,
        channel: 'EBAY',
        sessionId: crypto.randomUUID(),
      });
      expect(r).not.toBeNull();
      expect(r!.expiresAt).toBeInstanceOf(Date);
      const delta = r!.expiresAt!.getTime() - r!.reservedAt.getTime();
      expect(delta).toBeGreaterThan(9 * 60 * 1000);
      expect(delta).toBeLessThan(11 * 60 * 1000);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Lifecycle: release + finalize
  // ────────────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('release() returns a reserved product to AVAILABLE', async () => {
      const productId = await makeAvailableProduct();
      const r = await reserve(appDb, {
        productId,
        channel: 'STOREFRONT',
        sessionId: crypto.randomUUID(),
      });
      await release(appDb, {
        productId,
        sessionId: r!.sessionId,
        userId: null,
        reason: 'storefront_checkout_abandoned',
      });
      const [row] = await migratorSql<
        {
          status: string;
          reserved_by_channel: string | null;
          reserved_at: Date | null;
        }[]
      >`
        SELECT status, reserved_by_channel, reserved_at FROM products WHERE id = ${productId}
      `;
      expect(row.status).toBe('AVAILABLE');
      expect(row.reserved_by_channel).toBeNull();
      expect(row.reserved_at).toBeNull();
    });

    it('release() with wrong session id throws ReservationOwnershipError', async () => {
      const productId = await makeAvailableProduct();
      await reserve(appDb, {
        productId,
        channel: 'STOREFRONT',
        sessionId: crypto.randomUUID(),
      });
      await expect(
        release(appDb, {
          productId,
          sessionId: crypto.randomUUID(), // different session
          userId: null,
          reason: 'admin_manual_release',
        }),
      ).rejects.toBeInstanceOf(ReservationOwnershipError);
    });

    it('finalize() moves RESERVED → SOLD with sold_at set', async () => {
      const productId = await makeAvailableProduct();
      const r = await reserve(appDb, {
        productId,
        channel: 'EBAY',
        sessionId: crypto.randomUUID(),
      });
      await finalize(appDb, { productId, sessionId: r!.sessionId, userId: null });
      const [row] = await migratorSql<{ status: string; sold_at: Date | null }[]>`
        SELECT status, sold_at FROM products WHERE id = ${productId}
      `;
      expect(row.status).toBe('SOLD');
      expect(row.sold_at).toBeInstanceOf(Date);
    });

    it('finalize() with wrong session id throws ReservationOwnershipError', async () => {
      const productId = await makeAvailableProduct();
      await reserve(appDb, {
        productId,
        channel: 'EBAY',
        sessionId: crypto.randomUUID(),
      });
      await expect(
        finalize(appDb, { productId, sessionId: crypto.randomUUID(), userId: null }),
      ).rejects.toBeInstanceOf(ReservationOwnershipError);
    });

    it('finalize() on a non-RESERVED product (AVAILABLE) throws', async () => {
      const productId = await makeAvailableProduct();
      await expect(
        finalize(appDb, { productId, sessionId: crypto.randomUUID(), userId: null }),
      ).rejects.toBeInstanceOf(ReservationOwnershipError);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. autoReleaseExpired
  // ────────────────────────────────────────────────────────────────────

  describe('autoReleaseExpired()', () => {
    it('releases STOREFRONT/EBAY rows whose expiry is in the past', async () => {
      // Insert an artificially-expired reservation via the migrator (so we
      // sidestep the CASE-based TTL inside reserve()).
      const productId = await makeAvailableProduct();
      await migratorSql`
        UPDATE products
           SET status                 = 'RESERVED',
               reserved_by_channel    = 'STOREFRONT'::reservation_channel,
               reserved_by_session_id = gen_random_uuid(),
               reserved_at            = now() - interval '20 minutes',
               reservation_expires_at = now() - interval '5 minutes'
         WHERE id = ${productId}
      `;

      const released = await autoReleaseExpired(appDb);
      expect(released).toContain(productId);

      const [row] = await migratorSql<{ status: string }[]>`
        SELECT status FROM products WHERE id = ${productId}
      `;
      expect(row.status).toBe('AVAILABLE');
    });

    it('does NOT release POS reservations (expires_at is NULL)', async () => {
      const productId = await makeAvailableProduct();
      const userId = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`pos2-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
        RETURNING id
      `.then((rows) => rows[0]!.id);
      await reserve(appDb, {
        productId,
        channel: 'POS',
        sessionId: crypto.randomUUID(),
        userId,
      });
      const released = await autoReleaseExpired(appDb);
      expect(released).not.toContain(productId);
    });

    /**
     * ⚠️ DIE TEUERSTE ZEILE DIESES MODULS.
     *
     * Bis zum 26.07.2026 gab der Aufräumer JEDE abgelaufene Reservierung frei
     * und wusste von Zahlungen nichts. Der Ablauf: Kunde bezahlt, Frist läuft
     * ab, Stück wird frei, Theke verkauft es an jemand anderen, und die
     * Bestätigung der Zahlung trifft auf `finalize`, das `RESERVED` verlangt
     * und für immer wirft. Geld genommen, Einzelstück weg, nicht heilbar.
     *
     * Diese Tabelle hält jeden Zahlungszustand einzeln fest, denn der Fehler
     * steckt nicht in der Idee, sondern in der Auswahl der Zustände. Der erste
     * Anlauf der Reparatur zählte auf, was offen IST, und hätte SUCCEEDED
     * freigegeben, also genau den gefährlichsten Fall.
     */
    const zahlfaelle: ReadonlyArray<[string | null, boolean, string]> = [
      ['CREATED', false, 'eröffnet, noch nicht entschieden'],
      ['PENDING', false, 'der Kunde zahlt gerade, bei SEPA über Tage'],
      ['SUCCEEDED', false, 'GEFÄHRLICHSTER FALL: Geld ist da, finalize kam nicht durch'],
      ['FAILED', true, 'negativ entschieden, das Stück MUSS zurück'],
      ['CANCELED', true, 'abgebrochen, das Stück MUSS zurück'],
      ['EXPIRED', true, 'verfallen, das Stück MUSS zurück'],
      [null, true, 'gar keine Zahlung, wie bisher'],
    ];

    for (const [zahlstand, sollFreigegeben, warum] of zahlfaelle) {
      it(`Zahlung ${zahlstand ?? 'KEINE'} → ${sollFreigegeben ? 'freigeben' : 'FESTHALTEN'} (${warum})`, async () => {
        const productId = await makeAvailableProduct();
        const sitzung = crypto.randomUUID();

        await migratorSql`
          UPDATE products
             SET status                 = 'RESERVED',
                 reserved_by_channel    = 'STOREFRONT'::reservation_channel,
                 reserved_by_session_id = ${sitzung},
                 reserved_at            = now() - interval '20 minutes',
                 reservation_expires_at = now() - interval '5 minutes'
           WHERE id = ${productId}`;

        if (zahlstand !== null) {
          // Der Schluessel gilt fuer die Sitzung, nicht fuer die Transaktion:
          // die Einfuegungen unten sind einzelne Anweisungen auf derselben
          // einen Verbindung (max:1), und ein transaktionslokaler Wert waere
          // nach der ersten wieder fort.
          await migratorSql`SELECT set_config('warehouse14.pii_key', 'probe-schluessel-32-zeichen-lang-xx', false)`;
          const kundeId = await migratorSql<{ id: string }[]>`
            INSERT INTO customers (full_name_encrypted, retention_until)
            VALUES (encrypt_pii('Zahler'), now() + interval '10 years') RETURNING id
          `.then((r) => r[0]!.id);
          const shopperId = await migratorSql<{ id: string }[]>`
            INSERT INTO shoppers (customer_id, email_encrypted, email_blind_index, is_guest)
            VALUES (${kundeId}, encrypt_pii(${`z-${sitzung}@x.test`}),
                    blind_index(${`z-${sitzung}@x.test`}), TRUE) RETURNING id
          `.then((r) => r[0]!.id);
          const cartId = await migratorSql<{ id: string }[]>`
            INSERT INTO carts (shopper_id, reservation_session_id)
            VALUES (${shopperId}, ${sitzung}) RETURNING id
          `.then((r) => r[0]!.id);
          await migratorSql`
            INSERT INTO payment_intents (cart_id, provider, provider_intent_id, status, amount_eur)
            VALUES (${cartId}, 'STRIPE'::payment_provider, ${`pi-${sitzung}`},
                    ${zahlstand}::payment_intent_status, '2500.00')`;
        }

        const released = await autoReleaseExpired(appDb);
        const [row] = await migratorSql<{ status: string }[]>`
          SELECT status FROM products WHERE id = ${productId}`;

        if (sollFreigegeben) {
          expect(released).toContain(productId);
          expect(row!.status).toBe('AVAILABLE');
        } else {
          expect(released).not.toContain(productId);
          expect(row!.status).toBe('RESERVED');
        }
      });
    }

    it('idempotent — running twice releases nothing the second time', async () => {
      // Re-run the sweep; nothing should be expired now.
      const released = await autoReleaseExpired(appDb);
      expect(released).toEqual([]);
    });
  });
});
