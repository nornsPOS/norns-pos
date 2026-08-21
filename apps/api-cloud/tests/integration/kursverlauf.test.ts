/**
 * ⛔ Der Kursverlauf trägt WIRKLICH sein Zeitfenster
 *
 * ── DER BEFUND VOM 21.08.2026 ─────────────────────────────────────────────
 *
 * Das Terminal bot Fenster bis zu einem JAHR und holte 200 Zeilen; der
 * Server deckelte ebenso. Bei fünf Minuten Schreibtakt (Beiläufer, gemessen)
 * sind 200 Zeilen 16,7 Stunden — der Jahresknopf zeigte nicht einmal einen
 * Tag, und niemand sah es, weil eine Kurve immer wie eine Kurve aussieht.
 *
 * Diese Probe sät ein JAHR echter Fünfminutenzeilen und misst, was
 * herauskommt.
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { hashPin } from '@norns/auth-pin';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyAllMigrations } from './_migrate.js';
import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';
const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

describe('⛔ Der Kursverlauf', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;
  let fingerabdruck: string;
  let sitzung: string;

  /** Ein Jahr Fünfminutenzeilen — genau der Bestand, an dem der alte Weg scheiterte. */
  const JAHR_ZEILEN = (365 * 24 * 60) / 5; // 105 120

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test').withUsername('postgres').withPassword('postgres_test_pw')
      .withCopyContentToContainer([{ content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' }])
      .start();
    migratorSql = postgres({
      host: container.getHost(), port: container.getPort(), database: 'warehouse14_test',
      username: 'warehouse14_migrator', password: 'warehouse14_migrator_test_pw', max: 1, onnotice: () => {},
    });
    await applyAllMigrations(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);
    appSql = postgres({
      host: container.getHost(), port: container.getPort(), database: 'warehouse14_test',
      username: 'warehouse14_app', password: 'warehouse14_app_test_pw', max: 5, onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });
    app = await buildApp({
      env: {
        NODE_ENV: 'test', PORT: 0, LOG_LEVEL: 'error', DATABASE_URL: 'unused', DB_POOL_MAX: 5,
        NORNS_PII_KEY: PII_KEY, TRUSTED_ORIGINS: '', TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00',
        DURESS_ALARM_WEBHOOK_URL: '',
      } as unknown as Env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });

    // Ein Kassierer genügt: die Kurve gehört an den Tresen.
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, pos_pin_hash, pos_pin_set_at)
      VALUES (${`k-${randomUUID()}@x.test`}, 'Kassierer', 'CASHIER'::user_role, ${await hashPin('481902')}, now())
      RETURNING id`;
    fingerabdruck = randomUUID().replace(/-/g, '');
    const [g] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${fingerabdruck}, now() - interval '1 day', now() + interval '365 days', ${u!.id})
      RETURNING id`;
    sitzung = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${u!.id}, ${sitzung}, now() + interval '8 hours', ${g!.id}, now())`;

    /*
     * ⚠️ EIN JAHR ECHTER ZEILEN, per generate_series in EINEM Zug. Mit
     * 105 120 Einzeleinfügungen liefe die Probe minutenlang; mit weniger
     * Zeilen bewiese sie nichts, denn genau die Menge war das Problem.
     * Der Preis schwingt, damit Hoch und Tief nicht zufällig gleich sind.
     */
    await migratorSql.unsafe(`
      INSERT INTO metal_prices (metal, price_per_gram_eur, source, valid_from, valid_to, fetched_at)
      SELECT 'gold',
             -- ⚠️ Die Schwingung muss INNERHALB eines Tages Gipfel haben,
             -- sonst liegen Hoch und Tief zwangslaeufig an den Raendern und
             -- die Kerzenprobe kann nichts beweisen. Mein erster Wurf hatte
             -- sin(epoch/86400) mit Periode 2*pi Tage, also ueber einen Tag
             -- fast eine Gerade. Jetzt eine STUNDEN-Schwingung (viele Gipfel
             -- je Tag) plus eine langsame Jahreswelle fuer den Verlauf.
             (120
                + 8 * sin(2 * pi() * extract(epoch from t) / 3600.0)
                + 15 * sin(2 * pi() * extract(epoch from t) / (86400.0 * 90))
             )::numeric(18,4),
             -- Der Wert der Aufzaehlung, nicht der Name des Quellenwaehlers:
             -- GOLDPREIS_DE ist die WAHL im Beilaeufer, in der Datenbank steht
             -- SPOT_VENDOR (Wanderung 0129). Mein erster Wurf sagte den
             -- Waehlernamen, und Postgres wies ihn zu Recht ab.
             'SPOT_VENDOR',
             t,
             -- ⚠️ JEDE Zeile wird geschlossen. Der Riegel
             -- metal_prices_one_current_per_metal_uq laesst genau EINE offene
             -- Zeile je Metall zu; mein erster Wurf liess zwei offen (die
             -- Reihe endet auf now(), und die letzten beiden Punkte liegen
             -- beide innerhalb der fuenf Minuten). Der Kerzenweg liest
             -- valid_from, keine offene Zeile noetig.
             t + interval '5 minutes',
             t
      FROM generate_series(now() - interval '365 days', now(), interval '5 minutes') AS t
    `);
  }, 180_000);

  afterAll(async () => {
    await app.close().catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  const kopf = () => ({
    cookie: `warehouse14.session=${sitzung}`,
    'x-dev-device-fingerprint': fingerabdruck,
  });

  it('die Saat ist wirklich ein Jahr Fünfminutenzeilen', async () => {
    const [z] = await migratorSql<{ n: string }[]>`SELECT count(*)::text AS n FROM metal_prices`;
    expect(Number(z!.n)).toBeGreaterThan(JAHR_ZEILEN - 100);
  });

  it('⛔ der ALTE Weg zeigt von einem Jahr nur Stunden — der Befund', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/metal-prices/history?metal=gold&limit=200', headers: kopf(),
    });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { validFrom: string }[] }).items;
    expect(items.length).toBe(200);
    const spanneStunden =
      (Date.parse(items[0]!.validFrom) - Date.parse(items[items.length - 1]!.validFrom)) / 3_600_000;
    // 200 Zeilen à 5 Minuten = 16,7 Stunden. NICHT ein Jahr.
    expect(spanneStunden).toBeLessThan(24);
  });

  it('⛔ der neue Weg trägt das volle JAHR, in Tageskörnern', async () => {
    const von = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/api/metal-prices/verlauf?metal=gold&korn=tag&von=${encodeURIComponent(von)}`,
      headers: kopf(),
    });
    expect(res.statusCode, res.body).toBe(200);
    const kerzen = (res.json() as { kerzen: { t: string; n: number }[] }).kerzen;
    // Ein Jahr in Tagen — nicht 200 Zeilen.
    expect(kerzen.length).toBeGreaterThan(360);
    const spanneTage =
      (Date.parse(kerzen[kerzen.length - 1]!.t) - Date.parse(kerzen[0]!.t)) / 86_400_000;
    expect(spanneTage).toBeGreaterThan(360);
    // Jedes Tageskorn hat rund 288 Messpunkte (24 h / 5 min).
    const mitte = kerzen[Math.floor(kerzen.length / 2)]!;
    expect(mitte.n).toBeGreaterThan(250);
  });

  it('⛔ Hoch und Tief kommen aus ALLEN Punkten, nicht aus den Rändern', async () => {
    const von = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/api/metal-prices/verlauf?metal=gold&korn=tag&von=${encodeURIComponent(von)}`,
      headers: kopf(),
    });
    const kerzen = (res.json() as { kerzen: { o: string; h: string; l: string; c: string }[] }).kerzen;
    for (const k of kerzen) {
      const [o, h, l, c] = [k.o, k.h, k.l, k.c].map(Number);
      expect(h).toBeGreaterThanOrEqual(Math.max(o!, c!));
      expect(l).toBeLessThanOrEqual(Math.min(o!, c!));
    }
    /*
     * ⛔ DER SATZ, DER WIRKLICH TRAEGT (nachgeschaerft am 21.08.2026).
     *
     * Mein erster Wurf pruefte nur `h >= max(o,c)` und eine Spanne > 0,5.
     * Beides bleibt WAHR, wenn man die Kerze aus den Raendern baut
     * (h := max(o,c)) — der absichtliche Bruch rutschte durch. Ein
     * Waechter, der seinen eigenen Fehler nicht sieht, ist gruen und wertlos.
     *
     * Der Kurs schwingt ueber den Tag: sein Hoch liegt MITTEN im Tag, nicht
     * am Rand. Also MUSS es Koerner geben, deren Hoch ECHT ueber beiden
     * Raendern liegt — genau das kann eine Randkerze nie.
     */
    const mitEchtemHoch = kerzen.filter(
      (k) => Number(k.h) > Math.max(Number(k.o), Number(k.c)) + 0.01,
    );
    const mitEchtemTief = kerzen.filter(
      (k) => Number(k.l) < Math.min(Number(k.o), Number(k.c)) - 0.01,
    );
    expect(mitEchtemHoch.length, 'kein Korn hat ein Hoch ueber seinen Raendern').toBeGreaterThan(0);
    expect(mitEchtemTief.length, 'kein Korn hat ein Tief unter seinen Raendern').toBeGreaterThan(0);
  });

  it('⛔ ein unmögliches Korn wird ehrlich abgewiesen, statt die Kasse anzuhalten', async () => {
    // Ein Jahr in Fuenfminutenkoernern waeren 105 120 Zeilen.
    const von = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/api/metal-prices/verlauf?metal=gold&korn=5min&von=${encodeURIComponent(von)}`,
      headers: kopf(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('gröberes Korn');
  });

  it('das Feinkorn trägt den Tag, in dem es gebraucht wird', async () => {
    const von = new Date(Date.now() - 86_400_000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/api/metal-prices/verlauf?metal=gold&korn=5min&von=${encodeURIComponent(von)}`,
      headers: kopf(),
    });
    expect(res.statusCode, res.body).toBe(200);
    const kerzen = (res.json() as { kerzen: unknown[] }).kerzen;
    // 24 h / 5 min = 288 Koerner.
    expect(kerzen.length).toBeGreaterThan(280);
  });
});
