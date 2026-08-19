/**
 * Auto-release every RESERVED row whose reservation_expires_at < now().
 *
 * Run as a worker job every ~60 seconds (apps/worker). Idempotent — running
 * twice in the same minute releases nothing on the second pass.
 *
 * Returns the IDs that were released so the caller can emit a ledger event /
 * SSE notification per row.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ EIN STÜCK MIT LAUFENDER ZAHLUNG WIRD NICHT FREIGEGEBEN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bis zum 26.07.2026 gab diese Abfrage JEDE abgelaufene Reservierung
 * bedingungslos frei und wusste von Zahlungen nichts. Der Ablauf, der daraus
 * folgt, kostet ein Einzelstück und das Geld dazu:
 *
 *   1. Der Kunde legt ins Körbchen, das Stück wird RESERVED, Frist 15 Minuten.
 *   2. Der Kunde bezahlt. Bei Karte dauert das Sekunden, bei SEPA TAGE.
 *   3. Die Frist läuft ab. Dieser Aufräumer setzt das Stück auf AVAILABLE.
 *   4. Die Theke verkauft dasselbe Stück an einen Laufkunden.
 *   5. Die Bestätigung der Zahlung trifft ein und ruft `finalize`, das
 *      `status = 'RESERVED'` verlangt. Es findet nichts und wirft, FÜR IMMER.
 *
 * Ergebnis: Geld genommen, Einzelstück weg, und kein Wiederholungsversuch der
 * Welt kann es heilen, weil der Zustand RESERVED nie zurückkommt.
 *
 * Die einzige Reparatur ist, gar nicht erst freizugeben, solange eine Zahlung
 * offen ist.
 *
 * ── Die Bedingung ist bewusst eine VERNEINUNG ─────────────────────────────
 *
 * Ein Zahlungsvorgang steht in `payment_intents` an einem Korb, und der Korb
 * trägt die `reservation_session_id`, mit der das Stück reserviert wurde. Über
 * diese Kennung, nicht über das Stück, hängen die beiden zusammen.
 *
 * Freigegeben wird nur, wenn die Zahlung NEGATIV entschieden ist: FAILED,
 * CANCELED, EXPIRED. Alles andere hält das Stück fest.
 *
 * Der erste Anlauf dieser Reparatur zählte stattdessen auf, was offen IST
 * (CREATED, PENDING), und eine Probe am 26.07.2026 zeigte sofort, warum das
 * falsch ist: **SUCCEEDED wäre freigegeben worden.** Ein Stück, das noch
 * RESERVED ist, obwohl die Zahlung erfolgreich war, ist der gefährlichste
 * Zustand von allen. Es heisst, dass `finalize` nicht durchkam. Das Geld ist
 * genommen, und dieser Aufräumer hätte die Ware zurück ins Regal gelegt.
 *
 * Deshalb die Verneinung: ein Zahlungszustand, den niemand aufgezählt hat,
 * verhindert die Freigabe, statt sie zu erlauben. Kommt später ein Zustand
 * dazu (`REFUNDED`, `DISPUTED`, `PAID_UNCONFIRMED`), ist die Vorgabe sicher,
 * und niemand muss daran denken.
 *
 * ── Und der Preis dieser Regel, ehrlich benannt ───────────────────────────
 *
 * Ein Vorgang, der in PENDING steckenbleibt, hält das Stück fest, bis ihn
 * jemand auf FAILED oder EXPIRED setzt. Das ist die richtige Richtung: ein
 * Stück zu lange festzuhalten ist ärgerlich, es zweimal zu verkaufen ist ein
 * Schaden. Wer das Stecken abkürzen will, lässt Zahlungsvorgänge altern, statt
 * hier die Bedingung zu lockern.
 *
 * ── Warum die Kassen-Reservierung davon unberührt bleibt ──────────────────
 *
 * POS-Reservierungen tragen `reservation_expires_at = NULL` und werden von
 * `autoReleaseStalePos` behandelt, nicht hier. Diese Abfrage sieht sie nicht.
 */

import type { AnyDb } from '@norns/db/client';
import { sql } from 'drizzle-orm';

export async function autoReleaseExpired(db: AnyDb): Promise<string[]> {
  const result = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    UPDATE products p
       SET status                 = 'AVAILABLE',
           reserved_by_channel    = NULL,
           reserved_by_session_id = NULL,
           reserved_by_user_id    = NULL,
           reserved_at            = NULL,
           reservation_expires_at = NULL
     WHERE p.status                 = 'RESERVED'
       AND p.reservation_expires_at IS NOT NULL
       AND p.reservation_expires_at < now()
       AND NOT EXISTS (
             SELECT 1
               FROM payment_intents pi
               JOIN carts c ON c.id = pi.cart_id
              WHERE c.reservation_session_id = p.reserved_by_session_id
                -- VERNEINUNG, nicht Aufzählung: nur eine negativ entschiedene
                -- Zahlung gibt das Stück frei. Siehe den Kopf dieser Datei.
                AND pi.status NOT IN ('FAILED', 'CANCELED', 'EXPIRED')
           )
   RETURNING p.id
  `);

  return result.map((r) => r.id);
}
