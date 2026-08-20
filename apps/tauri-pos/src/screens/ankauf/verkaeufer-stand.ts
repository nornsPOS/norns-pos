/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  verkaeufer-stand — steht wirklich ein Verkäufer am Tresen?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 (an der laufenden Kasse gemessen) ────────────
 *
 * Basel: die Ankaufsfläche sei „noch alt, graphisch überlappend, unklar, voll
 * von Problemen". Gemessen wurde eine Fläche, die
 *
 *   • links eine LEERE Spalte zeigte („Verkäufer" und sonst nichts),
 *   • in der Schrittleiste „2 · Stücke bewerten" als laufenden Schritt
 *     hervorhob, obwohl Schritt 1 nicht getan war,
 *   • und das Erfassungsformular vollständig offen liess: 43 von 46
 *     Bedienelementen waren bedienbar, ohne dass ein Verkäufer feststand.
 *
 * Das sind nicht drei Fehler, sondern EINER. Im gemerkten Ankaufskorb stand
 * eine Kundenkennung, die es in den Büchern nicht mehr gab:
 *
 *     GET /api/customers/2f88621f-… → 404 NOT_FOUND
 *
 * Die Fläche fragte nur den KORB („steht da eine Kennung?"), nie die BÜCHER
 * („gibt es diese Person?"). Damit galt ein Geist als Verkäufer, das
 * Formular ging auf, die Schrittleiste sprang weiter — und erst beim
 * Bezahlen wäre es aufgefallen, mit einem Menschen davor.
 *
 * ── WANN DAS AM ECHTEN TRESEN PASSIERT ─────────────────────────────────────
 *
 * Der Korb überlebt im örtlichen Speicher, die Bücher nicht:
 *
 *   • Der Kunde wird nach der Datenschutz-Grundverordnung gelöscht, während
 *     sein angefangener Ankauf noch geparkt ist (`CustomerEraseDialog`).
 *   • Die Bücher kommen aus einer Sicherung zurück, die älter ist als der
 *     Korb.
 *   • Der Ankauf wurde an einer anderen Kasse begonnen.
 *
 * ── DIE REGEL ──────────────────────────────────────────────────────────────
 *
 * Ein Verkäufer steht erst dann fest, wenn die BÜCHER ihn bestätigen. Alles
 * andere — keine Kennung, ein Geist, eine schweigende Abfrage — ist „noch
 * kein Verkäufer", und die Fläche bleibt bei Schritt 1.
 *
 * ⚠️ Der Geist wird NICHT still weggeräumt. Ein Korb, der sich unter der Hand
 * selbst leert, ist am Tresen unheimlicher als einer, der sagt, was ihm
 * fehlt. Die Spalte nennt den Fall und bietet den Griff an.
 */

import { useQuery } from '@tanstack/react-query';

import { ApiError, type CustomerDetail, customersApi } from '@norns/api-client';

import { type Abfragestand, abfragestand } from '../../lib/abfragestand.js';
import { useApiClient } from '../../lib/api-context.js';
import { selectAnkaufCustomerId, useAnkaufCartStore } from '../../state/ankauf-cart-store.js';

export interface VerkaeuferStand {
  /** Die gemerkte Kennung, oder `null`. Sagt NICHTS über ihre Gültigkeit. */
  kennung: string | null;
  /** Der bestätigte Verkäufer, oder `null`. */
  verkaeufer: CustomerDetail | null;
  /**
   * ⛔ Die eine Frage, an der alles hängt: darf die Fläche weiterlaufen?
   *
   * Nur wahr, wenn die Bücher die Person bestätigt haben.
   */
  steht: boolean;
  /** Die gemerkte Kennung steht nicht mehr in den Büchern. */
  geist: boolean;
  /** Wie es der Abfrage geht — für die Spalte, die es sagen muss. */
  stand: Abfragestand;
}

/**
 * Der Stand des Verkäufers, aus EINER Quelle.
 *
 * Beide Leser (die Spalte und der Boden, der das Formular sperrt) rufen
 * diesen Haken. react-query fasst die Abfrage über den Schlüssel zusammen,
 * es läuft also trotzdem nur eine — und vor allem können die beiden nicht
 * verschiedener Meinung sein.
 */
export function useVerkaeuferStand(): VerkaeuferStand {
  const api = useApiClient();
  const kennung = useAnkaufCartStore(selectAnkaufCustomerId);

  const q = useQuery({
    queryKey: ['customers', kennung],
    queryFn: () => customersApi.get(api, kennung as string),
    enabled: kennung !== null,
    staleTime: 10_000,
  });

  /*
   * ── WARUM `failureReason` UND NICHT NUR `error` (20.08.2026) ────────────
   *
   * An der laufenden Kasse gemessen: nach zwei echten 404-Antworten stand
   * die Abfrage auf `status: 'pending'`, `fetchStatus: 'paused'` — und
   * `error` war LEER, weil react-query den Versuch noch nicht aufgegeben
   * hatte. Die Fläche hätte in diesem Augenblick „Keine Verbindung zum
   * Motor" gesagt, obwohl der Motor zweimal klar geantwortet hat: diese
   * Person steht nicht in den Büchern.
   *
   * `failureReason` trägt die letzte Absage AUCH während weiterversucht
   * wird. Eine eindeutige Auskunft schlägt eine Vermutung, und darum wird
   * sie zuerst gelesen.
   */
  const letzteAbsage = q.failureReason ?? q.error;
  const geist = letzteAbsage instanceof ApiError && letzteAbsage.code === 'NOT_FOUND';

  const stand: Abfragestand = geist
    ? { art: 'fehler', satz: 'Dieser Verkäufer steht nicht mehr in den Büchern.' }
    : abfragestand(q, () => 'Die Verkäuferdaten konnten nicht geladen werden.');

  return {
    kennung,
    verkaeufer: q.data ?? null,
    steht: kennung !== null && q.data !== undefined,
    geist,
    stand,
  };
}
