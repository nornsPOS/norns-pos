/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Migration 0063 — Owner taxonomy + Briefmarken attributes (E2E)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Boots the REAL Fastify app against a REAL Postgres (testcontainers,
 * pgvector:pg17) with EVERY production migration applied (incl. 0063),
 * connected as the REAL `warehouse14_app` role — grant gaps surface here, not
 * in prod (the 0055/0056/0057 lesson). Coverage:
 *
 *   ✓ seed visible after migration: 19 roots in the owner's order, Münzen ×16,
 *     Schmuck ×15, Barren ×10, Briefmarken ×5, Altdeutschland ×18 third-level
 *     states with MiNr ranges in descriptionDe (GET /api/categories carries
 *     DEPTH-3),
 *   ✓ re-applying 0063 is a NO-OP (idempotent by slug),
 *   ✓ depth cap: 3rd level creatable via POST /api/categories, 4th level → 400
 *     (route pre-check) and check_violation (DB trigger, authoritative),
 *   ✓ POST /api/products with Briefmarken-Altdeutschland-Baden primary +
 *     MiNr 12 + FALZ persists product row + is_primary join row,
 *   ✓ POS feed (GET /api/products) returns primaryCategory + stamp fields,
 *   ✓ PUT replaces the primary category atomically + updates/clears stamps,
 *   ✓ the stamp_erhaltung CHECK refuses junk at the DB level.
 *
 * GRABSTEIN 14.08.2026: die fuenf Kundenshop-Pruefungen (oeffentlicher Baum,
 * ?category-, ?erhaltung-, MiNr-Filter, Produktseite) entfielen mit der
 * Trennung von warehouse14 — `/api/storefront` existiert nicht mehr.
 *
 * NOTE: requires Docker (testcontainers) — same as every api-cloud integration
 * test. Run via `pnpm --filter @norns/api-cloud test:integration`.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { testUmgebung } from '../helfer/test-umgebung.js';
import { MIGRATIONS_DIR, applyAllMigrations, splitSqlStatements } from './_migrate.js';

/**
 * Ein Pflichtwert aus der Vorbereitung, mit Nachweis statt Ausrufezeichen.
 *
 * Unter `noUncheckedIndexedAccess` ist die erste Zeile einer Abfrage
 * `… | undefined`. Ein `!` waere die schnellere Zeile und die schlechtere:
 * fehlt der Wert wirklich, faellt der Test weiter unten mit einer Meldung um,
 * die nichts mit der Ursache zu tun hat.
 */
function muss<T>(wert: T | undefined | null, was: string): T {
  if (wert === undefined || wert === null) {
    throw new Error(
      `${was} fehlt in der Vorbereitung. Das ist ein Fehler DIESER Pruefung, ` +
        'keine Aussage ueber den Pruefling.',
    );
  }
  return wert;
}


const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    SUPERUSER
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

const ROOT_SLUGS_IN_ORDER = [
  'gold',
  'silber',
  'platin',
  'palladium',
  'muenzen',
  'briefmarken',
  'schmuck',
  'barren',
  'medaillen',
  'banknoten',
  'postkarten',
  'militaria',
  'antiquitaeten',
  'uhren',
  'orden-ehrenzeichen',
  'ansichtskarten',
  'konvolute',
  'neuheiten',
  'ankauf',
] as const;

type CategoryNode = {
  id: string;
  slug: string;
  nameDe: string;
  descriptionDe: string | null;
  children: CategoryNode[];
};

describe('0063 — owner taxonomy + Briefmarken attributes (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let ownerToken: string;
  let deviceFingerprint: string;

  // Captured across the sequential tests below.
  let badenId = '';
  let altdeutschlandId = '';
  let briefmarkenDeutschesReichId = '';
  let categoryCountAfterSeed = 0;
  let productId = '';
  let productSku = '';
  let productSlug = '';

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCopyContentToContainer([
        { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
      ])
      .start();

    migratorSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
    });
    await applyAllMigrations(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    appSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 5,
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });

    const env: Env = testUmgebung({
      NODE_ENV: 'test',
      PORT: 0,
      LOG_LEVEL: 'error',
      DATABASE_URL: 'unused-because-override',
      DB_POOL_MAX: 5,
      NORNS_PII_KEY: PII_KEY,
      AUTH_SECRET: 'taxonomy-test-auth-secret-0123456789abcdef',
      TRUSTED_ORIGINS: '',
      TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00',
      R2_ACCOUNT_ID: '',
      R2_BUCKET: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
      R2_PUBLIC_URL_BASE: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_API_VERSION: '2024-12-18.acacia',
    }) as Env;
    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });

    // GRABSTEIN 14.08.2026: hier stand der Schalter `betrieb.online_kanaele`
    // samt Begruendung und Saat — die fuenf Kundenshop-Pruefungen dieser Datei
    // (oeffentlicher Baum, Katalogfilter, Produktseite) entfielen mit der
    // Trennung von warehouse14, die Wege unter `/api/storefront` existieren
    // nicht mehr. Die EIGENTUEMER-Taxonomie unten ist der lebende Gegenstand.

    // Owner + paired device + step-up session (the day16 pattern).
    const [owner] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`o-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    const ownerUserId = owner?.id;
    if (!ownerUserId) throw new Error('owner seed failed');

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${ownerUserId})
      RETURNING id`;

    ownerToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${ownerUserId}, ${ownerToken}, now() + interval '8 hours', ${muss(dev?.id, 'Die Geraetezeile')}, now())`;
  }, 180_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  function headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      cookie: `warehouse14.session=${ownerToken}`,
      'x-dev-device-fingerprint': deviceFingerprint,
    };
  }

  function findNode(nodes: CategoryNode[], slug: string): CategoryNode | undefined {
    return nodes.find((n) => n.slug === slug);
  }

  // ════════════════════════════════════════════════════════════════════
  // 1. Seed visible after migration
  // ════════════════════════════════════════════════════════════════════

  it('seeds 19 roots in the owner order with Münzen ×16 / Schmuck ×15 / Barren ×10', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/categories', headers: headers() });
    expect(res.statusCode).toBe(200);
    const { roots } = res.json() as { roots: CategoryNode[] };

    expect(roots.map((r) => r.slug)).toEqual([...ROOT_SLUGS_IN_ORDER]);

    const muenzen = findNode(roots, 'muenzen');
    expect(muenzen?.children).toHaveLength(16);
    expect(muenzen?.children.map((c) => c.slug)).toContain('muenzen-medaillen');
    expect(muenzen?.children.map((c) => c.slug)).toContain('muenzen-konvolute');
    expect(findNode(muenzen?.children ?? [], 'weimarer-republik')?.nameDe).toBe(
      'Weimarer Republik',
    );

    const schmuck = findNode(roots, 'schmuck');
    expect(schmuck?.children).toHaveLength(15);
    expect(findNode(schmuck?.children ?? [], 'armbaender')?.nameDe).toBe('Armbänder');

    const barren = findNode(roots, 'barren');
    expect(barren?.children).toHaveLength(10);
    expect(findNode(barren?.children ?? [], 'argor-heraeus')?.nameDe).toBe('Argor Heraeus');

    const [{ n }] = await migratorSql<[{ n: number }]>`
      SELECT COUNT(*)::int AS n FROM categories`;
    categoryCountAfterSeed = n;
    // 19 roots + 16 + 15 + 10 + 5 + 18 = 83
    expect(n).toBe(83);
  });

  it('carries DEPTH-3: Briefmarken → Altdeutschland → 18 states with MiNr ranges', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/categories', headers: headers() });
    const { roots } = res.json() as { roots: CategoryNode[] };

    const briefmarken = findNode(roots, 'briefmarken');
    expect(briefmarken?.children).toHaveLength(5);
    expect(
      findNode(briefmarken?.children ?? [], 'briefmarken-deutsches-reich')?.descriptionDe,
    ).toBe('MiNr. 1–910 · Block 1–11');
    expect(findNode(briefmarken?.children ?? [], 'briefmarken-berlin')?.nameDe).toBe(
      'Berlin (West)',
    );
    expect(findNode(briefmarken?.children ?? [], 'briefmarken-bund')?.descriptionDe).toBe(
      'MiNr. 111–laufend · Block 2–laufend',
    );
    briefmarkenDeutschesReichId =
      findNode(briefmarken?.children ?? [], 'briefmarken-deutsches-reich')?.id ?? '';

    const altdeutschland = findNode(briefmarken?.children ?? [], 'altdeutschland');
    expect(altdeutschland).toBeDefined();
    altdeutschlandId = altdeutschland?.id ?? '';
    expect(altdeutschland?.children).toHaveLength(18);

    const baden = findNode(altdeutschland?.children ?? [], 'baden');
    expect(baden?.nameDe).toBe('Baden');
    expect(baden?.descriptionDe).toBe('MiNr. 1–25');
    badenId = baden?.id ?? '';
    expect(badenId).not.toBe('');

    expect(findNode(altdeutschland?.children ?? [], 'preussen')?.nameDe).toBe('Preußen');
    expect(findNode(altdeutschland?.children ?? [], 'bayern')?.descriptionDe).toBe('MiNr. 1–191');
    expect(
      findNode(altdeutschland?.children ?? [], 'norddeutscher-postbezirk')?.descriptionDe,
    ).toBe('MiNr. 1–26');
  });

  it('re-applying migration 0063 is a NO-OP (idempotent by slug)', async () => {
    const text = await readFile(join(MIGRATIONS_DIR, '0063_owner_taxonomy.sql'), 'utf8');
    for (const statement of splitSqlStatements(text)) {
      await migratorSql.unsafe(statement);
    }
    const [{ n }] = await migratorSql<[{ n: number }]>`
      SELECT COUNT(*)::int AS n FROM categories`;
    expect(n).toBe(categoryCountAfterSeed);
  });

  // ════════════════════════════════════════════════════════════════════
  // 2. Depth cap 3
  // ════════════════════════════════════════════════════════════════════

  it('a 3rd level is creatable via the API; a 4th level → 400 + DB check_violation', async () => {
    // 3rd level OK (sibling of the 18 states).
    const ok = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: headers(),
      payload: { slug: 'test-drittstufe', nameDe: 'Testland', parentId: altdeutschlandId },
    });
    expect(ok.statusCode).toBe(200);
    const created = ok.json() as { id: string };

    // 4th level refused by the route pre-check.
    const tooDeep = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: headers(),
      payload: { slug: 'test-vierte-ebene', nameDe: 'Zu tief', parentId: badenId },
    });
    expect(tooDeep.statusCode).toBe(400);

    // …and authoritatively by the DB trigger on a direct INSERT.
    await expect(
      migratorSql`
        INSERT INTO categories (slug, name_de, parent_id)
        VALUES ('test-vierte-ebene-db', 'Zu tief (DB)', ${badenId})`,
    ).rejects.toThrow(/capped at 3 levels/);

    // Clean up the probe so tree counts stay stable.
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${created.id}`,
      headers: headers(),
    });
    expect(del.statusCode).toBe(204);
  });

  // ════════════════════════════════════════════════════════════════════
  // 3. Stamp product end-to-end
  // ════════════════════════════════════════════════════════════════════

  it('POST /api/products: Baden primary + MiNr 12 + FALZ persists row + is_primary join', async () => {
    productSku = `STAMP-${randomUUID().slice(0, 8)}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: headers(),
      payload: {
        sku: productSku,
        itemType: 'other',
        hallmarkStamps: [],
        acquisitionCostEur: '10.00',
        listPriceEur: '49.00',
        taxTreatmentCode: 'MARGIN_25A',
        condition: 'USED_GOOD',
        isCommission: false,
        name: 'Briefmarke Baden MiNr. 12',
        descriptionDe: 'Altdeutschland Baden, 9 Kreuzer, Falz.',
        listedOnStorefront: false,
        listedOnEbay: false,
        stampErhaltung: 'FALZ',
        stampMinr: 12,
        primaryCategoryId: badenId,
      },
    });
    expect(res.statusCode).toBe(200);
    productId = (res.json() as { id: string }).id;

    const [row] = await migratorSql<
      [{ stamp_erhaltung: string | null; stamp_minr: number | null }]
    >`SELECT stamp_erhaltung, stamp_minr FROM products WHERE id = ${productId}`;
    expect(row?.stamp_erhaltung).toBe('FALZ');
    expect(row?.stamp_minr).toBe(12);

    const primaries = await migratorSql<Array<{ category_id: string; is_primary: boolean }>>`
      SELECT category_id, is_primary FROM product_categories WHERE product_id = ${productId}`;
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.category_id).toBe(badenId);
    expect(primaries[0]?.is_primary).toBe(true);

    // unknown primaryCategoryId → 400, no row created.
    const bad = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: headers(),
      payload: {
        sku: `STAMP-${randomUUID().slice(0, 8)}`,
        itemType: 'other',
        hallmarkStamps: [],
        acquisitionCostEur: '1.00',
        listPriceEur: '2.00',
        taxTreatmentCode: 'MARGIN_25A',
        condition: 'USED_GOOD',
        isCommission: false,
        name: 'Kaputt',
        listedOnStorefront: false,
        listedOnEbay: false,
        primaryCategoryId: randomUUID(),
      },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('POS feed (GET /api/products) returns primaryCategory + the stamp fields', async () => {
    // Publish: DRAFT → AVAILABLE + web flag (slug autogen 0061 fires here).
    const pub = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      headers: headers(),
      payload: { status: 'AVAILABLE', isPublishedToWeb: true },
    });
    expect(pub.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/products?status=AVAILABLE',
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const { items } = res.json() as {
      items: Array<{
        sku: string;
        primaryCategory: { slug: string; nameDe: string } | null;
        stampErhaltung: string | null;
        stampMinr: number | null;
        period: string | null;
        catalogReference: string | null;
      }>;
    };
    const item = items.find((i) => i.sku === productSku);
    expect(item).toBeDefined();
    expect(item?.primaryCategory?.slug).toBe('baden');
    expect(item?.primaryCategory?.nameDe).toBe('Baden');
    expect(item?.stampErhaltung).toBe('FALZ');
    expect(item?.stampMinr).toBe(12);
    // The collector facts are declared in the response schema (Fastify
    // strips undeclared fields — the TypeBox lesson).
    expect(item).toHaveProperty('period');
    expect(item).toHaveProperty('catalogReference');

    const [slugRow] = await migratorSql<[{ slug: string | null }]>`
      SELECT slug FROM products WHERE id = ${productId}`;
    productSlug = slugRow?.slug ?? '';
    expect(productSlug).not.toBe('');
  });

  // ════════════════════════════════════════════════════════════════════
  // 4. PUT — stamps + primary replacement
  // ════════════════════════════════════════════════════════════════════

  it('PUT replaces the primary category atomically (old membership kept, flag moved)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      headers: headers(),
      payload: { primaryCategoryId: briefmarkenDeutschesReichId },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { changedFields: string[] }).changedFields).toContain(
      'primaryCategoryId',
    );

    const rows = await migratorSql<Array<{ category_id: string; is_primary: boolean }>>`
      SELECT category_id, is_primary FROM product_categories
      WHERE product_id = ${productId} ORDER BY is_primary DESC`;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.is_primary)).toHaveLength(1);
    expect(rows.find((r) => r.is_primary)?.category_id).toBe(briefmarkenDeutschesReichId);
    expect(rows.find((r) => !r.is_primary)?.category_id).toBe(badenId);

    // GET /api/products/:id detail shows the new primary first.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/products/${productId}`,
      headers: headers(),
    });
    expect(detail.statusCode).toBe(200);
    const det = detail.json() as {
      categories: Array<{ slug: string; isPrimary: boolean }>;
      stampErhaltung: string | null;
      stampMinr: number | null;
    };
    expect(det.categories[0]?.slug).toBe('briefmarken-deutsches-reich');
    expect(det.categories[0]?.isPrimary).toBe(true);
    expect(det.stampErhaltung).toBe('FALZ');
    expect(det.stampMinr).toBe(12);
  });

  it('PUT updates and clears the stamp fields', async () => {
    const upd = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      headers: headers(),
      payload: { stampErhaltung: 'POSTFRISCH', stampMinr: 27 },
    });
    expect(upd.statusCode).toBe(200);
    expect((upd.json() as { changedFields: string[] }).changedFields).toEqual(
      expect.arrayContaining(['stampErhaltung', 'stampMinr']),
    );

    let [row] = await migratorSql<[{ stamp_erhaltung: string | null; stamp_minr: number | null }]>`
      SELECT stamp_erhaltung, stamp_minr FROM products WHERE id = ${productId}`;
    expect(row?.stamp_erhaltung).toBe('POSTFRISCH');
    expect(row?.stamp_minr).toBe(27);

    const clear = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      headers: headers(),
      payload: { stampErhaltung: null, stampMinr: null },
    });
    expect(clear.statusCode).toBe(200);

    [row] = await migratorSql<[{ stamp_erhaltung: string | null; stamp_minr: number | null }]>`
      SELECT stamp_erhaltung, stamp_minr FROM products WHERE id = ${productId}`;
    expect(row?.stamp_erhaltung).toBeNull();
    expect(row?.stamp_minr).toBeNull();
  });

  it('the DB CHECK refuses an invalid Erhaltung', async () => {
    await expect(
      migratorSql`
        UPDATE products SET stamp_erhaltung = 'KAPUTT' WHERE id = ${productId}`,
    ).rejects.toThrow(/products_stamp_erhaltung_check/);
  });
});
