/**
 * hardware-reprobe — die Lebendigkeit der Geraete: Entscheidung, Zeitgeber und
 * das Eintragen einer echten Messung.
 *
 * KORREKTUR AM KOPFKOMMENTAR (26.07.2026)
 * Hier stand bis heute woertlich, die Anbindung „lebt in useHardwareAutoConnect
 * und ist live geprueft". Das war falsch. `shouldReprobe` hatte NULL Aufrufer
 * ausserhalb seiner eigenen Testdatei: kein Zeitgeber, kein `visibilitychange`,
 * kein Import. Neun gruene Pruefungen fuer eine Funktion, die im laufenden
 * Programm niemand fragte — und ein Kommentar, der genau das Gegenteil
 * behauptete, liess den naechsten Menschen aufhoeren zu suchen. Ein Kommentar,
 * der eine Anbindung erfindet, ist schlimmer als gar keiner.
 *
 * Deshalb liegt der Klebstoff jetzt HIER, ohne React und ohne DOM, und ist
 * damit selbst messbar: `startReprobeLoop` haelt den Zeitgeber, den
 * Sichtbarkeitswechsel und die Einfachbelegung. Der Haken ruft nur noch auf.
 *
 * Die Entscheidung bleibt bewusst vorsichtig: ein erneutes Messen erfolgt nur,
 * wenn JEDE Bedingung haelt — so kann ein Zeittakt weder ein Geraet bedraengen
 * noch in einen laufenden Vorgang hineinfahren.
 */

import { type HardwareErrorKind, isHardwareError } from './hardware-client.js';
import { type HardwareProbeKind, markDeviceReachable } from '../state/hardware-store.js';

/** Default idle gap between mid-shift re-probes. */
export const DEFAULT_REPROBE_INTERVAL_MS = 90_000;

export interface ReprobeContext {
  /** Now, in epoch milliseconds. */
  nowMs: number;
  /** When the last probe sweep completed (epoch ms), or null if never probed. */
  lastSweepAtMs: number | null;
  /** Minimum idle gap between re-probes, in milliseconds. */
  intervalMs: number;
  /** The tab/window is hidden — a backgrounded till must not probe. */
  documentHidden: boolean;
  /** A probe, or a device operation that must not be interrupted, is running. */
  inFlight: boolean;
  /** The hardware config has finished hydrating. */
  loaded: boolean;
  /** We are inside the Tauri webview (browser dev has no devices to probe). */
  inTauri: boolean;
}

/**
 * True iff a mid-shift re-probe should fire now. A never-probed device
 * (`lastSweepAtMs === null`) with every other guard satisfied is treated as due.
 */
export function shouldReprobe(ctx: ReprobeContext): boolean {
  if (!ctx.inTauri) return false;
  if (!ctx.loaded) return false;
  if (ctx.documentHidden) return false;
  if (ctx.inFlight) return false;
  if (ctx.intervalMs <= 0) return false;

  const elapsed =
    ctx.lastSweepAtMs === null ? Number.POSITIVE_INFINITY : ctx.nowMs - ctx.lastSweepAtMs;
  return elapsed >= ctx.intervalMs;
}

// ── Der Zeitgeber, der die Entscheidung ueberhaupt erst stellt ───────────────

/**
 * Der geteilte Stand einer Messreihe. Er liegt BEWUSST ausserhalb der Schleife:
 * haengt der Haken ab und wieder an (Entwicklungsmodus, Schirmwechsel), soll
 * daraus kein zweiter Sammellauf innerhalb desselben Zeitfensters werden.
 */
export interface ReprobeState {
  lastSweepAtMs: number | null;
  inFlight: boolean;
}

export function createReprobeState(): ReprobeState {
  return { lastSweepAtMs: null, inFlight: false };
}

/** Nur der Teil des `document`, den die Schleife wirklich braucht. */
export interface ReprobeDocument {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface ReprobeLoopOptions {
  /** Der vollstaendige Sammellauf ueber ALLE Gerätearten. */
  sweep: () => Promise<void>;
  /** Die Bedingungen, die sich nicht aus Uhr und Fenster ergeben. */
  readGuards: () => { loaded: boolean; inTauri: boolean };
  /** Geteilter Stand ueber alle Anhaenge hinweg. */
  state: ReprobeState;
  intervalMs?: number;
  now?: () => number;
  /** Ohne Fenster (Pruefumgebung) entfaellt nur der Sichtbarkeits-Ausloeser. */
  doc?: ReprobeDocument | null;
}

/**
 * Startet den Takt und liefert das Aufraeumen zurueck.
 *
 * Der erste Takt laeuft SOFORT — das ist zugleich der Sammellauf beim Start.
 * Danach wird oefter nachgesehen als das Zeitfenster gross ist, damit ein
 * faelliger Lauf nicht durch ein paar Millisekunden Versatz ein ganzes Fenster
 * spaeter kommt. Kommt die Kasse aus dem Hintergrund zurueck, wird sofort
 * nachgesehen: genau dann ist der angezeigte Stand am ehesten veraltet.
 */
export function startReprobeLoop(opts: ReprobeLoopOptions): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_REPROBE_INTERVAL_MS;
  const now = opts.now ?? ((): number => Date.now());
  const doc = opts.doc ?? null;
  const state = opts.state;
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    const guards = opts.readGuards();
    const faellig = shouldReprobe({
      nowMs: now(),
      lastSweepAtMs: state.lastSweepAtMs,
      intervalMs,
      documentHidden: doc ? doc.hidden : false,
      inFlight: state.inFlight,
      loaded: guards.loaded,
      inTauri: guards.inTauri,
    });
    if (!faellig) return;
    state.inFlight = true;
    void opts
      .sweep()
      .catch(() => undefined)
      .finally(() => {
        state.inFlight = false;
        // Erst NACH dem Lauf stempeln: sonst zaehlt die Wartezeit eines langen
        // Laufs gegen das Fenster und zwei Laeufe koennten sich ueberholen.
        state.lastSweepAtMs = now();
      });
  };

  tick();

  const handle = setInterval(tick, Math.max(1_000, Math.round(intervalMs / 3)));
  const onVisibilityChange = (): void => {
    if (doc && !doc.hidden) tick();
  };
  if (doc) doc.addEventListener('visibilitychange', onVisibilityChange);

  return (): void => {
    stopped = true;
    clearInterval(handle);
    if (doc) doc.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

// ── Der ECHTE Druck ist die beste Messung, die es gibt ──────────────────────

/**
 * Fehlerarten, die bedeuten: das Geraet hat den Auftrag nicht angenommen.
 *
 * `encoding` / `invalid_argument` / `internal` bleiben bewusst draussen — da war
 * der Drucker nie gefragt, die Daten waren schuld. Diese Marke rot zu faerben
 * waere eine ebenso falsche Aussage wie das Gruen, das wir gerade abschaffen.
 */
const NICHT_ERREICHBAR: ReadonlySet<HardwareErrorKind> = new Set<HardwareErrorKind>([
  'network',
  'timeout',
  'device',
  'not_configured',
  'local_io',
]);

/**
 * DER EINE WEG, auf dem ein echter Druckversuch die Marke bewegt.
 *
 * FUND (26.07.2026): Ein gescheiterter Druck am Tresen fasste die Marke nie an.
 * Beide Druckstellen — Beleg und Etikett — fingen den Fehler, zeigten einen
 * Hinweis und schrieben nichts. Der Punkt war also nicht nur vor dem ersten
 * Fehlschlag gruen, er blieb es nach dem zehnten. Dabei ist ein echter Druck
 * die aussagekraeftigste Messung, die es gibt: staerker als jede Sondierung,
 * denn hier sind die Daten wirklich geflossen.
 *
 * `error === null` heisst Erfolg. Beide Stellen rufen dieselbe Funktion —
 * bewusst keine zwei Kopien, denn eine Kopie ist die, die beim naechsten Umbau
 * vergessen wird.
 */
export function notePrintOutcome(kind: HardwareProbeKind, error: unknown): void {
  if (error === null || error === undefined) {
    markDeviceReachable(kind, true);
    return;
  }
  if (isHardwareError(error) && !NICHT_ERREICHBAR.has(error.kind)) return;
  markDeviceReachable(kind, false);
}
