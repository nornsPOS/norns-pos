/**
 * customer-erasure.ts — GDPR Art. 17 (Recht auf Löschung / right to erasure).
 *
 *   POST /api/customers/:id/erase — ADMIN-only + step-up.
 *
 * Anonymize-in-place: the SECURITY DEFINER `erase_customer()` (migration 0078)
 * scrubs PII across ~15 tables, deletes/purges KYC document rows, and keeps the
 * fiscal/GoBD/GwG records (transactions, tse_*, ledger, kyc shells) with embedded
 * PII NULLed — §147 AO / §257 HGB 10-year retention overrides Art.17
 * (Art.17(3)(b), legal obligation). `customer_number` survives as a fiscal-join
 * pseudonym. The function runs inside `withPii()` so `encrypt_pii('GELOESCHT')`
 * for the NOT NULL name tombstone resolves, and returns the object-store / disk
 * keys this route unlinks AFTER commit. The audit entry is REDACTED — never the
 * erased PII, only counts.
 */
import { Type } from '@sinclair/typebox';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, customers } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { deleteKycImage } from '../lib/kyc-store.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class CustomerNotFoundError extends DomainError {
  public readonly code: ApiErrorCode = 'NOT_FOUND';
  public readonly httpStatus = 404;
}

interface ErasureOpts {
  env: Env;
}

const customerErasureRoute: FastifyPluginAsync<ErasureOpts> = async (app, opts) => {
  app.post(
    '/api/customers/:id/erase',
    {
      schema: {
        tags: ['customers'],
        summary:
          'GDPR Art.17: anonymize-in-place a customer + delete their KYC images. ' +
          'Fiscal/GoBD/GwG records are kept (embedded PII redacted). ADMIN + step-up.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: Type.Object({ ok: Type.Boolean(), erasedAt: Type.String() }),
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const { id } = req.params as { id: string };
      const actorId = req.actor.id;

      const exists = await app.db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);
      if (exists.length === 0) {
        throw new CustomerNotFoundError(`Customer ${id} not found.`);
      }

      // Anonymize + audit, atomically, inside a withPii tx (so encrypt_pii() for
      // the name tombstone resolves). erase_customer() returns {kyc_storage_keys,
      // r2_keys} for the post-commit file unlink.
      const keys = await app.withPii(async (tx) => {
        const rows = (await tx.execute(
          sql`SELECT erase_customer(${id}::uuid, ${actorId}::uuid) AS keys`,
        )) as unknown as Array<{
          keys: { kyc_storage_keys: string[]; r2_keys: string[] };
        }>;
        const k = rows[0]?.keys ?? { kyc_storage_keys: [], r2_keys: [] };

        // WER die Löschung veranlasst hat, im selben Vorgang festhalten (0103).
        // Für die Akte ist der Unterschied wesentlich: ein Kunde, der sein
        // Konto selbst gelöscht hat, hat eine Entscheidung getroffen; eine von
        // UNS gelöschte Akte ist unsere Handlung und muss als solche
        // nachweisbar sein (DSGVO Art. 5(2)). Ohne diese Zeile stünde auf der
        // Zeile nur DASS gelöscht wurde, und die Oberfläche müsste raten.
        await tx.execute(
          sql`UPDATE customers SET erasure_initiated_by = 'STAFF' WHERE id = ${id}::uuid`,
        );
        await tx.insert(auditLog).values({
          eventType: 'customer.erased',
          actorUserId: actorId,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          // REDACTED — never the erased PII, only counts.
          payload: {
            customerId: id,
            kycImagesDeleted: k.kyc_storage_keys?.length ?? 0,
            r2ObjectsRedacted: k.r2_keys?.length ?? 0,
          },
        });
        return k;
      });

      // Post-commit: unlink the encrypted KYC image files (best-effort, never throws).
      for (const key of keys.kyc_storage_keys ?? []) {
        await deleteKycImage(opts.env.KYC_PHOTOS_DIR, key).catch(() => {});
      }
      // R2 objects: the DB references are already redacted; physical R2 cleanup is a
      // follow-up (R2 currently unconfigured, R2_BUCKET empty).

      return reply.code(200).send({ ok: true, erasedAt: new Date().toISOString() });
    },
  );
};

export default customerErasureRoute;
