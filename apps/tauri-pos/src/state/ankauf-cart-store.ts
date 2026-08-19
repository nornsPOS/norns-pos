/**
 * ankauf-cart-store — production Ankauf intake (Day 8).
 *
 * Separate from `useCartStore` (Verkauf) by design. The two carts have
 * opposite cash-flow semantics and different lifecycle. Mixing would
 * confuse the persisted localStorage key, create cross-surface mutation
 * races, and muddle the audit story (clear() means different things).
 *
 * Persistence: Zustand `persist` middleware, key `w14.ankauf.v1`,
 * synchronous rehydrate from localStorage on page load. The store
 * survives crash + refresh — unlike Verkauf where the danger is a leaked
 * server-side reservation, here the items live only in the client until
 * the operator hits Bezahlen. NO server-side state to leak; the persisted
 * cart is purely a UX safety net for "don't lose the operator's typing".
 *
 * Invariants enforced at the store level:
 *   1. tempId is unique across items (the store generates it).
 *   2. All items must share the same `taxTreatmentCode` (matches the
 *      Verkauf invariant; mixed-treatment Phase 1.5).
 *   3. negotiatedPriceEur must parse as a positive decimal.
 *   4. The customer is single-valued; switching customers MUST go through
 *      `setCustomerId` which atomically clears items IF the change is to
 *      a different non-null id (defensive: cross-customer items would
 *      break the GwG identity recording).
 *
 * The store NEVER calls the network. It's purely a local state container.
 * The Ankauf coordinator owns the API calls.
 */

import { Type } from '@sinclair/typebox';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { parseResponse } from '@norns/api-client';
import type {
  AnkaufCondition,
  AnkaufItemType,
  AnkaufMetal,
  AnkaufPayoutMethod,
  TaxTreatmentCode,
} from '@norns/api-client';

// ────────────────────────────────────────────────────────────────────────
// Item shape — mirrors the api-client AnkaufLineItem but with `tempId` for
// list-key stability and decoupling from the eventual server-side product id.
// ────────────────────────────────────────────────────────────────────────

export interface IntakeItem {
  tempId: string;

  // Inventory shape
  sku: string;
  barcode: string;
  itemType: AnkaufItemType;
  metal: AnkaufMetal | null;
  karatCode: string;
  finenessDecimal: string;
  weightGrams: string;
  hallmarkStamps: string[];
  /** 0143: leer = keine (Muster karatCode). */
  seriennummer: string;
  gravur: string;
  condition: AnkaufCondition;
  taxTreatmentCode: TaxTreatmentCode;
  name: string;
  descriptionDe: string;
  listPriceEur: string;

  // Money
  negotiatedPriceEur: string;

  // Status decision
  publishImmediately: boolean;

  /** Timestamp the operator added the line — diagnostics + insertion order. */
  addedAt: string;
}

export type AddIntakeError =
  | { kind: 'MIXED_TAX_TREATMENT'; existing: TaxTreatmentCode; incoming: TaxTreatmentCode }
  | { kind: 'NEGOTIATED_PRICE_INVALID' };

interface AnkaufCartState {
  /** REQUIRED before any item can be added. Set via setCustomerId. */
  customerId: string | null;

  /** Payout method for the eventual Bezahlen step. CASH default. */
  payoutMethod: AnkaufPayoutMethod;
  /** Required for BANK_TRANSFER, blank for CASH. */
  payoutExternalRef: string;

  /** Free-text operator note attached to the transaction header. */
  notesInternal: string;

  items: IntakeItem[];

  // Actions
  setCustomerId: (id: string | null) => void;
  setPayoutMethod: (method: AnkaufPayoutMethod) => void;
  setPayoutExternalRef: (ref: string) => void;
  setNotesInternal: (notes: string) => void;

  addItem: (item: Omit<IntakeItem, 'tempId' | 'addedAt'>) => AddIntakeError | null;
  updateItem: (tempId: string, patch: Partial<Omit<IntakeItem, 'tempId' | 'addedAt'>>) => void;
  removeItem: (tempId: string) => void;

  /** Wipe items only (keeps customer). Operator uses this between sessions. */
  clearItems: () => void;

  /** Atomic snapshot + full reset — used post-finalize and sign-out. */
  snapshotAndReset: () => { items: IntakeItem[]; customerId: string | null };

  /** Hard reset everything (sign-out cascade). */
  reset: () => void;
}

const STORAGE_KEY = 'w14.ankauf.v1';

// Schema-validated rehydration (Phase 1.9). A corrupt persisted intake item —
// truncated write, manual edit, older/newer shape — would crash the buy-in math
// (sumNegotiatedCents / the KYC gate) on first render. Validate each item and
// DROP the malformed ones. taxTreatmentCode is checked strictly (it drives the
// fiscal gate); the display enums stay loose (their label maps handle unknowns).
const PersistedIntakeItemSchema = Type.Object({
  tempId: Type.String(),
  sku: Type.String(),
  barcode: Type.String(),
  itemType: Type.String(),
  metal: Type.Union([Type.String(), Type.Null()]),
  karatCode: Type.String(),
  /*
   * 0143: BEIDE optional plus ?? '' unten — zwei PFLICHTfelder haetten jeden
   * vor dem Update gespeicherten Korb beim ersten Start geleert (die
   * Wiederbelebung verwirft schema-fremde Zeilen mit Absicht).
   */
  seriennummer: Type.Optional(Type.String()),
  gravur: Type.Optional(Type.String()),
  finenessDecimal: Type.String(),
  weightGrams: Type.String(),
  hallmarkStamps: Type.Array(Type.String()),
  condition: Type.String(),
  taxTreatmentCode: Type.Union([
    Type.Literal('STANDARD_19'),
    Type.Literal('REDUCED_7'),
    Type.Literal('MARGIN_25A'),
    Type.Literal('INVESTMENT_GOLD_25C'),
    Type.Literal('REVERSE_CHARGE_13B'),
    Type.Literal('MIXED'),
  ]),
  name: Type.String(),
  descriptionDe: Type.String(),
  listPriceEur: Type.String(),
  negotiatedPriceEur: Type.String(),
  publishImmediately: Type.Boolean(),
  addedAt: Type.String(),
});

/** Validate persisted intake items, dropping any malformed one. For tests. */
export function sanitizeIntakeItems(raw: unknown): IntakeItem[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw.map((it) => parseResponse(PersistedIntakeItemSchema, it, 'ankauf.item'));
  // Structurally IntakeItem — the display enums are validated as plain strings
  // (their label maps degrade unknowns), so cast the validated rows.
  // 0143: Altzeilen von vor der Seriennummer bekommen '' statt undefined,
  // sonst truege der Typ eine Zeichenkette, die keine ist.
  return parsed
    .filter((it): it is NonNullable<typeof it> => it !== null)
    .map((it) => ({
      ...(it as IntakeItem),
      seriennummer: (it as { seriennummer?: string }).seriennummer ?? '',
      gravur: (it as { gravur?: string }).gravur ?? '',
    }));
}

let counter = 0;
function nextTempId(): string {
  counter += 1;
  return `ankauf-${Date.now()}-${counter}`;
}

function isPositiveDecimalString(s: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0;
}

export const useAnkaufCartStore = create<AnkaufCartState>()(
  persist(
    (set, get) => ({
      customerId: null,
      payoutMethod: 'CASH',
      payoutExternalRef: '',
      notesInternal: '',
      items: [],

      setCustomerId: (id) => {
        const prev = get().customerId;
        // Switching from one populated customer to another non-null customer:
        // wipe items because the existing draft inventory was negotiated for
        // a different seller. Owner intent is unambiguous on the customer panel.
        if (prev !== null && id !== null && prev !== id) {
          set({ customerId: id, items: [] });
          return;
        }
        set({ customerId: id });
      },

      setPayoutMethod: (method) => set({ payoutMethod: method }),
      setPayoutExternalRef: (ref) => set({ payoutExternalRef: ref }),
      setNotesInternal: (notes) => set({ notesInternal: notes }),

      addItem: (incoming) => {
        if (!isPositiveDecimalString(incoming.negotiatedPriceEur)) {
          return { kind: 'NEGOTIATED_PRICE_INVALID' };
        }
        const state = get();
        const first = state.items[0];
        if (first && first.taxTreatmentCode !== incoming.taxTreatmentCode) {
          return {
            kind: 'MIXED_TAX_TREATMENT',
            existing: first.taxTreatmentCode,
            incoming: incoming.taxTreatmentCode,
          };
        }
        const item: IntakeItem = {
          ...incoming,
          tempId: nextTempId(),
          addedAt: new Date().toISOString(),
        };
        set({ items: [...state.items, item] });
        return null;
      },

      updateItem: (tempId, patch) =>
        set((s) => ({
          items: s.items.map((it) => (it.tempId === tempId ? { ...it, ...patch } : it)),
        })),

      removeItem: (tempId) => set((s) => ({ items: s.items.filter((it) => it.tempId !== tempId) })),

      clearItems: () => set({ items: [] }),

      snapshotAndReset: () => {
        const snapshot = {
          items: get().items.slice(),
          customerId: get().customerId,
        };
        set({
          customerId: null,
          payoutMethod: 'CASH',
          payoutExternalRef: '',
          notesInternal: '',
          items: [],
        });
        return snapshot;
      },

      reset: () =>
        set({
          customerId: null,
          payoutMethod: 'CASH',
          payoutExternalRef: '',
          notesInternal: '',
          items: [],
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        customerId: state.customerId,
        payoutMethod: state.payoutMethod,
        payoutExternalRef: state.payoutExternalRef,
        notesInternal: state.notesInternal,
        items: state.items,
      }),
      // Validate every persisted item on rehydration; a corrupt one is dropped
      // rather than crashing the buy-in math on first render (Phase 1.9). Other
      // persisted fields keep the default shallow-merge behavior.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as object),
        items: sanitizeIntakeItems((persisted as { items?: unknown } | null)?.items),
      }),
      version: 1,
    },
  ),
);

// ────────────────────────────────────────────────────────────────────────
// Stable selectors
// ────────────────────────────────────────────────────────────────────────

export const selectAnkaufItems = (s: AnkaufCartState): IntakeItem[] => s.items;
export const selectAnkaufCustomerId = (s: AnkaufCartState): string | null => s.customerId;
export const selectAnkaufPayoutMethod = (s: AnkaufCartState): AnkaufPayoutMethod => s.payoutMethod;
