/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Rettungsstick — Motorseite
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   GET  /api/auth/rettungsstick/laufwerke  — Sticks sehen (gepaartes Gerät)
 *   POST /api/auth/rettungsstick/schreiben  — Stick beschreiben (Inhaber + Code)
 *   POST /api/auth/rettungsstick/einloesen  — Kassencode neu setzen, Stick lädt nach
 *
 * Abwägung und Format wohnen in `packages/auth-pin/src/rettungsstick.ts`;
 * das gemeinsame Neusetzen in `lib/kassencode-neusetzen.ts`. Hier nur, was
 * WIRKLICH Motorseite ist:
 *
 *   • ⚠️ DIESE WEGE EXISTIEREN NUR IN DER KASSE. Der Beiläufer setzt
 *     `NORNS_LOKALE_KASSE=1`; ohne die Flagge (Wolke!) antworten sie 404,
 *     als wären sie nie gebaut. Ein Wolkenserver hat keine Laufwerke, und
 *     ein Weg, der dort „nur Fehler wirft", wäre trotzdem ein Weg.
 *   • ⚠️ GESCHRIEBEN WIRD NUR AUF EIN LAUFWERK AUS DER EIGENEN LISTE
 *     (`istErlaubtesLaufwerk`). Der Pfad kommt von der Fläche — ohne diesen
 *     Riegel wäre das ein Schreibrecht an beliebiger Stelle der Platte.
 *   • Der Stick wird NICHT formatiert (Begründung im Paket): ein Ordner
 *     `NORNS-RETTUNG/`, sonst bleibt der Stick, was er war.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Static, Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  PIN_FAILED_THRESHOLD,
  PIN_LOCKOUT_MINUTES,
  STICK_DATEI,
  STICK_ORDNER,
  alsGeheimnis,
  decideAttemptOutcome,
  leseStickDatei,
  stickAbdruck,
  stickDateiInhalt,
  stickStimmt,
} from '@norns/auth-pin';
import { auditLog, users } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import {
  PinLockedError,
  UnauthorizedError,
  requireOwnerStepUp,
} from '../lib/auth-policy.js';
import { setzeKassencodeNeu } from '../lib/kassencode-neusetzen.js';
import {
  findeInhaberFuerGeraet,
  istErlaubtesLaufwerk,
  listeLaufwerke,
} from '../lib/rettungswege.js';

const LaufwerkeAntwort = Type.Object({
  laufwerke: Type.Array(
    Type.Object({
      pfad: Type.String(),
      name: Type.String(),
      /** Liegt schon ein Rettungsschlüssel darauf? */
      traegtSchluessel: Type.Boolean(),
    }),
  ),
});

const SchreibenKoerper = Type.Object({ laufwerk: Type.String({ minLength: 1, maxLength: 512 }) });
const SchreibenAntwort = Type.Object({
  ok: Type.Literal(true),
  gesetztAm: Type.String({ format: 'date-time' }),
});

const EinloesenKoerper = Type.Object({
  laufwerk: Type.String({ minLength: 1, maxLength: 512 }),
  neuerCode: Type.String({ minLength: 6, maxLength: 6 }),
});
const EinloesenAntwort = Type.Object({
  ok: Type.Literal(true),
  /** Konnte das Nachfolge-Geheimnis auf den Stick? Sonst gilt er nicht mehr. */
  stickNachgeladen: Type.Boolean(),
});

/** Das frische Geheimnis auf den Stick schreiben — erst Beidatei, dann Umbenennen. */
async function schreibeStick(laufwerk: string, geheimnis: string): Promise<void> {
  const ordner = join(laufwerk, STICK_ORDNER);
  await mkdir(ordner, { recursive: true });
  const ziel = join(ordner, STICK_DATEI);
  const beidatei = join(ordner, `${STICK_DATEI}.neu`);
  await writeFile(beidatei, stickDateiInhalt(geheimnis, new Date().toISOString()), 'utf8');
  // rename ist auf demselben Datenträger unteilbar: der Stick trägt immer
  // ENTWEDER das alte ODER das neue Geheimnis, nie eine halbe Datei.
  await rename(beidatei, ziel);
}

const rettungsstickRoutes: FastifyPluginAsync<{ env: Env }> = async (app) => {
  /*
   * ⚠️ Die Flagge wird EINMAL beim Anmelden gelesen, nicht je Anfrage: sie
   * ist Bauart der Umgebung (Kasse gegen Wolke), kein Laufzeitzustand.
   */
  if (process.env['NORNS_LOKALE_KASSE'] !== '1') return;

  app.get(
    '/api/auth/rettungsstick/laufwerke',
    {
      schema: {
        tags: ['auth'],
        summary: 'Wechseldatenträger dieses Rechners (gepaartes Gerät)',
        response: { 200: LaufwerkeAntwort },
      },
    },
    async (req) => {
      if (req.deviceId === null) throw new UnauthorizedError('Nur am gepaarten Gerät.');
      const laufwerke = await listeLaufwerke();
      const raus = [];
      for (const l of laufwerke) {
        let traegt = false;
        try {
          const roh = await readFile(join(l.pfad, STICK_ORDNER, STICK_DATEI), 'utf8');
          traegt = leseStickDatei(roh) !== null;
        } catch {
          // kein Ordner, keine Datei — dann traegt er eben keinen.
        }
        raus.push({ pfad: l.pfad, name: l.name, traegtSchluessel: traegt });
      }
      return { laufwerke: raus };
    },
  );

  app.post(
    '/api/auth/rettungsstick/schreiben',
    {
      schema: {
        tags: ['auth'],
        summary: 'Rettungsstick beschreiben (Inhaber, frische Zwischenprüfung)',
        body: SchreibenKoerper,
        response: { 200: SchreibenAntwort },
      },
    },
    async (req) => {
      requireOwnerStepUp(req);
      const { laufwerk } = req.body as Static<typeof SchreibenKoerper>;
      if (!(await istErlaubtesLaufwerk(laufwerk))) {
        throw new UnauthorizedError('Dieses Laufwerk gibt es nicht.');
      }

      const geheimnis = alsGeheimnis(randomBytes(32));
      const abdruck = await stickAbdruck(geheimnis);
      const jetzt = new Date();

      /*
       * ⚠️ ERST der Stick, DANN die Datenbank. Scheitert der Stick, ist
       * nichts passiert. Scheitert die Datenbank danach, trägt der Stick ein
       * Geheimnis ohne Abdruck — er gilt schlicht nicht, und der Inhaber
       * schreibt ihn neu. Umgekehrt wäre es ein Abdruck ohne Stick: eine Tür,
       * deren Schlüssel nie existiert hat.
       */
      await schreibeStick(laufwerk, geheimnis);

      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            rettungsstickHash: abdruck,
            rettungsstickGesetztAm: jetzt,
            rettungsstickFehlversuche: 0,
            rettungsstickGesperrtBis: null,
          })
          .where(eq(users.id, req.actor.id));
        await tx.insert(auditLog).values({
          eventType: 'rettungsstick.beschrieben',
          actorUserId: req.actor.id,
          deviceId: req.deviceId,
          ipAddress: req.ip || null,
          // ⚠️ NIE das Geheimnis — nur wohin geschrieben wurde.
          payload: { laufwerk, at: jetzt.toISOString() },
        });
      });

      return { ok: true as const, gesetztAm: jetzt.toISOString() };
    },
  );

  app.post(
    '/api/auth/rettungsstick/einloesen',
    {
      schema: {
        tags: ['auth'],
        summary: 'Mit dem Rettungsstick einen neuen Kassencode setzen',
        body: EinloesenKoerper,
        response: { 200: EinloesenAntwort },
      },
    },
    async (req) => {
      const { laufwerk, neuerCode } = req.body as Static<typeof EinloesenKoerper>;
      const ip = req.ip || null;
      const abgelehnt = (): never => {
        throw new UnauthorizedError('Auf diesem Stick liegt kein gültiger Rettungsschlüssel.');
      };

      if (req.deviceId === null) abgelehnt();
      const geraet = req.deviceId as string;
      if (!(await istErlaubtesLaufwerk(laufwerk))) abgelehnt();

      const inhaber = await findeInhaberFuerGeraet(app, geraet);
      if (!inhaber) abgelehnt();
      const inhaberId = (inhaber as { id: string }).id;

      const zeile = await app.db
        .select({
          hash: users.rettungsstickHash,
          fehlversuche: users.rettungsstickFehlversuche,
          gesperrtBis: users.rettungsstickGesperrtBis,
        })
        .from(users)
        .where(eq(users.id, inhaberId))
        .limit(1);
      const stand = zeile[0];
      const jetzt = new Date();

      if (stand?.gesperrtBis && stand.gesperrtBis > jetzt) {
        throw new PinLockedError(stand.gesperrtBis);
      }

      // Stick lesen. Eine kaputte oder fremde Datei ist KEIN Sonderfall —
      // sie ist ein falsches Geheimnis und zählt als Fehlversuch.
      let geheimnis: string | null = null;
      try {
        const roh = await readFile(join(laufwerk, STICK_ORDNER, STICK_DATEI), 'utf8');
        geheimnis = leseStickDatei(roh)?.geheimnis ?? null;
      } catch {
        geheimnis = null;
      }

      const stimmt =
        stand?.hash != null && geheimnis !== null && (await stickStimmt(geheimnis, stand.hash));

      const ausgang = decideAttemptOutcome({
        state: {
          failedAttempts: stand?.fehlversuche ?? 0,
          lockedUntil: stand?.gesperrtBis ?? null,
        },
        now: jetzt,
        pinCorrect: stimmt,
      });
      if (ausgang.kind === 'already_locked') throw new PinLockedError(ausgang.until);

      if (ausgang.kind !== 'success') {
        await app.db
          .update(users)
          .set({
            rettungsstickFehlversuche: ausgang.newState.failedAttempts,
            rettungsstickGesperrtBis: ausgang.newState.lockedUntil,
          })
          .where(eq(users.id, inhaberId));
        await app.db.insert(auditLog).values({
          eventType:
            ausgang.kind === 'failed_now_locked'
              ? 'rettungsstick.gesperrt'
              : 'rettungsstick.fehlversuch',
          actorUserId: inhaberId,
          deviceId: geraet,
          ipAddress: ip,
          payload: {
            fehlversuche: ausgang.newState.failedAttempts,
            schwelle: PIN_FAILED_THRESHOLD,
            sperrminuten: PIN_LOCKOUT_MINUTES,
          },
        });
        abgelehnt();
      }

      /*
       * ── DAS NACHLADEN ────────────────────────────────────────────────────
       *
       * Das eingelöste Geheimnis ist verbraucht. ERST kommt das frische auf
       * den Stick, DANN schreibt die Datenbank Code + neuen Abdruck in EINER
       * Transaktion. Scheitert der Stick, brechen wir ab, BEVOR sich etwas
       * ändert — der alte Stick gilt weiter, der Händler versucht es neu.
       * Scheitert die Datenbank nach dem Stick, trägt der Stick ein Geheimnis
       * ohne Abdruck: der alte Abdruck steht noch, aber das alte Geheimnis
       * ist überschrieben — der Stick ist dann tot, und GENAU DAS meldet die
       * Antwort (`stickNachgeladen`), samt dem Weg: unter Team neu schreiben.
       */
      const nachfolger = alsGeheimnis(randomBytes(32));
      let stickNachgeladen = true;
      try {
        await schreibeStick(laufwerk, nachfolger);
      } catch {
        stickNachgeladen = false;
      }
      const nachfolgerAbdruck = stickNachgeladen ? await stickAbdruck(nachfolger) : null;

      await setzeKassencodeNeu(app, {
        userId: inhaberId,
        neuerCode,
        deviceId: geraet,
        ip,
        tagebuchArt: 'rettungsstick.eingeloest',
        alarmArt: 'alert.rettungsstick',
        zusatz: async (tx) => {
          await tx
            .update(users)
            .set(
              nachfolgerAbdruck !== null
                ? {
                    rettungsstickHash: nachfolgerAbdruck,
                    rettungsstickGesetztAm: jetzt,
                    rettungsstickGebrauchtAm: jetzt,
                    rettungsstickFehlversuche: 0,
                    rettungsstickGesperrtBis: null,
                  }
                : {
                    // Stick nicht nachladbar: der alte Abdruck fällt, damit
                    // kein Abdruck auf ein überschriebenes Geheimnis zeigt.
                    rettungsstickHash: null,
                    rettungsstickGesetztAm: null,
                    rettungsstickGebrauchtAm: jetzt,
                    rettungsstickFehlversuche: 0,
                    rettungsstickGesperrtBis: null,
                  },
            )
            .where(eq(users.id, inhaberId));
        },
      });

      return { ok: true as const, stickNachgeladen };
    },
  );
};

export default rettungsstickRoutes;
