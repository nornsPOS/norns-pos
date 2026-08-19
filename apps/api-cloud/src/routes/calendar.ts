/**
 * /api/calendar — the shop's Google Calendar, managed through the server-side
 * service account (lib/google-calendar.ts). The POS reads + writes events here
 * (full control); the calendar is also the data layer the future WhatsApp /
 * online-booking flow plugs into.
 *
 *   GET    /api/calendar/status            → { configured }
 *   GET    /api/calendar/events?days=28    → CalendarEvent[]
 *   POST   /api/calendar/events            → create  → CalendarEvent
 *   PATCH  /api/calendar/events/:id        → update  → CalendarEvent
 *   DELETE /api/calendar/events/:id        → 204  (ADMIN)
 *
 * All endpoints require an authenticated staff session.
 */

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import { runCalendarPull } from '../lib/calendar-pull.js';
import { classifyWatchNotification } from '../lib/calendar-watch.js';
import {
  type CalendarEventInput,
  calendarConfigured,
  createEvent,
  deleteEvent,
  GoogleCalendarError,
  listEvents,
  updateEvent,
} from '../lib/google-calendar.js';
import { requireRole } from '../lib/auth-policy.js';

const EventSchema = Type.Object({
  id: Type.String(),
  summary: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  location: Type.Union([Type.String(), Type.Null()]),
  start: Type.String(),
  end: Type.Union([Type.String(), Type.Null()]),
  allDay: Type.Boolean(),
  htmlLink: Type.Union([Type.String(), Type.Null()]),
});

const EventInputSchema = Type.Object({
  summary: Type.String({ minLength: 1, maxLength: 300 }),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
  location: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  start: Type.String({ minLength: 8 }),
  end: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  allDay: Type.Optional(Type.Boolean()),
});

const calendarRoute: FastifyPluginAsync = async (app) => {
  // map a thrown GoogleCalendarError onto an HTTP reply
  const send = async <T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GoogleCalendarError) {
        const code = err.status >= 400 && err.status < 600 ? err.status : 502;
        void reply.code(code).send({ error: { code: 'CALENDAR_ERROR', message: err.message } });
        return undefined;
      }
      throw err;
    }
  };

  app.get(
    '/api/calendar/status',
    { schema: { response: { 200: Type.Object({ configured: Type.Boolean() }) } } },
    async (req) => {
      requireRole(req, 'ADMIN', 'CASHIER', 'READONLY');
      return { configured: calendarConfigured() };
    },
  );

  // PUBLIC (in PUBLIC_PATH_PATTERNS): Google's events.watch push callback. It
  // carries no auth — the secret is the X-Goog-Channel-Token we set on watch().
  // Body is empty (just "something changed") → run the incremental pull. Always
  // 200 fast so Google doesn't retry/back off; never reveal token validity.
  app.post('/api/calendar/notifications', async (req, reply) => {
    const h = req.headers as Record<string, string | undefined>;
    const { triggerPull } = classifyWatchNotification(
      h['x-goog-channel-token'],
      h['x-goog-resource-state'],
      process.env.CALENDAR_WEBHOOK_TOKEN ?? '',
    );
    if (triggerPull) {
      void runCalendarPull(app.db, app.log).catch((err: unknown) =>
        app.log.error({ err }, 'calendar watch: triggered pull failed'),
      );
    }
    return reply.code(200).send();
  });

  app.get(
    '/api/calendar/events',
    {
      schema: {
        querystring: Type.Object({ days: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })) }),
        response: { 200: Type.Array(EventSchema) },
      },
    },
    async (req, reply) => {
      requireRole(req, 'ADMIN', 'CASHIER', 'READONLY');
      const { days } = req.query as { days?: number };
      return send(reply, () => listEvents({ daysAhead: days ?? 28 }));
    },
  );

  app.post(
    '/api/calendar/events',
    { schema: { body: EventInputSchema, response: { 200: EventSchema } } },
    async (req, reply) => {
      requireRole(req, 'ADMIN', 'CASHIER');
      return send(reply, () => createEvent(req.body as CalendarEventInput));
    },
  );

  app.patch(
    '/api/calendar/events/:id',
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: EventInputSchema,
        response: { 200: EventSchema },
      },
    },
    async (req, reply) => {
      requireRole(req, 'ADMIN', 'CASHIER');
      const { id } = req.params as { id: string };
      return send(reply, () => updateEvent(id, req.body as CalendarEventInput));
    },
  );

  app.delete(
    '/api/calendar/events/:id',
    { schema: { params: Type.Object({ id: Type.String() }) } },
    async (req, reply) => {
      requireRole(req, 'ADMIN');
      const { id } = req.params as { id: string };
      await send(reply, async () => {
        await deleteEvent(id);
      });
      if (!reply.sent) void reply.code(204).send();
    },
  );
};

export default calendarRoute;
