/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Herstellercode — Aufgabe und Antwort (Motorseite)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   GET  /api/auth/meister/aufgabe    — eine frische Aufgabe für dieses Gerät
 *   POST /api/auth/meister/einloesen  — Antwort prüfen, Kassencode neu setzen
 *
 * Die Abwägung und das Verfahren stehen in
 * `packages/auth-pin/src/meisterschluessel.ts`. Hier nur die Motor-Seite:
 *
 *   • NUR AM GEPAARTEN GERÄT (req.deviceId aus dem mTLS-Vorlauf). Aus dem
 *     Netz ist der Weg unerreichbar — dieselbe Bindung wie beim
 *     Notfallschlüssel.
 *   • DIE AUFGABE LEBT IM SPEICHER, 30 Minuten, eine je Gerät. Ein Neustart
 *     des Motors verwirft sie; der Händler fordert dann eine neue an. Das
 *     ist kein Mangel: eine Nottür braucht kein Gedächtnis, sie braucht
 *     Frische.
 *   • JEDE Prüfung — auch der Fehlschlag — steht im Tagebuch. Eine
 *     eingelöste Antwort schlägt zusätzlich auf der Aufsicht auf.
 */

import { randomInt } from 'node:crypto';
import { type Static, Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import {
  type Aufgabe,
  antwortStimmt,
  aufgabeAlsText,
  erzeugeAufgabe,
} from '@norns/auth-pin';
import { auditLog } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { UnauthorizedError } from '../lib/auth-policy.js';
import { setzeKassencodeNeu } from '../lib/kassencode-neusetzen.js';
import { findeInhaberFuerGeraet } from '../lib/rettungswege.js';

const AufgabeAntwort = Type.Object({
  aufgabe: Type.String(),
  gueltigBis: Type.String({ format: 'date-time' }),
});

const EinloesenKoerper = Type.Object({
  antwort: Type.String({ minLength: 40, maxLength: 200 }),
  neuerCode: Type.String({ minLength: 6, maxLength: 6 }),
});

const EinloesenAntwort = Type.Object({ ok: Type.Literal(true) });

const meisterRoutes: FastifyPluginAsync<{ env: Env }> = async (app) => {
  /**
   * Die offene Aufgabe je Gerät. Bewusst im Speicher: kurzlebig, an EINE
   * Kasse gebunden, und nach Gebrauch sofort fort.
   */
  const offene = new Map<string, Aufgabe>();

  app.get(
    '/api/auth/meister/aufgabe',
    {
      schema: {
        tags: ['auth'],
        summary: 'Aufgabe für einen Herstellercode anfordern (gepaartes Gerät)',
        response: { 200: AufgabeAntwort },
      },
    },
    async (req) => {
      if (!req.deviceId) throw new UnauthorizedError('Nur am gepaarten Gerät.');
      const jetzt = Date.now();
      // randomInt statt Math.random: die Aufgabe ist Sicherheitsmaterial.
      const a = erzeugeAufgabe(req.deviceId, jetzt, () => randomInt(0, 2 ** 32) / 2 ** 32);
      offene.set(req.deviceId, a);
      await app.db.insert(auditLog).values({
        eventType: 'meister.aufgabe_angefordert',
        actorUserId: null,
        deviceId: req.deviceId,
        ipAddress: req.ip || null,
        payload: { aufgabe: aufgabeAlsText(a) },
      });
      return { aufgabe: aufgabeAlsText(a), gueltigBis: new Date(a.gueltigBis).toISOString() };
    },
  );

  app.post(
    '/api/auth/meister/einloesen',
    {
      schema: {
        tags: ['auth'],
        summary: 'Herstellercode einlösen: neuen Kassencode setzen',
        body: EinloesenKoerper,
        response: { 200: EinloesenAntwort },
      },
    },
    async (req) => {
      const { antwort, neuerCode } = req.body as Static<typeof EinloesenKoerper>;
      const ip = req.ip || null;
      const abgelehnt = (): never => {
        throw new UnauthorizedError('Die Antwort stimmt nicht.');
      };

      if (req.deviceId === null) abgelehnt();
      const geraet = req.deviceId as string;
      const aufgabe = offene.get(geraet);
      const jetzt = Date.now();

      const stimmt =
        aufgabe !== undefined &&
        antwortStimmt(
          aufgabe,
          antwort,
          jetzt,
          // Für die Probe austauschbar; im Betrieb der eingebaute Schlüssel.
          process.env['NORNS_MEISTER_SPKI'] || undefined,
        );

      if (!stimmt) {
        await app.db.insert(auditLog).values({
          eventType: 'meister.fehlversuch',
          actorUserId: null,
          deviceId: geraet,
          ipAddress: ip,
          payload: { aufgabeVorhanden: aufgabe !== undefined },
        });
        abgelehnt();
      }
      // ⚠️ VERBRAUCHT, bevor irgendetwas anderes passiert: auch wenn der neue
      // Code unten abgelehnt wird, gilt dieselbe Antwort kein zweites Mal.
      offene.delete(geraet);

      const inhaber = await findeInhaberFuerGeraet(app, geraet);
      if (!inhaber) abgelehnt();

      // Das gemeinsame Herz aller Notausgaenge: Codepruefung, Abdruck,
      // PIN-Spalten, Tagebuch, Alarm — an EINEM Ort.
      await setzeKassencodeNeu(app, {
        userId: (inhaber as { id: string }).id,
        neuerCode,
        deviceId: geraet,
        ip,
        tagebuchArt: 'meister.eingeloest',
        alarmArt: 'alert.meistercode',
      });

      return { ok: true as const };
    },
  );
};

export default meisterRoutes;
