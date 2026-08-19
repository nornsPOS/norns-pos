/**
 * POS PIN auth routes — Day 12b + Duress PIN (Decision #37).
 *
 *   POST /api/auth/pin-login       — start a session from a PIN on a paired device
 *   POST /api/auth/step-up         — refresh sessions.last_pin_step_up_at via PIN
 *   POST /api/auth/pin/set         — create or change the POS PIN (requires Full Login)
 *   POST /api/auth/duress-pin/set  — set the duress PIN (requires auth; distinct from POS PIN)
 *
 * All call into `@norns/auth-pin` for argon2id + the lockout state machine,
 * and emit `audit_log` rows for the observability surface in ADR-0022 §8.
 *
 * Duress discipline (Decision #37):
 *   • Login/step-up verify the PIN against BOTH the POS hash and the duress hash
 *     (constant work — a dummy hash is verified when no duress PIN is set, so the
 *     perceived latency is identical). A match against EITHER counts as correct,
 *     so a duress login NEVER ticks the lockout counter and gives no branch/timing
 *     hint to a coercing attacker.
 *   • A duress match logs in normally, then fires a SILENT alarm in the background
 *     (audit_log + `alert.duress` ledger event + optional webhook) — the response
 *     to the operator is byte-for-byte identical to a normal login.
 */

import { randomUUID } from 'node:crypto';
import { type Static, Type } from '@sinclair/typebox';
import { and, eq, isNotNull, isNull, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { emit } from '@norns/audit';
import {
  PIN_FAILED_THRESHOLD,
  PIN_LOCKOUT_MINUTES,
  PinPolicy,
  decideAttemptOutcome,
  hashPin,
  verifyPin,
} from '@norns/auth-pin';
import { auditLog, devices, sessions, users } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { ForbiddenError, PinLockedError, UnauthorizedError, requireAuth } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { sessionTtlMs } from '../lib/session-ttl.js';
import { type PinMatch, classifyPinAttempt } from '../lib/duress.js';

// ────────────────────────────────────────────────────────────────────────
// Shared schemas
// ────────────────────────────────────────────────────────────────────────

// ⚠️ ZWEI ANWEISUNGEN, DIE ZWEITE HEBT DIE ERSTE AUF.
//
// 30.07.2026: sechs bis zwoelf Ziffern, vom Haendler gewaehlt, nie vorgegeben.
// 18.08.2026: GENAU sechs, nicht mehr. Basel hat sich mit der Spanne selbst
// vertippt und verheddert; die feste Laenge macht die Eingabe eindeutig und
// die Maske kann beim sechsten Zeichen von selbst abschicken.
//
// NUR HIER, beim ANMELDEN, bleibt das Format 6 bis 12 GEDULDET: ein vor dem
// 18.08. gesetzter laengerer Code ist gespeicherter Zustand (argon2-Hash),
// und ein Schema-400 waere die haesslichste aller Antworten. Der Ausgang
// fuer solche Codes ist der Loeschweg (Team, kassencode-loeschen; der
// Inhaber selbst kommt per Google-Anmeldung hinein, die frischt den
// Step-up). NEUE Codes verlangt `PinSetBody` unten strikt mit genau sechs.
const PinBody = Type.Object({
  pin: Type.String({ minLength: 6, maxLength: 12, pattern: '^\\d{6,12}$' }),
  /**
   * WER sich anmeldet. Fehlt das Feld, bleibt es beim gepaarten Menschen —
   * das ganze bisherige Verhalten.
   *
   * Nötig, damit die Sperre am MENSCHEN hängt und nicht am Gerät. Der Wunsch
   * wird geprüft, nicht geglaubt; die Bedingungen stehen bei
   * `resolveCandidateUser`.
   */
  userId: Type.Optional(Type.String({ format: 'uuid' })),
});
type PinBody = Static<typeof PinBody>;

const PinLoginResponse = Type.Object({
  ok: Type.Literal(true),
  sessionExpiresAt: Type.String({ format: 'date-time' }),
  actor: Type.Object({
    id: Type.String({ format: 'uuid' }),
    role: Type.Union([Type.Literal('ADMIN'), Type.Literal('CASHIER'), Type.Literal('READONLY')]),
    isOwner: Type.Boolean(),
  }),
  // Who signed in, for the header profile. A PIN session carries the email only
  // (no Google name/picture). Optional so older clients ignore it; MUST be in the
  // schema or Fastify strips it from the serialized body.
  profile: Type.Optional(
    Type.Object({
      email: Type.String(),
      displayName: Type.Union([Type.String(), Type.Null()]),
      avatarUrl: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  // The session token, also carried as `Authorization: Bearer` by the Tauri
  // webview (Windows WebView2 drops the cross-site session cookie). MUST be in
  // the response schema or Fastify strips it from the serialized body.
  token: Type.String(),
});

const StepUpResponse = Type.Object({
  ok: Type.Literal(true),
  lastPinStepUpAt: Type.String({ format: 'date-time' }),
});

const PinSetBody = Type.Object({
  // 18.08.2026: GENAU sechs (Begruendung oben bei PinBody). Das Schema weist
  // jede andere Laenge ab, BEVOR die Route laeuft.
  newPin: Type.String({ minLength: 6, maxLength: 6, pattern: '^\\d{6}$' }),
  /**
   * FUER WEN, wenn keine Sitzung besteht.
   *
   * Nur wirksam, solange dieser Mensch KEINEN Code hat — siehe
   * `resolveErstanspruch`. Ein bestehender Code laesst sich damit nicht
   * ueberschreiben.
   */
  userId: Type.Optional(Type.String({ format: 'uuid' })),
});

const PinSetResponse = Type.Object({
  ok: Type.Literal(true),
  setAt: Type.String({ format: 'date-time' }),
});

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Wer meldet sich hier gerade an?
 *
 * ── DER FUND VOM 01.08.2026: DER ZWEITE MENSCH KONNTE NIE ─────────────────
 *
 * Diese Funktion las AUSSCHLIESSLICH `devices.paired_by_user_id`. Ein Geraet,
 * ein Mensch, fuer immer. Auf einer Norns-Kasse zeigt diese Spalte auf den bei
 * der Erstsaat angelegten Inhaber.
 *
 * Die Folge war nicht „unbequem", sondern strukturell: `POST /api/admin/staff`
 * legt Mitarbeiter an, die Team-Flaeche zeigt sie, und KEINER von ihnen konnte
 * sich je anmelden. Ihr vorgesehener Weg ist die Google-Anmeldung, und die gibt
 * es auf dieser Kasse nicht. Jede fiskalische Zeile trug denselben Menschen.
 * Bedienerzuordnung nach § 146a war damit nicht unfertig, sondern unmoeglich.
 *
 * ── WARUM DER WUNSCH GEPRUEFT WIRD, STATT GEGLAUBT ────────────────────────
 *
 * Der Klient darf jetzt sagen, WER er ist. Das ist noetig, damit die Sperre am
 * MENSCHEN haengt und nicht am Geraet: zehn Fehlversuche fuer A duerfen B
 * nicht aussperren. Wuerde man stattdessen den Code gegen alle Benutzer
 * pruefen, wuesste man bei einem falschen Code nicht, wessen Zaehler steigt.
 *
 * Zwei Bedingungen, und beide sind noetig:
 *
 *   1. Das Geraet muss gepaart sein. Ohne `deviceId` gibt es keinen Kandidaten,
 *      wie bisher.
 *   2. Der gewuenschte Mensch muss BEREITS einen Kassencode haben.
 *
 * Die zweite Bedingung ist die wichtigere, und sie schuetzt eine ANDERE
 * Auslieferung als diese: auf Norns POS horcht der Motor auf `127.0.0.1`
 * (`sidecar/norns-sidecar.mjs:429`), ist also nur aus dem eigenen Fenster
 * erreichbar. In der Wolkenfassung von Warehouse14 ist diese Route dagegen aus
 * dem Netz erreichbar (im Kopf der Route dokumentiert, gemessen am
 * 16.07.2026). Dort koennte sonst jemand die Sperre eines NAMENTLICH
 * gewaehlten Mitarbeiters ausloesen. Wer keinen Code hat, kann auch nicht
 * ausgesperrt werden.
 *
 * Ohne Wunsch bleibt alles wie zuvor: der gepaarte Mensch. Diese Funktion ist
 * damit rein additiv; kein bestehender Aufruf aendert sein Verhalten.
 */
async function resolveCandidateUser(
  app: FastifyInstance,
  deviceId: string | null,
  wunschUserId?: string | null,
): Promise<{ userId: string } | null> {
  if (!deviceId) return null;
  const rows = await app.db
    .select({ pairedBy: devices.pairedByUserId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  const r = rows[0];
  if (!r?.pairedBy) return null;

  if (wunschUserId != null && wunschUserId !== r.pairedBy) {
    const gewuenscht = await app.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, wunschUserId), isNotNull(users.posPinHash)))
      .limit(1);
    // Kein Treffer heisst: der Wunsch wird still ignoriert und der gepaarte
    // Mensch bleibt der Kandidat. Eine eigene Fehlermeldung waere ein Orakel
    // darueber, welche Kennungen es gibt und wer einen Code hat.
    if (gewuenscht[0]) return { userId: gewuenscht[0].id };
  }
  return { userId: r.pairedBy };
}

/**
 * Wer darf hier seinen ERSTEN Kassencode setzen?
 *
 * ── DIE UMGEKEHRTE BEDINGUNG, UND WARUM SIE EINE EIGENE FUNKTION IST ──────
 *
 * `resolveCandidateUser` (Anmeldung) verlangt, dass der gewuenschte Mensch
 * SCHON einen Code hat. Hier gilt genau das Gegenteil: nur wer noch KEINEN
 * hat. Die beiden Regeln in eine Funktion mit einem Schalter zu giessen waere
 * kuerzer und gefaehrlich — ein falsch gesetzter Schalter liesse jemanden den
 * Code eines anderen ueberschreiben. Zwei Funktionen, zwei Bedingungen, jede
 * an ihrer Stelle lesbar.
 *
 * ── WARUM ES DIESEN WEG UEBERHAUPT GIBT (02.08.2026) ──────────────────────
 *
 * Der Inhaber soll den Code seiner Mitarbeiter NIE kennen. Kennte er ihn,
 * waere die Bedienerzuordnung nach § 146a AO wertlos: jede Buchung koennte von
 * ihm stammen.
 *
 * Deshalb tippt er ihn nicht ein. Er LOESCHT ihn (`POST
 * /api/admin/kassencode/loeschen`), und der Mitarbeiter setzt danach am Tresen
 * seinen eigenen. Dieser Weg ist der zweite Halbschritt davon.
 *
 * Drei Bindungen, wie beim Erstanspruch des Inhabers:
 *   1. nur an einem GEPAARTEN Geraet,
 *   2. nur fuer einen Menschen, der WIRKLICH keinen Code hat,
 *   3. und der Weg schliesst sich in dem Moment, in dem ein Code existiert.
 */
async function resolveErstanspruch(
  app: FastifyInstance,
  deviceId: string | null,
  wunschUserId?: string | null,
): Promise<{ userId: string } | null> {
  if (!deviceId) return null;
  const geraet = await app.db
    .select({ pairedBy: devices.pairedByUserId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  const gepaart = geraet[0]?.pairedBy;
  if (!gepaart) return null;

  const zielId = wunschUserId ?? gepaart;
  const ziel = await app.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, zielId), isNull(users.posPinHash)))
    .limit(1);
  return ziel[0] ? { userId: ziel[0].id } : null;
}

interface PinUserState {
  id: string;
  email: string;
  role: 'ADMIN' | 'CASHIER' | 'READONLY';
  isOwner: boolean;
  posPinHash: string | null;
  duressPinHash: string | null;
  posPinFailedAttempts: number;
  posPinLockedUntil: Date | null;
}

async function loadPinUserState(
  app: FastifyInstance,
  userId: string,
): Promise<PinUserState | null> {
  const rows = await app.db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isOwner: users.isOwner,
      posPinHash: users.posPinHash,
      duressPinHash: users.duressPinHash,
      posPinFailedAttempts: users.posPinFailedAttempts,
      posPinLockedUntil: users.posPinLockedUntil,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.softDeletedAt)))
    .limit(1);
  return (rows[0] as PinUserState | undefined) ?? null;
}

// Audit emission — include in the active transaction (or autocommit).
async function emitAudit(
  app: FastifyInstance,
  opts: {
    event: string;
    actorUserId: string | null;
    deviceId: string | null;
    ip: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await app.db.insert(auditLog).values({
    eventType: opts.event,
    actorUserId: opts.actorUserId,
    deviceId: opts.deviceId,
    ipAddress: opts.ip,
    payload: opts.payload,
  });
}

/**
 * Memoized dummy hash so login verifies TWO hashes even when the user has no
 * duress PIN — keeping the perceived latency identical (Decision #37).
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPin('0000');
  return dummyHashPromise;
}

/** Verify the entered PIN against BOTH hashes (constant two-verify work). */
async function verifyPinPair(
  pin: string,
  posHash: string,
  duressHash: string | null,
): Promise<PinMatch> {
  const duressTarget = duressHash ?? (await getDummyHash());
  const [matchesPos, duressVerify] = await Promise.all([
    verifyPin(pin, posHash),
    verifyPin(pin, duressTarget),
  ]);
  return { matchesPos, matchesDuress: duressHash !== null && duressVerify };
}

/**
 * Fire the silent alarm in the BACKGROUND — never blocks or fails the login.
 * Three best-effort legs, each independently guarded: audit_log row →
 * `alert.duress` ledger event (broadcasts to the SSE feed) → optional webhook.
 */
function triggerSilentAlarm(
  app: FastifyInstance,
  webhookUrl: string,
  ctx: {
    userId: string;
    deviceId: string | null;
    ip: string | null;
    sessionId: string;
    route: 'pin-login' | 'step-up';
  },
): void {
  void (async () => {
    const at = new Date().toISOString();
    try {
      await app.db.insert(auditLog).values({
        eventType: 'security.duress_login_alert',
        actorUserId: ctx.userId,
        deviceId: ctx.deviceId,
        ipAddress: ctx.ip,
        payload: { route: ctx.route, session_id: ctx.sessionId, at },
      });
    } catch (err) {
      app.log.error({ err }, 'duress alarm: audit_log insert failed');
    }
    try {
      await emit(app.db, {
        eventType: 'alert.duress',
        entityTable: 'users',
        entityId: ctx.userId,
        actorUserId: ctx.userId,
        deviceId: ctx.deviceId,
        ipAddress: ctx.ip,
        payload: { route: ctx.route, at },
      });
    } catch (err) {
      app.log.error({ err }, 'duress alarm: ledger emit failed');
    }
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'duress', userId: ctx.userId, route: ctx.route, at }),
        });
      } catch (err) {
        app.log.error({ err }, 'duress alarm: webhook POST failed');
      }
    }
  })();
}

// ────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────

class PinNotSetError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'PIN_NOT_SET';
}

const authPinRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const duressWebhookUrl = opts.env.DURESS_ALARM_WEBHOOK_URL;

  // Basel's decision 2026-07-21: the 4-digit PIN is retired, identity is
  // Google-only. When DISABLE_PIN_AUTH is on, EVERY endpoint in this router
  // refuses before doing any work. The routes, argon2, lockout and tables all
  // stay in place so the mechanism can be switched back on; this flag simply
  // makes none of them reachable. This is the hard close of the anonymous 0000
  // exploit: no PIN can start or elevate a session at all.
  const pinAuthDisabled = opts.env.DISABLE_PIN_AUTH === 'true';
  const assertPinAuthEnabled = (): void => {
    if (pinAuthDisabled) {
      throw new ForbiddenError('PIN login is disabled. Please sign in with Google.');
    }
  };

  // ────────────────────────────────────────────────────────────────────
  // GET /api/auth/anmeldbare-personen
  //
  // Wer kann sich an DIESEM Geraet anmelden?
  //
  // ⚠️ 01.08.2026: Ohne diese Liste ist die Wahl aus `pin-login` nicht
  // benutzbar — die Oberflaeche kann keinen Menschen anbieten, den sie nicht
  // kennt, und der Kassierer kann keine Kennung eintippen.
  //
  // Sie nennt ALLE Menschen des Hauses, mit der Angabe, ob ein Kassencode
  // hinterlegt ist.
  //
  // ⚠️ 02.08.2026, nach einem Umweg: der erste Anlauf zeigte nur, wer schon
  // einen Code HAT. Das klang sparsam und war eine Sackgasse: ein frisch
  // angelegter Mitarbeiter erschien nirgends, konnte also nirgends gewaehlt
  // werden, und kam damit nie zu seinem ersten Code.
  //
  // Wer keinen Code hat, wird deshalb GEZEIGT und traegt `hatCode: false`.
  // Die Oberflaeche bietet ihm „Code einrichten" statt der Zifferntastatur.
  //
  // KEINE E-Mail, KEINE Kennzahlen, nur Kennung, Name und Rolle. Der Name
  // steht ohnehin gleich auf dem Bon, den der Kunde bekommt.
  //
  // Das Tor ist dasselbe wie bei der Anmeldung: ein GEPAARTES Geraet. Auf
  // Norns POS horcht der Motor nur auf `127.0.0.1`, ist also allein aus dem
  // eigenen Fenster erreichbar.
  // ────────────────────────────────────────────────────────────────────
  app.get(
    '/api/auth/anmeldbare-personen',
    {
      schema: {
        tags: ['auth'],
        summary: 'Wer kann sich an diesem gepaarten Geraet mit Kassencode anmelden',
        response: {
          200: Type.Object({
            personen: Type.Array(
              Type.Object({
                id: Type.String({ format: 'uuid' }),
                name: Type.String(),
                role: Type.Union([
                  Type.Literal('ADMIN'),
                  Type.Literal('CASHIER'),
                  Type.Literal('READONLY'),
                ]),
                isOwner: Type.Boolean(),
                /** Ohne Code fuehrt die Wahl zum Einrichten, nicht zur Tastatur. */
                hatCode: Type.Boolean(),
              }),
            ),
          }),
        },
      },
    },
    async (req, reply) => {
      assertPinAuthEnabled();
      // Dasselbe Tor wie die Anmeldung: ohne gepaartes Geraet gibt es nichts.
      const kandidat = await resolveCandidateUser(app, req.deviceId);
      if (!kandidat) return reply.send({ personen: [] });

      const zeilen = await app.db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          isOwner: users.isOwner,
          pinHash: users.posPinHash,
        })
        .from(users)
        .orderBy(users.name);

      return reply.send({
        personen: zeilen.map((z) => ({
          id: z.id,
          // Ein Mensch ohne hinterlegten Namen bekommt trotzdem eine Zeile,
          // sonst verschwindet er still aus der Anmeldung.
          name: z.name?.trim() ? z.name : 'Ohne Namen',
          role: z.role,
          isOwner: z.isOwner,
          // NUR ob einer da ist. Der Hash selbst verlaesst den Server nie.
          hatCode: z.pinHash !== null,
        })),
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/pin-login
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/pin-login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Fast POS PIN login on a paired device (ADR-0022 §4b)',
        body: PinBody,
        response: { 200: PinLoginResponse },
      },
    },
    async (req, reply) => {
      const { pin, userId: gewuenschterMensch } = req.body as PinBody;
      assertPinAuthEnabled();
      const ip = req.ip || null;

      // Security review 2026-07-21 — blacklist-on-LOGIN (gated, default OFF).
      // The weak-PIN blacklist was enforced only when SETTING a PIN, so a legacy
      // account whose PIN is a weak value (the prod owner seed) could still LOG
      // IN with it — and because the prod mTLS gate is bypassed, that door is
      // reachable from the open internet. When ENFORCE_PIN_BLACKLIST_ON_LOGIN is
      // on, a blacklisted PIN is refused with the SAME 'Invalid PIN' as any
      // wrong PIN (no oracle beyond the public blacklist), closing that door
      // WITHOUT touching mTLS or mutating anyone's PIN. Kept OFF by default so
      // the owner first sets a strong PIN (so his step-up / cashier fallback are
      // not locked out), THEN flips this — see docs/runbooks/0090-auth-hardening.
      if (
        opts.env.ENFORCE_PIN_BLACKLIST_ON_LOGIN === 'true' &&
        PinPolicy.validate(pin, { enforceBlacklist: true })?.code === 'BLACKLISTED'
      ) {
        throw new UnauthorizedError('Invalid PIN.');
      }

      const candidate = await resolveCandidateUser(app, req.deviceId, gewuenschterMensch ?? null);
      if (!candidate) {
        throw new UnauthorizedError('PIN login requires a paired device');
      }
      const state = await loadPinUserState(app, candidate.userId);
      if (!state) {
        throw new UnauthorizedError('PIN not set for this user');
      }
      if (!state.posPinHash) {
        // Basel's decision 2026-07-30: no secret is EVER pre-set. The hull
        // must distinguish "not set up yet" from "wrong PIN" to show the
        // setup mask instead of an error — a merchant who never chose a code
        // did not type a wrong one. Only reachable from a paired device, so
        // this is no oracle to outsiders.
        throw new PinNotSetError('No PIN has been set for this till yet.');
      }

      // Verify against BOTH hashes (constant work), then classify.
      const match = await verifyPinPair(pin, state.posPinHash, state.duressPinHash);
      const { pinCorrect, isDuress } = classifyPinAttempt(match);
      const decision = decideAttemptOutcome({
        state: { failedAttempts: state.posPinFailedAttempts, lockedUntil: state.posPinLockedUntil },
        now: new Date(),
        pinCorrect,
      });

      // Atomic: state update + audit row in one transaction.
      if (decision.kind === 'already_locked') {
        await emitAudit(app, {
          event: 'auth.pin_failed',
          actorUserId: state.id,
          deviceId: req.deviceId,
          ip,
          payload: { reason: 'already_locked', lockedUntil: decision.until.toISOString() },
        });
        throw new PinLockedError(decision.until);
      }

      /*
       * ⛔ DER ZAEHLER WIRD UNTER SPERRE NEU GERECHNET (19.08.2026, Fund der
       * boeswilligen Pruefung).
       *
       * ── WAS DER ANGRIFF ZEIGTE ──────────────────────────────────────────
       *
       * `decision` oben stammt aus einem Lesevorgang VOR der Transaktion.
       * Zwei gleichzeitige Fehlversuche lasen beide denselben Stand (etwa 0),
       * rechneten beide 1 und schrieben beide 1 — der Zaehler stand nach zwei
       * falschen Eingaben auf EINS. Wer parallel raet, kommt damit an der
       * Sperre vorbei: der Schutz gegen das Durchprobieren war ausgehebelt,
       * und zwar genau unter der Last, unter der er zaehlt.
       *
       * ── DIE ABHILFE, UND WARUM GENAU SO ─────────────────────────────────
       *
       * Die Zeile wird INNERHALB der Transaktion mit `FOR UPDATE` gesperrt und
       * der Stand danach frisch gelesen; die Entscheidung faellt dann auf
       * diesem Stand. Zwei gleichzeitige Versuche reihen sich damit
       * hintereinander: der zweite sieht die 1 des ersten und schreibt 2.
       *
       * ⚠️ NICHT `attempts = attempts + 1` allein: die Sperre haengt an einer
       * reinen Zustandsmaschine (`decideAttemptOutcome`), die auch die
       * Sperrzeit und den Rueckfall nach Ablauf entscheidet. Eine zweite
       * Rechenregel in SQL waere eine zweite Wahrheit ueber dieselbe Sache —
       * die Hausklasse, an der dieses Haus schon einmal teuer gelernt hat.
       */
      const endgueltig = await app.db.transaction(async (tx) => {
        const frisch = await tx.execute<{
          pos_pin_failed_attempts: number;
          pos_pin_locked_until: Date | null;
        }>(drizzleSql`
          SELECT pos_pin_failed_attempts, pos_pin_locked_until
            FROM users
           WHERE id = ${state.id}::uuid
             FOR UPDATE`);
        const stand = frisch[0];
        const entscheidung = stand
          ? decideAttemptOutcome({
              state: {
                failedAttempts: stand.pos_pin_failed_attempts,
                lockedUntil: stand.pos_pin_locked_until,
              },
              now: new Date(),
              pinCorrect,
            })
          : decision;

        // Ist die Sperre inzwischen (durch den Nebenlaeufer) gefallen, wird
        // hier NICHT weitergeschrieben — der Aufrufer bekommt sie unten.
        if (entscheidung.kind === 'already_locked') return entscheidung;

        await tx
          .update(users)
          .set({
            posPinFailedAttempts: entscheidung.newState.failedAttempts,
            posPinLockedUntil: entscheidung.newState.lockedUntil,
          })
          .where(eq(users.id, state.id));

        const event =
          entscheidung.kind === 'success'
            ? 'auth.pin_login'
            : entscheidung.kind === 'failed_now_locked'
              ? 'auth.pin_locked'
              : 'auth.pin_failed';

        await tx.insert(auditLog).values({
          eventType: event,
          actorUserId: state.id,
          deviceId: req.deviceId,
          ipAddress: ip,
          payload: {
            decision: entscheidung.kind,
            failed_attempts: entscheidung.newState.failedAttempts,
            locked_until: entscheidung.newState.lockedUntil?.toISOString() ?? null,
            is_owner: state.isOwner,
          },
        });
        return entscheidung;
      });

      // Ab hier gilt die Entscheidung, die UNTER der Sperre gefallen ist.
      if (endgueltig.kind === 'already_locked') {
        throw new PinLockedError(endgueltig.until);
      }
      if (endgueltig.kind === 'failed_now_locked') {
        // The lockout starts NOW. Surface it to the UI immediately.
        // biome-ignore lint/style/noNonNullAssertion: failed_now_locked always carries a lockedUntil.
        throw new PinLockedError(decision.newState.lockedUntil!);
      }
      if (decision.kind === 'failed') {
        // No attempt counter in the reply. This route answers ANONYMOUS callers
        // from the open internet (verified 2026-07-16: a bare
        // POST /api/auth/pin-login {"pin":"9137"} from an unauthenticated client
        // returned "Invalid PIN (5 attempts remaining)"), and the count is live
        // state of the OWNER's account handed to a stranger. It also paces a
        // brute-force for free: stop at nine, wait, resume, never trip the lock.
        // A locked-out attempt still reports the lock and its expiry via
        // PinLockedError, so a real person still learns why they are stuck.
        throw new UnauthorizedError('Invalid PIN.');
      }

      // Success — create a session. TTL depends on is_owner (ADR-0022 §2),
      // centralized in session-ttl.ts (owner shortened 30d→7d, review 2026-07-21).
      const ttlMs = sessionTtlMs(state.isOwner);
      const sessionId = randomUUID();
      const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const expiresAt = new Date(Date.now() + ttlMs);

      await app.db.insert(sessions).values({
        id: sessionId,
        userId: state.id,
        token,
        expiresAt,
        ipAddress: ip,
        userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
        deviceId: req.deviceId,
        lastPinStepUpAt: new Date(), // Fresh PIN = fresh step-up.
      });

      // The desktop apps run in a Tauri webview (origin `tauri.localhost`),
      // which is a DIFFERENT site from api.warehouse14.de — so the session
      // cookie must be SameSite=None (+Secure) or the browser drops it on
      // every cross-site data fetch and the whole app reads as empty. In prod
      // the public edge is HTTPS (Cloudflare), even though the internal hop to
      // the container is plain http, so force Secure there.
      {
        const crossSite = process.env.NODE_ENV === 'production';
        reply.setCookie('warehouse14.session', token, {
          httpOnly: true,
          secure: crossSite ? true : req.protocol === 'https',
          sameSite: crossSite ? 'none' : 'lax',
          path: '/',
          expires: expiresAt,
        });
      }

      // Duress: log in normally, then fire the silent alarm in the background.
      if (isDuress) {
        triggerSilentAlarm(app, duressWebhookUrl, {
          userId: state.id,
          deviceId: req.deviceId,
          ip,
          sessionId,
          route: 'pin-login',
        });
      }

      return {
        ok: true as const,
        sessionExpiresAt: expiresAt.toISOString(),
        actor: { id: state.id, role: state.role, isOwner: state.isOwner },
        // A PIN session has no Google identity — carry the email only, so the
        // header profile shows the account and initials (never a broken picture).
        profile: { email: state.email, displayName: null, avatarUrl: null },
        // Also return the token so the Tauri webview can carry it as a Bearer
        // header — the cross-site session cookie is dropped on Windows WebView2.
        token,
      };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/step-up — re-confirm PIN for sensitive actions
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/step-up',
    {
      schema: {
        tags: ['auth'],
        summary: 'PIN step-up for sensitive actions (10-min window, ADR-0022 §4c)',
        body: PinBody,
        response: { 200: StepUpResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      // NOTE: step-up is deliberately NOT gated by DISABLE_PIN_AUTH. It is
      // session-gated (requireAuth), so it was never part of the anonymous
      // 0000 exploit — only pin-login was. It stays alive so the currently
      // deployed cashier's fiscal step-up keeps working until the next update
      // migrates sensitive-action re-confirmation to the LOCAL device lock /
      // biometric (Basel's direction 2026-07-21). The login door and PIN
      // management below ARE disabled.
      const { pin } = req.body as PinBody;
      const ip = req.ip || null;

      const state = await loadPinUserState(app, req.actor.id);
      if (!state || !state.posPinHash) {
        throw new UnauthorizedError('PIN not set for this user');
      }

      const match = await verifyPinPair(pin, state.posPinHash, state.duressPinHash);
      const { pinCorrect, isDuress } = classifyPinAttempt(match);
      const decision = decideAttemptOutcome({
        state: { failedAttempts: state.posPinFailedAttempts, lockedUntil: state.posPinLockedUntil },
        now: new Date(),
        pinCorrect,
      });

      if (decision.kind === 'already_locked') {
        throw new PinLockedError(decision.until);
      }

      const now = new Date();
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            posPinFailedAttempts: decision.newState.failedAttempts,
            posPinLockedUntil: decision.newState.lockedUntil,
          })
          .where(eq(users.id, state.id));

        if (decision.kind === 'success') {
          await tx
            .update(sessions)
            .set({ lastPinStepUpAt: now })
            .where(eq(sessions.id, req.session.sessionId));
        }

        await tx.insert(auditLog).values({
          eventType:
            decision.kind === 'success'
              ? 'auth.step_up_success'
              : decision.kind === 'failed_now_locked'
                ? 'auth.pin_locked'
                : 'auth.step_up_failed',
          actorUserId: state.id,
          deviceId: req.deviceId,
          ipAddress: ip,
          payload: {
            session_id: req.session.sessionId,
            decision: decision.kind,
            failed_attempts: decision.newState.failedAttempts,
          },
        });
      });

      if (decision.kind === 'failed_now_locked') {
        // biome-ignore lint/style/noNonNullAssertion: failed_now_locked always carries a lockedUntil.
        throw new PinLockedError(decision.newState.lockedUntil!);
      }
      if (decision.kind === 'failed') {
        // No attempt counter in the reply. This route answers ANONYMOUS callers
        // from the open internet (verified 2026-07-16: a bare
        // POST /api/auth/pin-login {"pin":"9137"} from an unauthenticated client
        // returned "Invalid PIN (5 attempts remaining)"), and the count is live
        // state of the OWNER's account handed to a stranger. It also paces a
        // brute-force for free: stop at nine, wait, resume, never trip the lock.
        // A locked-out attempt still reports the lock and its expiry via
        // PinLockedError, so a real person still learns why they are stuck.
        throw new UnauthorizedError('Invalid PIN.');
      }

      // Duress at step-up: refresh the window normally, then alarm in background.
      if (isDuress) {
        triggerSilentAlarm(app, duressWebhookUrl, {
          userId: state.id,
          deviceId: req.deviceId,
          ip,
          sessionId: req.session.sessionId,
          route: 'step-up',
        });
      }

      return { ok: true as const, lastPinStepUpAt: now.toISOString() };
    },
  );

  // ── POST /api/auth/step-up/device ──────────────────────────────────────────
  //
  // Dieselbe Bestätigung, aber mit dem Gerätecode statt der alten Kassen-PIN.
  //
  // WARUM ES DAS GEBEN MUSS
  // Die vierstellige Kassen-PIN ist am 21.07.2026 abgeschafft worden. Die
  // Anmeldung läuft nur noch über Google, und jedes Gerät hat einen eigenen
  // Sperrcode, den die Person am Tresen selbst gesetzt hat. Trotzdem verlangte
  // JEDE empfindliche Handlung — der DATEV-Export, ein Storno, der Z-Bon, eine
  // Löschung — weiterhin die abgeschaffte Zahl. Basels Befund am 23.07.2026.
  //
  // Zwei Folgen, und die zweite ist die schlimmere:
  //   1. Man wird nach einer Zahl gefragt, die es nicht mehr geben soll.
  //   2. Wer KEINE alte PIN hinterlegt hat — und ein neu angelegter Mitarbeiter
  //      hat keine — bekommt „PIN not set for this user" und kann die Handlung
  //      NIE ausführen. Heute betrifft das niemanden, weil beide angelegten
  //      Menschen noch einen alten Abdruck tragen; beim ersten echten
  //      Mitarbeiter wäre der Steuerexport für ihn dauerhaft gesperrt.
  //
  // WAS DER SERVER HIER PRÜFEN KANN, UND WAS NICHT — ehrlich benannt
  // Der Gerätecode verlässt das Gerät NIE. Genau das ist sein Sinn: würde er
  // hier hinterlegt, wäre er wieder ein serverseitiges vierstelliges Geheimnis,
  // das man über die Schnittstelle durchprobieren kann — also exakt das
  // Problem, das mit der PIN abgeschafft wurde. Der Server prüft deshalb die
  // SITZUNG (angemeldet, nicht widerrufen) und schreibt den Zeitstempel; die
  // Prüfung des Codes selbst macht das Gerät, mit PBKDF2, eskalierender Sperre
  // und Löschung nach zehn Fehlversuchen.
  //
  // Gegen die Gefahr, um die es bei einer Nachbestätigung wirklich geht — eine
  // unbeaufsichtigte, bereits angemeldete Kasse, an die sich jemand setzt — ist
  // das mindestens so stark wie vorher. Gegen einen gestohlenen Sitzungsschlüssel
  // war die alte PIN ebenfalls kein Schutz; dafür gibt es Sitzungswiderruf und
  // mTLS. Das Tagebuch nennt den Faktor beim Namen, damit später niemand eine
  // Gerätebestätigung für eine PIN-Eingabe hält.
  app.post(
    '/api/auth/step-up/device',
    {
      schema: {
        tags: ['auth'],
        summary: 'Bestätigung mit dem Gerätecode (Bildschirmsperre) statt der alten PIN.',
        response: { 200: StepUpResponse },
      },
    },
    async (req) => {
      requireAuth(req);

      const now = new Date();
      await app.db.transaction(async (tx) => {
        await tx
          .update(sessions)
          .set({ lastPinStepUpAt: now })
          .where(eq(sessions.id, req.session.sessionId));

        await tx.insert(auditLog).values({
          // Ein EIGENER Ereignisname, nicht `auth.step_up_success`. Wer das
          // Tagebuch liest, muss sehen können, WELCHER Faktor bestätigt hat.
          eventType: 'auth.step_up_device',
          actorUserId: req.actor.id,
          deviceId: req.deviceId,
          ipAddress: req.ip || null,
          payload: {
            session_id: req.session.sessionId,
            factor: 'device_lock',
          },
        });
      });

      return { ok: true as const, lastPinStepUpAt: now.toISOString() };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/pin/set — set or change the POS PIN (requires Full Login)
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/pin/set',
    {
      schema: {
        tags: ['auth'],
        summary: 'Set or change the POS PIN for the authenticated user',
        body: PinSetBody,
        response: { 200: PinSetResponse },
      },
    },
    async (req) => {
      assertPinAuthEnabled();
      const { newPin } = req.body as Static<typeof PinSetBody>;
      const ip = req.ip || null;

      // FIRST CLAIM (Basel's decision 2026-07-30): on a fresh install no
      // session can exist before a PIN does — pin-login answers PIN_NOT_SET
      // and the hull shows the setup mask, which posts here WITHOUT a
      // session. The claim is bound three ways: paired device only, only for
      // the user that device is paired to, and only while that user has NO
      // secret. The moment a hash exists this path closes and full login is
      // required again, exactly as before.
      let zielId: string;
      if (req.actor) {
        zielId = req.actor.id;
      } else {
        const wunsch = (req.body as Static<typeof PinSetBody>).userId ?? null;
        const candidate = await resolveErstanspruch(app, req.deviceId, wunsch);
        const state = candidate ? await loadPinUserState(app, candidate.userId) : null;
        if (state && !state.posPinHash) {
          zielId = state.id;
        } else {
          // requireAuth ALWAYS throws in this branch (there is no actor); the
          // assignment only satisfies control-flow analysis, which cannot see
          // that an asserting function never returns here.
          requireAuth(req);
          zielId = (req.actor as unknown as { id: string }).id;
        }
      }

      // Production enforces blacklist; tests/dev seeds may use 0000 via
      // dev-bootstrap which inserts directly bypassing this route.
      const isProd = process.env.NODE_ENV === 'production';
      const err = PinPolicy.validate(newPin, { enforceBlacklist: isProd });
      if (err) {
        throw new UnauthorizedError(
          err.code === 'BLACKLISTED'
            ? 'PIN is in the blacklist of common weak PINs'
            : err.code === 'WRONG_LENGTH'
              ? 'Der Code hat genau sechs Ziffern.'
              : 'PIN must be all digits',
        );
      }

      const hash = await hashPin(newPin);
      const now = new Date();
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            posPinHash: hash,
            posPinSetAt: now,
            posPinFailedAttempts: 0,
            posPinLockedUntil: null,
          })
          .where(eq(users.id, zielId));

        await tx.insert(auditLog).values({
          eventType: 'pin.set',
          actorUserId: zielId,
          deviceId: req.deviceId,
          ipAddress: ip,
          payload: {
            lockout_minutes: PIN_LOCKOUT_MINUTES,
            threshold: PIN_FAILED_THRESHOLD,
            // The audit trail must show whether this was the first-start
            // claim (no session) or an authenticated change.
            first_claim: !req.actor,
          },
        });
      });

      return { ok: true as const, setAt: now.toISOString() };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/duress-pin/set — register/rotate the duress PIN
  //
  // Requires a valid session. The new PIN must pass the policy (blacklist in
  // prod) AND differ from the user's current POS PIN — verified in-app since
  // argon2id salts every hash (the DB CHECK only catches a literal hash copy).
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/duress-pin/set',
    {
      schema: {
        tags: ['auth'],
        summary: 'Set or rotate the duress PIN (must differ from the POS PIN)',
        body: PinSetBody,
        response: { 200: PinSetResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      assertPinAuthEnabled();
      const { newPin } = req.body as Static<typeof PinSetBody>;
      const ip = req.ip || null;

      const isProd = process.env.NODE_ENV === 'production';
      const err = PinPolicy.validate(newPin, { enforceBlacklist: isProd });
      if (err) {
        throw new UnauthorizedError(
          err.code === 'BLACKLISTED'
            ? 'PIN is in the blacklist of common weak PINs'
            : err.code === 'WRONG_LENGTH'
              ? 'Der Code hat genau sechs Ziffern.'
              : 'PIN must be all digits',
        );
      }

      const state = await loadPinUserState(app, req.actor.id);
      if (!state || !state.posPinHash) {
        throw new UnauthorizedError('Set a POS PIN before registering a duress PIN');
      }

      // Distinctness: the duress PIN must not equal the POS PIN.
      const sameAsPos = await verifyPin(newPin, state.posPinHash);
      if (sameAsPos) {
        throw new UnauthorizedError('Duress PIN must differ from your POS PIN');
      }

      const hash = await hashPin(newPin);
      const now = new Date();
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ duressPinHash: hash, duressPinSetAt: now })
          .where(eq(users.id, req.actor.id));

        await tx.insert(auditLog).values({
          eventType: 'pin.set_duress',
          actorUserId: req.actor.id,
          deviceId: req.deviceId,
          ipAddress: ip,
          payload: { duress: true },
        });
      });

      return { ok: true as const, setAt: now.toISOString() };
    },
  );
};

export default authPinRoutes;
