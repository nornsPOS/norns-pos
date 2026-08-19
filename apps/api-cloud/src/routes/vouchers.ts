/**
 * Voucher routes — Gutscheine issue + redeem + lookup (Day 21).
 *
 *   POST /api/vouchers           — issue (Owner/Cashier; SINGLE_PURPOSE requires tax code)
 *   POST /api/vouchers/:code/redeem — apply to a transaction (called by /finalize indirectly)
 *   GET  /api/vouchers/:code     — balance lookup (Owner/Cashier)
 *
 * § 3 Abs. 14 UStG handling:
 *   SINGLE_PURPOSE: VAT taken at issuance — the receipt at issuance time
 *                   carries a transaction_items line for the voucher value.
 *   MULTI_PURPOSE:  no VAT at issuance; VAT is on the redemption transaction's
 *                   line items as usual. Voucher acts as a deposit instrument.
 *
 * Code generation: cryptographically random 16 uppercase alphanumeric chars.
 */

import { randomBytes } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { voucherRedemptions, vouchers } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { DecimalString } from '../schemas/money.js';

class VoucherNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class VoucherConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class VoucherValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LEN = 16;

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

const VoucherView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  code: Type.String(),
  voucherType: Type.Union([Type.Literal('SINGLE_PURPOSE'), Type.Literal('MULTI_PURPOSE')]),
  issuedValueEur: DecimalString,
  currentBalanceEur: DecimalString,
  status: Type.Union([
    Type.Literal('ACTIVE'),
    Type.Literal('REDEEMED'),
    Type.Literal('EXPIRED'),
    Type.Literal('REVOKED'),
  ]),
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

const voucherRoutes: FastifyPluginAsync = async (app) => {
  // ════════════════════════════════════════════════════════════════════
  // POST /api/vouchers — issue
  // ════════════════════════════════════════════════════════════════════

  app.post<{
    Body: {
      voucherType: 'SINGLE_PURPOSE' | 'MULTI_PURPOSE';
      issuedValueEur: string;
      issuanceTaxTreatmentCode?: string;
      issuedToCustomerId?: string;
      expiresAt?: string;
      notes?: string;
    };
  }>(
    '/api/vouchers',
    {
      schema: {
        tags: ['vouchers'],
        summary: 'Issue a gift voucher (Gutschein) — SINGLE_PURPOSE requires a tax code.',
        body: Type.Object({
          voucherType: Type.Union([Type.Literal('SINGLE_PURPOSE'), Type.Literal('MULTI_PURPOSE')]),
          issuedValueEur: DecimalString,
          issuanceTaxTreatmentCode: Type.Optional(Type.String()),
          issuedToCustomerId: Type.Optional(Type.String({ format: 'uuid' })),
          expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
          notes: Type.Optional(Type.String({ maxLength: 1024 })),
        }),
        response: { 201: VoucherView, 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      const b = req.body;

      if (b.voucherType === 'SINGLE_PURPOSE' && !b.issuanceTaxTreatmentCode) {
        throw new VoucherValidationError(
          'SINGLE_PURPOSE vouchers require an issuanceTaxTreatmentCode (§ 3 Abs. 14 UStG).',
        );
      }

      const code = generateCode();
      try {
        const [v] = await app.db
          .insert(vouchers)
          .values({
            code,
            voucherType: b.voucherType,
            issuedValueEur: b.issuedValueEur,
            currentBalanceEur: b.issuedValueEur,
            issuanceTaxTreatmentCode: b.issuanceTaxTreatmentCode ?? null,
            issuedToCustomerId: b.issuedToCustomerId ?? null,
            expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
            notes: b.notes ?? null,
          })
          .returning();
        if (!v) throw new Error('voucher insert returned no row');
        return reply.status(201).send({
          id: v.id,
          code: v.code,
          voucherType: v.voucherType,
          issuedValueEur: v.issuedValueEur,
          currentBalanceEur: v.currentBalanceEur,
          status: v.status,
          expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('vouchers_code')) {
          // exceedingly rare collision — try once more
          const retryCode = generateCode();
          const [v] = await app.db
            .insert(vouchers)
            .values({
              code: retryCode,
              voucherType: b.voucherType,
              issuedValueEur: b.issuedValueEur,
              currentBalanceEur: b.issuedValueEur,
              issuanceTaxTreatmentCode: b.issuanceTaxTreatmentCode ?? null,
              issuedToCustomerId: b.issuedToCustomerId ?? null,
              expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
              notes: b.notes ?? null,
            })
            .returning();
          return reply.status(201).send({
            id: v!.id,
            code: v!.code,
            voucherType: v!.voucherType,
            issuedValueEur: v!.issuedValueEur,
            currentBalanceEur: v!.currentBalanceEur,
            status: v!.status,
            expiresAt: v!.expiresAt ? v!.expiresAt.toISOString() : null,
          });
        }
        throw err;
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // GET /api/vouchers/:code — balance lookup
  // ════════════════════════════════════════════════════════════════════

  app.get<{ Params: { code: string } }>(
    '/api/vouchers/:code',
    {
      schema: {
        tags: ['vouchers'],
        summary: 'Look up a voucher by its public code.',
        params: Type.Object({ code: Type.String({ pattern: '^[A-Z0-9]{8,32}$' }) }),
        response: { 200: VoucherView, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      const [v] = await app.db
        .select()
        .from(vouchers)
        .where(eq(vouchers.code, req.params.code))
        .limit(1);
      if (!v) throw new VoucherNotFoundError(`Voucher ${req.params.code} not found.`);
      return reply.status(200).send({
        id: v.id,
        code: v.code,
        voucherType: v.voucherType,
        issuedValueEur: v.issuedValueEur,
        currentBalanceEur: v.currentBalanceEur,
        status: v.status,
        expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/vouchers/:code/redeem — apply to a transaction
  // ════════════════════════════════════════════════════════════════════

  app.post<{
    Params: { code: string };
    Body: { transactionId: string; amountEur: string };
  }>(
    '/api/vouchers/:code/redeem',
    {
      schema: {
        tags: ['vouchers'],
        summary: 'Redeem voucher balance against a transaction. Decrements current_balance_eur.',
        params: Type.Object({ code: Type.String({ pattern: '^[A-Z0-9]{8,32}$' }) }),
        body: Type.Object({
          transactionId: Type.String({ format: 'uuid' }),
          amountEur: DecimalString,
        }),
        response: {
          200: Type.Object({
            redemptionId: Type.String({ format: 'uuid' }),
            newBalanceEur: DecimalString,
            newStatus: Type.String(),
          }),
          404: ErrorResponse,
          409: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      const result = await app.db.transaction(async (tx) => {
        /*
         * ⛔ DIE ZEILE WIRD GESPERRT, BEVOR IHR SALDO GELESEN WIRD
         * (19.08.2026, Fund der boeswilligen Pruefung).
         *
         * ── DER ANGRIFF, DER GELD KOSTETE ────────────────────────────────
         *
         * Zwei gleichzeitige Einloesungen desselben Gutscheins — zwei Kassen,
         * ein Doppelklick, oder ein Netz-Versuch nach verlorener Antwort.
         * Unter READ COMMITTED lasen beide denselben Saldo (50,00), beide
         * bestanden die Pruefung „Betrag <= Saldo", beide schrieben ihren
         * eigenen neuen Saldo. Ergebnis: zweimal 50,00 EUR Ware gegen EINEN
         * Gutschein ueber 50,00 — der Fehlbetrag faellt erst beim
         * Kassensturz auf, und dann sucht der Haendler bei seinen Leuten.
         *
         * `FOR UPDATE` reiht die beiden hintereinander: die zweite Anfrage
         * wartet, liest den bereits gesenkten Saldo und wird korrekt
         * abgewiesen. Bewusst NICHT `SKIP LOCKED` — hier soll niemand
         * uebersprungen werden, hier soll gewartet werden.
         */
        const gesperrt = await tx.execute<{ id: string }>(drizzleSql`
          SELECT id FROM vouchers WHERE code = ${req.params.code} FOR UPDATE`);
        if (gesperrt.length === 0) {
          throw new VoucherNotFoundError(`Voucher ${req.params.code} not found.`);
        }

        const [v] = await tx
          .select()
          .from(vouchers)
          .where(eq(vouchers.code, req.params.code))
          .limit(1);
        if (!v) throw new VoucherNotFoundError(`Voucher ${req.params.code} not found.`);
        if (v.status !== 'ACTIVE') {
          throw new VoucherConflictError(`Voucher status is ${v.status}; cannot redeem.`);
        }
        if (v.expiresAt && v.expiresAt < new Date()) {
          // Mark EXPIRED + refuse.
          await tx.update(vouchers).set({ status: 'EXPIRED' }).where(eq(vouchers.id, v.id));
          throw new VoucherConflictError('Voucher has expired.');
        }

        // Decimal-safe balance check.
        const cents = (x: string): bigint => {
          const [whole, frac = '00'] = x.split('.');
          return BigInt(whole!) * 100n + BigInt((frac ?? '00').padEnd(2, '0').slice(0, 2));
        };
        const balanceCents = cents(v.currentBalanceEur);
        const requestCents = cents(req.body.amountEur);
        if (requestCents <= 0n || requestCents > balanceCents) {
          throw new VoucherValidationError(
            `Redemption amount ${req.body.amountEur} exceeds available balance ${v.currentBalanceEur}.`,
          );
        }
        const newBalanceCents = balanceCents - requestCents;
        const newBalanceEur = `${newBalanceCents / 100n}.${String(newBalanceCents % 100n).padStart(2, '0')}`;
        const newStatus = newBalanceCents === 0n ? ('REDEEMED' as const) : v.status;

        const [red] = await tx
          .insert(voucherRedemptions)
          .values({
            voucherId: v.id,
            transactionId: req.body.transactionId,
            amountEur: req.body.amountEur,
          })
          .returning({ id: voucherRedemptions.id });
        if (!red) throw new Error('redemption insert returned no row');

        await tx
          .update(vouchers)
          .set({ currentBalanceEur: newBalanceEur, status: newStatus })
          .where(eq(vouchers.id, v.id));

        return { redemptionId: red.id, newBalanceEur, newStatus };
      });
      return reply.status(200).send(result);
    },
  );
};

export default voucherRoutes;
