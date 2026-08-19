/**
 * Shifts routes — Kassensturz / Blindsturz (Day 21).
 *
 *   POST /api/shifts/open                — opens a shift for the cashier's device
 *   POST /api/shifts/:id/cash-movements  — bank drop / safe transit / injection
 *   POST /api/shifts/:id/close           — Blindsturz: blind_count first, then variance revealed
 *   GET  /api/shifts/current             — fetch the cashier's current open shift (if any)
 *
 * Close requires CASHIER or ADMIN. The Blindsturz pattern: the
 * cashier-typed `blind_count_eur` is persisted FIRST, then the route computes
 * `system_expected_eur` from cash movements + cash sales and stores it.
 * The generated `variance_eur` column reveals the discrepancy AFTER the fact.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  11.08.2026 — VIER BEFUNDE AN DIESER EINEN RECHNUNG
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── 1. Der Barstorno mindert die Lade nicht ────────────────────────────────
 *
 * WAS war der Befund: `transactions-storno.ts` legt die Stornozeile OHNE
 * `shift_id` an. Die Rechnung unten summierte Barzahlungen ueber
 * `t.shift_id = <Schicht>`, der Storno fiel heraus, und der Sollbestand war um
 * die volle Stornohoehe zu hoch. Gemessen: Verkauf 500,00 bar, Storno 500,00
 * bar zurueck, Sollbestand 700,00 statt 200,00 — jeden Tag, an dem jemand bar
 * erstattet, und die falsche Zahl wandert unveraenderbar in
 * `shifts.system_expected_eur` und in `daily_closings`.
 *
 * WARUM der naheliegende Weg falsch ist: den Storno ueber seinen URBELEG
 * zuzuordnen (`storno_of_transaction_id` zeigt auf einen Beleg dieser Schicht)
 * trifft nur den Fall, in dem beide in derselben Schicht liegen. Passiert der
 * Storno spaeter, verlaesst das Geld die Lade, die JETZT offen ist, nicht die
 * von gestern. Zugeordnet wird deshalb ueber das GERAET und den Zeitpunkt der
 * AUFZEICHNUNG (`created_at`): das ist der Augenblick, in dem das Geld wirklich
 * ueber den Tresen geht.
 *
 * ⚠️ Was damit NICHT behoben ist: ein Storno, dessen Aufzeichnung in KEINE
 * offene Schicht dieses Geraets faellt, bleibt unzugeordnet. Die saubere
 * Loesung ist, dass `transactions-storno.ts` die Schicht mitschreibt; dann
 * greift schon der erste Zweig unten. Beide Wege stehen nebeneinander.
 *
 * ── 2. Der negative Sollbestand endete in 500 ──────────────────────────────
 *
 * Die Rechnung ist vorzeichenrichtig (`fromCents`), die ANTWORTFORM stand aber
 * auf `DecimalString`, dessen Muster `^\d{1,16}…` das Minus verbietet. Weil
 * `Type.Union([…, Type.Null()])` zu `anyOf` wird, prueft fast-json-stringify
 * das Muster dort WIRKLICH — die Antwort starb, nachdem die Schicht schon
 * CLOSED war, und der zweite Druck gab 409. `SignedDecimalString` gab es
 * bereits, sie war hier nur nicht angeschlossen.
 *
 * ── 3. Drei gleichzeitige Kassenstuerze, drei 200er-Antworten ──────────────
 *
 * Der SELECT nahm kein `FOR UPDATE`, der UPDATE filterte nur auf `id`. Zwei
 * von drei Zaehlern bekamen IHRE Blindzaehlung bestaetigt, gespeichert wurde
 * eine andere, und keine Zeile im Hauptbuch haelt die verworfene fest
 * (§ 146 Abs. 4 AO).
 *
 * ── 4. Die zweite Kasse buchte auf die Schicht der ersten ──────────────────
 *
 * Weder `cash-movements` noch `close` prueften das Geraet. Die Verkaufsroute
 * kennt diesen Schutz seit langem (`FremdeSchichtError`, 0118) — der
 * Schichtweg hatte ihn nicht: der halbe Fix an derselben Ampel.
 *
 * WAS DER WAECHTER MISST: `tests/integration/lade-und-schicht.test.ts` faehrt
 * alle vier Faelle ueber die echten HTTP-Wege gegen ein echtes Postgres.
 */

import { Type } from '@sinclair/typebox';
import { and, sql as drizzleSql, eq, isNotNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { cashMovements, shifts } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { fromCents, toCents } from '../lib/money-cents.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { DecimalString, SignedDecimalString } from '../schemas/money.js';

class ShiftNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class ShiftConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}
class ClosingDayFinalizedError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CLOSING_DAY_FINALIZED';
}
/**
 * ⛔ EINE SCHICHT GEHOERT DER KASSE, AN DER GEZAEHLT WIRD.
 *
 * Gemessen am 11.08.2026: Kassierer B bucht mit SEINER Sitzung und SEINEM
 * Fingerabdruck eine Abschoepfung ueber 500,00 EUR auf die Schicht von Geraet
 * A — angenommen, 200. Und er schliesst die Schicht von Geraet A mit der
 * Zaehlung SEINER Lade; die Abweichung von 350,00 EUR steht danach fest.
 * Beide Ladenbestaende sind falsch, und zwar still.
 *
 * 403 und nicht 409: es ist eine Rechtefrage, keine Formfrage. Derselbe Code
 * wie in `transactions-finalize.ts`, damit die Flaeche einen Satz dafuer hat.
 */
class FremdeSchichtError extends DomainError {
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

const ShiftView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  deviceId: Type.String({ format: 'uuid' }),
  openedByUserId: Type.String({ format: 'uuid' }),
  openedAt: Type.String({ format: 'date-time' }),
  openingFloatEur: DecimalString,
  status: Type.Union([Type.Literal('OPEN'), Type.Literal('CLOSED')]),
  blindCountEur: Type.Union([DecimalString, Type.Null()]),
  /**
   * ⚠️ SIGNIERT, und das ist keine Kosmetik.
   *
   * An einem ankaufstarken Tag kann der Sollbestand negativ werden;
   * `shifts.ts` rechnet ihn ausdruecklich vorzeichenrichtig. Stand hier
   * `DecimalString`, dessen Muster `^\d{1,16}…` kein Minus zulaesst, dann
   * starb die Antwort in fast-json-stringify — NACHDEM die Schicht bereits
   * CLOSED war. Die Kassiererin las „Internal server error" statt ihrer
   * Abweichung, und der zweite Druck gab 409.
   */
  systemExpectedEur: Type.Union([SignedDecimalString, Type.Null()]),
  varianceEur: Type.Union([Type.String(), Type.Null()]),
  closedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

const shiftsRoutes: FastifyPluginAsync = async (app) => {
  // A FINALIZED closing seals the business day. The DB trigger guards
  // `transactions` only — shifts and cash movements were audited as open
  // write paths (30.07.2026, confirmed by adversarial verification, incl.
  // the measured scenario: finalize 23:55, bank drop / blind count 23:58 on
  // a legally still-open multi-day shift; the movement and the Kassensturz
  // would appear in NO Z-Bon, ever).
  const assertDayNotSealed = async (was: string) => {
    const sealed = (await app.db.execute(drizzleSql`
      SELECT 1 FROM daily_closings
       WHERE business_day = berlin_business_day(now())
         AND state = 'FINALIZED'
       LIMIT 1
    `)) as unknown as unknown[];
    if (sealed.length > 0) {
      throw new ClosingDayFinalizedError(
        `The business day is already finalized; ${was} belongs to the next business day.`,
      );
    }
  };
  // ════════════════════════════════════════════════════════════════════
  // POST /api/shifts/open
  // ════════════════════════════════════════════════════════════════════

  app.post<{ Body: { openingFloatEur: string; notes?: string } }>(
    '/api/shifts/open',
    {
      schema: {
        tags: ['shifts'],
        summary: "Open a shift for the cashier's mTLS-paired device.",
        body: Type.Object({
          openingFloatEur: DecimalString,
          notes: Type.Optional(Type.String({ maxLength: 1024 })),
        }),
        response: { 200: ShiftView, 401: ErrorResponse, 403: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      if (req.actor.role === 'CASHIER' && !req.deviceId) {
        throw new DeviceRequiredError('Opening a shift requires a paired POS device cert.');
      }
      const deviceId = req.deviceId;
      if (!deviceId) {
        throw new DeviceRequiredError('Opening a shift requires a paired POS device.');
      }
      await assertDayNotSealed('a new shift');
      try {
        const [s] = await app.db
          .insert(shifts)
          .values({
            deviceId,
            openedByUserId: req.actor.id,
            openingFloatEur: req.body.openingFloatEur,
            notes: req.body.notes ?? null,
          })
          .returning();
        if (!s) throw new Error('shift insert returned no row');
        return reply.status(200).send({
          id: s.id,
          deviceId: s.deviceId,
          openedByUserId: s.openedByUserId,
          openedAt: s.openedAt.toISOString(),
          openingFloatEur: s.openingFloatEur,
          status: s.status,
          blindCountEur: s.blindCountEur,
          systemExpectedEur: s.systemExpectedEur,
          varianceEur: s.varianceEur,
          closedAt: s.closedAt ? s.closedAt.toISOString() : null,
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('shifts_one_open_per_device_uq')) {
          throw new ShiftConflictError('A shift is already OPEN on this device.');
        }
        throw err;
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // GET /api/shifts/current
  // ════════════════════════════════════════════════════════════════════

  app.get(
    '/api/shifts/current',
    {
      schema: {
        tags: ['shifts'],
        summary: 'Get the OPEN shift on the requesting device.',
        response: {
          200: Type.Union([ShiftView, Type.Null()]),
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      if (!req.deviceId) return reply.status(200).send(null);
      const [row] = await app.db
        .select()
        .from(shifts)
        .where(and(eq(shifts.deviceId, req.deviceId), eq(shifts.status, 'OPEN')))
        .limit(1);
      if (!row) return reply.status(200).send(null);
      return reply.status(200).send({
        id: row.id,
        deviceId: row.deviceId,
        openedByUserId: row.openedByUserId,
        openedAt: row.openedAt.toISOString(),
        openingFloatEur: row.openingFloatEur,
        status: row.status,
        blindCountEur: row.blindCountEur,
        systemExpectedEur: row.systemExpectedEur,
        varianceEur: row.varianceEur,
        closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/shifts/:id/cash-movements
  // ════════════════════════════════════════════════════════════════════

  app.post<{
    Params: { id: string };
    Body: {
      direction: 'INJECTION' | 'BANK_DROP' | 'SAFE_TRANSIT';
      amountEur: string;
      reason: string;
      witnessUserId?: string;
      externalRef?: string;
    };
  }>(
    '/api/shifts/:id/cash-movements',
    {
      schema: {
        tags: ['shifts'],
        summary: 'Record a cash movement (bank drop / safe transit / injection).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          direction: Type.Union([
            Type.Literal('INJECTION'),
            Type.Literal('BANK_DROP'),
            Type.Literal('SAFE_TRANSIT'),
          ]),
          amountEur: DecimalString,
          reason: Type.String({ minLength: 3, maxLength: 1024 }),
          witnessUserId: Type.Optional(Type.String({ format: 'uuid' })),
          externalRef: Type.Optional(Type.String({ maxLength: 256 })),
        }),
        response: {
          200: Type.Object({ id: Type.String({ format: 'uuid' }) }),
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      await assertDayNotSealed('a cash movement');

      // Ensure the shift exists + is OPEN + belongs to THIS device.
      const [s] = await app.db
        .select({ id: shifts.id, status: shifts.status, deviceId: shifts.deviceId })
        .from(shifts)
        .where(eq(shifts.id, req.params.id))
        .limit(1);
      if (!s) throw new ShiftNotFoundError(`Shift ${req.params.id} not found.`);
      // ⚠️ VOR der Zustandspruefung. Wer die Schicht gar nicht anfassen darf,
      // soll auch nicht erfahren, ob sie offen ist.
      if (!req.deviceId || s.deviceId !== req.deviceId) {
        throw new FremdeSchichtError(
          'Diese Schicht gehört zu einer anderen Kasse. Eine Bargeldbewegung ' +
            'kann nur auf die eigene Lade gebucht werden.',
        );
      }
      if (s.status !== 'OPEN')
        throw new ShiftConflictError('Cannot record cash movement on a CLOSED shift.');

      // ⚠️ EINE BEWEGUNG DARF NUR EINMAL IM KASSENBUCH STEHEN.
      //
      // Bis zum 26.07.2026 stand hier ein unbedingtes INSERT. Der Ablauf, der
      // daraus eine Differenz macht, die niemand verursacht hat:
      //
      //   Netz weg -> die Zwischenschicht reiht den Vorgang SICHER ein und
      //   wirft `ApiOfflineQueuedError` -> die Maske zeigt „Verbindung
      //   gestört" -> die Kassiererin drückt erneut -> beim Nachspielen
      //   laufen ALLE Zeilen mit 200 durch.
      //
      // `cash_movements` ist fortschreibend: die Phantomzeile lässt sich
      // weder löschen noch berichtigen, nur gegenbuchen.
      //
      // Reicht auch nur die ANTWORT verloren zu gehen, genügt ein einziger
      // Druck. Deshalb ist Idempotenz hier keine Bequemlichkeit.
      const schluessel = req.body.externalRef ?? null;

      const [row] = await app.db
        .insert(cashMovements)
        .values({
          shiftId: s.id,
          direction: req.body.direction,
          amountEur: req.body.amountEur,
          reason: req.body.reason,
          witnessUserId: req.body.witnessUserId ?? null,
          performedByUserId: req.actor.id,
          externalRef: schluessel,
        })
        // ⚠️ Die Index-Bedingung MUSS mit, nicht nur die Spalte.
        //
        // Der Index aus 0113 ist TEILWEISE (`WHERE external_ref IS NOT NULL`).
        // Postgres verlangt, dass das Ziel eines ON CONFLICT die Bedingung des
        // Index mitführt, sonst:
        //
        //   ERROR: there is no unique or exclusion constraint matching the
        //          ON CONFLICT specification
        //
        // Ohne diese Zeile wäre die Route also nicht etwa unidempotent,
        // sondern KAPUTT, und zwar erst zur Laufzeit. Beim Schreiben sah sie
        // richtig aus; erst der Lauf gegen eine echte Datenbank hat es gezeigt.
        .onConflictDoNothing({
          target: cashMovements.externalRef,
          where: isNotNull(cashMovements.externalRef),
        })
        .returning({ id: cashMovements.id });

      if (row) return reply.status(200).send({ id: row.id });

      // Kein `row` heisst: der Index hat gegriffen, es gibt diese Bewegung
      // schon. DIESELBE Kennung zurückgeben, nicht eine neue und nicht einen
      // Fehler. Ein 409 wäre hier falsch: der Aufrufer hat nichts falsch
      // gemacht, sein Wille ist bereits verzeichnet, und ein Fehler würde die
      // Nachspiel-Warteschlange anhalten.
      const [bestehend] = await app.db
        .select({ id: cashMovements.id })
        .from(cashMovements)
        .where(eq(cashMovements.externalRef, schluessel as string))
        .limit(1);

      if (!bestehend) {
        // Nur erreichbar, wenn zwischen INSERT und SELECT jemand die Zeile
        // gelöscht hat. Bei einer fortschreibenden Tabelle heisst das: die
        // Annahme über diese Tabelle stimmt nicht mehr.
        throw new ShiftConflictError(
          'Kassenbewegung konnte weder angelegt noch wiedergefunden werden.',
        );
      }
      req.log.info(
        { externalRef: schluessel, cashMovementId: bestehend.id },
        'cash_movement.idempotent_replay',
      );
      return reply.status(200).send({ id: bestehend.id });
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/shifts/:id/close  (Blindsturz)
  // ════════════════════════════════════════════════════════════════════

  app.post<{
    Params: { id: string };
    Body: { blindCountEur: string; notes?: string };
  }>(
    '/api/shifts/:id/close',
    {
      schema: {
        tags: ['shifts'],
        summary: 'Close a shift with Blindsturz (blind count first, variance reveals).',
        description:
          'The cashier supplies blindCountEur (their physical drawer count) ' +
          'BEFORE seeing the system-computed expected balance. The route computes expected = ' +
          'opening_float + Σ(cash sales on this shift) + Σ(INJECTIONs) − Σ(BANK_DROPs + SAFE_TRANSITs) ' +
          'and stores it. variance_eur is auto-generated (blind − expected).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          blindCountEur: DecimalString,
          notes: Type.Optional(Type.String({ maxLength: 1024 })),
        }),
        response: {
          200: ShiftView,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      // Blocking close on a sealed day is what makes the Kassensturz land on
      // an OPEN Z-Bon (next business day) instead of vanishing from all of
      // them: finalize aggregates Stürze by berlin_business_day(closed_at).
      await assertDayNotSealed('closing the shift');

      const result = await app.db.transaction(async (tx) => {
        // ⚠️ `FOR UPDATE`, und der UPDATE unten filtert zusaetzlich auf den
        // Zustand. Ohne die Sperre war die Zeile darunter eine blosse LESUNG:
        // drei gleichzeitige Kassenstuerze lasen alle 'OPEN', alle drei
        // antworteten 200 mit IHRER Blindzaehlung, und gespeichert wurde die
        // zuletzt geschriebene. Welche gewann, wechselte von Lauf zu Lauf, und
        // die verworfene Zaehlung ist danach nirgends mehr feststellbar
        // (§ 146 Abs. 4 AO). Mit der Sperre wartet der zweite Aufruf, liest
        // dann CLOSED und bekommt seinen 409.
        const [s] = await tx
          .select()
          .from(shifts)
          .where(eq(shifts.id, req.params.id))
          .limit(1)
          .for('update');
        if (!s) throw new ShiftNotFoundError(`Shift ${req.params.id} not found.`);
        if (!req.deviceId || s.deviceId !== req.deviceId) {
          throw new FremdeSchichtError(
            'Diese Schicht gehört zu einer anderen Kasse. Der Kassensturz kann ' +
              'nur an der Kasse vorgenommen werden, deren Lade gezählt wird.',
          );
        }
        if (s.status !== 'OPEN') throw new ShiftConflictError('Shift is already CLOSED.');

        // Compute the expected drawer balance:
        //   opening_float
        // + Σ(cash payments on this shift) [transaction_payments.method='CASH' for transactions where shift_id = this]
        // + Σ(INJECTIONs)
        // − Σ(BANK_DROPs)
        // − Σ(SAFE_TRANSITs)
        const [agg] = await tx.execute<{
          cash_sales: string | null;
          cash_payouts: string | null;
          injections: string | null;
          bank_drops: string | null;
          safe_transits: string | null;
        }>(drizzleSql`
        SELECT
          -- VERKAUF cash RECEIVED (drawer +), inkl. der Stornozeilen (negativ)
          (SELECT COALESCE(SUM(tp.amount_eur), 0)::text
             FROM transaction_payments tp
             JOIN transactions t ON t.id = tp.transaction_id
            WHERE (t.shift_id = ${s.id}
                   OR (t.shift_id IS NULL
                       AND t.storno_of_transaction_id IS NOT NULL
                       AND t.device_id = ${s.deviceId}
                       AND t.created_at >= ${s.openedAt.toISOString()}::timestamptz))
              AND t.direction = 'VERKAUF'
              AND tp.payment_method = 'CASH'::payment_method) AS cash_sales,
          -- ANKAUF cash PAID OUT to the seller (drawer −), inkl. Storno
          (SELECT COALESCE(SUM(tp.amount_eur), 0)::text
             FROM transaction_payments tp
             JOIN transactions t ON t.id = tp.transaction_id
            WHERE (t.shift_id = ${s.id}
                   OR (t.shift_id IS NULL
                       AND t.storno_of_transaction_id IS NOT NULL
                       AND t.device_id = ${s.deviceId}
                       AND t.created_at >= ${s.openedAt.toISOString()}::timestamptz))
              AND t.direction = 'ANKAUF'
              AND tp.payment_method = 'CASH'::payment_method) AS cash_payouts,
          (SELECT COALESCE(SUM(amount_eur), 0)::text
             FROM cash_movements
            WHERE shift_id = ${s.id} AND direction = 'INJECTION'::cash_movement_direction) AS injections,
          (SELECT COALESCE(SUM(amount_eur), 0)::text
             FROM cash_movements
            WHERE shift_id = ${s.id} AND direction = 'BANK_DROP'::cash_movement_direction) AS bank_drops,
          (SELECT COALESCE(SUM(amount_eur), 0)::text
             FROM cash_movements
            WHERE shift_id = ${s.id} AND direction = 'SAFE_TRANSIT'::cash_movement_direction) AS safe_transits
      `);

        // ⚠️ `toCents` aus `money-cents.ts`, nicht mehr die eigene kleine
        // Umrechnung, die hier stand. Deren Rechnung war
        // `BigInt(ganz) * 100n + BigInt(bruch)` — bei einem NEGATIVEN Betrag
        // addiert sie die Nachkommastellen, statt sie abzuziehen: aus
        // „−33.33" wurden −3267 statt −3333 Cent. Solange die Summe der
        // Barzahlungen nie negativ werden konnte, fiel das nicht auf. Seit die
        // Stornozeilen mitgezaehlt werden, kann sie es — an einer Schicht, in
        // der nur ein Storno steht, ist die Summe negativ. Ein Rundungsfehler
        // im Kassensturz waere genau die Art Defekt, die niemand mehr findet.
        const expectedCents =
          toCents(s.openingFloatEur) +
          toCents(agg!.cash_sales) -
          toCents(agg!.cash_payouts) +
          toCents(agg!.injections) -
          toCents(agg!.bank_drops) -
          toCents(agg!.safe_transits);
        // Sign-correct: a negative expected drawer (Ankauf-heavy shift) must NOT
        // produce "-1.-50". Shared helper handles the sign on the whole value.
        const expectedEur = fromCents(expectedCents);

        const [updated] = await tx
          .update(shifts)
          .set({
            status: 'CLOSED',
            blindCountEur: req.body.blindCountEur,
            systemExpectedEur: expectedEur,
            closedByUserId: req.actor.id,
            closedAt: new Date(),
            notes: req.body.notes ?? s.notes,
          })
          // ⚠️ Der Zustand gehoert IN die Bedingung. `FOR UPDATE` oben haelt
          // den Wettlauf schon auf; diese Zeile ist der zweite Riegel, damit
          // eine kuenftige Umstellung der Sperre den verlorenen Schreibvorgang
          // nicht stillschweigend zurueckholt.
          .where(and(eq(shifts.id, s.id), eq(shifts.status, 'OPEN')))
          .returning();
        if (!updated) throw new ShiftConflictError('Shift is already CLOSED.');
        return updated;
      });

      return reply.status(200).send({
        id: result.id,
        deviceId: result.deviceId,
        openedByUserId: result.openedByUserId,
        openedAt: result.openedAt.toISOString(),
        openingFloatEur: result.openingFloatEur,
        status: result.status,
        blindCountEur: result.blindCountEur,
        systemExpectedEur: result.systemExpectedEur,
        varianceEur: result.varianceEur,
        closedAt: result.closedAt ? result.closedAt.toISOString() : null,
      });
    },
  );
};

export default shiftsRoutes;
