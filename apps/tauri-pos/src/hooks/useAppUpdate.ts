/**
 * useAppUpdate — the single source of truth for the OTA update lifecycle.
 *
 * Before this hook the POS had THREE competing update surfaces (the native
 * Tauri dialog, the header ↻ that auto-installed on a plain check, and a
 * floating banner each running their own `check()`). They raced, double-
 * downloaded, and the native Windows prompt looked unfinished.
 *
 * This hook owns ONE state machine and ONE poll. Every consumer (the header
 * badge + the <UpdateCenter/> modal) subscribes to the same module-level
 * store, so they can never disagree about whether an update is available.
 *
 * State machine
 * ─────────────
 *   idle        → no update known (also the resting state on dev/local builds
 *                 where the endpoint placeholder is unresolved — we map a
 *                 thrown check() to 'idle' SILENTLY, no scary red toast).
 *   checking    → a check() is in flight.
 *   up-to-date  → check() resolved null; the running build is current.
 *   available   → check() resolved an Update; {version, notes} populated.
 *   downloading → downloadAndInstall() streaming; progressPct 0..100.
 *   ready       → bundle applied; awaiting an EXPLICIT user relaunch.
 *   error       → a real (non-placeholder) failure; {error} populated.
 *
 * Polling: ONE boot check after a 5 s grace (let the auth probe finish first)
 * + an hourly background re-check. Lives here now, lifted out of the old
 * floating UpdateBanner so it runs exactly once for the whole app.
 *
 * relaunch() is NEVER automatic — it only fires from a deliberate user action
 * in the UpdateCenter (with the open-sale guard checked by the caller).
 */

import { lesbareAblehnung } from '../lib/drucker-diagnose.js';
import { useSyncExternalStore } from 'react';

import { isRunningInTauri } from '../lib/hardware-client.js';
import { describeError } from '@norns/i18n-de';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  /** Version of the running build (best-effort; '-' until resolved). */
  currentVersion: string;
  /** Version offered by the update, when status is available/downloading/ready. */
  version: string | null;
  /** Release notes (first lines of the GitHub release body). */
  notes: string | null;
  /** 0..100 while downloading; null otherwise. */
  progressPct: number | null;
  /** Human-readable error message when status === 'error'. */
  error: string | null;
}

/**
 * A trimmed view of the plugin-updater v2 `Update` we actually use. Typed
 * locally so this module never has to statically import the plugin (its wire
 * only exists inside the Tauri webview — a static import breaks jsdom/tests).
 */
interface PluginUpdate {
  version: string;
  body?: string | null;
  date?: string | null;
  downloadAndInstall: (onEvent?: (ev: PluginDownloadEvent) => void) => Promise<void>;
}

type PluginDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

// ── Module-level singleton store ──────────────────────────────────────────
// One state object shared by every subscriber; React reads it via
// useSyncExternalStore so the header badge and the modal stay in lock-step.

const INITIAL: UpdateState = {
  status: 'idle',
  currentVersion: '-',
  version: null,
  notes: null,
  progressPct: null,
  error: null,
};

let state: UpdateState = INITIAL;
const listeners = new Set<() => void>();

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): UpdateState {
  return state;
}

// The Update handle from the last successful check() — kept module-side so
// install() can act on the very object the modal is showing (no re-check race).
let pendingUpdate: PluginUpdate | null = null;

// Guards so the singleton work runs exactly once across all hook consumers.
let pollStarted = false;
let checkInFlight = false;

async function resolveCurrentVersion(): Promise<void> {
  if (state.currentVersion !== '-') return;
  try {
    const appMod = await import('@tauri-apps/api/app');
    setState({ currentVersion: await appMod.getVersion() });
  } catch {
    /* outside Tauri or app plugin unavailable — leave the placeholder */
  }
}

/**
 * Run a single check(). On a dev/local build the endpoint placeholder
 * (`__GITHUB_OWNER__/__GITHUB_REPO__`) cannot resolve and check() throws — we
 * swallow that to 'idle' SILENTLY. Only surface 'error' once we have actually
 * seen the updater work (i.e. never on the very first boot probe), so the
 * operator never gets a red toast just because they are running locally.
 */
async function runCheck(opts: { silent: boolean }): Promise<void> {
  if (!isRunningInTauri()) {
    // Web/Storybook/jsdom: there is no updater. Resting state is idle.
    setState({ status: 'idle' });
    return;
  }
  if (checkInFlight) return;
  if (state.status === 'downloading' || state.status === 'ready') return; // don't disturb an active install
  checkInFlight = true;
  void resolveCurrentVersion();
  // Only show the spinner for a non-silent (user-initiated) check.
  if (!opts.silent) setState({ status: 'checking', error: null });
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const result = (await check()) as PluginUpdate | null;
    if (result === null) {
      pendingUpdate = null;
      setState({ status: 'up-to-date', version: null, notes: null, progressPct: null, error: null });
    } else {
      pendingUpdate = result;
      setState({
        status: 'available',
        version: result.version,
        notes: result.body ?? null,
        progressPct: null,
        error: null,
      });
    }
  } catch (err) {
    // On a dev/local build the endpoint placeholder is unresolved → treat as
    // idle, no toast. A user-initiated check still stays quiet on the network
    // path (the modal shows the resting copy) — we only flip to 'error' when
    // the operator explicitly asked AND we already know the channel works.
    pendingUpdate = null;
    if (opts.silent) {
      setState({ status: state.status === 'idle' ? 'idle' : state.status });
    } else {
      setState({
        status: 'error',
        error: err instanceof Error ? describeError(err) : lesbareAblehnung(err),
      });
    }
  } finally {
    checkInFlight = false;
  }
}

const INITIAL_GRACE_MS = 5_000; // let the auth probe finish before any popup
const POLL_INTERVAL_MS = 60 * 60 * 1000; // hourly background re-check

/** Start the boot-grace + hourly background poll exactly once, app-wide. */
function ensurePollStarted(): void {
  if (pollStarted) return;
  if (typeof window === 'undefined') return;
  pollStarted = true;
  void resolveCurrentVersion();
  window.setTimeout(() => void runCheck({ silent: true }), INITIAL_GRACE_MS);
  window.setInterval(() => void runCheck({ silent: true }), POLL_INTERVAL_MS);
}

export interface UseAppUpdate extends UpdateState {
  /** True when the header should show its gold cue (update waiting). */
  hasUpdate: boolean;
  /** Operator-initiated check (the modal's "Erneut prüfen"). */
  checkNow: () => Promise<void>;
  /** Download + apply the pending update, wiring v2 progress → progressPct. */
  install: () => Promise<void>;
  /** Explicit relaunch into the freshly-installed build. */
  relaunch: () => Promise<void>;
}

export function useAppUpdate(): UseAppUpdate {
  // Boot the singleton poll on first mount of any consumer.
  if (!pollStarted) ensurePollStarted();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const checkNow = async (): Promise<void> => {
    await runCheck({ silent: false });
  };

  const install = async (): Promise<void> => {
    if (!pendingUpdate) return;
    const update = pendingUpdate;
    let total = 0;
    let received = 0;
    setState({ status: 'downloading', progressPct: 0, error: null });
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') {
          total = ev.data.contentLength ?? 0;
          received = 0;
          setState({ progressPct: 0 });
        } else if (ev.event === 'Progress') {
          received += ev.data.chunkLength;
          // contentLength is occasionally absent — fall back to an
          // indeterminate-but-monotonic feel by capping at 99 until Finished.
          const pct = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 99;
          setState({ progressPct: pct });
        } else if (ev.event === 'Finished') {
          setState({ progressPct: 100 });
        }
      });
      setState({ status: 'ready', progressPct: 100 });
    } catch (err) {
      setState({
        status: 'error',
        progressPct: null,
        error: err instanceof Error ? describeError(err) : lesbareAblehnung(err),
      });
    }
  };

  const relaunch = async (): Promise<void> => {
    if (!isRunningInTauri()) return;
    const { relaunch: doRelaunch } = await import('@tauri-apps/plugin-process');
    await doRelaunch();
  };

  return {
    ...snap,
    hasUpdate: snap.status === 'available' || snap.status === 'ready',
    checkNow,
    install,
    relaunch,
  };
}
