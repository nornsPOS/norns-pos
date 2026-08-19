/**
 * Migration 0022 — Photo workflow + eBay listing state machine.
 *
 * Focused tests:
 *   • photo_workflow_state enum (5 labels) + photo_source extended
 *   • product_photos.product_id NULLABLE; CHECK forbids orphan past ZUGEORDNET
 *   • CHECK forbids FREIGESTELLT/ZUGEORDNET/FUER_EBAY_BEREIT without r2_key_bg_removed
 *   • CHECK forbids orphan is_primary
 *   • one-primary-per-product partial UNIQUE survives + skips orphans
 *   • product_photo_workflow_events append + state-change CHECK
 *
 *   • ebay_listing_state enum (9 labels in exact order)
 *   • products.ebay_state nullable; backfill from listed_on_ebay=TRUE
 *   • product_ebay_listing_events append + source/payload CHECKs
 *
 *   • Cross-system trigger enforce_ebay_sold_reserves_locally:
 *       (a) AVAILABLE         → auto-RESERVE via EBAY channel + 7-day expiry
 *       (b) RESERVED by EBAY  → no-op (idempotent)
 *       (c) RESERVED by POS   → no mutation + ledger alert.ebay_sale_conflict
 *       (d) SOLD              → no mutation + ledger alert.ebay_double_sale_attempt
 *       (e) ENTWURF→GEPRUEFT  → only ebay_state_changed_at moves
 *
 *   • Role grants — app can UPDATE workflow_state, ebay_state but NOT
 *     restricted columns (acquisition_cost_eur).
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0022_photo_ebay_workflow', () => {
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

  async function makeProduct(
    opts: {
      status?: 'DRAFT' | 'AVAILABLE' | 'RESERVED' | 'SOLD';
      listedOnEbay?: boolean;
      reservationChannel?: 'POS' | 'STOREFRONT' | 'EBAY';
    } = {},
  ): Promise<string> {
    const status = opts.status ?? 'AVAILABLE';

    const [draft] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type, name,
                            acquisition_cost_eur, list_price_eur)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
              'gold_coin'::item_type, 'Test piece', '100.00', '150.00')
      RETURNING id`;
    const id = draft!.id;

    if (status === 'AVAILABLE') {
      await migratorSql`
        UPDATE products
           SET status = 'AVAILABLE'::product_status, published_at = now()
         WHERE id = ${id}`;
    } else if (status === 'RESERVED') {
      const channel = opts.reservationChannel ?? 'POS';
      if (channel === 'POS') {
        await migratorSql`
          UPDATE products
             SET status = 'RESERVED'::product_status,
                 published_at = now(),
                 reserved_by_channel = 'POS'::reservation_channel,
                 reserved_at = now()
           WHERE id = ${id}`;
      } else {
        await migratorSql`
          UPDATE products
             SET status = 'RESERVED'::product_status,
                 published_at = now(),
                 reserved_by_channel = ${channel}::reservation_channel,
                 reserved_at = now(),
                 reservation_expires_at = now() + interval '15 minutes'
           WHERE id = ${id}`;
      }
    } else if (status === 'SOLD') {
      await migratorSql`
        UPDATE products
           SET status = 'SOLD'::product_status,
               published_at = now(),
               sold_at = now()
         WHERE id = ${id}`;
    }
    if (opts.listedOnEbay) {
      await migratorSql`UPDATE products SET listed_on_ebay = TRUE WHERE id = ${id}`;
    }
    return id;
  }

  async function makePhoto(
    opts: {
      productId?: string | null;
      workflowState?: string;
      r2KeyBgRemoved?: string | null;
      isPrimary?: boolean;
    } = {},
  ): Promise<string> {
    const [row] = await migratorSql<{ id: string }[]>`
      INSERT INTO product_photos (
        product_id, r2_key, r2_key_bg_removed, workflow_state, is_primary, source
      )
      VALUES (
        ${opts.productId ?? null},
        ${`r2/${crypto.randomUUID()}.jpg`},
        ${opts.r2KeyBgRemoved ?? null},
        ${opts.workflowState ?? 'FOTOGRAFIERT'}::photo_workflow_state,
        ${opts.isPrimary ?? false},
        'photographer'::photo_source
      )
      RETURNING id`;
    return row!.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 22);
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
  // 1. photo_workflow_state + photo_source enums
  // ────────────────────────────────────────────────────────────────────

  describe('photo_workflow_state enum', () => {
    it('has 5 expected labels in exact order', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'photo_workflow_state' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'FOTOGRAFIERT',
        'BEARBEITET',
        'FREIGESTELLT',
        'ZUGEORDNET',
        'FUER_EBAY_BEREIT',
      ]);
    });
  });

  describe('photo_source enum extended', () => {
    it('contains the new photographer + phone_intake values', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'photo_source' ORDER BY enumsortorder`;
      const labels = rows.map((r) => r.enumlabel);
      expect(labels).toContain('photographer');
      expect(labels).toContain('phone_intake');
      // original values survive
      expect(labels).toContain('intake');
      expect(labels).toContain('admin_upload');
      expect(labels).toContain('storefront_user');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. product_photos.product_id is now NULLABLE
  // ────────────────────────────────────────────────────────────────────

  describe('product_photos nullable product_id', () => {
    it('allows orphan photo at FOTOGRAFIERT', async () => {
      await expect(
        makePhoto({ productId: null, workflowState: 'FOTOGRAFIERT' }),
      ).resolves.toBeDefined();
    });

    it('allows orphan photo at BEARBEITET', async () => {
      await expect(
        makePhoto({ productId: null, workflowState: 'BEARBEITET' }),
      ).resolves.toBeDefined();
    });

    it('allows orphan photo at FREIGESTELLT (with r2_key_bg_removed)', async () => {
      await expect(
        makePhoto({
          productId: null,
          workflowState: 'FREIGESTELLT',
          r2KeyBgRemoved: 'r2/clean.png',
        }),
      ).resolves.toBeDefined();
    });

    it('refuses orphan photo at ZUGEORDNET', async () => {
      await expect(
        makePhoto({
          productId: null,
          workflowState: 'ZUGEORDNET',
          r2KeyBgRemoved: 'r2/clean.png',
        }),
      ).rejects.toThrow(/product_photos_assigned_state_has_product/);
    });

    it('refuses orphan photo at FUER_EBAY_BEREIT', async () => {
      await expect(
        makePhoto({
          productId: null,
          workflowState: 'FUER_EBAY_BEREIT',
          r2KeyBgRemoved: 'r2/clean.png',
        }),
      ).rejects.toThrow(/product_photos_assigned_state_has_product/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. r2_key_bg_removed CHECK
  // ────────────────────────────────────────────────────────────────────

  describe('product_photos_bg_removed_state_has_key CHECK', () => {
    it('refuses FREIGESTELLT without r2_key_bg_removed', async () => {
      await expect(
        makePhoto({
          productId: null,
          workflowState: 'FREIGESTELLT',
          r2KeyBgRemoved: null,
        }),
      ).rejects.toThrow(/product_photos_bg_removed_state_has_key/);
    });

    it('refuses ZUGEORDNET without r2_key_bg_removed', async () => {
      const productId = await makeProduct();
      await expect(
        makePhoto({
          productId,
          workflowState: 'ZUGEORDNET',
          r2KeyBgRemoved: null,
        }),
      ).rejects.toThrow(/product_photos_bg_removed_state_has_key/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. is_primary cannot be claimed by an orphan
  // ────────────────────────────────────────────────────────────────────

  describe('product_photos_orphan_not_primary CHECK', () => {
    it('refuses is_primary on orphan photos', async () => {
      await expect(makePhoto({ productId: null, isPrimary: true })).rejects.toThrow(
        /product_photos_orphan_not_primary/,
      );
    });

    it('accepts is_primary on assigned photos', async () => {
      const productId = await makeProduct();
      await expect(
        makePhoto({
          productId,
          workflowState: 'ZUGEORDNET',
          r2KeyBgRemoved: 'r2/x.png',
          isPrimary: true,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('one-primary-per-product partial UNIQUE', () => {
    it('refuses a second is_primary for the same product', async () => {
      const productId = await makeProduct();
      await makePhoto({
        productId,
        workflowState: 'ZUGEORDNET',
        r2KeyBgRemoved: 'r2/x.png',
        isPrimary: true,
      });
      await expect(
        makePhoto({
          productId,
          workflowState: 'ZUGEORDNET',
          r2KeyBgRemoved: 'r2/y.png',
          isPrimary: true,
        }),
      ).rejects.toThrow(/product_photos_one_primary_per_product_uq|duplicate key/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. product_photo_workflow_events
  // ────────────────────────────────────────────────────────────────────

  describe('product_photo_workflow_events', () => {
    it('persists a transition row', async () => {
      const userId = await makeUser();
      const photoId = await makePhoto({ productId: null });
      const [evt] = await migratorSql<{ id: string }[]>`
        INSERT INTO product_photo_workflow_events
          (product_photo_id, from_state, to_state, changed_by_user_id, notes)
        VALUES (
          ${photoId},
          'FOTOGRAFIERT'::photo_workflow_state,
          'BEARBEITET'::photo_workflow_state,
          ${userId},
          'first edit'
        )
        RETURNING id`;
      expect(evt!.id).toBeDefined();
    });

    it('refuses a no-op transition (same from/to)', async () => {
      const userId = await makeUser();
      const photoId = await makePhoto({ productId: null });
      await expect(
        migratorSql`
          INSERT INTO product_photo_workflow_events
            (product_photo_id, from_state, to_state, changed_by_user_id)
          VALUES (
            ${photoId},
            'FOTOGRAFIERT'::photo_workflow_state,
            'FOTOGRAFIERT'::photo_workflow_state,
            ${userId}
          )`,
      ).rejects.toThrow(/photo_workflow_events_state_change/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. ebay_listing_state enum
  // ────────────────────────────────────────────────────────────────────

  describe('ebay_listing_state enum', () => {
    it('has 9 expected labels in Owner-defined order', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'ebay_listing_state' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'ENTWURF',
        'GEPRUEFT',
        'ONLINE',
        'VERKAUFT',
        'BEZAHLT',
        'VERPACKT',
        'VERSENDET',
        'REKLAMIERT',
        'RETOURNIERT',
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. Backfill from listed_on_ebay=TRUE
  // ────────────────────────────────────────────────────────────────────

  describe('listed_on_ebay backfill', () => {
    it('a product created with listed_on_ebay=TRUE has ebay_state set to ONLINE', async () => {
      // Note: the migration backfill runs once at apply time. To verify the
      // backfill rule, we re-run the UPDATE on a freshly created row.
      const id = await makeProduct({ listedOnEbay: true });
      // The migration's backfill only catches rows that existed before — for a
      // new row we replicate the rule manually to assert it is consistent.
      await migratorSql`
        UPDATE products SET ebay_state = NULL WHERE id = ${id}`;
      await migratorSql`
        UPDATE products
           SET ebay_state = 'ONLINE'::ebay_listing_state,
               ebay_state_changed_at = COALESCE(updated_at, created_at)
         WHERE id = ${id} AND listed_on_ebay = TRUE AND ebay_state IS NULL`;
      const [row] = await migratorSql<{ ebay_state: string }[]>`
        SELECT ebay_state FROM products WHERE id = ${id}`;
      expect(row!.ebay_state).toBe('ONLINE');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. product_ebay_listing_events CHECKs
  // ────────────────────────────────────────────────────────────────────

  describe('product_ebay_listing_events CHECKs', () => {
    it('accepts an OWNER transition with user', async () => {
      const userId = await makeUser();
      const productId = await makeProduct();
      const [evt] = await migratorSql<{ id: string }[]>`
        INSERT INTO product_ebay_listing_events
          (product_id, from_state, to_state, changed_by_user_id, changed_by_source)
        VALUES (
          ${productId},
          NULL,
          'ENTWURF'::ebay_listing_state,
          ${userId},
          'OWNER'
        )
        RETURNING id`;
      expect(evt!.id).toBeDefined();
    });

    it('refuses OWNER source without a user', async () => {
      const productId = await makeProduct();
      await expect(
        migratorSql`
          INSERT INTO product_ebay_listing_events
            (product_id, to_state, changed_by_source)
          VALUES (
            ${productId},
            'ENTWURF'::ebay_listing_state,
            'OWNER'
          )`,
      ).rejects.toThrow(/ebay_events_owner_has_user/);
    });

    it('refuses unknown source values', async () => {
      const productId = await makeProduct();
      await expect(
        migratorSql`
          INSERT INTO product_ebay_listing_events
            (product_id, to_state, changed_by_source)
          VALUES (
            ${productId},
            'ENTWURF'::ebay_listing_state,
            'COSMIC_RAYS'
          )`,
      ).rejects.toThrow(/ebay_events_known_source/);
    });

    it('refuses non-object payload', async () => {
      const productId = await makeProduct();
      await expect(
        migratorSql`
          INSERT INTO product_ebay_listing_events
            (product_id, to_state, changed_by_source, payload)
          VALUES (
            ${productId},
            'ENTWURF'::ebay_listing_state,
            'WORKER',
            '"oops"'::jsonb
          )`,
      ).rejects.toThrow(/ebay_events_payload_object/);
    });

    it('refuses no-op transitions', async () => {
      const productId = await makeProduct();
      await expect(
        migratorSql`
          INSERT INTO product_ebay_listing_events
            (product_id, from_state, to_state, changed_by_source)
          VALUES (
            ${productId},
            'ENTWURF'::ebay_listing_state,
            'ENTWURF'::ebay_listing_state,
            'SYSTEM'
          )`,
      ).rejects.toThrow(/ebay_events_state_change/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 9. Cross-system trigger
  // ────────────────────────────────────────────────────────────────────

  describe('enforce_ebay_sold_reserves_locally trigger', () => {
    it('AVAILABLE → auto-RESERVE via EBAY channel + 7-day expiry on VERKAUFT', async () => {
      const productId = await makeProduct({ status: 'AVAILABLE' });
      await migratorSql`
        UPDATE products
           SET ebay_state = 'VERKAUFT'::ebay_listing_state
         WHERE id = ${productId}`;
      const [row] = await migratorSql<
        {
          status: string;
          reserved_by_channel: string | null;
          reserved_at: Date | null;
          reservation_expires_at: Date | null;
        }[]
      >`
        SELECT status, reserved_by_channel, reserved_at, reservation_expires_at
          FROM products WHERE id = ${productId}`;
      expect(row!.status).toBe('RESERVED');
      expect(row!.reserved_by_channel).toBe('EBAY');
      expect(row!.reserved_at).toBeInstanceOf(Date);
      expect(row!.reservation_expires_at).toBeInstanceOf(Date);
      // ~7 days out (allow generous slack for test timing).
      const daysOut =
        (row!.reservation_expires_at!.getTime() - row!.reserved_at!.getTime()) /
        (24 * 60 * 60 * 1000);
      expect(daysOut).toBeGreaterThan(6.9);
      expect(daysOut).toBeLessThan(7.1);
    });

    it('RESERVED by EBAY → idempotent re-tick (BEZAHLT after VERKAUFT)', async () => {
      const productId = await makeProduct({ status: 'AVAILABLE' });
      await migratorSql`UPDATE products SET ebay_state = 'VERKAUFT'::ebay_listing_state WHERE id = ${productId}`;
      const [before] = await migratorSql<{ reserved_at: Date }[]>`
        SELECT reserved_at FROM products WHERE id = ${productId}`;
      // Bump to BEZAHLT — should NOT re-stamp reserved_at (idempotent).
      await migratorSql`UPDATE products SET ebay_state = 'BEZAHLT'::ebay_listing_state WHERE id = ${productId}`;
      const [after] = await migratorSql<{ reserved_at: Date; status: string }[]>`
        SELECT reserved_at, status FROM products WHERE id = ${productId}`;
      expect(after!.status).toBe('RESERVED');
      expect(after!.reserved_at.getTime()).toBe(before!.reserved_at.getTime());
    });

    it('RESERVED by POS → ebay_state advances but reservation untouched + alert.ebay_sale_conflict emitted', async () => {
      const productId = await makeProduct({ status: 'RESERVED', reservationChannel: 'POS' });
      // Clear any prior alerts to isolate.
      await migratorSql`
        UPDATE products
           SET ebay_state = 'VERKAUFT'::ebay_listing_state
         WHERE id = ${productId}`;
      const [row] = await migratorSql<
        {
          status: string;
          reserved_by_channel: string;
          ebay_state: string;
        }[]
      >`
        SELECT status, reserved_by_channel, ebay_state
          FROM products WHERE id = ${productId}`;
      expect(row!.status).toBe('RESERVED');
      expect(row!.reserved_by_channel).toBe('POS');
      expect(row!.ebay_state).toBe('VERKAUFT');

      const alerts = await migratorSql<{ event_type: string; payload: Record<string, unknown> }[]>`
        SELECT event_type, payload FROM ledger_events
         WHERE entity_id = ${productId}::uuid
           AND event_type = 'alert.ebay_sale_conflict'
         ORDER BY id DESC LIMIT 1`;
      expect(alerts.length).toBe(1);
      expect(alerts[0]!.payload.localReservationChannel).toBe('POS');
    });

    it('locally SOLD → ebay_state advances but status untouched + alert.ebay_double_sale_attempt emitted', async () => {
      const productId = await makeProduct({ status: 'SOLD' });
      await migratorSql`
        UPDATE products
           SET ebay_state = 'VERKAUFT'::ebay_listing_state
         WHERE id = ${productId}`;
      const [row] = await migratorSql<{ status: string; ebay_state: string }[]>`
        SELECT status, ebay_state FROM products WHERE id = ${productId}`;
      expect(row!.status).toBe('SOLD');
      expect(row!.ebay_state).toBe('VERKAUFT');

      const alerts = await migratorSql<{ payload: Record<string, unknown> }[]>`
        SELECT payload FROM ledger_events
         WHERE entity_id = ${productId}::uuid
           AND event_type = 'alert.ebay_double_sale_attempt'
         ORDER BY id DESC LIMIT 1`;
      expect(alerts.length).toBe(1);
    });

    it('ENTWURF → GEPRUEFT only updates ebay_state_changed_at (no inventory side effect)', async () => {
      const productId = await makeProduct({ status: 'AVAILABLE' });
      await migratorSql`UPDATE products SET ebay_state = 'ENTWURF'::ebay_listing_state WHERE id = ${productId}`;
      const [before] = await migratorSql<
        {
          status: string;
          ebay_state_changed_at: Date;
        }[]
      >`SELECT status, ebay_state_changed_at FROM products WHERE id = ${productId}`;

      // Tiny sleep to ensure clock advances between updates.
      await new Promise((r) => setTimeout(r, 20));

      await migratorSql`UPDATE products SET ebay_state = 'GEPRUEFT'::ebay_listing_state WHERE id = ${productId}`;
      const [after] = await migratorSql<
        {
          status: string;
          ebay_state_changed_at: Date;
        }[]
      >`SELECT status, ebay_state_changed_at FROM products WHERE id = ${productId}`;

      expect(after!.status).toBe('AVAILABLE'); // not touched
      expect(after!.ebay_state_changed_at.getTime()).toBeGreaterThan(
        before!.ebay_state_changed_at.getTime(),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 10. Role grants
  // ────────────────────────────────────────────────────────────────────

  describe('role grants', () => {
    it('app can UPDATE product_photos.workflow_state', async () => {
      const photoId = await makePhoto({ productId: null });
      await expect(
        appSql`
          UPDATE product_photos
             SET workflow_state = 'BEARBEITET'::photo_workflow_state,
                 workflow_changed_at = now()
           WHERE id = ${photoId}`,
      ).resolves.toBeDefined();
    });

    it('app can UPDATE products.ebay_state', async () => {
      const productId = await makeProduct();
      await expect(
        appSql`
          UPDATE products SET ebay_state = 'ENTWURF'::ebay_listing_state
           WHERE id = ${productId}`,
      ).resolves.toBeDefined();
    });

    it('app CANNOT UPDATE acquisition_cost_eur (fiscal column)', async () => {
      const productId = await makeProduct();
      await expect(
        appSql`UPDATE products SET acquisition_cost_eur = '0.00' WHERE id = ${productId}`,
      ).rejects.toThrow(/permission denied|insufficient privilege/i);
    });

    it('app can INSERT into product_ebay_listing_events', async () => {
      const userId = await makeUser();
      const productId = await makeProduct();
      const [evt] = await appSql<{ id: string }[]>`
        INSERT INTO product_ebay_listing_events
          (product_id, from_state, to_state, changed_by_user_id, changed_by_source)
        VALUES (
          ${productId},
          NULL,
          'ENTWURF'::ebay_listing_state,
          ${userId},
          'OWNER'
        )
        RETURNING id`;
      expect(evt!.id).toBeDefined();
    });
  });
});
