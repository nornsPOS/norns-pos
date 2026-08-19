/**
 * Inventory session routes — Stichtagsinventur (Day 21).
 *
 *   POST /api/inventory-sessions          — open a session (ADMIN-only)
 *   POST /api/inventory-sessions/:id/scans — record one barcode scan
 *   POST /api/inventory-sessions/:id/close — compute Schwund + close
 *   GET  /api/inventory-sessions/current   — current OPEN session, if any
 *
 * Constraint: at most ONE OPEN session globally (partial UNIQUE on (1)).
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { inventoryScans, inventorySessions } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class SessionNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class SessionConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const SessionView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: Type.Union([Type.Literal('OPEN'), Type.Literal('CLOSED')]),
  openedAt: Type.String({ format: 'date-time' }),
  closedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  expectedCount: Type.Integer(),
  matchedCount: Type.Union([Type.Integer(), Type.Null()]),
  missingCount: Type.Union([Type.Integer(), Type.Null()]),
  unexpectedCount: Type.Union([Type.Integer(), Type.Null()]),
});

const ProgressView = Type.Object({
  /** Countable stock when the session was opened. */
  expectedCount: Type.Integer(),
  /** Distinct pieces confirmed present so far. */
  matchedCount: Type.Integer(),
  /** Countable pieces NOT yet found. A running number, not yet a verdict. */
  openCount: Type.Integer(),
  /** Scans that did not confirm expected stock (unknown, sold, draft). */
  unexpectedCount: Type.Integer(),
  /** Every scan recorded in this session, duplicates included. */
  scanCount: Type.Integer(),
});

const inventorySessionsRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/inventory-sessions',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Open an inventory session (Stichtagsinventur). ADMIN-only.',
        response: { 201: SessionView, 401: ErrorResponse, 403: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      try {
        const result = await app.db.transaction(async (tx) => {
          const [count] = await tx.execute<{ c: string }>(drizzleSql`
          SELECT COUNT(*)::text AS c FROM products
           WHERE status IN ('AVAILABLE'::product_status, 'RESERVED'::product_status)
             AND archived_at IS NULL
        `);
          const expected = Number.parseInt(count!.c, 10);
          const [s] = await tx
            .insert(inventorySessions)
            .values({
              openedByUserId: req.actor.id,
              expectedCount: expected,
            })
            .returning();
          if (!s) throw new Error('session insert returned no row');
          return s;
        });
        return reply.status(201).send({
          id: result.id,
          status: result.status,
          openedAt: result.openedAt.toISOString(),
          closedAt: result.closedAt ? result.closedAt.toISOString() : null,
          expectedCount: result.expectedCount,
          matchedCount: result.matchedCount,
          missingCount: result.missingCount,
          unexpectedCount: result.unexpectedCount,
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('inventory_sessions_one_open_uq')) {
          throw new SessionConflictError('An inventory session is already OPEN.');
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/inventory-sessions/current',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Get the OPEN inventory session, if any.',
        response: { 200: Type.Union([SessionView, Type.Null()]), 401: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      const [row] = await app.db
        .select()
        .from(inventorySessions)
        .where(eq(inventorySessions.status, 'OPEN'))
        .limit(1);
      if (!row) return reply.status(200).send(null);
      return reply.status(200).send({
        id: row.id,
        status: row.status,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt ? row.closedAt.toISOString() : null,
        expectedCount: row.expectedCount,
        matchedCount: row.matchedCount,
        missingCount: row.missingCount,
        unexpectedCount: row.unexpectedCount,
      });
    },
  );

  // ── GET /api/inventory-sessions/:id/progress ──────────────────────────────
  // The same arithmetic the close endpoint runs, WITHOUT closing anything.
  //
  // Without this a count is blind: the scan endpoint answers one piece at a
  // time and the totals appear only after the session is closed, which is
  // exactly too late to notice that a shelf was skipped. Somebody counting
  // 38 pieces (or 3,800) needs to see how many are still unfound while there
  // is still time to walk back to the vitrine — and the numbers must come from
  // the server, because a client-side tally forgets everything on reload and
  // knows nothing about what a colleague scanned on the second till.
  app.get<{ Params: { id: string } }>(
    '/api/inventory-sessions/:id/progress',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Live counts for a running session (same arithmetic as close).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: ProgressView, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      const [s] = await app.db
        .select({ id: inventorySessions.id, expectedCount: inventorySessions.expectedCount })
        .from(inventorySessions)
        .where(eq(inventorySessions.id, req.params.id))
        .limit(1);
      if (!s) throw new SessionNotFoundError(`Inventory session ${req.params.id} not found.`);

      const [counts] = await app.db.execute<{
        matched: string;
        unexpected: string;
        missing: string;
        scans: string;
      }>(drizzleSql`
        WITH session_matched AS (
          SELECT DISTINCT product_id FROM inventory_scans
           WHERE session_id = ${req.params.id}
             AND match_status = 'MATCHED'::inventory_scan_match
             AND product_id IS NOT NULL
        )
        SELECT
          (SELECT COUNT(*)::text FROM session_matched) AS matched,
          (SELECT COUNT(*)::text FROM inventory_scans
            WHERE session_id = ${req.params.id}
              AND match_status IN ('UNKNOWN_BARCODE'::inventory_scan_match,
                                   'EXPECTED_BUT_SOLD'::inventory_scan_match,
                                   'UNEXPECTED'::inventory_scan_match)) AS unexpected,
          (SELECT COUNT(*)::text FROM products
            WHERE status IN ('AVAILABLE'::product_status, 'RESERVED'::product_status)
              AND archived_at IS NULL
              AND id NOT IN (SELECT product_id FROM session_matched WHERE product_id IS NOT NULL)
          ) AS missing,
          (SELECT COUNT(*)::text FROM inventory_scans WHERE session_id = ${req.params.id}) AS scans
      `);

      return reply.status(200).send({
        expectedCount: s.expectedCount,
        matchedCount: Number.parseInt(counts!.matched, 10),
        // Still unfound RIGHT NOW. Not yet Schwund: the count is running, and
        // this number is only a verdict once the session is closed.
        openCount: Number.parseInt(counts!.missing, 10),
        unexpectedCount: Number.parseInt(counts!.unexpected, 10),
        scanCount: Number.parseInt(counts!.scans, 10),
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { rawBarcode: string } }>(
    '/api/inventory-sessions/:id/scans',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Record a barcode scan. Classifies match_status.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ rawBarcode: Type.String({ minLength: 1, maxLength: 256 }) }),
        response: {
          200: Type.Object({
            id: Type.String({ format: 'uuid' }),
            matchStatus: Type.String(),
            productId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
            /** The piece that was recognised, so the counter sees WHAT it just
             *  confirmed rather than only that something matched. */
            sku: Type.Union([Type.String(), Type.Null()]),
          }),
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      const result = await app.db.transaction(async (tx) => {
        const [s] = await tx
          .select({ id: inventorySessions.id, status: inventorySessions.status })
          .from(inventorySessions)
          .where(eq(inventorySessions.id, req.params.id))
          .limit(1);
        if (!s) throw new SessionNotFoundError(`Inventory session ${req.params.id} not found.`);
        if (s.status !== 'OPEN') throw new SessionConflictError('Inventory session is CLOSED.');

        // Barcode FIRST, then the SKU as a fallback.
        //
        // This shop labels most pieces with their own SKU and only carries a
        // manufacturer barcode on the few items that arrive with one printed.
        // On the live database that split was 12 of 38 countable pieces with a
        // barcode and all 38 with a distinct SKU — so a barcode-only lookup
        // would have classified 26 real pieces UNKNOWN_BARCODE and then counted
        // every one of them as Schwund. A shrinkage report that is two thirds
        // invented is worse than no report at all, and it is the kind of
        // document a Betriebsprüfer reads.
        //
        // The CASE keeps a genuine barcode hit ahead of an SKU hit, because two
        // of the live pieces carry an EAN that is deliberately NOT their SKU.
        const [product] = await tx.execute<{
          id: string;
          sku: string;
          status: string;
          archived_at: Date | null;
        }>(drizzleSql`
          SELECT id::text, sku, status::text, archived_at
            FROM products
           WHERE barcode = ${req.body.rawBarcode} OR sku = ${req.body.rawBarcode}
           ORDER BY CASE WHEN barcode = ${req.body.rawBarcode} THEN 0 ELSE 1 END
           LIMIT 1
        `);

        let matchStatus:
          | 'MATCHED'
          | 'UNKNOWN_BARCODE'
          | 'DUPLICATE'
          | 'EXPECTED_BUT_SOLD'
          | 'UNEXPECTED';
        let productId: string | null = null;
        let sku: string | null = null;
        if (!product) {
          matchStatus = 'UNKNOWN_BARCODE';
        } else {
          productId = product.id;
          sku = product.sku;
          const [dup] = await tx.execute<{ id: string }>(drizzleSql`
          SELECT id FROM inventory_scans
           WHERE session_id = ${req.params.id} AND product_id = ${product.id}
             AND match_status = 'MATCHED'::inventory_scan_match
           LIMIT 1
        `);
          if (dup) matchStatus = 'DUPLICATE';
          else if (product.archived_at !== null) matchStatus = 'EXPECTED_BUT_SOLD';
          else if (product.status === 'SOLD') matchStatus = 'EXPECTED_BUT_SOLD';
          else if (product.status === 'DRAFT') matchStatus = 'UNEXPECTED';
          else matchStatus = 'MATCHED';
        }

        const [scan] = await tx
          .insert(inventoryScans)
          .values({
            sessionId: req.params.id,
            rawBarcode: req.body.rawBarcode,
            productId,
            matchStatus,
            scannedByUserId: req.actor.id,
          })
          .returning({ id: inventoryScans.id });
        return { id: scan!.id, matchStatus, productId, sku };
      });
      return reply.status(200).send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: { notes?: string } }>(
    '/api/inventory-sessions/:id/close',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Close session: compute Schwund + matched + unexpected.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ notes: Type.Optional(Type.String({ maxLength: 2048 })) }),
        response: {
          200: SessionView,
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

      const result = await app.db.transaction(async (tx) => {
        const [s] = await tx
          .select()
          .from(inventorySessions)
          .where(eq(inventorySessions.id, req.params.id))
          .limit(1);
        if (!s) throw new SessionNotFoundError(`Inventory session ${req.params.id} not found.`);
        if (s.status !== 'OPEN') throw new SessionConflictError('Session is already CLOSED.');

        const [counts] = await tx.execute<{
          matched: string;
          unexpected: string;
          missing: string;
        }>(drizzleSql`
        WITH session_matched AS (
          SELECT DISTINCT product_id FROM inventory_scans
           WHERE session_id = ${req.params.id}
             AND match_status = 'MATCHED'::inventory_scan_match
             AND product_id IS NOT NULL
        )
        SELECT
          (SELECT COUNT(*)::text FROM session_matched) AS matched,
          (SELECT COUNT(*)::text FROM inventory_scans
            WHERE session_id = ${req.params.id}
              AND match_status IN ('UNKNOWN_BARCODE'::inventory_scan_match,
                                   'EXPECTED_BUT_SOLD'::inventory_scan_match,
                                   'UNEXPECTED'::inventory_scan_match)) AS unexpected,
          (SELECT COUNT(*)::text FROM products
            WHERE status IN ('AVAILABLE'::product_status, 'RESERVED'::product_status)
              AND archived_at IS NULL
              AND id NOT IN (SELECT product_id FROM session_matched WHERE product_id IS NOT NULL)
          ) AS missing
      `);

        const matched = Number.parseInt(counts!.matched, 10);
        const missing = Number.parseInt(counts!.missing, 10);
        const unexpected = Number.parseInt(counts!.unexpected, 10);

        const [updated] = await tx
          .update(inventorySessions)
          .set({
            status: 'CLOSED',
            closedAt: new Date(),
            closedByUserId: req.actor.id,
            matchedCount: matched,
            missingCount: missing,
            unexpectedCount: unexpected,
            notes: req.body.notes ?? s.notes,
          })
          .where(eq(inventorySessions.id, s.id))
          .returning();
        if (!updated) throw new Error('session close UPDATE returned no row');

        if (missing > 0) {
          await tx.execute(drizzleSql`
          INSERT INTO ledger_events (event_type, entity_table, entity_id, actor_user_id, payload)
          VALUES ('inventory.session_closed_with_shrinkage', 'inventory_sessions',
                  ${updated.id}, ${req.actor.id},
                  jsonb_build_object('matched', ${matched}, 'missing', ${missing},
                                     'unexpected', ${unexpected}, 'expected', ${updated.expectedCount}))
        `);
        }

        return updated;
      });
      return reply.status(200).send({
        id: result.id,
        status: result.status,
        openedAt: result.openedAt.toISOString(),
        closedAt: result.closedAt ? result.closedAt.toISOString() : null,
        expectedCount: result.expectedCount,
        matchedCount: result.matchedCount,
        missingCount: result.missingCount,
        unexpectedCount: result.unexpectedCount,
      });
    },
  );
};

export default inventorySessionsRoutes;
