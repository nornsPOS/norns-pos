/**
 * Geräte, die Benachrichtigungen empfangen dürfen (0103).
 *
 *   POST   /api/devices/push-token   Marke anmelden oder auffrischen
 *   DELETE /api/devices/push-token   Marke widerrufen (Abmeldung, Abschalten)
 *
 * EINE MARKE GEHÖRT ZU EINEM GERÄT, NICHT ZU EINEM MENSCHEN.
 * Meldet sich jemand anders auf demselben Telefon an, wandert die Marke zum
 * neuen Benutzer. Deshalb liegt der eindeutige Index auf der Marke allein: das
 * `ON CONFLICT (token)` schreibt den Besitzer um, statt eine zweite Zeile
 * anzulegen, die dem vorigen Benutzer weiter fremde Bestellungen meldet.
 *
 * Die Abmeldung widerruft, statt zu löschen. Eine gelöschte Zeile lässt sich
 * nicht mehr von einer nie angelegten unterscheiden, und beim Nachsehen, warum
 * jemand nichts bekommt, ist genau das die Frage.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth } from '../lib/auth-policy.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const RegisterBody = Type.Object({
  token: Type.String({ minLength: 8, maxLength: 400 }),
  platform: Type.Union([Type.Literal('ios'), Type.Literal('android')]),
  app: Type.Union([Type.Literal('owner'), Type.Literal('cashier')]),
  deviceLabel: Type.Optional(Type.String({ maxLength: 120 })),
});
type TRegisterBody = {
  token: string;
  platform: 'ios' | 'android';
  app: 'owner' | 'cashier';
  deviceLabel?: string;
};

const RevokeBody = Type.Object({ token: Type.String({ minLength: 8, maxLength: 400 }) });

const devicesRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TRegisterBody }>(
    '/api/devices/push-token',
    {
      schema: {
        tags: ['devices'],
        summary: 'Dieses Gerät für Benachrichtigungen anmelden.',
        body: RegisterBody,
        response: {
          200: Type.Object({ ok: Type.Boolean() }),
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      const b = req.body;
      await app.db.execute(drizzleSql`
        INSERT INTO device_push_tokens (user_id, token, platform, app, device_label)
        VALUES (${req.actor!.id}::uuid, ${b.token}, ${b.platform}, ${b.app},
                ${b.deviceLabel ?? null})
        ON CONFLICT (token) DO UPDATE
           SET user_id      = EXCLUDED.user_id,
               platform     = EXCLUDED.platform,
               app          = EXCLUDED.app,
               device_label = EXCLUDED.device_label,
               last_seen_at = now(),
               revoked_at   = NULL`);
      return reply.status(200).send({ ok: true });
    },
  );

  app.delete<{ Body: { token: string } }>(
    '/api/devices/push-token',
    {
      schema: {
        tags: ['devices'],
        summary: 'Dieses Gerät von Benachrichtigungen abmelden.',
        body: RevokeBody,
        response: {
          200: Type.Object({ ok: Type.Boolean(), revoked: Type.Boolean() }),
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      // `revoked` sagt ehrlich, ob wirklich etwas widerrufen wurde. War die
      // Marke schon fort oder gehörte sie nie diesem Menschen, ist das kein
      // Fehler, aber es ist auch kein Widerruf, und der Aufrufer erfährt es.
      const rows = (await app.db.execute<{ id: string }>(drizzleSql`
        UPDATE device_push_tokens SET revoked_at = now()
         WHERE token = ${req.body.token}
           AND user_id = ${req.actor!.id}::uuid
           AND revoked_at IS NULL
        RETURNING id::text AS id`)) as unknown as Array<{ id: string }>;
      return reply.status(200).send({ ok: true, revoked: rows.length > 0 });
    },
  );
};

export default devicesRoutes;
