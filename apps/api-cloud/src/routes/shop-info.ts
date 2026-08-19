/**
 * Shop identity endpoint — the receipt header (Kassenbon).
 *
 *   GET /api/shop-info  — any authenticated actor (the POS cashier reads it).
 *
 * Returns the shop name / tagline / address / USt-IdNr. / phone from
 * `system_settings` (seeded by migration 0044, Owner-editable via
 * PATCH /api/settings/:key) PLUS the merchant's receipt logo from `beleg_logo`
 * (migration 0119, set via POST /api/beleg-logo) — one round-trip for the
 * whole receipt head, the POS never needs a second call.
 *
 * ⚠️ KEIN stiller Rueckfall auf `'WAREHOUSE 14'`. Ein Server, der den Namen
 * des ersten Kunden erfindet, druckt ihn beim zweiten Mandanten auf jeden Bon
 * (Fehlerklasse „erfinden statt fragen“).
 *
 * Ein LEERER Name wird seit dem 30.07.2026 ehrlich als leerer Name geliefert
 * statt als 409 (Begruendung am Feld). Gesperrt wird beim Drucken, nicht beim
 * Lesen: `closing-export.ts` ruft weiterhin `erzwingeLadenname`.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { belegLogo } from '@norns/db/schema';

import { requireAuth } from '../lib/auth-policy.js';

import { belegIdentitaet } from '../lib/beleg-identitaet.js';

const ShopInfoResponse = Type.Object({
  name: Type.String(),
  tagline: Type.String(),
  addressLine1: Type.String(),
  addressLine2: Type.String(),
  vatId: Type.String(),
  // MUSS im Antwortschema stehen. Fastify entfernt jedes nicht deklarierte
  // Feld STILL aus der Antwort: der Handler würde die Steuernummer senden,
  // die Kasse bekäme sie nie, und die Sperre bliebe scheinbar grundlos.
  taxNumber: Type.String(),
  phone: Type.String(),
  // Das Beleg-Logo des Haendlers (bereinigtes Original, base64). null heisst:
  // kein eigenes Logo — die Kasse druckt die dezente norns.de-Systemzeile,
  // NIE ein fremdes Logo. Auch dieses Feld MUSS deklariert sein (siehe oben).
  logo: Type.Union([
    Type.Object({
      format: Type.String(),
      dataBase64: Type.String(),
      hochgeladenAm: Type.String({ format: 'date-time' }),
    }),
    Type.Null(),
  ]),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

type SettingTextRow = { key: string; value: string | null };

const shopInfoRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/shop-info',
    {
      schema: {
        tags: ['settings'],
        summary: 'Shop identity for the receipt header.',
        description:
          'Reads the shop.* keys from system_settings (migration 0044) and the ' +
          'merchant receipt logo from beleg_logo (migration 0119).',
        response: { 200: ShopInfoResponse, 401: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);

      // `value #>> '{}'` extracts the text out of a jsonb string value.
      const rows = (await app.db.execute<SettingTextRow>(sql`
        SELECT key, value #>> '{}' AS value
          FROM system_settings
         WHERE key LIKE 'shop.%'
      `)) as unknown as SettingTextRow[];

      const map = new Map(rows.map((r) => [r.key, r.value ?? '']));

      const [logoZeile] = await app.db.select().from(belegLogo).limit(1);

      return reply.status(200).send({
        // ── DER RIEGEL STAND AN DER FALSCHEN TÜR (30.07.2026, Basels Befund) ──
        //
        // Hier warf `erzwingeLadenname` bei leerem Namen einen 409. Gut
        // gemeint (kein erfundener Name auf einem Beleg), aber an der
        // LESE-Tür angebracht — und diese Tür beliefert genau die Maske, die
        // den Namen eintragen soll. Die Folge, an der laufenden Kasse
        // nachgestellt: die Maske bekam nie einen Ausgangsstand, ihr
        // Schmutz-Vergleich blieb deshalb ewig „unverändert", der
        // Speichern-Lauf sprang still über die Identität hinweg — und die
        // Meldung sagte trotzdem „gespeichert", weil die Fußzeile daneben
        // durchging. Der Inhaber tippte seinen Namen, sah „gespeichert",
        // startete neu und fand alles beim Alten. Bei JEDEM neuen Mandanten,
        // denn dort ist der Name naturgemäß leer.
        //
        // Ein leerer Name ist eine WAHRHEIT, keine Ausnahme. Er wird hier
        // ehrlich geliefert; gesperrt wird dort, wo wirklich gedruckt wird
        // (`closing-export.ts` hält seinen Riegel unverändert).
        // ⚠️ 02.08.2026: hier stand jedes Feld einzeln aus der Karte. Damit
        // gab es ZWEI Anschriften — die rechtliche im Bereich Betrieb und die
        // gedruckte hier — die sich nur in Steuernummer und USt-IdNr
        // überschnitten. Wer nur „Betrieb" ausfüllte, hatte ein gültiges
        // Prüferpaket und einen Beleg OHNE KOPF.
        //
        // Jetzt erbt der Beleg, wo sein Feld leer ist. Ein eigener
        // Geschäftsname bleibt stehen; erfunden wird nichts. Die Ableitung
        // steht in `beleg-identitaet.ts`, damit sie an EINER Stelle liegt und
        // keine Fläche sie umgehen kann.
        ...belegIdentitaet(Object.fromEntries(map)),
        logo: logoZeile
          ? {
              format: logoZeile.format,
              dataBase64: Buffer.from(logoZeile.daten).toString('base64'),
              hochgeladenAm: logoZeile.hochgeladenAm.toISOString(),
            }
          : null,
      });
    },
  );
};

export default shopInfoRoute;
