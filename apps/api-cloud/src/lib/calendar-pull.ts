/**
 * calendar-pull — the inbound half of the two-way Google Calendar sync.
 *
 * The outbound half (appointment-calendar-sync.ts) mirrors every booking INTO
 * Google. This pulls changes made directly IN Google (e.g. the owner drags an
 * appointment to a new time, or adds/deletes an event from his phone) back into
 * the `appointments` table — so the Termine cockpit, the no-show detector and
 * the double-booking guard all stay in step with the calendar.
 *
 * No ping-pong: this writes the DB DIRECTLY (never via the mirroring routes),
 * so a Google→DB change is not re-pushed to Google. Matching is by
 * `google_event_id`. A new Google-only event becomes a fresh appointment
 * (source='GOOGLE'); a slot already holding an unlinked system booking is left
 * alone (race guard while the outbound mirror links it).
 *
 * Runs on a 15s interval in the api process (see startCalendarPoller), using a
 * persisted Google syncToken for cheap incremental polling. Ticks never overlap
 * (a module-level re-entrancy guard) and a Google event imports at most once (a
 * UNIQUE(google_event_id) index, migration 0070).
 */

import { neuerStand, zaehleErfolg, zaehleFehler } from './rueckzug-bei-dauerfehler.js';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import type { AppDb } from '@norns/db/client';

import { ensureWatchChannel } from './calendar-watch.js';
import { calendarConfigured, syncEvents } from './google-calendar.js';

const SYNC_TOKEN_KEY = 'calendar.pull_sync_token';
const TERMINAL_STATUSES = new Set(['COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED']);

export interface PullEvent {
  id: string;
  status: string;
  startIso: string | null;
  endIso: string | null;
  summary: string | null;
  description: string | null;
  created: string | null;
}

export interface MatchedAppointment {
  id: string;
  status: string;
  startsAt: string;
  durationMinutes: number;
}

/** A matched row from the batched lookup — MatchedAppointment + its event id. */
type MatchRow = {
  googleEventId: string;
  id: string;
  status: string;
  startsAt: string;
  durationMinutes: number;
};

export type PullAction =
  | { kind: 'skip' }
  | { kind: 'cancel'; appointmentId: string }
  | { kind: 'reschedule'; appointmentId: string; startIso: string; durationMinutes: number }
  | {
      kind: 'import';
      startIso: string;
      durationMinutes: number;
      title: string;
      notes: string | null;
    };

/** Pure decision: given a changed Google event + the local state, what to do. */
export function decidePullAction(
  event: PullEvent,
  matched: MatchedAppointment | null,
  unlinkedAppointmentAtStart: boolean,
): PullAction {
  // Deleted / cancelled in Google.
  if (event.status === 'cancelled') {
    if (matched && !TERMINAL_STATUSES.has(matched.status)) {
      return { kind: 'cancel', appointmentId: matched.id };
    }
    return { kind: 'skip' };
  }

  // Active event needs a concrete start + end (ignore all-day / malformed).
  if (!event.startIso || !event.endIso) return { kind: 'skip' };
  const durationMinutes = Math.max(
    1,
    Math.round((new Date(event.endIso).getTime() - new Date(event.startIso).getTime()) / 60_000),
  );

  if (matched) {
    if (TERMINAL_STATUSES.has(matched.status)) return { kind: 'skip' };
    const sameStart = new Date(matched.startsAt).getTime() === new Date(event.startIso).getTime();
    const sameDuration = matched.durationMinutes === durationMinutes;
    if (sameStart && sameDuration) return { kind: 'skip' };
    return {
      kind: 'reschedule',
      appointmentId: matched.id,
      startIso: event.startIso,
      durationMinutes,
    };
  }

  // No local appointment carries this event id.
  if (unlinkedAppointmentAtStart) return { kind: 'skip' }; // outbound mirror is linking it
  return {
    kind: 'import',
    startIso: event.startIso,
    durationMinutes,
    title: event.summary ?? 'Termin (Kalender)',
    notes: event.description ?? null,
  };
}

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}
interface LoggerLike {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

async function loadSyncToken(db: DbLike): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT value #>> '{}' AS token FROM system_settings WHERE key = ${SYNC_TOKEN_KEY}`,
  )) as unknown as Array<{ token: string | null }>;
  return rows[0]?.token ?? null;
}

async function saveSyncToken(db: DbLike, token: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO system_settings (key, value, description)
    VALUES (${SYNC_TOKEN_KEY}, to_jsonb(${token}::text), 'Google Calendar incremental sync token')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

/** ISO instant string → true if it parses to a real instant. */
function isValidInstant(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}

/**
 * Re-entrancy guard: the 15s `setInterval` does not await the prior tick. A slow
 * full-resync tick must not overlap the next one and re-import. The UNIQUE index
 * makes overlap SAFE regardless (0070), but this avoids wasted work + duplicate
 * Google API calls.
 */
let pullRunning = false;

/** One incremental sync pass: Google → appointments table. Best-effort. */
export async function runCalendarPull(db: AppDb, log: LoggerLike): Promise<void> {
  if (!calendarConfigured()) return;
  if (pullRunning) {
    log.info({}, 'calendar pull: previous tick still running — skipping');
    return;
  }
  pullRunning = true;
  try {
    let token = await loadSyncToken(db);
    let res = await syncEvents(token);
    if (res.fullResyncNeeded) {
      log.info({}, 'calendar pull: sync token expired — full resync');
      token = null;
      res = await syncEvents(null);
    }

    // Resolve the fallback staff ONCE — every Google-only import shares it. This
    // was an N+1 query (re-run inside the loop for every imported event).
    const staffRows = (await db.execute<{ id: string }>(sql`
      SELECT id::text AS id FROM users
      WHERE role::text IN ('ADMIN', 'CASHIER')
      ORDER BY is_owner DESC, created_at ASC LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    const fallbackStaffId = staffRows[0]?.id ?? null;

    // Batch the match lookup into ONE keyed query (was one query PER event).
    // Bind the ids as a single text[] LITERAL param (NOT an array spread — the
    // 42846/22P02 bug class guarded by tests/unit/no-array-spread.test.ts).
    const eventIds = res.events
      .map((e) => e.id)
      .filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_@.-]+$/.test(id));
    const matchMap = new Map<string, MatchedAppointment>();
    if (eventIds.length > 0) {
      const idsLiteral = `{${eventIds.join(',')}}`;
      const rows = (await db.execute<MatchRow>(sql`
        SELECT google_event_id AS "googleEventId", id::text AS id, status::text AS status,
               starts_at::text AS "startsAt", duration_minutes AS "durationMinutes"
        FROM appointments WHERE google_event_id = ANY(${idsLiteral}::text[])
      `)) as unknown as MatchRow[];
      for (const r of rows) {
        matchMap.set(r.googleEventId, {
          id: r.id,
          status: r.status,
          startsAt: r.startsAt,
          durationMinutes: r.durationMinutes,
        });
      }
    }

    // Batch the unlinked-slot probe into ONE keyed query (was one query per
    // unmatched active event). Compare by INSTANT — normalise both sides through
    // `new Date(...).toISOString()` so a `+02:00` vs `Z` representation of the
    // same instant does not falsely diverge.
    const candidateStarts = res.events
      .filter((e) => e.id && !matchMap.has(e.id) && e.status !== 'cancelled' && e.startIso)
      .map((e) => e.startIso as string)
      .filter(isValidInstant);
    const unlinkedStarts = new Set<string>();
    if (candidateStarts.length > 0) {
      const startsLiteral = `{${candidateStarts.map((s) => `"${s}"`).join(',')}}`;
      const rows = (await db.execute<{ startsAt: string }>(sql`
        SELECT DISTINCT starts_at::text AS "startsAt" FROM appointments
        WHERE starts_at = ANY(${startsLiteral}::timestamptz[])
          AND google_event_id IS NULL
          AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
      `)) as unknown as Array<{ startsAt: string }>;
      for (const r of rows) unlinkedStarts.add(new Date(r.startsAt).toISOString());
    }

    let imported = 0;
    let rescheduled = 0;
    let cancelled = 0;
    let skippedNoStaff = 0;

    for (const event of res.events) {
      if (!event.id) continue;
      const matched = matchMap.get(event.id) ?? null;
      const unlinkedAtStart =
        !!event.startIso &&
        isValidInstant(event.startIso) &&
        unlinkedStarts.has(new Date(event.startIso).toISOString());

      const action = decidePullAction(event, matched, unlinkedAtStart);
      try {
        if (action.kind === 'cancel') {
          await db.execute(sql`
            UPDATE appointments
            SET status = 'CANCELLED', cancelled_at = now(),
                cancellation_reason = 'Im Google Kalender gelöscht'
            WHERE id = ${action.appointmentId}::uuid
          `);
          cancelled++;
        } else if (action.kind === 'reschedule') {
          await db.execute(sql`
            UPDATE appointments
            SET starts_at = ${action.startIso}::timestamptz, duration_minutes = ${action.durationMinutes}
            WHERE id = ${action.appointmentId}::uuid
          `);
          rescheduled++;
        } else if (action.kind === 'import') {
          if (!fallbackStaffId) {
            skippedNoStaff++;
            continue;
          }
          // Idempotent UPSERT in ONE transaction, keyed on the new UNIQUE index
          // (0070). RETURNING is empty on conflict → `imported` only counts a
          // genuine insert, so the cross-poller duplicate race is a clean no-op.
          const inserted = await db.transaction(async (txAny) => {
            const tx = txAny as unknown as typeof db;
            const rows = (await tx.execute<{ id: string }>(sql`
              INSERT INTO appointments
                (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via, source,
                 customer_notes, google_event_id)
              VALUES ('CONSULTATION'::appointment_type, ${action.startIso}::timestamptz,
                      ${action.durationMinutes}, ${fallbackStaffId}::uuid, 'google_calendar', 'GOOGLE',
                      ${action.title}, ${event.id})
              ON CONFLICT (google_event_id) DO NOTHING
              RETURNING id::text AS id
            `)) as unknown as Array<{ id: string }>;
            return rows[0] ?? null;
          });
          if (inserted) imported++;
        }
      } catch (err) {
        // A Google import landing on a slot already held by ANOTHER staff
        // appointment raises 23P01 (the no-overlap EXCLUDE, 0069) — skip cleanly.
        if ((err as { code?: unknown })?.code === '23P01') {
          log.info({ eventId: event.id }, 'calendar pull: import skipped (staff slot taken)');
        } else {
          log.error({ err, eventId: event.id, action: action.kind }, 'calendar pull: apply failed');
        }
      }
    }

    if (res.nextSyncToken) await saveSyncToken(db, res.nextSyncToken);
    if (imported || rescheduled || cancelled) {
      log.info({ imported, rescheduled, cancelled }, 'calendar pull: applied changes');
    }
    if (skippedNoStaff > 0) {
      log.info(
        { skippedNoStaff },
        'calendar pull: no ADMIN/CASHIER staff to assign Google-only imports',
      );
    }
  } finally {
    pullRunning = false;
  }
}

const POLL_INTERVAL_MS = 15_000;

/**
 * Start the background sync (production only — called from server.ts):
 *   • a 15s incremental poll (near-instant + the backstop), and
 *   • events.watch push channel upkeep — once the webhook domain is verified
 *     in GCP, Google pushes changes to /api/calendar/notifications in
 *     sub-second time and the poll just covers any missed notification.
 */
export function startCalendarPoller(app: FastifyInstance): NodeJS.Timeout | null {
  if (!calendarConfigured()) {
    app.log.info({}, 'calendar poller: not configured — skipping');
    return null;
  }
  const webhookUrl = process.env.CALENDAR_WEBHOOK_URL ?? '';
  const webhookToken = process.env.CALENDAR_WEBHOOK_TOKEN ?? '';
  const db = app.db;
  // ⚠️ RUECKZUG BEI DAUERFEHLER. Am 26.07.2026 gemessen: der Takt schlug alle
  // 15 Sekunden fehl, jedes Mal mit vollem Stapelabzug — 9141 Bytes je Minute,
  // rund 12 MB je Tag, aus einem Behaelter ohne Groessengrenze.
  //
  // Der Fehler war echt (das Google-Projekt des Dienstkontos war GELOESCHT),
  // aber ein solcher Zustand aendert sich in 15 Sekunden mit Sicherheit nicht.
  // Und ein Protokoll, in dem dieselbe Zeile 5760 Mal am Tag steht, verdeckt
  // genau das, wofuer es da ist.
  //
  // Der Fehler wird NICHT verschluckt: erster voll, danach in wachsenden
  // Abstaenden mit der Zahl der unterdrueckten Versuche dabei. Siehe
  // lib/rueckzug-bei-dauerfehler.ts.
  const pullStand = neuerStand();
  const watchStand = neuerStand();

  const tick = () => {
    void runCalendarPull(db, app.log)
      .then(() => {
        const e = zaehleErfolg(pullStand);
        if (e.warKaputt) {
          app.log.info({ fehlerZuvor: e.fehlerWaren }, 'calendar pull: wieder erreichbar');
        }
      })
      .catch((err: unknown) => {
        const e = zaehleFehler(pullStand);
        if (e.melden) {
          app.log.error(
            { err, fehlerGesamt: e.fehlerGesamt, unterdrueckt: e.unterdrueckt },
            'calendar pull tick failed',
          );
        }
      });
    if (webhookUrl && webhookToken) {
      void ensureWatchChannel(db, app.log, { webhookUrl, token: webhookToken })
        .then(() => void zaehleErfolg(watchStand))
        .catch((err: unknown) => {
          const e = zaehleFehler(watchStand);
          if (e.melden) {
            app.log.error(
              { err, fehlerGesamt: e.fehlerGesamt, unterdrueckt: e.unterdrueckt },
              'calendar watch: ensure channel failed',
            );
          }
        });
    }
  };
  setTimeout(tick, 5_000); // first pass shortly after boot
  const handle = setInterval(tick, POLL_INTERVAL_MS);
  handle.unref?.();
  app.log.info(
    { pollIntervalMs: POLL_INTERVAL_MS, watch: webhookUrl && webhookToken ? 'enabled' : 'off' },
    'calendar sync: started',
  );
  return handle;
}
