/**
 * bewertung-store — Day 11 surface state, persisted to localStorage.
 *
 * The appraisal itself is server-of-record (the `appraisals` row + its
 * children). This store holds ONLY:
 *   • The active appraisal id (so F5 rehydrates straight to the workspace)
 *   • The pre-open customer pick (only used between "selected customer"
 *     and "POST /api/appraisals" success)
 *
 * Persistence rationale: an estate appraisal can span minutes-to-hours
 * of operator data entry. An accidental F5 must not lose progress. The
 * server-of-record items survive automatically; we only need to remember
 * which appraisal id we're on.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface BewertungState {
  /** Server-side appraisal id; null = no active appraisal. */
  appraisalId: string | null;
  /** Customer selected pre-open. Cleared once an appraisal exists. */
  customerId: string | null;

  setAppraisalId: (id: string | null) => void;
  setCustomerId: (id: string | null) => void;
  /** Sign-out cascade + post-finalisation reset. */
  reset: () => void;
}

const STORAGE_KEY = 'w14.bewertung.v1';

export const useBewertungStore = create<BewertungState>()(
  persist(
    (set) => ({
      appraisalId: null,
      customerId: null,
      setAppraisalId: (id) => set({ appraisalId: id }),
      setCustomerId: (id) => set({ customerId: id }),
      reset: () => set({ appraisalId: null, customerId: null }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        appraisalId: state.appraisalId,
        customerId: state.customerId,
      }),
      version: 1,
    },
  ),
);

export const selectAppraisalId = (s: BewertungState): string | null => s.appraisalId;
export const selectBewertungCustomerId = (s: BewertungState): string | null => s.customerId;
