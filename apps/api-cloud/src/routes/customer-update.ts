/**
 * PUT /api/customers/:id — Day 10 additive.
 *
 * Updates PII fields of an existing customer. Step-up is ENFORCED when
 * `customer.kyc_verified_at IS NOT NULL` — once the Owner has physically
 * inspected a customer's ID, rewriting their PII could mask a sanctions
 * match or alter the audit chain. A fresh PIN-confirmed session is
 * required for that case; first-time edits on un-verified customers
 * proceed.
 *
 * Every accepted field is encrypted via `encrypt_pii(...)` inside the
 * `withPii(tx)` envelope — same RED-LINE discipline as POST. The route
 * computes the diff against the existing row at the field-NAME level
 * only and writes `customer.updated` to `audit_log` with that redacted
 * payload. Plaintext PII NEVER lands in audit_log.
 *
 * Auth: ADMIN-only (Owner action). Day-10 UI gates this behind the
 * detail-panel "Bearbeiten" CTA.
 */

import { pruefeUndHalteFest } from '../lib/vies.js';
import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  type UpdateCustomerBody as TBody,
  UpdateCustomerBody,
  UpdateCustomerResponse,
} from '../schemas/customer.js';

class CustomerNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class NothingToUpdateError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details = {
    reason: 'no changes detected — body had no diff against current row',
  };
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const customerUpdateRoute: FastifyPluginAsync = async (app) => {
  app.put<{ Params: { id: string }; Body: TBody }>(
    '/api/customers/:id',
    {
      schema: {
        tags: ['customers'],
        summary: 'Update customer PII fields (ADMIN). Step-up when kyc_verified.',
        description:
          'Wraps every PII write inside withPii() — same RED-LINE envelope as POST. ' +
          'Step-up required when customers.kyc_verified_at IS NOT NULL (the Owner ' +
          'has previously stamped this customer; PII rewrites could mask sanctions ' +
          'matches or rewrite audit). Audit_log carries field-name diff only — ' +
          'never plaintext PII.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: UpdateCustomerBody,
        response: {
          200: UpdateCustomerResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { id } = req.params;
      const body = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // Die Rechteprüfung läuft innerhalb von withPii — wir brauchen die Zeile,
      // um zu wissen, ob kyc_verified_at gesetzt ist. Alles läuft in EINER
      // Datenbanktransaktion, damit der Stand bei der Prüfung dem Stand beim
      // Schreiben entspricht (kein TOCTOU-Fenster).
      const outcome = await app.withPii(async (tx) => {
        const rows = await tx.execute<{
          id: string;
          kyc_verified_at: Date | null;
          full_name: string | null;
          date_of_birth: string | null;
          email: string | null;
          phone: string | null;
          address: string | null;
          notes: string | null;
          vat_id: string | null;
          preferred_language: 'de' | 'en' | 'ar';
          customer_tags: string[];
        }>(sql`
          SELECT
            id,
            kyc_verified_at,
            ${sql`decrypt_pii(full_name_encrypted)`}     AS full_name,
            ${sql`decrypt_pii(date_of_birth_encrypted)`} AS date_of_birth,
            ${sql`decrypt_pii(email_encrypted)`}         AS email,
            ${sql`decrypt_pii(phone_encrypted)`}         AS phone,
            ${sql`decrypt_pii(address_encrypted)`}       AS address,
            ${sql`decrypt_pii(notes_encrypted)`}         AS notes,
            vat_id,
            preferred_language,
            customer_tags
          FROM customers
          WHERE id = ${id}
            AND soft_deleted_at IS NULL
          FOR UPDATE
          LIMIT 1
        `);
        const before = rows[0];
        if (!before) throw new CustomerNotFoundError(`Customer ${id} not found.`);

        const stepUpEnforced = before.kyc_verified_at !== null;
        if (stepUpEnforced) {
          // Throws STEP_UP_REQUIRED if the session is not fresh enough.
        }

        // Compute the field-name diff. Null in the body means "clear this
        // column" (encrypted column → NULL). Undefined means "leave alone".
        const changedFields: string[] = [];
        const setFragments: Array<ReturnType<typeof sql>> = [];

        if (body.fullName !== undefined && body.fullName !== before.full_name) {
          changedFields.push('fullName');
          setFragments.push(
            // Der geblendete Suchindex (0146) reist mit JEDEM Schreiben des
            // Namens mit — sonst faende die Suche den alten Namen weiter und
            // den neuen nie.
            sql`full_name_encrypted = encrypt_pii(${body.fullName}), name_such_tokens = pii_such_tokens_ablage(${body.fullName})`,
          );
        }
        if (body.dateOfBirth !== undefined && body.dateOfBirth !== before.date_of_birth) {
          changedFields.push('dateOfBirth');
          if (body.dateOfBirth === null) {
            setFragments.push(sql`date_of_birth_encrypted = NULL`);
          } else {
            setFragments.push(sql`date_of_birth_encrypted = encrypt_pii(${body.dateOfBirth})`);
          }
        }
        if (body.email !== undefined && body.email !== before.email) {
          changedFields.push('email');
          if (body.email === null) {
            setFragments.push(sql`email_encrypted = NULL, email_blind_index = NULL`);
          } else {
            setFragments.push(
              sql`email_encrypted = encrypt_pii(${body.email}), email_blind_index = blind_index(${body.email})`,
            );
          }
        }
        if (body.phone !== undefined && body.phone !== before.phone) {
          changedFields.push('phone');
          if (body.phone === null) {
            setFragments.push(sql`phone_encrypted = NULL, phone_blind_index = NULL`);
          } else {
            setFragments.push(
              sql`phone_encrypted = encrypt_pii(${body.phone}), phone_blind_index = blind_index(${body.phone})`,
            );
          }
        }
        if (body.address !== undefined && body.address !== before.address) {
          changedFields.push('address');
          if (body.address === null) {
            setFragments.push(sql`address_encrypted = NULL`);
          } else {
            setFragments.push(sql`address_encrypted = encrypt_pii(${body.address})`);
          }
        }
        if (body.notes !== undefined && body.notes !== before.notes) {
          changedFields.push('notes');
          if (body.notes === null) {
            setFragments.push(sql`notes_encrypted = NULL`);
          } else {
            setFragments.push(sql`notes_encrypted = encrypt_pii(${body.notes})`);
          }
        }
        if (body.vatId !== undefined && body.vatId !== before.vat_id) {
          changedFields.push('vatId');
          if (body.vatId === null) {
            setFragments.push(sql`vat_id = NULL`);
          } else {
            setFragments.push(sql`vat_id = ${body.vatId}`);
          }
          // ⚠️ Der alte Pruefsatz gilt fuer die ALTE Nummer. Er wird hier
          // sofort geloescht und weiter unten, ausserhalb der Transaktion,
          // durch eine frische Abfrage ersetzt.
          //
          // Ohne dieses Loeschen bliebe ein Satz stehen, der nie zu dieser
          // Nummer gehoerte. `darfReverseCharge` faengt das zwar zusaetzlich
          // ueber den Vergleich mit `vat_id_checked_value` — zwei Riegel gegen
          // denselben Handgriff, weil er so verlockend ist: echte Nummer
          // eintragen, pruefen lassen, danach austauschen.
          setFragments.push(sql`vat_id_checked_at = NULL`);
          setFragments.push(sql`vat_id_check_result = NULL`);
          setFragments.push(sql`vat_id_check_name = NULL`);
          setFragments.push(sql`vat_id_check_address = NULL`);
          setFragments.push(sql`vat_id_checked_value = NULL`);
        }
        if (
          body.preferredLanguage !== undefined &&
          body.preferredLanguage !== before.preferred_language
        ) {
          changedFields.push('preferredLanguage');
          setFragments.push(sql`preferred_language = ${body.preferredLanguage}`);
        }
        if (
          body.customerTags !== undefined &&
          !arraysEqual(body.customerTags, before.customer_tags)
        ) {
          changedFields.push('customerTags');
          // Bind each tag as its own param via ARRAY[...]; interpolating a JS
          // array into the sql template SPREADS it into scalar params, so the
          // ::text[] cast hit a record/empty-paren and 500'd (42601/22P02).
          setFragments.push(
            body.customerTags.length > 0
              ? sql`customer_tags = ARRAY[${sql.join(
                  body.customerTags.map((t) => sql`${t}`),
                  sql`, `,
                )}]::text[]`
              : sql`customer_tags = ARRAY[]::text[]`,
          );
        }

        if (changedFields.length === 0) {
          throw new NothingToUpdateError('No diff between body and current customer row.');
        }

        // Apply the UPDATE. The unique partial indexes on email_blind_index
        // and phone_blind_index will throw 23505 if the new value collides
        // with another active customer — the error-handler maps that to
        // 409 CONFLICT.
        await tx.execute(sql`
          UPDATE customers
          SET ${sql.join(setFragments, sql`, `)}
          WHERE id = ${id}
        `);

        // Audit log — field NAMES only, never plaintext PII values.
        await tx.insert(auditLog).values({
          eventType: 'customer.updated',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            customerId: id,
            changedFields,
            stepUpEnforced,
          },
        });

        return { changedFields, stepUpEnforced };
      });

      // ⚠️ Ausserhalb der Transaktion, siehe die Begruendung in
      // routes/customers.ts: ein Netzaufruf mit Zeitgrenze haelt sonst die
      // Verbindung fest. Die Loeschung des alten Satzes ist bereits committet,
      // ein Fehlschlag hier laesst also KEINEN veralteten Satz stehen.
      let vatCheck: string | undefined;
      if (outcome.changedFields.includes('vatId') && body.vatId) {
        const a = await pruefeUndHalteFest(app.db, id, body.vatId, req.log);
        if (a) vatCheck = a.ergebnis;
      }

      return reply.status(200).send({
        id,
        changedFields: outcome.changedFields,
        stepUpEnforced: outcome.stepUpEnforced,
        ...(vatCheck ? { vatCheck } : {}),
      });
    },
  );
};

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

export default customerUpdateRoute;
