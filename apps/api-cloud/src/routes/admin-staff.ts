/**
 * Staff administration (Track A3) — the visual replacement for the provisioning
 * script. The Owner adds / re-roles a staff member (whose Google email then
 * unlocks the app) and can deactivate one.
 *
 *   GET  /api/admin/staff              — list active staff (ADMIN read).
 *   POST /api/admin/staff             — provision / re-role (OWNER + step-up).
 *   POST /api/admin/staff/:id/deactivate — soft-delete a member (OWNER + step-up).
 *
 * Role writes go through the SECURITY DEFINER `provision_staff()` function
 * (migration 0084), never a direct UPDATE — the app role stays REVOKEd from
 * `users.role`. `is_owner` is never touched here. The Owner cannot deactivate
 * themselves or the Owner row.
 */

import { Type } from '@sinclair/typebox';
import { and, eq, isNull, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, users } from '@norns/db/schema';

import { ForbiddenError, requireAuth, requireOwner, requireRole, requireStepUp } from '../lib/auth-policy.js';

const RoleEnum = Type.Union([
  Type.Literal('ADMIN'),
  Type.Literal('CASHIER'),
  Type.Literal('READONLY'),
]);

const CreateBody = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 200, format: 'email' }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  role: RoleEnum,
});

interface CreateShape {
  email: string;
  name: string;
  role: 'ADMIN' | 'CASHIER' | 'READONLY';
}

const adminStaffRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/admin/staff ──────────────────────────────────────────────
  app.get(
    '/api/admin/staff',
    { schema: { tags: ['auth'], summary: 'List active staff members.' } },
    async (req) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const rows = await app.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          isOwner: users.isOwner,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(isNull(users.softDeletedAt))
        .orderBy(users.createdAt);
      return {
        items: rows.map((r) => ({
          id: r.id,
          email: r.email,
          name: r.name,
          role: r.role,
          isOwner: r.isOwner,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  // ── POST /api/admin/staff ─────────────────────────────────────────────
  app.post(
    '/api/admin/staff',
    { schema: { tags: ['auth'], summary: 'Provision or re-role a staff member.', body: CreateBody } },
    async (req) => {
      requireAuth(req);
      requireOwner(req);
      requireStepUp(req);

      const body = req.body as CreateShape;
      const email = body.email.trim().toLowerCase();

      const id = await app.db.transaction(async (tx) => {
        const rows = await tx.execute<{ id: string }>(drizzleSql`
          SELECT provision_staff(${email}::citext, ${body.name.trim()}, ${body.role}::user_role) AS id`);
        const newId = rows[0]?.id;
        if (!newId) throw new Error('provision_staff returned no id');
        await tx.insert(auditLog).values({
          eventType: 'staff.provisioned',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          payload: { staffUserId: newId, email, role: body.role },
        });
        return newId;
      });

      return { ok: true as const, id, email, name: body.name.trim(), role: body.role };
    },
  );

  // ── POST /api/admin/staff/:id/kassencode-loeschen ─────────────────────
  //
  // Der Inhaber gibt einem Mitarbeiter KEINEN Code. Er nimmt ihm den seinen weg.
  //
  // ⚠️ 02.08.2026, und der Unterschied ist der ganze Punkt.
  //
  // Der nächstliegende Bau wäre: der Inhaber tippt dem Mitarbeiter einen Code
  // ein. Dann KENNT er ihn. Und damit wäre die Bedienerzuordnung nach § 146a AO
  // wertlos, denn jede Buchung dieses Mitarbeiters könnte ebenso gut vom Inhaber
  // stammen. Ein Prüfer, der das bemerkt, hat recht.
  //
  // Deshalb: löschen. Der Mitarbeiter setzt danach am Tresen seinen EIGENEN
  // ersten Code über den Weg, der für den Erstanspruch des Inhabers ohnehin
  // schon gebaut ist (`pin-login` antwortet PIN_NOT_SET, die Maske schaltet auf
  // „einrichten"). Niemand kennt je den Code eines anderen.
  //
  // Dasselbe Tor deckt auch den Alltagsfall ab: ein Mitarbeiter hat seinen Code
  // vergessen. Der Inhaber löscht, der Mitarbeiter setzt neu.
  //
  // ⚠️ BEIDE Spalten müssen zusammen auf NULL. Die Prüfbedingung
  // `users_pin_hash_set_together` verlangt, dass `pos_pin_hash` und
  // `pos_pin_set_at` gemeinsam gesetzt oder gemeinsam leer sind; eine allein
  // genullt bricht die Zeile.
  //
  // Die Sperrzählung wird mit zurückgesetzt: wer keinen Code mehr hat, kann
  // nicht mehr falsch tippen, und ein stehengebliebener Zähler würde den
  // frisch gesetzten Code sofort wieder aussperren.
  app.post(
    '/api/admin/staff/:id/kassencode-loeschen',
    {
      schema: {
        tags: ['auth'],
        summary: 'Kassencode eines Mitarbeiters loeschen, damit er einen eigenen setzen kann',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (req) => {
      requireAuth(req);
      requireOwner(req);
      requireStepUp(req);

      const { id } = req.params as { id: string };

      await app.db.transaction(async (tx) => {
        await tx.execute(drizzleSql`
          UPDATE users
             SET pos_pin_hash = NULL,
                 pos_pin_set_at = NULL,
                 pos_pin_failed_attempts = 0,
                 pos_pin_locked_until = NULL
           WHERE id = ${id}::uuid`);
        await tx.insert(auditLog).values({
          eventType: 'staff.kassencode_geloescht',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          // Der Code selbst taucht hier nirgends auf; es gibt ihn nicht mehr.
          payload: { staffUserId: id },
        });
      });

      return { ok: true as const };
    },
  );

  // ── POST /api/admin/staff/:id/deactivate ──────────────────────────────
  app.post(
    '/api/admin/staff/:id/deactivate',
    {
      schema: {
        tags: ['auth'],
        summary: 'Deactivate (soft-delete) a staff member.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (req) => {
      requireAuth(req);
      requireOwner(req);
      requireStepUp(req);

      const { id } = req.params as { id: string };
      if (id === req.actor.id) {
        throw new ForbiddenError('Das eigene Konto kann nicht deaktiviert werden.');
      }

      const done = await app.db.transaction(async (tx) => {
        // Never the Owner, never an already-deactivated row.
        const res = await tx
          .update(users)
          .set({ softDeletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(eq(users.id, id), eq(users.isOwner, false), isNull(users.softDeletedAt)),
          )
          .returning({ id: users.id });
        if (res.length > 0) {
          await tx.insert(auditLog).values({
            eventType: 'staff.deactivated',
            actorUserId: req.actor.id,
            deviceId: req.deviceId ?? null,
            ipAddress: req.ip ?? null,
            userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
            payload: { staffUserId: id },
          });
        }
        return res.length > 0;
      });

      return { ok: true as const, deactivated: done };
    },
  );
};

export default adminStaffRoutes;
