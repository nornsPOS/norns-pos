/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Tagespreis für die Stücke im Korb (20.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   POST /api/products/kurspreise   { productIds: [...] }
 *
 * ── WARUM ES DIESEN WEG GIBT ───────────────────────────────────────────────
 *
 * Basels Befund, und er traf einen echten Defekt: die Kasse KANNTE den
 * Tagespreis (der Motor holt alle fünf Minuten Kurse, die Katalogkachel zeigt
 * das Ergebnis) und BUCHTE trotzdem den gespeicherten Preis. Der Händler
 * sollte den Tagespreis von Hand ins Lager übertragen — jeden Morgen, für
 * jedes Stück. Das ist Handarbeit für etwas, das die Kasse selbst weiss.
 *
 * Der Korb braucht den Preis LAUFEND, nicht einmal: zwischen „Ring in den
 * Korb" und „bezahlt" liegen Minuten, und in denen dreht sich der Goldkurs.
 *
 * ── WARUM DER MOTOR RECHNET UND NICHT DIE FLÄCHE ───────────────────────────
 *
 * Die Rechnung (Feingewicht × Kurs + Aufschlag, Sammleraufschlag, Rundung)
 * steht EINMAL im Haus: `packages/domain/src/pricing/metallpreis.ts`, geprüft
 * in seinem eigenen Prüfsatz. Sie in der Fläche noch einmal zu bauen, wäre
 * eine zweite Wahrheit, die irgendwann von der ersten abweicht — und ein
 * abweichender Verkaufspreis ist kein Schönheitsfehler, sondern ein falscher
 * Beleg.
 *
 * Deshalb: die Fläche FRAGT, der Motor RECHNET, und beide reden über dieselben
 * Kennungen.
 *
 * ── WAS DER WEG NICHT TUT ──────────────────────────────────────────────────
 *
 * Er ändert nichts. Er bucht nichts. Er ist eine Auskunft, und wie jede
 * Auskunft dieses Hauses sagt er auch, wenn er KEINE hat: `kurspreisEur` ist
 * dann `null` und `kurspreisGrund` nennt den Grund im Klartext.
 */

import { Type } from '@sinclair/typebox';
import { inArray, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { products } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { kurspreiseFuerStuecke } from '../lib/kurspreise-lesen.js';

/**
 * Wie viele Stücke auf einmal. Ein Korb mit mehr als zweihundert Stücken ist
 * kein Korb mehr; die Schranke schützt vor einer Abfrage, die niemand wollte.
 */
const HOECHSTZAHL = 200;

const AnfrageBody = Type.Object({
  productIds: Type.Array(Type.String({ format: 'uuid' }), {
    minItems: 1,
    maxItems: HOECHSTZAHL,
  }),
});

const Antwort = Type.Object({
  preise: Type.Array(
    Type.Object({
      productId: Type.String(),
      /** Der gespeicherte Preis — er gilt, wenn es keinen Tagespreis gibt. */
      listPriceEur: Type.String(),
      /** Der Tagespreis aus Kurs plus Aufschlag, oder `null`. */
      kurspreisEur: Type.Union([Type.String(), Type.Null()]),
      /** Warum es keinen gibt. `null`, wenn es einen gibt. */
      kurspreisGrund: Type.Union([Type.String(), Type.Null()]),
      /** Trägt das Stück einen festen Preis (folgt dem Kurs NICHT)? */
      festerPreis: Type.Boolean(),
    }),
  ),
  /** Wann die Kurse zuletzt geholt wurden — für den Countdown der Fläche. */
  kurseGeholtAm: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

const Fehler = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

const productsKurspreiseRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { productIds: string[] } }>(
    '/api/products/kurspreise',
    {
      schema: {
        tags: ['products'],
        summary: 'Die Tagespreise für eine Liste von Stücken (Auskunft, keine Buchung).',
        body: AnfrageBody,
        response: { 200: Antwort, 401: Fehler, 403: Fehler },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const ids = [...new Set(req.body.productIds)];
      const zeilen = await app.db
        .select({
          id: products.id,
          listPriceEur: products.listPriceEur,
          metal: products.metal,
          weightGrams: products.weightGrams,
          finenessDecimal: products.finenessDecimal,
          festerPreis: products.festerPreis,
        })
        .from(products)
        .where(inArray(products.id, ids));

      const kurspreise = await kurspreiseFuerStuecke(app.db, zeilen);

      /*
       * Der jüngste Abrufzeitpunkt der GÜLTIGEN Kurse — daraus baut die
       * Fläche ihren Countdown.
       *
       * ⚠️ `valid_to IS NULL` ist die Bedingung, die zählt: eine abgelöste
       * Notierung hat auch ein `fetched_at`, und der Countdown liefe dann
       * gegen eine Zeit, die längst vorbei ist.
       */
      const standZeilen = await app.db.execute<{ geholt: string | null }>(drizzleSql`
        SELECT MAX(fetched_at)::text AS geholt
          FROM metal_prices
         WHERE valid_to IS NULL`);
      const geholt = standZeilen[0]?.geholt ?? null;

      return reply.status(200).send({
        preise: zeilen.map((z) => {
          const k = kurspreise.get(z.id);
          return {
            productId: z.id,
            listPriceEur: z.listPriceEur,
            kurspreisEur: k && k.art === 'gerechnet' ? k.preisEur : null,
            kurspreisGrund: k && k.art === 'kein_kurspreis' ? k.grund : null,
            festerPreis: z.festerPreis,
          };
        }),
        kurseGeholtAm: geholt ? new Date(geholt).toISOString() : null,
      });
    },
  );
};

export default productsKurspreiseRoute;
