/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Notfallschlüssel — der Weg zurück in eine verschlossene Kasse
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   GET  /api/auth/notfallschluessel/stand      — gibt es einen, seit wann
 *   POST /api/auth/notfallschluessel/erzeugen   — einen neuen ausgeben
 *   POST /api/auth/notfallschluessel/einloesen  — Kassencode neu setzen
 *
 * ── DER BEFUND VOM 20.08.2026 ──────────────────────────────────────────────
 *
 * Der Rückweg gab es nur für MITARBEITER: der Inhaber löscht ihren Code, sie
 * setzen am Tresen einen neuen. Für den Inhaber SELBST gab es dieses Tor
 * nicht — er müsste sich anmelden, um sich zurückzusetzen. Vergisst er seinen
 * Code, kommt NIEMAND mehr hinein, auch kein zweiter Verwalter. Der Weg
 * zurück führte über die Datenbank, also über einen Techniker, an einem
 * Samstagvormittag mit Kunden im Laden.
 *
 * ── EIGENE DATEI, UND WARUM ────────────────────────────────────────────────
 *
 * `auth-pin.ts` trägt 1059 Zeilen. Basel, mehrfach: „nicht die Welt
 * ineinanderstopfen." Der Notausgang ist ein eigener Vorgang mit eigener
 * Abwägung — er gehört neben den Kassencode, nicht hinein.
 *
 * ── DIE ABWÄGUNG, DIE JEDE ZEILE HIER FORMT ────────────────────────────────
 *
 * ⚠️ Ein Notfallschlüssel ist ein ZWEITES Geheimnis, das die Kasse öffnet. Wo
 * so etwas in der Praxis landet — ein Zettel neben der Kasse —, schwächt es
 * genau die Bedienerzuordnung nach § 146a AO, die der Kassencode schützt.
 * Deshalb ist er bewusst SCHWÄCHER gebaut:
 *
 *   1. ER MELDET NICHT AN. `einloesen` gibt KEINE Sitzung zurück, nur die
 *      Erlaubnis, einen neuen Kassencode zu setzen. Wer den Zettel findet,
 *      kann damit nichts buchen — er muss erst einen Code setzen, und das
 *      steht danach im Tagebuch.
 *   2. ER GILT EINMAL. Nach dem Einlösen ist der Abdruck fort.
 *   3. ER SCHREIBT INS TAGEBUCH und schlägt auf der Aufsicht auf.
 *   4. NUR AM GEPAARTEN GERÄT. Aus dem Netz ist dieser Weg nicht erreichbar.
 *   5. NUR FÜR DEN INHABER. Für Mitarbeiter gibt es den Löschweg, und der
 *      ist besser: dort kennt niemand den Code eines anderen.
 */

import { type Static, Type } from '@sinclair/typebox';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  PIN_FAILED_THRESHOLD,
  PIN_LOCKOUT_MINUTES,
  decideAttemptOutcome,
  erzeugeNotfallschluessel,
  schluesselAbdruck,
  schluesselFormStimmt,
  schluesselStimmt,
} from '@norns/auth-pin';
import { auditLog, devices, users } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import {
  PinLockedError,
  UnauthorizedError,
  requireOwner,
  requireOwnerStepUp,
} from '../lib/auth-policy.js';
import { setzeKassencodeNeu } from '../lib/kassencode-neusetzen.js';

// ────────────────────────────────────────────────────────────────────────
//  Formen
// ────────────────────────────────────────────────────────────────────────

const StandAntwort = Type.Object({
  vorhanden: Type.Boolean(),
  gesetztAm: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  gebrauchtAm: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

const ErzeugenAntwort = Type.Object({
  /**
   * ⚠️ DAS EINZIGE MAL, dass der Klartext den Rechner verlässt. Gespeichert
   * wird nur sein Abdruck; wer ihn hier nicht notiert, bekommt ihn nie wieder
   * — er muss dann einen neuen erzeugen.
   */
  schluessel: Type.String(),
  gesetztAm: Type.String({ format: 'date-time' }),
});

const EinloesenKoerper = Type.Object({
  schluessel: Type.String({ minLength: 1, maxLength: 64 }),
  neuerCode: Type.String({ minLength: 6, maxLength: 6 }),
  /** Wessen Code, falls das Gerät auf jemand anderen gepaart ist. */
  userId: Type.Optional(Type.String({ format: 'uuid' })),
});

const EinloesenAntwort = Type.Object({
  ok: Type.Literal(true),
  /** Der frische Schlüssel, der den verbrauchten ersetzt — wieder EINMAL. */
  neuerSchluessel: Type.String(),
});

interface Schluesselstand {
  id: string;
  isOwner: boolean;
  notfallschluesselHash: string | null;
  notfallschluesselFehlversuche: number;
  notfallschluesselGesperrtBis: Date | null;
}

/**
 * Wessen Schlüssel wird hier eingelöst?
 *
 * ⚠️ Gibt IMMER eine Kennung zurück, wenn das Gerät gepaart ist — auch wenn
 * dieser Mensch gar keinen Schlüssel hat. Ein `null` an dieser Stelle wäre ein
 * Orakel: der Aufrufer erführe aus der Antwortzeit, wer einen Schlüssel
 * besitzt und wer nicht. Die Prüfung geschieht weiter unten, mit gleicher
 * Arbeit für beide Fälle.
 */
async function findeZiel(
  app: FastifyInstance,
  deviceId: string | null,
  wunsch?: string | null,
): Promise<string | null> {
  if (!deviceId) return null;
  const geraet = await app.db
    .select({ pairedBy: devices.pairedByUserId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  const gepaart = geraet[0]?.pairedBy;
  if (!gepaart) return null;
  return wunsch ?? gepaart;
}

async function ladeStand(app: FastifyInstance, userId: string): Promise<Schluesselstand | null> {
  const rows = await app.db
    .select({
      id: users.id,
      isOwner: users.isOwner,
      notfallschluesselHash: users.notfallschluesselHash,
      notfallschluesselFehlversuche: users.notfallschluesselFehlversuche,
      notfallschluesselGesperrtBis: users.notfallschluesselGesperrtBis,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.softDeletedAt)))
    .limit(1);
  return (rows[0] as Schluesselstand | undefined) ?? null;
}

/**
 * Ein Abdruck, gegen den geprüft wird, wenn es gar keinen Schlüssel gibt.
 *
 * ⚠️ argon2id braucht spürbar Zeit. Ohne diesen Blindgänger antwortete die
 * Kasse einem Menschen OHNE Schlüssel sofort und einem MIT Schlüssel nach
 * einer Zehntelsekunde — und wer das misst, weiss, wo sich ein Angriff lohnt.
 */
let blindAbdruck: Promise<string> | undefined;
function blind(): Promise<string> {
  blindAbdruck ??= schluesselAbdruck('NORNS-AAAA-AAAA-AAAA-AAAA');
  return blindAbdruck;
}

const notfallschluesselRoutes: FastifyPluginAsync<{ env: Env }> = async (app) => {
  // ──────────────────────────────────────────────────────────────────────
  //  GET /stand — gibt es einen, seit wann. NIE der Schlüssel selbst.
  // ──────────────────────────────────────────────────────────────────────
  app.get(
    '/api/auth/notfallschluessel/stand',
    {
      schema: {
        tags: ['auth'],
        summary: 'Gibt es einen gültigen Notfallschlüssel, und seit wann',
        response: { 200: StandAntwort },
      },
    },
    async (req) => {
      requireOwner(req);
      const rows = await app.db
        .select({
          hash: users.notfallschluesselHash,
          gesetztAm: users.notfallschluesselGesetztAm,
          gebrauchtAm: users.notfallschluesselGebrauchtAm,
        })
        .from(users)
        .where(eq(users.id, req.actor.id))
        .limit(1);
      const r = rows[0];
      return {
        vorhanden: Boolean(r?.hash),
        gesetztAm: r?.gesetztAm ? r.gesetztAm.toISOString() : null,
        gebrauchtAm: r?.gebrauchtAm ? r.gebrauchtAm.toISOString() : null,
      };
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  //  POST /erzeugen — einen neuen ausgeben, genau einmal sichtbar
  //
  // ⚠️ MIT Zwischenprüfung (`requireOwnerStepUp`): der Kassencode wird hier
  // noch einmal verlangt. Sonst genügte ein unbeaufsichtigter Bildschirm, um
  // sich einen Zweitschlüssel zur Kasse auszustellen.
  // ──────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/notfallschluessel/erzeugen',
    {
      schema: {
        tags: ['auth'],
        summary: 'Einen neuen Notfallschlüssel ausgeben (Klartext genau einmal)',
        response: { 200: ErzeugenAntwort },
      },
    },
    async (req) => {
      requireOwnerStepUp(req);
      const schluessel = erzeugeNotfallschluessel();
      const abdruck = await schluesselAbdruck(schluessel);
      const jetzt = new Date();

      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            notfallschluesselHash: abdruck,
            notfallschluesselGesetztAm: jetzt,
            notfallschluesselFehlversuche: 0,
            notfallschluesselGesperrtBis: null,
          })
          .where(eq(users.id, req.actor.id));
        await tx.insert(auditLog).values({
          eventType: 'notfallschluessel.erzeugt',
          actorUserId: req.actor.id,
          deviceId: req.deviceId,
          ipAddress: req.ip || null,
          // ⚠️ Der Klartext steht hier NICHT. Ein Tagebuch, das den Schlüssel
          // trägt, wäre die zweite Kopie, die es nicht geben darf.
          payload: { at: jetzt.toISOString() },
        });
      });

      return { schluessel, gesetztAm: jetzt.toISOString() };
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  //  POST /einloesen — den Kassencode neu setzen, ohne Anmeldung
  // ──────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/notfallschluessel/einloesen',
    {
      schema: {
        tags: ['auth'],
        summary: 'Mit dem Notfallschlüssel einen neuen Kassencode setzen',
        body: EinloesenKoerper,
        response: { 200: EinloesenAntwort },
      },
    },
    async (req) => {
      const { schluessel, neuerCode, userId } = req.body as Static<typeof EinloesenKoerper>;
      const ip = req.ip || null;

      /*
       * ⚠️ EINE EINZIGE Fehlermeldung für jeden Fehlschlag: falsches Gerät,
       * unbekannter Mensch, kein Schlüssel gesetzt, falscher Schlüssel. Jede
       * feinere Auskunft wäre ein Orakel darüber, wo sich der nächste Versuch
       * lohnt. Der Händler, der seinen eigenen Zettel abtippt, liest denselben
       * Satz — aber er tippt ihn richtig ab.
       */
      function abgelehnt(): never {
        throw new UnauthorizedError('Der Notfallschlüssel stimmt nicht.');
      }

      const zielId = await findeZiel(app, req.deviceId, userId);
      if (zielId === null) abgelehnt();

      const stand = await ladeStand(app, zielId);
      const jetzt = new Date();

      // Sperre zuerst — sie gilt, bevor überhaupt ein Zeichen geprüft wird.
      if (stand?.notfallschluesselGesperrtBis && stand.notfallschluesselGesperrtBis > jetzt) {
        throw new PinLockedError(stand.notfallschluesselGesperrtBis);
      }

      /*
       * ⚠️ Die Prüfung läuft IMMER, mit demselben Aufwand — auch wenn es
       * keinen Schlüssel gibt, der Mensch kein Inhaber ist oder die Form gar
       * nicht stimmt. Ein früher Ausstieg wäre an der Antwortzeit messbar.
       */
      const ziel = stand?.isOwner === true ? stand.notfallschluesselHash : null;
      const stimmt =
        (await schluesselStimmt(schluessel, ziel ?? (await blind()))) &&
        ziel !== null &&
        schluesselFormStimmt(schluessel);

      const ausgang = decideAttemptOutcome({
        state: {
          failedAttempts: stand?.notfallschluesselFehlversuche ?? 0,
          lockedUntil: stand?.notfallschluesselGesperrtBis ?? null,
        },
        now: jetzt,
        pinCorrect: stimmt,
      });

      /*
       * ⚠️ Die Sperre wird oben schon geprüft — hier steht sie ein ZWEITES
       * Mal, und das ist kein Versehen. Zwei Anfragen im selben Augenblick
       * lesen denselben Stand; ohne diesen Zweig führe die zweite an der
       * eben gesetzten Sperre vorbei. Der Typprüfer hat danach gefragt, der
       * Wettlauf beantwortet die Frage.
       */
      if (ausgang.kind === 'already_locked') {
        throw new PinLockedError(ausgang.until);
      }

      if (ausgang.kind !== 'success') {
        if (stand) {
          await app.db
            .update(users)
            .set({
              notfallschluesselFehlversuche: ausgang.newState.failedAttempts,
              notfallschluesselGesperrtBis: ausgang.newState.lockedUntil,
            })
            .where(eq(users.id, stand.id));
          await app.db.insert(auditLog).values({
            eventType:
              ausgang.kind === 'failed_now_locked'
                ? 'notfallschluessel.gesperrt'
                : 'notfallschluessel.fehlversuch',
            actorUserId: stand.id,
            deviceId: req.deviceId,
            ipAddress: ip,
            payload: {
              fehlversuche: ausgang.newState.failedAttempts,
              schwelle: PIN_FAILED_THRESHOLD,
              sperrminuten: PIN_LOCKOUT_MINUTES,
            },
          });
        }
        abgelehnt();
      }

      // Erst hier ist der Schlüssel echt. `stand` kann nicht null sein — ohne
      // Zeile gäbe es keinen Abdruck, gegen den er hätte stimmen können.
      const treffer = stand as Schluesselstand;

      // Der verbrauchte Schlüssel geht, ein frischer kommt — in EINEM Zug,
      // damit die Kasse nie einen Augenblick ohne Rückweg dasteht.
      const nachfolger = erzeugeNotfallschluessel();
      const nachfolgerAbdruck = await schluesselAbdruck(nachfolger);

      /*
       * 21.08.2026: Codeprüfung, Abdruck, PIN-Spalten, Tagebuch und Alarm
       * wohnen seit dem Rettungsstick im gemeinsamen Herzen
       * (`lib/kassencode-neusetzen.ts`) — drei Türen, EINE Abschrift. Der
       * Nachfolge-Abdruck reist als `zusatz` in derselben Transaktion mit.
       */
      await setzeKassencodeNeu(app, {
        userId: treffer.id,
        neuerCode,
        deviceId: req.deviceId,
        ip,
        tagebuchArt: 'notfallschluessel.eingeloest',
        alarmArt: 'alert.notfallschluessel',
        zusatz: async (tx) => {
          await tx
            .update(users)
            .set({
              notfallschluesselHash: nachfolgerAbdruck,
              notfallschluesselGesetztAm: jetzt,
              notfallschluesselGebrauchtAm: jetzt,
              notfallschluesselFehlversuche: 0,
              notfallschluesselGesperrtBis: null,
            })
            .where(eq(users.id, treffer.id));
        },
      });

      return { ok: true as const, neuerSchluessel: nachfolger };
    },
  );
};

export default notfallschluesselRoutes;
