/**
 * Das Beleg-Logo des Haendlers — Hochladen und Loeschen (Dekret 26.07.2026).
 *
 *   POST   /api/beleg-logo — Inhaber (ADMIN + Stufenanhebung): Logo setzen.
 *   DELETE /api/beleg-logo — Inhaber: zurueck zur Vorgabe (kein Logo, die
 *                            Kasse druckt die dezente norns.de-Systemzeile).
 *
 * GELESEN wird das Logo nicht hier, sondern in GET /api/shop-info — dem Weg,
 * den die Kasse fuer den Belegkopf ohnehin zieht. Kein zweiter Rundgang.
 *
 * Angenommen: SVG („die praeziseste Form“), PNG, JPEG. Grenzen: 256 KB,
 * Raster hoechstens 2048 px Kante. Ein SVG durchlaeuft die Waesche
 * (lib/beleg-logo.ts) und muss sich DANACH von sharp zeichnen lassen —
 * gespeichert wird ausschliesslich das bereinigte Original. Die Ablage ist
 * die einzeilige Mandantentabelle `beleg_logo` (Wanderung 0119), damit das
 * Logo die Datenbanksicherung mitfaehrt.
 */

import { Type } from '@sinclair/typebox';
import sharp from 'sharp';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, belegLogo } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  BELEG_LOGO_MAX_BYTES,
  BELEG_LOGO_MAX_KANTE_PX,
  type BelegLogoFormat,
  waescheSvg,
} from '../lib/beleg-logo.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class BelegLogoValidierungError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const HochladenBody = Type.Object({
  format: Type.Union([Type.Literal('svg'), Type.Literal('png'), Type.Literal('jpeg')]),
  /** Die Bilddatei, base64. Entschluesselt hoechstens 256 KB. */
  dataBase64: Type.String({ minLength: 1 }),
});
type THochladenBody = { format: BelegLogoFormat; dataBase64: string };

const HochladenResponse = Type.Object({
  format: Type.String(),
  /** Groesse des GESPEICHERTEN (bereinigten) Originals. */
  sizeBytes: Type.Integer(),
  hochgeladenAm: Type.String({ format: 'date-time' }),
  /** Was die SVG-Waesche entfernt hat — Ehrlichkeit gegenueber dem Inhaber. */
  entfernt: Type.Array(Type.String()),
});

const LoeschenResponse = Type.Object({
  /** false, wenn gar kein Logo gespeichert war — auch das ist eine Antwort. */
  geloescht: Type.Boolean(),
});

const belegLogoRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: THochladenBody }>(
    '/api/beleg-logo',
    {
      // 256 KB Nutzbild × 4/3 (base64) + JSON-Rahmen. Grosszuegig, aber kein
      // Scheunentor: der eigentliche Deckel sitzt nach dem Entschluesseln.
      bodyLimit: 512 * 1024,
      schema: {
        tags: ['settings'],
        summary: 'Das Beleg-Logo des Haendlers setzen (ADMIN + Stufenanhebung).',
        description:
          'Nimmt SVG/PNG/JPEG als base64 an, waescht SVG (Script, on*-Attribute, ' +
          'foreignObject, fremde Verweise) und speichert NUR das bereinigte Original ' +
          'in beleg_logo. Grenzen: 256 KB, Raster max. 2048 px Kante.',
        body: HochladenBody,
        response: {
          200: HochladenResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const roh = Buffer.from(req.body.dataBase64, 'base64');
      if (roh.length === 0) {
        throw new BelegLogoValidierungError('Bilddaten sind leer.');
      }
      if (roh.length > BELEG_LOGO_MAX_BYTES) {
        throw new BelegLogoValidierungError(
          `Das Logo ist zu gross (${Math.round(roh.length / 1024)} KB), erlaubt sind hoechstens 256 KB.`,
        );
      }

      const format = req.body.format;
      let gespeichert: Buffer;
      let entfernt: string[] = [];

      if (format === 'svg') {
        const ergebnis = waescheSvg(roh.toString('utf8'));
        if (ergebnis.sauber === null) {
          throw new BelegLogoValidierungError(ergebnis.grund ?? 'Das SVG wurde abgelehnt.');
        }
        entfernt = ergebnis.entfernt;
        gespeichert = Buffer.from(ergebnis.sauber, 'utf8');
        // Die zweite Wand: was die Waesche passiert hat, muss sich auch
        // ZEICHNEN lassen. Ein SVG, das librsvg nicht rastern kann, wuerde
        // auf dem Bon als leerer Kasten erscheinen — lieber jetzt ablehnen.
        try {
          await sharp(gespeichert, { limitInputPixels: 32_000_000 })
            .resize(256, 256, { fit: 'inside' })
            .png()
            .toBuffer();
        } catch {
          throw new BelegLogoValidierungError(
            'Das SVG laesst sich nicht zeichnen (kein gueltiges Bild nach der Bereinigung).',
          );
        }
      } else {
        // Raster: das Format muss STIMMEN (kein als PNG etikettiertes
        // Irgendwas), und keine Kante ueber 2048 px.
        let breite: number | undefined;
        let hoehe: number | undefined;
        let echtesFormat: string | undefined;
        try {
          const meta = await sharp(roh, { limitInputPixels: 32_000_000 }).metadata();
          breite = meta.width;
          hoehe = meta.height;
          echtesFormat = meta.format;
        } catch {
          throw new BelegLogoValidierungError(
            'Bild konnte nicht gelesen werden (kein gueltiges Bildformat).',
          );
        }
        if (echtesFormat !== format) {
          throw new BelegLogoValidierungError(
            `Die Datei ist kein ${format.toUpperCase()} (erkannt: ${echtesFormat ?? 'unbekannt'}).`,
          );
        }
        if (
          breite === undefined ||
          hoehe === undefined ||
          breite > BELEG_LOGO_MAX_KANTE_PX ||
          hoehe > BELEG_LOGO_MAX_KANTE_PX
        ) {
          throw new BelegLogoValidierungError(
            `Das Bild ist ${breite ?? '?'} × ${hoehe ?? '?'} px, erlaubt sind hoechstens 2048 px je Kante.`,
          );
        }
        gespeichert = roh;
      }

      // Upsert der EINEN Zeile + Pruefprotokoll in EINER Transaktion —
      // dasselbe Muster wie PATCH /api/settings/:key.
      const zeile = await app.db.transaction(async (tx) => {
        const [geschrieben] = await tx
          .insert(belegLogo)
          .values({
            id: 1,
            format,
            daten: gespeichert,
            hochgeladenAm: new Date(),
            hochgeladenVon: req.actor.id,
          })
          .onConflictDoUpdate({
            target: belegLogo.id,
            set: {
              format,
              daten: gespeichert,
              hochgeladenAm: new Date(),
              hochgeladenVon: req.actor.id,
            },
          })
          .returning();
        if (!geschrieben) throw new Error('beleg_logo UPSERT returned no row');

        await tx.insert(auditLog).values({
          eventType: 'beleg_logo.gesetzt',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: { format, sizeBytes: gespeichert.length, entfernt },
        });
        return geschrieben;
      });

      return reply.status(200).send({
        format: zeile.format,
        sizeBytes: gespeichert.length,
        hochgeladenAm: zeile.hochgeladenAm.toISOString(),
        entfernt,
      });
    },
  );

  app.delete(
    '/api/beleg-logo',
    {
      schema: {
        tags: ['settings'],
        summary: 'Das Beleg-Logo entfernen — zurueck zur Vorgabe (ADMIN + Stufenanhebung).',
        description:
          'Loescht die eine beleg_logo-Zeile. Ohne Logo druckt der Bon die ' +
          'norns.de-Systemzeile, NIE ein fremdes Logo.',
        response: {
          200: LoeschenResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const geloescht = await app.db.transaction(async (tx) => {
        const weg = await tx.delete(belegLogo).returning({ format: belegLogo.format });
        if (weg.length > 0) {
          await tx.insert(auditLog).values({
            eventType: 'beleg_logo.geloescht',
            actorUserId: req.actor.id,
            deviceId: req.deviceId ?? null,
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent'] ?? null,
            payload: { vorherigesFormat: weg[0]!.format },
          });
        }
        return weg.length > 0;
      });

      return reply.status(200).send({ geloescht });
    },
  );
};

export default belegLogoRoute;
