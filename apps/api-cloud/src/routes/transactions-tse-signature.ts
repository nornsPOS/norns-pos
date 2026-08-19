/**
 * POST /api/transactions/:id/tse-signature — persist the TSE signature.
 *
 * THE FISCAL GAP (audit 2026-06): the Fiskaly SIGN DE V2 signature produced on
 * each sale was ONLY printed on the thermal receipt and, on failure, queued to
 * the POS's browser localStorage. It was NEVER durably recorded server-side.
 * GoBD / BSI TR-03153 require the signature to be retained, immutably, linked
 * to the transaction it signs.
 *
 * This route is what the POS calls right after a successful finalize + TSE
 * FINISH: it writes ONE immutable `tse_signatures` row (migration 0054). The
 * AFTER INSERT trigger extends the ledger hash chain with a
 * `tse.signature_recorded` event.
 *
 * Idempotent — exactly one signature row per transaction:
 *   • A duplicate POST for the same transaction returns the existing row with
 *     `created: false` (the POS may retry on a lost response / queue replay).
 *   • The race path is covered by the UNIQUE index
 *     (`tse_signatures_unique_per_transaction`): on 23505 we fall back to a
 *     SELECT-by-transaction and return the winning row.
 *
 * This route ONLY persists what the POS already produced — it never re-signs.
 *
 * Gatekeepers:
 *   • requireAuth   — valid session
 *   • requireRole   — CASHIER or ADMIN
 *   • mTLS device   — CASHIER must carry a paired POS device cert (mirrors
 *                     finalize/storno); ADMIN may not (back-office replay).
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { transactions, tseSignatures } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  type TseSignatureBody as TBody,
  type TseSignatureParams as TParams,
  TseSignatureBody,
  TseSignatureParams,
  TseSignatureResponse,
} from '../schemas/tse-signature.js';

// ────────────────────────────────────────────────────────────────────────
// Local error classes.
// ────────────────────────────────────────────────────────────────────────

class TransactionNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

// ────────────────────────────────────────────────────────────────────────
// 23505 helper — narrow a unique-violation by constraint name.
// ────────────────────────────────────────────────────────────────────────

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  if (e.code !== '23505') return false;
  return e.constraint_name === constraint || e.constraint === constraint;
}

// ────────────────────────────────────────────────────────────────────────
// Plugin / route
// ────────────────────────────────────────────────────────────────────────

const transactionsTseSignature: FastifyPluginAsync = async (app) => {
  app.post<{ Params: TParams; Body: TBody }>(
    '/api/transactions/:id/tse-signature',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Persist the KassenSichV TSE signature for a finalized transaction.',
        description:
          'Durably records the Fiskaly SIGN DE V2 signature the POS received after ' +
          'finalize+FINISH, linked to the transaction (GoBD / BSI TR-03153). Writes one ' +
          'immutable tse_signatures row + a tse.signature_recorded ledger event. ' +
          'Idempotent: a duplicate returns the existing row with created=false.',
        params: TseSignatureParams,
        body: TseSignatureBody,
        response: {
          200: TseSignatureResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      // Mirror finalize/storno: a CASHIER must originate from an mTLS-paired
      // device. ADMIN may run a back-office replay without one.
      if (req.actor.role === 'CASHIER' && req.deviceId == null) {
        throw new DeviceRequiredError(
          'Recording a TSE signature requires a paired POS device cert.',
        );
      }

      const { id: transactionId } = req.params;
      const body = req.body;
      const deviceId = req.deviceId ?? null;
      const actorId = req.actor.id;

      // The transaction must exist before we attach signature evidence to it.
      const txRows = await app.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(drizzleSql`${transactions.id} = ${transactionId}::uuid`)
        .limit(1);
      if (!txRows[0]) {
        throw new TransactionNotFoundError(`Transaction ${transactionId} does not exist.`);
      }

      // Fast-path idempotency: already recorded? Return it (created=false).
      const existing = (
        await app.db
          .select({ id: tseSignatures.id, recordedAt: tseSignatures.recordedAt })
          .from(tseSignatures)
          .where(drizzleSql`${tseSignatures.transactionId} = ${transactionId}::uuid`)
          .limit(1)
      )[0];
      if (existing) {
        return reply.status(200).send({
          id: existing.id,
          transactionId,
          created: false,
          recordedAt: existing.recordedAt.toISOString(),
        });
      }

      // INSERT the immutable signature row. The AFTER INSERT trigger emits the
      // tse.signature_recorded ledger event (hash chain extends).
      try {
        const inserted = (
          await app.db
            .insert(tseSignatures)
            .values({
              transactionId,
              fiskalyTssId: body.fiskalyTssId,
              fiskalyClientId: body.fiskalyClientId,
              fiskalyTransactionId: body.fiskalyTransactionId ?? null,
              fiskalyTransactionNumber: BigInt(body.fiskalyTransactionNumber),
              signatureValue: body.signatureValue,
              signatureCounter: BigInt(body.signatureCounter),
              signatureAlgorithm: body.signatureAlgorithm ?? null,
              // ⚠️ Die zwei Angaben, ohne die ein Prüfer nichts nachrechnen
              // kann. Sie werden NICHT abgeleitet: liefert die Kasse sie
              // nicht mit, bleibt die Spalte leer und der Auszug sagt das
              // auch. Eine erfundene Seriennummer wäre eine unrichtige
              // Angabe nach § 146a AO. Wanderung 0141.
              tssSerialNumber: body.tssSerialNumber ?? null,
              signaturePublicKey: body.signaturePublicKey ?? null,
              processType: body.processType ?? 'Kassenbeleg-V1',
              qrCodeData: body.qrCodeData ?? null,
              tseStartTime: body.tseStartTime ? new Date(body.tseStartTime) : null,
              tseEndTime: body.tseEndTime ? new Date(body.tseEndTime) : null,
              deviceId,
              recordedByUserId: actorId,
            })
            .returning({ id: tseSignatures.id, recordedAt: tseSignatures.recordedAt })
        )[0];
        if (!inserted) {
          throw new Error('INSERT INTO tse_signatures returned no row (should be impossible)');
        }
        return reply.status(200).send({
          id: inserted.id,
          transactionId,
          created: true,
          recordedAt: inserted.recordedAt.toISOString(),
        });
      } catch (err) {
        // Race fallback: a concurrent POST won. The UNIQUE index raised 23505;
        // return the winning row as a no-op (created=false).
        if (isUniqueViolation(err, 'tse_signatures_unique_per_transaction')) {
          const winner = (
            await app.db
              .select({ id: tseSignatures.id, recordedAt: tseSignatures.recordedAt })
              .from(tseSignatures)
              .where(drizzleSql`${tseSignatures.transactionId} = ${transactionId}::uuid`)
              .limit(1)
          )[0];
          if (winner) {
            return reply.status(200).send({
              id: winner.id,
              transactionId,
              created: false,
              recordedAt: winner.recordedAt.toISOString(),
            });
          }
        }
        throw err;
      }
    },
  );
};

export default transactionsTseSignature;
