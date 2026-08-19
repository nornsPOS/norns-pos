/**
 * Finalize a reservation — RESERVED → SOLD.
 *
 * Called after the payment is confirmed:
 *   • POS card sale completed via ZVT
 *   • Storefront Mollie payment.succeeded webhook
 *   • eBay order paid
 *
 * Ownership guards (memory.md §19.2 C-1 fix):
 *   • `status = 'RESERVED'`                                   — must be reserved
 *   • `reserved_by_session_id = ${sessionId}`                 — same checkout session
 *   • `reserved_by_user_id IS NOT DISTINCT FROM ${userId}`    — same operator
 *
 * The `IS NOT DISTINCT FROM` operator treats NULL = NULL — required so a
 * STOREFRONT guest reservation (user_id NULL) can be finalized by the
 * webhook passing `userId: null`. A logged-in cashier always passes their
 * actor id; the row's user_id was populated at reserve() time from the
 * same source, so a different operator cannot finalize a reservation that
 * wasn't theirs (closes the cross-cashier stale-cart exploit).
 *
 * Throws ReservationOwnershipError on mismatch — the caller should re-fetch
 * state. If the row is already SOLD (a rare duplicate webhook), the UPDATE
 * affects zero rows and the error surfaces so the caller can decide whether
 * to ignore (idempotent finalize) or alert.
 */

import type { AnyDb } from '@norns/db/client';
import { sql } from 'drizzle-orm';

import { ReservationOwnershipError } from './errors.js';
import type { FinalizeInput } from './types.js';

export async function finalize(db: AnyDb, input: FinalizeInput): Promise<void> {
  const { productId, sessionId, userId } = input;

  const result = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    UPDATE products
       SET status  = 'SOLD',
           sold_at = now()
     WHERE id                     = ${productId}::uuid
       AND status                 = 'RESERVED'
       AND reserved_by_session_id = ${sessionId}::uuid
       AND reserved_by_user_id    IS NOT DISTINCT FROM ${userId}::uuid
   RETURNING id
  `);

  if (result.length === 0) {
    throw new ReservationOwnershipError(productId);
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ALLE STÜCKE EINES BELEGS IN EINEM SATZ (19.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gemessen: `transactions-finalize` rief `finalize` je Stück auf — N
 * Rundreisen zur Datenbank, WÄHREND die Tagessperre gehalten wird. Der
 * Abschluss des Tages und jeder parallele Verkauf warten so lange. Die Pause
 * liegt genau zwischen „Bezahlen" und dem Bon, mit dem Kunden davor, und sie
 * wächst mit dem Korb.
 *
 * Ein UPDATE über `unnest` erledigt alle Stücke in EINER Rundreise. Die
 * Eigentumsprüfung bleibt Zeile für Zeile dieselbe — Stück und Sitzung werden
 * PAARWEISE entrollt, damit ein Stück nicht mit der Sitzung eines anderen
 * finalisiert werden kann.
 *
 * Fehlerbild bleibt gleich fein: die zurückgegebenen Ids werden gegen die
 * Eingabe gehalten, und das ERSTE fehlende Stück wird gemeldet — wie zuvor,
 * nur ohne die N Rundreisen. Die Transaktion rollt ohnehin zurück, es gibt
 * also keinen halben Erfolg.
 */
export async function finalizeViele(
  db: AnyDb,
  inputs: readonly FinalizeInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  if (inputs.length === 1) {
    // Der Einzelfall ist der Alltag — er behält den schlanken Weg.
    await finalize(db, inputs[0] as FinalizeInput);
    return;
  }

  // ⚠️ Als Postgres-Arrayliteral gebunden, nicht als JS-Array — dieselbe
  // Lehre wie in transactions-finalize.ts (no-array-spread).
  const ids = `{${inputs.map((i) => i.productId).join(',')}}`;
  const sessions = `{${inputs.map((i) => i.sessionId).join(',')}}`;
  // Ein Beleg hat EINEN Finalisierer: entweder die Kassiererin oder (bei der
  // Web-Abholung) niemand. Gemischte userIds wären ein Programmierfehler.
  const userId = inputs[0]?.userId ?? null;

  const result = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    UPDATE products p
       SET status  = 'SOLD',
           sold_at = now()
      FROM unnest(${ids}::uuid[], ${sessions}::uuid[]) AS w(id, session)
     WHERE p.id                     = w.id
       AND p.status                 = 'RESERVED'
       AND p.reserved_by_session_id = w.session
       AND p.reserved_by_user_id    IS NOT DISTINCT FROM ${userId}::uuid
   RETURNING p.id
  `);

  if (result.length !== inputs.length) {
    const gelungen = new Set(result.map((r) => r.id));
    const fehlt = inputs.find((i) => !gelungen.has(i.productId));
    throw new ReservationOwnershipError(fehlt?.productId ?? inputs[0]!.productId);
  }
}
