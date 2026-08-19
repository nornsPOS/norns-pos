/**
 * Was fehlt dieser Kasse noch — an EINER Stelle, vor dem ersten Kunden.
 *
 * Die Begründung steht in `lib/einrichtung.ts`. Diese Route tut nur eines: sie
 * liest GENAU die Quellen, die auch die Riegel lesen, und reicht sie an die
 * reine Auswertung weiter.
 *
 * ⚠️ Sie entscheidet NICHTS selbst. Eine Route, die ihre eigene Meinung über
 * Vollständigkeit hätte, driftet von den Riegeln weg — und dann meldet die
 * Kasse „alles bereit", während das Bezahlen weiter ablehnt.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth } from '../lib/auth-policy.js';
import { alleSchritte, kannVerkaufen } from '../lib/einrichtung.js';
import { leseStammdaten } from '../lib/haendler-stammdaten.js';

const einrichtungRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/einrichtung',
    {
      schema: {
        tags: ['einrichtung'],
        summary: 'Die offenen Punkte dieser Kasse, dringendste zuerst',
        response: {
          200: Type.Object({
            kannVerkaufen: Type.Boolean(),
            // 14.08.2026: die Liste traegt jetzt ALLE Punkte samt Stand, damit
            // die Flaeche „5 von 11" sagen und das Geschaffte zeigen kann.
            // Wer nur die Luecken will, filtert auf `erledigt = false`.
            gesamt: Type.Integer(),
            erledigtZahl: Type.Integer(),
            schritte: Type.Array(
              Type.Object({
                titel: Type.String(),
                erklaerung: Type.String(),
                sperre: Type.String(),
                wohin: Type.String(),
                // ⚠️ Ohne diese Zeile entfernt Fastify das Feld still, und die
                // Karte baut wieder keinen Griff. Im Haus ist genau das schon
                // einmal passiert: das Antwortschema verschluckte das eine
                // Feld, das die Wahrheit trug.
                ziel: Type.Object({
                  pfad: Type.String(),
                  bereich: Type.Optional(Type.String()),
                  nurInhaber: Type.Boolean(),
                }),
                riegel: Type.String(),
                schluessel: Type.Optional(Type.String()),
                erledigt: Type.Boolean(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      requireAuth(req);

      // Dieselbe Abfrage wie in `closing-export.ts`: ein Präfixbereich, damit
      // ein neuer Schlüssel nicht durch eine vergessene Aufzählung fällt.
      const zeilen = await app.db.execute<{ key: string; wert: string | null }>(drizzleSql`
        SELECT key, (value #>> '{}')::text AS wert
          FROM system_settings
         WHERE key LIKE 'shop.%' OR key LIKE 'kasse.%' OR key LIKE 'dsfinvk.%'
            OR key LIKE 'steuer.%' OR key LIKE 'tse.%'
            -- ⚠️ 12.08.2026: ohne diese Zeile konnte die Startliste die sechs
            -- DATEV-Angaben gar nicht SEHEN und meldete „bereit", waehrend der
            -- Export im selben Augenblick mit DATEV_MANDANT_FEHLT ablehnte.
            OR key LIKE 'datev.%'`);
      const einstellungen: Record<string, string | null> = {};
      for (const z of zeilen) einstellungen[z.key] = z.wert;

      const zaehler = await app.db.execute<{ zeiten: string; codes: string }>(drizzleSql`
        SELECT (SELECT count(*)::text FROM staff_working_hours) AS zeiten,
               (SELECT count(*)::text FROM users
                 WHERE pos_pin_hash IS NOT NULL AND soft_deleted_at IS NULL) AS codes`);

      const schritte = alleSchritte({
        einstellungen,
        hatArbeitszeiten: Number(zaehler[0]?.zeiten ?? '0') > 0,
        hatKassencode: Number(zaehler[0]?.codes ?? '0') > 0,
        // ⚠️ Dieselbe Funktion, die auch der Export benutzt. Eine zweite,
        // eigene Vollständigkeitsprüfung wäre der nächste stille Widerspruch.
        fehlendeStammdaten: leseStammdaten(einstellungen).fehlt,
        // ⚠️ 0142: DIESELBE Messung, die auch der Riegel im Verkaufsweg
        // benutzt. Eine zweite, eigene Zählung an dieser Stelle wäre der
        // nächste stille Widerspruch: die Startliste sagte „noch 4", der
        // Riegel liesse 2 durch, und niemand wüsste, welche Zahl gilt.
      });

      return {
        kannVerkaufen: kannVerkaufen(schritte),
        gesamt: schritte.length,
        erledigtZahl: schritte.filter((s) => s.erledigt).length,
        schritte,
      };
    },
  );
};

export default einrichtungRoutes;
