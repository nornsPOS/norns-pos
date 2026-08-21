/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Fiscal-export E2E — GET /api/closings/:id/export/{datev,dsfinvk}
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The systematic regression suite for the German tax-audit export surface. It
 * is the test that would have caught the recent LIVE-ONLY bugs:
 *   • the drizzle array-spread 42846/22P02 on the DSFinV-K item/payment/tse
 *     reads + the DATEV per-line read (every non-empty closing 500'd);
 *   • a §25a / §25c portion of a MIXED receipt collapsing onto the 19 % bucket
 *     (8400) instead of its own SKR03 Gegenkonto.
 *
 * It boots the REAL Fastify app against a REAL Postgres (testcontainers,
 * pgvector:pg17) with EVERY production migration applied via the shared
 * fidelity applier, seeds a FINALIZED daily_closing for one Berlin business day
 * whose transactions span ALL FOUR tax treatments + a MIXED-treatment receipt +
 * a storno, then drives the two export routes through `app.inject()`.
 *
 * Coverage matrix:
 *   DATEV
 *     ✓ auth gating: no session → 401; CASHIER → 403; ADMIN no step-up → 403
 *     ✓ ADMIN + step-up → 200 + the fixed EXTF Buchungsstapel header (line 1)
 *     ✓ per-treatment Gegenkonto + BU-Schlüssel:
 *         STANDARD_19→8400/BU3 · REDUCED_7→8300/BU2 · MARGIN_25A→8200 · §25c→8165
 *     ✓ ANKAUF → Wareneingang 3200 an Kasse 1000 (no output VAT key)
 *     ✓ MIXED receipt splits into per-treatment lines that RECONCILE to the
 *       receipt total in integer cents (8400 portion + 8165 portion = total)
 *     ✓ storno line carries the negated amount (German comma decimal)
 *   DSFinV-K
 *     ✓ auth gating mirrors DATEV
 *     ✓ 200 → a real ZIP that unzips to the 9 DFKA files (8 CSV + index.xml)
 *       with the correct DSFinV-K headers
 *     ✓ USt-Schlüssel by treatment (1/2/5/7) in bon_pos / bon_pos_ust
 *     ✓ VAT-by-treatment balances: per-line netto+ust = brutto, integer cents
 *     ✓ TSE fields present for a signed receipt (counter, signature, TSS id)
 *     ✓ ?encoding=base64 returns the SAME bytes, base64-encoded
 *     ✓ empty day (a finalized closing with zero transactions) → 200, no 500
 *       (the array-spread bug's exact blast radius — proven gone)
 *
 * Seeding goes straight through the migrator role (not the finalize route): we
 * need exact, hand-computed integer-cent figures spanning every treatment, and
 * the route paths under test are the EXPORTS, not finalize. The DB's own CHECK
 * constraints (subtotal+vat=total, storno mirror, KYC gate) still validate every
 * seeded row, so the fixtures are fiscally well-formed.
 *
 * TEST ONLY — never edits production source; the DB lives in a throwaway
 * container.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DATEV_SPALTEN } from '../../src/lib/datev-format.js';
import { nurFehler, pruefeBuchungsstapel } from '../../src/lib/datev-pruefer.js';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { applyAllMigrations } from './_migrate.js';

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

// ── Minimal ZIP reader (central-directory walk; STORE + DEFLATE) ─────────────
//
// The producer (dsfinvk-export.ts zipDsfinvkBundle) writes a deterministic ZIP
// with one local header per file + a central directory + EOCD. We read it back
// here to assert the bundle truly unzips (not just "looks like a zip"). Only the
// two methods the producer emits are supported: 0 = STORE, 8 = raw DEFLATE.

interface UnzippedFile {
  name: string;
  content: string;
}

/**
 * Die AMTLICHE Dateiliste und die AMTLICHEN Spalten, aus der Norm gelesen.
 *
 * ⚠️ Nicht aus diesem Test. Eine hier abgeschriebene Liste ist eine zweite
 * Wahrheit, die still von der ersten abdriftet — und die erste ist die, die
 * das Pruefwerkzeug des Finanzamts liest. Deshalb fragt der Test die
 * mitgelieferte `index.xml` selbst.
 */
const NORM_XML = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/fiskal/dsfinvk-2.4/index.xml'),
  'utf8',
);

/**
 * Eine Zahl aus einer DSFinV-K-Datei in ganze Cent.
 *
 * ⚠️ Das Komma ist richtig, nicht kaputt. Die mitgelieferte `index.xml`
 * erklaert es selbst: `<DecimalSymbol>,</DecimalSymbol>`. Der erste Entwurf
 * dieses Tests las mit `cents()` (Punkt) und hielt „138,00000" fuer einen
 * Fehler des Erzeugers. Er war ein Fehler des Tests.
 */
function normCents(s: string): bigint {
  return cents(s.replace(/\./g, '').replace(',', '.'));
}

function amtlicheDateien(): string[] {
  return [...NORM_XML.matchAll(/<URL>([a-z0-9_]+\.csv)<\/URL>/g)].map((m) => m[1]!).sort();
}

function amtlicheSpalten(datei: string): string[] {
  const i = NORM_XML.indexOf(`<URL>${datei}</URL>`);
  if (i < 0) return [];
  const bis = NORM_XML.indexOf('</Table>', i);
  const abschnitt = NORM_XML.slice(i, bis < 0 ? undefined : bis);
  return [...abschnitt.matchAll(/<Name>([A-Z0-9_]+)<\/Name>/g)].map((m) => m[1]!);
}

function readZip(buf: Buffer): UnzippedFile[] {
  // Find EOCD (end of central directory) — scan from the end for the signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('readZip: no EOCD record found — not a ZIP');

  const total = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16); // central-dir offset

  const files: UnzippedFile[] = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) {
      throw new Error('readZip: bad central-directory header signature');
    }
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);

    // Local header: 30 fixed bytes + name + extra, then the data.
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    const raw = method === 8 ? inflateRawSync(comp) : Buffer.from(comp);
    files.push({ name, content: raw.toString('utf8') });

    cd += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Parse a semicolon-delimited CSV body (DSFinV-K convention) into rows. */
function parseCsv(body: string): string[][] {
  return body
    .split(/\r\n|\n/)
    .filter((l) => l.length > 0)
    .map((line) => line.split(';'));
}

/** "123.45" → 12345n cents (test-side integer check; mirrors the route). */
function cents(eur: string): bigint {
  const v = eur.trim();
  const sign = v.startsWith('-') ? -1n : 1n;
  const abs = v.startsWith('-') ? v.slice(1) : v;
  const [whole = '0', frac = ''] = abs.split('.');
  const frac2 = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(frac2 || '0'));
}

describe('GET /api/closings/:id/export/{datev,dsfinvk} — fiscal-export E2E', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  // Actors / device / session tokens (fresh per test).
  let adminUserId: string;
  let cashierUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let adminStepUpToken: string; // ADMIN, fresh step-up
  let adminNoStepUpToken: string; // ADMIN, no step-up
  let cashierToken: string; // CASHIER, fresh step-up

  // The seeded closing for the populated business day.
  let closingId: string;
  let emptyClosingId: string;
  const businessDay = '2026-05-04'; // a fixed Berlin business day for the suite
  const emptyBusinessDay = '2026-05-05';

  // Receipt locators we assert on (captured at seed time).
  let rcpStandard: string;
  let rcpReduced: string;
  let rcpMargin: string;
  let rcpGold: string;
  let rcpMixed: string;
  let rcpStorno: string;

  /**
   * Die fünf Angaben des Steuerberaters.
   *
   * Seit dem 26.07.2026 verweigert der DATEV-Weg ohne sie den Export, und das
   * ist Absicht: eine Kopfzeile mit leeren Ordnungsbegriffen sieht aus wie ein
   * Export und ist keiner. Der Test muss sie also setzen, so wie es der
   * Inhaber einmal in den Einstellungen tut.
   */
  async function saeeDatevEinstellungen(): Promise<void> {
    await appDb.execute(sql`
      INSERT INTO system_settings (key, value, description) VALUES
        ('datev.beraternummer',          '29098'::jsonb,       'Testwert'),
        ('datev.mandantennummer',        '55003'::jsonb,       'Testwert'),
        ('datev.wirtschaftsjahr_beginn', '"2026-01-01"'::jsonb,'Testwert'),
        ('datev.sachkontenlaenge',       '4'::jsonb,           'Testwert'),
        ('datev.festschreibung',         'false'::jsonb,       'Testwert'),
        ('datev.sachkontenrahmen',       '"03"'::jsonb,        'Testwert'),
        -- Die drei Angaben, die nur eine Kanzlei beantworten kann. Ohne sie
        -- verweigert der Erzeuger das Paket mit 409, sobald der Tag einen
        -- Ankauf von Privat oder eine Differenzbesteuerung enthaelt, und
        -- genau das tut der Tag in dieser Buehne. Die Werte hier sind
        -- Testwerte und stehen ausdruecklich fuer KEINE Rechtsauffassung.
        ('dsfinvk.gv_typ.ankauf',                   '"Auszahlung"'::jsonb, 'Testwert'),
        -- ⚠️ 1001 und 1002, nicht 5 und 6. Die Norm haelt die Nummern unter
        -- 1000 fuer sich zurueck; individuelle Sachverhalte beginnen bei 1000.
        -- Eine 5 hier waere ein Testwert, der genau den Fehler vormacht, den
        -- der Erzeuger verhindern soll.
        ('dsfinvk.ust_schluessel.margin_25a',         '"1001"'::jsonb,     'Testwert'),
        ('dsfinvk.ust_schluessel.reverse_charge_13b', '"1002"'::jsonb,     'Testwert'),
        -- Die Stammdaten des Steuerpflichtigen. Die DSFinV-K verlangt sie
        -- EINZELN, und ohne sie kann ein Pruefer das Paket keinem Betrieb
        -- zuordnen; der Erzeuger verweigert es dann mit 409. Erfundene
        -- Testwerte, ausdruecklich kein echter Betrieb.
        ('shop.legal_name',   '"Pruefbetrieb Edelmetall GmbH"'::jsonb, 'Testwert'),
        ('shop.street',       '"Musterstrasse 1"'::jsonb,              'Testwert'),
        ('shop.postal_code',  '"28195"'::jsonb,                        'Testwert'),
        ('shop.city',         '"Bremen"'::jsonb,                       'Testwert'),
        ('shop.country_code', '"DEU"'::jsonb,                          'Testwert'),
        ('shop.tax_number',   '"60/123/45678"'::jsonb,                 'Testwert')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
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

    // Bewusst nur die Schlüssel, auf die dieser Test wirklich wirkt. Alle
    // übrigen trägt das Zod-Schema mit seinen Vorgabewerten nach, deshalb die
    // Teilmenge und die Zusicherung darauf — den Typ `Env` einfach zu behaupten
    // war schlicht falsch, und genau das hat der Typprüfer hier gefunden,
    // sobald diese Datei am 26.07.2026 zum ersten Mal in seinen Blick geriet.
    const env = {
      NODE_ENV: 'test',
      PORT: 0,
      LOG_LEVEL: 'error',
      DATABASE_URL: 'unused-because-override',
      DB_POOL_MAX: 5,
      NORNS_PII_KEY: PII_KEY,
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
    };
    app = await buildApp({
      env: env as Env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  // ── Per-test seeding ─────────────────────────────────────────────────────

  /** Insert a finalized transaction + items (+ optional payment/TSE). Returns id+locator. */
  async function seedTransaction(opts: {
    direction: 'VERKAUF' | 'ANKAUF';
    treatment: string; // tx-level tax_treatment_code (must be a real code)
    subtotal: string;
    vat: string;
    total: string;
    customerId: string | null;
    finalizedAt: string;
    /** 0147 — Beginn des Vorgangs. Ohne Angabe NULL (Altbestand). */
    vorgangBegonnenAt?: string; // ISO inside the Berlin business day
    items: Array<{
      productId: string;
      treatment: string;
      vatRate: string | null;
      lineSubtotal: string;
      lineVat: string;
      lineTotal: string;
      acquisition?: string | null;
      margin?: string | null;
      displayOrder: number;
    }>;
    /** Payment leg(s). MUST sum to the header total (deferred balance trigger). */
    payment: { method: string; amount: string };
    tse?: boolean;
    stornoOf?: string | null;
  }): Promise<{ id: string; locator: string }> {
    // A `transactions` row is INCOMPLETE on its own: a DEFERRABLE INITIALLY
    // DEFERRED constraint trigger (migration 0016) verifies at COMMIT that it
    // has ≥1 item, ≥1 payment, and that items + payments balance the header.
    // So the whole receipt (header + items + payment [+ tse]) MUST land inside
    // ONE database transaction — exactly how the finalize route writes it.
    return migratorSql.begin(async (tx) => {
      const [row] = await tx<{ id: string; receipt_locator: string }[]>`
        INSERT INTO transactions (
          direction, storno_of_transaction_id, customer_id, device_id, cashier_user_id,
          subtotal_eur, vat_eur, total_eur, tax_treatment_code, finalized_at,
          vorgang_begonnen_at
        ) VALUES (
          ${opts.direction}::transaction_direction,
          ${opts.stornoOf ?? null},
          ${opts.customerId},
          ${deviceId},
          ${cashierUserId},
          ${opts.subtotal}, ${opts.vat}, ${opts.total},
          ${opts.treatment},
          ${opts.finalizedAt}::timestamptz,
          ${opts.vorgangBegonnenAt ?? null}
        ) RETURNING id, receipt_locator`;
      const id = row!.id;

      for (const it of opts.items) {
        await tx`
          INSERT INTO transaction_items (
            transaction_id, product_id,
            line_subtotal_eur, line_vat_eur, line_total_eur,
            applied_tax_treatment_code, applied_vat_rate,
            acquisition_cost_eur_snapshot, margin_eur, display_order
          ) VALUES (
            ${id}, ${it.productId},
            ${it.lineSubtotal}, ${it.lineVat}, ${it.lineTotal},
            ${it.treatment}, ${it.vatRate},
            ${it.acquisition ?? null}, ${it.margin ?? null}, ${it.displayOrder}
          )`;
      }

      await tx`
        INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
        VALUES (${id}, ${opts.payment.method}::payment_method, ${opts.payment.amount})`;

      if (opts.tse) {
        await tx`
          INSERT INTO tse_signatures (
            transaction_id, fiskaly_tss_id, fiskaly_client_id,
            fiskaly_transaction_number, signature_value, signature_counter,
            signature_algorithm, process_type, tse_start_time, tse_end_time
          ) VALUES (
            ${id}, ${randomUUID()}, ${randomUUID()},
            ${Math.floor(Math.random() * 1_000_000) + 1},
            ${`sig-${randomUUID()}`}, ${Math.floor(Math.random() * 1_000_000) + 1},
            'ecdsa-plain-SHA256', 'Kassenbeleg-V1',
            ${opts.finalizedAt}::timestamptz, ${opts.finalizedAt}::timestamptz
          )`;
      }

      return { id, locator: row!.receipt_locator };
    });
  }

  /** Create a product available for sale; returns its id. */
  async function seedProduct(): Promise<string> {
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
              'gold_jewelry'::item_type, '10.00', '100.00', ${`Posten ${randomUUID().slice(0, 8)}`}, now())
      RETURNING id`;
    return p!.id;
  }

  beforeEach(async () => {
    // Die Mandantenangaben je Test neu setzen: das TRUNCATE unten raeumt
    // grosszuegig auf, und ohne sie verweigert der DATEV-Weg den Export --
    // absichtlich, siehe `datev-mandant.ts`.
    // Reset the fiscal + actor tables between tests. TRUNCATE (not DELETE) is
    // required: tse_signatures + transactions are append-only with BEFORE
    // DELETE triggers that hard-refuse row deletion (fiscal immutability).
    // TRUNCATE is a table-level op that bypasses per-row triggers, and the
    // migrator role (superuser) may TRUNCATE despite the app-role grant model.
    // CASCADE follows the FK graph; ledger_events is left intact (append-only
    // evidence — the closing anchors to whatever head exists).
    await migratorSql.unsafe(
      'TRUNCATE tse_signatures, transaction_payments, transaction_items, ' +
        'transactions, daily_closings, sessions, devices, customers CASCADE',
    );
    await migratorSql`DELETE FROM users WHERE is_owner = TRUE OR role <> 'ADMIN'`;

    // Actors.
    const [admin] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`admin-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    adminUserId = admin!.id;

    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`cash-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    // mTLS device.
    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${adminUserId})
      RETURNING id`;
    deviceId = dev!.id;

    // Sessions: ADMIN+step-up, ADMIN-no-step-up, CASHIER+step-up.
    adminStepUpToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${adminUserId}, ${adminStepUpToken}, now() + interval '8 hours', ${deviceId}, now())`;

    adminNoStepUpToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${adminUserId}, ${adminNoStepUpToken}, now() + interval '8 hours', ${deviceId}, NULL)`;

    cashierToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierToken}, now() + interval '8 hours', ${deviceId}, now())`;

    // A KYC-verified customer (needed for ANKAUF + any ≥ €2.000 sale).
    const [cust] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until, kyc_verified_at, kyc_verified_by_user_id)
      SELECT encrypt_pii('Audit Kunde'), (now() + interval '5 years')::date, now(), ${adminUserId} FROM s
      RETURNING id`;
    const customerId = cust!.id;

    // ── Seed the day's transactions, one per treatment + MIXED + storno. ──
    // All VERKAUF totals stay < €2.000 so the KYC gate is satisfied without a
    // customer where convenient; the ANKAUF attaches the verified customer.
    const ts = (h: number, m: number) =>
      `${businessDay}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;

    // 1) STANDARD_19 — 119,00 brutto = 100,00 netto + 19,00 USt.
    const pStd = await seedProduct();
    const std = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '100.00',
      vat: '19.00',
      total: '119.00',
      customerId: null,
      finalizedAt: ts(9, 0),
      // 0147: dieser eine Beleg kennt seinen Beginn — vier Minuten vor dem
      // Abschluss. BON_START und BON_ENDE muessen sich unterscheiden.
      vorgangBegonnenAt: ts(8, 56),
      items: [
        {
          productId: pStd,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '100.00',
          lineVat: '19.00',
          lineTotal: '119.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '119.00' },
      tse: true,
    });
    rcpStandard = std.locator;

    // 2) REDUCED_7 — 107,00 brutto = 100,00 netto + 7,00 USt.
    const pRed = await seedProduct();
    const red = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'REDUCED_7',
      subtotal: '100.00',
      vat: '7.00',
      total: '107.00',
      customerId: null,
      finalizedAt: ts(10, 0),
      items: [
        {
          productId: pRed,
          treatment: 'REDUCED_7',
          vatRate: '0.0700',
          lineSubtotal: '100.00',
          lineVat: '7.00',
          lineTotal: '107.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'ZVT_CARD', amount: '107.00' },
      tse: true,
    });
    rcpReduced = red.locator;

    // 3) MARGIN_25A — 200,00 brutto; acquisition 138,00 → margin 62,00;
    //    VAT-on-margin = round(62 * 19/119) = 9,90 → netto 190,10.
    const pMar = await seedProduct();
    const mar = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '190.10',
      vat: '9.90',
      total: '200.00',
      customerId: null,
      finalizedAt: ts(11, 0),
      items: [
        {
          productId: pMar,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '190.10',
          lineVat: '9.90',
          lineTotal: '200.00',
          acquisition: '138.00',
          margin: '62.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '200.00' },
      tse: true,
    });
    rcpMargin = mar.locator;

    // 4) INVESTMENT_GOLD_25C — 500,00 brutto = 500,00 netto + 0,00 USt (exempt).
    const pGold = await seedProduct();
    const gold = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'INVESTMENT_GOLD_25C',
      subtotal: '500.00',
      vat: '0.00',
      total: '500.00',
      customerId: null,
      finalizedAt: ts(12, 0),
      items: [
        {
          productId: pGold,
          treatment: 'INVESTMENT_GOLD_25C',
          vatRate: '0.0000',
          lineSubtotal: '500.00',
          lineVat: '0.00',
          lineTotal: '500.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '500.00' },
      tse: true,
    });
    rcpGold = gold.locator;

    // 5) MIXED receipt — STANDARD_19 line (119,00) + INVESTMENT_GOLD_25C line
    //    (500,00). tx total 619,00 = netto 600,00 + USt 19,00. tx-level code is
    //    STANDARD_19 (a real code); items span 2 treatments → DATEV must SPLIT.
    const pMixA = await seedProduct();
    const pMixB = await seedProduct();
    const mixed = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '600.00',
      vat: '19.00',
      total: '619.00',
      customerId: null,
      finalizedAt: ts(13, 0),
      items: [
        {
          productId: pMixA,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '100.00',
          lineVat: '19.00',
          lineTotal: '119.00',
          displayOrder: 0,
        },
        {
          productId: pMixB,
          treatment: 'INVESTMENT_GOLD_25C',
          vatRate: '0.0000',
          lineSubtotal: '500.00',
          lineVat: '0.00',
          lineTotal: '500.00',
          displayOrder: 1,
        },
      ],
      payment: { method: 'CASH', amount: '619.00' },
      tse: true,
    });
    rcpMixed = mixed.locator;

    // 6) ANKAUF — buy from a KYC-verified customer (300,00; no output VAT).
    const pAnk = await seedProduct();
    await seedTransaction({
      direction: 'ANKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '300.00',
      vat: '0.00',
      total: '300.00',
      customerId,
      finalizedAt: ts(14, 0),
      items: [
        {
          productId: pAnk,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '300.00',
          lineVat: '0.00',
          lineTotal: '300.00',
          acquisition: '300.00',
          margin: '0.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '300.00' },
      tse: true,
    });

    // 7) STORNO of the STANDARD_19 sale — negated mirror (trigger-validated).
    const storno = await seedTransaction({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '-100.00',
      vat: '-19.00',
      total: '-119.00',
      customerId: null,
      finalizedAt: ts(15, 0),
      items: [
        {
          productId: pStd,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '-100.00',
          lineVat: '-19.00',
          lineTotal: '-119.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '-119.00' }, // negative payment mirrors the refund
      stornoOf: std.id,
      tse: true,
    });
    rcpStorno = storno.locator;

    // Anchor the closing to the current chain head (the seed INSERTs above each
    // emitted a ledger_event, so the head is well-defined).
    const [head] = await migratorSql<{ id: string; row_hash: Buffer }[]>`
      SELECT id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`;

    // ── The FINALIZED daily_closing for the populated business day. ──
    // gross/net are illustrative day rollups; the export routes read the
    // transactions table for the per-receipt lines (not these aggregates), so
    // exact reconciliation of these fields is asserted at the row level.
    const [closing] = await migratorSql<{ id: string }[]>`
      INSERT INTO daily_closings (
        business_day, state,
        verkauf_count, ankauf_count, storno_count,
        gross_verkauf_eur, gross_ankauf_eur, net_verkauf_eur, net_ankauf_eur,
        vat_by_treatment, payments_by_method,
        cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
        tse_finished_count, tse_pending_count, tse_failed_count,
        ledger_anchor_id, ledger_anchor_hash,
        counted_by_user_id, counted_at, finalized_by_user_id, finalized_at,
        -- Zwei Pruefregeln kamen nach diesen Tests dazu und liessen sie
        -- STILL scheitern, weil der Standardlauf die Integrationsmappe
        -- ausschliesst: die Z-Nummer (Wanderung 0124) und die Herkunft des
        -- Kassenbestands (Wanderung 0125). Beide gehoeren zu einem echten
        -- festgeschriebenen Abschluss, also stehen sie jetzt hier.
        z_nr, kassensturz_quelle
      ) VALUES (
        ${businessDay}::date, 'FINALIZED'::closing_state,
        5, 1, 1,
        '1545.00', '300.00', '1426.00', '300.00',
        ${migratorSql.json({ STANDARD_19: '19.00', REDUCED_7: '7.00', MARGIN_25A: '9.90', INVESTMENT_GOLD_25C: '0.00' })},
        ${migratorSql.json({ CASH: '1019.00', ZVT_CARD: '107.00' })},
        '1019.00', '1019.00', '0.00',
        6, 0, 0,
        ${head!.id}, ${head!.row_hash},
        ${adminUserId}, now(), ${adminUserId}, now(),
        41, 'EIGENER_STURZ'::kassensturz_quelle
      ) RETURNING id`;
    closingId = closing!.id;

    // An EMPTY FINALIZED closing (different day, zero transactions) — the exact
    // shape the array-spread bug exploded on the FIRST non-empty day, here the
    // mirror case proving an empty day also exports cleanly.
    const [head2] = await migratorSql<{ id: string; row_hash: Buffer }[]>`
      SELECT id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`;
    const [emptyClosing] = await migratorSql<{ id: string }[]>`
      INSERT INTO daily_closings (
        business_day, state,
        cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
        ledger_anchor_id, ledger_anchor_hash,
        counted_by_user_id, counted_at, finalized_by_user_id, finalized_at,
        z_nr, kassensturz_quelle
      ) VALUES (
        ${emptyBusinessDay}::date, 'FINALIZED'::closing_state,
        '0.00', '0.00', '0.00',
        ${head2!.id}, ${head2!.row_hash},
        ${adminUserId}, now(), ${adminUserId}, now(),
        42, 'EIGENER_STURZ'::kassensturz_quelle
      ) RETURNING id`;
    emptyClosingId = emptyClosing!.id;

    await saeeDatevEinstellungen();
  });

  // ── inject() helpers ───────────────────────────────────────────────────────

  function get(url: string, opts: { token?: string | null; fingerprint?: string | null } = {}) {
    const headers: Record<string, string> = {};
    if (opts.token !== null) {
      headers.cookie = `warehouse14.session=${opts.token ?? adminStepUpToken}`;
    }
    if (opts.fingerprint !== null) {
      headers['x-dev-device-fingerprint'] = opts.fingerprint ?? deviceFingerprint;
    }
    return app.inject({ method: 'GET', url, headers });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  DATEV
  // ════════════════════════════════════════════════════════════════════════

  describe('DATEV export', () => {
    it('rejects with 401 when no session is presented', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`, { token: null });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it('rejects a CASHIER with 403 (ADMIN/READONLY only)', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`, { token: cashierToken });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });

    it('rejects an ADMIN without a fresh step-up with 403 STEP_UP_REQUIRED', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`, {
        token: adminNoStepUpToken,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'STEP_UP_REQUIRED' } });
    });

    it('404 for an unknown closing id (ADMIN + step-up)', async () => {
      const res = await get(`/api/closings/${randomUUID()}/export/datev`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    it('ADMIN + step-up → 200 with the fixed EXTF Buchungsstapel header', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`);
      expect(res.statusCode).toBe(200);
      // Zeichensatz und Dateiname sind Teil des Vertrags: ANSI, und der Name
      // muss mit EXTF_ beginnen, sonst zeigt DATEV die Datei gar nicht an.
      expect(res.headers['content-type']).toContain('windows-1252');
      expect(String(res.headers['content-disposition'])).toContain('filename="EXTF_');

      // Die Antwort ist ANSI (Windows-1252), wie DATEVs Formatdefinition es
      // verlangt. `res.payload` decodiert als UTF-8 und macht aus dem ü in
      // `BU-Schlüssel` ein Ersatzzeichen. Also die ROHEN Bytes nehmen und
      // richtig lesen — genau der Unterschied, den ein Steuerberater sonst
      // als Zeichensalat im Buchungstext sieht.
      const csv = Buffer.from(res.rawPayload).toString('latin1');
      const zeilen = csv.split('\r\n');

      // Die Kopfzeile ist eingefasst und traegt Formatversion 13 sowie die
      // fuenf Ordnungsbegriffe. Bis zum 26.07.2026 stand hier eine feste
      // Zeichenkette ohne Anfuehrungszeichen, mit Version 9 und leeren
      // Ordnungsbegriffen.
      expect(zeilen[0]?.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
      expect(zeilen[0]?.split(';').length).toBe(31);
      expect(zeilen[0]?.split(';')[10]).toBe('29098'); // Beraternummer
      expect(zeilen[0]?.split(';')[12]).toBe('20260101'); // Wirtschaftsjahresbeginn

      // Die Spaltenzeile ist WOERTLICH die von DATEV, alle 125.
      expect(zeilen[1]).toBe(DATEV_SPALTEN.join(';'));

      // Und die ganze Datei haelt dem Pruefer stand, der an DATEVs eigener
      // Musterdatei geeicht ist.
      expect(nurFehler(pruefeBuchungsstapel(csv))).toEqual([]);
    });

    it('maps each treatment to the correct SKR03 Gegenkonto + BU-Schlüssel', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`);
      expect(res.statusCode).toBe(200);
      const lines = res.payload.split('\r\n');
      // Column indices (0-based): 0 Umsatz, 1 Soll/Haben, 6 Konto, 7 Gegenkonto,
      // 8 BU-Schlüssel, 10 Belegfeld1, 117 Generalumkehr.
      type Booking = {
        umsatz: string;
        sh: string;
        konto: string;
        gegenkonto: string;
        bu: string;
        ref: string;
        gu: string;
      };
      const bookings: Booking[] = lines
        .slice(2) // skip EXTF + column header
        .filter((l) => l.length > 0)
        .map((l) => {
          const cols = l.split(';').map((c) => c.replace(/^"|"$/g, ''));
          return {
            umsatz: cols[0] ?? '',
            sh: cols[1] ?? '',
            konto: cols[6] ?? '',
            gegenkonto: cols[7] ?? '',
            bu: cols[8] ?? '',
            ref: cols[10] ?? '',
            gu: cols[117] ?? '',
          };
        });

      const byRef = (ref: string) => bookings.filter((b) => b.ref === ref);

      // STANDARD_19 → Kasse(1000) an Erlöse 8400, Soll. Feld 9 bleibt LEER:
      // 8400 trägt im amtlichen SKR03 die Funktionsmarke „U AM" und rechnet
      // die Steuer selbst. Bis 19.08.2026 stand hier BU 3 — der Test schrieb
      // den Fehler als Sollzustand fest. DATEVs eigene Musterdatei
      // (tests/vorlagen/) bucht 8400 zehnmal, kein einziges Mal mit BU 3.
      const std = byRef(rcpStandard);
      expect(std).toHaveLength(1);
      expect(std[0]).toMatchObject({
        konto: '1000',
        gegenkonto: '8400',
        bu: '',
        umsatz: '119,00',
        sh: 'S',
      });

      // REDUCED_7 → 8300, ebenfalls Automatikkonto, ebenfalls ohne Schlüssel.
      // Dieser Beleg ist mit KARTE bezahlt, deshalb
      // steht auf der Sollseite der Geldtransit 1361 und nicht die Kasse.
      // Bis zum 26.07.2026 stand hier '1000' — der Test schrieb den Fehler
      // wörtlich als Sollzustand fest, und deshalb fiel er nie auf.
      const red = byRef(rcpReduced);
      expect(red[0]).toMatchObject({
        konto: '1361',
        gegenkonto: '8300',
        bu: '',
        umsatz: '107,00',
      });

      /**
       * § 25a ergibt ZWEI Zeilen, nicht eine.
       *
       * ⚠️ Dieser Test verlangte bis zum 04.08.2026 EINE Zeile über 200,00 auf
       * ein steuerfreies Konto. Genau das war der Fehler, den ein früherer Lauf
       * fand: die volle Differenzbesteuerung landete steuerfrei, und 5.393,19
       * EUR Umsatzsteuer standen in KEINER Zeile.
       *
       * Richtig sind zwei: der Einkaufsanteil steuerfrei (8193) und die MARGE
       * auf dem 19-Prozent-Konto (8191). Zusammen ergeben sie den Bruttoumsatz.
       *
       * 19.08.2026: beide Zeilen tragen ein LEERES Feld 9 — 8191 ist im
       * amtlichen SKR03 ein Automatikkonto („AM"), die Steuer rechnet das
       * Konto. Die zwei Haelften unterscheidet deshalb das GEGENKONTO, nicht
       * mehr der Schluessel.
       *
       * Weil der Standardlauf die Integrationsmappe ausschliesst, hat dieser
       * Test die alte, falsche Erwartung monatelang unbemerkt festgehalten.
       */
      const mar = byRef(rcpMargin);
      expect(mar, '§ 25a wurde nicht aufgeteilt').toHaveLength(2);

      const steuerfrei = mar.find((b) => b.gegenkonto === '8193')!;
      const versteuert = mar.find((b) => b.gegenkonto === '8191')!;
      expect(steuerfrei, 'der steuerfreie Anteil fehlt').toBeDefined();
      expect(versteuert, 'die versteuerte Marge fehlt').toBeDefined();

      // Der versteuerte Anteil ist die MARGE, nicht der ganze Verkauf.
      expect(cents(versteuert.umsatz.replace(',', '.'))).toBeLessThan(
        cents(steuerfrei.umsatz.replace(',', '.')),
      );
      // Und beide zusammen ergeben den Bruttoumsatz des Belegs.
      expect(
        cents(steuerfrei.umsatz.replace(',', '.')) + cents(versteuert.umsatz.replace(',', '.')),
      ).toBe(cents('200.00'));
      // Beide auf derselben Seite und aus derselben Kasse.
      for (const b of mar) {
        expect(b.konto).toBe('1000');
        expect(b.sh).toBe('S');
      }

      // INVESTMENT_GOLD_25C → 8165, BU empty (0 % exempt). 19.08.2026:
      // 8150 war das Konto fuer § 4 Nr. 2-7, § 25c ist keine solche Befreiung.
      const gold = byRef(rcpGold);
      expect(gold[0]).toMatchObject({
        konto: '1000',
        gegenkonto: '8165',
        bu: '',
        umsatz: '500,00',
      });

      // ANKAUF → Wareneingang 3200 an Kasse 1000, no output VAT key.
      const ankauf = bookings.find((b) => b.konto === '3200');
      expect(ankauf).toBeDefined();
      expect(ankauf).toMatchObject({ konto: '3200', gegenkonto: '1000', bu: '' });

      // STORNO → DATEV-conforming Generalumkehr: same accounts/BU AND the same
      // side as the original, POSITIVE Umsatz — the minus is carried by field
      // 118 alone (Dok.-Nr. 1070379: „mit Minuszeichen auf der GLEICHEN
      // Soll-/Haben-Seite"). A flipped side WITH the mark would re-book the
      // sale instead of cancelling it.
      const storno = byRef(rcpStorno);
      expect(storno).toHaveLength(1);
      expect(storno[0]).toMatchObject({ gegenkonto: '8400', bu: '', umsatz: '119,00', sh: 'S' });
      expect(storno[0]!.gu).toBe('1');
      expect(std[0]!.sh).toBe('S');
    });

    it('KEINE unbare Zeile der ganzen Datei berührt Konto 1000', async () => {
      // Das ist die Aussage, die zählt: nicht dass EIN Beleg richtig gebucht
      // ist, sondern dass die Kasse in der GANZEN Datei nur Bargeld trägt.
      // Ein rechnerisch unmöglicher Kassenbestand begründet für sich genommen
      // eine Schätzung — er ist das Erste, was ein Prüfer nachrechnet.
      const res = await get(`/api/closings/${closingId}/export/datev`);
      const lines = Buffer.from(res.rawPayload).toString('latin1').split('\r\n');
      const kassenZeilen = lines
        .slice(2)
        .filter((l) => l.length > 0)
        .map((l) => l.split(';').map((c) => c.replace(/^"|"$/g, '')))
        // Konto (Feld 7) ODER Gegenkonto (Feld 8) — beim Ankauf steht die Kasse
        // auf der Habenseite, und auch dort darf nur Bargeld liegen.
        .filter((c) => c[6] === '1000' || c[7] === '1000');

      // Jede verbliebene Kassenzeile MUSS zu einem bar bezahlten Beleg gehören.
      for (const c of kassenZeilen) {
        expect(c[10], `Beleg ${c[10]} bucht auf die Kasse`).not.toBe(rcpReduced);
      }
      expect(kassenZeilen.length).toBeGreaterThan(0); // bar gibt es weiterhin
    });

    it('splits a MIXED receipt into per-treatment lines reconciling to the total (integer cents)', async () => {
      const res = await get(`/api/closings/${closingId}/export/datev`);
      const lines = res.payload.split('\r\n');
      const mixedRows = lines
        .slice(2)
        .filter((l) => l.includes(rcpMixed))
        .map((l) => {
          const cols = l.split(';').map((c) => c.replace(/^"|"$/g, ''));
          return { umsatz: cols[0] ?? '', gegenkonto: cols[7] ?? '', bu: cols[8] ?? '' };
        });

      // Two booking lines: one per treatment, NOT a single collapsed 8400 row.
      expect(mixedRows).toHaveLength(2);
      const byKonto = new Map(mixedRows.map((r) => [r.gegenkonto, r]));

      // STANDARD_19 portion on 8400/BU3 = 119,00.
      expect(byKonto.get('8400')).toMatchObject({ umsatz: '119,00', bu: '' });
      // §25c portion on 8165, exempt = 500,00 — NOT taxed at 19 %.
      expect(byKonto.get('8165')).toMatchObject({ umsatz: '500,00', bu: '' });

      // The split reconciles to the receipt total 619,00 in integer cents.
      const sum = mixedRows.reduce((acc, r) => acc + cents(r.umsatz.replace(',', '.')), 0n);
      expect(sum).toBe(cents('619.00'));
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  DSFinV-K
  // ════════════════════════════════════════════════════════════════════════

  describe('DSFinV-K export', () => {
    it('rejects with 401 / 403 / 403 mirroring DATEV auth gating', async () => {
      const url = `/api/closings/${closingId}/export/dsfinvk`;
      expect((await get(url, { token: null })).statusCode).toBe(401);
      expect((await get(url, { token: cashierToken })).statusCode).toBe(403);
      const noStep = await get(url, { token: adminNoStepUpToken });
      expect(noStep.statusCode).toBe(403);
      expect(noStep.json()).toMatchObject({ error: { code: 'STEP_UP_REQUIRED' } });
    });

    it('404 for an unknown closing id', async () => {
      const res = await get(`/api/closings/${randomUUID()}/export/dsfinvk`);
      expect(res.statusCode).toBe(404);
    });

    /**
     * ⚠️ DIESE SECHS PRUEFUNGEN HINGEN DER WIRKLICHKEIT HINTERHER.
     *
     * Sie pinnten die alte Hausform des Pakets: neun Dateien mit Namen wie
     * `bon_kopf.csv` und selbst erfundenen Spalten. Der Erzeuger ist seither
     * auf die AMTLICHE DSFinV-K umgestellt (22 Dateien, `transactions.csv`,
     * `lines.csv`, `transactions_tse.csv`). Weil der Standardlauf die
     * Integrationsmappe ausschliesst, fiel das keinem auf.
     *
     * Die Erwartungen kommen jetzt aus der MITGELIEFERTEN Norm selbst
     * (`src/fiskal/dsfinvk-2.4/index.xml`), nicht aus diesem Test. Damit kann
     * dieser Test nichts festschreiben, was die Norm nicht sagt, und eine
     * fehlende Spalte wird hier rot, statt erst beim Pruefer.
     */
    it('⛔ das Paket trägt die AMTLICHEN Dateien, nicht die alte Hausform', async () => {
      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/zip');

      const zip = res.rawPayload;
      expect(Buffer.isBuffer(zip)).toBe(true);
      const namen = readZip(zip).map((f) => f.name).sort();

      // Die Norm nennt ihre Dateien selbst. Wir vergleichen gegen SIE.
      const amtlich = amtlicheDateien();
      expect(amtlich.length, 'die mitgelieferte Norm nennt keine Dateien').toBeGreaterThan(15);
      for (const datei of amtlich) {
        expect(namen, `${datei} fehlt im Paket`).toContain(datei);
      }
      // Und die zwei Begleiter, ohne die kein Pruefwerkzeug das Paket oeffnet.
      expect(namen).toContain('index.xml');
      expect(namen).toContain('gdpdu-01-09-2004.dtd');

      // Die Spaltenzeile JEDER Datei ist die der Norm, in ihrer Reihenfolge.
      const nachName = new Map(readZip(zip).map((f) => [f.name, f.content]));
      for (const datei of amtlich) {
        const kopf = parseCsv(nachName.get(datei) ?? '')[0] ?? [];
        expect(kopf, `${datei}: die Spaltenzeile weicht von der Norm ab`).toEqual(
          amtlicheSpalten(datei),
        );
      }

      // Und der Abschluss traegt seinen Tag und seine Nummer.
      const cpc = parseCsv(nachName.get('cashpointclosing.csv') ?? '');
      const cpcH = cpc[0]!;
      expect(cpc[1]?.[cpcH.indexOf('Z_BUCHUNGSTAG')]).toBe(businessDay);
      expect(cpc[1]?.[cpcH.indexOf('Z_NR')]).toBe('41');
      // ⚠️ Die Taxonomieversion darf NIE leer sein: ein Pruefwerkzeug
      // entscheidet an ihr, nach welcher Fassung es liest.
      expect(cpc[1]?.[cpcH.indexOf('TAXONOMIE_VERSION')]).not.toBe('');

      // 7 Belege gesaet (5 Verkaeufe + Ankauf + Storno).
      const vorgaenge = parseCsv(nachName.get('transactions.csv') ?? '');
      expect(vorgaenge.length - 1).toBe(7);

      /*
       * ── 0147: BON_START ist der VORGANGSBEGINN, nicht die Bezahlzeit ────
       *
       * § 6 Satz 1 Nr. 2 KassenSichV verlangt Beginn UND Ende. Bis heute
       * schrieb die Ausfuhr in beide Felder denselben Zeitpunkt — ein
       * Pruefer sah auf JEDEM Beleg einen Nullsekunden-Vorgang. Der
       * Standard-Beleg oben traegt seinen Beginn (vier Minuten frueher);
       * die uebrigen (Altbestand ohne Beginn) fallen ehrlich auf
       * BON_START = BON_ENDE zurueck.
       */
      const vk = vorgaenge[0]!;
      const iBonId = vk.indexOf('BON_ID');
      const iStart = vk.indexOf('BON_START');
      const iEnde = vk.indexOf('BON_ENDE');
      const stdZeile = vorgaenge.slice(1).find((r) => r[iBonId] === rcpStandard);
      expect(stdZeile, 'Standard-Beleg fehlt in transactions.csv').toBeDefined();
      expect(stdZeile![iStart]).not.toBe(stdZeile![iEnde]);
      expect(new Date(stdZeile![iStart]!).getTime()).toBeLessThan(
        new Date(stdZeile![iEnde]!).getTime(),
      );
      const reduZeile = vorgaenge.slice(1).find((r) => r[iBonId] === rcpReduced);
      expect(reduZeile![iStart]).toBe(reduZeile![iEnde]);
    });

    it('jede Position traegt den Umsatzsteuerschluessel ihrer Behandlung', async () => {
      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      const nachName = new Map(readZip(res.rawPayload).map((f) => [f.name, f.content]));

      const zeilen = parseCsv(nachName.get('lines_vat.csv') ?? '');
      const h = zeilen[0]!;
      const iBon = h.indexOf('BON_ID');
      const iUst = h.indexOf('UST_SCHLUESSEL');
      const daten = zeilen.slice(1);

      const ustFuer = (beleg: string): string[] =>
        daten.filter((r) => r[iBon] === beleg).map((r) => r[iUst]!);

      expect(ustFuer(rcpStandard)).toEqual(['1']); // 19 %
      expect(ustFuer(rcpReduced)).toEqual(['2']); // 7 %
      // ⚠️ Anlagegold traegt 6 („umsatzsteuerfrei"), NICHT 5 („nicht
      // steuerbar"). Der Unterschied ist rechtlich: § 25c Abs. 1 UStG sagt
      // steuerFREI, also steuerbar und befreit. Die 5 stammt aus dem
      // Signaturcontainer der TSE, einem anderen Abschnitt desselben Papiers.
      expect(ustFuer(rcpGold)).toEqual(['6']);
      // § 25a hat KEINEN festen Wert: die Nummer gehoert dem Steuerberater
      // und steht in der Saat oben.
      expect(ustFuer(rcpMargin)).toEqual(['1001']);
      expect(ustFuer(rcpMixed)).toEqual(['1', '6']);

      // Und der Ankauf traegt den Geschaeftsvorfalltyp des Beraters.
      const pos = parseCsv(nachName.get('lines.csv') ?? '');
      const iGv = pos[0]!.indexOf('GV_TYP');
      expect(pos.slice(1).some((r) => r[iGv] === 'Auszahlung')).toBe(true);
      // „Einkauf" kommt im ganzen Normtext null Mal vor.
      expect(pos.slice(1).every((r) => r[iGv] !== 'Einkauf')).toBe(true);
    });

    it('netto plus Steuer ergibt brutto, in ganzen Cent, in JEDER Zeile', async () => {
      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      const nachName = new Map(readZip(res.rawPayload).map((f) => [f.name, f.content]));

      const zeilen = parseCsv(nachName.get('lines_vat.csv') ?? '');
      const h = zeilen[0]!;
      const iB = h.indexOf('POS_BRUTTO');
      const iN = h.indexOf('POS_NETTO');
      const iU = h.indexOf('POS_UST');
      const iBon = h.indexOf('BON_ID');
      const daten = zeilen.slice(1);
      expect(daten.length).toBeGreaterThan(0);

      for (const r of daten) {
        expect(normCents(r[iN]!) + normCents(r[iU]!), `${r[iBon]} geht nicht auf`).toBe(
          normCents(r[iB]!),
        );
      }

      // Anlagegold nach § 25c ist WIRKLICH steuerfrei: brutto = netto, Steuer 0.
      const gold = daten.find((r) => r[iBon] === rcpGold)!;
      expect(normCents(gold[iU]!)).toBe(0n);
      expect(normCents(gold[iN]!)).toBe(normCents(gold[iB]!));

      // Und § 25a traegt die Steuer AUF DIE MARGE: 9,90, nicht 0 und nicht die
      // volle Steuer auf den Verkaufspreis. Genau diese Unterscheidung schuetzt
      // die Aufteilung je Behandlung.
      const marge = daten.find((r) => r[iBon] === rcpMargin)!;
      expect(marge, 'die § 25a-Zeile fehlt').toBeDefined();
      expect(normCents(marge[iU]!)).toBe(cents('9.90'));

      // Dieselbe Gleichung in den Preisfindungszeilen.
      const preise = parseCsv(nachName.get('itemamounts.csv') ?? '');
      const ph = preise[0]!;
      const pB = ph.indexOf('PF_BRUTTO');
      const pN = ph.indexOf('PF_NETTO');
      const pU = ph.indexOf('PF_UST');
      for (const r of preise.slice(1)) {
        expect(normCents(r[pN]!) + normCents(r[pU]!)).toBe(normCents(r[pB]!));
      }
    });

    /*
     * ═══════════════════════════════════════════════════════════════════════
     *  ⛔ JEDE ZELLE JEDER DATEI HÄLT DIE AMTLICHE BESCHREIBUNG (21.08.2026)
     * ═══════════════════════════════════════════════════════════════════════
     *
     * Basels Auftrag: „الملفات العشرين تكون مثالية... اي خطا كارثة". Die
     * Proben oben messen einzelne Behauptungen (Schlüssel, Summen, Signatur).
     * DIESE misst mechanisch ALLES: für jede der zwanzig Dateien, für jede
     * Zeile, für jede Zelle —
     *
     *   • die Spaltenzahl der Zeile ist EXAKT die der Beschreibung (ein
     *     verirrtes Semikolon in einem Artikeltext zerrisse beim Prüfer
     *     jede Spalte dahinter),
     *   • jede Numeric-Zelle trägt das KOMMA und GENAU die Accuracy der
     *     Beschreibung (2, 3 oder 5 Nachkommastellen) — mit derselben
     *     index.xml liest IDEA die Zahlen ein; eine Punkt-Zelle würde dort
     *     zur hundertfachen Summe,
     *   • kein Tausenderzeichen (der Punkt WÄRE eines),
     *   • jede Text-Zelle hält ihre Höchstlänge.
     *
     * Die Erwartung stammt vollständig aus `leseTaxonomie(index.xml)` — dieser
     * Test nennt keinen Dateinamen, keine Spalte und keine Länge selbst.
     */
    it('⛔ jede Zelle jeder der zwanzig Dateien hält die amtliche Beschreibung', async () => {
      const { leseTaxonomie } = await import('../../src/lib/dsfinvk-taxonomie.js');
      const taxonomie = leseTaxonomie(NORM_XML);
      expect(taxonomie.length).toBe(20);

      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      expect(res.statusCode).toBe(200);
      const dateien = readZip(Buffer.from(res.rawPayload));

      const fehler: string[] = [];
      let geprueffteZellen = 0;

      for (const t of taxonomie) {
        const datei = dateien.find((f) => f.name === t.datei);
        if (!datei) {
          fehler.push(`${t.datei}: fehlt im Paket`);
          continue;
        }
        /*
         * ⚠️ Nicht naiv an ';' trennen: eingefasste Zellen dürfen das
         * Trennzeichen TRAGEN (fasseEin). Ein kleiner Zerleger nach der
         * Einfassungsregel der Norm — genau die Sicht des Prüfwerkzeugs.
         */
        const zeilen = datei.content
          .split(t.format.zeilentrenner)
          .filter((z) => z.length > 0)
          .map((zeile) => {
            const raus: string[] = [];
            let feld = '';
            let drin = false;
            for (let i = 0; i < zeile.length; i++) {
              const c = zeile[i] as string;
              if (drin) {
                if (c === t.format.texteinfassung) {
                  if (zeile[i + 1] === t.format.texteinfassung) {
                    feld += c;
                    i++;
                  } else drin = false;
                } else feld += c;
              } else if (c === t.format.texteinfassung) drin = true;
              else if (c === t.format.spaltentrenner) {
                raus.push(feld);
                feld = '';
              } else feld += c;
            }
            raus.push(feld);
            return raus;
          });

        for (const [nr, zeile] of zeilen.entries()) {
          if (zeile.length !== t.spalten.length) {
            fehler.push(
              `${t.datei} Zeile ${nr + 1}: ${zeile.length} Spalten, die Beschreibung sagt ${t.spalten.length}`,
            );
            continue;
          }
          if (nr === 0) continue; // Kopfzeile — die prueft die Taxonomie-Probe
          for (const [i, sp] of t.spalten.entries()) {
            const wert = zeile[i] as string;
            geprueffteZellen++;
            if (wert === '') continue; // leer ist erlaubt, wo die Norm es zulaesst
            if (sp.art === 'zahl') {
              const muster =
                sp.laenge !== null && sp.laenge > 0
                  ? new RegExp(`^-?\\d+,\\d{${sp.laenge}}$`)
                  : /^-?\d+$/;
              if (!muster.test(wert)) {
                fehler.push(
                  `${t.datei} Zeile ${nr + 1} ${sp.name}: ${JSON.stringify(wert)} ` +
                    `haelt nicht Numeric mit ${sp.laenge ?? 0} Nachkommastellen und Komma`,
                );
              }
            } else if (sp.laenge !== null && wert.length > sp.laenge) {
              fehler.push(
                `${t.datei} Zeile ${nr + 1} ${sp.name}: ${wert.length} Zeichen, hoechstens ${sp.laenge}`,
              );
            }
          }
        }
      }

      expect(geprueffteZellen).toBeGreaterThan(200);
      expect(fehler, fehler.slice(0, 12).join('\n')).toEqual([]);
    });

    it('die Signatur der Sicherungseinrichtung steht im Paket', async () => {
      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      const nachName = new Map(readZip(res.rawPayload).map((f) => [f.name, f.content]));
      const tse = parseCsv(nachName.get('transactions_tse.csv') ?? '');
      const h = tse[0]!;
      const iBon = h.indexOf('BON_ID');
      const iSig = h.indexOf('TSE_TA_SIG');
      const iSigz = h.indexOf('TSE_TA_SIGZ');
      const iTse = h.indexOf('TSE_ID');

      const zeile = tse.slice(1).find((r) => r[iBon] === rcpStandard);
      expect(zeile, 'der signierte Beleg fehlt in transactions_tse.csv').toBeDefined();
      expect(zeile![iSig]).toMatch(/^sig-/);
      expect(BigInt(zeile![iSigz]!)).toBeGreaterThan(0n);
      // ⚠️ Die Kennung darf jede Form haben: Wolke gibt eine UUID, ein
      // Swissbit-Stecker seine Seriennummer (Wanderung 0131). Geprueft wird,
      // dass sie DA ist, nicht dass sie wie eine UUID aussieht.
      expect((zeile![iTse] ?? '').trim().length).toBeGreaterThan(0);
    });

    it('?encoding=base64 returns the same ZIP bytes, base64-encoded', async () => {
      const raw = await get(`/api/closings/${closingId}/export/dsfinvk`);
      const b64 = await get(`/api/closings/${closingId}/export/dsfinvk?encoding=base64`);
      expect(b64.statusCode).toBe(200);
      expect(b64.headers['content-type']).toContain('text/plain');
      const decoded = Buffer.from(b64.payload, 'base64');
      expect(decoded.equals(raw.rawPayload)).toBe(true);
    });

    it('ein UMSATZLOSER festgeschriebener Tag ergibt ein vollständiges Paket', async () => {
      // Ein Tag ohne Umsatz ist kein Sonderfall, sondern jeder Feiertag. Das
      // Paket muss trotzdem ALLE Dateien tragen, nur ohne Datenzeilen: ein
      // Pruefwerkzeug bricht sonst an der fehlenden Datei ab.
      const res = await get(`/api/closings/${emptyClosingId}/export/dsfinvk`);
      expect(res.statusCode).toBe(200);
      const dateien = readZip(res.rawPayload);
      const namen = dateien.map((f) => f.name);
      for (const datei of amtlicheDateien()) {
        expect(namen, `${datei} fehlt am umsatzlosen Tag`).toContain(datei);
      }
      const nachName = new Map(dateien.map((f) => [f.name, f.content]));
      expect(parseCsv(nachName.get('transactions.csv') ?? '').length - 1).toBe(0);
      // Und der Abschluss selbst steht sehr wohl da.
      expect(parseCsv(nachName.get('cashpointclosing.csv') ?? '').length - 1).toBe(1);
    });

    it('the DATEV route ALSO survives an empty day (no array-spread 500)', async () => {
      const res = await get(`/api/closings/${emptyClosingId}/export/datev`);
      expect(res.statusCode).toBe(200);
      // Header + column row only — no booking lines.
      const csv = Buffer.from(res.rawPayload).toString('latin1');
      const lines = csv.split('\r\n').filter((l) => l.length > 0);
      expect(lines[0]!.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
      // Kopf und Spaltenzeile, keine Buchung — und trotzdem formgerecht.
      expect(lines.length).toBe(2);
      expect(nurFehler(pruefeBuchungsstapel(csv))).toEqual([]);
    });
  });

  // ── POST /api/closings/finalize — the Z-Bon WRITER (the missing keystone) ──
  describe('POST /api/closings/finalize — Z-Bon writer', () => {
    const freshDay = '2026-05-07';
    const tsFresh = (h: number) => `${freshDay}T${String(h).padStart(2, '0')}:00:00+02:00`;

    async function seedFreshDay(): Promise<void> {
      // One VERKAUF (119,00 brutto cash, TSE-signed) on a clean day.
      const p = await seedProduct();
      await seedTransaction({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: tsFresh(9),
        items: [
          {
            productId: p,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 0,
          },
        ],
        payment: { method: 'CASH', amount: '119.00' },
        tse: true,
      });
      // A CLOSED shift for the day: float 100 + 119 cash sale = 219 expected,
      // counted 219 → variance 0.
      await migratorSql`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status,
                            blind_count_eur, system_expected_eur, closed_by_user_id,
                            opened_at, closed_at)
        VALUES (${deviceId}, ${adminUserId}, '100.00', 'CLOSED'::shift_status,
                '219.00', '219.00', ${adminUserId},
                ${`${freshDay}T08:00:00+02:00`}::timestamptz,
                ${`${freshDay}T18:00:00+02:00`}::timestamptz)`;
    }

    function finalize(token: string, businessDay?: string) {
      return app.inject({
        method: 'POST',
        url: '/api/closings/finalize',
        headers: { cookie: `warehouse14.session=${token}`, 'content-type': 'application/json' },
        payload: businessDay ? { businessDay } : {},
      });
    }

    it('writes a correct FINALIZED Z-Bon, then the export chain reads it', async () => {
      await seedFreshDay();
      const res = await finalize(adminStepUpToken, freshDay);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state).toBe('FINALIZED');
      expect(body.businessDay).toBe(freshDay);
      expect(body.verkaufCount).toBe(1);
      expect(body.grossVerkaufEur).toBe('119.00');
      expect(body.netVerkaufEur).toBe('100.00');
      expect(body.cashExpectedEur).toBe('219.00');
      expect(body.cashCountedEur).toBe('219.00');
      expect(body.cashVarianceEur).toBe('0.00');

      // The row really landed + the Kassenbericht reads it (the whole point).
      const kb = await get(`/api/closings/${body.id}/export/kassenbericht`);
      expect(kb.statusCode).toBe(200);
      expect(kb.payload).toContain('119,00 EUR'); // Verkauf brutto
      // Der Kassenbericht nennt die Steuerbehandlung auf DEUTSCH, nicht als
      // rohen Bezeichner. Das wurde am 22.07.2026 absichtlich geändert (siehe
      // den Dateikopf von `kassenbericht-export.ts`); dieser Test verlangte
      // bis heute den alten Zustand zurück — ein Blatt, das ein Prüfer liest,
      // darf kein Maschinenabzug sein.
      expect(kb.payload).toContain('Regelsteuersatz 19 %');
      expect(kb.payload).not.toContain('STANDARD_19');

      // VAT + payments jsonb aggregated correctly.
      const [row] = await migratorSql<
        { vat_by_treatment: Record<string, string>; payments_by_method: Record<string, string> }[]
      >`SELECT vat_by_treatment, payments_by_method FROM daily_closings WHERE id = ${body.id}`;
      expect(row!.vat_by_treatment.STANDARD_19).toBe('19.00');
      expect(row!.payments_by_method.CASH).toBe('119.00');
    });

    it('refuses to re-finalize the same day (409)', async () => {
      await seedFreshDay();
      expect((await finalize(adminStepUpToken, freshDay)).statusCode).toBe(200);
      const again = await finalize(adminStepUpToken, freshDay);
      expect(again.statusCode).toBe(409);
    });

    it('requires a fresh PIN step-up (403 without)', async () => {
      const res = await finalize(adminNoStepUpToken, freshDay);
      expect(res.statusCode).toBe(403);
    });

    it('refuses a day with sales but no closed shift (409)', async () => {
      const p = await seedProduct();
      await seedTransaction({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: tsFresh(10),
        items: [
          {
            productId: p,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 0,
          },
        ],
        payment: { method: 'CASH', amount: '119.00' },
        tse: true,
      });
      const res = await finalize(adminStepUpToken, freshDay);
      expect(res.statusCode).toBe(409); // no Kassensturz
    });
  });

  // ── GET /api/registers/an-verkaufsbuch — GwG §10 / §38 GewO purchase register ──
  describe('GET /api/registers/an-verkaufsbuch', () => {
    const regDay = '2026-05-09';

    async function seedAnkaufWithSeller(): Promise<void> {
      // A seller with full encrypted identity + KYC stamp + an inspected ID.
      const [c] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, date_of_birth_encrypted, address_encrypted,
                               retention_until, kyc_verified_at, kyc_verified_by_user_id)
        SELECT encrypt_pii('Goldverkäufer Schmidt'), encrypt_pii('1971-03-04'),
               encrypt_pii('Hauptstr. 1, 73614 Schorndorf'),
               (now() + interval '5 years')::date, now(), ${adminUserId} FROM s
        RETURNING id`;
      const customerId = c!.id;
      await migratorSql`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO kyc_documents (customer_id, document_type, issuing_country_iso2,
                                   document_number_encrypted, document_photo_sha256,
                                   document_photo_storage_key, issued_on, expires_on,
                                   captured_by_user_id, retention_until)
        SELECT ${customerId}, 'PERSONALAUSWEIS'::id_document_type, 'DE',
               encrypt_pii('L01X00T471'), sha256('idphoto'::bytea), gen_random_uuid()::text,
               '2019-01-01'::date, '2029-01-01'::date,
               ${adminUserId}, (now() + interval '5 years')::date FROM s`;
      // A 750 gold ring, 4.2 g.
      const productId = await seedProduct();
      await migratorSql`
        UPDATE products SET metal = 'gold', weight_grams = '4.2000',
               name = '750 Gold Ring' WHERE id = ${productId}`;
      // The Ankauf: 500,00 € paid out in cash (§25a margin item).
      await seedTransaction({
        direction: 'ANKAUF',
        treatment: 'MARGIN_25A',
        subtotal: '500.00',
        vat: '0.00',
        total: '500.00',
        customerId,
        finalizedAt: `${regDay}T11:00:00+02:00`,
        items: [
          {
            productId,
            treatment: 'MARGIN_25A',
            vatRate: null,
            lineSubtotal: '500.00',
            lineVat: '0.00',
            lineTotal: '500.00',
            acquisition: null,
            margin: null,
            displayOrder: 0,
          },
        ],
        payment: { method: 'CASH', amount: '500.00' },
        tse: true,
      });
    }

    it('lists the Ankauf with decrypted seller identity, ID document, item + payout', async () => {
      await seedAnkaufWithSeller();
      const res = await get(
        `/api/registers/an-verkaufsbuch?direction=ANKAUF&from=${regDay}&to=${regDay}`,
      );
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.direction).toBe('ANKAUF');
      expect(body.count).toBe(1);
      const e = body.entries[0];
      expect(e.seller.fullName).toBe('Goldverkäufer Schmidt');
      expect(e.seller.dateOfBirth).toBe('1971-03-04');
      expect(e.seller.address).toContain('Schorndorf');
      expect(e.seller.kycVerifiedAt).not.toBeNull();
      expect(e.seller.document.type).toBe('PERSONALAUSWEIS');
      expect(e.seller.document.number).toBe('L01X00T471');
      expect(e.totalEur).toBe('500.00');
      expect(e.items[0].description).toBe('750 Gold Ring');
      expect(e.items[0].metal).toBe('gold');
      expect(e.items[0].weightGrams).toBe('4.2000');
      expect(e.payments[0].method).toBe('CASH');
      expect(e.payments[0].amountEur).toBe('500.00');
    });

    it('exports the register as CSV (?format=csv)', async () => {
      await seedAnkaufWithSeller();
      const res = await get(
        `/api/registers/an-verkaufsbuch?direction=ANKAUF&from=${regDay}&to=${regDay}&format=csv`,
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.payload).toContain('Goldverkäufer Schmidt');
      expect(res.payload).toContain('PERSONALAUSWEIS');
      expect(res.payload).toContain('750 Gold Ring');
    });

    it('das An- und Verkaufsbuch liest ein ADMIN ohne Gerätecode', async () => {
      // Basel, 05.08.2026: der Code steht vor Unwiderruflichem. Das Register
      // ist ein LESEN; die drei fiskalischen EXPORTE (DATEV, DSFinV-K,
      // Kassenbericht) verlangen ihn weiterhin, siehe die Prüfungen oben.
      const res = await get(
        `/api/registers/an-verkaufsbuch?direction=ANKAUF&from=${regDay}&to=${regDay}`,
        { token: adminNoStepUpToken },
      );
      expect(res.statusCode).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  A non-finalized (COUNTING) closing is NOT a legal export (B5)
  // ════════════════════════════════════════════════════════════════════════
  describe('COUNTING closing is not exportable (B5)', () => {
    it('all three legal export routes reject a COUNTING closing with 409 CONFLICT', async () => {
      // Insert INSIDE the test: the suite's beforeEach TRUNCATEs daily_closings.
      // A fresh, distinct business day so migration 0079's partial unique index
      // (one closing per NULL-shop day) does not collide with the seeded days.
      const [c] = await migratorSql<{ id: string }[]>`
        INSERT INTO daily_closings (business_day, state)
        VALUES ('2019-03-03'::date, 'COUNTING'::closing_state)
        RETURNING id`;
      const countingId = c!.id;

      for (const path of ['datev', 'kassenbericht', 'dsfinvk']) {
        const res = await get(`/api/closings/${countingId}/export/${path}`);
        expect(res.statusCode, `export/${path} should be 409`).toBe(409);
        expect((res.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  PRUEFERPAKET — POST /api/pruefer/paket (§ 146b AO, 18.08.2026)
  // ════════════════════════════════════════════════════════════════════════
  //
  // Der eine Knopf der Kassennachschau. Kernbehauptung: das Tages-ZIP IM
  // Paket ist BYTE FUER BYTE dasselbe wie der Einzelabruf — ein Erzeuger,
  // zwei Rufer (lib/dsfinvk-tag.ts). Dazu: Pruefbericht mit Kette und
  // Cent-Summen, LIESMICH mit ehrlichen Luecken, PDF-Durchreichung
  // unverfaelscht, Torwaechter wie beim Einzelabruf.

  describe('Prueferpaket', () => {
    /** readZip fuer BINAERE Eintraege: Bytes bleiben Bytes. */
    function readZipRoh(buf: Buffer): { name: string; roh: Buffer }[] {
      let eocd = -1;
      for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd === -1) throw new Error('readZipRoh: kein EOCD, kein ZIP');
      const total = buf.readUInt16LE(eocd + 10);
      let cd = buf.readUInt32LE(eocd + 16);
      const out: { name: string; roh: Buffer }[] = [];
      for (let n = 0; n < total; n++) {
        const method = buf.readUInt16LE(cd + 10);
        const compSize = buf.readUInt32LE(cd + 20);
        const nameLen = buf.readUInt16LE(cd + 28);
        const extraLen = buf.readUInt16LE(cd + 30);
        const commentLen = buf.readUInt16LE(cd + 32);
        const localOff = buf.readUInt32LE(cd + 42);
        const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);
        const lhNameLen = buf.readUInt16LE(localOff + 26);
        const lhExtraLen = buf.readUInt16LE(localOff + 28);
        const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
        const comp = buf.subarray(dataStart, dataStart + compSize);
        out.push({ name, roh: method === 8 ? inflateRawSync(comp) : Buffer.from(comp) });
        cd += 46 + nameLen + extraLen + commentLen;
      }
      return out;
    }

    async function paket(body: Record<string, unknown>, token?: string | null) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token !== null) {
        headers.cookie = `warehouse14.session=${token ?? adminStepUpToken}`;
      }
      headers['x-dev-device-fingerprint'] = deviceFingerprint;
      // `await` erzwingt die Promise-Form: `inject` ohne Rueckruf gibt eine
      // Chain zurueck, deren Vereinigungstyp der strenge Fiskal-Check abweist.
      return await app.inject({
        method: 'POST',
        url: '/api/pruefer/paket',
        headers,
        payload: JSON.stringify(body),
      });
    }

    it('rejects with 401 / 403 exactly like the single-day export', async () => {
      const zeitraum = { von: businessDay, bis: businessDay };
      expect((await paket(zeitraum, null)).statusCode).toBe(401);
      expect((await paket(zeitraum, cashierToken)).statusCode).toBe(403);
      expect((await paket(zeitraum, adminNoStepUpToken)).statusCode).toBe(403);
    });

    it('⛔ ein leerer Zeitraum antwortet 409, nicht mit einem leeren ZIP', async () => {
      const res = await paket({ von: '2031-01-01', bis: '2031-01-02' });
      expect(res.statusCode).toBe(409);
    });

    it('⛔ EIN Knopf: Tages-ZIP byte-gleich zum Einzelabruf, Bericht, LIESMICH, PDF', async () => {
      // Eine erkennbare, NICHT-utf8-sichere Bytefolge als PDF-Attrappe: wer
      // sie durch einen Textpfad zieht, zerstoert sie messbar.
      /*
       * Ein PDF, das die Pruefung von 0.7.1 besteht: echte %PDF-Signatur,
       * ueber 1 KB — und mit Bytes gespickt, die KEIN Textpfad ueberlebt
       * (0x00, 0xff, 0x80). Genau darum geht es: das Paket muss die Datei
       * binaer durchreichen.
       */
      const pdf = Buffer.concat([
        Buffer.from('%PDF-1.7\n', 'latin1'),
        Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x0a, 0x80]),
        Buffer.alloc(2048, 0xab),
        Buffer.from('\n%%EOF\n', 'latin1'),
      ]);
      const res = await paket({
        von: businessDay,
        bis: businessDay,
        verfahrensdokuPdfBase64: pdf.toString('base64'),
      });
      expect(res.statusCode, res.body).toBe(200);
      const j = res.json() as {
        ok: boolean;
        dateiname: string;
        zipBase64: string;
        tage: number;
        ketteUnversehrt: boolean;
      };
      expect(j.ok).toBe(true);
      expect(j.tage).toBe(1);
      expect(j.dateiname).toBe(`Kassennachschau_${businessDay}_${businessDay}.zip`);
      // ⚠️ KEINE Behauptung, die Kette sei heil: diese Buehne saet ihre
      // Belege direkt ueber die Migratorrolle (Kopf der Datei), also OHNE
      // die Kettenschreiber des lebenden Wegs — verify_ledger_chain findet
      // hier zu Recht Brueche. Gemessen wird die EHRLICHKEIT des Berichts:
      // Flagge und Text muessen dasselbe sagen, unten gegen PRUEFBERICHT.txt.

      const eintraege = readZipRoh(Buffer.from(j.zipBase64, 'base64'));
      const namen = eintraege.map((e) => e.name).sort();
      expect(namen).toEqual(
        [
          `DSFinV-K/DSFinV-K_${businessDay}.zip`,
          'LIESMICH.txt',
          'PRUEFBERICHT.txt',
          'Verfahrensdokumentation.pdf',
        ].sort(),
      );

      // ⛔ Kernbehauptung: byte-gleich zum Einzelabruf desselben Tages.
      const einzeln = await get(`/api/closings/${closingId}/export/dsfinvk`);
      expect(einzeln.statusCode).toBe(200);
      const imPaket = eintraege.find((e) => e.name.endsWith('.zip'))!.roh;
      expect(imPaket.equals(einzeln.rawPayload)).toBe(true);

      // ⛔ Das PDF kam UNVERAENDERT durch (0x00/0xff/0x80 ueberleben nur binaer).
      const pdfImPaket = eintraege.find((e) => e.name === 'Verfahrensdokumentation.pdf')!.roh;
      expect(pdfImPaket.equals(pdf)).toBe(true);

      // Der Bericht traegt Kette, Tag und Cent-Summen aus den Abschlusszeilen.
      const bericht = eintraege.find((e) => e.name === 'PRUEFBERICHT.txt')!.roh.toString('utf8');
      expect(bericht).toContain(j.ketteUnversehrt ? 'Ergebnis: UNVERSEHRT' : 'Ergebnis: GEBROCHEN');
      expect(bericht).toContain(businessDay);
      expect(bericht).toContain('SUMME');
      // Und LIESMICH benennt die ehrliche Luecke statt sie zu verstecken.
      const liesmich = eintraege.find((e) => e.name === 'LIESMICH.txt')!.roh.toString('utf8');
      expect(liesmich).toContain('TSE-Export (TAR)');
      expect(liesmich).toContain('fiskaly');
    });

    it('ohne mitgeschicktes PDF benennt LIESMICH das Fehlen', async () => {
      const res = await paket({ von: businessDay, bis: businessDay });
      expect(res.statusCode).toBe(200);
      const j = res.json() as { zipBase64: string };
      const eintraege = readZipRoh(Buffer.from(j.zipBase64, 'base64'));
      expect(eintraege.some((e) => e.name === 'Verfahrensdokumentation.pdf')).toBe(false);
      const liesmich = eintraege.find((e) => e.name === 'LIESMICH.txt')!.roh.toString('utf8');
      expect(liesmich).toContain('FEHLT in diesem Paket');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  FREMDBELEGE — GET /api/expenses/export/datev (18.08.2026)
  // ════════════════════════════════════════════════════════════════════════
  //
  // Unbare Ausgaben (Bank, Karte) als eigener EXTF-Stapel. BAR fliesst seit
  // dem 05.08. in den Tagesstapel; hier geht es um die Rechnungen, die bis
  // heute in KEINEM Export standen.

  describe('Fremdbelege-Export', () => {
    function fremdbelege(qs: string, token?: string | null) {
      const headers: Record<string, string> = {};
      if (token !== null) {
        headers.cookie = `warehouse14.session=${token ?? adminStepUpToken}`;
      }
      headers['x-dev-device-fingerprint'] = deviceFingerprint;
      return app.inject({ method: 'GET', url: `/api/expenses/export/datev?${qs}`, headers });
    }

    it('rejects 401 / 403 wie die uebrigen Steuer-Exporte', async () => {
      const qs = `von=${businessDay}&bis=${businessDay}`;
      expect((await fremdbelege(qs, null)).statusCode).toBe(401);
      expect((await fremdbelege(qs, cashierToken)).statusCode).toBe(403);
      expect((await fremdbelege(qs, adminNoStepUpToken)).statusCode).toBe(403);
    });

    /*
     * ⚠️ 19.08.2026: diese Saat lief frueher auf den FINALISIERTEN Stichtag.
     * Seit Wanderung 0144 weist der Abschluss-Waechter das zu Recht ab (der
     * Kassenbericht dieses Tages wuerde sich sonst rueckwirkend aendern).
     * Gesaet wird deshalb auf einen OFFENEN Tag, und der Export fragt genau
     * diesen ab — die Sache, die hier geprueft wird, aendert sich dadurch
     * nicht.
     */
    const offenerTag = '2026-05-06';

    it('⛔ Bank und Karte werden gebucht, BAR bleibt seinem Kassentag', async () => {
      // Drei Ausgaben am Stichtag: BANK, KARTE, BAR. Nur die ersten beiden
      // gehoeren in DIESEN Stapel.
      await migratorSql.unsafe(`
        INSERT INTO operating_expenses (business_day, category, amount_cents, zahlweg, note, created_by_user_id)
        VALUES ('${offenerTag}', 'MIETE',    120000, 'BANK',  'Ladenmiete August', '${adminUserId}'),
               ('${offenerTag}', 'VERSAND',    1999, 'KARTE', 'Paket',             '${adminUserId}'),
               ('${offenerTag}', 'SONSTIGES',  5000, 'BAR',   'Reinigung',         '${adminUserId}')`);

      const res = await fremdbelege(`von=${offenerTag}&bis=${offenerTag}`);
      expect(res.statusCode, res.body).toBe(200);
      // Windows-1252 vom Server; fuer die Pruefungen reicht latin1-Sicht.
      const csv = Buffer.from(res.rawPayload).toString('latin1');

      // Kopf ist ein EXTF-Stapel, Name kommt aus dem Vertragsschema.
      expect(csv.startsWith('"EXTF"')).toBe(true);
      expect(res.headers['content-disposition']).toContain('EXTF_');

      // Miete 1.200,00 gegen Bank; Versand 19,99 gegen Bank. SKR03-Vorlage:
      // Bank 1200, Miete 4210, Porto 4910 (kontenrahmen.ts, vom Inhaber
      // ueberschreibbar; die Buehne hat nichts ueberschrieben).
      expect(csv).toContain('1200,00');
      expect(csv).toContain('19,99');
      expect(csv).toContain('Ladenmiete August');
      expect(csv).toContain('(Bank)');
      expect(csv).toContain('(Karte)');
      // Die BAR-Zeile gehoert NICHT hierher.
      expect(csv).not.toContain('Reinigung');

      // Aufraeumen, damit die uebrigen Faelle dieselbe Buehne vorfinden.
      await migratorSql.unsafe(
        `DELETE FROM operating_expenses WHERE business_day = '${offenerTag}'`,
      );
    });

    it('⛔ eine Altzeile ohne Zahlweg sperrt die Datei mit deutschem Satz', async () => {
      await migratorSql.unsafe(`
        INSERT INTO operating_expenses (business_day, category, amount_cents, zahlweg, note, created_by_user_id)
        VALUES ('${offenerTag}', 'MIETE', 100000, 'BANK',      null, '${adminUserId}'),
               ('${offenerTag}', 'GEBUEHREN', 500, 'UNBEKANNT', null, '${adminUserId}')`);
      const res = await fremdbelege(`von=${offenerTag}&bis=${offenerTag}`);
      expect(res.statusCode).toBe(409);
      expect(res.body).toContain('keinen Zahlweg');
      await migratorSql.unsafe(
        `DELETE FROM operating_expenses WHERE business_day = '${offenerTag}'`,
      );
    });

    it('ein leerer Zeitraum antwortet 409, nicht mit leerer Datei', async () => {
      const res = await fremdbelege('von=2031-01-01&bis=2031-01-02');
      expect(res.statusCode).toBe(409);
      expect(res.body).toContain('keine unbare Ausgabe');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  0143 — Die Seriennummer erreicht den Artikeltext der Ausfuhr
  // ════════════════════════════════════════════════════════════════════════

  describe('Seriennummer im DSFinV-K-Artikeltext (0143)', () => {
    it('⛔ eine gesetzte Nummer steht im Bon des Tages, eine fehlende erfindet nichts', async () => {
      // Ein beliebiges verkauftes Produkt des Stichtags bekommt die Nummer.
      const [reihe] = await migratorSql.unsafe(
        `UPDATE products SET seriennummer = 'R-88231-X'
          WHERE id = (SELECT product_id FROM transaction_items LIMIT 1)
          RETURNING id`,
      );
      expect(reihe).toBeDefined();

      const res = await get(`/api/closings/${closingId}/export/dsfinvk`);
      expect(res.statusCode).toBe(200);
      const dateien = readZip(Buffer.from(res.rawPayload));
      const zeilen = dateien.find((f) => f.name === 'lines.csv');
      expect(zeilen, 'lines.csv fehlt im Buendel').toBeDefined();
      expect(zeilen!.content).toContain('Ser.-Nr. R-88231-X');

      // Zuruecksetzen: die uebrigen Faelle messen den Stand ohne Nummer.
      await migratorSql.unsafe(`UPDATE products SET seriennummer = NULL`);
      const danach = await get(`/api/closings/${closingId}/export/dsfinvk`);
      const ohne = readZip(Buffer.from(danach.rawPayload)).find((f) => f.name === 'lines.csv');
      expect(ohne!.content).not.toContain('Ser.-Nr.');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  /api/transactions/suche — die Rueckgabe findet ihren Beleg (19.08.2026)
  // ════════════════════════════════════════════════════════════════════════
  //
  // Drei Menschen am Tresen: mit Bon (Belegkennung), ohne Bon aber mit dem
  // Stueck (Seriennummer/Gravur), oder mit dem Etikett (Artikelnummer). Der
  // 24-Stunden-Blick von /recent liess jeden aelteren Beleg unauffindbar.
  describe('GET /api/transactions/suche — den Verkauf wiederfinden', () => {
    it('findet den Beleg ueber die Belegkennung, egal wie alt', async () => {
      const res = await get(`/api/transactions/suche?locator=${rcpStandard}`);
      expect(res.statusCode).toBe(200);
      const { items } = res.json() as { items: Array<Record<string, unknown>> };
      expect(items).toHaveLength(1);
      expect(items[0]!.receiptLocator).toBe(rcpStandard);
      expect(items[0]!.gefundenUeber).toBe('BELEGKENNUNG');
      expect(items[0]!.direction).toBe('VERKAUF');
    });

    it('findet den Verkauf ueber die Seriennummer des Stuecks — der Kunde ohne Bon', async () => {
      await migratorSql.unsafe(
        `UPDATE products SET seriennummer = 'SN-RETOUR-77'
          WHERE id = (SELECT ti.product_id FROM transaction_items ti
                       JOIN transactions t ON t.id = ti.transaction_id
                      WHERE t.receipt_locator = '${rcpStandard}' LIMIT 1)`,
      );
      const res = await get('/api/transactions/suche?seriennummer=SN-RETOUR-77');
      expect(res.statusCode).toBe(200);
      const { items } = res.json() as { items: Array<Record<string, unknown>> };
      // Die ganze GESCHICHTE des Stuecks, neueste zuerst: dieses Stueck ist
      // verkauft UND storniert — beide Belege gehoeren auf den Tresen, sonst
      // stornierte die Kassiererin einen bereits stornierten Verkauf.
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((r) => r.receiptLocator === rcpStandard)).toBe(true);
      expect(items[0]!.gefundenUeber).toBe('SERIENNUMMER');
      expect(typeof items[0]!.stueckName).toBe('string');
      const original = items.find((r) => r.receiptLocator === rcpStandard)!;
      expect(original.alreadyStornoed).toBe(true);
      await migratorSql.unsafe(`UPDATE products SET seriennummer = NULL`);
    });

    it('findet ueber die GRAVUR und sagt ehrlich, worueber', async () => {
      await migratorSql.unsafe(
        `UPDATE products SET gravur = 'Fuer Anna 1987'
          WHERE id = (SELECT ti.product_id FROM transaction_items ti
                       JOIN transactions t ON t.id = ti.transaction_id
                      WHERE t.receipt_locator = '${rcpStandard}' LIMIT 1)`,
      );
      const res = await get(
        `/api/transactions/suche?seriennummer=${encodeURIComponent('Fuer Anna 1987')}`,
      );
      const { items } = res.json() as { items: Array<Record<string, unknown>> };
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]!.gefundenUeber).toBe('GRAVUR');
      await migratorSql.unsafe(`UPDATE products SET gravur = NULL`);
    });

    it('verlangt GENAU einen Suchweg', async () => {
      expect((await get('/api/transactions/suche')).statusCode).toBe(400);
      expect(
        (await get(`/api/transactions/suche?locator=${rcpStandard}&seriennummer=X1`)).statusCode,
      ).toBe(400);
    });

    it('ein unbekannter Beleg gibt eine LEERE Liste, keinen Fehler', async () => {
      const res = await get('/api/transactions/suche?locator=RCP-1999-000001');
      expect(res.statusCode).toBe(200);
      expect((res.json() as { items: unknown[] }).items).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  Die WARENRÜCKNAHME (0148) — ein Ring von dreien kommt zurueck
  // ════════════════════════════════════════════════════════════════════════
  //
  // DSFinV-K Tz. 4.2.5: ein NEUER Beleg mit negativen Betraegen, BON_STORNO
  // bleibt 0, Referenz auf das Original. § 17 Abs. 1 Satz 8 UStG: die
  // Minderung faellt in die LAUFENDE Periode.
  describe('POST /api/transactions/rueckgabe — die Teilrueckgabe', () => {
    let originalId = '';
    let ringId = '';
    let ketteId = '';
    let margenStueckId = '';

    // ⚠️ beforeEach, NICHT beforeAll: der aeussere beforeEach TRUNCATED die
    // Fiskaltabellen vor JEDEM Test. Ein einmaliges Saeen waere nach dem
    // ersten Test wieder weg — genau daran ist der erste Wurf gescheitert
    // (404 auf einen Beleg, der beim Saeen wirklich existierte).
    beforeEach(async () => {
      const [dev] = await migratorSql<{ id: string }[]>`SELECT id FROM devices LIMIT 1`;
      const [adm] = await migratorSql<{ id: string }[]>`
        SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1`;
      const geraetId = dev!.id;
      const adminId = adm!.id;
      // Eine OFFENE Schicht fuer HEUTE — die Barauszahlung braucht sie.
      await migratorSql`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status, opened_at)
        VALUES (${geraetId}, ${adminId}, '200.00', 'OPEN'::shift_status, now())`;

      // Ein Verkauf von HEUTE mit drei Positionen: zwei regelbesteuert,
      // eine differenzbesteuert (die gesperrte Klasse).
      ringId = await seedProduct();
      ketteId = await seedProduct();
      margenStueckId = await seedProduct();
      await migratorSql`UPDATE products SET status = 'SOLD'::product_status, sold_at = now()
        WHERE id IN (${ringId}::uuid, ${ketteId}::uuid, ${margenStueckId}::uuid)`;
      const heute = new Date().toISOString();
      const beleg = await seedTransaction({
        direction: 'VERKAUF',
        treatment: 'MIXED',
        subtotal: '285.55',
        vat: '33.45',
        total: '319.00',
        customerId: null,
        finalizedAt: heute,
        items: [
          { productId: ringId, treatment: 'STANDARD_19', vatRate: '0.1900',
            lineSubtotal: '100.00', lineVat: '19.00', lineTotal: '119.00', displayOrder: 0 },
          { productId: ketteId, treatment: 'STANDARD_19', vatRate: '0.1900',
            lineSubtotal: '84.03', lineVat: '15.97', lineTotal: '100.00', displayOrder: 1 },
          { productId: margenStueckId, treatment: 'MARGIN_25A', vatRate: null,
            lineSubtotal: '101.52', lineVat: '-1.52', lineTotal: '100.00',
            acquisition: '90.00', margin: '10.00', displayOrder: 2 },
        ],
        payment: { method: 'CASH', amount: '319.00' },
        tse: false,
      });
      originalId = beleg.id;
    });

    function rueckgabe(body: Record<string, unknown>) {
      return app.inject({
        method: 'POST',
        url: '/api/transactions/rueckgabe',
        headers: {
          cookie: `warehouse14.session=${adminStepUpToken}`,
          'x-dev-device-fingerprint': deviceFingerprint,
        },
        payload: body,
      });
    }

    /*
     * ── DIE ERSTATTUNG GEHT DEN WEG ZURUECK, DEN DAS GELD KAM ──────────────
     *
     * ⚠️ DER BEFUND VOM 20.08.2026: die Route buchte JEDE Rueckgabe als
     * Barauszahlung. Bei einem Kartenkunden, der sein Geld auf die Karte
     * zurueckbekommt, verlaesst KEIN Bargeld die Lade — die Kasse zog es
     * trotzdem vom erwarteten Bestand ab. Der Kassensturz ging um genau
     * diesen Betrag daneben, und die TSE bezeugte eine Barbewegung, die es
     * nie gab.
     */
    describe('die Erstattung folgt der Zahlart des Originals', () => {
      /** Denselben Beleg noch einmal, aber mit KARTE bezahlt. */
      async function kartenBeleg(): Promise<string> {
        const pid = await seedProduct();
        await migratorSql`UPDATE products SET status = 'SOLD'::product_status, sold_at = now()
          WHERE id = ${pid}::uuid`;
        const beleg = await seedTransaction({
          direction: 'VERKAUF',
          treatment: 'STANDARD_19',
          subtotal: '100.00',
          vat: '19.00',
          total: '119.00',
          customerId: null,
          finalizedAt: new Date().toISOString(),
          items: [
            { productId: pid, treatment: 'STANDARD_19', vatRate: '0.1900',
              lineSubtotal: '100.00', lineVat: '19.00', lineTotal: '119.00', displayOrder: 0 },
          ],
          payment: { method: 'ZVT_CARD', amount: '119.00' },
          tse: false,
        });
        return `${beleg.id}|${pid}`;
      }

      it('⛔ ein KARTEN-Beleg wird auf die Karte erstattet, nicht aus der Lade', async () => {
        const [belegId, pid] = (await kartenBeleg()).split('|');
        const res = await rueckgabe({
          originalTransactionId: belegId,
          productIds: [pid],
          reason: 'Kunde hat es sich anders ueberlegt',
        });
        expect(res.statusCode, res.body).toBe(200);
        const body = res.json() as { id: string; erstattungsart: string; zahlartTse: string };
        // Ohne Angabe gilt die Zahlart des Originals.
        expect(body.erstattungsart).toBe('KARTE');
        // Und die SIGNATUR bezeugt keine Barbewegung.
        expect(body.zahlartTse).toBe('NON_CASH');

        // Die gebuchte Zahlung traegt die Art des Originals, nicht pauschal Bar.
        const [zahlung] = await migratorSql<{ method: string; amount: string }[]>`
          SELECT payment_method AS method, amount_eur AS amount
            FROM transaction_payments WHERE transaction_id = ${body.id}::uuid`;
        expect(zahlung!.method).toBe('ZVT_CARD');
        expect(Number(zahlung!.amount)).toBeLessThan(0);
      });

      it('ein BAR-Beleg bleibt bar — der alte Weg ist unveraendert', async () => {
        const res = await rueckgabe({
          originalTransactionId: originalId,
          productIds: [ringId],
          reason: 'Ring passt nicht',
        });
        expect(res.statusCode, res.body).toBe(200);
        const body = res.json() as { id: string; erstattungsart: string; zahlartTse: string };
        expect(body.erstattungsart).toBe('BAR');
        expect(body.zahlartTse).toBe('CASH');
        const [zahlung] = await migratorSql<{ method: string }[]>`
          SELECT payment_method AS method FROM transaction_payments
           WHERE transaction_id = ${body.id}::uuid`;
        expect(zahlung!.method).toBe('CASH');
      });

      it('⛔ eine Kartenerstattung auf einen BAR-Beleg wird abgewiesen', async () => {
        // Es gibt dort keine Karte, auf die man gutschreiben koennte.
        const res = await rueckgabe({
          originalTransactionId: originalId,
          productIds: [ringId],
          reason: 'Versuch, auf eine nicht vorhandene Karte zu erstatten',
          erstattungsart: 'KARTE',
        });
        expect(res.statusCode, res.body).toBe(422);
        expect(res.body).toContain('bar bezahlt');
      });

      it('der Tresen darf einen Kartenbeleg ausdruecklich BAR erstatten (Kulanz)', async () => {
        const [belegId, pid] = (await kartenBeleg()).split('|');
        const res = await rueckgabe({
          originalTransactionId: belegId,
          productIds: [pid],
          reason: 'Kunde wuenscht ausdruecklich Bargeld',
          erstattungsart: 'BAR',
        });
        expect(res.statusCode, res.body).toBe(200);
        const body = res.json() as { erstattungsart: string; zahlartTse: string };
        expect(body.erstattungsart).toBe('BAR');
        expect(body.zahlartTse).toBe('CASH');
      });
    });

    it('die Positionen nennen den Rueckgabe-Stand und die § 25a-Sperre', async () => {
      const res = await get(`/api/transactions/${originalId}/positionen`);
      expect(res.statusCode).toBe(200);
      const { positionen } = res.json() as {
        positionen: Array<{ productId: string; bereitsZurueck: boolean; nurUeberAnkauf: boolean }>;
      };
      expect(positionen).toHaveLength(3);
      expect(positionen.every((p) => !p.bereitsZurueck)).toBe(true);
      expect(positionen.find((p) => p.productId === margenStueckId)?.nurUeberAnkauf).toBe(true);
      expect(positionen.find((p) => p.productId === ringId)?.nurUeberAnkauf).toBe(false);
    });

    it('nimmt EINEN Ring zurueck: negativer Beleg, Stueck wieder im Bestand', async () => {
      const res = await rueckgabe({
        originalTransactionId: originalId,
        productIds: [ringId],
        reason: 'Kulanz, Kunde mit Bon',
        erfasstAm: new Date().toISOString(),
      });
      expect(res.statusCode, res.payload).toBe(200);
      const out = res.json() as { totalEur: string; receiptLocator: string; zahlartTse: string };
      expect(out.totalEur).toBe('-119.00');
      expect(out.zahlartTse).toBe('CASH');

      // Der Beleg: negativ, KEIN Storno-Bit, Referenz auf das Original.
      const [zeile] = await migratorSql<
        { total_eur: string; storno_of_transaction_id: string | null; rueckgabe_zu_transaction_id: string | null }[]
      >`SELECT total_eur::text, storno_of_transaction_id, rueckgabe_zu_transaction_id
          FROM transactions WHERE receipt_locator = ${out.receiptLocator}`;
      expect(zeile!.total_eur).toBe('-119.00');
      expect(zeile!.storno_of_transaction_id).toBeNull();
      expect(zeile!.rueckgabe_zu_transaction_id).toBe(originalId);

      // Das Stueck LIEGT wieder im Laden.
      const [p] = await migratorSql<{ status: string }[]>`
        SELECT status::text FROM products WHERE id = ${ringId}::uuid`;
      expect(p!.status).toBe('AVAILABLE');
    });

    it('derselbe Ring geht kein zweites Mal — und der Stand sagt es', async () => {
      // Erst die ERSTE Rueckgabe (jeder Test beginnt frisch — beforeEach).
      const erste = await rueckgabe({
        originalTransactionId: originalId,
        productIds: [ringId],
        reason: 'Kulanz, Kunde mit Bon',
      });
      expect(erste.statusCode, erste.payload).toBe(200);

      const wieder = await rueckgabe({
        originalTransactionId: originalId,
        productIds: [ringId],
        reason: 'Versuch der Doppelrueckgabe',
      });
      expect(wieder.statusCode).toBe(409);

      const res = await get(`/api/transactions/${originalId}/positionen`);
      const { positionen } = res.json() as {
        positionen: Array<{ productId: string; bereitsZurueck: boolean }>;
      };
      expect(positionen.find((p) => p.productId === ringId)?.bereitsZurueck).toBe(true);
      expect(positionen.find((p) => p.productId === ketteId)?.bereitsZurueck).toBe(false);
    });

    it('§ 25a-Stuecke verweist sie an den Ankauf, mit Grund', async () => {
      const res = await rueckgabe({
        originalTransactionId: originalId,
        productIds: [margenStueckId],
        reason: 'Kunde bringt Margenware',
      });
      expect(res.statusCode).toBe(422);
      expect(res.payload).toContain('ANKAUF');
    });

    it('ab 2.000 EUR bar nur mit ausweisverifiziertem Kunden (GwG)', async () => {
      const teuerId = await seedProduct();
      await migratorSql`UPDATE products SET status = 'SOLD'::product_status, sold_at = now() WHERE id = ${teuerId}::uuid`;
      const kunde = await migratorSql<{ id: string }[]>`
        INSERT INTO customers (customer_number, full_name_encrypted, retention_until,
                               kyc_status, kyc_verified_at, kyc_verified_by_user_id,
                               kyc_completed_at, kyc_expires_at)
        SELECT 'CUST-2026-909090', full_name_encrypted, retention_until,
               'VERIFIED'::kyc_status, now(),
               (SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1),
               now(), now() + interval '2 years'
          FROM customers LIMIT 1
        RETURNING id`;
      const grosser = await seedTransaction({
        direction: 'VERKAUF', treatment: 'STANDARD_19',
        subtotal: '2100.84', vat: '399.16', total: '2500.00',
        customerId: kunde[0]!.id, finalizedAt: new Date().toISOString(),
        items: [{ productId: teuerId, treatment: 'STANDARD_19', vatRate: '0.1900',
          lineSubtotal: '2100.84', lineVat: '399.16', lineTotal: '2500.00', displayOrder: 0 }],
        payment: { method: 'CASH', amount: '2500.00' }, tse: false,
      });
      const ohneKunde = await rueckgabe({
        originalTransactionId: grosser.id, productIds: [teuerId], reason: 'GwG-Probe',
      });
      expect(ohneKunde.statusCode).toBe(422);
      expect(ohneKunde.payload).toContain('GwG');

      const mitKunde = await rueckgabe({
        originalTransactionId: grosser.id, productIds: [teuerId],
        reason: 'GwG-Probe mit Ausweis', customerId: kunde[0]!.id,
      });
      expect(mitKunde.statusCode, mitKunde.payload).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  0144 — Ausgaben eines festgeschriebenen Tages stehen fest
  // ════════════════════════════════════════════════════════════════════════

  describe('Abschluss-Waechter auf Betriebsausgaben (19.08.2026)', () => {
    it('⛔ eine Ausgabe auf einem FINALISIERTEN Tag wird abgewiesen', async () => {
      // Der Stichtag dieser Buehne ist finalisiert (der ganze Satz baut
      // darauf). Eine Ausgabe dorthin wuerde Kassenbericht UND DATEV-Stapel
      // dieses Tages rueckwirkend aendern.
      await expect(
        migratorSql.unsafe(`
          INSERT INTO operating_expenses (business_day, category, amount_cents, zahlweg, created_by_user_id)
          VALUES ('${businessDay}', 'MIETE', 5000, 'BAR', '${adminUserId}')`),
      ).rejects.toThrow(/festgeschrieben/);
    });

    it('⛔ eine bestehende Ausgabe laesst sich nicht AUF einen abgeschlossenen Tag schieben', async () => {
      // Auf einem offenen Tag anlegen (der Waechter laesst das durch) ...
      const [zeile] = await migratorSql<{ id: string }[]>`
        INSERT INTO operating_expenses (business_day, category, amount_cents, zahlweg, created_by_user_id)
        VALUES ('2031-03-03', 'MIETE', 5000, 'BAR', ${adminUserId})
        RETURNING id`;
      expect(zeile).toBeDefined();
      // ... und dann auf den abgeschlossenen schieben: das ist der Angriff.
      await expect(
        migratorSql.unsafe(`
          UPDATE operating_expenses SET business_day = '${businessDay}' WHERE id = '${zeile!.id}'`),
      ).rejects.toThrow(/festgeschrieben/);
      await migratorSql`DELETE FROM operating_expenses WHERE id = ${zeile!.id}`;
    });
  });
});
