/**
 * GET /api/customers/by-vat-id — resolve at most ONE customer by VAT id.
 *
 * Phase-2 P1.3. The POS B2B checkout used to LIST customers by company name and
 * then GET each one serially to match the VAT id — an N+1 on the synchronous
 * checkout path, with the customer waiting at the till, and (worse) it hit the
 * ADMIN-only by-id route, so a CASHIER till would 403 mid-sale. This route does
 * the match in ONE bounded query and is CASHIER-allowed, so the dialog resolves
 * the B2B customer with a single call BEFORE the card is ever charged.
 *
 * Normalisation: VAT ids are stored cleaned-uppercase by the create path, but
 * historical rows may carry separators — so both sides are normalised
 * (`upper(regexp_replace(vat_id, '[^A-Za-z0-9]', '', 'g'))`). `vat_id` is
 * plaintext (0039); the `withPii` scope is only needed to decrypt `full_name`.
 *
 * Auth: ADMIN + CASHIER (mirrors customers-list / customers-verify-vat).
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  CustomerVatLookupQuery,
  CustomerVatLookupResponse,
  type CustomerVatLookupQuery as TCustomerVatLookupQuery,
} from '../schemas/customer-vat-lookup.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

type VatRow = {
  id: string;
  customer_number: string;
  full_name: string;
  vat_id: string | null;
};

const customersVatLookupRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: TCustomerVatLookupQuery }>(
    '/api/customers/by-vat-id',
    {
      schema: {
        tags: ['customers'],
        summary: 'Resolve at most one customer by normalised VAT id (B2B checkout).',
        querystring: CustomerVatLookupQuery,
        response: {
          200: CustomerVatLookupResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const cleanVat = req.query.vatId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (cleanVat.length < 4) {
        return reply.status(200).send({ customer: null });
      }

      const row = await app.withPii(async (tx) => {
        const rows = await tx.execute<VatRow>(sql`
          SELECT id::text AS id, customer_number,
                 decrypt_pii(full_name_encrypted) AS full_name, vat_id
          FROM customers
          WHERE soft_deleted_at IS NULL
            AND vat_id IS NOT NULL
            AND upper(regexp_replace(vat_id, '[^A-Za-z0-9]', '', 'g')) = ${cleanVat}
          ORDER BY created_at DESC
          LIMIT 1
        `);
        return (rows as unknown as VatRow[])[0] ?? null;
      });

      if (!row) return reply.status(200).send({ customer: null });
      return reply.status(200).send({
        customer: {
          id: row.id,
          customerNumber: row.customer_number,
          fullName: row.full_name,
          vatId: row.vat_id,
        },
      });
    },
  );
};

export default customersVatLookupRoute;
