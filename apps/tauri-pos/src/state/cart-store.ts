/**
 * cart-store — production Verkauf cart (replaces Day-2 cart-demo-store).
 *
 * RESERVATION-AWARE state container. Every line carries the reservation
 * sessionId it was created with — that ID is the only thing the backend
 * accepts on /api/inventory/release. The store MUST never lose those IDs.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Persistence (Phase 2 Day 7 hardening)
 * ────────────────────────────────────────────────────────────────────────
 * Because POS reservations have NO server-side TTL (migration 0006 CHECK:
 * `reserved_by_channel='POS' ⇒ reservation_expires_at IS NULL`) the worker
 * sweeper does NOT clean up after a crashed POS. If the operator's window
 * dies mid-cart and we don't keep the sessionIds, those products become
 * silently unreservable for any other channel until an Owner manually
 * intervenes. To prevent that, the cart is persisted to localStorage via
 * Zustand's `persist` middleware (synchronous rehydrate — appears on first
 * render). On next launch:
 *   • the operator sees their cart exactly as left
 *   • clicking "Karte leeren" fires the actual `inventoryApi.release` per
 *     line (the IDs survived the crash) — no leak
 *   • clicking Bezahlen finalises against the SAME sessionIds — backend
 *     matches and converts RESERVED → SOLD as if nothing happened
 *
 * Storage key: `w14.cart.v1`. The `v1` version segment lets a future
 * schema change ignore old shapes (Zustand's `migrate` callback) without
 * crashing the operator's terminal.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Invariants enforced at the store boundary
 * ────────────────────────────────────────────────────────────────────────
 *   1. No two lines share the same productId — `addLine` returns
 *      ALREADY_IN_CART if you try to push a duplicate (defensive: the
 *      reservation API would itself refuse a second hold).
 *   2. All lines must share the same `taxTreatmentCode` — V1 ships one
 *      tax-treatment per cart; mixed carts arrive in Phase 1.5 with the
 *      split-payments code path.
 *   3. Insertion order is preserved (Roman-numeral cart numbering).
 *   4. State preservation across surface switches: lines live OUTSIDE
 *      the React tree. Switching to Werkstatt and back rehydrates
 *      synchronously — no lost work.
 *   5. The store NEVER calls APIs. Reservation + release happens in the
 *      Verkauf coordinator; the store only mutates after the network
 *      side has confirmed. This keeps the store deterministic + testable.
 *
 * Selectors are exported with stable identities so screen components can
 * `useCartStore(selectCartLines)` without re-rendering on unrelated state
 * changes. Derived computations (totals, tax aggregates) live in
 * `cart-math.ts` and are memoized by the consuming screen.
 */

import { Type } from '@sinclair/typebox';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { type TaxTreatmentCode, parseResponse } from '@norns/api-client';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface CartLine {
  productId: string;
  /**
   * Reservation session id — the sole proof on the backend that THIS
   * cart holds the inventory lock. Persisted; survives crash + refresh.
   */
  reservationSessionId: string;

  /** Snapshot fields the cart row needs to render without re-fetching. */
  sku: string;
  name: string;
  listPriceEur: string;
  acquisitionCostEur: string;
  taxTreatmentCode: TaxTreatmentCode;

  /**
   * Rabatt on this line, as a non-negative EUR decimal string ("5.00"), or
   * undefined for no discount. Tax is recomputed on the net price; the amount
   * is reported separately (GoBD, migration 0019). A non-zero discount REQUIRES
   * `discountReason` — the backend rejects otherwise.
   */
  discountEur?: string | undefined;
  /** Operator's reason for the Rabatt — mandatory whenever discountEur > 0. */
  discountReason?: string | undefined;

  /** Wall-clock when the item was added — diagnostics + ordering tiebreak. */
  addedAt: string;
}

export type AddItemError =
  | { kind: 'MIXED_TAX_TREATMENT'; existing: TaxTreatmentCode; incoming: TaxTreatmentCode }
  | { kind: 'ALREADY_IN_CART' };

interface CartState {
  lines: CartLine[];

  /**
   * Abholung einer Web-Reservierung (0099): die Bestellnummer, wenn die Karte
   * NICHT ein frischer Kassenverkauf ist, sondern eine geladene Online-
   * Bestellung, die übergeben wird. `null` im Normalfall.
   *
   * Warum im Store und nicht als Prop: der Kassen-Finalize-Pfad liegt tief in
   * `BezahlenDialog`, und der Beleg muss `webOrderNumber` im Body tragen, sonst
   * bleibt die Bestellung RESERVED und wird nie als abgeholt verbucht. Der Store
   * ist die eine Stelle, die alle Beteiligten (Verkauf-Koordinator, CartPanel,
   * BezahlenDialog) ohnehin lesen — so kann keiner es „vergessen".
   *
   * WICHTIG: Ist das gesetzt, gehören die Reservierungen dem Storefront (server-
   * seitig `reserved_by_user_id IS NULL`), NICHT der Kasse. Der Verkauf-
   * Koordinator gibt sie darum beim Leeren/Schließen NICHT über die POS-Freigabe
   * frei (die würde ohnehin mit 409 abprallen und die Kundschaft-Reservierung
   * fälschlich anfassen). Eine abgebrochene Übergabe lässt die Online-
   * Reservierung unberührt; sie hat ihre eigene Frist.
   */
  webOrderNumber: string | null;

  /**
   * Push a fresh line. Returns null on success, or an error tag the
   * caller surfaces as a brand-themed toast. The caller MUST have
   * completed the reservation API call before invoking this.
   */
  addLine: (line: CartLine) => AddItemError | null;

  /** Remove a line by productId. Returns the line (so caller can release). */
  removeLine: (productId: string) => CartLine | null;

  /**
   * Set or clear the Rabatt on a line. Passing `eur === null` (or '0') clears
   * it. The store does no tax math — it only records intent; `cart-math`
   * recomputes the line from `discountEur`.
   */
  setLineDiscount: (productId: string, eur: string | null, reason: string) => void;

  /**
   * Snapshot every line and clear the store atomically. Returns the
   * snapshot so the caller can fire releases against the now-orphaned
   * sessionIds. Used by:
   *   • "Karte leeren" CTA in CartPanel
   *   • sign-out cascade in AppShell (must release before clear)
   *   • post-finalize cleanup in BezahlenDialog (server already cleared
   *     them via SOLD transition, so the snapshot is ignored)
   */
  snapshotAndClear: () => CartLine[];

  /** Wipe without snapshot — used internally by snapshotAndClear + tests. */
  clearCart: () => void;

  /**
   * Eine geladene Web-Bestellung als Karte übernehmen (0099). Ersetzt die
   * Karte vollständig durch die übergebenen Positionen (jede trägt die EINE
   * Reservierungs-Sitzung der Bestellung) und merkt sich die Bestellnummer, die
   * der Finalize-Body dann als `webOrderNumber` trägt. Der Aufrufer hat die
   * Positionen bereits aus der Bestellung + den Artikeldetails gebaut (Preis =
   * der reservierte Preis, Steuerklasse aus dem Artikel) — der Store reserviert
   * NICHT (die Stücke sind schon web-gehalten) und ruft keine API.
   */
  loadWebOrder: (webOrderNumber: string, lines: CartLine[]) => void;

  /** O(N) lookup; fine for V1 carts capped at ~20 lines. */
  findLine: (productId: string) => CartLine | undefined;
}

// ────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'w14.cart.v1';

// Schema-validated rehydration (Phase 1.9). localStorage is untrusted: a
// truncated write, a manual edit, or an older/newer shape can leave a corrupt
// line that, once handed to `computeLineMath`, throws and WHITE-SCREENS the
// till mid-shift. Validate each persisted line and DROP the malformed ones —
// the operator loses that one line, not the whole terminal. taxTreatmentCode is
// checked against the exact enum because it drives the fiscal tax math.
const PersistedCartLineSchema = Type.Object({
  productId: Type.String(),
  reservationSessionId: Type.String(),
  sku: Type.String(),
  name: Type.String(),
  listPriceEur: Type.String(),
  acquisitionCostEur: Type.String(),
  taxTreatmentCode: Type.Union([
    Type.Literal('STANDARD_19'),
    Type.Literal('REDUCED_7'),
    Type.Literal('MARGIN_25A'),
    Type.Literal('INVESTMENT_GOLD_25C'),
    Type.Literal('REVERSE_CHARGE_13B'),
    Type.Literal('MIXED'),
  ]),
  discountEur: Type.Optional(Type.String()),
  discountReason: Type.Optional(Type.String()),
  addedAt: Type.String(),
});

/** Validate persisted lines, dropping any malformed one. Exported for tests. */
export function sanitizeCartLines(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw.map((line) => parseResponse(PersistedCartLineSchema, line, 'cart.line'));
  // The validated shape is structurally CartLine — the only gap is the schema's
  // optional fields being `string` vs CartLine's `string | undefined` under
  // exactOptionalPropertyTypes, which is identical for persisted JSON.
  return parsed.filter((line): line is NonNullable<typeof line> => line !== null) as CartLine[];
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      webOrderNumber: null,

      addLine: (incoming) => {
        const state = get();

        // Rule 1: no duplicate productId.
        if (state.lines.some((l) => l.productId === incoming.productId)) {
          return { kind: 'ALREADY_IN_CART' };
        }

        // Rule 2: all lines must share one tax treatment. V1 has no
        // split-payment / mixed-treatment fiscal path, so a §25a piece and a
        // 19 % piece in one receipt would be signed under a single, WRONG
        // treatment. Reject the second treatment at the store boundary; the
        // caller releases the just-made hold and surfaces a German toast.
        const existingTreatment = state.lines[0]?.taxTreatmentCode;
        if (existingTreatment !== undefined && existingTreatment !== incoming.taxTreatmentCode) {
          return {
            kind: 'MIXED_TAX_TREATMENT',
            existing: existingTreatment,
            incoming: incoming.taxTreatmentCode,
          };
        }

        set({ lines: [...state.lines, incoming] });
        return null;
      },

      removeLine: (productId) => {
        const target = get().lines.find((l) => l.productId === productId);
        if (!target) return null;
        set((s) => ({ lines: s.lines.filter((l) => l.productId !== productId) }));
        return target;
      },

      setLineDiscount: (productId, eur, reason) => {
        const clear = eur === null || eur === '' || Number(eur) <= 0;
        set((s) => ({
          lines: s.lines.map((l) =>
            l.productId === productId
              ? clear
                ? { ...l, discountEur: undefined, discountReason: undefined }
                : { ...l, discountEur: eur, discountReason: reason.trim() }
              : l,
          ),
        }));
      },

      snapshotAndClear: () => {
        const snapshot = get().lines.slice();
        // Auch die Web-Bestell-Markierung fällt weg: eine geleerte Karte ist
        // keine Übergabe mehr, und der nächste Beleg darf keine fremde
        // `webOrderNumber` erben.
        set({ lines: [], webOrderNumber: null });
        return snapshot;
      },

      clearCart: () => set({ lines: [], webOrderNumber: null }),

      loadWebOrder: (webOrderNumber, lines) => set({ lines: lines.slice(), webOrderNumber }),

      findLine: (productId) => get().lines.find((l) => l.productId === productId),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist `lines` + the Web-Bestell-Markierung — the action closures
      // are recreated every boot anyway, and persisting functions would explode
      // JSON. `webOrderNumber` muss mit, sonst verlöre ein Absturz mitten in der
      // Übergabe die Bindung, und der wiederhergestellte Beleg buchte den
      // Verkauf ohne die Bestellung als abgeholt zu verbuchen.
      partialize: (state) => ({ lines: state.lines, webOrderNumber: state.webOrderNumber }),
      // Validate every persisted line on rehydration; a corrupt one is dropped
      // rather than crashing computeLineMath on first render (Phase 1.9).
      merge: (persisted, current) => {
        const p = persisted as { lines?: unknown; webOrderNumber?: unknown } | undefined;
        const lines = sanitizeCartLines(p?.lines);
        const won =
          typeof p?.webOrderNumber === 'string' && p.webOrderNumber.length > 0
            ? p.webOrderNumber
            : null;
        return {
          ...current,
          lines,
          // Eine Web-Übergabe nur wiederherstellen, wenn auch Positionen
          // überlebt haben — sonst hinge eine Bestellnummer über einer leeren
          // Karte und der nächste Finalize versuchte, eine Bestellung ohne
          // passende Positionen abzuhaken.
          webOrderNumber: lines.length > 0 ? won : null,
        };
      },
      // Phase 1.5 hook: bump this when CartLine shape changes.
      version: 1,
    },
  ),
);

// ────────────────────────────────────────────────────────────────────────
// Stable selectors — pin these identities so screens don't re-render on
// unrelated state changes.
// ────────────────────────────────────────────────────────────────────────

export const selectCartLines = (s: CartState): CartLine[] => s.lines;
export const selectCartCount = (s: CartState): number => s.lines.length;
/** Die Bestellnummer, wenn die Karte eine geladene Web-Abholung ist, sonst null. */
export const selectWebOrderNumber = (s: CartState): string | null => s.webOrderNumber;
export const selectCartTaxTreatment = (s: CartState): TaxTreatmentCode | null => {
  if (s.lines.length === 0) return null;
  const first = s.lines[0]!.taxTreatmentCode;
  const allSame = s.lines.every((l) => l.taxTreatmentCode === first);
  return allSame ? first : 'MIXED';
};
