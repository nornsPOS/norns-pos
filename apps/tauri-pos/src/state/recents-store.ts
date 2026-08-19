/**
 * recents-store — the last few surfaces the operator visited.
 *
 * Used by Spotlight's "Zuletzt" section. Capped at 3 entries (memory.md
 * §11.6). Sign-out clears.
 */

import { create } from 'zustand';

const CAP = 3;

interface RecentsState {
  paths: string[];
  push: (path: string) => void;
  clear: () => void;
}

export const useRecents = create<RecentsState>((set) => ({
  paths: [],
  push: (path) =>
    set((state) => {
      // De-dupe + put on top.
      const filtered = state.paths.filter((p) => p !== path);
      const next = [path, ...filtered];
      if (next.length > CAP) next.length = CAP;
      return { paths: next };
    }),
  clear: () => set({ paths: [] }),
}));
