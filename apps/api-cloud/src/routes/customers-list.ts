/**
 * GET /api/customers — paged customer search (Day 8, additive post-Freeze).
 *
 * Strategy:
 *   • If `q` looks like an email (contains @) → exact lookup via
 *     `email_blind_index = blind_index(q)`. Sub-millisecond, no decrypt.
 *   • Else if `q` looks like a phone (`/^[+\d\s().\-]{5,}$/`) → exact lookup
 *     via `phone_blind_index = blind_index(q)`, OR a partial match on the
 *     plaintext `customer_number` (so a typed-out Kundennummer like `000006`
 *     resolves instead of silently dead-ending on the phone blind index).
 *   • Else → fuzzy ILIKE on decrypted `full_name`, OR a partial match on
 *     `customer_number` (so `CUST-2026-000006`, `CUST`, or `2026` resolve).
 *     The decrypt happens INSIDE `withPii` so the per-request key binding is
 *     honoured. For V1 catalog size (<10k customers) sub-100 ms p95.
 *
 * `customer_number` is a plaintext, uniquely-indexed, non-PII column, so an
 * ILIKE on it is cheap and safe — and it is the identity the Owner-app shows as
 * each customer's subtitle, so search MUST honour it (Name ODER Nummer).
 *
 * Whichever strategy matches, the result rows still get full-name decrypted
 * so the operator UI can show "John Smith — ku-001023 — KYC ✓".
 *
 * Auth: ADMIN + CASHIER. Customers are read all day during retail operations,
 * so CASHIER is sufficient — the row carries no plaintext PII beyond the
 * full_name which is needed for visual confirmation at the counter.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  CustomerListQuery,
  CustomerListResponse,
  type CustomerListQuery as TCustomerListQuery,
} from '../schemas/customer-list.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const EMAIL_HINT = /@/;
const PHONE_HINT = /^[+\d\s().\-]{5,}$/;
/** A receipt/order number the operator typed (e.g. `RCP-2026-000042`, `rcp 42`). */
const RECEIPT_HINT = /^rcp[-\s]?/i;

const customersListRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: TCustomerListQuery }>(
    '/api/customers',
    {
      schema: {
        tags: ['customers'],
        summary: 'Paged customer search by name / Kundennummer / email / phone (Day 8).',
        description:
          'Powers Ankauf customer-lookup + the Owner-app global search. Indexed blind-index ' +
          'match for email + phone, ILIKE on the plaintext customer_number, decrypted ILIKE ' +
          'fallback for name. Returns minimal projection — no DOB, no address.',
        querystring: CustomerListQuery,
        response: {
          200: CustomerListResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const q = req.query.q?.trim() ?? '';
      const limit = req.query.limit ?? 20;
      const offset = req.query.offset ?? 0;
      const kycVerifiedOnly = req.query.kycVerifiedOnly === true;
      const excludeBlocked = req.query.excludeBlocked === true;
      const includeErased = req.query.includeErased === true;

      const result = await app.withPii(async (tx) => {
        // Partial, case-insensitive match on the plaintext Kundennummer — the
        // identity the Owner-app renders as each customer's subtitle. ESCAPEd so
        // a typed `%`/`_` is a literal, not a wildcard.
        const numberLike = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const customerNumberClause = sql`customer_number ILIKE ${numberLike} ESCAPE '\\'`;
        // Find the customer who placed an order (transaction) whose receipt
        // locator matches — this is the "search by order number" the Kunden
        // surface offers. Only customer-linked orders resolve (a walk-in order
        // has no customer to show). `receipt_locator` is uniquely indexed; a
        // full locator hits it, a partial seq-scans (fine at V1 scale).
        /*
         * ⚠️ PRAEFIX statt Umschliessung (19.08.2026): `ILIKE '%x%'` schliesst
         * jeden Index aus. Wer eine Belegkennung tippt, tippt sie von vorn
         * („RCP-2026-…"), und ein vorn verankertes Muster kann den eindeutigen
         * Index auf `receipt_locator` benutzen. Erreichbar ist dieser Zweig
         * ohnehin nur ueber RECEIPT_HINT, also mit dem Praefix im Text.
         */
        const belegPraefix = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const receiptClause = sql`id IN (
          SELECT customer_id FROM transactions
          WHERE customer_id IS NOT NULL AND receipt_locator ILIKE ${belegPraefix} ESCAPE '\\'
        )`;

        // Build the strategy SQL. The single query covers all cases via a CTE so
        // the count + page come from the same plan.
        const matchClause: ReturnType<typeof sql> =
          q.length === 0
            ? sql`TRUE`
            : EMAIL_HINT.test(q)
              ? // An `@` can never be a Kundennummer → email blind index only.
                sql`email_blind_index = blind_index(${q})`
              : RECEIPT_HINT.test(q)
                ? // Typed an order number (`RCP-…`) → the customer who placed it.
                  receiptClause
                : PHONE_HINT.test(q)
                  ? /*
                     * ⛔ EINE GETIPPTE ZAHL DARF NICHT DIE GANZE FISKALTABELLE
                     * LESEN (19.08.2026, Fund der boeswilligen Pruefung).
                     *
                     * Hier stand zusaetzlich `receiptClause` — und der sucht
                     * mit fuehrendem Prozent auf `receipt_locator`. Ein
                     * ILIKE '%123%' kann den eindeutigen Index NICHT nutzen:
                     * jede getippte Ziffernfolge im Kundenfeld loeste einen
                     * vollen Durchlauf durch `transactions` aus, die groesste
                     * Tabelle des Hauses — waehrend die Kassiererin tippt.
                     *
                     * Eine reine Zahl ist eine Telefonnummer oder eine
                     * Kundennummer; beide haben ihren Index. Wer nach einem
                     * BELEG sucht, tippt seine Kennung (`RCP-…`), und genau
                     * dafuer steht der Zweig darueber — der greift schon.
                     */
                    /*
                     * ⚠️ UNION statt OR (19.08.2026, gemessen): ein OR aus
                     * einem Indexvergleich und einem unindexierbaren
                     * ILIKE '%…%' VERGIFTET den ganzen Ausdruck — Postgres
                     * kann den Blindindex dann gar nicht mehr benutzen und
                     * liest je Tastendruck die ganze Tabelle. Als UNION plant
                     * der Planer beide Arme getrennt: der Telefonarm ist ein
                     * Indexzugriff, und nur der Nummernarm bleibt ein (viel
                     * billigerer, unverschluesselter) Durchlauf.
                     */
                    sql`id IN (
                      SELECT id FROM customers WHERE phone_blind_index = blind_index(${q})
                      UNION
                      SELECT id FROM customers WHERE ${customerNumberClause}
                    )`
                  : /*
                     * ── Namenssuche ueber den GEBLENDETEN Index (19.08.2026) ──
                     *
                     * Gemessen an 2.000 Kunden: `decrypt_pii(...) ILIKE` kostete
                     * 262 ms JE TASTENDRUCK — jede Zeile wird entschluesselt,
                     * PARALLEL UNSAFE, linear wachsend. Der geblendete
                     * Dreiergruppen-Index (Wanderung 0146) beantwortet dieselbe
                     * Suche in 0,46 ms, mit IDENTISCHER Treffermenge (226 = 226
                     * auf der Messsaat), ohne dass je Klartext die Platte
                     * beruehrt.
                     *
                     * Drei Wege, in dieser Reihenfolge:
                     *   1. Tokens des Suchworts vorhanden (>= 3 Zeichen) →
                     *      GIN-Einschluss auf `name_such_tokens`. Zeilen, deren
                     *      Tokens noch NULL sind (Bestand vor der Rueckfuellung),
                     *      nimmt der decrypt-Zweig der OR mit — Vollstaendigkeit
                     *      geht vor Geschwindigkeit, und nach der ersten
                     *      Rueckfuellung ist diese Menge leer.
                     *   2. Suchwort zu kurz fuer eine Dreiergruppe → der alte
                     *      decrypt-Weg, unveraendert.
                     *   3. Kundennummer immer dazu („Name oder Nummer").
                     */
                    sql`id IN (
                      SELECT id FROM customers
                       WHERE (SELECT pii_such_tokens_anfrage(${q})) IS NOT NULL
                         AND name_such_tokens @> (SELECT pii_such_tokens_anfrage(${q}))
                      UNION
                      SELECT id FROM customers
                       WHERE ((SELECT pii_such_tokens_anfrage(${q})) IS NULL OR name_such_tokens IS NULL)
                         AND decrypt_pii(full_name_encrypted) ILIKE ${'%' + q + '%'}
                      UNION
                      SELECT id FROM customers WHERE ${customerNumberClause}
                    )`;

        // Gelöschte Konten: standardmässig draussen, damit die Kundenauswahl
        // beim Verkauf niemandem ein anonymisiertes Konto anbietet. Nur die
        // Kundenliste selbst bittet ausdrücklich darum, sie zu sehen.
        const erasedClause = includeErased ? sql`TRUE` : sql`soft_deleted_at IS NULL`;

        const kycClause = kycVerifiedOnly ? sql`AND kyc_verified_at IS NOT NULL` : sql``;
        const blockedClause = excludeBlocked
          ? sql`AND sanctions_match = FALSE AND trust_level <> 'BANNED'`
          : sql``;

        const rows = await tx.execute<{
          id: string;
          customer_number: string;
          full_name: string;
          kyc_status: string;
          kyc_verified_at: Date | null;
          trust_level: string;
          sanctions_match: boolean;
          pep_match: boolean;
          cumulative_ankauf_eur: string;
          cumulative_spend_eur: string;
          created_at: Date;
          soft_deleted_at: Date | null;
          erasure_initiated_by: string | null;
          last_order_at: Date | null;
          total_count: number;
        }>(sql`
        /*
         * ── ERST BLAETTERN, DANN ENTSCHLUESSELN (19.08.2026, gemessen) ─────
         *
         * Bis heute standen decrypt_pii, die MAX(transactions)-Unterabfrage
         * UND COUNT(*) OVER () in EINEM Block: das Fenster-Zaehlen zwingt
         * Postgres, JEDE Trefferzeile fertig zu projizieren, BEVOR LIMIT
         * greift. Ueber echtes HTTP gemessen (2.000 Kunden): die Liste OHNE
         * Suchwort brauchte 3,19 s fuer 10 angezeigte Zeilen — alle 2.000
         * wurden entschluesselt und je einzeln gegen transactions gefragt.
         *
         * Jetzt: die Seite wird zuerst BILLIG bestimmt (nur id + Sortierung,
         * traegt der 0145-Teilindex), und NUR die zehn Zeilen der Seite
         * bekommen decrypt und die letzte Bestellung. Die Gesamtzahl kommt
         * aus einer eigenen, entschluesselungsfreien Zaehlung darunter.
         */
        WITH seite AS (
          SELECT id, created_at
          FROM customers
          WHERE ${erasedClause}
            AND ${matchClause}
            ${kycClause}
            ${blockedClause}
          ORDER BY created_at DESC
          LIMIT ${limit}
          OFFSET ${offset}
        )
        SELECT
          c.id,
          c.customer_number,
          decrypt_pii(c.full_name_encrypted) AS full_name,
          c.kyc_status::text                 AS kyc_status,
          c.kyc_verified_at,
          c.trust_level::text                AS trust_level,
          c.sanctions_match,
          c.pep_match,
          c.cumulative_ankauf_eur,
          c.cumulative_spend_eur,
          c.created_at,
          c.soft_deleted_at,
          c.erasure_initiated_by,
          -- Last fiscal activity (any direction) — index-backed by
          -- transactions_customer_idx (customer_id, finalized_at DESC).
          (SELECT MAX(t.finalized_at) FROM transactions t WHERE t.customer_id = c.id)
                                             AS last_order_at,
          0::bigint                          AS total_count
        FROM customers c
        JOIN seite s ON s.id = c.id
        ORDER BY c.created_at DESC
      `);

        const [zaehlung] = await tx.execute<{ n: string }>(sql`
        SELECT count(*) AS n
          FROM customers
         WHERE ${erasedClause}
           AND ${matchClause}
           ${kycClause}
           ${blockedClause}
      `);

        return {
          rows,
          total: Number(zaehlung?.n ?? 0),
        };
      });

      return reply.status(200).send({
        items: result.rows.map((r) => ({
          id: r.id,
          customerNumber: r.customer_number,
          fullName: r.full_name,
          kycStatus: r.kyc_status as
            | 'NOT_REQUIRED'
            | 'PENDING'
            | 'CAPTURED'
            | 'VERIFIED'
            | 'EXPIRED'
            | 'REJECTED',
          kycVerifiedAt: r.kyc_verified_at ? new Date(r.kyc_verified_at).toISOString() : null,
          trustLevel: r.trust_level as 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED',
          sanctionsMatch: r.sanctions_match,
          pepMatch: r.pep_match,
          cumulativeAnkaufEur: r.cumulative_ankauf_eur,
          cumulativeSpendEur: r.cumulative_spend_eur,
          createdAt: new Date(r.created_at).toISOString(),
          deletedAt: r.soft_deleted_at ? new Date(r.soft_deleted_at).toISOString() : null,
          // Ein unbekannter Wert wird zu null: die Fläche soll lieber gar
          // nichts über die Herkunft der Löschung sagen als etwas Falsches.
          erasureInitiatedBy:
            r.erasure_initiated_by === 'CUSTOMER' || r.erasure_initiated_by === 'STAFF'
              ? r.erasure_initiated_by
              : null,
          lastOrderAt: r.last_order_at ? new Date(r.last_order_at).toISOString() : null,
        })),
        total: result.total,
        limit,
        offset,
        hasMore: offset + result.rows.length < result.total,
      });
    },
  );
};

export default customersListRoute;
