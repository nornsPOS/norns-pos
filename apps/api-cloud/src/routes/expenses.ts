/**
 * operating_expenses CRUD — one-off Betriebsausgaben (migration 0075).
 *
 *   GET   /api/expenses           — list (date range + category filter, paged)
 *   POST  /api/expenses           — create  (ADMIN + audit)
 *   PATCH /api/expenses/:id        — edit    (ADMIN + audit)
 *
 * Mutating routes mirror the house pattern: requireAuth → requireRole(ADMIN)
 * → write + audit_log row in ONE transaction. Money is
 * INTEGER CENTS end-to-end. `created_by_user_id` is always req.actor.id and is
 * never client-overridable.
 *
 * No DELETE: corrections are an UPDATE / a new offsetting row (GoBD — records
 * stay nachvollziehbar; the audit_log carries the actor + delta).
 */

import { type SQL, and, count, desc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, operatingExpenses } from '@norns/db/schema';

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { KLARTEXT_AUSGABENART, aufwandskontoFuer } from '../lib/datev-bargeldbewegung.js';
import { kodiereAnsi, baueBuchungsstapel, datevDateiname } from '../lib/datev-format.js';
import { ladeDatevMandant } from '../lib/datev-mandant.js';
import { konto, ladeKontenplan, normalisiereRahmen } from '../lib/kontenrahmen.js';
import { nurFehler, pruefeBuchungsstapel } from '../lib/datev-pruefer.js';
import { bewegungsZeile } from './closing-export.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

/** Zahlweg fehlt oder Konto fehlt: die Datei entsteht bewusst NICHT. */
class FremdbelegeUnvollstaendigError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/** Der Zeitraum traegt schlicht keine unbare Ausgabe. */
class FremdbelegeLeerError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/**
 * Die selbst erzeugte Datei haelt das Format nicht ein. 500, nicht 409,
 * aus demselben Grund wie in closing-export.ts: der Bediener hat nichts
 * falsch gemacht, es ist ein Fehler in UNSEREM Erzeugen.
 */
/**
 * ⛔ EIN ZEICHEN, DAS DATEV NICHT KENNT, IST KEIN SERVERFEHLER (19.08.2026).
 *
 * DATEV EXTF ist Windows-1252. Ein tuerkisches ş, ein polnisches ł, ein
 * Emoji im Lieferantennamen — alles im Alltag moeglich, und alles dort
 * heimatlos. Der Haendler hat nichts kaputt gemacht; er hat etwas getippt,
 * das er in zehn Sekunden aendern kann, sobald ihm jemand sagt WO.
 *
 * Darum 409 mit Fundstelle statt 500 mit „unerwarteter Fehler": derselbe
 * Grund, aus dem LIZENZ_FEHLT ein 402 ist und kein 403.
 */
class DatevZeichenNichtKodierbarError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class FremdbelegDateiFehlerhaftError extends DomainError {
  public readonly httpStatus = 500;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}
import {
  CreateExpenseBody,
  ErrorResponse,
  ExpenseIdParams,
  ListExpensesQuery,
  ListExpensesResponse,
  type TCreateExpenseBody,
  type TExpenseIdParams,
  type TListExpensesQuery,
  type TUpdateExpenseBody,
  UpdateExpenseBody,
} from '../schemas/finance.js';

class ExpenseNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class ExpenseValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

type ExpenseRowDb = typeof operatingExpenses.$inferSelect;

function serialize(row: ExpenseRowDb): Record<string, unknown> {
  return {
    id: row.id,
    date: row.businessDay,
    category: row.category,
    amountCents: row.amountCents,
    zahlweg: row.zahlweg,
    note: row.note,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const expensesRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/expenses
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TListExpensesQuery }>(
    '/api/expenses',
    {
      schema: {
        tags: ['finance'],
        summary: 'List one-off operating expenses (paged, filtered).',
        querystring: ListExpensesQuery,
        response: { 200: ListExpensesResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const q = req.query;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;

      const preds: Array<SQL | undefined> = [
        q.from !== undefined ? gte(operatingExpenses.businessDay, q.from) : undefined,
        q.to !== undefined ? lte(operatingExpenses.businessDay, q.to) : undefined,
        q.category !== undefined ? eq(operatingExpenses.category, q.category) : undefined,
      ];
      const whereClause = preds.some((p) => p !== undefined) ? and(...preds) : undefined;

      const [rows, totalRow] = await Promise.all([
        app.db
          .select()
          .from(operatingExpenses)
          .where(whereClause)
          .orderBy(desc(operatingExpenses.businessDay), desc(operatingExpenses.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(operatingExpenses).where(whereClause),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);
      return reply.status(200).send({
        items: rows.map(serialize),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/expenses
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Body: TCreateExpenseBody }>(
    '/api/expenses',
    {
      schema: {
        tags: ['finance'],
        summary: 'Book a one-off operating expense.',
        description: 'ADMIN. Records the actor + delta to audit_log.',
        body: CreateExpenseBody,
        response: {
          200: ListExpensesResponse.properties.items.items,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const body = req.body;

      const row = await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(operatingExpenses)
          .values({
            businessDay: body.date,
            category: body.category,
            amountCents: body.amountCents,
            zahlweg: body.zahlweg,
            note: body.note ?? null,
            createdByUserId: req.actor.id,
          })
          .returning();
        if (!inserted) throw new Error('operating_expenses INSERT returned no row');

        await tx.insert(auditLog).values({
          eventType: 'operating_expense.created',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            expenseId: inserted.id,
            date: inserted.businessDay,
            category: inserted.category,
            amountCents: inserted.amountCents,
            zahlweg: inserted.zahlweg,
            note: inserted.note,
          },
        });
        return inserted;
      });

      return reply.status(200).send(serialize(row));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/expenses/:id
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TExpenseIdParams; Body: TUpdateExpenseBody }>(
    '/api/expenses/:id',
    {
      schema: {
        tags: ['finance'],
        summary: 'Edit a one-off operating expense.',
        description: 'ADMIN. Records actor + before/after to audit_log.',
        params: ExpenseIdParams,
        body: UpdateExpenseBody,
        response: {
          200: ListExpensesResponse.properties.items.items,
          400: ErrorResponse,
          404: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const updates: Partial<typeof operatingExpenses.$inferInsert> = {};
      if (req.body.date !== undefined) updates.businessDay = req.body.date;
      if (req.body.category !== undefined) updates.category = req.body.category;
      if (req.body.amountCents !== undefined) updates.amountCents = req.body.amountCents;
      if (req.body.zahlweg !== undefined) updates.zahlweg = req.body.zahlweg;
      if (req.body.note !== undefined) updates.note = req.body.note;

      if (Object.keys(updates).length === 0) {
        throw new ExpenseValidationError('no editable fields provided');
      }

      const row = await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(operatingExpenses)
          .where(eq(operatingExpenses.id, req.params.id))
          .limit(1);
        if (!before) throw new ExpenseNotFoundError(`Expense ${req.params.id} not found`);

        const [updated] = await tx
          .update(operatingExpenses)
          .set(updates)
          .where(eq(operatingExpenses.id, req.params.id))
          .returning();
        if (!updated) throw new ExpenseNotFoundError(`Expense ${req.params.id} not found`);

        await tx.insert(auditLog).values({
          eventType: 'operating_expense.updated',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            expenseId: updated.id,
            before: {
              date: before.businessDay,
              category: before.category,
              amountCents: before.amountCents,
              zahlweg: before.zahlweg,
              note: before.note,
            },
            after: {
              date: updated.businessDay,
              category: updated.category,
              amountCents: updated.amountCents,
              zahlweg: updated.zahlweg,
              note: updated.note,
            },
          },
        });
        return updated;
      });

      return reply.status(200).send(serialize(row));
    },
  );

  // ── GET /api/expenses/export/datev — die Fremdbelege (unbare Ausgaben) ────
  //
  // ── BASELS ANWEISUNG VOM 18.08.2026 ─────────────────────────────────────
  //
  // „Wenn der Haendler zusaetzliche Rechnungen oder Ausgaben hat, die er der
  // DATEV-Datei hinzufuegen will, damit sie automatisch mitgerechnet werden:
  // ein eigener Weg dafuer."
  //
  // ── WAS SCHON FLOSS, UND WAS NIRGENDS HINFLOSS ──────────────────────────
  //
  // BAR bezahlte Ausgaben stehen seit dem 05.08. im Tages-Buchungsstapel
  // (Aufwand an Kasse, closing-export.ts) — sie bewegen die Lade und gehoeren
  // ihrem Kassentag. Eine per BANK oder KARTE bezahlte Lieferantenrechnung
  // bewegte dagegen KEIN Kassenkonto und erschien in KEINEM Export: der
  // Berater bekam sie als Zettel oder gar nicht.
  //
  // Dieser Weg exportiert genau diese unbaren Ausgaben eines Zeitraums als
  // eigenen EXTF-Buchungsstapel: Aufwandskonto an Bank, Belegdatum ist der
  // Geschaeftstag der Ausgabe, Belegfeld die Kennung der Zeile (BA-…), also
  // dieselben Konten und dieselbe Kennung wie bei den Barausgaben.
  //
  // KARTE bucht ebenfalls gegen Bank: die Abrechnung der Geschaeftskarte
  // laeuft ueber das Bankkonto, und der Berater gleicht gegen den
  // Kontoauszug ab. Ein eigenes Kartenverrechnungskonto waere eine
  // Steuerberater-Entscheidung; bis sie faellt, ist Bank der ehrliche Weg,
  // der beim Abgleich sofort auffiele, statt still zu raten.
  //
  // UNBEKANNT wird ABGEWIESEN, nicht geraten: Zeilen von vor dem 06.08.2026
  // wissen nicht, womit sie bezahlt wurden. Die Meldung sagt, wie viele es
  // sind und wo man den Zahlweg nachtraegt (Finanzen, Ausgabe bearbeiten).
  app.get<{ Querystring: { von: string; bis: string; kontenrahmen?: string } }>(
    '/api/expenses/export/datev',
    {
      schema: {
        tags: ['finance'],
        summary: 'Unbare Ausgaben (Bank, Karte) eines Zeitraums als DATEV-Buchungsstapel',
        querystring: Type.Object({
          von: Type.String({ format: 'date' }),
          bis: Type.String({ format: 'date' }),
          kontenrahmen: Type.Optional(Type.String()),
        }),
        response: { 401: ErrorResponse, 403: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');
      requireStepUp(req);

      const { von, bis } = req.query;

      const zeilen = await app.db.execute<{
        kategorie: string;
        cent: string;
        note: string | null;
        id: string;
        tag: string;
        zahlweg: string;
      }>(sql`
        SELECT category::text AS kategorie,
               amount_cents::text AS cent,
               note,
               id::text AS id,
               business_day::text AS tag,
               zahlweg::text AS zahlweg
          FROM operating_expenses
         WHERE business_day BETWEEN ${von}::date AND ${bis}::date
           AND zahlweg IN ('BANK', 'KARTE')
         ORDER BY business_day ASC, created_at ASC`);

      const unbekannt = await app.db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n
          FROM operating_expenses
         WHERE business_day BETWEEN ${von}::date AND ${bis}::date
           AND zahlweg = 'UNBEKANNT'`);
      const offen = Number(unbekannt[0]?.n ?? '0');
      if (offen > 0) {
        throw new FremdbelegeUnvollstaendigError(
          `${offen} Ausgabe${offen === 1 ? '' : 'n'} im Zeitraum ${von} bis ${bis} ` +
            'traegt keinen Zahlweg (Zeilen von vor dem 06.08.2026). Ohne ihn ist das ' +
            'Gegenkonto nicht bestimmbar, deshalb wurde KEINE Datei erzeugt. Bitte ' +
            'unter Finanzen die Ausgabe bearbeiten und den Zahlweg nachtragen.',
        );
      }
      if (zeilen.length === 0) {
        throw new FremdbelegeLeerError(
          `Im Zeitraum ${von} bis ${bis} liegt keine unbare Ausgabe (Bank oder Karte). ` +
            'Bar bezahlte Ausgaben stehen bereits im DATEV-Stapel ihres Kassentages.',
        );
      }

      const mandant = await ladeDatevMandant(app.db, req.query.kontenrahmen);
      const plan = await ladeKontenplan(
        app.db,
        normalisiereRahmen(`SKR${mandant.sachkontenrahmen}`),
      );
      const bank = konto(plan, 'bank');

      const datevZeilen = zeilen.map((z) => {
        const aufwand = aufwandskontoFuer(z.kategorie, plan);
        if (aufwand === null) {
          // Dieselbe Regel wie bei den Barausgaben: lieber keine Datei als
          // eine Zeile auf einem falschen Konto.
          throw new FremdbelegeUnvollstaendigError(
            `Fuer die Ausgabenart „${KLARTEXT_AUSGABENART[z.kategorie] ?? z.kategorie}" ist ` +
              'kein Aufwandskonto hinterlegt, deshalb wurde KEINE Datei erzeugt.',
          );
        }
        const c = BigInt(z.cent);
        const name = KLARTEXT_AUSGABENART[z.kategorie] ?? z.kategorie;
        const weg = z.zahlweg === 'KARTE' ? 'Karte' : 'Bank';
        return bewegungsZeile(
          {
            betragEur: `${c / 100n}.${String(c % 100n).padStart(2, '0')}`,
            sollkonto: aufwand,
            gegenkonto: bank,
            belegfeld1: `BA-${z.id.slice(0, 8)}`,
            buchungstext: `${name} (${weg})${z.note ? `: ${z.note}` : ''}`,
          },
          z.tag,
        );
      });

      const zeitraum = { von, bis };
      const csv = baueBuchungsstapel(
        mandant,
        zeitraum,
        `Fremdbelege ${von} bis ${bis}`,
        datevZeilen,
        new Date(),
      );

      // Dieselbe Selbstpruefung wie beim Tagesstapel: der Berater soll einen
      // Formfehler nie als Erster finden.
      const befunde = nurFehler(pruefeBuchungsstapel(csv));
      if (befunde.length > 0) {
        const liste = befunde
          .slice(0, 5)
          .map((f) => `• Zeile ${f.zeile}, Feld ${f.feld}: ${f.text}`)
          .join('\n');
        throw new FremdbelegDateiFehlerhaftError(
          `Die erzeugte DATEV-Datei entspricht nicht dem Format und wurde NICHT ausgeliefert.\n${liste}`,
        );
      }

      const filename = datevDateiname(mandant, zeitraum);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.type('text/csv; charset=windows-1252');
      /*
       * ⛔ DAS KODIEREN GEHOERT IN DEN FEHLERPFAD (19.08.2026, Fund der
       * boeswilligen Pruefung).
       *
       * DATEV EXTF ist Windows-1252. Ein tuerkisches ş, ein polnisches ł oder
       * ein Emoji im Namen eines Lieferanten hat dort keinen Platz —
       * `kodiereAnsi` wirft dann, und zwar MIT der Fundstelle („Zeichen X an
       * Stelle Y"). Diese Zeile stand ausserhalb jeder Behandlung: der Wurf
       * wurde zu einem nackten 500, die Fundstelle war weg, und der Haendler
       * las „unerwarteter Fehler" ueber ein Zeichen, das er selbst getippt
       * hat und sofort haette aendern koennen.
       */
      let bytes: Buffer;
      try {
        bytes = kodiereAnsi(csv);
      } catch (fehler) {
        throw new DatevZeichenNichtKodierbarError(
          fehler instanceof Error
            ? `Die DATEV-Datei enthaelt ein Zeichen, das DATEV nicht kennt (Windows-1252). ${fehler.message} Bitte die genannte Stelle aendern.`
            : 'Die DATEV-Datei enthaelt ein Zeichen, das DATEV nicht kennt (Windows-1252).',
        );
      }
      return reply.status(200).send(bytes);
    },
  );
};

export default expensesRoutes;
