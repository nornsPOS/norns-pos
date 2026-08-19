/**
 * POST /api/transactions/storno — fiscal reversal (Day 15 §3).
 *
 * The most dangerous money-moving endpoint in the API. Reverses a prior
 * transaction by creating a new row with `storno_of_transaction_id` set and
 * NEGATED money columns. The DB triggers do the heavy lifting:
 *
 *   BEFORE INSERT on transactions:
 *     • transactions_validate_storno          — direction match, magnitudes
 *                                               negate exactly, customer match,
 *                                               original is not itself a storno.
 *     • transactions_validate_sanctions       — C-2 (still applies).
 *     • transactions_validate_closing_day     — C-3 (CANNOT storno into a
 *                                               FINALIZED business day).
 *     • transactions_sign_discipline          — storno row must be ≤ 0.
 *     • transactions_balance_equation         — subtotal+vat = total.
 *
 *   AT INSERT:
 *     • transactions_one_storno_per_original_uq (C-5) — UNIQUE partial index
 *       refuses a second storno on the same original.
 *
 *   AFTER INSERT on transactions:
 *     • on_transaction_finalized — UPDATEs customers.cumulative_*_eur with
 *       NEGATIVE total (auto-subtracts) + emits ledger event
 *       'transaction.stornoed' (extends hash chain + pg_notify).
 *
 * Inventory is NOT touched in V1 — products stay SOLD. A separate "return
 * to AVAILABLE" operation is Phase 2 territory (ADR-0016 amendment pending).
 *
 * Basel directive Day 15 §3 — MANDATORY:
 *   `requireStepUp` is invoked UNCONDITIONALLY, regardless of the transaction
 *   amount. No "small storno" loophole. Every fiscal reversal carries a
 *   fresh PIN signature. The route also persists the human-readable `reason`
 *   to `audit_log` inside the same DB transaction so the reversal carries
 *   non-repudiable context for incident review.
 *
 * ── 11.08.2026, Befund 12: der Storno kennt jetzt den NACHTRAG ─────────────
 *
 * WAS war der Befund: der Verkauf misst vor der Tagessperre, ob der
 * Geschaeftstag der Erfassungszeit bereits FINALIZED ist, und bucht dann als
 * Nachtrag in den laufenden Tag. Der Storno tat das nicht: er nahm die Sperre
 * auf die rohe Erfassungszeit und schrieb `finalized_at` stur auf genau diese
 * Zeit. Der Ausloeser `transactions_validate_closing_day` wies den Storno
 * eines versiegelten Tages deshalb mit `CLOSING_DAY_FINALIZED` ab, und ein im
 * Laden wirklich rueckgaengig gemachter Vorgang war nicht aufzeichenbar
 * (BFH, 29.07.2025, X R 23-24/21: nicht ausgewiesene Stornierungen begruenden
 * die Schaetzung).
 *
 * WARUM der naheliegende Weg falsch waere: in den versiegelten Tag schreiben
 * oder den Ausloeser lockern verletzt § 146 Abs. 4 AO, der Z-Bon ist fest.
 * Richtig ist der Weg des Verkaufs: der geschlossene Zeitraum bleibt
 * unberuehrt, gebucht wird im LAUFENDEN Tag, `erfasst_am` haelt die echte
 * Vorgangszeit, `nachtrag_bezugstag` traegt den Urtag, und der Inhaber wird
 * gemeldet. Die Entscheidung faellt VOR der Sperre, damit die Sperre den Tag
 * haelt, in den wirklich gebucht wird (siehe `tagessperre.ts`).
 *
 * WAS der Waechter misst:
 * `tests/integration/storno-nachtrag-in-den-laufenden-tag.test.ts` faehrt
 * Verkauf, Abschluss (FINALIZED) und Storno ueber HTTP gegen ein echtes
 * Postgres und verlangt: angenommen, im laufenden Tag gebucht, Nachtrag
 * ausgewiesen, Verweiskette intakt, Urbeleg byteweise unberuehrt.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  type LedgerEvent,
  type TransactionItem,
  type TransactionPayment,
  type Transaction as TransactionRow,
  auditLog,
  ledgerEvents,
  transactionItems,
  transactionPayments,
  transactions,
} from '@norns/db/schema';

import { emit } from '@norns/audit';

import { pruefeErfassungszeit } from '../lib/erfassungszeit.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { buchungszeitpunkt, nimmTagessperre } from '../lib/tagessperre.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { Money } from '@norns/domain';

import { StornoBody, StornoResponse, type StornoBody as TStornoBody } from '../schemas/storno.js';

// ────────────────────────────────────────────────────────────────────────
// Local error classes — surface to error-handler with stable codes.
// ────────────────────────────────────────────────────────────────────────

class TransactionNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class CannotStornoOfStornoError extends DomainError {
  public readonly httpStatus = 422;
  public readonly code: ApiErrorCode = 'STORNO_OF_STORNO';
}

class AlreadyStornoedError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/** Eine unbrauchbare Erfassungszeit ist ein Eingabefehler, kein Serverfehler. */
class ZeitAngabeFehlerhaftError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: unknown;
  public constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}

class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

/**
 * ⛔ EIN BARSTORNO OHNE SCHICHT LIEGT IN KEINEM KASSENSTURZ
 *
 * ── DER BEFUND VOM 11.08.2026 ────────────────────────────────────────────
 *
 * Der Verkaufsweg kennt diesen Riegel seit dem 08.08.2026
 * (`BargeldOhneSchichtError` in `transactions-finalize.ts`): Bargeld ohne
 * Schicht erscheint in keinem Sollbestand, und der Tagesabschluss schreibt
 * eine Differenz fest, die es nie gab.
 *
 * Der Storno hatte ihn nicht — der halbe Fix an derselben Ampel. Gemessen
 * am Prüfstand: Schicht gezählt und geschlossen, danach ein Barstorno über
 * 500,00 EUR, angenommen mit `shift_id = NULL`. Schicht A war beim Rechnen
 * schon zu, Schicht B öffnete später: der Betrag lag in KEINEM Kassensturz.
 * Das Geld verlässt die Lade trotzdem.
 *
 * Nur BAR, aus demselben Grund wie beim Verkauf: eine Kartenrückgabe läuft
 * über das Terminal und berührt die Lade nicht. Sie zu sperren wäre ein
 * Riegel ohne Schaden dahinter.
 *
 * Der Kassiererin bleibt der Weg, den sie ohnehin gehen muss: Schicht
 * öffnen, Geld zurückgeben, Schicht schliessen. Nichts geht verloren, und
 * die Rückgabe steht in genau einem Kassensturz.
 */
class StornoBargeldOhneSchichtError extends DomainError {
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

// ────────────────────────────────────────────────────────────────────────
// Helper — negate a NUMERIC(18,2) string preserving the wire format.
// Decimal.js would be heavier; this stays inside the regex we already
// enforce via TypeBox + the DB CHECK.
// ────────────────────────────────────────────────────────────────────────

function negateDecimalString(s: string): string {
  if (s.startsWith('-')) return s.slice(1);
  if (s === '0' || s === '0.00' || s === '0.0') return s;
  return `-${s}`;
}

/**
 * Einen Geldbetrag in ganze Cent, ohne Gleitkomma.
 *
 * `Money.toString()` liefert immer genau zwei Nachkommastellen, das Vorzeichen
 * steht vorne. Aus `-119.00` wird `-11900`. Ein `Number(x) * 100` hätte hier
 * gereicht, um bei 0,29 EUR eine 28 zu erzeugen.
 */
function eurZuCent(betrag: Money): number {
  const s = betrag.toString();
  const negativ = s.startsWith('-');
  const [ganz = '0', rest = '00'] = (negativ ? s.slice(1) : s).split('.');
  const cent = Number(ganz) * 100 + Number(rest);
  return negativ ? -cent : cent;
}

// ────────────────────────────────────────────────────────────────────────
// Plugin / route
// ────────────────────────────────────────────────────────────────────────

const transactionsStorno: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TStornoBody }>(
    '/api/transactions/storno',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Reverse a transaction — fiscal storno (mandatory step-up).',
        description:
          'Creates a negative-amount mirror of the original transaction, linked ' +
          'via `storno_of_transaction_id`. The DB triggers reverse cumulative ' +
          'spend and emit a ledger event. PIN step-up is MANDATORY (Basel ' +
          'directive Day 15 §3) — no fiscal reversal without a fresh PIN.',
        body: StornoBody,
        response: {
          200: StornoResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          422: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      // ──────────────────────────────────────────────────────────────────
      // 1. Auth gates — strictest configuration in the API.
      // ──────────────────────────────────────────────────────────────────
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      if (req.actor.role === 'CASHIER' && req.deviceId == null) {
        throw new DeviceRequiredError('CASHIER actions require a paired POS device cert.');
      }

      // BASEL DIRECTIVE: step-up is MANDATORY for storno regardless of amount.
      // Throws StepUpRequiredError → 403 STEP_UP_REQUIRED if PIN not fresh.
      requireStepUp(req);

      const { originalTransactionId, reason, erfasstAm: erfasstAmRoh } = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // ── 28.07.2026: die Zeit des GERÄTS, wie beim Verkauf ──────────────
      //
      // Dieselbe Prüfung, dieselben Grenzen wie beim Verkauf — aus
      // `lib/erfassungszeit.ts`, nicht kopiert. Seit dem 11.08.2026 steht sie
      // VOR der Datenbanktransaktion, weil aus der geprüften Zeit der
      // Buchungstag und damit der Schlüssel der Tagessperre abgeleitet wird.
      const zeitbefund = pruefeErfassungszeit(erfasstAmRoh, new Date());
      if (zeitbefund.fehler) {
        throw new ZeitAngabeFehlerhaftError(
          zeitbefund.fehler.nachricht,
          zeitbefund.fehler.einzelheiten,
        );
      }
      const erfasstAm = zeitbefund.erfasstAm;

      // ──────────────────────────────────────────────────────────────────
      // 2. One DB transaction wraps everything from here.
      //    If any step throws, ROLLBACK undoes the partial state.
      // ──────────────────────────────────────────────────────────────────
      const result = await app.db.transaction(async (tx) => {
        // ── 11.08.2026, Befund 12: der Buchungstag fällt VOR der Sperre ──
        //
        // Spiegelbildlich zum Verkauf (`transactions-finalize.ts`): ist der
        // Geschäftstag der Erfassungszeit bereits FINALIZED, wird NICHT in den
        // versiegelten Tag geschrieben (§ 146 Abs. 4 AO), sondern als
        // ausgewiesener Nachtrag in den LAUFENDEN. Vorher nahm der Storno die
        // Sperre stur auf die rohe Erfassungszeit und schrieb `finalized_at`
        // auf genau diese Zeit; der Auslöser wies ihn dann mit
        // `CLOSING_DAY_FINALIZED` ab, und der wirklich geschehene Storno war
        // nicht aufzeichenbar.
        let nachtragBezugstag: string | null = null;
        let erfassungstagAbgeschlossen = false;
        if (erfasstAm !== null) {
          const tagRows = await tx.execute<{ tag: string; abgeschlossen: boolean }>(drizzleSql`
            SELECT berlin_business_day(${erfasstAm.toISOString()}::timestamptz)::text AS tag,
                   EXISTS (
                     SELECT 1 FROM daily_closings dc
                      WHERE dc.business_day = berlin_business_day(${erfasstAm.toISOString()}::timestamptz)
                        AND dc.shop_id IS NULL
                        AND dc.state = 'FINALIZED'
                   ) AS abgeschlossen`);
          const tag = tagRows[0];
          if (tag?.abgeschlossen) {
            nachtragBezugstag = tag.tag;
            erfassungstagAbgeschlossen = true;
          }
        }
        const finalizedAtWert = buchungszeitpunkt(erfasstAm ?? null, erfassungstagAbgeschlossen);

        // Die Tagessperre auf den Tag, in den der Storno WIRKLICH fällt. Der
        // Abschluss nimmt die ausschliessliche Sperre auf denselben Schlüssel
        // und wartet damit auf uns, statt mitten im Rechnen an uns
        // vorbeizulaufen. Siehe `tagessperre.ts`: bis zum 08.08.2026 nahm sie
        // NUR der Verkauf.
        await nimmTagessperre(tx, finalizedAtWert);

        // 2a. Load the original transaction.
        const originalRows: TransactionRow[] = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.id, originalTransactionId))
          .limit(1);
        const original = originalRows[0];
        if (!original) {
          throw new TransactionNotFoundError(
            `Transaction ${originalTransactionId} does not exist.`,
          );
        }

        // 2b. Defensive check — DB trigger also refuses, but giving the caller
        //     a clear 422 code at the boundary beats a generic CHECK_VIOLATION.
        if (original.stornoOfTransactionId != null) {
          throw new CannotStornoOfStornoError(
            `Transaction ${originalTransactionId} is itself a storno and cannot be reversed.`,
          );
        }

        // 2c. Defensive check — UNIQUE partial index (C-5) also refuses, but
        //     clear 409 beats unique_violation.
        const existingRows: { id: string }[] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.stornoOfTransactionId, originalTransactionId))
          .limit(1);
        if (existingRows[0]) {
          throw new AlreadyStornoedError(
            `Transaction ${originalTransactionId} has already been stornoed (storno id: ${existingRows[0].id}).`,
          );
        }

        // 2d. Load the original's lines + payments — we mirror them with
        //     negated amounts. INSERT-only tables so the read is consistent.
        const originalItems: TransactionItem[] = await tx
          .select()
          .from(transactionItems)
          .where(eq(transactionItems.transactionId, originalTransactionId));
        const originalPayments: TransactionPayment[] = await tx
          .select()
          .from(transactionPayments)
          .where(eq(transactionPayments.transactionId, originalTransactionId));

        // 2e. INSERT the storno transaction. The BEFORE INSERT triggers
        //     (storno-validation, sanctions, closing-day) all fire here.
        //     The AFTER INSERT trigger fires customer-spend reversal + ledger emit.
        // ── 28.07.2026: die Zeit des GERÄTS, wie beim Verkauf ────────────
        //
        // Bis dahin kam `finalized_at` des Stornos aus `DEFAULT now()`, also
        // aus der Uhr des SERVERS — während der Verkauf seine Zeit vom Gerät
        // bekommt (0118). Ein nachgespielter Verkauf von gestern hätte damit
        // einen Storno von heute bekommen: der Erlös in einem Tagesabschluss,
        // seine Aufhebung in einem anderen.
        //
        // Seit dem 11.08.2026 wird die geprüfte Zeit über `buchungszeitpunkt`
        // gebucht: bei offenem Tag ist `finalizedAtWert` die Gerätezeit, bei
        // versiegeltem Tag fällt die Spalte auf `DEFAULT now()` (laufender
        // Tag), `erfasst_am` hält die echte Vorgangszeit fest, und
        // `nachtrag_bezugstag` weist den Urtag aus — dieselben drei Spalten
        // wie beim Verkauf, derselbe Auslöser prüft sie.
        /*
         * Die offene Schicht DIESES Geräts, im selben Vorgang gelesen. Der
         * Verkauf tut dasselbe (`transactions-finalize.ts`, Rückfallzweig).
         * Kein Klientenwert: der Storno bringt keine Schicht mit, und eine
         * fremde dürfte er ohnehin nicht wählen.
         */
        const stornoGeraet = deviceId ?? original.deviceId;
        const schichtZeilen = await tx.execute<{ id: string }>(drizzleSql`
          SELECT id::text AS id FROM shifts
           WHERE device_id = ${stornoGeraet}::uuid AND status = 'OPEN' LIMIT 1`);
        const schichtFuerDenStorno = schichtZeilen[0]?.id ?? null;

        /*
         * ⛔ Siehe `StornoBargeldOhneSchichtError` oben. Der Verkauf weist
         * Bargeld ohne Schicht seit dem 08.08.2026 ab; die Rückgabe desselben
         * Bargelds tat es bis heute nicht.
         */
        if (
          schichtFuerDenStorno === null &&
          originalPayments.some((p) => p.paymentMethod === 'CASH')
        ) {
          throw new StornoBargeldOhneSchichtError(
            'Für eine Barrückgabe muss eine Schicht geöffnet sein. Ohne Schicht erscheint dieses ' +
              'Geld in keinem Kassensturz, und der Tagesabschluss würde eine Differenz ' +
              'festschreiben, die es nie gab. Bitte zuerst eine Schicht öffnen.',
          );
        }

        const insertedRows: { id: string; receiptLocator: string; finalizedAt: Date }[] = await tx
          .insert(transactions)
          .values({
            direction: original.direction,
            // Fehlt die Gerätezeit (ältere Kasse), gilt weiter die Serverzeit.
            ...(finalizedAtWert ? { finalizedAt: finalizedAtWert } : {}),
            ...(erfasstAm ? { erfasstAm } : {}),
            ...(nachtragBezugstag ? { nachtragBezugstag } : {}),
            customerId: original.customerId,
            deviceId: deviceId ?? original.deviceId,
            /*
             * ── ⚠️ DIE SCHICHT GEHÖRT AN DIE ZEILE, NICHT IN EINE HEURISTIK ──
             *
             * DER BEFUND (Tiefenjagd 11.08.2026, drei von drei Stimmen): der
             * Storno legte seine Zeile OHNE `shiftId` an. Der Schichtabschluss
             * summiert Barverkäufe DER SCHICHT, der Storno fiel heraus, und
             * der Sollbestand war um die volle Stornohöhe zu hoch. Der Händler
             * zählte richtig und bekam einen Fehlbetrag, jeden Tag, unveränder-
             * bar festgeschrieben in `shifts.system_expected_eur` und
             * `daily_closings`.
             *
             * WARUM DER ERSTE FIX NICHT GENÜGTE: er lag auf der LESESEITE.
             * `shifts.ts` rechnete schichtlose Stornos über Gerät plus
             * Zeitfenster nach. Das hält für den Regelfall, ist aber ein
             * Stellvertreter statt der Sache: ein Storno zwischen zwei
             * Schichten fällt in keine von beiden, und ein aus der
             * Offline-Warteschlange nachgespielter bekommt die Schicht des
             * ABSPIELZEITPUNKTS statt der des Vorgangs.
             *
             * Deshalb steht die Schicht jetzt AN DER ZEILE, genau wie beim
             * Verkauf (`transactions-finalize.ts`, Zeile 819 ff.). Bleibt sie
             * null, weil keine Schicht offen ist, greift die Heuristik in
             * `shifts.ts` weiterhin als Rückfall für den Altbestand.
             */
            shiftId: schichtFuerDenStorno,
            /*
             * ── KEIN `ohneTseNr`, UND DAS IST ABSICHT (14.08.2026) ─────────
             *
             * Der Verkauf ohne TSE zieht vom Zehner-Vorrat (0142) und traegt
             * die laufende Nummer. Der Storno tut BEIDES nicht:
             *
             *   • Er darf nie am Vorrat scheitern. Eine im Laden wirklich
             *     rueckgaengig gemachte Zahlung MUSS aufzeichenbar sein
             *     (BFH, 29.07.2025, X R 23-24/21: nicht ausgewiesene
             *     Stornierungen begruenden die Schaetzung). Ein Riegel hier
             *     wuerde genau das erzwingen, was das Urteil bestraft.
             *   • Auffindbar ist er ohne eigene Nummer: sein Original traegt
             *     die Nummer, `storno_of_transaction_id` zeigt hin.
             *   • Im Pruefer-Auszug fehlt er trotzdem nicht: die DSFinV-K
             *     erkennt den Ausfall an der FEHLENDEN Signatur, nicht an
             *     dieser Spalte, und schreibt `TSE_TA_FEHLER`
             *     (dsfinvk-daten.ts, else-Zweig). Gemessen am Gegenbeleg
             *     RCP-2026-000002 der 0.6.0-Begehung.
             */
            cashierUserId: actorId,
            subtotalEur: negateDecimalString(original.subtotalEur),
            vatEur: negateDecimalString(original.vatEur),
            totalEur: negateDecimalString(original.totalEur),
            taxTreatmentCode: original.taxTreatmentCode,
            stornoOfTransactionId: originalTransactionId,
            notesInternal: original.notesInternal,
          })
          .returning({
            id: transactions.id,
            receiptLocator: transactions.receiptLocator,
            finalizedAt: transactions.finalizedAt,
          });
        const storno = insertedRows[0];
        if (!storno) {
          // Cannot happen — RETURNING always emits when INSERT succeeds.
          throw new Error('storno INSERT returned no row');
        }

        // 2f. Mirror lines with negated amounts.
        if (originalItems.length > 0) {
          await tx.insert(transactionItems).values(
            originalItems.map((line) => ({
              transactionId: storno.id,
              productId: line.productId,
              lineSubtotalEur: negateDecimalString(line.lineSubtotalEur),
              lineVatEur: negateDecimalString(line.lineVatEur),
              lineTotalEur: negateDecimalString(line.lineTotalEur),
              appliedTaxTreatmentCode: line.appliedTaxTreatmentCode,
              appliedVatRate: line.appliedVatRate,
              acquisitionCostEurSnapshot: line.acquisitionCostEurSnapshot,
              marginEur: line.marginEur != null ? negateDecimalString(line.marginEur) : null,
              displayOrder: line.displayOrder,
            })),
          );
        }

        // 2g. Mirror payment legs with negated amounts (refunds).
        if (originalPayments.length > 0) {
          await tx.insert(transactionPayments).values(
            originalPayments.map((p) => ({
              transactionId: storno.id,
              paymentMethod: p.paymentMethod,
              amountEur: negateDecimalString(p.amountEur),
              externalRef: p.externalRef,
              zvtTerminalId: p.zvtTerminalId,
              zvtReceiptNumber: p.zvtReceiptNumber,
              zvtCardBrand: p.zvtCardBrand,
              zvtCardPanMasked: p.zvtCardPanMasked,
              molliePaymentId: p.molliePaymentId,
            })),
          );
        }

        // 2h. Persist the human reason — audit_log INSIDE the same TX so the
        //     reason commits atomically with the storno (or rolls back together).
        await tx.insert(auditLog).values({
          eventType: 'transaction.stornoed_with_reason',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            stornoId: storno.id,
            originalTransactionId,
            reason,
            originalTotalEur: original.totalEur,
            stornoTotalEur: negateDecimalString(original.totalEur),
            direction: original.direction,
          },
        });

        // 2i. Read back the ledger event id emitted by the AFTER INSERT trigger.
        //     The trigger writes EXACTLY ONE row per transactions INSERT; we
        //     take the most recent for this storno's UUID.
        const ledgerRows: Pick<LedgerEvent, 'id'>[] = await tx
          .select({ id: ledgerEvents.id })
          .from(ledgerEvents)
          .where(
            drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${storno.id}`,
          )
          .orderBy(drizzleSql`${ledgerEvents.id} DESC`)
          .limit(1);
        const ledgerEventId = ledgerRows[0]?.id;
        if (ledgerEventId == null) {
          throw new Error('AFTER INSERT trigger did not emit a ledger_event row for the storno');
        }

        // ── Was die TSE zum Signieren braucht (08.08.2026) ───────────────
        //
        // Der Klient kennt nur die Kennung des Ursprungsbelegs und sendete
        // deshalb Betrag 0, eine leere Steueraufteilung und fest „Unbar".
        // Hier liegt alles bereits vor.
        const proBehandlung = new Map<string, number>();
        for (const line of originalItems) {
          const code = line.appliedTaxTreatmentCode ?? 'MIXED';
          // NEGATIV, wie der gespiegelte Beleg selbst. Über Money, nie über
          // Gleitkomma: ein Beleg ist kein Näherungswert.
          const brutto = Money.of(line.lineTotalEur).multiply('-1');
          proBehandlung.set(code, (proBehandlung.get(code) ?? 0) + eurZuCent(brutto));
        }

        // Bar bleibt bar. Wer bar gekauft hat, bekommt bar zurück, und die
        // Signatur muss das sagen. Nur `CASH` ist bar; alles andere, auch
        // Gutschein und Schuld, ist unbar im Sinne der KassenSichV.
        const warBar = originalPayments.some((p) => p.paymentMethod === 'CASH');

        return {
          id: storno.id,
          receiptLocator: storno.receiptLocator,
          finalizedAt: storno.finalizedAt,
          direction: original.direction,
          totalEur: negateDecimalString(original.totalEur),
          nachtragBezugstag,
          ledgerEventId: Number(ledgerEventId),
          ustAufteilung: [...proBehandlung.entries()]
            .map(([taxTreatmentCode, bruttoCents]) => ({ taxTreatmentCode, bruttoCents }))
            .sort((a, b) => a.taxTreatmentCode.localeCompare(b.taxTreatmentCode)),
          zahlartTse: warBar ? ('CASH' as const) : ('NON_CASH' as const),
        };
      });

      // ── 11.08.2026: der nachträgliche Storno wird dem Inhaber GEMELDET ──
      //
      // Derselbe Weg wie beim nachgetragenen Verkauf (`transactions-finalize.ts`):
      // NACH dem Festschreiben, damit ein Fehler hier NIE einen gültigen
      // Fiskalvorgang zurückrollt, und über die anhängende `emit`-Hilfe, damit
      // der Eintrag in der Hash-Kette steht.
      if (result.nachtragBezugstag != null) {
        try {
          await emit(app.db, {
            eventType: 'alert.nachtrag_eingang',
            entityTable: 'transactions',
            entityId: result.id,
            actorUserId: req.actor.id,
            deviceId,
            ipAddress: req.ip ?? null,
            payload: {
              grund:
                'Der Kassentag dieses Stornos war beim Eingang bereits abgeschlossen; ' +
                'die Umkehr wurde als Nachtrag im laufenden Tag gebucht.',
              nachtragBezugstag: result.nachtragBezugstag,
              erfasstAm: erfasstAm?.toISOString() ?? null,
              gebuchtAm: result.finalizedAt.toISOString(),
              receiptLocator: result.receiptLocator,
              stornoOfTransactionId: originalTransactionId,
              totalEur: result.totalEur,
              direction: result.direction,
            },
          });
        } catch (err) {
          // Die Meldung ist nachgelagert — sie darf einen gültigen
          // Fiskalvorgang nie kippen. Der Vorgang selbst trägt die Spalte.
          req.log.error({ err }, 'Nachtrag-Meldung fehlgeschlagen (nicht blockierend)');
        }
      }

      return reply.status(200).send({
        id: result.id,
        stornoOfTransactionId: originalTransactionId,
        receiptLocator: result.receiptLocator,
        finalizedAt: result.finalizedAt.toISOString(),
        direction: result.direction,
        totalEur: result.totalEur,
        ledgerEventId: result.ledgerEventId,
        ustAufteilung: result.ustAufteilung,
        zahlartTse: result.zahlartTse,
        /*
         * ⚠️ DIESE ZEILE IST DER UNTERSCHIED ZWISCHEN AUFGEZEICHNET UND
         * SICHTBAR. Der Nachtrag stand schon in `result`, aber Fastify
         * streift jedes Feld ab, das im Antwortschema fehlt: der Kassierer
         * saehe einen gewoehnlichen Storno und wuesste nicht, dass der Beleg
         * in den HEUTIGEN Abschluss faellt statt in den von gestern.
         */
        nachtragBezugstag: result.nachtragBezugstag ?? null,
      });
    },
  );
};

export default transactionsStorno;
