/**
 * theme-store — the SINGLE source of truth for the light / midnight-vellum theme
 * (Phase 7.1). It owns three things so nothing can drift:
 *   • the reactive `theme` value (components subscribe via `useTheme`),
 *   • the persisted preference (one localStorage key, `w14.theme`),
 *   • the `data-theme` attribute on <html> (applied on every change + on boot).
 *
 * Before 7.1 there were TWO theme systems — this Zustand store (`w14.theme`) and
 * an imperative `lib/theme.ts` (`warehouse14.theme`) — with different keys, so
 * the toggle button, the `Cmd+Shift+D` keybinding, and the boot paint could all
 * disagree. That module is gone; everything now reads/writes this store and
 * subscribes to it. `readInitial` migrates a pre-7.1 preference from the legacy
 * key so no operator's choice is lost.
 */

import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'w14.theme';
/** Pre-7.1 imperative-store key — read once so a saved choice survives the merge. */
const LEGACY_KEY = 'warehouse14.theme';

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored =
      window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* private mode / no storage — fall through to the OS preference */
  }
  // Honour the OS preference on first launch.
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

/** Flip the `data-theme` attribute — the only place the DOM is touched. */
function applyDom(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function persist(theme: Theme): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* quota / private mode — the in-page attribute still applies this session */
  }
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: readInitial(),
  toggle: () => {
    const next: Theme = get().theme === 'light' ? 'dark' : 'light';
    persist(next);
    applyDom(next);
    set({ theme: next });
  },
  set: (theme) => {
    persist(theme);
    applyDom(theme);
    set({ theme });
  },
}));

/**
 * Apply the persisted theme to <html> on cold boot (call once in main.tsx before
 * the first paint). The store already read the preference at module-load; this
 * just reflects it onto the DOM.
 */
export function initTheme(): void {
  applyDom(useTheme.getState().theme);
}
