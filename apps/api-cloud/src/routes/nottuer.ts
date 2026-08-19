/**
 * Die Nottür — EINE Anmeldung, wenn Google selbst ausfällt.
 *
 * ── WARUM ES SIE GIBT (27.07.2026) ───────────────────────────────────────
 * Basels Google-Cloud-Projekt wurde gelöscht. Mit ihm verschwanden die Marke
 * (der Zustimmungsbildschirm) und alle sechs OAuth-Klienten. Projekt und
 * Klienten liessen sich wiederherstellen, die Marke nicht — und ohne Marke
 * antwortet Google auf JEDEN Klienten mit `deleted_client`. Gemessen am
 * lebenden Server, mehrfach, über Stunden.
 *
 * Die Kasse liess sich damit von NIEMANDEM mehr betreten: die Identität ist
 * seit dem 21.07. ausschliesslich Google, der PIN-Weg ist aus dem
 * Produktionsbau entfernt. Ein Laden ohne Zugang zu seiner eigenen Kasse.
 *
 * ── WARUM SIE SO UND NICHT ANDERS GEBAUT IST ─────────────────────────────
 * Basel bat darum, „die Prüfung abzuschalten, bis Google zurückkommt". Das
 * wäre ein Kassensystem mit Kundendaten und Fiskalspur ohne Tür gewesen —
 * und es hätte GENAU DENSELBEN Eingriff am Server gekostet wie diese Tür
 * hier. Gleicher Aufwand, ungleich schlechteres Ergebnis. Also eine Tür mit
 * Schlüssel statt gar keine Tür:
 *
 *   1. OHNE `NOTZUGANG_SCHLUESSEL` EXISTIERT DER WEG NICHT. Kein 401, kein
 *      403 — ein 404, als wäre er nie gebaut. Das ist die Vorgabe, und damit
 *      der Zustand jedes künftigen Mandanten. Niemand erbt eine offene Tür.
 *   2. Der Schlüssel wird in KONSTANTER ZEIT verglichen (`timingSafeEqual`),
 *      und er muss mindestens 32 Zeichen tragen.
 *   3. Sie legt KEIN Konto an und ändert KEINE Rolle. Sie meldet ein Konto
 *      an, das ohnehin schon Inhaber ist. Wer nicht schon drin war, kommt
 *      auch hier nicht hinein.
 *   4. Jede Benutzung — auch jeder FEHLVERSUCH — schreibt einen lauten
 *      Eintrag ins Tagebuch, mit Adresse und Browserkennung.
 *   5. Die Sitzung ist ABSICHTLICH kurz (zwei Stunden statt der üblichen
 *      Inhaberdauer). Eine Nottür ist kein Wohnzimmer.
 *   6. Das Rückziel läuft durch DIESELBE Prüfung wie der Google-Weg, damit
 *      hier keine offene Weiterleitung entsteht.
 *
 * ── UND WARUM DIE KASSE DAFÜR NICHT NEU GEBAUT WERDEN MUSS ───────────────
 * Der Weg antwortet mit genau derselben Weiterleitung wie der Google-Rückweg:
 * das Zeichen steht im Fragment hinter `#`. Die Kasse hört auf diesem Weg
 * bereits — sie merkt nicht, dass diesmal kein Google dahinterstand.
 *
 * ── WIEDER ZUMACHEN ──────────────────────────────────────────────────────
 * `NOTZUGANG_SCHLUESSEL` aus der Umgebung entfernen und den Dienst neu
 * starten. Der Weg ist dann wieder 404. Es bleibt nichts zurück ausser den
 * Tagebucheinträgen, und die sollen bleiben.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { auditLog, sessions, users } from '@norns/db/schema';

import type { Env } from '../config/env.js';

/** Zwei Stunden. Eine Nottür ist kein Wohnzimmer. */
const NOT_SITZUNG_MS = 2 * 60 * 60 * 1000;

/** Der kürzeste Schlüssel, den wir überhaupt annehmen. */
const MIN_SCHLUESSELLAENGE = 32;

/**
 * Gleich lang? Dann in konstanter Zeit vergleichen. Ungleich lang? Dann ist
 * die Antwort ohnehin nein, und die Länge ist kein Geheimnis.
 */
function schluesselStimmt(erwartet: string, gegeben: string): boolean {
  const a = Buffer.from(erwartet, 'utf8');
  const b = Buffer.from(gegeben, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Dasselbe Rückziel-Sieb wie im Google-Weg. Bewusst wortgleich gehalten:
 * eine Nottür, die eine offene Weiterleitung mitbringt, wäre schlimmer als
 * das Problem, das sie löst.
 */
function siebeRueckziel(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) return null;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (v.startsWith('warehouse14://')) return v;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/|$)/.test(v)) return v;
  return null;
}

/** Das Zeichen gehört ins Fragment, nie in die Abfrage: Fragmente stehen in keinem Zugriffsprotokoll. */
function mitFragment(ziel: string, werte: Record<string, string>): string {
  const frag = new URLSearchParams(werte).toString();
  return `${ziel}${ziel.includes('#') ? '&' : '#'}${frag}`;
}

const nottuerRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const { env } = opts;
  const schluessel = env.NOTZUGANG_SCHLUESSEL ?? '';

  // ── Die Tür existiert nur, wenn jemand sie ausdrücklich aufgeschlossen hat.
  // Ohne Schlüssel wird der Weg GAR NICHT REGISTRIERT: er ist dann ein 404
  // wie jeder erfundene Pfad, und kein Sondierer erfährt, dass es ihn gibt.
  if (schluessel.length < MIN_SCHLUESSELLAENGE) {
    if (schluessel.length > 0) {
      app.log.warn(
        { laenge: schluessel.length, mindestens: MIN_SCHLUESSELLAENGE },
        'NOTZUGANG_SCHLUESSEL ist zu kurz, die Nottuer bleibt geschlossen',
      );
    }
    return;
  }

  app.log.warn(
    'DIE NOTTUER IST OFFEN. Sie gehoert wieder zugemacht, sobald Google antwortet: ' +
      'NOTZUGANG_SCHLUESSEL aus der Umgebung entfernen und neu starten.',
  );

  app.get(
    '/api/admin/auth/nottuer',
    {
      schema: {
        tags: ['auth'],
        summary: 'Notfall-Anmeldung ohne Google (nur wenn NOTZUGANG_SCHLUESSEL gesetzt ist)',
        querystring: {
          type: 'object',
          properties: {
            schluessel: { type: 'string' },
            returnTo: { type: 'string' },
          },
          required: ['schluessel'],
        },
      },
    },
    async (
      req: FastifyRequest<{ Querystring: { schluessel?: string; returnTo?: string } }>,
      reply: FastifyReply,
    ) => {
      const ip = req.ip;
      const userAgent = req.headers['user-agent'] ?? null;
      const gegeben = req.query.schluessel ?? '';

      if (!schluesselStimmt(schluessel, gegeben)) {
        // Der Fehlversuch ist der interessantere Eintrag von beiden.
        await app.db.insert(auditLog).values({
          eventType: 'auth.nottuer_abgewiesen',
          actorUserId: null,
          deviceId: null,
          ipAddress: ip,
          userAgent,
          payload: { grund: 'schluessel_falsch' },
        });
        return reply
          .status(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Schlüssel stimmt nicht.' } });
      }

      // ── Das Konto SUCHEN, nicht anlegen. ────────────────────────────────
      // Die Nottür verschafft Zugang, sie verleiht keine Rechte. Wer nicht
      // schon Inhaber ist, kommt auch hier nicht hinein.
      const gesuchteMail = (env.NOTZUGANG_KONTO ?? '').trim();
      const zeilen = await app.db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          isOwner: users.isOwner,
        })
        .from(users)
        .where(
          gesuchteMail.length > 0
            ? and(eq(users.email, gesuchteMail), isNull(users.softDeletedAt))
            : and(eq(users.isOwner, true), isNull(users.softDeletedAt)),
        )
        .limit(1);

      const konto = zeilen[0];
      if (!konto || !konto.isOwner) {
        await app.db.insert(auditLog).values({
          eventType: 'auth.nottuer_abgewiesen',
          actorUserId: konto?.id ?? null,
          deviceId: null,
          ipAddress: ip,
          userAgent,
          payload: { grund: konto ? 'kein_inhaber' : 'konto_nicht_gefunden', gesucht: gesuchteMail },
        });
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: gesuchteMail
              ? `Kein aktives Inhaberkonto für ${gesuchteMail}.`
              : 'Kein aktives Inhaberkonto gefunden.',
          },
        });
      }

      // ── Sitzung prägen: dieselbe Gestalt wie auf jedem anderen Weg, nur kürzer.
      const sitzungId = randomUUID();
      const zeichen = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const laeuftAb = new Date(Date.now() + NOT_SITZUNG_MS);

      await app.db.transaction(async (tx) => {
        await tx.insert(sessions).values({
          id: sitzungId,
          userId: konto.id,
          token: zeichen,
          expiresAt: laeuftAb,
          ipAddress: ip,
          userAgent,
          deviceId: null,
          // KEIN `lastPinStepUpAt`: die Nottür schenkt kein Stufenrecht.
          // Storno, Steuerexport und Z-Bon verlangen den Gerätecode weiterhin.
        });
        await tx.insert(auditLog).values({
          eventType: 'auth.nottuer_benutzt',
          actorUserId: konto.id,
          deviceId: null,
          ipAddress: ip,
          userAgent,
          payload: {
            email: konto.email,
            role: konto.role,
            grund: 'google_ausfall',
            sitzungBis: laeuftAb.toISOString(),
          },
        });
      });

      const ziel = siebeRueckziel(req.query.returnTo);
      if (ziel) {
        return reply.redirect(
          mitFragment(ziel, { token: zeichen, expiresAt: laeuftAb.toISOString() }),
          302,
        );
      }

      return reply.send({
        ok: true as const,
        hinweis:
          'Notfall-Anmeldung. Diese Sitzung läuft in zwei Stunden ab. Bitte die Nottür schliessen, ' +
          'sobald Google wieder antwortet.',
        sessionExpiresAt: laeuftAb.toISOString(),
        actor: { id: konto.id, role: konto.role, isOwner: konto.isOwner },
        token: zeichen,
      });
    },
  );
};

export default nottuerRoutes;
