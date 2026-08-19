/**
 * Öffnungs- und Arbeitszeiten eintragen.
 *
 * ── WARUM ES DIESE ROUTE GEBEN MUSS ────────────────────────────────────────
 *
 * `POST /api/appointments` prüft den gewünschten Zeitpunkt gegen
 * `available_slots()`. Diese Funktion baut ihre Kapazität mit einem CROSS JOIN
 * auf `staff_working_hours`.
 *
 * Diese Tabelle hatte im ganzen Server KEINEN Schreibweg. Kein INSERT, kein
 * UPDATE, keine Route. Und die Erstsaat füllt sie nicht.
 *
 * Ein CROSS JOIN auf eine leere Tabelle ergibt null Zeilen. Null Zeilen heisst
 * null freie Zeitfenster. Null Zeitfenster heisst 409 — bei JEDEM Versuch, für
 * immer.
 *
 * Am Tresen: der Inhaber wählt einen Kunden, eine Uhrzeit, drückt Anlegen und
 * liest „Dieser Zeitpunkt ist nicht mehr frei". Andere Uhrzeit, derselbe Satz.
 * Anderer Tag, derselbe Satz. Es gibt keine Uhrzeit, die je frei wäre — und
 * die Meldung lässt ihn glauben, es liege an der Auslastung.
 *
 * ⚠️ Warum es niemandem auffiel: der Integrationstest sät sich die
 * Arbeitszeiten in seiner eigenen Vorbereitung SELBST. Er ist grün und beweist
 * genau deshalb nichts über eine ausgelieferte Kasse.
 *
 * ── DIE ENTSCHEIDUNG: DIE WOCHE ALS GANZES ─────────────────────────────────
 *
 * `PUT` und nicht `POST`, und die Woche eines Menschen wird ERSETZT, nicht
 * ergänzt. Der Grund ist der CROSS JOIN: er multipliziert. Wüchse die Tabelle
 * bei jedem Speichern, zählte dieselbe Stunde mehrfach, und die Kasse
 * verspräche zwei Kunden denselben Termin.
 *
 * Eine LEERE Woche ist erlaubt und heisst: dieser Mensch nimmt keine Termine.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog } from '@norns/db/schema';

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { requireAuth, requireOwner } from '../lib/auth-policy.js';
import { pruefeWoche, WOCHENTAGE, type Zeitfenster } from '../lib/arbeitszeiten.js';

/**
 * Die Woche ist in sich widersprüchlich.
 *
 * 400 und nicht 409: es ist keine Kollision mit einem anderen Vorgang, sondern
 * eine Eingabe, die so nicht gemeint sein kann. Der Mensch muss sie ändern,
 * nicht wiederholen.
 */
export class ArbeitszeitUngueltigError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

const Fenster = Type.Object({
  wochentag: Type.Integer({ minimum: 0, maximum: 6 }),
  von: Type.String({ pattern: '^\\d{2}:\\d{2}$' }),
  bis: Type.String({ pattern: '^\\d{2}:\\d{2}$' }),
});

const arbeitszeitenRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/arbeitszeiten',
    {
      schema: {
        tags: ['termine'],
        summary: 'Die Arbeitszeiten aller Menschen dieses Betriebs',
        description:
          'Ohne mindestens einen Eintrag gibt es kein einziges freies Zeitfenster, und jeder ' +
          'Terminversuch endet mit 409.',
        response: {
          200: Type.Object({
            personen: Type.Array(
              Type.Object({
                userId: Type.String(),
                name: Type.String(),
                fenster: Type.Array(Fenster),
              }),
            ),
            /** Wahr, wenn NIEMAND Zeiten hat — dann sind gar keine Termine möglich. */
            keineZeitenHinterlegt: Type.Boolean(),
            wochentage: Type.Array(
              Type.Object({ nummer: Type.Integer(), name: Type.String() }),
            ),
          }),
        },
      },
    },
    async (req) => {
      requireAuth(req);
      const zeilen = await app.db.execute<{
        user_id: string;
        name: string;
        weekday: number;
        von: string;
        bis: string;
      }>(drizzleSql`
        SELECT u.id::text AS user_id,
               u.name,
               w.weekday,
               to_char(w.starts_at_local, 'HH24:MI') AS von,
               to_char(w.ends_at_local,   'HH24:MI') AS bis
          FROM users u
          LEFT JOIN staff_working_hours w
                 ON w.user_id = u.id
                AND (w.effective_until IS NULL
                     OR w.effective_until >= (now() AT TIME ZONE 'Europe/Berlin')::date)
         WHERE u.soft_deleted_at IS NULL
         ORDER BY u.name, w.weekday, w.starts_at_local`);

      const karte = new Map<string, { userId: string; name: string; fenster: Zeitfenster[] }>();
      for (const z of zeilen) {
        const eintrag = karte.get(z.user_id) ?? { userId: z.user_id, name: z.name, fenster: [] };
        // Der LEFT JOIN liefert für Menschen ohne Zeiten eine Zeile mit NULL.
        // Sie gehören in die Liste — sonst könnte man ihnen nie welche geben.
        if (z.weekday !== null && z.von !== null && z.bis !== null) {
          eintrag.fenster.push({ wochentag: z.weekday, von: z.von, bis: z.bis });
        }
        karte.set(z.user_id, eintrag);
      }
      const personen = [...karte.values()];
      return {
        personen,
        keineZeitenHinterlegt: personen.every((p) => p.fenster.length === 0),
        wochentage: WOCHENTAGE.map((t) => ({ nummer: t.nummer, name: t.name })),
      };
    },
  );

  app.put(
    '/api/arbeitszeiten',
    {
      schema: {
        tags: ['termine'],
        summary: 'Die Woche eines Menschen setzen',
        description:
          'ERSETZT die Woche dieses Menschen vollständig. Eine leere Liste heisst: er nimmt ' +
          'keine Termine an.',
        body: Type.Object({
          userId: Type.String({ format: 'uuid' }),
          fenster: Type.Array(Fenster),
        }),
        response: {
          200: Type.Object({
            userId: Type.String(),
            anzahl: Type.Integer(),
          }),
        },
      },
    },
    async (req) => {
      requireAuth(req);
      // Wer die Zeiten setzt, bestimmt, wann der Laden Termine annimmt. Das ist
      // keine Kassiererhandlung.
      requireOwner(req);

      const body = req.body as { userId: string; fenster: Zeitfenster[] };
      const { fehler } = pruefeWoche(body.fenster);
      if (fehler.length > 0) {
        // Alle Fehler auf einmal. Ein Formular, das sie einzeln meldet, macht
        // aus einer Korrektur fünf Anläufe.
        throw new ArbeitszeitUngueltigError(fehler.join(' '));
      }

      return app.db.transaction(async (tx) => {
        const wer = await tx.execute<{ id: string; name: string }>(drizzleSql`
          SELECT id::text AS id, name FROM users
           WHERE id = ${body.userId}::uuid AND soft_deleted_at IS NULL`);
        const mensch = wer[0];
        if (!mensch) {
          throw new ArbeitszeitUngueltigError(
            'Diese Person gibt es nicht (mehr). Bitte die Liste neu laden.',
          );
        }

        // ⚠️ ERSETZEN, nicht ergänzen. Der CROSS JOIN in `available_slots()`
        // multipliziert; angehäufte Zeilen ergäben doppelte Plätze zur selben
        // Stunde, und die Kasse verspräche zwei Kunden denselben Termin.
        await tx.execute(drizzleSql`
          DELETE FROM staff_working_hours WHERE user_id = ${body.userId}::uuid`);

        for (const f of body.fenster) {
          await tx.execute(drizzleSql`
            INSERT INTO staff_working_hours (user_id, weekday, starts_at_local, ends_at_local)
            VALUES (${body.userId}::uuid, ${f.wochentag}::smallint,
                    ${f.von}::time, ${f.bis}::time)`);
        }

        await tx.insert(auditLog).values({
          eventType: 'arbeitszeiten.gesetzt',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          payload: { userId: body.userId, name: mensch.name, fenster: body.fenster },
        });

        return { userId: body.userId, anzahl: body.fenster.length };
      });
    },
  );
};

export default arbeitszeitenRoutes;
