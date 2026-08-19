/**
 * Der Webhook-Zweig der Leser-Zahlung (Gewerk 2, §9).
 *
 * Der bestehende Stripe-Webhook (routes/storefront-webhook.ts) ist fest an
 * den Web-Warenkorb gebunden: `payment_intent.succeeded` heisst dort
 * "Warenkorb in einen Beleg umwandeln". Eine Leser-Zahlung hat keinen
 * Warenkorb — ihr Beleg entsteht, wenn die KASSE nach dem Erfolg selbst
 * `POST /api/transactions/finalize` zieht (eine Wahrheit, keine zweite).
 *
 * Deshalb prueft dieser Zweig fuer jedes Intent-Ereignis ZUERST, ob der
 * Intent eine Leser-Zahlung ist. Wenn ja, wird NUR der Stand fortgeschrieben
 * — durch den reinen Automaten in leser-zahlung-stand.ts, in dem auch der
 * Doppelbelastungs-Riegel wohnt. Wenn nein, faellt das Ereignis unveraendert
 * an die Warenkorb-Behandlung durch.
 *
 * Jede Fortschreibung ist optimistisch gegen den GELESENEN Stand gesichert
 * (WHERE status = alter Stand): zwei gleichzeitige Zustellungen desselben
 * Ereignisses koennen denselben Uebergang nicht doppelt anwenden.
 */

import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { leserZahlungen } from '@norns/db/schema';

import { naechsterStand, type LeserEreignis, type ZahlungsStand } from './leser-zahlung-stand.js';

interface EmpfangenesEreignis {
  type: string;
  data: { object: Record<string, unknown> };
}

/** Zieht die Intent-Kennung aus dem Ereignis — je nach Objektart. */
function intentKennung(ereignis: EmpfangenesEreignis): string | null {
  const objekt = ereignis.data.object;
  if (ereignis.type.startsWith('terminal.reader.')) {
    const action = (objekt.action ?? null) as {
      process_payment_intent?: { payment_intent?: string };
    } | null;
    const kennung = action?.process_payment_intent?.payment_intent;
    return typeof kennung === 'string' && kennung.length > 0 ? kennung : null;
  }
  return typeof objekt.id === 'string' && objekt.id.length > 0 ? objekt.id : null;
}

/** Uebersetzt das Stripe-Ereignis in die Sprache des Stand-Automaten. */
function alsAutomatEreignis(ereignis: EmpfangenesEreignis): LeserEreignis | null {
  const objekt = ereignis.data.object;
  switch (ereignis.type) {
    case 'payment_intent.succeeded':
      return { typ: 'erfolg' };
    case 'payment_intent.payment_failed': {
      const fehler = (objekt.last_payment_error ?? null) as {
        code?: string;
        decline_code?: string;
        message?: string;
      } | null;
      return {
        typ: 'fehlschlag',
        code: fehler?.decline_code ?? fehler?.code,
        meldung: fehler?.message,
      };
    }
    case 'payment_intent.canceled':
      return { typ: 'storniert' };
    case 'terminal.reader.action_failed': {
      const action = (objekt.action ?? null) as {
        failure_code?: string | null;
        failure_message?: string | null;
      } | null;
      return {
        typ: 'aktion_fehlgeschlagen',
        code: action?.failure_code ?? undefined,
        meldung: action?.failure_message ?? undefined,
      };
    }
    default:
      // `terminal.reader.action_succeeded`, `payment_intent.processing`, …:
      // fuer den Stand ohne Bedeutung — der Erfolg kommt vom Intent selbst.
      return null;
  }
}

/**
 * Verarbeitet ein Stripe-Ereignis, SOFERN es zu einer Leser-Zahlung gehoert.
 *
 * Gibt `true` zurueck, wenn das Ereignis dem Leser-Weg gehoert (auch wenn es
 * dort nichts zu tun gab) — der Aufrufer laesst die Warenkorb-Behandlung
 * dann aus. `false` heisst: kein Leser-Vorgang, der Warenkorb-Weg darf.
 */
export async function verarbeiteLeserEreignis(
  app: FastifyInstance,
  ereignis: EmpfangenesEreignis,
): Promise<boolean> {
  const istTerminalEreignis = ereignis.type.startsWith('terminal.reader.');
  const kennung = intentKennung(ereignis);
  if (kennung === null) {
    // Ein Terminal-Ereignis ohne Intent (z. B. eine fremde Aktionsart) ist
    // trotzdem UNSERES — als Beweis gespeichert ist es bereits, mehr gibt
    // es nicht zu tun. Intent-Ereignisse ohne Kennung gibt es nicht.
    return istTerminalEreignis;
  }

  const [zeile] = await app.db
    .select({ id: leserZahlungen.id, status: leserZahlungen.status })
    .from(leserZahlungen)
    .where(
      and(eq(leserZahlungen.provider, 'STRIPE'), eq(leserZahlungen.providerIntentId, kennung)),
    )
    .limit(1);
  if (zeile === undefined) return istTerminalEreignis;

  const automatEreignis = alsAutomatEreignis(ereignis);
  if (automatEreignis === null) return true;

  const uebergang = naechsterStand(zeile.status as ZahlungsStand, automatEreignis);

  if (!uebergang.geaendert) {
    if (uebergang.weicheAblehnung) {
      // DER RIEGEL: die weiche girocard-Ablehnung wird GEZAEHLT, nie
      // gebucht. Der Leser zieht die echte Belastung gleich selbst nach.
      await app.db
        .update(leserZahlungen)
        .set({
          weicheAblehnungen: drizzleSql`${leserZahlungen.weicheAblehnungen} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(leserZahlungen.id, zeile.id));
      app.log.info(
        { intentId: kennung },
        'leser-zahlung: weiche girocard-Ablehnung gezaehlt, Stand bleibt PROCESSING',
      );
    }
    return true;
  }

  await app.db
    .update(leserZahlungen)
    .set({
      status: uebergang.stand,
      fehlerbild: uebergang.fehlerbild,
      fehlerMeldung: uebergang.meldung,
      updatedAt: new Date(),
    })
    // Optimistisch gegen den gelesenen Stand — eine parallele Zustellung
    // desselben Ereignisses wendet den Uebergang nicht doppelt an.
    .where(and(eq(leserZahlungen.id, zeile.id), eq(leserZahlungen.status, zeile.status)));

  app.log.info(
    { intentId: kennung, von: zeile.status, nach: uebergang.stand, ereignis: ereignis.type },
    'leser-zahlung: Stand fortgeschrieben',
  );
  return true;
}
