/**
 * ════════════════════════════════════════════════════════════════════════
 *  Die Verfahrensdokumentation, aus der LAUFENDEN Anlage
 * ════════════════════════════════════════════════════════════════════════
 *
 * Bis zum 08.08.2026 lieferte die Kasse dem Prüfer eine ins Programm
 * gebackene Textdatei über ein fremdes Erzeugnis. Diese Route liest
 * stattdessen die Wahrheit dort, wo sie steht.
 *
 * ── ⚠️ DIE ZAHLEN KOMMEN AUS `pg_catalog`, NICHT AUS EINEM grep ────────
 *
 * Eine Zahl aus einer Textsuche über die Wanderungsdateien ist eine Zahl
 * über den BAUPLAN. Der Prüfer fragt nach der ANLAGE. Gemessen liegen
 * beide auseinander: die Textsuche findet 88 Tabellennamen, das
 * ausgelieferte Schema hat 87.
 *
 * ── ⚠️ FASSUNG: NUR `NORNS_KASSE_VERSION` ──────────────────────────────
 *
 * `APP_VERSION` wird im ganzen Baum nirgends gesetzt. Der alte Ersatzwert
 * `1.0.0` griff deshalb IMMER und meldete dem Finanzamt in
 * `KASSE_SW_VERSION` eine Zahl, die es nicht gibt. Fehlt die Marke, bleibt
 * das Feld hier LEER und erscheint im Dokument als offene Stelle.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireOwner } from '../lib/auth-policy.js';
import {
  baueVerfahrensdoku,
  type SchemaKennzahlen,
  type VerfahrensdokuBefund,
} from '../lib/verfahrensdokumentation.js';

/** Die Marke, aus der die Fassung kommt. Eine einzige, ohne Ersatzwert. */
const FASSUNGSMARKE = 'NORNS_KASSE_VERSION';

const AngabeSchema = Type.Object({
  etikett: Type.String(),
  wert: Type.String(),
  fehlt: Type.Boolean(),
  herkunft: Type.Union([
    Type.Literal('erzeugnis'),
    Type.Literal('gemessen'),
    Type.Literal('haendler'),
  ]),
  wo: Type.Optional(Type.String()),
});

const AbschnittSchema = Type.Object({
  nummer: Type.String(),
  titel: Type.String(),
  fundstelle: Type.Optional(Type.String()),
  absaetze: Type.Array(Type.String()),
  angaben: Type.Optional(Type.Array(AngabeSchema)),
  tabelle: Type.Optional(
    Type.Object({
      kopf: Type.Array(Type.String()),
      zeilen: Type.Array(Type.Array(Type.String())),
    }),
  ),
});

/**
 * ⚠️ Jedes Feld steht hier drin. Ein Fastify-Antwortschema entfernt still,
 * was es nicht kennt — im Haus hat das schon einmal genau das eine Feld
 * verschluckt, das die Wahrheit trug.
 */
const BefundSchema = Type.Object({
  erzeugtAm: Type.String(),
  fassung: Type.String(),
  erzeugnis: Type.String(),
  abschnitte: Type.Array(AbschnittSchema),
  offeneAngaben: Type.Array(Type.Object({ etikett: Type.String(), wo: Type.String() })),
  vollstaendig: Type.Boolean(),
});

const verfahrensdokumentationRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/verfahrensdokumentation',
    {
      schema: {
        tags: ['steuer'],
        summary: 'Die Verfahrensdokumentation nach Rz. 151 GoBD, aus der laufenden Anlage',
        response: { 200: BefundSchema },
      },
    },
    async (req): Promise<VerfahrensdokuBefund> => {
      requireAuth(req);
      // Das Dokument nennt Steuernummer, Verantwortliche und die Kennungen
      // der Sicherheitseinrichtung. Das ist Inhaberstoff.
      requireOwner(req);

      // ── Die Einstellungen, über Präfixbereiche ───────────────────────────
      // Dieselbe Form wie in `einrichtung.ts`: ein neuer Schlüssel fällt so
      // nicht durch eine vergessene Aufzählung.
      const zeilen = await app.db.execute<{ key: string; wert: string | null }>(drizzleSql`
        SELECT key, (value #>> '{}')::text AS wert
          FROM system_settings
         WHERE key LIKE 'shop.%' OR key LIKE 'kasse.%' OR key LIKE 'tse.%'
            OR key LIKE 'datev.%' OR key LIKE 'gwg.%' OR key LIKE 'betrieb.%'`);
      const einstellungen: Record<string, string | null> = {};
      for (const z of zeilen) einstellungen[z.key] = z.wert;

      // ── Die Zahlen der laufenden Anlage ──────────────────────────────────
      const [zahlen] = await app.db.execute<{
        tabellen: number;
        ausloeser: number;
        pruefbedingungen: number;
        funktionen: number;
      }>(drizzleSql`
        SELECT
          (SELECT count(*)::int FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND n.nspname = 'public')            AS tabellen,
          (SELECT count(*)::int FROM pg_catalog.pg_trigger t
             JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE NOT t.tgisinternal AND n.nspname = 'public')         AS ausloeser,
          (SELECT count(*)::int FROM pg_catalog.pg_constraint co
             JOIN pg_catalog.pg_namespace n ON n.oid = co.connamespace
            WHERE co.contype = 'c' AND n.nspname = 'public')           AS pruefbedingungen,
          (SELECT count(*)::int FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public')                                AS funktionen`);

      // ⚠️ Das Wanderungsbuch gesondert und abgesichert: es gehört uns, nicht
      // Postgres. Auf einem Stand ohne die Tabelle darf das Dokument trotzdem
      // entstehen — dann bleibt das Feld leer statt die Route zu töten.
      let wanderungsstand = '';
      try {
        const [w] = await app.db.execute<{ stand: string | null }>(drizzleSql`
          SELECT max(filename) AS stand FROM _w14_schema_migrations`);
        const roh = (w?.stand ?? '').trim();
        // Aus `0133_eine_ausgabe_weiss_womit_sie_bezahlt_wurde.sql` wird `0133`.
        wanderungsstand = /^(\d{4})/.exec(roh)?.[1] ?? roh;
      } catch {
        wanderungsstand = '';
      }

      const schema: SchemaKennzahlen = {
        tabellen: zahlen?.tabellen ?? 0,
        ausloeser: zahlen?.ausloeser ?? 0,
        pruefbedingungen: zahlen?.pruefbedingungen ?? 0,
        funktionen: zahlen?.funktionen ?? 0,
        wanderungsstand,
      };

      /*
       * Die Seriennummer der Sicherungseinrichtung — GEMESSEN an der zuletzt
       * eingegangenen Signatur, nicht aus den Einstellungen abgeschrieben.
       *
       * Es gibt keine Einstellung dafür, und es soll auch keine geben: die
       * Seriennummer ist das, was die Einrichtung SELBST zu ihren Signaturen
       * meldet. Ein Feld, in das ein Mensch sie tippt, wäre eine zweite
       * Wahrheit, die von der ersten abweichen kann — und in einem Dokument
       * für das Finanzamt ist das die teure Art von Abweichung.
       *
       * Abgesichert wie das Wanderungsbuch: auf einem Stand ohne die Spalte
       * (vor Wanderung 0141) darf das Dokument trotzdem entstehen, die Angabe
       * bleibt dann sichtbar offen.
       */
      let seriennummer = '';
      try {
        const [s] = await app.db.execute<{ nr: string | null }>(drizzleSql`
          SELECT tss_serial_number AS nr
            FROM tse_signatures
           WHERE tss_serial_number IS NOT NULL
           ORDER BY recorded_at DESC
           LIMIT 1`);
        seriennummer = (s?.nr ?? '').trim();
      } catch {
        seriennummer = '';
      }

      return baueVerfahrensdoku({
        einstellungen,
        fassung: (process.env[FASSUNGSMARKE] ?? '').trim(),
        jetzt: new Date(),
        schema,
        tse: {
          tssId: (einstellungen['tse.tss_id'] ?? '').trim(),
          clientId: (einstellungen['tse.client_id'] ?? '').trim(),
          eingerichtetAm: (einstellungen['tse.eingerichtet_am'] ?? '').trim(),
          seriennummer,
        },
      });
    },
  );
};

export default verfahrensdokumentationRoutes;
