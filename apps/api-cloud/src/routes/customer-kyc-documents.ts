/**
 * KYC ID-document routes.
 *
 *   POST /api/customers/:id/kyc-documents               — capture an Ausweis
 *   GET  /api/customers/:id/kyc-documents/:docId/image  — view the Ausweis
 *
 * Migration 0074 moved the image off the never-configured R2 to a LOCAL
 * AES-256-GCM-encrypted file (see lib/kyc-store.ts). The POST takes the image
 * BYTES (base64), compresses + EXIF-strips + encrypts server-side, computes the
 * sha256, and binds a kyc_documents row. The document number stays
 * `encrypt_pii` (the PII red line — untouched).
 *
 * ⚰️ 22.08.2026: hier stand „Both routes: … + requireStepUp". Der Satz wurde
 * geschrieben, als es zwei Wege gab — die beiden LOESCHwege. Es sind vier,
 * und die zwei juengeren tragen den Geraetecode BEWUSST nicht.
 *
 * ⚠️ UND DIESER SATZ IST EINE FALLE, KEINE UNGENAUIGKEIT. Ich bin am
 * 22.08. selbst hineingelaufen: gemessen „zwei von vier Wegen ohne
 * Step-Up", die Zusammenfassung des Bildwegs versprach ihn, also habe ich
 * ihn eingebaut — und `code-nur-fuer-unwiderrufliches.guard` wurde ROT.
 *
 * Basels Entscheidung vom 05.08.2026, woertlich: „مرة عند الفتح، وثانية فقط
 * عند الأفعال التي لا تُلغى" — einmal beim Oeffnen, ein zweites Mal NUR bei
 * Handlungen, die sich nicht widerrufen lassen. Der Code stand vorher an
 * 47 Endpunkten; wer einen Vormittag arbeitete, tippte ihn ein Dutzend Mal.
 *
 * Deshalb steht der Geraetecode hier vor dem LOESCHEN (unwiderruflich) und
 * nicht vor dem Ansehen oder Ablegen. Wer das aendern will, aendert eine
 * Entscheidung des Haendlers, nicht einen Mangel.
 *
 * Alle vier: requireAuth + requireRole('ADMIN'). Die beiden Loeschwege
 * zusaetzlich requireStepUp — identity
 * capture AND viewing an Ausweis are owner-sensitive. The image is NEVER public
 * (not in PUBLIC_PATH_PATTERNS); the view serves with Cache-Control: no-store.
 * Audit_log carries a REDACTED payload — never the plaintext document number.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { Type } from '@sinclair/typebox';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, customers, kycDocuments } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import {
  KycCryptoError,
  type KycKeyring,
  buildKycKeyring,
  checkKycCapacity,
  compressKycImage,
  decryptKycImage,
  deleteKycImage,
  encryptKycImage,
  kycImageAad,
  readKycImage,
  writeKycImage,
} from '../lib/kyc-store.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  KycDocumentBody,
  KycDocumentResponse,
  type KycDocumentBody as TBody,
} from '../schemas/kyc-document.js';

/** Hard cap on the DECODED upload (bytes) BEFORE compression. */
const MAX_KYC_UPLOAD_BYTES = 25 * 1024 * 1024;

class CustomerNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class KycValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: { field: string; reason: string };
  public constructor(field: string, reason: string) {
    super(`KYC document validation failed for "${field}": ${reason}`);
    this.details = { field, reason };
  }
}
class KycCapacityError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class KycDocumentNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
/** Integrity failure (tamper / wrong key / missing file for a LIVE row). */
class KycIntegrityError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
/** No KYC encryption key configured — capture/view cannot operate. Unreachable
 *  in a real boot (loadEnv enforces the key); a defensive 503 for keyless envs. */
class KycStorageUnconfiguredError extends DomainError {
  public readonly httpStatus = 503;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
  public constructor() {
    super('KYC image storage is not configured (missing encryption key).');
  }
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface CustomerKycDocumentsOpts {
  env: Env;
}

const customerKycDocumentsRoute: FastifyPluginAsync<CustomerKycDocumentsOpts> = async (
  app,
  opts,
) => {
  const { env } = opts;
  // Built once at boot. In a real boot loadEnv has already validated the key, so
  // this always succeeds. We still guard: an app assembled WITHOUT a KYC key
  // (e.g. an integration harness that never exercises KYC) must still register
  // its other routes rather than crash buildApp — the KYC handlers then refuse
  // to operate (503) until a key is configured. Auth runs first, so a non-ADMIN
  // / no-step-up caller still gets 403, never a 503 that would leak config state.
  let keyring: KycKeyring | null = null;
  try {
    keyring = buildKycKeyring(env);
  } catch (err) {
    app.log.warn(
      { reason: err instanceof Error ? err.message : 'unknown' },
      'KYC image encryption key absent/invalid — KYC document routes will return 503 until configured.',
    );
  }

  // ── POST /api/customers/:id/kyc-documents ──────────────────────────────
  app.post<{ Params: { id: string }; Body: TBody }>(
    '/api/customers/:id/kyc-documents',
    {
      bodyLimit: 34 * 1024 * 1024, // base64 of a full-res phone capture
      schema: {
        tags: ['customers'],
        summary: 'Capture an ID-document photo for a customer (local encrypted store, #I-47).',
        description:
          'Compresses + EXIF-strips the image, AES-256-GCM-encrypts it to a local file, ' +
          'computes the SHA-256, and creates a kyc_documents row with the encrypted document ' +
          // ⚰️ 22.08.2026: sagte „step-up REQUIRED". Das Ablegen ist keine
          // unwiderrufliche Handlung; der Geraetecode steht hier bewusst
          // nicht (Basels Entscheidung vom 05.08.2026).
          'number. ADMIN-only. The image is NEVER public.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: KycDocumentBody,
        response: {
          200: KycDocumentResponse,
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
      if (!keyring) throw new KycStorageUnconfiguredError();

      const { id: customerId } = req.params;
      const body = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;
      const retentionYears = body.retentionYears ?? 5;

      if (body.issuedOn && body.issuedOn >= body.expiresOn) {
        throw new KycValidationError('expiresOn', 'expires_on must be strictly after issued_on');
      }

      // 1. Decode + size-cap the raw bytes BEFORE the (expensive) sharp decode.
      const raw = Buffer.from(body.dataBase64, 'base64');
      if (raw.length === 0) throw new KycValidationError('dataBase64', 'empty image payload');
      if (raw.length > MAX_KYC_UPLOAD_BYTES) {
        throw new KycValidationError(
          'dataBase64',
          `image exceeds ${Math.floor(MAX_KYC_UPLOAD_BYTES / 1024 / 1024)} MB`,
        );
      }

      // 2. Compress + EXIF-strip; the SERVER computes the sha256 (the client no
      //    longer supplies it — the DB has a NOT-NULL octet_length=32 CHECK).
      let compressed: Awaited<ReturnType<typeof compressKycImage>>;
      try {
        compressed = await compressKycImage(raw);
      } catch {
        throw new KycValidationError('dataBase64', 'not a decodable image');
      }

      // 3. Separate KYC store cap (never shares the product-photo quota).
      const used = await app.db.execute<{ sum: string | null }>(sql`
        SELECT COALESCE(SUM(document_photo_size_bytes), 0)::text AS sum
          FROM kyc_documents WHERE purged_at IS NULL`);
      const usedBytes = Number(used[0]?.sum ?? 0);

      // 4. Generate the row id + storage key UP FRONT so the AAD (which binds the
      //    ciphertext to its row) is known before encryption.
      const docId = randomUUID();
      const storageKey = randomUUID();
      const aad = kycImageAad(customerId, docId, storageKey);
      const encrypted = encryptKycImage(compressed.webp, aad, keyring);

      const cap = checkKycCapacity(env, usedBytes, encrypted.length);
      if (!cap.ok) {
        throw new KycCapacityError(
          `KYC image store is full (${cap.usedBytes} + ${encrypted.length} > ${cap.maxBytes} bytes).`,
        );
      }

      // 5. Write the encrypted file, THEN insert the row. If the insert fails,
      //    delete the orphan file (no dangling bytes without a row).
      await writeKycImage(env, storageKey, encrypted);
      try {
        const outcome = await app.withPii(async (tx) => {
          const [exists] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.id, customerId))
            .limit(1);
          if (!exists) throw new CustomerNotFoundError(`Customer ${customerId} not found.`);

          const inserted = await tx.execute<{
            id: string;
            // postgres-js returns raw `execute` timestamps as strings (column
            // codecs only apply to typed .select()), so coerce on the way out.
            captured_at: string;
            retention_until: string;
          }>(sql`
            INSERT INTO kyc_documents (
              id, customer_id, document_type, issuing_country_iso2, issuing_authority,
              document_number_encrypted, issued_on, expires_on,
              document_photo_storage_key, document_photo_sha256, document_photo_size_bytes,
              captured_by_user_id, captured_at_terminal_id, retention_until
            ) VALUES (
              ${docId}, ${customerId}, ${body.documentType}::id_document_type,
              ${body.issuingCountryIso2}, ${body.issuingAuthority ?? null},
              encrypt_pii(${body.documentNumber}),
              ${body.issuedOn ?? null}::date, ${body.expiresOn}::date,
              ${storageKey}, decode(${compressed.sha256Hex}, 'hex'), ${encrypted.length},
              ${actorId}, ${deviceId},
              (now() + (${retentionYears} || ' years')::interval)::date
            )
            RETURNING id, captured_at, retention_until::text AS retention_until`);
          const row = inserted[0];
          if (!row) throw new Error('kyc_documents INSERT returned no row');

          // Audit — REDACTED. Never the plaintext document number.
          await tx.insert(auditLog).values({
            eventType: 'customer.kyc_document_added',
            actorUserId: actorId,
            deviceId,
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent'] ?? null,
            payload: {
              customerId,
              kycDocumentId: row.id,
              documentType: body.documentType,
              issuingCountryIso2: body.issuingCountryIso2,
              storageKey,
              sha256Hex: compressed.sha256Hex,
              sizeBytes: encrypted.length,
              issuedOn: body.issuedOn ?? null,
              expiresOn: body.expiresOn,
              retentionYears,
            },
          });

          await tx
            .update(customers)
            .set({ kycCompletedAt: new Date() })
            .where(eq(customers.id, customerId));

          return { id: row.id, capturedAt: row.captured_at, retentionUntil: row.retention_until };
        });

        return reply.status(200).send({
          id: outcome.id,
          customerId,
          documentType: body.documentType,
          capturedAt: new Date(outcome.capturedAt).toISOString(),
          expiresOn: body.expiresOn,
          retentionUntil: outcome.retentionUntil,
        });
      } catch (err) {
        // The row was not committed — drop the orphan encrypted file.
        await deleteKycImage(env.KYC_PHOTOS_DIR, storageKey).catch(() => {});
        throw err;
      }
    },
  );

  // ── DELETE /api/customers/:id/kyc-documents ────────────────────────────
  // Owner-friendly bulk variant (C4): purge ALL live Ausweis documents of a
  // customer in one action — the UI has no per-document id, and the common case
  // is "remove the saved ID so I can re-capture". Each row becomes a redacted
  // evidence shell + its encrypted image file is unlinked. ADMIN + step-up.
  // Idempotent: returns purgedCount 0 when there is nothing live to purge.
  app.delete<{ Params: { id: string } }>(
    '/api/customers/:id/kyc-documents',
    {
      schema: {
        tags: ['customers'],
        summary: 'Delete (purge) ALL live KYC ID documents of a customer — ADMIN + step-up.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: Type.Object({ purgedCount: Type.Integer() }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const { id: customerId } = req.params;

      const live = await app.db
        .select({ id: kycDocuments.id, storageKey: kycDocuments.documentPhotoStorageKey })
        .from(kycDocuments)
        .where(and(eq(kycDocuments.customerId, customerId), isNull(kycDocuments.purgedAt)));

      if (live.length > 0) {
        await app.db.transaction(async (tx) => {
          await tx
            .update(kycDocuments)
            .set({
              documentNumberEncrypted: null,
              documentPhotoSha256: null,
              documentPhotoStorageKey: null,
              documentPhotoSizeBytes: null,
              purgedAt: new Date(),
              purgedByUserId: req.actor.id,
            })
            .where(and(eq(kycDocuments.customerId, customerId), isNull(kycDocuments.purgedAt)));
          await tx.insert(auditLog).values({
            eventType: 'customer.kyc_purged',
            actorUserId: req.actor.id,
            deviceId: req.deviceId ?? null,
            ipAddress: req.ip ?? null,
            payload: { customerId, purgedCount: live.length, reason: 'owner_requested' },
          });
        });
        for (const doc of live) {
          if (doc.storageKey) await deleteKycImage(env.KYC_PHOTOS_DIR, doc.storageKey).catch(() => {});
        }
      }

      return reply.status(200).send({ purgedCount: live.length });
    },
  );

  // ── DELETE /api/customers/:id/kyc-documents/:docId ─────────────────────
  // Replace/delete a saved Ausweis (the owner could not before — C4). The row
  // is NEVER hard-deleted (GwG / §259 evidence): it becomes a redacted SHELL via
  // the established GDPR purge (NULL the encrypted number + photo sha/key/size,
  // stamp purged_at + purged_by) and the encrypted image FILE is unlinked. To
  // REPLACE, the app deletes here then re-captures via POST. ADMIN + step-up.
  app.delete<{ Params: { id: string; docId: string } }>(
    '/api/customers/:id/kyc-documents/:docId',
    {
      schema: {
        tags: ['customers'],
        summary: 'Delete (purge) a customer KYC ID document — ADMIN + step-up. Row becomes a redacted evidence shell; the encrypted image file is unlinked.',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          docId: Type.String({ format: 'uuid' }),
        }),
        response: {
          200: Type.Object({ id: Type.String({ format: 'uuid' }), purged: Type.Boolean() }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const { id: customerId, docId } = req.params;

      // Must exist + be LIVE (not already purged — a shell has purged_at set).
      const [row] = await app.db
        .select({ storageKey: kycDocuments.documentPhotoStorageKey, purgedAt: kycDocuments.purgedAt })
        .from(kycDocuments)
        .where(and(eq(kycDocuments.id, docId), eq(kycDocuments.customerId, customerId)))
        .limit(1);
      if (!row || row.purgedAt !== null) {
        throw new KycDocumentNotFoundError('KYC document not found.');
      }
      const storageKey = row.storageKey;

      // ALL-OR-NOTHING purge per the kyc_documents_purged_consistency CHECK:
      // null the three PII columns together + stamp purged_at + purged_by.
      await app.db.transaction(async (tx) => {
        await tx
          .update(kycDocuments)
          .set({
            documentNumberEncrypted: null,
            documentPhotoSha256: null,
            documentPhotoStorageKey: null,
            documentPhotoSizeBytes: null,
            purgedAt: new Date(),
            purgedByUserId: req.actor.id,
          })
          .where(and(eq(kycDocuments.id, docId), eq(kycDocuments.customerId, customerId)));
        await tx.insert(auditLog).values({
          eventType: 'customer.kyc_purged',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          payload: { customerId, kycDocumentId: docId, reason: 'owner_requested' },
        });
      });

      // After commit: unlink the encrypted image bytes (best-effort, never throws).
      if (storageKey) await deleteKycImage(env.KYC_PHOTOS_DIR, storageKey).catch(() => {});

      return reply.status(200).send({ id: docId, purged: true });
    },
  );

  // ── GET /api/customers/:id/kyc-documents/:docId/image ──────────────────
  // PRIVATE. ADMIN + step-up. Decrypt → verify sha256 → serve no-store.
  app.get<{ Params: { id: string; docId: string } }>(
    '/api/customers/:id/kyc-documents/:docId/image',
    {
      schema: {
        tags: ['customers'],
        // ⚰️ 22.08.2026: sagte „ADMIN + step-up". Der Weg hat keinen
        // Step-Up und soll keinen haben (siehe Kopf der Datei). Eine
        // Zusammenfassung, die einen Riegel behauptet, den es nicht gibt,
        // laedt zum „Beheben" in die falsche Richtung ein.
        summary: 'View a customer KYC ID-document image (ADMIN only, never public).',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          docId: Type.String({ format: 'uuid' }),
        }),
        response: {
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
      if (!keyring) throw new KycStorageUnconfiguredError();

      const { id: customerId, docId } = req.params;

      const [row] = await app.db
        .select({
          storageKey: kycDocuments.documentPhotoStorageKey,
          sha256Hex: sql<string | null>`encode(${kycDocuments.documentPhotoSha256}, 'hex')`,
          purgedAt: kycDocuments.purgedAt,
        })
        .from(kycDocuments)
        .where(and(eq(kycDocuments.id, docId), eq(kycDocuments.customerId, customerId)))
        .limit(1);

      // 404 for absent or purged (a shell has storage_key NULL) — never reveal more.
      if (!row || row.purgedAt !== null || !row.storageKey || !row.sha256Hex) {
        throw new KycDocumentNotFoundError('KYC document image not found.');
      }

      const file = await readKycImage(env, row.storageKey);
      if (!file) {
        // LIVE row but the file is gone — an integrity problem, audited.
        await app.db.insert(auditLog).values({
          eventType: 'security.kyc_image_missing',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          payload: { customerId, kycDocumentId: docId },
        });
        throw new KycIntegrityError('KYC image file missing for a live row.');
      }

      const aad = kycImageAad(customerId, docId, row.storageKey);
      let plaintext: Buffer;
      try {
        plaintext = decryptKycImage(file, aad, keyring);
      } catch (err) {
        // Tag failure = tamper / wrong key / wrong row. Serve NOTHING; audit it.
        await app.db.insert(auditLog).values({
          eventType: 'security.kyc_image_tamper',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          payload: {
            customerId,
            kycDocumentId: docId,
            reason: err instanceof KycCryptoError ? err.message : 'decrypt failed',
          },
        });
        throw new KycIntegrityError('KYC image authentication failed.');
      }

      // Independent integrity record (matches the existing posture).
      const actualSha = createHash('sha256').update(plaintext).digest('hex');
      if (actualSha !== row.sha256Hex) {
        await app.db.insert(auditLog).values({
          eventType: 'security.kyc_image_sha_mismatch',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          payload: { customerId, kycDocumentId: docId },
        });
        throw new KycIntegrityError('KYC image integrity check failed.');
      }

      // Access to an Ausweis is itself auditable.
      await app.db.insert(auditLog).values({
        eventType: 'customer.kyc_document_viewed',
        actorUserId: req.actor.id,
        deviceId: req.deviceId ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: { customerId, kycDocumentId: docId },
      });

      return reply
        .header('Content-Type', 'image/webp')
        .header('Cache-Control', 'no-store')
        .header('Pragma', 'no-cache')
        .send(plaintext);
    },
  );
};

export default customerKycDocumentsRoute;
