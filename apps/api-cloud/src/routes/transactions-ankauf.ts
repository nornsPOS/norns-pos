/**
 * POST /api/transactions/ankauf — Day-8 dedicated Ankauf write atom.
 *
 * One DB transaction wrapping:
 *   1. INSERT N rows into products (status='AVAILABLE' or 'DRAFT' per item.publishImmediately)
 *   2. INSERT 1 row into transactions (direction='ANKAUF', customerId, header_total)
 *   3. INSERT N rows into transaction_items (line_total = negotiatedPriceEur per line)
 *   4. INSERT 1 row into transaction_payments (CASH or BANK_TRANSFER outflow)
 *   5. INSERT 1 row into audit_log (ankauf.completed, redacted payload)
 *
 * Triggers that fire automatically:
 *   • transactions_validate_sanctions  (BEFORE INSERT) — refuses banned customers
 *   • transactions_validate_closing_day (BEFORE INSERT) — refuses past-FINALIZED days
 *   • transactions_ankauf_requires_customer (CHECK) — refuses null customer_id
 *   • verify_transaction_balance (DEFERRABLE INITIALLY DEFERRED) — at COMMIT
 *   • ledger_events AFTER INSERT — emits transaction.created (SSE bridge picks up)
 *
 * Step-up: REQUIRED when |totalEur| ≥ TRANSACTION_STEP_UP_THRESHOLD_EUR.
 * Same env var as Verkauf finalize; one knob for the whole platform.
 *
 * Auth: ADMIN + CASHIER (Verkauf gates the same way; Ankauf is symmetric).
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  auditLog,
  karatGrades,
  ledgerEvents,
  products,
  transactionItems,
  transactionPayments,
  transactions,
} from '@norns/db/schema';

// ────────────────────────────────────────────────────────────────────────
// §19.2 C-4 helper — narrow a Postgres unique-violation by constraint name.
// Mirrors transactions-finalize.ts. postgres-js raises `code = '23505'` with
// `constraint_name` set to the violated index; we match ONLY the partial
// UNIQUE for idempotency_key so any other unique violation still surfaces.
// ────────────────────────────────────────────────────────────────────────
function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  if (e.code !== '23505') return false;
  return e.constraint_name === constraint || e.constraint === constraint;
}

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';

import {
  istSicherungseinrichtungEingerichtet,
  satzOhneSicherungseinrichtung,
} from '../lib/kassenpflicht.js';
import { LIZENZ_FEHLT_SATZ, verkaufIstFreigegeben } from '../lib/lizenz-riegel.js';
import { nimmTagessperre } from '../lib/tagessperre.js';
import { type ApiErrorCode, DomainError, KycRequiredError } from '../plugins/error-handler.js';
import { AnkaufBody, AnkaufResponse, type AnkaufBody as TAnkaufBody } from '../schemas/ankauf.js';

// ────────────────────────────────────────────────────────────────────────
// Local error classes — mirror transactions-finalize.ts naming convention
// ────────────────────────────────────────────────────────────────────────

/**
 * Diese Kasse hat nie eine technische Sicherungseinrichtung gesehen.
 *
 * ⚠️ 02.08.2026: dieser Weg war UNGEPRÜFT. Der Verkauf hielt an, der Ankauf
 * nicht. Ein Ankauf ist nach § 146a AO derselbe aufzeichnungs- und
 * signaturpflichtige Geschäftsvorfall. Begründung und Abgrenzung stehen in
 * `lib/kassenpflicht.ts`.
 *
 * 409, nicht 403: kein Rechteproblem, sondern ein Zustand, den der Inhaber in
 * den Einstellungen auflöst und dann erneut versucht.
 */
class KeineTseEingerichtetError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class AnkaufValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: { field: string; reason: string };
  public constructor(field: string, reason: string) {
    super(`Validation failed for field "${field}": ${reason}`);
    this.details = { field, reason };
  }
}

class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

/**
 * ⛔ BARGELD OHNE SCHICHT ERSCHEINT IN KEINEM KASSENSTURZ — AUCH BEIM ANKAUF
 *
 * ── DER BEFUND VOM 12.08.2026 ────────────────────────────────────────────
 *
 * Am 08.08.2026 bekamen der VERKAUF (`BargeldOhneSchichtError`) und der
 * STORNO (`StornoBargeldOhneSchichtError`) diesen Riegel. Der ANKAUF blieb
 * aus — die Hausklasse „der halbe Fix an derselben Ampel", diesmal an der
 * teuersten Stelle: ein Ankauf ist Bargeld, das die Lade VERLÄSST, und bei
 * Edelmetall sind das schnell mehrere tausend Euro auf einmal.
 *
 * Der Rückfallweg setzte still `resolvedShiftId = null`, wenn am Gerät keine
 * Schicht offen war (Schicht schon geschlossen, oder der Kassierer hat sie
 * vergessen). Der Kommentar darüber benannte die Folge sogar selbst („so the
 * cash drawer reconciliation can SUBTRACT this cash payout") und liess sie
 * trotzdem zu — ein Kommentar ist kein Riegel.
 *
 * Der Kassensturz zählt Auszahlungen ausschliesslich über
 * `t.shift_id = <Schicht>` ODER `(shift_id IS NULL AND storno_of_… IS NOT
 * NULL)` (`shifts.ts`). Ein gewöhnlicher Ankauf ohne Schicht fällt durch
 * BEIDE Zweige, und ebenso durch die Fortschreibung in
 * `closings-finalize.ts`. Der erwartete Ladenbestand bleibt um die volle
 * Auszahlung zu hoch, der Blindsturz zeigt einen erfundenen FEHLBETRAG, und
 * `cash_drawer_variance_eur` schreibt diese nie geschehene Differenz
 * unveränderlich in `daily_closings` fest (§ 146 Abs. 4 AO).
 *
 * Nur BAR. Eine Überweisung verlässt die Lade nicht und verfälscht keinen
 * Kassensturz; sie zu sperren wäre ein Riegel ohne Schaden dahinter.
 */
class AnkaufBargeldOhneSchichtError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/** Siehe `lib/lizenz-riegel.ts`. Gilt fuer NEUE Vorgaenge, nie fuer Abschluss,
 *  Storno oder eine Ausfuhr. */
class LizenzFehltError extends DomainError {
  public readonly httpStatus = 402;
  public readonly code: ApiErrorCode = 'LIZENZ_FEHLT';
}

// ────────────────────────────────────────────────────────────────────────
// Math helper — Σ items.negotiatedPriceEur === totalEur, bigint-cents
// ────────────────────────────────────────────────────────────────────────

function toCents(eur: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(eur)) {
    throw new AnkaufValidationError('totalEur', `invalid decimal "${eur}"`);
  }
  const sign = eur.startsWith('-') ? -1n : 1n;
  const abs = eur.startsWith('-') ? eur.slice(1) : eur;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || '0'));
}

function fromCents(c: bigint): string {
  const sign = c < 0n ? '-' : '';
  const abs = c < 0n ? -c : c;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────
// Error response schema (mirrors error-handler envelope)
// ────────────────────────────────────────────────────────────────────────

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface TransactionsAnkaufOpts {
  env: Env;
}

// Die Betragsschwelle aus `TransactionsAnkaufOpts` wird hier nicht mehr
// gelesen: seit dem 05.08.2026 verlangt ein Ankauf keinen Gerätecode mehr, er
// ist über Storno umkehrbar. Der Typ bleibt stehen, weil `app.ts` ihn beim
// Anmelden übergibt.
const transactionsAnkaufRoute: FastifyPluginAsync<TransactionsAnkaufOpts> = async (app) => {
  app.post<{ Body: TAnkaufBody }>(
    '/api/transactions/ankauf',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Ankauf (purchase from customer) — atomic create-products + transaction.',
        description:
          'Day-8 dedicated route. Creates N product rows + 1 transaction (direction=ANKAUF) ' +
          '+ N transaction_items + 1 transaction_payment (CASH or BANK_TRANSFER outflow), all ' +
          'in one DB transaction. Customer required (DB CHECK). Sanctions hard-block applies. ' +
          'Step-up required when totalEur ≥ TRANSACTION_STEP_UP_THRESHOLD_EUR.',
        body: AnkaufBody,
        response: {
          200: AnkaufResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      // ⚠️ Der Lizenzriegel: NUR am neuen Vorgang, nie am Abschluss oder an
      // einer Ausfuhr. Begruendung in `lib/lizenz-riegel.ts`.
      if (!verkaufIstFreigegeben()) {
        throw new LizenzFehltError(LIZENZ_FEHLT_SATZ);
      }

      const body = req.body;
      const actorId = req.actor.id;

      // transactions.device_id is NOT NULL — every Ankauf is anchored to a
      // specific POS terminal (the seller stood at THAT counter on THAT
      // device). Mirrors Verkauf finalize discipline.
      const deviceId = req.deviceId;
      if (!deviceId) {
        throw new DeviceRequiredError(
          'Ankauf requires a paired POS device cert — register the terminal first.',
        );
      }

      // ── IST DAS ÜBERHAUPT EINE KASSE NACH § 146a AO? ──────────────────
      //
      // ⚠️ Bis zum 02.08.2026 stand diese Prüfung NUR im Verkaufsweg. Der
      // Händler las an der Verkaufsmaske, seine Kasse erfülle § 146a AO
      // nicht, und kaufte eine Minute später für 5.000 Euro Gold an, ohne
      // dass etwas rot wurde. Begründung und Abgrenzung: `lib/kassenpflicht.ts`.
      // ⚠️ 15.08.2026: die Gnadenfrist von zehn Belegen ist ersatzlos
      // gestrichen (Basels Anweisung nach der Rechtspruefung). Ohne
      // eingerichtete Sicherungseinrichtung gibt es KEINEN Ankauf, ab dem
      // ersten. Die volle Begruendung steht am Verkaufsweg
      // (`transactions-finalize.ts`), damit sie EINMAL im Baum steht.
      if (!(await istSicherungseinrichtungEingerichtet(app.db))) {
        throw new KeineTseEingerichtetError(satzOhneSicherungseinrichtung('Ankauf'));
      }

      // ── Math integrity (client declares total; we re-verify exact sum) ──
      const declaredTotalCents = toCents(body.totalEur);
      let computedSumCents = 0n;
      for (const item of body.items) {
        const c = toCents(item.negotiatedPriceEur);
        if (c <= 0n) {
          throw new AnkaufValidationError(
            'items[].negotiatedPriceEur',
            `expected positive cents, got ${item.negotiatedPriceEur}`,
          );
        }
        computedSumCents += c;
      }
      if (declaredTotalCents !== computedSumCents) {
        throw new AnkaufValidationError(
          'totalEur',
          `header total ${body.totalEur} ≠ Σ items.negotiatedPriceEur ${fromCents(computedSumCents)}`,
        );
      }
      if (declaredTotalCents <= 0n) {
        throw new AnkaufValidationError('totalEur', `Ankauf total must be > 0`);
      }

      // ── payout consistency: BANK_TRANSFER must carry an externalRef; CASH must not ──
      if (body.payoutMethod === 'BANK_TRANSFER' && !body.payoutExternalRef) {
        throw new AnkaufValidationError(
          'payoutExternalRef',
          'BANK_TRANSFER requires an external reference',
        );
      }
      if (body.payoutMethod === 'CASH' && body.payoutExternalRef !== undefined) {
        throw new AnkaufValidationError(
          'payoutExternalRef',
          'CASH payout must not carry an external reference',
        );
      }

      /*
       * ── KARAT: PUNZE ODER STUFE, ABER NUR AUS DER REFERENZ (14.08.2026) ──
       *
       * Der Händler liest die PUNZE auf dem Stück (585); die Referenz
       * `karat_grades` schlüsselt nach der STUFE (14K) und führt beide
       * Sprachen nebeneinander. Bis heute wanderte der rohe Text ungeprüft in
       * den Fremdschlüssel: die Eingabe „585" starb erst an
       * `products_karat_code_fkey`, der Fehler reiste als 409 CONFLICT mit
       * rohem Postgres-Wortlaut bis in den Händler-Toast, und das NACH dem
       * KYC-Stempel, mit gezücktem Bargeld (0.6.0-Begehung, ANK-0001).
       *
       * Das Nachschlagen hier ist keine Erfindung, sondern ein Blick in die
       * Tabelle, in der beide Spalten stehen. Alles Unbekannte wird VOR der
       * Buchung mit einem deutschen Satz und der gültigen Liste abgewiesen;
       * der Fremdschlüssel bleibt als letzter Riegel darunter.
       */
      const karatEintraege = body.items.filter(
        (i) => typeof i.karatCode === 'string' && i.karatCode.trim() !== '',
      );
      if (karatEintraege.length > 0) {
        const stufen = await app.db.select().from(karatGrades);
        const nachStufe = new Map(stufen.map((s) => [s.code.toUpperCase(), s.code]));
        const nachPunze = new Map(stufen.map((s) => [s.hallmarkStamp, s.code]));
        for (const item of karatEintraege) {
          const roh = (item.karatCode as string).trim().toUpperCase();
          const code = nachStufe.get(roh) ?? nachPunze.get(roh.replace(/[^0-9]/g, ''));
          if (!code) {
            const punzen = stufen.map((s) => s.hallmarkStamp).sort().join(', ');
            const codes = stufen.map((s) => s.code).sort().join(', ');
            throw new AnkaufValidationError(
              'items[].karatCode',
              `Der Karat-Wert "${item.karatCode}" ist nicht bekannt. ` +
                `Gültig sind die Punzen ${punzen} oder die Stufen ${codes}.`,
            );
          }
          item.karatCode = code;
        }
      }

      // ── GwG KYC gate (friendly pre-check; the BEFORE INSERT trigger
      //    transactions_validate_kyc is the authoritative, un-bypassable gate).
      //    ANKAUF: the seller MUST be ID-verified for EVERY buy from €0,01
      //    (hard §259 StGB Hehlerei rule — no threshold). ──
      const sellerKyc = await app.db.execute<{ kyc_verified_at: Date | null }>(drizzleSql`
        SELECT kyc_verified_at FROM customers WHERE id = ${body.customerId}::uuid LIMIT 1`);
      if (!sellerKyc[0] || sellerKyc[0].kyc_verified_at === null) {
        throw new KycRequiredError(
          'Identifizierung erforderlich (§ 259 StGB): Jeder Ankauf verlangt eine geprüfte Ausweis-Identifikation des Verkäufers. Bitte KYC bestätigen.',
        );
      }

      // ──────────────────────────────────────────────────────────────────
      // §19.2 C-4 idempotency dedup (mirrors transactions-finalize.ts).
      //
      // A double-click on "Auszahlen & Beleg", a step-up cancel-then-resume,
      // or a lost-response retry would otherwise book a SECOND payout for the
      // same goods. The client sends a stable UUID; we persist it on
      // `transactions.idempotency_key` and the partial UNIQUE INDEX
      // (transactions_idempotency_key_uniq, migration 0028) guarantees
      // at-most-once. Cheap pre-check OUTSIDE the transaction returns the
      // original Ankauf when the key is already known; on a true race one
      // INSERT wins and the loser catches the 23505 below.
      // ──────────────────────────────────────────────────────────────────
      if (body.idempotencyKey) {
        const existing = await loadAnkaufByKey(app, body.idempotencyKey);
        if (existing) return reply.status(200).send(existing);
      }

      // ─────────────────────────────────────────────────────────────────────
      // ONE DB transaction — the all-or-nothing contract
      // ─────────────────────────────────────────────────────────────────────
      const runInsert = (): Promise<{
        transactionId: string;
        receiptLocator: string;
        finalizedAt: Date;
        ledgerEventId: number;
        createdProducts: Array<{
          id: string;
          sku: string;
          status: 'DRAFT' | 'AVAILABLE';
          clientReferenceId: string | null;
        }>;
      }> =>
        app.db.transaction(async (tx) => {
          // Die Tagessperre auf den Geschäftstag dieses Vorgangs. Der Abschluss
          // nimmt die ausschliessliche Sperre auf denselben Schlüssel und wartet
          // damit auf uns, statt mitten im Rechnen an uns vorbeizulaufen.
          // Siehe `tagessperre.ts`: bis zum 08.08.2026 nahm sie NUR der Verkauf.
          await nimmTagessperre(tx);

          // 1. Insert all products. Each returns its uuid which we link to
          //    the transaction_items rows below.
          const createdProducts: Array<{
            id: string;
            sku: string;
            status: 'DRAFT' | 'AVAILABLE';
            clientReferenceId: string | null;
          }> = [];

          // ── 19.08.2026: EIN INSERT statt einer je Stück ────────────────
          //
          // Gemessen: hier lief je Stück eine eigene Rundreise, unter
          // gehaltener Tagessperre — bei einem Konvolut von 15 Stücken
          // wartete der Kunde 15 Rundreisen auf seine Barauszahlung, und der
          // Tagesabschluss wartete mit. Die Geschwister-Einfügung in
          // `transactionItems` weiter unten stapelte längst richtig.
          //
          // ⚠️ Zugeordnet wird über die ARTIKELNUMMER, nicht über die
          // Reihenfolge: Postgres sichert die Reihenfolge von RETURNING
          // nirgends zu, und an dieser Zuordnung hängt, welches Stück auf
          // welcher Belegzeile steht. Die Artikelnummer ist im Beleg
          // eindeutig (products_sku_uq), also ist der Schlüssel verlustfrei.
          const eingefuegt = await tx
            .insert(products)
            .values(
              body.items.map((item) => ({
                sku: item.sku,
                barcode: item.barcode ?? null,
                itemType: item.itemType,
                metal: item.metal ?? null,
                karatCode: item.karatCode ?? null,
                finenessDecimal: item.finenessDecimal ?? null,
                weightGrams: item.weightGrams ?? null,
                hallmarkStamps: item.hallmarkStamps,
                seriennummer: item.seriennummer ?? null,
                gravur: item.gravur ?? null,
                // Acquisition cost is INTAKE-LOCKED at the value negotiated here.
                acquisitionCostEur: item.negotiatedPriceEur,
                listPriceEur: item.listPriceEur,
                taxTreatmentCode: item.taxTreatmentCode,
                condition: item.condition,
                isCommission: false,
                acquiredFromCustomerId: body.customerId,
                name: item.name,
                descriptionDe: item.descriptionDe ?? null,
                marketingAttributes: [] as string[],
                listedOnStorefront: false,
                listedOnEbay: false,
                status: (item.publishImmediately ? 'AVAILABLE' : 'DRAFT') as 'AVAILABLE' | 'DRAFT',
                ...(item.publishImmediately ? { publishedAt: new Date() } : {}),
              })),
            )
            .returning({
              id: products.id,
              sku: products.sku,
              status: products.status,
            });
          if (eingefuegt.length !== body.items.length) {
            throw new Error(
              `Ankauf: ${body.items.length} Stücke eingereicht, ${eingefuegt.length} eingefügt`,
            );
          }
          const jeSku = new Map(eingefuegt.map((r) => [r.sku, r]));
          for (const item of body.items) {
            const row = jeSku.get(item.sku);
            if (!row) throw new Error(`Ankauf: Stück ${item.sku} fehlt im INSERT-Ergebnis`);
            createdProducts.push({
              id: row.id,
              sku: row.sku,
              status: row.status as 'DRAFT' | 'AVAILABLE',
              clientReferenceId: item.clientReferenceId ?? null,
            });
          }

          // Attribute the buy to the device's OPEN shift so the cash drawer
          // reconciliation can SUBTRACT this cash payout (an Ankauf is cash OUT).
          const shiftRows = await tx.execute<{ id: string }>(drizzleSql`
          SELECT id::text AS id FROM shifts
           WHERE device_id = ${deviceId}::uuid AND status = 'OPEN' LIMIT 1`);
          const resolvedShiftId = shiftRows[0]?.id ?? null;

          /**
           * ⛔ 12.08.2026 — HIER ENDETE DIE ROUTE VORHER MIT EINER STILLEN NULL.
           *
           * Siehe `AnkaufBargeldOhneSchichtError` oben für den ganzen Befund.
           * Kurz: ohne Schicht zählt der Kassensturz dieses ausgezahlte Bargeld
           * nicht, und die erfundene Differenz wird im Tagesabschluss
           * festgeschrieben. Verkauf und Storno haben den Riegel seit dem
           * 08.08.2026; der Ankauf hatte ihn bis heute nicht.
           */
          if (resolvedShiftId === null && body.payoutMethod === 'CASH') {
            throw new AnkaufBargeldOhneSchichtError(
              'Für eine Barauszahlung muss eine Schicht geöffnet sein. Ohne Schicht erscheint ' +
                'dieses Geld in keinem Kassensturz, und der Tagesabschluss würde eine Differenz ' +
                'festschreiben, die es nie gab. Bitte zuerst eine Schicht öffnen.',
            );
          }

          // 2. Insert the transaction header. AFTER trigger emits ledger event.
          //    Sanctions BEFORE trigger fires here — banned customers throw.
          //    Closing-day BEFORE trigger fires here — FINALIZED days throw.
          const [txRow] = await tx
            .insert(transactions)
            .values({
              direction: 'ANKAUF',
              customerId: body.customerId,
              deviceId,
              shiftId: resolvedShiftId,
              cashierUserId: actorId,
              // Ankauf math: subtotal = total, vat = 0. The §25a margin only
              // materialises on the FUTURE sale of these items.
              subtotalEur: body.totalEur,
              vatEur: '0.00',
              totalEur: body.totalEur,
              // The transaction's classification — for Ankauf this is the
              // intent ("we're buying second-hand goods under §25a"). The
              // PRODUCTS each carry their own treatment for the future sale.
              taxTreatmentCode: 'MARGIN_25A',
              // §19.2 C-4 — persist the client's idempotency key. The partial
              // UNIQUE INDEX (migration 0028) raises 23505 on a concurrent
              // duplicate; we catch it below and fall back to a SELECT-by-key.
              ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
              ...(body.notesInternal ? { notesInternal: body.notesInternal } : {}),
            })
            .returning({
              id: transactions.id,
              receiptLocator: transactions.receiptLocator,
              finalizedAt: transactions.finalizedAt,
            });
          if (!txRow) throw new Error('Ankauf: transaction INSERT returned no row');

          // 3. Insert transaction_items — one per product. Line totals are the
          //    negotiated cash prices. For Ankauf, line_subtotal = line_total
          //    and line_vat = 0 (§25a math only on resale).
          await tx.insert(transactionItems).values(
            body.items.map((item, idx) => {
              const product = createdProducts[idx];
              if (!product) throw new Error('Ankauf: product/item index mismatch');
              return {
                transactionId: txRow.id,
                productId: product.id,
                lineSubtotalEur: item.negotiatedPriceEur,
                lineVatEur: '0.00',
                lineTotalEur: item.negotiatedPriceEur,
                appliedTaxTreatmentCode: item.taxTreatmentCode,
                appliedVatRate: null,
                // §25a margin context belongs to the FUTURE SALE line, not to
                // this buy-in line. A buy-in realizes no margin and is not itself
                // a §25a sale, so BOTH the acquisition snapshot and the margin
                // stay NULL here. (The acquisition cost is persisted on the
                // PRODUCT above as `acquisitionCostEur` — intake-locked — so
                // nothing is lost.) Leaving the snapshot set while margin is NULL
                // violates the CHECK `transaction_items_margin_implies_acquisition`
                // ((margin_eur IS NULL) = (acquisition_cost_eur_snapshot IS NULL),
                // migration 0009), which previously made every Ankauf payout fail
                // with a 409 and committed zero buy-ins.
                acquisitionCostEurSnapshot: null,
                marginEur: null,
                displayOrder: idx,
              };
            }),
          );

          // 4. Insert the single payment leg — cash leaves the drawer (or a
          //    bank-transfer outflow is recorded). Either way, amount = total.
          await tx.insert(transactionPayments).values({
            transactionId: txRow.id,
            paymentMethod: body.payoutMethod,
            amountEur: body.totalEur,
            externalRef: body.payoutExternalRef ?? null,
          });

          // 5. Audit log — redacted payload, never plaintext PII.
          await tx.insert(auditLog).values({
            eventType: 'ankauf.completed',
            actorUserId: actorId,
            deviceId,
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent'] ?? null,
            payload: {
              transactionId: txRow.id,
              customerId: body.customerId,
              totalEur: body.totalEur,
              payoutMethod: body.payoutMethod,
              itemCount: createdProducts.length,
              productIds: createdProducts.map((p) => p.id),
              publishedCount: createdProducts.filter((p) => p.status === 'AVAILABLE').length,
              draftCount: createdProducts.filter((p) => p.status === 'DRAFT').length,
            },
          });

          // 6. Read the ledger event the trigger just emitted, so we can return
          //    its id (SSE consumers anchor against this).
          const ledgerRow = (
            await tx
              .select({ id: ledgerEvents.id })
              .from(ledgerEvents)
              .where(
                drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${txRow.id}`,
              )
              .limit(1)
          )[0];

          return {
            transactionId: txRow.id,
            receiptLocator: txRow.receiptLocator,
            finalizedAt: txRow.finalizedAt,
            ledgerEventId: ledgerRow ? Number(ledgerRow.id) : 0,
            createdProducts,
          };
        });

      // §19.2 C-4 race fallback: two concurrent retries with the same key.
      // One INSERT wins, the other gets 23505 — we swap the error for the
      // winning Ankauf so the loser still sees the original payout, not a 500.
      let outcome: Awaited<ReturnType<typeof runInsert>>;
      try {
        outcome = await runInsert();
      } catch (err) {
        if (body.idempotencyKey && isUniqueViolation(err, 'transactions_idempotency_key_uniq')) {
          const winner = await loadAnkaufByKey(app, body.idempotencyKey);
          if (winner) return reply.status(200).send(winner);
        }
        throw err;
      }

      return reply.status(200).send({
        transactionId: outcome.transactionId,
        receiptLocator: outcome.receiptLocator,
        finalizedAt: outcome.finalizedAt.toISOString(),
        ledgerEventId: outcome.ledgerEventId,
        totalEur: body.totalEur,
        payoutMethod: body.payoutMethod,
        createdProducts: outcome.createdProducts,
      });
    },
  );
};

/**
 * §19.2 C-4 dedup read — reconstruct the original AnkaufResponse from an
 * already-committed transaction identified by its idempotency key. Returns
 * `null` when no row carries the key. Used by BOTH the cheap pre-check and the
 * 23505 race fallback so a duplicate POST replays the EXACT original payout.
 *
 * `createdProducts` is rebuilt from `transaction_items ⋈ products` (the route's
 * original insert order is preserved via `transaction_items.display_order`).
 * `clientReferenceId` is not persisted server-side, so it returns `null` on the
 * replay — harmless, the UI only uses it to match a fresh response back.
 */
async function loadAnkaufByKey(
  app: Parameters<typeof transactionsAnkaufRoute>[0],
  idempotencyKey: string,
): Promise<{
  transactionId: string;
  receiptLocator: string;
  finalizedAt: string;
  ledgerEventId: number;
  totalEur: string;
  payoutMethod: 'CASH' | 'BANK_TRANSFER';
  createdProducts: Array<{
    id: string;
    sku: string;
    status: 'DRAFT' | 'AVAILABLE';
    clientReferenceId: string | null;
  }>;
} | null> {
  const txRow = (
    await app.db
      .select({
        id: transactions.id,
        receiptLocator: transactions.receiptLocator,
        finalizedAt: transactions.finalizedAt,
        totalEur: transactions.totalEur,
      })
      .from(transactions)
      .where(drizzleSql`${transactions.idempotencyKey} = ${idempotencyKey}::uuid`)
      .limit(1)
  )[0];
  if (!txRow) return null;

  const ledgerRow = (
    await app.db
      .select({ id: ledgerEvents.id })
      .from(ledgerEvents)
      .where(
        drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${txRow.id}`,
      )
      .limit(1)
  )[0];

  const payRow = (
    await app.db
      .select({ paymentMethod: transactionPayments.paymentMethod })
      .from(transactionPayments)
      .where(drizzleSql`${transactionPayments.transactionId} = ${txRow.id}::uuid`)
      .limit(1)
  )[0];

  const productRows = (await app.db.execute(drizzleSql`
    SELECT p.id AS id, p.sku AS sku, p.status AS status
      FROM transaction_items ti
      JOIN products p ON p.id = ti.product_id
     WHERE ti.transaction_id = ${txRow.id}::uuid
     ORDER BY ti.display_order ASC
  `)) as unknown as Array<{ id: string; sku: string; status: 'DRAFT' | 'AVAILABLE' }>;

  return {
    transactionId: txRow.id,
    receiptLocator: txRow.receiptLocator,
    finalizedAt: txRow.finalizedAt.toISOString(),
    ledgerEventId: ledgerRow ? Number(ledgerRow.id) : 0,
    totalEur: txRow.totalEur,
    payoutMethod: (payRow?.paymentMethod ?? 'CASH') as 'CASH' | 'BANK_TRANSFER',
    createdProducts: productRows.map((p) => ({
      id: p.id,
      sku: p.sku,
      status: p.status,
      clientReferenceId: null,
    })),
  };
}

export default transactionsAnkaufRoute;
