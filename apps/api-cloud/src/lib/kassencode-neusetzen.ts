/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Einen Kassencode NEU setzen — das gemeinsame Herz aller Notausgänge
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM EINE EIGENE DATEI (21.08.2026) ───────────────────────────────────
 *
 * Mit Rettungsstick und Herstellercode gibt es DREI Wege, die am Ende
 * dasselbe tun: Codeprüfung, argon2-Abdruck, die vier PIN-Spalten schreiben,
 * Tagebucheintrag, Alarm auf die Aufsicht. Drei Abschriften dieses Blocks
 * wären drei Gelegenheiten, dass eine davon eines Tages den Zähler nicht
 * zurücksetzt oder den Alarm vergisst — und niemand merkt es, weil die
 * anderen beiden es tun.
 *
 * ⚠️ Was hier NICHT wohnt: die Prüfung, OB der Rufer darf. Jede Tür prüft
 * ihr eigenes Geheimnis selbst (Zettel, Stick, Unterschrift). Hier beginnt
 * es erst NACH dem bestandenen Beweis.
 */

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { PinPolicy, hashPin } from '@norns/auth-pin';
import { emit } from '@norns/audit';
import { auditLog, users } from '@norns/db/schema';

import { UnauthorizedError } from './auth-policy.js';

/** Die eine Transaktion aller Notausgänge. */
export async function setzeKassencodeNeu(
  app: FastifyInstance,
  opts: {
    userId: string;
    neuerCode: string;
    deviceId: string | null;
    ip: string | null;
    /** `notfallschluessel.eingeloest`, `rettungsstick.eingeloest`, `meister.eingeloest` */
    tagebuchArt: string;
    /** `alert.notfallschluessel`, `alert.rettungsstick`, `alert.meistercode` */
    alarmArt: string;
    /**
     * Was DIESELBE Transaktion zusätzlich schreiben muss — etwa den Abdruck
     * des Nachfolge-Geheimnisses. Läuft im selben `tx`, damit Code und
     * Geheimnis nie auseinanderfallen.
     */
    zusatz?: (tx: Parameters<Parameters<FastifyInstance['db']['transaction']>[0]>[0]) => Promise<void>;
  },
): Promise<void> {
  /*
   * ⚠️ Der neue Code besteht dieselbe Prüfung wie überall sonst. Ein
   * Notausgang, durch den ein 123456 hineinkommt, wäre die Hintertür, die
   * er nicht sein darf.
   */
  const fehler = PinPolicy.validate(opts.neuerCode, {
    enforceBlacklist: process.env.NODE_ENV === 'production',
  });
  if (fehler) {
    throw new UnauthorizedError(
      fehler.code === 'BLACKLISTED'
        ? 'Dieser Code ist zu leicht zu erraten. Bitte einen anderen wählen.'
        : 'Der Code hat genau sechs Ziffern.',
    );
  }

  const abdruck = await hashPin(opts.neuerCode);
  const jetzt = new Date();

  await app.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        posPinHash: abdruck,
        posPinSetAt: jetzt,
        posPinFailedAttempts: 0,
        posPinLockedUntil: null,
      })
      .where(eq(users.id, opts.userId));
    if (opts.zusatz) await opts.zusatz(tx);
    await tx.insert(auditLog).values({
      eventType: opts.tagebuchArt,
      actorUserId: opts.userId,
      deviceId: opts.deviceId,
      ipAddress: opts.ip,
      payload: { at: jetzt.toISOString() },
    });
  });

  /*
   * Auf die Aufsicht, ohne den Vorgang aufzuhalten. Ein eingelöster
   * Notausgang ist ein vergesslicher Händler oder ein Einbruch — beides
   * soll jemand sofort sehen.
   */
  void emit(app.db, {
    eventType: opts.alarmArt,
    entityTable: 'users',
    entityId: opts.userId,
    actorUserId: opts.userId,
    deviceId: opts.deviceId,
    ipAddress: opts.ip,
    payload: { at: jetzt.toISOString() },
  }).catch((err: unknown) => {
    app.log.error({ err }, `${opts.alarmArt}: ledger emit failed`);
  });
}
