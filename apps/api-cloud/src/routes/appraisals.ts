/**
 * Appraisal routes — Bewertungs-/Expertisen-Modul (Day 22).
 *
 *   POST   /api/appraisals                  — open DRAFT for a customer
 *   POST   /api/appraisals/:id/items        — add an item
 *   PUT    /api/appraisals/:id/items/:itemId — edit (DRAFT only)
 *   DELETE /api/appraisals/:id/items/:itemId — remove (DRAFT only)
 *   POST   /api/appraisals/:id/complete     — lock items, require total_offered_eur
 *   POST   /api/appraisals/:id/accept       — Owner accepts: ankauf + child products
 *   POST   /api/appraisals/:id/reject       — reject with reason
 *   GET    /api/appraisals/:id              — full view (header + items + computed totals)
 *
 * ACCEPTED algorithm — pro-rata cost allocation (memory.md #68):
 *   1. Read total_offered_eur (the lump-sum negotiated with the customer).
 *   2. Compute total_appraised_cents = Σ items.individual_appraised_eur (cents).
 *   3. Create one Ankauf transaction with totalEur = total_offered_eur,
 *      customer = appraisal.customer.
 *   4. For each item EXCEPT the last:
 *        allocated_cents = round((item.appraised_cents / total_appraised_cents) × offered_cents)
 *   5. Last item gets the REMAINDER = offered_cents - Σ(prev allocations).
 *      Guarantees Σ children.acquisition_cost ≡ total_offered_eur exactly.
 *   6. Insert one parent product (status='DRAFT', parent_product_id=NULL).
 *   7. Insert N child products (parent_product_id=parent.id, acquisition_cost=allocated).
 *   8. Copy photo_r2_keys[] from each appraisal_item to product_photos rows
 *      (each photo gets product_id=child.id; is_primary=true for the first).
 *   9. Update each appraisal_item.product_id with the spawned child id.
 *  10. Flip appraisal → ACCEPTED with ankauf_transaction_id + accepted_at.
 *  11. Emit `appraisal.accepted` ledger event.
 *
 * Owner-only for ACCEPT. Der Geraetecode steht seit 05.08.2026 nur noch vor
 * dem, was sich nicht widerrufen laesst; eine angenommene Bewertung ist ueber
 * Storno umkehrbar.
 */

import { Type } from '@sinclair/typebox';
import { and, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  appraisalItems,
  appraisals,
  productPhotos,
  products,
  transactionItems,
  transactionPayments,
  transactions,
} from '@norns/db/schema';

import { requireAuth, requireOwner, requireRole } from '../lib/auth-policy.js';
import { nimmTagessperre } from '../lib/tagessperre.js';

import {
  istSicherungseinrichtungEingerichtet,
  satzOhneSicherungseinrichtung,
} from '../lib/kassenpflicht.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { DecimalString } from '../schemas/money.js';

/**
 * Diese Kasse hat nie eine technische Sicherungseinrichtung gesehen.
 *
 * ⚠️ 02.08.2026: das Annehmen einer Bewertung erzeugt einen ANKAUF und war
 * ungeprüft. Begründung und Abgrenzung: `lib/kassenpflicht.ts`.
 */
class KeineTseEingerichtetError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class AppraisalNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class AppraisalConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class AppraisalValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
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
// Schemas — TypeBox
// ────────────────────────────────────────────────────────────────────────

const ItemTypeEnum = Type.Union([
  Type.Literal('gold_jewelry'),
  Type.Literal('gold_coin'),
  Type.Literal('gold_bar'),
  Type.Literal('silver_jewelry'),
  Type.Literal('silver_coin'),
  Type.Literal('silver_bar'),
  Type.Literal('platinum_jewelry'),
  Type.Literal('platinum_coin'),
  Type.Literal('platinum_bar'),
  Type.Literal('antique'),
  Type.Literal('watch'),
  Type.Literal('other'),
]);

const ConditionEnum = Type.Union([
  Type.Literal('NEW'),
  Type.Literal('USED_EXCELLENT'),
  Type.Literal('USED_GOOD'),
  Type.Literal('USED_FAIR'),
  Type.Literal('ANTIQUE_RESTORED'),
  Type.Literal('ANTIQUE_AS_FOUND'),
]);

const AppraisalItemInput = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 256 }),
  description: Type.Optional(Type.String({ maxLength: 4096 })),
  itemType: ItemTypeEnum,
  metal: Type.Optional(
    Type.Union([
      Type.Literal('gold'),
      Type.Literal('silver'),
      Type.Literal('platinum'),
      Type.Literal('palladium'),
    ]),
  ),
  karatCode: Type.Optional(Type.String({ maxLength: 16 })),
  finenessDecimal: Type.Optional(Type.String({ pattern: '^0?\\.\\d{1,4}$|^1\\.0{0,4}$' })),
  weightGrams: Type.Optional(Type.String({ pattern: '^\\d{1,6}(\\.\\d{1,4})?$' })),
  condition: Type.Optional(ConditionEnum),
  hallmarkStamps: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 32 })),
  /** 0143: bei der Bewertung abgelesen (Uhr: Gehaeuse oder Werk). GwG-Zuordnung. */
  seriennummer: Type.Optional(Type.String({ maxLength: 64 })),
  /** 0143: Gravur woertlich. Beschreibung, keine Identitaet. */
  gravur: Type.Optional(Type.String({ maxLength: 256 })),
  individualAppraisedEur: DecimalString,
  photoR2Keys: Type.Optional(Type.Array(Type.String({ maxLength: 256 }), { maxItems: 16 })),
  notes: Type.Optional(Type.String({ maxLength: 4096 })),
});

const AppraisalItemView = Type.Intersect([
  Type.Object({
    id: Type.String({ format: 'uuid' }),
    sequenceInLot: Type.Integer(),
    productId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  }),
  AppraisalItemInput,
]);

const AppraisalView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  customerId: Type.String({ format: 'uuid' }),
  appraisedByUserId: Type.String({ format: 'uuid' }),
  status: Type.Union([
    Type.Literal('DRAFT'),
    Type.Literal('COMPLETED'),
    Type.Literal('ACCEPTED'),
    Type.Literal('REJECTED'),
    Type.Literal('EXPIRED'),
  ]),
  totalAppraisedEur: DecimalString,
  totalOfferedEur: Type.Union([DecimalString, Type.Null()]),
  customerExpectationEur: Type.Union([DecimalString, Type.Null()]),
  ankaufTransactionId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  openedAt: Type.String({ format: 'date-time' }),
  completedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  acceptedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  rejectedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  rejectionReason: Type.Union([Type.String(), Type.Null()]),
  items: Type.Array(AppraisalItemView),
});

// ────────────────────────────────────────────────────────────────────────
// Decimal-safe helpers (integer-cents math, no Number drift)
// ────────────────────────────────────────────────────────────────────────

function toCents(s: string): bigint {
  const [whole, frac = '00'] = s.split('.') as [string, string?];
  const f = (frac ?? '00').padEnd(2, '0').slice(0, 2);
  const sign = whole.startsWith('-') ? -1n : 1n;
  const absWhole = whole.replace(/^-/, '');
  return sign * (BigInt(absWhole || '0') * 100n + BigInt(f));
}
function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────
// Plugin
// ────────────────────────────────────────────────────────────────────────

const appraisalRoutes: FastifyPluginAsync = async (app) => {
  /** Load + render a full appraisal view (header + items + sorted by sequence). */
  async function viewById(
    id: string,
  ): Promise<import('@sinclair/typebox').Static<typeof AppraisalView>> {
    const [a] = await app.db.select().from(appraisals).where(eq(appraisals.id, id)).limit(1);
    if (!a) throw new AppraisalNotFoundError(`Appraisal ${id} not found.`);
    const items = await app.db
      .select()
      .from(appraisalItems)
      .where(eq(appraisalItems.appraisalId, id))
      .orderBy(appraisalItems.sequenceInLot);
    return {
      id: a.id,
      customerId: a.customerId,
      appraisedByUserId: a.appraisedByUserId,
      status: a.status,
      totalAppraisedEur: a.totalAppraisedEur,
      totalOfferedEur: a.totalOfferedEur,
      customerExpectationEur: a.customerExpectationEur,
      ankaufTransactionId: a.ankaufTransactionId,
      notes: a.notes,
      openedAt: a.openedAt.toISOString(),
      completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      acceptedAt: a.acceptedAt ? a.acceptedAt.toISOString() : null,
      rejectedAt: a.rejectedAt ? a.rejectedAt.toISOString() : null,
      rejectionReason: a.rejectionReason,
      items: items.map((i) => {
        // exactOptionalPropertyTypes: omit keys instead of setting undefined.
        const view: import('@sinclair/typebox').Static<typeof AppraisalItemView> = {
          id: i.id,
          sequenceInLot: i.sequenceInLot,
          productId: i.productId,
          name: i.name,
          itemType: i.itemType,
          hallmarkStamps: i.hallmarkStamps,
          individualAppraisedEur: i.individualAppraisedEur,
          photoR2Keys: i.photoR2Keys,
        };
        if (i.description !== null) view.description = i.description;
        if (i.metal !== null) view.metal = i.metal as 'gold' | 'silver' | 'platinum' | 'palladium';
        if (i.karatCode !== null) view.karatCode = i.karatCode;
        if (i.finenessDecimal !== null) view.finenessDecimal = i.finenessDecimal;
        if (i.weightGrams !== null) view.weightGrams = i.weightGrams;
        if (i.condition !== null) view.condition = i.condition;
        if (i.seriennummer !== null) view.seriennummer = i.seriennummer;
        if (i.gravur !== null) view.gravur = i.gravur;
        if (i.notes !== null) view.notes = i.notes;
        return view;
      }),
    };
  }

  /** Recompute and persist appraisals.total_appraised_eur from items. */
  async function recomputeTotalAppraised(tx: typeof app.db, appraisalId: string): Promise<void> {
    const [row] = await tx.execute<{ sum: string | null }>(drizzleSql`
      SELECT COALESCE(SUM(individual_appraised_eur), 0)::text AS sum
        FROM appraisal_items WHERE appraisal_id = ${appraisalId}
    `);
    await tx
      .update(appraisals)
      .set({ totalAppraisedEur: row!.sum ?? '0.00' })
      .where(eq(appraisals.id, appraisalId));
  }

  // ════════════════════════════════════════════════════════════════════
  // POST /api/appraisals — open DRAFT
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Body: { customerId: string; notes?: string; customerExpectationEur?: string } }>(
    '/api/appraisals',
    {
      schema: {
        tags: ['appraisals'],
        summary: 'Open a DRAFT appraisal for a customer.',
        body: Type.Object({
          customerId: Type.String({ format: 'uuid' }),
          notes: Type.Optional(Type.String({ maxLength: 4096 })),
          customerExpectationEur: Type.Optional(DecimalString),
        }),
        response: {
          201: AppraisalView,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      const [a] = await app.db
        .insert(appraisals)
        .values({
          customerId: req.body.customerId,
          appraisedByUserId: req.actor.id,
          notes: req.body.notes ?? null,
          customerExpectationEur: req.body.customerExpectationEur ?? null,
        })
        .returning({ id: appraisals.id });
      if (!a) throw new Error('appraisal insert returned no row');
      return reply.status(201).send(await viewById(a.id));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // GET /api/appraisals/:id
  // ════════════════════════════════════════════════════════════════════

  app.get<{ Params: { id: string } }>(
    '/api/appraisals/:id',
    {
      schema: {
        tags: ['appraisals'],
        summary: 'Get full appraisal view (JSON; PDF deferred to Phase 1.5).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: AppraisalView, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN', 'READONLY');
      return reply.status(200).send(await viewById(req.params.id));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/appraisals/:id/items
  // ════════════════════════════════════════════════════════════════════

  app.post<{
    Params: { id: string };
    Body: import('@sinclair/typebox').Static<typeof AppraisalItemInput>;
  }>(
    '/api/appraisals/:id/items',
    {
      schema: {
        tags: ['appraisals'],
        summary: 'Append an item to a DRAFT appraisal.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: AppraisalItemInput,
        response: {
          200: AppraisalView,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      await app.db.transaction(async (tx) => {
        const [a] = await tx
          .select({ id: appraisals.id, status: appraisals.status })
          .from(appraisals)
          .where(eq(appraisals.id, req.params.id))
          .limit(1);
        if (!a) throw new AppraisalNotFoundError(`Appraisal ${req.params.id} not found.`);
        if (a.status !== 'DRAFT') {
          throw new AppraisalConflictError(`Appraisal is ${a.status}; cannot modify items.`);
        }

        const seqRows = await tx.execute<{ next_seq: number }>(drizzleSql`
          SELECT COALESCE(MAX(sequence_in_lot), -1) + 1 AS next_seq
            FROM appraisal_items WHERE appraisal_id = ${req.params.id}
        `);
        const next_seq = seqRows[0]?.next_seq ?? 0;

        const b = req.body;
        await tx.insert(appraisalItems).values({
          appraisalId: req.params.id,
          sequenceInLot: next_seq,
          name: b.name,
          description: b.description ?? null,
          itemType: b.itemType,
          metal: b.metal ?? null,
          karatCode: b.karatCode ?? null,
          finenessDecimal: b.finenessDecimal ?? null,
          weightGrams: b.weightGrams ?? null,
          condition: b.condition ?? null,
          hallmarkStamps: b.hallmarkStamps ?? [],
          seriennummer: b.seriennummer ?? null,
          gravur: b.gravur ?? null,
          individualAppraisedEur: b.individualAppraisedEur,
          photoR2Keys: b.photoR2Keys ?? [],
          notes: b.notes ?? null,
        });
        await recomputeTotalAppraised(tx as typeof app.db, req.params.id);
      });
      return reply.status(200).send(await viewById(req.params.id));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // DELETE /api/appraisals/:id/items/:itemId
  // ════════════════════════════════════════════════════════════════════

  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/appraisals/:id/items/:itemId',
    {
      schema: {
        tags: ['appraisals'],
        summary: 'Remove an item from a DRAFT appraisal.',
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          itemId: Type.String({ format: 'uuid' }),
        }),
        response: {
          200: AppraisalView,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      await app.db.transaction(async (tx) => {
        const [a] = await tx
          .select({ id: appraisals.id, status: appraisals.status })
          .from(appraisals)
          .where(eq(appraisals.id, req.params.id))
          .limit(1);
        if (!a) throw new AppraisalNotFoundError(`Appraisal ${req.params.id} not found.`);
        if (a.status !== 'DRAFT') {
          throw new AppraisalConflictError(`Appraisal is ${a.status}; cannot remove items.`);
        }
        const res = await tx
          .delete(appraisalItems)
          .where(
            and(
              eq(appraisalItems.id, req.params.itemId),
              eq(appraisalItems.appraisalId, req.params.id),
            ),
          );
        // `res` from postgres-js doesn't expose row count uniformly; we tolerate "no-op delete".
        await recomputeTotalAppraised(tx as typeof app.db, req.params.id);
        void res;
      });
      return reply.status(200).send(await viewById(req.params.id));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/appraisals/:id/complete
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Params: { id: string }; Body: { totalOfferedEur: string } }>(
    '/api/appraisals/:id/complete',
    {
      schema: {
        tags: ['appraisals'],
        summary: 'Lock items + set total_offered_eur. DRAFT → COMPLETED.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ totalOfferedEur: DecimalString }),
        response: {
          200: AppraisalView,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      await app.db.transaction(async (tx) => {
        const [a] = await tx
          .select()
          .from(appraisals)
          .where(eq(appraisals.id, req.params.id))
          .limit(1);
        if (!a) throw new AppraisalNotFoundError(`Appraisal ${req.params.id} not found.`);
        if (a.status !== 'DRAFT') {
          throw new AppraisalConflictError(`Appraisal is ${a.status}; cannot complete.`);
        }
        const countRows = await tx.execute<{ c: string }>(drizzleSql`
          SELECT COUNT(*)::text AS c FROM appraisal_items WHERE appraisal_id = ${req.params.id}
        `);
        const c = countRows[0]?.c ?? '0';
        if (Number.parseInt(c, 10) === 0) {
          throw new AppraisalValidationError(
            'Cannot complete an empty appraisal — add at least one item.',
          );
        }
        await tx
          .update(appraisals)
          .set({
            status: 'COMPLETED',
            totalOfferedEur: req.body.totalOfferedEur,
            completedAt: new Date(),
          })
          .where(eq(appraisals.id, req.params.id));
      });
      return reply.status(200).send(await viewById(req.params.id));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/appraisals/:id/accept — Owner-only, pro-rata allocation
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Params: { id: string } }>(
    '/api/appraisals/:id/accept',
    {
      schema: {
        tags: ['appraisals'],
        summary: 'Owner accepts: creates Ankauf + child products with pro-rata cost allocation.',
        description:
          'Owner-only. The route runs the pro-rata-by-appraisal ' +
          'algorithm (memory.md #68) so each spawned child product carries an acquisition_cost ' +
          'that sums exactly to appraisals.total_offered_eur (last child absorbs rounding remainder).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: AppraisalView,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireOwner(req); // ONLY the Owner can finalise Ankauf decisions
      // The Owner DOES need a paired device (mTLS) — Ankauf is fiscal.
      const deviceId = req.deviceId;
      if (!deviceId) {
        throw new DeviceRequiredError('Accepting an appraisal requires a paired device.');
      }

      // ── IST DAS ÜBERHAUPT EINE KASSE NACH § 146a AO? ──────────────────
      //
      // ⚠️ Das Annehmen einer Bewertung schreibt eine ANKAUF-Zeile in die
      // fiskalische Tabelle. Bis zum 02.08.2026 ungeprüft, während der
      // Verkauf anhielt. Begründung: `lib/kassenpflicht.ts`.
      // ⚠️ 15.08.2026: Gnadenfrist gestrichen. Eine angenommene Bewertung
      // schreibt eine ANKAUF-Zeile, also gilt hier derselbe harte Riegel wie
      // am Verkauf: ohne Sicherungseinrichtung kein Vorgang.
      if (!(await istSicherungseinrichtungEingerichtet(app.db))) {
        throw new KeineTseEingerichtetError(satzOhneSicherungseinrichtung('Ankauf'));
      }

      await app.db.transaction(async (tx) => {
        // Die Tagessperre auf den Geschäftstag dieses Vorgangs. Der Abschluss
        // nimmt die ausschliessliche Sperre auf denselben Schlüssel und wartet
        // damit auf uns, statt mitten im Rechnen an uns vorbeizulaufen.
        // Siehe `tagessperre.ts`: bis zum 08.08.2026 nahm sie NUR der Verkauf.
        await nimmTagessperre(tx);
        const [a] = await tx
          .select()
          .from(appraisals)
          .where(eq(appraisals.id, req.params.id))
          .limit(1);
        if (!a) throw new AppraisalNotFoundError(`Appraisal ${req.params.id} not found.`);
        if (a.status !== 'COMPLETED') {
          throw new AppraisalConflictError(
            `Appraisal is ${a.status}; only COMPLETED can be accepted.`,
          );
        }
        if (!a.totalOfferedEur) {
          throw new AppraisalValidationError('total_offered_eur is missing on the appraisal.');
        }

        const items = await tx
          .select()
          .from(appraisalItems)
          .where(eq(appraisalItems.appraisalId, a.id))
          .orderBy(appraisalItems.sequenceInLot);
        if (items.length === 0) {
          throw new AppraisalValidationError('Appraisal has no items.');
        }

        // 1. Decimal-safe pro-rata allocation.
        const offeredCents = toCents(a.totalOfferedEur);
        /*
         * ⛔ NULL EURO IST KEIN ANKAUF (19.08.2026, boeswillige Pruefung).
         *
         * Der Riegel darueber prueft `!a.totalOfferedEur` — und die
         * ZEICHENKETTE '0.00' ist wahr, kommt also durch. Der Riegel darunter
         * prueft die SCHAETZUNG, nicht das GEBOT. Es entstand ein
         * unveraenderlicher Ankaufbeleg nach § 146a AO ueber 0,00 EUR, samt
         * Kindprodukten mit Einkaufspreis null.
         *
         * Die Folge wirkt erst beim WIEDERVERKAUF: bei Differenzbesteuerung
         * ist die Marge Verkauf minus Einkauf — mit Einkauf null wird der
         * ganze Verkaufspreis zur Marge, und der Haendler versteuert Geld,
         * das er nie verdient hat.
         *
         * Der Schwesterweg (`transactions-ankauf.ts:260`) hat diesen Riegel
         * seit jeher: `declaredTotalCents <= 0n`. Zwei Ankaufwege mit zwei
         * Betragsregeln sind die Hausklasse „dieselbe Sache, zwei Wahrheiten".
         */
        if (offeredCents <= 0n) {
          throw new AppraisalValidationError(
            'Das Gebot betraegt 0,00 EUR. Ein Ankauf ohne Gegenwert ist kein Ankauf; ' +
              'bitte das Gebot eintragen, bevor die Bewertung angenommen wird.',
          );
        }
        const totalAppraisedCents = items.reduce(
          (sum, it) => sum + toCents(it.individualAppraisedEur),
          0n,
        );
        if (totalAppraisedCents <= 0n) {
          throw new AppraisalValidationError('Total appraised value is zero — cannot allocate.');
        }

        const allocations: bigint[] = new Array(items.length).fill(0n);
        let allocated = 0n;
        for (let i = 0; i < items.length - 1; i++) {
          const itemCents = toCents(items[i]!.individualAppraisedEur);
          // round-half-up: (a * b + half) / c (with half = c/2)
          const half = totalAppraisedCents / 2n;
          const alloc = (itemCents * offeredCents + half) / totalAppraisedCents;
          allocations[i] = alloc;
          allocated += alloc;
        }
        // Last item absorbs remainder for exact sum.
        allocations[items.length - 1] = offeredCents - allocated;
        // Defensive: refuse if remainder went negative (means rounding overran offered).
        if (allocations[items.length - 1]! < 0n) {
          throw new AppraisalValidationError(
            'pro-rata allocation produced a negative remainder — Internal rounding bug.',
          );
        }

        // ⚠️ DIE SCHICHT. Ohne sie verschwindet das Bargeld aus dem Kassensturz.
        //
        // Der Blindsturz in `shifts.ts` zieht die Auszahlungen über
        // `WHERE t.shift_id = … AND t.direction = 'ANKAUF' AND
        // tp.payment_method = 'CASH'` ab. Steht hier keine Schicht, trifft
        // diese Unterabfrage null Zeilen: die Kassiererin zählt die Lade, es
        // fehlen 2.000 Euro, und das System bestätigt ihr, es fehlten 2.000
        // Euro. Die Auszahlung, die sie selbst getätigt hat, kennt der
        // Erwartungswert nicht, und die Differenz bleibt dauerhaft auf ihrer
        // Schicht stehen.
        //
        // `transactions-ankauf.ts` machte das seit jeher richtig; dieser
        // zweite Ankaufweg nicht. 02.08.2026 angeglichen, wörtlich dieselbe
        // Abfrage.
        const schichtZeilen = await tx.execute<{ id: string }>(drizzleSql`
          SELECT id::text AS id FROM shifts
           WHERE device_id = ${deviceId}::uuid AND status = 'OPEN' LIMIT 1`);
        const schichtId = schichtZeilen[0]?.id ?? null;

        // 2. Create the Ankauf transaction. For Ankauf direction, taxes:
        //    Ankauf carries NO VAT (we buy from a private person, §25a "Erwerb").
        //    subtotal = total, vat = 0.
        const [ankaufTx] = await tx
          .insert(transactions)
          .values({
            direction: 'ANKAUF',
            customerId: a.customerId,
            deviceId,
            shiftId: schichtId,
            cashierUserId: req.actor.id,
            subtotalEur: a.totalOfferedEur,
            vatEur: '0.00',
            totalEur: a.totalOfferedEur,
            taxTreatmentCode: 'MARGIN_25A', // Erwerb that will later trigger §25a on sale
            notesInternal: `[appraisal:${a.id}] accepted by Owner ${req.actor.id}`,
          })
          .returning({ id: transactions.id });
        if (!ankaufTx) throw new Error('ankauf insert returned no row');

        // 3. Create parent product (lot header). Status DRAFT until photo workflow done.
        const lotName = `Konvolut ${a.id.slice(0, 8)} (${items.length} Stk.)`;
        const [parent] = await tx
          .insert(products)
          .values({
            sku: `LOT-${a.id.slice(0, 12)}`,
            status: 'DRAFT',
            taxTreatmentCode: 'MARGIN_25A',
            itemType: 'other',
            acquisitionCostEur: a.totalOfferedEur,
            listPriceEur: a.totalOfferedEur, // operator updates per child later
            name: lotName,
            isCommission: false,
            acquiredFromCustomerId: a.customerId,
          })
          .returning({ id: products.id });
        if (!parent) throw new Error('parent product insert returned no row');

        // 4. Create children with allocated costs + link to appraisal_items + photos.
        const itemUpdates: Array<{ itemId: string; productId: string }> = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i]!;
          const alloc = allocations[i]!;
          const allocStr = fromCents(alloc);
          const [child] = await tx
            .insert(products)
            .values({
              sku: `LOT-${a.id.slice(0, 12)}-${String(i + 1).padStart(3, '0')}`,
              status: 'DRAFT',
              taxTreatmentCode: 'MARGIN_25A',
              itemType: item.itemType,
              metal: item.metal,
              karatCode: item.karatCode,
              finenessDecimal: item.finenessDecimal,
              weightGrams: item.weightGrams,
              hallmarkStamps: item.hallmarkStamps,
              // 0143: die bei der Bewertung abgelesene Nummer wandert mit —
              // eine Erfassung, ein Pfad (Bewertung -> Lager -> Beleg).
              seriennummer: item.seriennummer,
              gravur: item.gravur,
              acquisitionCostEur: allocStr,
              listPriceEur: item.individualAppraisedEur, // initial guess = our appraised market value
              name: item.name,
              descriptionDe: item.description,
              condition: item.condition ?? 'USED_GOOD',
              isCommission: false,
              acquiredFromCustomerId: a.customerId,
              parentProductId: parent.id,
            })
            .returning({ id: products.id });
          if (!child) throw new Error('child product insert returned no row');

          // Copy photos.
          if (item.photoR2Keys.length > 0) {
            await tx.insert(productPhotos).values(
              item.photoR2Keys.map((key, idx) => ({
                productId: child.id,
                r2Key: key,
                displayOrder: idx,
                isPrimary: idx === 0,
                source: 'admin_upload' as const,
              })),
            );
          }
          itemUpdates.push({ itemId: item.id, productId: child.id });
        }

        // 4b. INSERT transaction_items (#I-38 closure, Day 11).
        //     One row per child product, line_total = its allocated cost.
        //     line_subtotal = line_total, line_vat = 0 — Ankauf has no VAT,
        //     §25a margin materialises on the FUTURE Verkauf only.
        await tx.insert(transactionItems).values(
          itemUpdates.map((u, idx) => ({
            transactionId: ankaufTx.id,
            productId: u.productId,
            lineSubtotalEur: fromCents(allocations[idx]!),
            lineVatEur: '0.00',
            lineTotalEur: fromCents(allocations[idx]!),
            appliedTaxTreatmentCode: 'MARGIN_25A' as const,
            appliedVatRate: null,
            /*
             * ⛔ 14.08.2026: HIER STAND `fromCents(allocations[idx]!)`, UND
             *    DIESER WEG HAT DESHALB NIE FUNKTIONIERT. NICHT EINMAL.
             *
             * ── DER BEFUND ─────────────────────────────────────────────
             *
             * Die Regel `transaction_items_margin_implies_acquisition`
             * (Wanderung 0009) verlangt:
             *
             *     (margin_eur IS NULL) = (acquisition_cost_eur_snapshot IS NULL)
             *
             * Beides NULL oder beides gesetzt. Hier stand der Schnappschuss
             * gesetzt und die Marge auf NULL. Jede Annahme einer Bewertung
             * endete mit 409 und schrieb NICHTS. Gemessen am 14.08.2026 beim
             * allerersten Lauf dieses Weges gegen ein echtes Postgres.
             *
             * ── UND ES IST DERSELBE FEHLER ZWEIMAL ─────────────────────
             *
             * `transactions-ankauf.ts` trug ihn auch und ist dort behoben
             * worden. Der Kommentar an der Fundstelle sagt es woertlich:
             * die Regel habe „previously made every Ankauf payout fail with
             * a 409 and committed zero buy-ins". Der Fix traf EINEN der zwei
             * Ankaufwege. Der zweite blieb kaputt und fiel nicht auf, weil
             * ihn kein Lauf je gefahren hat.
             *
             * ── WARUM NULL UND NICHT MARGE AUF 0,00 ────────────────────
             *
             * Ein Ankauf realisiert keine Marge. Die Marge nach § 25a UStG
             * entsteht erst beim spaeteren VERKAUF dieser Stuecke. Eine 0,00
             * hier waere eine Angabe, und zwar eine falsche.
             *
             * Verloren geht nichts: die anteiligen Anschaffungskosten stehen
             * am PRODUKT (`acquisitionCostEur`, oben in dieser Datei), wo sie
             * hingehoeren und wo der spaetere Verkauf sie liest.
             */
            acquisitionCostEurSnapshot: null,
            marginEur: null,
            displayOrder: idx,
          })),
        );

        // 4c. INSERT transaction_payments — V1 always CASH outflow.
        //     Sum equals total_offered_eur exactly. The DEFERRABLE balance
        //     trigger (migration 0016) verifies at COMMIT.
        await tx.insert(transactionPayments).values({
          transactionId: ankaufTx.id,
          paymentMethod: 'CASH',
          amountEur: a.totalOfferedEur,
        });

        // 5. Link items back to spawned products.
        for (const u of itemUpdates) {
          await tx
            .update(appraisalItems)
            .set({ productId: u.productId })
            .where(eq(appraisalItems.id, u.itemId));
        }

        // 6. Flip appraisal → ACCEPTED.
        await tx
          .update(appraisals)
          .set({
            status: 'ACCEPTED',
            ankaufTransactionId: ankaufTx.id,
            acceptedAt: new Date(),
          })
          .where(eq(appraisals.id, a.id));

        // 7. Emit a ledger event for the SSE feed + audit.
        await tx.execute(drizzleSql`
          INSERT INTO ledger_events (event_type, entity_table, entity_id, actor_user_id, device_id, payload)
          VALUES ('appraisal.accepted', 'appraisals', ${a.id}, ${req.actor.id}, ${deviceId},
                  jsonb_build_object(
                    'ankaufTransactionId', ${ankaufTx.id}::text,
                    'parentProductId',     ${parent.id}::text,
                    'totalOfferedEur',     ${a.totalOfferedEur}::text,
                    'itemCount',           ${items.length}::int
                  ))
        `);
      });
      return reply.status(200).send(await viewById(req.params.id));
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/appraisals/:id/reject
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/api/appraisals/:id/reject',
    {
      schema: {
        tags: ['appraisals'],
        summary: 'Reject the appraisal (customer or owner declined).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({ reason: Type.String({ minLength: 4, maxLength: 1024 }) }),
        response: {
          200: AppraisalView,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      await app.db.transaction(async (tx) => {
        const [a] = await tx
          .select({ status: appraisals.status })
          .from(appraisals)
          .where(eq(appraisals.id, req.params.id))
          .limit(1);
        if (!a) throw new AppraisalNotFoundError(`Appraisal ${req.params.id} not found.`);
        if (a.status === 'ACCEPTED') {
          throw new AppraisalConflictError(
            'Cannot reject an ACCEPTED appraisal — use return/storno instead.',
          );
        }
        if (a.status === 'REJECTED') {
          throw new AppraisalConflictError('Appraisal is already REJECTED.');
        }
        await tx
          .update(appraisals)
          .set({
            status: 'REJECTED',
            rejectedAt: new Date(),
            rejectionReason: req.body.reason,
            completedAt: drizzleSql`COALESCE(${appraisals.completedAt}, now())` as never,
          })
          .where(eq(appraisals.id, req.params.id));
      });
      return reply.status(200).send(await viewById(req.params.id));
    },
  );
};

export default appraisalRoutes;
