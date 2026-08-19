/**
 * GET /api/registers/an-verkaufsbuch — the An-/Verkaufsbuch (purchase/sale
 * register).
 *
 * A second-hand and precious-metals dealer must keep a verifiable book of who
 * they bought from and what they bought (§38 Abs. 2 GewO + the GwG §10 KYC
 * record). An inspector (Police / Gewerbeamt / Finanzamt) asks for exactly this
 * list: per Ankauf, the ID-verified seller (name, date of birth, address, the
 * inspected identity document) and the goods (description, metal, weight,
 * price, payout). This endpoint produces it on demand over a date range, as
 * JSON for the screen or CSV for hand-off.
 *
 * The data already exists — this is a READ-ONLY projection over transactions,
 * their items + payments, and the (encrypted) customer identity + KYC document.
 * It never touches the fiscal write path.
 *
 * Because it decrypts seller PII, it is gated ADMIN/READONLY + a fresh PIN
 * ADMIN oder READONLY, and the decrypt happens inside a
 * `withPii` transaction (the key is SET LOCAL and cleared at COMMIT).
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const RegisterQuery = Type.Object({
  direction: Type.Optional(
    Type.Union([Type.Literal('ANKAUF'), Type.Literal('VERKAUF')], { default: 'ANKAUF' }),
  ),
  /** Berlin business day (inclusive), YYYY-MM-DD. Defaults to a wide window. */
  from: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  to: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  /** `csv` streams the register as a semicolon CSV; anything else → JSON. */
  format: Type.Optional(Type.String()),
});

interface RegisterRow {
  transaction_id: string;
  receipt_locator: string;
  finalized_at: Date | string;
  total_eur: string;
  tax_treatment_code: string;
  is_storno: boolean;
  customer_id: string | null;
  seller_name: string | null;
  seller_dob: string | null;
  seller_address: string | null;
  kyc_verified_at: Date | string | null;
  document_type: string | null;
  document_number: string | null;
  document_expires_on: Date | string | null;
  items: Array<{
    productId: string;
    description: string;
    itemType: string | null;
    metal: string | null;
    karatCode: string | null;
    weightGrams: string | null;
    lineTotalEur: string | null;
    marginEur: string | null;
  }>;
  payments: Array<{ method: string; amountEur: string; externalRef: string | null }>;
  // postgres-js rows satisfy the execute<T> Record<string, unknown> constraint.
  [key: string]: unknown;
}

/** Date|string → ISO-8601, or null. */
function toIso(v: Date | string | null): string | null {
  if (v == null) return null;
  return new Date(v).toISOString();
}

/** Date|string → YYYY-MM-DD, or null. */
function toDay(v: Date | string | null): string | null {
  const iso = toIso(v);
  return iso ? iso.slice(0, 10) : null;
}

/** Quote a CSV cell when it carries the delimiter, a quote, or a newline. */
function csvCell(v: string | null | undefined): string {
  const s = v ?? '';
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const registersRoute: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      direction?: 'ANKAUF' | 'VERKAUF';
      from?: string;
      to?: string;
      format?: string;
    };
  }>(
    '/api/registers/an-verkaufsbuch',
    {
      schema: {
        tags: ['registers'],
        summary: 'An-/Verkaufsbuch — the GwG §10 / §38 GewO purchase/sale register.',
        description:
          'Read-only register of ID-verified counterparties + goods for a date range. ' +
          'ANKAUF lists sellers (the legally required Ankaufsbuch), VERKAUF lists buyers. ' +
          'JSON by default; ?format=csv streams a semicolon CSV. ADMIN/READONLY.',
        querystring: RegisterQuery,
        response: { 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');

      const direction = req.query.direction ?? 'ANKAUF';
      const from = req.query.from ?? '1970-01-01';
      const to = req.query.to ?? '9999-12-31';
      const asCsv = req.query.format === 'csv';
      // ANKAUF → the counterparty is the SELLER; VERKAUF → the BUYER.
      const party = direction === 'ANKAUF' ? 'seller' : 'buyer';

      const rows = await app.withPii(async (tx) => {
        return tx.execute<RegisterRow>(sql`
          SELECT
            t.id::text                                AS transaction_id,
            t.receipt_locator                         AS receipt_locator,
            t.finalized_at                            AS finalized_at,
            t.total_eur::text                         AS total_eur,
            t.tax_treatment_code                      AS tax_treatment_code,
            (t.storno_of_transaction_id IS NOT NULL)  AS is_storno,
            t.customer_id::text                       AS customer_id,
            decrypt_pii(c.full_name_encrypted)        AS seller_name,
            decrypt_pii(c.date_of_birth_encrypted)    AS seller_dob,
            decrypt_pii(c.address_encrypted)          AS seller_address,
            c.kyc_verified_at                         AS kyc_verified_at,
            kd.document_type::text                    AS document_type,
            decrypt_pii(kd.document_number_encrypted) AS document_number,
            kd.expires_on                             AS document_expires_on,
            COALESCE(items.j, '[]'::jsonb)            AS items,
            COALESCE(pays.j, '[]'::jsonb)             AS payments
          FROM transactions t
          LEFT JOIN customers c ON c.id = t.customer_id
          LEFT JOIN LATERAL (
            SELECT kd.document_type, kd.document_number_encrypted, kd.expires_on
              FROM kyc_documents kd
             WHERE kd.customer_id = t.customer_id AND kd.purged_at IS NULL
             ORDER BY kd.captured_at DESC
             LIMIT 1
          ) kd ON TRUE
          LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object(
                     'productId',   ti.product_id::text,
                     'description', COALESCE(p.name, ''),
                     'itemType',    p.item_type::text,
                     'metal',       p.metal,
                     'karatCode',   p.karat_code,
                     'weightGrams', p.weight_grams::text,
                     'lineTotalEur', ti.line_total_eur::text,
                     'marginEur',   ti.margin_eur::text
                   ) ORDER BY ti.display_order) AS j
              FROM transaction_items ti
              LEFT JOIN products p ON p.id = ti.product_id
             WHERE ti.transaction_id = t.id
          ) items ON TRUE
          LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object(
                     'method',      tp.payment_method::text,
                     'amountEur',   tp.amount_eur::text,
                     'externalRef', tp.external_ref
                   )) AS j
              FROM transaction_payments tp
             WHERE tp.transaction_id = t.id
          ) pays ON TRUE
          WHERE t.direction = ${direction}::transaction_direction
            AND berlin_business_day(t.finalized_at) BETWEEN ${from}::date AND ${to}::date
          ORDER BY t.finalized_at ASC, t.receipt_locator ASC
        `);
      });

      const entries = rows.map((r) => ({
        transactionId: r.transaction_id,
        receiptLocator: r.receipt_locator,
        finalizedAt: toIso(r.finalized_at),
        totalEur: r.total_eur,
        taxTreatmentCode: r.tax_treatment_code,
        isStorno: r.is_storno,
        [party]: r.customer_id
          ? {
              customerId: r.customer_id,
              fullName: r.seller_name,
              dateOfBirth: r.seller_dob,
              address: r.seller_address,
              kycVerifiedAt: toIso(r.kyc_verified_at),
              document: r.document_type
                ? {
                    type: r.document_type,
                    number: r.document_number,
                    expiresOn: toDay(r.document_expires_on),
                  }
                : null,
            }
          : null,
        items: r.items,
        payments: r.payments,
      }));

      // The whole register sums to the same brutto the Z-Bon recorded.
      const totalEur = rows.reduce(
        (acc, r) => acc + Math.round(Number.parseFloat(r.total_eur) * 100),
        0,
      );

      if (asCsv) {
        const header = [
          'Datum',
          'Beleg',
          'Richtung',
          party === 'seller' ? 'Verkäufer' : 'Käufer',
          'Geburtsdatum',
          'Adresse',
          'Ausweisart',
          'Ausweisnummer',
          'Gegenstand',
          'Metall',
          'Karat',
          'Gewicht_g',
          'Betrag_EUR',
          'Zahlung',
        ];
        const lines: string[] = [header.map(csvCell).join(';')];
        for (const e of entries) {
          const p = (e as Record<string, unknown>)[party] as {
            fullName: string | null;
            dateOfBirth: string | null;
            address: string | null;
            document: { type: string | null; number: string | null } | null;
          } | null;
          const pay = e.payments.map((x) => `${x.method} ${x.amountEur}`).join(' + ');
          const itemList = e.items.length > 0 ? e.items : [null];
          for (const it of itemList) {
            lines.push(
              [
                toDay(e.finalizedAt),
                e.receiptLocator,
                direction,
                p?.fullName ?? '',
                p?.dateOfBirth ?? '',
                p?.address ?? '',
                p?.document?.type ?? '',
                p?.document?.number ?? '',
                it?.description ?? '',
                it?.metal ?? '',
                it?.karatCode ?? '',
                it?.weightGrams ?? '',
                it?.lineTotalEur ?? e.totalEur,
                pay,
              ]
                .map(csvCell)
                .join(';'),
            );
          }
        }
        const csv = `${lines.join('\r\n')}\r\n`;
        reply.header(
          'Content-Disposition',
          `attachment; filename="An-Verkaufsbuch_${direction}_${from}_${to}.csv"`,
        );
        reply.type('text/plain; charset=utf-8');
        return reply.status(200).send(csv);
      }

      return reply.status(200).send({
        direction,
        from,
        to,
        count: entries.length,
        totalEur: (totalEur / 100).toFixed(2),
        entries,
      });
    },
  );
};

export default registersRoute;
