/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  GET /api/transactions/suche — EINEN Verkauf wiederfinden (19.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DIE DREI MENSCHEN AM TRESEN, FUER DIE ES DIESE ROUTE GIBT ──────────────
 *
 *   1. „Ich möchte das zurückgeben" — und legt den BON hin. Die Kassiererin
 *      tippt oder scannt die Belegkennung. Bis heute konnte die Kasse nur die
 *      letzten 24 Stunden sehen (`/api/transactions/recent`); ein Beleg von
 *      letzter Woche war UNAUFFINDBAR, obwohl er samt Hash-Kette in der
 *      Datenbank liegt.
 *
 *   2. „Ich habe den Bon nicht mehr" — aber das STUECK ist da, und seit
 *      Wanderung 0143 trägt es Seriennummer und Gravur. Die Kassiererin gibt
 *      die Nummer ein und bekommt den Verkauf, in dem genau dieses Stück
 *      über den Tresen ging.
 *
 *   3. „Hier ist eine Nummer" (Artikelnummer vom Etikett, das noch am Stück
 *      klebt) — derselbe Weg über die Artikelnummer.
 *
 * ── WAS DIE ROUTE BEWUSST NICHT TUT ─────────────────────────────────────────
 *
 *   • Keine Teiltreffer-Suche über alles: jeder Zweig läuft über einen
 *     eindeutigen oder gezielten Index. Der Tresen wartet auf die Antwort.
 *   • Kein Storno, keine Buchung — nur FINDEN. Was mit dem Fund geschieht
 *     (Storno, Rückgabe), entscheiden die bestehenden, geprüften Wege.
 *   • Ankäufe werden mitgefunden (der Kunde kann auch einen Ankaufbeleg
 *     vorlegen), aber als solche gekennzeichnet — stornieren kann sie der
 *     bestehende Weg ohnehin nur regelkonform.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';

const SucheQuery = Type.Object({
  /** Belegkennung, exakt („RCP-2026-000123"). Gross-/Kleinschreibung egal. */
  locator: Type.Optional(Type.String({ minLength: 4, maxLength: 40 })),
  /** Seriennummer ODER Gravur eines verkauften Stücks (0143), exakt. */
  seriennummer: Type.Optional(Type.String({ minLength: 2, maxLength: 120 })),
  /** Artikelnummer eines verkauften Stücks, exakt. */
  sku: Type.Optional(Type.String({ minLength: 2, maxLength: 64 })),
});

const Fund = Type.Object({
  id: Type.String(),
  receiptLocator: Type.String(),
  direction: Type.Union([Type.Literal('VERKAUF'), Type.Literal('ANKAUF')]),
  totalEur: Type.String(),
  finalizedAt: Type.String(),
  isStorno: Type.Boolean(),
  alreadyStornoed: Type.Boolean(),
  /** Über welchen Weg der Beleg gefunden wurde — der Tresen sagt es dazu. */
  gefundenUeber: Type.Union([
    Type.Literal('BELEGKENNUNG'),
    Type.Literal('SERIENNUMMER'),
    Type.Literal('GRAVUR'),
    Type.Literal('ARTIKELNUMMER'),
  ]),
  /** Name des Stücks, das den Treffer ausgelöst hat (nur bei Stück-Suche). */
  stueckName: Type.Union([Type.String(), Type.Null()]),
});

const SucheResponse = Type.Object({ items: Type.Array(Fund) });

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

type FundRow = {
  id: string;
  receipt_locator: string;
  direction: string;
  total_eur: string;
  finalized_at: Date;
  is_storno: boolean;
  already_stornoed: boolean;
  gefunden_ueber: string;
  stueck_name: string | null;
};

const transactionsSucheRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { locator?: string; seriennummer?: string; sku?: string } }>(
    '/api/transactions/suche',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Einen Beleg wiederfinden: Belegkennung, Seriennummer, Gravur oder Artikelnummer.',
        description:
          'Für die Rückgabe am Tresen. Exakte Treffer über Indizes — keine Teiltreffersuche. ' +
          'Genau EIN Suchweg je Anfrage; ohne Parameter kommt 400.',
        querystring: SucheQuery,
        response: { 200: SucheResponse, 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      const locator = req.query.locator?.trim().toUpperCase();
      const seriennummer = req.query.seriennummer?.trim();
      const sku = req.query.sku?.trim().toUpperCase();

      const gewaehlt = [locator, seriennummer, sku].filter(Boolean).length;
      if (gewaehlt !== 1) {
        return reply.status(400).send({
          error: {
            code: 'SUCHE_BRAUCHT_GENAU_EINEN_WEG',
            message:
              'Bitte genau einen Suchweg angeben: locator, seriennummer oder sku.',
            requestId: req.id,
          },
        });
      }

      let rows: FundRow[] = [];

      if (locator) {
        // Der eindeutige Index auf receipt_locator trägt den Vergleich; die
        // Kennung wird beim Schreiben gross erzeugt, upper() ist Höflichkeit
        // gegenüber der tippenden Hand, kein Indexverzicht (Wert normiert).
        rows = (await app.db.execute<FundRow>(sql`
          SELECT t.id::text AS id, t.receipt_locator, t.direction::text AS direction,
                 t.total_eur::text AS total_eur, t.finalized_at,
                 (t.storno_of_transaction_id IS NOT NULL) AS is_storno,
                 EXISTS (SELECT 1 FROM transactions s WHERE s.storno_of_transaction_id = t.id)
                   AS already_stornoed,
                 'BELEGKENNUNG' AS gefunden_ueber,
                 NULL::text AS stueck_name
            FROM transactions t
           WHERE t.receipt_locator = ${locator}
           LIMIT 5
        `)) as unknown as FundRow[];
      } else if (seriennummer || sku) {
        /*
         * Stück → Verkauf: über transaction_items. Der Kunde steht mit dem
         * STUECK da; welche Belege es je berührt haben, sagt die
         * Positionstabelle. Neueste zuerst — bei einem Stück, das verkauft,
         * zurückgenommen und wieder verkauft wurde, interessiert der jüngste
         * Vorgang.
         *
         * Seriennummer UND Gravur werden in EINEM Zweig geprüft (der Kunde
         * weiss selten, was von beidem die Kasse gespeichert hat); das
         * Ergebnis sagt ehrlich, WORÜBER es gefunden wurde.
         */
        const stueckWhere = seriennummer
          ? sql`(p.seriennummer = ${seriennummer} OR p.gravur = ${seriennummer})`
          : sql`p.sku = ${sku}`;
        rows = (await app.db.execute<FundRow>(sql`
          SELECT t.id::text AS id, t.receipt_locator, t.direction::text AS direction,
                 t.total_eur::text AS total_eur, t.finalized_at,
                 (t.storno_of_transaction_id IS NOT NULL) AS is_storno,
                 EXISTS (SELECT 1 FROM transactions s WHERE s.storno_of_transaction_id = t.id)
                   AS already_stornoed,
                 CASE
                   WHEN ${seriennummer ?? null}::text IS NOT NULL AND p.seriennummer = ${seriennummer ?? null}
                     THEN 'SERIENNUMMER'
                   WHEN ${seriennummer ?? null}::text IS NOT NULL THEN 'GRAVUR'
                   ELSE 'ARTIKELNUMMER'
                 END AS gefunden_ueber,
                 p.name AS stueck_name
            FROM products p
            JOIN transaction_items ti ON ti.product_id = p.id
            JOIN transactions t ON t.id = ti.transaction_id
           WHERE ${stueckWhere}
           ORDER BY t.finalized_at DESC
           LIMIT 10
        `)) as unknown as FundRow[];
      }

      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id,
          receiptLocator: r.receipt_locator,
          direction: (r.direction === 'ANKAUF' ? 'ANKAUF' : 'VERKAUF') as 'ANKAUF' | 'VERKAUF',
          totalEur: r.total_eur,
          finalizedAt: new Date(r.finalized_at).toISOString(),
          isStorno: r.is_storno,
          alreadyStornoed: r.already_stornoed,
          gefundenUeber: r.gefunden_ueber as never,
          stueckName: r.stueck_name,
        })),
      });
    },
  );
};

export default transactionsSucheRoute;
