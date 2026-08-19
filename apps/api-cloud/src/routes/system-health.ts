/**
 * System-Health — the Owner's operations snapshot (the "Leitstand" surface).
 *
 *   GET /api/system/health   (Owner only)
 *
 * One CTE round-trip over the signals that already exist as first-class server
 * state — worker dead-letters, the chain-verifier heartbeat, TSE cert headroom,
 * and the `alert.*` ledger stream — plus a guarded read of the migration
 * tracker and an env-presence check for the outboard integrations (Fiskaly,
 * Stripe, R2, sanctions, metrics). It derives a per-component status and a
 * single top-line verdict, and it lists the genuinely-open problems (each with
 * the surface to open) rather than inventing severity.
 *
 * Deliberately server-side only. Offline/outbox conflicts live in each device's
 * local SQLite and never reach the cloud, so they are NOT counted here — the
 * Leitstand links to the Konfliktpostfach for those instead of faking a number.
 *
 * Modeled on `bridge.ts` (the ADMIN KPI snapshot): same Drizzle raw-SQL idiom,
 * same cents/camelCase-on-the-wire discipline, tighter to Owner.
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { judgeFiscalHealth } from '../lib/fiscal-health.js';
import { SCHLUESSEL_TSS_ID } from '../lib/kassenpflicht.js';
import { beurteileKette, kettenSatz } from '../lib/kettenpruefung.js';
import { requireOwner } from '../lib/auth-policy.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

const StatusU = Type.Union([Type.Literal('ok'), Type.Literal('watch'), Type.Literal('alert')]);
type ComponentStatus = Static<typeof StatusU>;

const Problem = Type.Object({
  id: Type.String(),
  severity: Type.Union([Type.Literal('watch'), Type.Literal('alert')]),
  title: Type.String(),
  detail: Type.String(),
  /** A surface path to open for this problem, or null when there is nowhere to go. */
  surface: Type.Union([Type.String(), Type.Null()]),
});
type TProblem = Static<typeof Problem>;

const Integration = Type.Object({
  key: Type.String(),
  label: Type.String(),
  configured: Type.Boolean(),
});

const SystemHealthResponse = Type.Object({
  status: StatusU,
  computedAt: Type.String({ format: 'date-time' }),
  components: Type.Object({
    api: Type.Object({ status: StatusU }),
    database: Type.Object({
      status: StatusU,
      migrationsApplied: Type.Union([Type.Integer(), Type.Null()]),
      latestMigration: Type.Union([Type.String(), Type.Null()]),
    }),
    worker: Type.Object({
      status: StatusU,
      deadLetter: Type.Integer(),
      oldestDeadLetterAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      running: Type.Integer(),
      chainLastVerifiedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    }),
    fiscal: Type.Object({
      status: StatusU,
      tseCertDaysRemaining: Type.Union([Type.Integer(), Type.Null()]),
      tseCertValidUntil: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    }),
    alerts: Type.Object({
      status: StatusU,
      last24h: Type.Integer(),
      last7d: Type.Integer(),
    }),
  }),
  integrations: Type.Array(Integration),
  problems: Type.Array(Problem),
});

export type TSystemHealthResponse = Static<typeof SystemHealthResponse>;

type HealthRow = {
  dlq_unacked: number;
  dlq_oldest: Date | null;
  jobs_running: number;
  chain_last_ok: Date | null;
  tse_days: number | null;
  tse_soonest: Date | null;
  tse_clients: number;
  /** Zeilen im Zertifikats-Wachbuch. 0 heisst: die Laufzeit wird nicht überwacht. */
  tse_wachbuch: number;
  tse_unsigned_7d: number;
  alerts_24h: number;
  alerts_7d: number;
};


const systemHealthRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.get(
    '/api/system/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Owner system-health snapshot: components, integrations, open problems.',
        description:
          'Worker dead-letters + chain heartbeat + TSE cert headroom + alert stream in one ' +
          'round-trip, plus migration version and integration presence. Owner only, read-only.',
        response: {
          200: SystemHealthResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireOwner(req);

      // One round-trip over the server-side health signals. Reaching this line
      // at all proves the DB answered, so `database.status` is derived as `ok`.
      const rows = (await app.db.execute<HealthRow>(drizzleSql`
        WITH
          dlq AS (
            SELECT COUNT(*)::int AS n, MIN(pushed_at) AS oldest
              FROM worker_job_dlq WHERE acked_at IS NULL
          ),
          running AS (
            SELECT COUNT(*)::int AS n FROM worker_job_runs WHERE status = 'RUNNING'
          ),
          chain AS (
            SELECT MAX(finished_at) AS t FROM worker_job_runs
             WHERE job_name = 'chain_verifier' AND status = 'SUCCESS'
          ),
          tse AS (
            -- ⛔ 08.08.2026 BERICHTIGT. Hier stand COUNT(*) FROM tse_clients.
            --
            -- tse_clients wird ausschliesslich vom Arbeiter-Auftrag
            -- apps/worker/src/jobs/tse-cert-checker.ts beschrieben, und der
            -- Arbeiter reist mit Norns POS NICHT mit. Auf einer ausgelieferten
            -- Kasse ist die Zahl deshalb fuer immer 0, judgeFiscalHealth nimmt
            -- sofort den Alarmzweig, und die Ampel kann NIE gruen werden --
            -- auch wenn die TSE sauber eingerichtet ist und jeder Beleg
            -- signiert wird.
            --
            -- Eine Lampe, die dauerhaft leuchtet, wird nach der zweiten Woche
            -- nicht mehr gelesen. Danach ist auch das echte Rot unsichtbar.
            --
            -- Jetzt dieselbe Quelle wie der Riegel im Verkauf
            -- (lib/kassenpflicht.ts, Konstante SCHLUESSEL_TSS_ID): EIN Ort
            -- fuer diese Entscheidung. transactions-finalize.ts hat dieselbe
            -- Berichtigung am 02.08.2026 bekommen, die Ampel blieb zurueck.
            --
            -- Das Zertifikatsfenster bleibt aus tse_clients -- es ist dort
            -- schlicht NULL, wenn niemand schreibt, und NULL heisst bei
            -- certDays ausdruecklich "unbekannt", nicht "abgelaufen".
            SELECT FLOOR(MIN(EXTRACT(EPOCH FROM (cert_valid_to - now()))) / 86400)::int AS days,
                   MIN(cert_valid_to) AS soonest,
                   (SELECT CASE
                             WHEN COALESCE(btrim(value #>> '{}'), '') = '' THEN 0
                             ELSE 1
                           END
                      FROM system_settings
                     WHERE key = ${SCHLUESSEL_TSS_ID})::int AS clients,
                   COUNT(*)::int AS wachbuch
              FROM tse_clients
          ),
          -- Ein eingerichteter Client allein beweist nichts. Erst ein SIGNIERTER
          -- Beleg beweist, dass die Kette bis zur Sicherungseinrichtung trägt.
          -- Bewusst auf die letzten sieben Tage begrenzt: ein Vollscan gehörte
          -- nicht in eine Zustandsabfrage, die im Minutentakt läuft.
          -- ⚠️ HIER STAND "tse_transactions", UND DAS WAR EINE TOTE TABELLE.
          --
          -- Am 08.08.2026 nachgemessen: "tse_transactions" steht im Bauplan,
          -- hat einen Ausloeser und Rechte, und NIEMAND schreibt jemals
          -- hinein. Kein einziges INSERT im ganzen Baum. Die echte Signatur
          -- landet in "tse_signatures" ("transactions-tse-signature.ts:157"),
          -- und genau die liest auch der Tagesabschluss.
          --
          -- Die Folge war NICHT, wie zuerst gemeldet, eine gruene Ampel:
          -- weil die Tabelle immer leer ist, war "NOT EXISTS" immer wahr und
          -- die Ampel zaehlte JEDEN Beleg der letzten sieben Tage als
          -- unsigniert. Sie stand also dauerhaft auf ROT, auch wenn alles
          -- sauber war. Eine Lampe, die immer leuchtet, wird weggeschaut,
          -- und dann ist das ECHTE Rot unsichtbar.
          --
          -- Nur ein Laden ohne einen einzigen Beleg in sieben Tagen sah gruen.
          unsigniert AS (
            SELECT COUNT(*)::int AS n
              FROM transactions t
             WHERE t.created_at >= now() - interval '7 days'
               AND NOT EXISTS (
                     SELECT 1 FROM tse_signatures s WHERE s.transaction_id = t.id
                   )
          ),
          a24 AS (
            SELECT COUNT(*)::int AS n FROM ledger_events
             WHERE event_type LIKE 'alert.%' AND created_at >= now() - interval '24 hours'
          ),
          a7 AS (
            SELECT COUNT(*)::int AS n FROM ledger_events
             WHERE event_type LIKE 'alert.%' AND created_at >= now() - interval '7 days'
          )
        SELECT
          (SELECT n FROM dlq)        AS dlq_unacked,
          (SELECT oldest FROM dlq)   AS dlq_oldest,
          (SELECT n FROM running)    AS jobs_running,
          (SELECT t FROM chain)      AS chain_last_ok,
          (SELECT days FROM tse)     AS tse_days,
          (SELECT soonest FROM tse)  AS tse_soonest,
          (SELECT clients FROM tse)  AS tse_clients,
          (SELECT wachbuch FROM tse) AS tse_wachbuch,
          (SELECT n FROM unsigniert) AS tse_unsigned_7d,
          (SELECT n FROM a24)        AS alerts_24h,
          (SELECT n FROM a7)         AS alerts_7d
      `)) as unknown as HealthRow[];

      const r = rows[0];
      if (!r) throw new Error('system health returned no rows');

      // Migration tracker read separately + guarded: `_w14_schema_migrations` is
      // written by the prod migrator and is NOT in the Drizzle schema, so it may
      // be absent on a fresh database. A missing table degrades to null, never a 500.
      let migrationsApplied: number | null = null;
      let latestMigration: string | null = null;
      try {
        const m = (await app.db.execute<{ n: number; latest: string | null }>(drizzleSql`
          SELECT COUNT(*)::int AS n, MAX(filename) AS latest FROM _w14_schema_migrations
        `)) as unknown as Array<{ n: number; latest: string | null }>;
        if (m[0]) {
          migrationsApplied = Number(m[0].n);
          latestMigration = m[0].latest ?? null;
        }
      } catch {
        // tracker absent → leave null; the panel shows "unbekannt".
      }

      const dlq = Number(r.dlq_unacked);
      const running = Number(r.jobs_running);
      const chainLastOk = r.chain_last_ok ? new Date(r.chain_last_ok) : null;
      const tseDays = r.tse_days === null ? null : Number(r.tse_days);
      const alerts24 = Number(r.alerts_24h);
      const alerts7 = Number(r.alerts_7d);
      const now = Date.now();
      /**
       * ⛔ 08.08.2026 BERICHTIGT. Hier stand:
       *
       *     const chainStale = chainLastOk ? now - … > STALE_CHAIN_MS : false;
       *
       * Steht `chainLastOk` auf NULL, war `chainStale` **false** und die
       * Anzeige meldete grün „Läuft". NULL heisst hier aber nicht „alles gut",
       * sondern **noch nie geprüft** — und auf Norns POS war das der
       * Dauerzustand, weil der Arbeiter mit der Kasse nicht mitreist.
       *
       * Dieselbe Klasse wie die Fiskal-Ampel achtzig Zeilen weiter oben, nur
       * in die andere Richtung: dort log das Rot, hier log das Grün.
       */
      const kettenStand = beurteileKette(chainLastOk, now);

      const workerStatus: ComponentStatus =
        dlq > 0 ? 'alert' : kettenStand === 'frisch' ? 'ok' : 'watch';
      // Das Urteil liegt in einer reinen Funktion, damit es prüfbar ist. Die
      // vorherige Fassung stand mitten in dieser Route und konnte deshalb von
      // keinem Test erreicht werden, was der Grund war, dass sie so lange log.
      const fiscalVerdict = judgeFiscalHealth({
        clients: Number(r.tse_clients ?? 0),
        certDays: tseDays,
        unsignedRecent: Number(r.tse_unsigned_7d ?? 0),
        zertifikatUeberwacht: Number(r.tse_wachbuch ?? 0) > 0,
      });
      const fiscalStatus: ComponentStatus = fiscalVerdict.status;
      const alertsStatus: ComponentStatus = alerts24 > 0 ? 'watch' : 'ok';
      const databaseStatus: ComponentStatus = 'ok';

      const integrations = [
        {
          key: 'fiskaly',
          label: 'TSE-Sicherung (Fiskaly)',
          configured: Boolean(opts.env.FISKALY_API_KEY && opts.env.FISKALY_API_SECRET),
        },
        { key: 'stripe', label: 'Kartenzahlung (Stripe)', configured: Boolean(opts.env.STRIPE_SECRET_KEY) },
        { key: 'r2', label: 'Fotospeicher (R2)', configured: Boolean(opts.env.R2_BUCKET) },
        {
          key: 'opensanctions',
          label: 'Sanktionsprüfung',
          configured: Boolean(opts.env.OPENSANCTIONS_API_KEY),
        },
        { key: 'metrics', label: 'Metrik-Schutz', configured: Boolean(opts.env.METRICS_TOKEN) },
      ];

      const problems: TProblem[] = [];
      if (dlq > 0) {
        problems.push({
          id: 'worker-dlq',
          severity: 'alert',
          title: 'Hintergrundjobs fehlgeschlagen',
          detail: `${dlq} ${dlq === 1 ? 'Vorgang liegt' : 'Vorgänge liegen'} unbestätigt in der Fehler-Warteschlange.`,
          surface: '/tagebuch',
        });
      }
      if (kettenStand !== 'frisch') {
        // Kein Alarm: eine ungeprüfte Kette ist kein Beweis für einen Schaden.
        // Aber auch kein Schweigen — bis zum 08.08.2026 stand hier gar nichts,
        // und die Anzeige meldete stattdessen grün „Läuft".
        problems.push({
          id: 'kette-ungeprueft',
          severity: 'watch',
          title:
            kettenStand === 'nie'
              ? 'Prüfsummenkette noch nie geprüft'
              : 'Prüfsummenkette länger nicht geprüft',
          detail: kettenSatz(kettenStand),
          surface: '/tagebuch',
        });
      }
      if (tseDays !== null && tseDays < 7) {
        problems.push({
          id: 'tse-expiry',
          severity: 'alert',
          title: 'TSE-Zertifikat läuft ab',
          detail: `Nur noch ${tseDays} ${tseDays === 1 ? 'Tag' : 'Tage'}. Ohne gültiges Zertifikat ist kein rechtssicherer Verkauf möglich.`,
          surface: '/einstellungen',
        });
      } else if (tseDays !== null && tseDays <= 30) {
        problems.push({
          id: 'tse-expiry-soon',
          severity: 'watch',
          title: 'TSE-Zertifikat bald erneuern',
          detail: `Läuft in ${tseDays} Tagen ab.`,
          surface: '/einstellungen',
        });
      }
      if (alerts24 > 0) {
        problems.push({
          id: 'alerts-24',
          severity: 'watch',
          title: 'Neue Warnsignale',
          detail: `${alerts24} in den letzten 24 Stunden. In der Risikoanalyse prüfen.`,
          surface: '/risiko',
        });
      }

      // Top-line verdict = worst component. An unconfigured edge is a config gap
      // (watch), never a system alert on its own.
      const core: ComponentStatus[] = [workerStatus, fiscalStatus, alertsStatus, databaseStatus];
      const status: ComponentStatus = core.includes('alert')
        ? 'alert'
        : core.includes('watch')
          ? 'watch'
          : 'ok';

      return reply.status(200).send({
        status,
        computedAt: new Date().toISOString(),
        components: {
          api: { status: 'ok' as const },
          database: { status: databaseStatus, migrationsApplied, latestMigration },
          worker: {
            status: workerStatus,
            deadLetter: dlq,
            oldestDeadLetterAt: r.dlq_oldest ? new Date(r.dlq_oldest).toISOString() : null,
            running,
            chainLastVerifiedAt: chainLastOk ? chainLastOk.toISOString() : null,
          },
          fiscal: {
            status: fiscalStatus,
            tseCertDaysRemaining: tseDays,
            tseCertValidUntil: r.tse_soonest ? new Date(r.tse_soonest).toISOString() : null,
          },
          alerts: { status: alertsStatus, last24h: alerts24, last7d: alerts7 },
        },
        integrations,
        problems,
      });
    },
  );
};

export default systemHealthRoutes;
