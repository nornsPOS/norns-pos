/**
 * UpdateBanner — DEPRECATED, intentionally inert.
 *
 * The floating update pill (with its own `check()` + hourly poll + relaunch)
 * was one of three competing update UIs. It has been superseded by the single
 * unified surface:
 *
 *   • `hooks/useAppUpdate.ts`        — the one state machine + the one poll
 *   • `app/chrome/UpdateCenter.tsx`  — the one German modal (states + progress)
 *   • `app/chrome/UpdateButton.tsx`  — the header ↻ trigger + gold cue
 *
 * The native Tauri dialog is disabled in `tauri.conf.json`
 * (`plugins.updater.dialog = false`). This component no longer floats anything
 * and is mounted nowhere; it is kept only as a harmless re-export so any stray
 * import resolves to a no-op instead of failing the build. Safe to delete once
 * confirmed unused.
 */

export function UpdateBanner(): JSX.Element | null {
  return null;
}
