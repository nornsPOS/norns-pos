/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Die WARENRÜCKNAHME — ein Kunde bringt EINEN Ring zurück (19.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   GET  /api/transactions/:id/positionen   Was stand auf dem Bon, und was
 *                                           davon ist schon zurückgegeben?
 *   POST /api/transactions/rueckgabe        Ausgewählte Positionen zurücknehmen.
 *
 * ── WARUM DER STORNO HIER NICHT REICHT ──────────────────────────────────────
 *
 * Der Storno spiegelt den GANZEN Beleg (alles-oder-nichts, ein Mal je
 * Original). Der Kunde mit einem Ring aus einem Drei-Positionen-Bon hatte
 * keinen Weg — und der naheliegende („storniere alles, verkauf den Rest
 * neu") erzeugt zwei falsche Zahlungsströme und bei Kartenzahlung ein
 * doppeltes Terminal-Theater.
 *
 * Die Norm beschreibt den richtigen Weg wörtlich (DSFinV-K 2.4, Tz. 4.2.5):
 * Warenrücknahmen sind ein NEUER Beleg „wie bei einem normalen Verkauf",
 * nur mit negativem Vorzeichen. BON_STORNO bleibt 0; der Positionsstorno am
 * signierten Original ist verboten (Tz. 4.2.3). Umsatzsteuerlich ist es die
 * Minderung der Bemessungsgrundlage in der LAUFENDEN Periode
 * (§ 17 Abs. 1 Satz 8, Abs. 2 Nr. 3 UStG).
 *
 * ── DIE REGELN, DIE DIESER WEG DURCHSETZT ───────────────────────────────────
 *
 *  1. NIE mehr zurück als verkauft: je Position höchstens einmal — die
 *     bereits zurückgegebenen Positionen aller früheren Rückgaben zum selben
 *     Original zählen mit. (Jede Zeile dieses Hauses ist EIN Stück.)
 *  2. § 25a-Positionen gehen NICHT über diesen Weg. Ob eine Kulanzrücknahme
 *     die Marge des Ursprungsgeschäfts mindert (Rückabwicklung) oder ein
 *     neuer Ankauf ist (Rücklieferung), regelt der UStAE nicht — die Frage
 *     liegt beim Steuerberater (steuerberater-fragen.ts). Bis zur Antwort
 *     ist der ANKAUF der ehrliche, immer zulässige Weg für diese Stücke.
 *  3. Barauszahlung ab 2.000 EUR nur mit ausweisverifiziertem Kunden:
 *     § 1 Abs. 10 Nr. 1, § 10 Abs. 6a Nr. 1 GwG — Edelmetalle und Schmuck,
 *     und „tätigen" umfasst die Auszahlung, nicht nur die Annahme.
 *  4. Bar nur mit offener Schicht (sonst fehlt das Geld im Kassensturz) —
 *     dieselbe Regel wie beim Storno.
 *  5. Das zurückgenommene Stück kehrt in den Bestand zurück
 *     (SOLD → AVAILABLE), denn es LIEGT wieder im Laden.
 */

import { Type } from '@sinclair/typebox';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  transactionItems,
  transactionPayments,
  transactions,
} from '@norns/db/schema';
import { Money } from '@norns/domain';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { pruefeErfassungszeit } from '../lib/erfassungszeit.js';
import { buchungszeitpunkt, nimmTagessperre } from '../lib/tagessperre.js';
import { auditLog, ledgerEvents } from '@norns/db/schema';

// ── Fehler, alle mit deutschem Satz an den Tresen ───────────────────────────

class OriginalNichtGefundenError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class RueckgabeUnzulaessigError extends DomainError {
  public readonly httpStatus = 422;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class RueckgabeKonfliktError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class ZeitAngabeFehlerhaftError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: unknown;
  public constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}

/** GwG-Schwelle für Edelmetalle und Schmuck (§ 10 Abs. 6a Nr. 1 GwG). */
const GWG_BAR_SCHWELLE_CENT = 200_000n;

// ── Schemas ─────────────────────────────────────────────────────────────────

const PositionenResponse = Type.Object({
  receiptLocator: Type.String(),
  direction: Type.String(),
  isStorno: Type.Boolean(),
  alreadyStornoed: Type.Boolean(),
  positionen: Type.Array(
    Type.Object({
      productId: Type.String(),
      name: Type.String(),
      sku: Type.String(),
      lineTotalEur: Type.String(),
      appliedTaxTreatmentCode: Type.Union([Type.String(), Type.Null()]),
      /** Bereits über eine frühere Rückgabe zurückgenommen. */
      bereitsZurueck: Type.Boolean(),
      /**
       * § 25a: dieser Weg ist gesperrt, der Ankauf ist der richtige.
       * Der Tresen zeigt den Grund, statt stumm auszugrauen.
       */
      nurUeberAnkauf: Type.Boolean(),
    }),
  ),
});

const RueckgabeBody = Type.Object({
  originalTransactionId: Type.String({ format: 'uuid' }),
  /** Die zurückgenommenen Stücke (je Zeile ein Stück). */
  productIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 200 }),
  /** Der Grund, fürs Protokoll — Pflicht wie beim Storno. */
  reason: Type.String({ minLength: 3, maxLength: 500 }),
  /** Gerätezeit des Vorgangs (0118). */
  erfasstAm: Type.Optional(Type.String({ format: 'date-time' })),
  /** Ausweisverifizierter Kunde — Pflicht ab 2.000 EUR Barauszahlung (GwG). */
  customerId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
});

const RueckgabeResponse = Type.Object({
  id: Type.String(),
  receiptLocator: Type.String(),
  finalizedAt: Type.String(),
  totalEur: Type.String(),
  nachtragBezugstag: Type.Union([Type.String(), Type.Null()]),
  ustAufteilung: Type.Array(
    Type.Object({ taxTreatmentCode: Type.String(), bruttoCents: Type.Number() }),
  ),
  zahlartTse: Type.Union([Type.Literal('CASH'), Type.Literal('NON_CASH')]),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

function negiere(dezimal: string): string {
  return Money.of(dezimal).multiply('-1').toString();
}

const transactionsRueckgabeRoute: FastifyPluginAsync = async (app) => {
  // ── Die Positionen des Originals, mit Rückgabe-Stand ─────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/transactions/:id/positionen',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Positionen eines Belegs samt Rückgabe-Stand (für den Rückgabe-Dialog).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: PositionenResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      const { id } = req.params;

      const koepfe = await app.db.execute<{
        receipt_locator: string;
        direction: string;
        is_storno: boolean;
        already_stornoed: boolean;
      }>(drizzleSql`
        SELECT t.receipt_locator, t.direction::text AS direction,
               (t.storno_of_transaction_id IS NOT NULL) AS is_storno,
               EXISTS (SELECT 1 FROM transactions s WHERE s.storno_of_transaction_id = t.id)
                 AS already_stornoed
          FROM transactions t WHERE t.id = ${id}::uuid`);
      const kopf = koepfe[0];
      if (!kopf) {
        throw new OriginalNichtGefundenError(`Beleg ${id} existiert nicht.`);
      }

      const zeilen = await app.db.execute<{
        product_id: string;
        name: string;
        sku: string;
        line_total_eur: string;
        applied_tax_treatment_code: string | null;
        bereits_zurueck: boolean;
      }>(drizzleSql`
        SELECT ti.product_id::text AS product_id,
               p.name, p.sku,
               ti.line_total_eur::text AS line_total_eur,
               ti.applied_tax_treatment_code,
               EXISTS (
                 SELECT 1 FROM transactions r
                   JOIN transaction_items ri ON ri.transaction_id = r.id
                  WHERE r.rueckgabe_zu_transaction_id = ${id}::uuid
                    AND ri.product_id = ti.product_id
               ) AS bereits_zurueck
          FROM transaction_items ti
          JOIN products p ON p.id = ti.product_id
         WHERE ti.transaction_id = ${id}::uuid
         ORDER BY ti.display_order`);

      return reply.status(200).send({
        receiptLocator: kopf.receipt_locator,
        direction: kopf.direction,
        isStorno: kopf.is_storno,
        alreadyStornoed: kopf.already_stornoed,
        positionen: zeilen.map((z) => ({
          productId: z.product_id,
          name: z.name,
          sku: z.sku,
          lineTotalEur: z.line_total_eur,
          appliedTaxTreatmentCode: z.applied_tax_treatment_code,
          bereitsZurueck: z.bereits_zurueck,
          nurUeberAnkauf: z.applied_tax_treatment_code === 'MARGIN_25A',
        })),
      });
    },
  );

  // ── Die Rücknahme selbst ──────────────────────────────────────────────────
  app.post<{ Body: { originalTransactionId: string; productIds: string[]; reason: string; erfasstAm?: string; customerId?: string | null } }>(
    '/api/transactions/rueckgabe',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Warenrücknahme: ausgewählte Positionen eines Verkaufs zurücknehmen (Tz. 4.2.5).',
        description:
          'Neuer Beleg mit negativen Beträgen, BON_STORNO = 0, Referenz auf das Original. ' +
          'Barauszahlung; ab 2.000 EUR nur mit ausweisverifiziertem Kunden (GwG). ' +
          '§ 25a-Positionen sind gesperrt — sie gehen über den Ankauf.',
        body: RueckgabeBody,
        response: {
          200: RueckgabeResponse,
          400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse,
          404: ErrorResponse, 409: ErrorResponse, 422: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      // Geld verlässt das Haus — dieselbe Schwelle wie beim Storno.
      requireStepUp(req);

      const { originalTransactionId, productIds, reason, customerId } = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      const zeitbefund = pruefeErfassungszeit(req.body.erfasstAm, new Date());
      if (zeitbefund.fehler) {
        throw new ZeitAngabeFehlerhaftError(zeitbefund.fehler.nachricht, zeitbefund.fehler.einzelheiten);
      }
      const erfasstAm = zeitbefund.erfasstAm;

      const result = await app.db.transaction(async (tx) => {
        // Nachtrag-Weiche, wortgleich mit Verkauf und Storno.
        let nachtragBezugstag: string | null = null;
        let erfassungstagAbgeschlossen = false;
        if (erfasstAm !== null) {
          const tagRows = await tx.execute<{ tag: string; abgeschlossen: boolean }>(drizzleSql`
            SELECT berlin_business_day(${erfasstAm.toISOString()}::timestamptz)::text AS tag,
                   EXISTS (
                     SELECT 1 FROM daily_closings dc
                      WHERE dc.business_day = berlin_business_day(${erfasstAm.toISOString()}::timestamptz)
                        AND dc.shop_id IS NULL AND dc.state = 'FINALIZED'
                   ) AS abgeschlossen`);
          if (tagRows[0]?.abgeschlossen) {
            nachtragBezugstag = tagRows[0].tag;
            erfassungstagAbgeschlossen = true;
          }
        }
        const finalizedAtWert = buchungszeitpunkt(erfasstAm ?? null, erfassungstagAbgeschlossen);
        await nimmTagessperre(tx, finalizedAtWert);

        // 1. Das Original.
        const originalRows = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.id, originalTransactionId))
          .limit(1);
        const original = originalRows[0];
        if (!original) {
          throw new OriginalNichtGefundenError(`Beleg ${originalTransactionId} existiert nicht.`);
        }
        if (original.direction !== 'VERKAUF') {
          throw new RueckgabeUnzulaessigError(
            'Zurückgenommen werden kann nur ein Verkauf. Ein Ankauf wird über den Storno rückgängig gemacht.',
          );
        }
        if (original.stornoOfTransactionId != null || original.rueckgabeZuTransactionId != null) {
          throw new RueckgabeUnzulaessigError(
            'Dieser Beleg ist selbst eine Aufhebung — zurückgenommen wird immer der ursprüngliche Verkauf.',
          );
        }
        const schonStorniert = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.stornoOfTransactionId, originalTransactionId))
          .limit(1);
        if (schonStorniert[0]) {
          throw new RueckgabeKonfliktError(
            'Dieser Beleg ist bereits vollständig storniert — es gibt nichts mehr zurückzunehmen.',
          );
        }

        // 2. Die gewählten Positionen — jede genau einmal, jede vom Original,
        //    keine schon zurückgegeben, keine § 25a.
        const gewaehlt = new Set(productIds);
        if (gewaehlt.size !== productIds.length) {
          throw new RueckgabeUnzulaessigError('Ein Stück kann je Rückgabe nur einmal gewählt werden.');
        }
        const originalItems = await tx
          .select()
          .from(transactionItems)
          .where(eq(transactionItems.transactionId, originalTransactionId));
        const jeProdukt = new Map(originalItems.map((i) => [i.productId, i]));
        for (const pid of gewaehlt) {
          if (!jeProdukt.has(pid)) {
            throw new RueckgabeUnzulaessigError(
              'Ein gewähltes Stück steht nicht auf diesem Beleg. Bitte den Beleg neu laden.',
            );
          }
        }
        const schonZurueck = await tx.execute<{ product_id: string }>(drizzleSql`
          SELECT ri.product_id::text AS product_id
            FROM transactions r
            JOIN transaction_items ri ON ri.transaction_id = r.id
           WHERE r.rueckgabe_zu_transaction_id = ${originalTransactionId}::uuid`);
        const zurueckMenge = new Set(schonZurueck.map((z) => z.product_id));
        for (const pid of gewaehlt) {
          if (zurueckMenge.has(pid)) {
            throw new RueckgabeKonfliktError(
              'Mindestens ein gewähltes Stück wurde bereits zurückgenommen. Bitte den Beleg neu laden.',
            );
          }
        }
        const zeilen = productIds.map((pid) => jeProdukt.get(pid)!);
        for (const z of zeilen) {
          if (z.appliedTaxTreatmentCode === 'MARGIN_25A') {
            /*
             * § 25a: ob die Kulanzrücknahme die MARGE des Ursprungsgeschäfts
             * mindert (Rückabwicklung, § 17 Abs. 2 Nr. 3) oder ein NEUER
             * Ankauf ist (Rücklieferung, UStAE 17.1 Abs. 8), regelt der
             * UStAE nicht — Frage A3b an den Steuerberater. Der Ankauf ist
             * bis dahin der immer zulässige Weg, und die Kasse sagt das,
             * statt still eine Steuerwirkung zu erfinden.
             */
            throw new RueckgabeUnzulaessigError(
              'Differenzbesteuerte Stücke (§ 25a) werden bis zur Antwort des Steuerberaters ' +
                'über den ANKAUF zurückgenommen: Stück im Ankauf erfassen, Auszahlung dort. ' +
                'Grund: die Norm lässt offen, ob die Rücknahme die alte Marge mindert oder ' +
                'ein neuer Einkauf ist.',
            );
          }
        }

        // 3. Beträge: Summe der gewählten Zeilen, negiert.
        let subtotal = Money.of('0');
        let vat = Money.of('0');
        let total = Money.of('0');
        for (const z of zeilen) {
          subtotal = subtotal.add(Money.of(z.lineSubtotalEur));
          vat = vat.add(Money.of(z.lineVatEur));
          total = total.add(Money.of(z.lineTotalEur));
        }
        // Money → Cent ohne Gleitkomma: über die kanonische Zeichenkette.
        const totalCentAbs = (() => {
          const [euros, cents = '00'] = total.toString().replace('-', '').split('.');
          return BigInt(euros!) * 100n + BigInt(cents.padEnd(2, '0').slice(0, 2));
        })();

        // 4. GwG: Barauszahlung ab 2.000 EUR nur mit ausweisverifiziertem Kunden.
        if (totalCentAbs >= GWG_BAR_SCHWELLE_CENT) {
          if (!customerId) {
            throw new RueckgabeUnzulaessigError(
              'Barauszahlungen ab 2.000 EUR verlangen einen ausweisverifizierten Kunden ' +
                '(§ 10 Abs. 6a Nr. 1 GwG, Edelmetalle und Schmuck). Bitte den Kunden erfassen.',
            );
          }
          const kyc = await tx.execute<{ ok: boolean }>(drizzleSql`
            SELECT (kyc_verified_at IS NOT NULL) AS ok FROM customers WHERE id = ${customerId}::uuid`);
          if (!kyc[0]?.ok) {
            throw new RueckgabeUnzulaessigError(
              'Der erfasste Kunde ist nicht ausweisverifiziert. Ab 2.000 EUR Barauszahlung ' +
                'verlangt § 10 GwG die Identifizierung.',
            );
          }
        }

        // 5. Bar nur mit offener Schicht — das Geld muss im Kassensturz stehen.
        const geraet = deviceId ?? original.deviceId;
        const schichtZeilen = await tx.execute<{ id: string }>(drizzleSql`
          SELECT id::text AS id FROM shifts
           WHERE device_id = ${geraet}::uuid AND status = 'OPEN' LIMIT 1`);
        const schicht = schichtZeilen[0]?.id ?? null;
        if (schicht === null) {
          throw new RueckgabeKonfliktError(
            'Für eine Barauszahlung muss eine Schicht geöffnet sein. Ohne Schicht erscheint ' +
              'dieses Geld in keinem Kassensturz. Bitte zuerst eine Schicht öffnen.',
          );
        }

        // 6. Der Rückgabe-Beleg. Kopf-Steuerart: eine Behandlung → sie selbst,
        //    mehrere → MIXED (wie beim Verkauf).
        const behandlungen = new Set(zeilen.map((z) => z.appliedTaxTreatmentCode ?? 'MIXED'));
        const kopfBehandlung = behandlungen.size === 1 ? [...behandlungen][0]! : 'MIXED';

        const eingefuegt = await tx
          .insert(transactions)
          .values({
            direction: 'VERKAUF',
            ...(finalizedAtWert ? { finalizedAt: finalizedAtWert } : {}),
            ...(erfasstAm ? { erfasstAm } : {}),
            ...(nachtragBezugstag ? { nachtragBezugstag } : {}),
            customerId: customerId ?? original.customerId,
            deviceId: geraet,
            shiftId: schicht,
            cashierUserId: actorId,
            subtotalEur: negiere(subtotal.toString()),
            vatEur: negiere(vat.toString()),
            totalEur: negiere(total.toString()),
            taxTreatmentCode: kopfBehandlung,
            rueckgabeZuTransactionId: originalTransactionId,
          })
          .returning({
            id: transactions.id,
            receiptLocator: transactions.receiptLocator,
            finalizedAt: transactions.finalizedAt,
          });
        const rueckgabe = eingefuegt[0];
        if (!rueckgabe) throw new Error('Rueckgabe INSERT returned no row');

        await tx.insert(transactionItems).values(
          zeilen.map((z) => ({
            transactionId: rueckgabe.id,
            productId: z.productId,
            lineSubtotalEur: negiere(z.lineSubtotalEur),
            lineVatEur: negiere(z.lineVatEur),
            lineTotalEur: negiere(z.lineTotalEur),
            appliedTaxTreatmentCode: z.appliedTaxTreatmentCode,
            appliedVatRate: z.appliedVatRate,
            acquisitionCostEurSnapshot: z.acquisitionCostEurSnapshot,
            marginEur: null,
            displayOrder: z.displayOrder,
          })),
        );

        // Auszahlung bar (V1). Karte-Gutschrift folgt, wenn das Terminal den
        // Auszahlungsweg kann — bis dahin ist bar die ehrliche Wahrheit der
        // Lade, und der Kassensturz sieht sie über die Schicht.
        await tx.insert(transactionPayments).values({
          transactionId: rueckgabe.id,
          paymentMethod: 'CASH',
          amountEur: negiere(total.toString()),
        });

        // 7. Das Stück liegt wieder im Laden: SOLD → AVAILABLE.
        //    (Der Verkauf setzte SOLD; die Rücknahme macht es wieder
        //    verkäuflich. Preis und Einkaufspreis bleiben unangetastet.)
        const ids = `{${productIds.join(',')}}`;
        await tx.execute(drizzleSql`
          UPDATE products
             SET status = 'AVAILABLE', sold_at = NULL,
                 reserved_by_session_id = NULL, reserved_by_user_id = NULL
           WHERE id = ANY(${ids}::uuid[]) AND status = 'SOLD'`);

        await tx.insert(auditLog).values({
          eventType: 'transaction.rueckgabe',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            rueckgabeId: rueckgabe.id,
            originalTransactionId,
            reason,
            productIds,
            totalEur: negiere(total.toString()),
          },
        });

        const ledgerRows = await tx
          .select({ id: ledgerEvents.id })
          .from(ledgerEvents)
          .where(
            drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${rueckgabe.id}`,
          )
          .orderBy(drizzleSql`${ledgerEvents.id} DESC`)
          .limit(1);
        if (ledgerRows[0]?.id == null) {
          throw new Error('AFTER INSERT trigger did not emit a ledger_event row for the Rueckgabe');
        }

        // Für die TSE-Signatur des Klienten: Brutto je Behandlung, negativ.
        const proBehandlung = new Map<string, number>();
        for (const z of zeilen) {
          const code = z.appliedTaxTreatmentCode ?? 'MIXED';
          const cent = (() => {
            const [e, c = '00'] = z.lineTotalEur.replace('-', '').split('.');
            return Number(BigInt(e!) * 100n + BigInt(c.padEnd(2, '0').slice(0, 2)));
          })();
          proBehandlung.set(code, (proBehandlung.get(code) ?? 0) - cent);
        }

        return {
          id: rueckgabe.id,
          receiptLocator: rueckgabe.receiptLocator,
          finalizedAt: rueckgabe.finalizedAt,
          totalEur: negiere(total.toString()),
          nachtragBezugstag,
          ustAufteilung: [...proBehandlung.entries()]
            .map(([taxTreatmentCode, bruttoCents]) => ({ taxTreatmentCode, bruttoCents }))
            .sort((a, b) => a.taxTreatmentCode.localeCompare(b.taxTreatmentCode)),
          zahlartTse: 'CASH' as const,
        };
      });

      return reply.status(200).send({
        id: result.id,
        receiptLocator: result.receiptLocator,
        finalizedAt: new Date(result.finalizedAt ?? new Date()).toISOString(),
        totalEur: result.totalEur,
        nachtragBezugstag: result.nachtragBezugstag,
        ustAufteilung: result.ustAufteilung,
        zahlartTse: result.zahlartTse,
      });
    },
  );
};

export default transactionsRueckgabeRoute;
