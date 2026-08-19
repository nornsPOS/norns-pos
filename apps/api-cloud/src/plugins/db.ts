/**
 * DB plugin — exposes the typed Drizzle client + raw postgres-js Sql tag on
 * the Fastify instance, plus a factory for dedicated long-lived connections
 * used by SSE subscribers (`LISTEN warehouse14_ledger`).
 *
 * Three surfaces:
 *   • `app.db`  — Drizzle ORM (pooled). Default for business logic.
 *   • `app.sql` — pooled postgres-js Sql tag. For raw SQL convenience.
 *   • `app.openDedicatedConnection()` — fresh single-connection postgres-js
 *     instance, NOT part of the pool. The SSE route owns one per subscriber
 *     for the duration of the stream, and MUST call `.end()` on disconnect
 *     to avoid connection leaks (Basel directive Day 14 §1).
 *
 * Lifecycle:
 *   • Opened at boot. A `SELECT 1` smoke-test runs synchronously so the
 *     server fails fast if the DB is unreachable.
 *   • Closed on `app.close()` (called by close-with-grace on SIGTERM).
 *
 * Tests provide a dbOverride that bypasses pool construction. They MAY also
 * provide a `dedicatedConnectionFactory` to point LISTEN connections at the
 * testcontainer; if omitted, the override is itself reused (which is fine
 * for tests that don't exercise SSE).
 */

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import postgres, { type Sql } from 'postgres';

import { type AppDb, connectApp } from '@norns/db/client';

import type { Env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle ORM client bound to schema, `warehouse14_app` role. Pooled. */
    db: AppDb;
    /** Underlying postgres-js Sql tag — use for LISTEN/NOTIFY + raw SQL. Pooled. */
    sql: Sql;
    /**
     * Factory for a fresh dedicated postgres-js connection — NOT pooled. The
     * caller MUST `.end()` it when done. Used by SSE LISTEN subscribers,
     * each of which needs its own session.
     */
    openDedicatedConnection: () => Sql;
  }
}

export interface DbPluginOpts {
  env: Env;
  /**
   * Override the constructed clients (integration tests inject a testcontainer-
   * backed pair). When provided, the plugin does NOT open its own connection
   * and does NOT close the override on app.close — the test owns its lifecycle.
   *
   * If `dedicatedConnectionFactory` is provided, it is used for SSE LISTEN
   * connections; otherwise the SSE route uses `env.DATABASE_URL` (which test
   * code can set to the testcontainer URL).
   */
  override?: {
    db: AppDb;
    sql: Sql;
    dedicatedConnectionFactory?: () => Sql;
  };
}

const dbPlugin: FastifyPluginAsync<DbPluginOpts> = async (app, opts) => {
  // Resolve the dedicated-connection factory exactly once at boot.
  // Production / dev: open a fresh per-subscriber connection from env.DATABASE_URL.
  // Test with explicit factory: use it.
  // Test without explicit factory: still use env.DATABASE_URL (must be set).
  const dedicatedFactory: () => Sql =
    opts.override?.dedicatedConnectionFactory ??
    (() =>
      // ⚠️ AM VERBINDUNGSVERTEILER VORBEI, SONST KOMMT KEINE MELDUNG AN.
      //
      // `LISTEN` bindet das Abonnement an die SITZUNG. PgBouncer im
      // Transaktionsmodus gibt die Serververbindung nach jedem Befehl weiter:
      // das LISTEN wird angenommen, quittiert, und danach kommt NIE eine
      // Meldung. Kein Fehler, keine Ausnahme, nur Stille.
      //
      // Im Labor sauber isoliert: direkt 2 von 2 empfangen, über den Verteiler
      // 0 von 2, nach Umstellung auf Sitzungsmodus wieder 2 von 2. Das
      // Protokoll des Verteilers auf der Produktion zeigt dazu
      // „got packet 'A' from server when not linked" — das sind verworfene
      // Tagebuch-Meldungen.
      //
      // Dieselbe Wurzel hat den Worker vier von fünf Takten verwerfen lassen
      // (siehe apps/worker/src/config/env.ts, LOCK_DATABASE_URL). Dort war es
      // eine Sitzungssperre, hier ein Sitzungsabonnement; beides überlebt den
      // Verteiler nicht.
      //
      // Leer heisst wie bisher: dann gibt es keinen Verteiler.
      postgres(opts.env.LISTEN_DATABASE_URL || opts.env.DATABASE_URL, {
        max: 1,
        // Critical: LISTEN connections cannot idle-timeout. The default 0 = never.
        idle_timeout: 0,
        connection: { application_name: 'warehouse14_api_cloud_sse' },
        // ⚠️ Kein stiller Schlucker mehr. Beim Worker hat genau dieser
        // Einzeiler die WARNUNG verschluckt, mit der Postgres den Ausfall im
        // Minutentakt gemeldet hat.
        onnotice: (n) => {
          app.log.warn(
            { severity: n.severity, message: n.message },
            'postgres notice auf der SSE-Verbindung',
          );
        },
      }));

  if (opts.override) {
    app.decorate('db', opts.override.db);
    app.decorate('sql', opts.override.sql);
    app.decorate('openDedicatedConnection', dedicatedFactory);
    return;
  }

  const { db, sql } = connectApp({
    url: opts.env.DATABASE_URL,
    max: opts.env.DB_POOL_MAX,
    applicationName: 'warehouse14_api_cloud',
  });

  // Smoke test — fail fast on boot if the DB role/URL is wrong.
  try {
    await sql`SELECT 1`;
  } catch (err) {
    app.log.error({ err }, 'db smoke test failed — refusing to start');
    await sql.end({ timeout: 1 }).catch(() => {});
    throw err;
  }

  app.decorate('db', db);
  app.decorate('sql', sql);
  app.decorate('openDedicatedConnection', dedicatedFactory);

  app.addHook('onClose', async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
  });
};

export default fastifyPlugin(dbPlugin, {
  name: 'warehouse14-db',
  fastify: '4.x',
});
