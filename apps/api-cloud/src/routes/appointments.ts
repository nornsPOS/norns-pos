/**
 * Appointments API (ADR-0020). All scheduling is Europe/Berlin (the
 * available_slots() SQL function + berlin helpers handle DST).
 *
 *   GET   /api/appointments/available-slots — capacity grid via available_slots().
 *   POST  /api/appointments                 — book (txn: verify slot + insert +
 *                                              link VIEWING products + schedule
 *                                              reminders; ledger via DB trigger).
 *   PATCH /api/appointments/:id             — status transition (trigger-validated)
 *                                              or notes-only edit (no `status`).
 *   POST  /api/appointments/:id/reschedule  — clone + link + release old holds.
 *   GET   /api/appointments/feed.ics        — iCalendar feed (CONTRACT 3; the
 *                                              64-hex token IS the capability —
 *                                              constant-time compared against
 *                                              system_settings, public path).
 *   POST  /api/appointments/feed-token      — rotate the feed token (ADMIN +
 *                                              ADMIN; old token dies instantly).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { type Static, Type } from '@sinclair/typebox';
import { type SQL, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  type AppointmentType,
  DEFAULT_DURATION_MINUTES,
  computeReminderSchedule,
  escapeIcsText,
  formatIcsTimestamp,
} from '@norns/appointments';

import type { Env } from '../config/env.js';
import {
  type AppointmentEventInput,
  mirrorAppointmentCreate,
  mirrorAppointmentDelete,
  mirrorAppointmentReschedule,
} from '../lib/appointment-calendar-sync.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class SlotUnavailableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class FeedTokenError extends DomainError {
  public readonly httpStatus = 401;
  public readonly code: ApiErrorCode = 'UNAUTHORIZED';
}
class AppointmentNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class AppointmentValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

/** True when `err` is a Postgres error carrying the given SQLSTATE `code`. */
function isPgCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const APPOINTMENT_TYPE_VALUES = ['VIEWING', 'BUYBACK_EVAL', 'CONSULTATION', 'PICKUP'] as const;

const SlotsQuery = Type.Object({
  type: Type.Union(APPOINTMENT_TYPE_VALUES.map((t) => Type.Literal(t))),
  durationMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 480 })),
  from: Type.String({ format: 'date-time' }),
  to: Type.String({ format: 'date-time' }),
  staffUserId: Type.Optional(Type.String({ format: 'uuid' })),
});
type TSlotsQuery = Static<typeof SlotsQuery>;

const BookBody = Type.Object({
  type: Type.Union(APPOINTMENT_TYPE_VALUES.map((t) => Type.Literal(t))),
  startsAt: Type.String({ format: 'date-time' }),
  durationMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 480 })),
  staffUserId: Type.String({ format: 'uuid' }),
  customerId: Type.Optional(Type.String({ format: 'uuid' })),
  bookedVia: Type.Union([
    Type.Literal('control_desktop'),
    Type.Literal('storefront'),
    Type.Literal('pos'),
    Type.Literal('whatsapp_bot'),
  ]),
  linkedProductIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
  customerNotes: Type.Optional(Type.String({ maxLength: 2000 })),
  /** Contact for reminder scheduling (kept out of PII tables here). */
  customerEmail: Type.Optional(Type.String({ maxLength: 200 })),
  customerPhone: Type.Optional(Type.String({ maxLength: 32 })),
});
type TBookBody = Static<typeof BookBody>;

const PatchBody = Type.Object({
  /**
   * Optional since the Termine cockpit: a status-less PATCH with `staffNotes`
   * is a metadata-only edit — no transition, no marker-column re-stamp.
   * Existing callers that always send `status` are unaffected.
   */
  status: Type.Optional(
    Type.Union([
      Type.Literal('CONFIRMED'),
      Type.Literal('CHECKED_IN'),
      Type.Literal('IN_PROGRESS'),
      Type.Literal('COMPLETED'),
      Type.Literal('CANCELLED'),
      Type.Literal('NO_SHOW'),
    ]),
  ),
  cancellationReason: Type.Optional(Type.String({ maxLength: 500 })),
  staffNotes: Type.Optional(Type.String({ maxLength: 2000 })),
});
type TPatchBody = Static<typeof PatchBody>;

const RescheduleBody = Type.Object({
  startsAt: Type.String({ format: 'date-time' }),
  durationMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 480 })),
  staffUserId: Type.Optional(Type.String({ format: 'uuid' })),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
});
type TRescheduleBody = Static<typeof RescheduleBody>;

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
type TIdParams = Static<typeof IdParams>;

export interface AppointmentsOpts {
  env: Env;
}

type SlotRow = { staff_user_id: string; slot_starts_at: string; slot_ends_at: string };
type ApptRow = {
  id: string;
  appointment_type: AppointmentType;
  status: string;
  starts_at: string;
  duration_minutes: number;
  staff_user_id: string;
  customer_id: string | null;
  google_event_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  customer_notes: string | null;
};

function durationFor(type: AppointmentType, override?: number): number {
  return override ?? DEFAULT_DURATION_MINUTES[type];
}

interface DbExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** Insert the computed reminder cadence into appointment_notifications. */
async function scheduleReminders(
  tx: DbExecutor,
  appointmentId: string,
  startsAt: Date,
  email: string | null,
  phone: string | null,
): Promise<void> {
  const rows = computeReminderSchedule({
    startsAt,
    recipientEmail: email,
    recipientPhone: phone,
  });
  for (const r of rows) {
    await tx.execute(sql`
      INSERT INTO appointment_notifications
        (appointment_id, notification_type, channel, recipient, template_id, scheduled_for)
      VALUES (${appointmentId}::uuid, ${r.notificationType}, ${r.channel}, ${r.recipient},
              ${r.templateId ?? null}, ${r.scheduledFor.toISOString()}::timestamptz)
    `);
  }
}

const STATUS_MARKER_COLUMN: Record<string, string | null> = {
  CONFIRMED: 'confirmed_at',
  CHECKED_IN: 'checked_in_at',
  IN_PROGRESS: 'in_progress_started_at',
  COMPLETED: 'completed_at',
  NO_SHOW: 'no_show_marked_at',
  CANCELLED: 'cancelled_at',
};

const ListQuery = Type.Object({
  from: Type.String({ format: 'date-time' }),
  to: Type.String({ format: 'date-time' }),
  staffUserId: Type.Optional(Type.String({ format: 'uuid' })),
});
type TListQuery = Static<typeof ListQuery>;

// ── iCalendar feed (CONTRACT 3) ─────────────────────────────────────────

const ICS_FEED_TOKEN_KEY = 'appointments.ics_feed_token';

/** token is OPTIONAL in the schema so a missing token 401s (not a 400). */
const FeedQuery = Type.Object({
  token: Type.Optional(Type.String({ maxLength: 128 })),
});
type TFeedQuery = Static<typeof FeedQuery>;

const FeedTokenResponse = Type.Object({
  token: Type.String(),
  url: Type.String(),
});

/**
 * Constant-time token compare: hash both sides to a fixed length first so
 * `timingSafeEqual` never throws on length mismatch and the comparison leaks
 * neither length nor prefix.
 */
function feedTokenMatches(supplied: string, stored: string): boolean {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(stored).digest();
  return timingSafeEqual(a, b);
}

/** German VEVENT labels per appointment type (UI rule: 100% German). */
const TYPE_LABEL_DE: Record<string, string> = {
  VIEWING: 'Besichtigungs-Termin',
  BUYBACK_EVAL: 'Ankauf-Termin',
  CONSULTATION: 'Beratungs-Termin',
  PICKUP: 'Abhol-Termin',
};

const STATUS_LABEL_DE: Record<string, string> = {
  SCHEDULED: 'Geplant',
  CONFIRMED: 'Bestätigt',
  CHECKED_IN: 'Eingetroffen',
  IN_PROGRESS: 'Laufend',
  COMPLETED: 'Abgeschlossen',
  NO_SHOW: 'Nicht erschienen',
};

/** "Max Mustermann" → "Max M." (privacy-lean calendar summaries). */
function shortContactName(full: string): string {
  const parts = full.trim().split(/\s+/);
  const first = parts[0] ?? '';
  if (parts.length < 2) return first;
  const last = parts[parts.length - 1] ?? '';
  return `${first} ${last.charAt(0)}.`;
}

type FeedRow = {
  id: string;
  appointment_type: string;
  status: string;
  starts_at: string;
  ends_at: string;
  contact_name: string | null;
};

/** Build the full VCALENDAR body (RFC 5545, CRLF line endings). */
function buildFeedCalendar(rows: FeedRow[], now: Date): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Warehouse14//Termine//DE',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText('Warehouse14 Termine')}`,
  ];
  for (const r of rows) {
    const typeLabel = TYPE_LABEL_DE[r.appointment_type] ?? r.appointment_type;
    const statusLabel = STATUS_LABEL_DE[r.status] ?? r.status;
    const who = r.contact_name ? ` – ${shortContactName(r.contact_name)}` : '';
    const summary = `${typeLabel}${who} (${statusLabel})`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:appt-${r.id}@warehouse14.de`,
      `DTSTAMP:${formatIcsTimestamp(now)}`,
      `DTSTART:${formatIcsTimestamp(new Date(r.starts_at))}`,
      `DTEND:${formatIcsTimestamp(new Date(r.ends_at))}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `LOCATION:${escapeIcsText('Warehouse14, Schorndorf')}`,
      `STATUS:${r.status === 'SCHEDULED' ? 'TENTATIVE' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

const appointmentsRoutes: FastifyPluginAsync<AppointmentsOpts> = async (app) => {
  // ── GET list (calendar + next-hour panel) ────────────────────────────────
  app.get<{ Querystring: TListQuery }>(
    '/api/appointments',
    {
      schema: {
        tags: ['appointments'],
        summary: 'List appointments in a time window (Europe/Berlin display).',
        querystring: ListQuery,
        response: {
          200: Type.Object({ appointments: Type.Array(Type.Unknown()) }),
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER', 'READONLY');
      const q = req.query;
      const rows = (await app.db.execute(sql`
        SELECT a.id::text AS id, a.appointment_type::text AS appointment_type,
               a.status::text AS status, a.starts_at::text AS starts_at,
               a.ends_at::text AS ends_at, a.duration_minutes,
               a.staff_user_id::text AS staff_user_id, a.customer_id::text AS customer_id,
               a.staff_notes, a.customer_notes,
               COALESCE(
                 (SELECT array_agg(lp.product_id::text)
                  FROM appointment_linked_products lp WHERE lp.appointment_id = a.id),
                 ARRAY[]::text[]
               ) AS linked_product_ids
        FROM appointments a
        WHERE a.starts_at >= ${q.from}::timestamptz
          AND a.starts_at < ${q.to}::timestamptz
          AND (${q.staffUserId ?? null}::uuid IS NULL OR a.staff_user_id = ${q.staffUserId ?? null}::uuid)
          AND a.status NOT IN ('CANCELLED', 'RESCHEDULED')
        ORDER BY a.starts_at ASC
        LIMIT 500
      `)) as unknown as unknown[];
      return reply.status(200).send({ appointments: rows });
    },
  );

  // ── GET available-slots ──────────────────────────────────────────────────
  app.get<{ Querystring: TSlotsQuery }>(
    '/api/appointments/available-slots',
    {
      schema: {
        tags: ['appointments'],
        summary: 'Compute available appointment slots (Europe/Berlin, DST-correct).',
        querystring: SlotsQuery,
        response: { 200: Type.Object({ slots: Type.Array(Type.Unknown()) }), 401: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER', 'READONLY');
      const q = req.query;
      const dur = durationFor(q.type, q.durationMinutes);
      const rows = (await app.db.execute<SlotRow>(sql`
        SELECT staff_user_id::text AS staff_user_id,
               slot_starts_at::text AS slot_starts_at,
               slot_ends_at::text   AS slot_ends_at
        FROM available_slots(
          ${q.type}::appointment_type, ${dur},
          ${q.from}::timestamptz, ${q.to}::timestamptz,
          ${q.staffUserId ?? null}::uuid, NULL::uuid
        )
      `)) as unknown as SlotRow[];
      return reply.status(200).send({ slots: rows });
    },
  );

  // ── POST book ──────────────────────────────────────────────────────────
  app.post<{ Body: TBookBody }>(
    '/api/appointments',
    {
      schema: {
        tags: ['appointments'],
        summary: 'Book an appointment (slot-verified transaction).',
        body: BookBody,
        response: {
          200: Type.Object({ id: Type.String(), status: Type.String() }),
          400: ErrorResponse,
          401: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      const b = req.body;
      const bookedBy = req.actor.id;
      const dur = durationFor(b.type, b.durationMinutes);
      const startsAt = new Date(b.startsAt);

      const id = await app.db
        .transaction(async (txAny) => {
          const tx = txAny as unknown as typeof app.db;

          // 1. Re-verify the slot inside the transaction (the list was advisory).
          const toIso = new Date(startsAt.getTime() + dur * 60_000 + 60_000).toISOString();
          const slot = (await tx.execute<{ ok: number }>(sql`
          SELECT 1 AS ok FROM available_slots(
            ${b.type}::appointment_type, ${dur},
            ${startsAt.toISOString()}::timestamptz, ${toIso}::timestamptz,
            ${b.staffUserId}::uuid, NULL::uuid
          )
          WHERE staff_user_id = ${b.staffUserId}::uuid
            AND slot_starts_at = ${startsAt.toISOString()}::timestamptz
          LIMIT 1
        `)) as unknown as Array<{ ok: number }>;
          if (slot.length === 0)
            throw new SlotUnavailableError('Selected slot is no longer available.');

          // 2. Insert the appointment (ledger emitted by AFTER INSERT trigger).
          const inserted = (await tx.execute<{ id: string }>(sql`
          INSERT INTO appointments
            (appointment_type, starts_at, duration_minutes, customer_id, staff_user_id,
             booked_by_user_id, booked_via, customer_notes)
          VALUES (${b.type}::appointment_type, ${startsAt.toISOString()}::timestamptz, ${dur},
                  ${b.customerId ?? null}::uuid, ${b.staffUserId}::uuid, ${bookedBy}::uuid,
                  ${b.bookedVia}, ${b.customerNotes ?? null})
          RETURNING id::text AS id
        `)) as unknown as Array<{ id: string }>;
          const apptId = inserted[0]?.id;
          if (!apptId) throw new AppointmentValidationError('appointment insert returned no row');

          // 3. VIEWING: link products → soft holds via the DB trigger.
          if (b.type === 'VIEWING' && b.linkedProductIds && b.linkedProductIds.length > 0) {
            for (const pid of b.linkedProductIds) {
              await tx.execute(sql`
              INSERT INTO appointment_linked_products (appointment_id, product_id, added_by_user_id)
              VALUES (${apptId}::uuid, ${pid}::uuid, ${bookedBy}::uuid)
            `);
            }
          }

          // 4. Schedule the reminder cadence.
          await scheduleReminders(
            tx,
            apptId,
            startsAt,
            b.customerEmail ?? null,
            b.customerPhone ?? null,
          );

          return apptId;
        })
        .catch((err: unknown) => {
          // The DB-level no-overlap EXCLUDE (migration 0069) is the real guard: a
          // concurrent winner makes our INSERT raise 23P01 even after the in-txn
          // re-check passed. Surface it as the same clean 409 slot-unavailable.
          if (isPgCode(err, '23P01')) {
            throw new SlotUnavailableError('Selected slot is no longer available.');
          }
          throw err;
        });

      // Mirror into the shop's Google Calendar (best-effort; covers POS staff
      // bookings AND the future WhatsApp bot, which books via this same route
      // with bookedVia='whatsapp_bot'). Registered-customer names are encrypted
      // PII and deliberately NOT sent to Google — the type label + any contact
      // fields supplied on the request are enough for the calendar.
      await mirrorAppointmentCreate(app.db, app.log, id, {
        type: b.type as AppointmentEventInput['type'],
        startIso: startsAt.toISOString(),
        durationMinutes: dur,
        phone: b.customerPhone ?? null,
        email: b.customerEmail ?? null,
        notes: b.customerNotes ?? null,
        source: b.bookedVia,
      });

      return reply.status(200).send({ id, status: 'SCHEDULED' });
    },
  );

  // ── PATCH status ─────────────────────────────────────────────────────────
  app.patch<{ Params: TIdParams; Body: TPatchBody }>(
    '/api/appointments/:id',
    {
      schema: {
        tags: ['appointments'],
        summary: 'Transition appointment status (trigger-validated graph).',
        params: IdParams,
        body: PatchBody,
        response: {
          200: Type.Object({ id: Type.String(), status: Type.String() }),
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      const { id } = req.params;
      const { status, cancellationReason, staffNotes } = req.body;

      // Notes-only metadata edit: no transition, no marker re-stamp.
      if (status === undefined) {
        if (staffNotes === undefined) {
          throw new AppointmentValidationError('Provide a status and/or staffNotes to update.');
        }
        const noteRows = (await app.db.execute<{ id: string; status: string }>(sql`
          UPDATE appointments
          SET staff_notes = ${staffNotes}
          WHERE id = ${id}::uuid
          RETURNING id::text AS id, status::text AS status
        `)) as unknown as Array<{ id: string; status: string }>;
        const noteRow = noteRows[0];
        if (!noteRow) throw new AppointmentNotFoundError(`Appointment ${id} not found`);
        return reply.status(200).send(noteRow);
      }

      const markerCol = STATUS_MARKER_COLUMN[status];

      // Build the marker SET clause via column name (whitelisted above).
      const markerSet =
        markerCol !== null && markerCol !== undefined
          ? sql`, ${sql.raw(markerCol)} = now()`
          : sql``;
      const cancelSet =
        status === 'CANCELLED'
          ? sql`, cancellation_reason = ${cancellationReason ?? 'cancelled'}`
          : sql``;
      const notesSet = staffNotes !== undefined ? sql`, staff_notes = ${staffNotes}` : sql``;

      const rows = (await app.db.execute<{
        id: string;
        status: string;
        google_event_id: string | null;
      }>(sql`
        UPDATE appointments
        SET status = ${status}::appointment_status ${markerSet} ${cancelSet} ${notesSet}
        WHERE id = ${id}::uuid
        RETURNING id::text AS id, status::text AS status, google_event_id
      `)) as unknown as Array<{ id: string; status: string; google_event_id: string | null }>;
      const row = rows[0];
      if (!row) throw new AppointmentNotFoundError(`Appointment ${id} not found`);

      // A cancellation removes the mirrored Google event (best-effort).
      if (status === 'CANCELLED') {
        await mirrorAppointmentDelete(app.db, app.log, id, row.google_event_id);
      }

      return reply.status(200).send({ id: row.id, status: row.status });
    },
  );

  // ── POST reschedule ────────────────────────────────────────────────────
  app.post<{ Params: TIdParams; Body: TRescheduleBody }>(
    '/api/appointments/:id/reschedule',
    {
      schema: {
        tags: ['appointments'],
        summary: 'Reschedule: clone to a new slot, link the chain, release old holds.',
        params: IdParams,
        body: RescheduleBody,
        response: {
          200: Type.Object({ id: Type.String(), rescheduledFrom: Type.String() }),
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      const { id } = req.params;
      const b = req.body;
      const bookedBy = req.actor.id;
      const startsAt = new Date(b.startsAt);

      const newId = await app.db.transaction(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;

        // Defer the no-overlap EXCLUDE to COMMIT (migration 0080 made it
        // DEFERRABLE). We must insert the clone before we can flip the original
        // to RESCHEDULED (the has-link CHECK needs the clone id), so a near-time
        // reschedule (same staff, new time overlaps the old) would otherwise
        // self-collide with the still-active original. By COMMIT the original is
        // RESCHEDULED and out of the constraint's set; a real overlap with a
        // DIFFERENT active appointment still raises 23P01 at COMMIT → 409.
        await tx.execute(sql`SET CONSTRAINTS appointments_no_staff_overlap DEFERRED`);

        const origRows = (await tx.execute<ApptRow>(sql`
          SELECT id::text AS id, appointment_type::text AS appointment_type, status::text AS status,
                 starts_at::text AS starts_at, duration_minutes,
                 staff_user_id::text AS staff_user_id, customer_id::text AS customer_id,
                 google_event_id, contact_name, contact_phone, contact_email, customer_notes
          FROM appointments WHERE id = ${id}::uuid LIMIT 1
        `)) as unknown as ApptRow[];
        const orig = origRows[0];
        if (!orig) throw new AppointmentNotFoundError(`Appointment ${id} not found`);
        if (['COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED'].includes(orig.status)) {
          throw new AppointmentValidationError(`Cannot reschedule a ${orig.status} appointment`);
        }

        const staffId = b.staffUserId ?? orig.staff_user_id;
        const dur = b.durationMinutes ?? orig.duration_minutes;

        // ⚠️ 02.08.2026: DIE HINTERTÜR. Bis hier prüfte der Verschiebe-Weg die
        // Kapazität mit KEINEM Blick. Der Anlege-Weg tut es sorgfältig gegen
        // `available_slots()` — hier stand nichts. Derselbe Mensch, der einen
        // Termin um 03:00 Uhr am Sonntag nicht ANLEGEN kann, konnte einen
        // bestehenden dorthin VERSCHIEBEN. Auch in einen Feiertag, auch in den
        // Urlaub des Mitarbeiters.
        //
        // Der Ausschluss-Riegel `appointments_no_staff_overlap` fängt das
        // nicht: er verhindert nur, dass sich zwei Termine DESSELBEN
        // Mitarbeiters überschneiden. Ein Termin um 03:00 Uhr kollidiert mit
        // niemandem — er ist einfach nachts.
        //
        // ⚠️ Und WARUM nicht einfach `available_slots()` auch hier: die
        // Funktion schliesst belegte Zeiten aus, und der URTERMIN ist in
        // diesem Augenblick noch aktiv. Wer um 15 Minuten verschiebt,
        // kollidierte mit sich selbst. Einen Ausschluss-Parameter hat sie
        // nicht — ihr sechster ist `p_shop_id` (Wanderung 0012, Zeile 447).
        //
        // Deshalb die ENGERE Frage, und nur sie: liegt diese Stunde in einer
        // Arbeitszeit, ausserhalb von Feiertag und Urlaub? Die Kollision bleibt
        // beim Riegel, wo sie hingehört.
        //
        // Die Wochentagsrechnung ist WÖRTLICH die aus `available_slots()`:
        // `EXTRACT(ISODOW …) - 1`, also Montag = 0. Eine zweite, eigene
        // Rechnung würde vom Motor abdriften, und die beiden Wege
        // widersprächen sich, ohne dass es jemandem auffällt.
        const endeIso = new Date(startsAt.getTime() + dur * 60_000).toISOString();
        const offen = (await tx.execute<{ ok: number }>(sql`
          WITH tag AS (
            SELECT (${startsAt.toISOString()}::timestamptz AT TIME ZONE 'Europe/Berlin')::date AS d
          )
          SELECT 1 AS ok
            FROM staff_working_hours wh, tag
           WHERE wh.user_id = ${staffId}::uuid
             AND wh.weekday = (EXTRACT(ISODOW FROM tag.d)::int - 1)
             AND wh.effective_from <= tag.d
             AND (wh.effective_until IS NULL OR wh.effective_until >= tag.d)
             AND ((tag.d::text || ' ' || wh.starts_at_local::text)::timestamp
                    AT TIME ZONE 'Europe/Berlin') <= ${startsAt.toISOString()}::timestamptz
             AND ((tag.d::text || ' ' || wh.ends_at_local::text)::timestamp
                    AT TIME ZONE 'Europe/Berlin') >= ${endeIso}::timestamptz
             AND NOT EXISTS (
               SELECT 1 FROM shop_holidays sh WHERE sh.closed_date = tag.d
             )
             AND NOT EXISTS (
               SELECT 1 FROM staff_time_off tof
                WHERE tof.user_id = ${staffId}::uuid
                  AND tof.starts_at < ${endeIso}::timestamptz
                  AND tof.ends_at   > ${startsAt.toISOString()}::timestamptz
             )
           LIMIT 1
        `)) as unknown as Array<{ ok: number }>;
        if (offen.length === 0) {
          throw new SlotUnavailableError(
            'Der gewünschte Zeitpunkt liegt ausserhalb der Arbeitszeit, oder auf einem ' +
              'Feiertag oder im Urlaub. Bitte eine Zeit innerhalb der hinterlegten ' +
              'Arbeitszeiten wählen, oder die Zeiten unter Termine anpassen.',
          );
        }

        // Insert the rescheduled clone, linked back to the original.
        const cloneRows = (await tx.execute<{ id: string }>(sql`
          INSERT INTO appointments
            (appointment_type, starts_at, duration_minutes, customer_id, staff_user_id,
             booked_by_user_id, booked_via, rescheduled_from_appointment_id)
          VALUES (${orig.appointment_type}::appointment_type, ${startsAt.toISOString()}::timestamptz,
                  ${dur}, ${orig.customer_id}::uuid, ${staffId}::uuid, ${bookedBy}::uuid,
                  'pos', ${orig.id}::uuid)
          RETURNING id::text AS id
        `)) as unknown as Array<{ id: string }>;
        const cloneId = cloneRows[0]?.id;
        if (!cloneId)
          throw new AppointmentValidationError('reschedule clone insert returned no row');

        // Point the original at the clone, then move it to RESCHEDULED.
        await tx.execute(sql`
          UPDATE appointments SET rescheduled_to_appointment_id = ${cloneId}::uuid WHERE id = ${orig.id}::uuid
        `);
        await tx.execute(sql`
          UPDATE appointments
          SET status = 'RESCHEDULED', cancellation_reason = ${b.reason ?? 'rescheduled'}
          WHERE id = ${orig.id}::uuid
        `);

        // Release the original's active soft holds.
        await tx.execute(sql`
          UPDATE product_viewing_holds
          SET released_at = now(), released_reason = 'rescheduled'
          WHERE appointment_id = ${orig.id}::uuid AND released_at IS NULL
        `);

        return { cloneId, orig, dur };
      });

      // Move the mirrored Google event to the new time and hand it to the clone
      // (best-effort). Carries over the original contact details.
      await mirrorAppointmentReschedule(
        app.db,
        app.log,
        newId.orig.id,
        newId.orig.google_event_id,
        newId.cloneId,
        {
          type: newId.orig.appointment_type as AppointmentEventInput['type'],
          startIso: startsAt.toISOString(),
          durationMinutes: newId.dur,
          name: newId.orig.contact_name,
          phone: newId.orig.contact_phone,
          email: newId.orig.contact_email,
          notes: newId.orig.customer_notes,
        },
      );

      return reply.status(200).send({ id: newId.cloneId, rescheduledFrom: id });
    },
  );

  // ── GET feed.ics (CONTRACT 3) ────────────────────────────────────────────
  //
  // PUBLIC path (lib/public-routes.ts PUBLIC_PATH_PATTERNS): calendar clients
  // (Google/Apple/Outlook subscriptions) can send neither a session cookie nor
  // an mTLS client cert. The unguessable 64-hex token IS the capability, same
  // model as the public photo routes. No token configured → the feed is OFF.
  app.get<{ Querystring: TFeedQuery }>(
    '/api/appointments/feed.ics',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['appointments'],
        summary: 'iCalendar feed of all non-cancelled appointments ±90 days (token-gated).',
        querystring: FeedQuery,
        // 200 is text/calendar (NOT JSON) — deliberately undeclared so the
        // serializer never touches the raw VCALENDAR string.
        response: { 401: ErrorResponse },
      },
    },
    async (req, reply) => {
      const supplied = req.query.token;
      const stored = (await app.db.execute<{ token: string | null }>(sql`
        SELECT value #>> '{}' AS token FROM system_settings
        WHERE key = ${ICS_FEED_TOKEN_KEY} LIMIT 1
      `)) as unknown as Array<{ token: string | null }>;
      const token = stored[0]?.token;
      if (!token || !supplied || !feedTokenMatches(supplied, token)) {
        throw new FeedTokenError('Ungültiger oder fehlender Feed-Token.');
      }

      // RESCHEDULED is excluded with CANCELLED: its replacement clone is in
      // the window already — emitting both would double-book the calendar.
      const rows = (await app.db.execute<FeedRow>(sql`
        SELECT a.id::text AS id, a.appointment_type::text AS appointment_type,
               a.status::text AS status, a.starts_at::text AS starts_at,
               a.ends_at::text AS ends_at, a.contact_name
        FROM appointments a
        WHERE a.starts_at >= now() - interval '90 days'
          AND a.starts_at <  now() + interval '90 days'
          AND a.status NOT IN ('CANCELLED', 'RESCHEDULED')
        ORDER BY a.starts_at ASC
      `)) as unknown as FeedRow[];

      return reply
        .status(200)
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('content-disposition', 'inline; filename="warehouse14-termine.ics"')
        .send(buildFeedCalendar(rows, new Date()));
    },
  );

  // ── POST feed-token — rotate (ADMIN) ────────────────────────────────────
  app.post(
    '/api/appointments/feed-token',
    {
      schema: {
        tags: ['appointments'],
        summary: 'Rotate the iCalendar feed token (ADMIN). Old token dies instantly.',
        response: {
          200: FeedTokenResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const token = randomBytes(32).toString('hex'); // 64 hex chars (CSPRNG)
      await app.db.execute(sql`
        INSERT INTO system_settings (key, value, description, updated_by_user_id)
        VALUES (${ICS_FEED_TOKEN_KEY}, to_jsonb(${token}::text),
                'Geheimer Zugriffstoken für den iCalendar-Termin-Feed (GET /api/appointments/feed.ics). Rotation über POST /api/appointments/feed-token.',
                ${req.actor.id}::uuid)
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value,
              updated_by_user_id = EXCLUDED.updated_by_user_id,
              updated_at = now()
      `);

      const host = req.headers.host ?? 'api.warehouse14.de';
      const url = `${req.protocol}://${host}/api/appointments/feed.ics?token=${token}`;
      return reply.status(200).send({ token, url });
    },
  );
};

export default appointmentsRoutes;
