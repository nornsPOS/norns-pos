/**
 * GET /api/sse/ledger — live ledger stream (ADR-0014 §4, ADR-0021 §9).
 *
 * Consumes the `pg_notify('warehouse14_ledger', NEW.id::text)` substrate
 * planted by migration 0013 C-6 and re-emits each row as a Server-Sent
 * Event for the Control Desktop / Bridge UX to render in real time.
 *
 * Wire shape (text/event-stream):
 *
 *     id: 1234
 *     event: ledger
 *     data: {"id":1234,"event_type":"transaction.finalized","entity_table":"transactions",…}
 *
 *     : ping 2026-05-25T12:34:56.789Z    ← heartbeat comment, ignored by EventSource
 *
 * Reconnect contract:
 *   • The client (browser `EventSource`, Tauri, etc.) stores the last
 *     received `id:` and on automatic reconnect sends `Last-Event-ID: 1234`.
 *   • We REPLAY every row with `id > 1234` from the table before starting
 *     the live subscription — so no event is lost across brief disconnects.
 *
 * Connection management (Basel directive Day 14 §1):
 *   • Each subscriber gets a DEDICATED postgres-js connection (not pooled).
 *     `LISTEN` is session-bound; sharing a pool connection would be wrong.
 *   • On client disconnect — `req.raw.on('close')`, plus an error guard —
 *     we run `subscription.unlisten()` then `listener.end()`. Idempotent.
 *
 * Heartbeat (Basel directive Day 14 §2):
 *   • Every 25 seconds we write `:hb …\n\n` (SSE comment). This keeps the
 *     Cloudflare Tunnel + browser EventSource keep-alive timers happy.
 *
 * Auth (Basel directive Day 14 §3):
 *   • `requireAuth` + `requireRole('ADMIN')`. No other surface — this is
 *     the "watch the cashier from home" stream.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';

import { ledgerEvents } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { KARTE_TTL_MS, stelleKarteAus } from '../lib/sse-eintrittskarte.js';

/**
 * Eine Karte, die eine neue Karte loesen will. Das ist kein Serverfehler und
 * kein fehlendes Recht, sondern der geschlossene Kreislauf selbst.
 */
class KarteErneuertSichNichtError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'FORBIDDEN';
}

const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_REPLAY_ROWS = 1_000; // bound the catch-up window on reconnect

interface LedgerRow {
  id: number;
  event_type: string;
  entity_table: string;
  entity_id: string;
  actor_user_id: string | null;
  device_id: string | null;
  payload: unknown;
  created_at: string; // ISO 8601 — Date serializes to it anyway, but be explicit
}

interface LedgerRawRow {
  id: bigint;
  event_type: string;
  entity_table: string;
  entity_id: string;
  actor_user_id: string | null;
  device_id: string | null;
  payload: unknown;
  created_at: Date;
}

function normalizeRow(r: LedgerRawRow): LedgerRow {
  return {
    id: Number(r.id),
    event_type: r.event_type,
    entity_table: r.entity_table,
    entity_id: r.entity_id,
    actor_user_id: r.actor_user_id,
    device_id: r.device_id,
    payload: r.payload,
    created_at: new Date(r.created_at).toISOString(),
  };
}

const sseLedger: FastifyPluginAsync = async (app) => {
  // ══════════════════════════════════════════════════════════════════════
  // POST /api/sse/ticket — die Eintrittskarte fuer den Strom
  // ══════════════════════════════════════════════════════════════════════
  //
  // ⚠️ Bis zum 26.07.2026 haengte der Client seinen SITZUNGSSCHLUESSEL an die
  // SSE-Adresse. `EventSource` kann keine Kopfzeilen setzen und WebView2
  // verwirft den seitenuebergreifenden Keks, also musste dort etwas stehen —
  // aber es stand der volle Schluessel, und der landete im Tunnelprotokoll
  // und in den Zugriffsprotokollen von Cloudflare. Einer war beim Nachmessen
  // noch 4,7 Stunden gueltig.
  //
  // DIESE Route wird mit der echten Anmeldung aufgerufen, also per Keks oder
  // Kopfzeile — beides erscheint in keinem Zugriffsprotokoll. Sie gibt eine
  // Karte zurueck, die 30 Sekunden lebt und EINMAL gilt. Landet die in einem
  // Protokoll, ist sie dort schon tot.
  app.post(
    '/api/sse/ticket',
    {
      schema: {
        tags: ['sse'],
        summary: 'Kurzlebige, einmalige Eintrittskarte fuer den Live-Strom.',
        description:
          'Der Sitzungsschluessel darf nicht in eine Adresszeile. Diese Karte gilt ' +
          '30 Sekunden und genau einmal.',
        response: {
          200: Type.Object({
            ticket: Type.String(),
            expiresInSec: Type.Integer(),
          }),
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      // ⚠️ ZWEITER RIEGEL, und er ist Absicht.
      //
      // Bis zum 08.08.2026 galt die Karte fuer JEDEN Pfad unter `/api/sse/` —
      // also auch fuer DIESEN. Ein Mitleser konnte damit aus einer
      // abgefischten Karte endlos neue loesen: einloesen, ausstellen lassen,
      // wiederholen. Aus dreissig Sekunden wurde unbegrenzter Inhaberzugang.
      //
      // Der erste Riegel sitzt in `darfMitKarteRein`: eine Karte gilt nur noch
      // fuer GET, und dies ist ein POST. Dieser hier haelt zusaetzlich, falls
      // morgen jemand eine ausstellende Route als GET baut. Beide bleiben.
      if ((req.session as { ausKarte?: boolean } | null)?.ausKarte === true) {
        throw new KarteErneuertSichNichtError(
          'Eine Eintrittskarte kann keine neue Eintrittskarte loesen. Bitte mit ' +
            'der echten Anmeldung anfragen.',
        );
      }

      // Hinterlegt wird die bereits aufgeloeste Sitzung, NICHT der Schluessel.
      // `requireAuth` oben hat sie schon geprueft; die Karte traegt nur deren
      // Ergebnis weiter. Damit existiert der Schluessel an keiner zweiten
      // Stelle — genau das war ja der Befund.
      return reply.status(200).send({
        ticket: stelleKarteAus(req.session),
        expiresInSec: Math.floor(KARTE_TTL_MS / 1000),
      });
    },
  );

  app.get(
    '/api/sse/ledger',
    {
      schema: {
        tags: ['sse'],
        summary: 'Live ledger event stream (text/event-stream)',
        description:
          'Server-Sent Events over the ledger_events table. Each NOTIFY from ' +
          "pg_notify('warehouse14_ledger', NEW.id) produces one `event: ledger` " +
          'SSE message. ADMIN-only. Reconnect with `Last-Event-ID` to replay ' +
          `up to ${MAX_REPLAY_ROWS} missed rows.`,
        // We do not declare a response schema — Fastify would try to validate
        // the streamed bytes against JSON. The hijack contract is explicit.
      },
    },
    async (req, reply) => {
      // ──────────────────────────────────────────────────────────────────
      // 1. Auth gate.
      // ──────────────────────────────────────────────────────────────────
      requireAuth(req);
      requireRole(req, 'ADMIN');

      // ──────────────────────────────────────────────────────────────────
      // 2. SSE response headers.
      //    `X-Accel-Buffering: no` disables nginx/Cloudflare proxy buffering;
      //    without it, chunks would queue and the UX would feel laggy.
      //    Fastify's `reply.hijack()` hands the socket to us — Fastify will
      //    not try to serialize/serialize-end the response itself.
      // ──────────────────────────────────────────────────────────────────
      // Forward the CORS headers @fastify/cors already computed (it validated
      // the Origin against TRUSTED_ORIGINS). reply.hijack() + raw.writeHead
      // would otherwise drop them, and a credentialed cross-origin EventSource
      // (the POS live feed) gets rejected by the browser → endless
      // "Wiederverbinden" reconnect loop.
      const corsOrigin = reply.getHeader('access-control-allow-origin');
      const corsCreds = reply.getHeader('access-control-allow-credentials');
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': String(corsOrigin) } : {}),
        ...(corsCreds ? { 'Access-Control-Allow-Credentials': String(corsCreds) } : {}),
      });

      // ──────────────────────────────────────────────────────────────────
      // 3. Open the dedicated LISTEN connection.
      // ──────────────────────────────────────────────────────────────────
      let listener: Sql | null = app.openDedicatedConnection();
      let subscription: { unlisten: () => Promise<void> } | null = null;
      let heartbeatTimer: NodeJS.Timeout | null = null;
      let closed = false;
      // Last id we've emitted on THIS connection. Both replay + live use it.
      let lastEmittedId = 0;

      const cleanup = async (reason: string): Promise<void> => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        try {
          await subscription?.unlisten();
        } catch (err) {
          req.log.warn({ err }, 'sse: unlisten failed');
        }
        try {
          await listener?.end({ timeout: 5 });
        } catch (err) {
          req.log.warn({ err }, 'sse: listener.end failed');
        }
        listener = null;
        subscription = null;
        try {
          if (!raw.writableEnded) raw.end();
        } catch {
          // socket already gone
        }
        req.log.debug({ reason }, 'sse: connection cleaned up');
      };

      // Hook every plausible termination signal — Basel directive: zero leaks.
      req.raw.on('close', () => {
        void cleanup('req-close');
      });
      req.raw.on('error', (err) => {
        req.log.warn({ err }, 'sse: req error');
        void cleanup('req-error');
      });
      raw.on('error', (err) => {
        req.log.warn({ err }, 'sse: reply error');
        void cleanup('reply-error');
      });

      // ──────────────────────────────────────────────────────────────────
      // 4. Helper — write one event. Catches socket-closed errors.
      // ──────────────────────────────────────────────────────────────────
      const writeEvent = (id: number, payload: LedgerRow): void => {
        if (closed || raw.writableEnded) return;
        try {
          raw.write(`id: ${id}\nevent: ledger\ndata: ${JSON.stringify(payload)}\n\n`);
          lastEmittedId = Math.max(lastEmittedId, id);
        } catch (err) {
          req.log.debug({ err }, 'sse: write event failed — cleaning up');
          void cleanup('write-failed');
        }
      };
      const writeHeartbeat = (): void => {
        if (closed || raw.writableEnded) return;
        try {
          raw.write(`: hb ${new Date().toISOString()}\n\n`);
        } catch {
          void cleanup('heartbeat-failed');
        }
      };

      // ──────────────────────────────────────────────────────────────────
      // 5. Subscribe to NOTIFY FIRST (before catch-up) so we don't lose
      //    events landing during the replay query. Buffer incoming ids
      //    until catch-up completes; then drain the buffer (de-duped).
      // ──────────────────────────────────────────────────────────────────
      const liveBuffer: number[] = [];
      let replayDone = false;

      const fetchAndEmit = async (id: number): Promise<void> => {
        // De-dup against the replay window — if we already emitted this id
        // during catch-up, skip it.
        if (id <= lastEmittedId) return;
        try {
          const rows = await app.db
            .select({
              id: ledgerEvents.id,
              event_type: ledgerEvents.eventType,
              entity_table: ledgerEvents.entityTable,
              entity_id: ledgerEvents.entityId,
              actor_user_id: ledgerEvents.actorUserId,
              device_id: ledgerEvents.deviceId,
              payload: ledgerEvents.payload,
              created_at: ledgerEvents.createdAt,
            })
            .from(ledgerEvents)
            .where(drizzleSql`${ledgerEvents.id} = ${id}`)
            .limit(1);
          const row = rows[0];
          if (row) writeEvent(Number(row.id), normalizeRow(row as LedgerRawRow));
        } catch (err) {
          req.log.warn({ err, id }, 'sse: failed to fetch ledger row');
        }
      };

      try {
        subscription = await listener.listen('warehouse14_ledger', (payload) => {
          const id = Number(payload);
          if (!Number.isFinite(id) || id <= 0) return;
          if (!replayDone) {
            liveBuffer.push(id);
            return;
          }
          // Live path — fire and forget; intentional, ordering is by id.
          void fetchAndEmit(id);
        });
      } catch (err) {
        req.log.error({ err }, 'sse: LISTEN subscribe failed');
        await cleanup('subscribe-failed');
        return;
      }

      // ──────────────────────────────────────────────────────────────────
      // 6. Catch-up: replay rows with id > Last-Event-ID, up to MAX_REPLAY_ROWS.
      // ──────────────────────────────────────────────────────────────────
      const lastIdHeader = req.headers['last-event-id'];
      const lastEventId = Array.isArray(lastIdHeader) ? lastIdHeader[0] : lastIdHeader;
      const sinceId = lastEventId != null ? Number.parseInt(lastEventId, 10) : Number.NaN;
      if (Number.isFinite(sinceId) && sinceId >= 0) {
        try {
          const catchUp = await app.db
            .select({
              id: ledgerEvents.id,
              event_type: ledgerEvents.eventType,
              entity_table: ledgerEvents.entityTable,
              entity_id: ledgerEvents.entityId,
              actor_user_id: ledgerEvents.actorUserId,
              device_id: ledgerEvents.deviceId,
              payload: ledgerEvents.payload,
              created_at: ledgerEvents.createdAt,
            })
            .from(ledgerEvents)
            .where(drizzleSql`${ledgerEvents.id} > ${sinceId}`)
            .orderBy(ledgerEvents.id)
            .limit(MAX_REPLAY_ROWS);
          for (const row of catchUp) {
            writeEvent(Number(row.id), normalizeRow(row as LedgerRawRow));
          }
        } catch (err) {
          req.log.warn({ err, sinceId }, 'sse: catch-up replay failed');
        }
      }
      replayDone = true;

      // ──────────────────────────────────────────────────────────────────
      // 7. Drain anything that arrived during catch-up (deduped by lastEmittedId).
      // ──────────────────────────────────────────────────────────────────
      for (const id of liveBuffer.splice(0)) {
        void fetchAndEmit(id);
      }

      // ──────────────────────────────────────────────────────────────────
      // 8. Start heartbeat. setInterval is unref'd so Node can exit cleanly
      //    if the process is shutting down.
      // ──────────────────────────────────────────────────────────────────
      heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref();

      // Immediate hello frame so the client knows the stream is alive even
      // before any ledger activity. Doubles as a smoke test in production.
      writeHeartbeat();
    },
  );
};

export default sseLedger;
