/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE EU-ABFRAGE, UND WARUM IHR ERGEBNIS BLEIBEN MUSS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Diese Route fragte die EU wirklich — mit Zeitgrenze und ordentlicher
 * Fehlerbehandlung — gab die Antwort an den Bildschirm und behielt NICHTS.
 * `customers` trug dazu genau eine Spalte: `vat_id`, ein freier Text.
 *
 * § 6a Abs. 4 UStG schützt den guten Glauben nur bei BELEGTER Sorgfalt. Eine
 * Abfrage, die niemand aufhebt, ist kein Beleg. Seit Wanderung 0116 wird das
 * Ergebnis am Kunden festgehalten, und `lib/reverse-charge.ts` lässt § 13b nur
 * zu, wenn dort etwas Gültiges und Frisches steht.
 *
 * ⚠️ ZWEITER BEFUND, und er betrifft das, was ein Mensch zu sehen bekommt:
 * bei Zeitüberschreitung und bei Netzausfall gab die Route `valid: false`
 * zurück, also GENAU DASSELBE wie bei einer wirklich ungültigen Nummer. Ein
 * Aufrufer, der nur dieses Feld liest, hält eine Störung bei der EU für eine
 * falsche USt-IdNr. — und sagt das einem Geschäftskunden ins Gesicht.
 *
 * Das Feld `ergebnis` trennt beides. `valid` bleibt erhalten, damit ältere
 * Aufrufer nicht brechen; es heisst jetzt aber ausdrücklich „bestätigt",
 * nicht „geprüft und für falsch befunden".
 */
import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  belegvermerkFuerVatPruefung,
  normalisiereVatId,
  type VatPruefergebnis,
} from '../lib/reverse-charge.js';

const QuerySchema = Type.Object({
  vatId: Type.String({ minLength: 4, maxLength: 32 }),
  /**
   * Wird sie mitgegeben, wandert das Ergebnis an den Kunden — und nur dann ist
   * es ein Beleg. Ohne sie bleibt die Abfrage eine blosse Auskunft.
   */
  customerId: Type.Optional(Type.String({ format: 'uuid' })),
});

const ResponseSchema = Type.Object({
  /** `true` NUR bei einer von der EU bestätigten Nummer. */
  valid: Type.Boolean(),
  /**
   * ⚠️ Dieses Feld muss im Antwortschema stehen, sonst entfernt Fastify es
   * still aus der Antwort — und dann ist die ganze Unterscheidung wieder weg.
   */
  ergebnis: Type.Union([
    Type.Literal('GUELTIG'),
    Type.Literal('UNGUELTIG'),
    Type.Literal('NICHT_ERREICHBAR'),
    Type.Literal('FORMFEHLER'),
  ]),
  /** Wurde das Ergebnis beim Kunden festgehalten? Nur dann taugt es als Beleg. */
  gespeichert: Type.Boolean(),
  name: Type.Optional(Type.String()),
  address: Type.Optional(Type.String()),
  /**
   * Der fertige Belegvermerk, oder `null`.
   *
   * ⚠️ 27.07.2026. Bis heute gab es ihn hier nicht, und die Kasse siegelt
   * ihren Belegrumpf VOR dem Netz. Sie druckte deshalb auf JEDEN
   * § 13b-Beleg „USt-IdNr.: Nachweis der EU-Abfrage FEHLT." — auch bei
   * durchgeführter, gültiger Abfrage. Der Server rechnete den Satz beim
   * Kassieren aus (`darfReverseCharge`) und warf ihn weg.
   *
   * ⚠️ Und ohne diesen Eintrag im ANTWORTSCHEMA entfernt Fastify das Feld
   * still wieder — genau wie oben bei `ergebnis`.
   */
  belegvermerk: Type.Union([Type.String(), Type.Null()]),
  error: Type.Optional(Type.String()),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export const customersVerifyVatRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { vatId: string; customerId?: string } }>(
    '/api/customers/verify-vat',
    {
      schema: {
        tags: ['customers'],
        summary: 'Verify B2B VAT ID via EU VIES API.',
        description: 'Performs a real-time lookup with a 5s timeout. Handles errors gracefully.',
        querystring: QuerySchema,
        response: {
          200: ResponseSchema,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const rawVatId = req.query.vatId;
      const cleanVatId = normalisiereVatId(rawVatId);

      /**
       * Der EINZIGE Weg aus dieser Route.
       *
       * Absicht: es gibt sechs Rueckgabestellen, und bei jeder einzeln „nicht
       * vergessen, auch zu speichern" ist genau die Sorte Vorsatz, die beim
       * naechsten Zweig bricht. Hier kann keine Antwort das Festhalten
       * auslassen, weil keine an dieser Funktion vorbeikommt.
       */
      const antworte = async (
        ergebnis: VatPruefergebnis,
        extra: { name?: string; address?: string; error?: string } = {},
      ) => {
        let gespeichert = false;
        if (req.query.customerId) {
          try {
            const rows = await app.db.execute<{ id: string }>(drizzleSql`
              UPDATE customers
                 SET vat_id_checked_at    = now(),
                     vat_id_check_result  = ${ergebnis}::vat_check_result,
                     vat_id_check_name    = ${extra.name ?? null},
                     vat_id_check_address = ${extra.address ?? null},
                     vat_id_checked_value = ${cleanVatId}
               WHERE id = ${req.query.customerId}::uuid
               RETURNING id`);
            gespeichert = rows.length > 0;
          } catch (e) {
            // ⚠️ Ein Fehlschlag hier darf die Auskunft nicht verschlucken —
            // aber er darf erst recht nicht als „gespeichert" durchgehen.
            // Genau diese Spalten sind die, die die Spaltenrechte-Falle in
            // diesem Haus schon zweimal live gesperrt hat.
            req.log.error({ err: e }, 'USt-IdNr.-Pruefung konnte nicht festgehalten werden');
            gespeichert = false;
          }
        }
        return reply.status(200).send({
          valid: ergebnis === 'GUELTIG',
          ergebnis,
          gespeichert,
          // ⚠️ NUR bei gültig UND festgehalten. Ein Vermerk zu einer Prüfung,
          // die nirgends steht, wäre eine Behauptung auf dem Beleg ohne
          // Grundlage — und `darfReverseCharge` würde den Verkauf beim
          // Kassieren ohnehin abweisen. Dann lieber kein Satz als ein
          // unbelegter.
          belegvermerk:
            ergebnis === 'GUELTIG' && gespeichert
              ? belegvermerkFuerVatPruefung(cleanVatId, new Date())
              : null,
          ...extra,
        });
      };

      if (cleanVatId.length < 4 || cleanVatId.length > 15) {
        return antworte('FORMFEHLER', { error: 'INVALID_FORMAT' });
      }

      const countryCode = cleanVatId.slice(0, 2);
      const vatNumber = cleanVatId.slice(2);

      // Validate country code is 2 letters
      if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z0-9]+$/.test(vatNumber)) {
        return antworte('FORMFEHLER', { error: 'INVALID_FORMAT' });
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`;
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Warehouse14/1.0.0',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Die EU antwortet, aber nicht mit einem Ergebnis. Das ist KEINE
          // Aussage ueber die Nummer.
          return antworte('NICHT_ERREICHBAR', { error: 'VIES_UNAVAILABLE' });
        }

        const data = (await response.json()) as {
          isValid: boolean;
          name?: string;
          address?: string;
        };

        if (data.isValid) {
          // German (DE) and Spanish (ES) lookups might return valid but mask details.
          // Clean/standardize empty/masked values to '---' or trim them.
          const name = data.name && data.name.trim() !== '' ? data.name.trim() : '---';
          const address = data.address && data.address.trim() !== '' ? data.address.trim() : '---';

          return antworte('GUELTIG', { name, address });
        }

        // Die EU kennt die Nummer nicht. DAS ist eine Aussage.
        return antworte('UNGUELTIG');
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return antworte('NICHT_ERREICHBAR', { error: 'VIES_TIMEOUT' });
        }

        return antworte('NICHT_ERREICHBAR', { error: 'VIES_UNAVAILABLE' });
      }
    },
  );
};
