/**
 * lager-filter-store — session-scoped filter state for the Lager surface.
 *
 * NOT persisted: filters are working-state, not multi-day. A new session
 * starts with status=all + no query. Pinning a filter overnight would
 * surprise the operator more than helping them.
 *
 * The store holds ONLY filter inputs. Product rows are owned by TanStack
 * Query keyed on these filters (`['products', 'list', filters]`).
 */

import { create } from 'zustand';

import type { ProductStatus } from '@norns/api-client';

export type StatusFilter = ProductStatus | 'ALL';

export interface LagerFilters {
  status: StatusFilter;
  q: string;
  /**
   * When a barcode scan pinpoints a single row, we store the scanned
   * value here. The TanStack query uses `barcode` for an exact match
   * (separate from the substring `q`).
   */
  barcode: string | null;
  itemType: string | null;
}

interface LagerFilterState extends LagerFilters {
  setStatus: (status: StatusFilter) => void;
  setQ: (q: string) => void;
  setBarcode: (barcode: string | null) => void;
  setItemType: (itemType: string | null) => void;
  /** Reset everything to the default open view. */
  clear: () => void;
}

const DEFAULT: LagerFilters = {
  status: 'ALL',
  q: '',
  barcode: null,
  itemType: null,
};

export const useLagerFilterStore = create<LagerFilterState>((set) => ({
  ...DEFAULT,
  setStatus: (status) => set({ status, barcode: null }),
  setQ: (q) => set({ q, barcode: null }),
  setBarcode: (barcode) => set({ barcode }),
  setItemType: (itemType) => set({ itemType, barcode: null }),
  clear: () => set({ ...DEFAULT }),
}));
