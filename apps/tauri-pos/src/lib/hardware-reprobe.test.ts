import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHardwareStore } from '../state/hardware-store.js';
import {
  DEFAULT_REPROBE_INTERVAL_MS,
  type ReprobeContext,
  type ReprobeDocument,
  createReprobeState,
  notePrintOutcome,
  shouldReprobe,
  startReprobeLoop,
} from './hardware-reprobe.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

// A context where every guard is satisfied and the interval has clearly elapsed.
const base: ReprobeContext = {
  nowMs: 1_000_000,
  lastSweepAtMs: 1_000_000 - 100_000, // 100s ago, past the 90s interval
  intervalMs: DEFAULT_REPROBE_INTERVAL_MS,
  documentHidden: false,
  inFlight: false,
  loaded: true,
  inTauri: true,
};

describe('shouldReprobe', () => {
  it('fires when idle, visible, loaded, in Tauri, and the interval elapsed', () => {
    expect(shouldReprobe(base)).toBe(true);
  });

  it('never fires outside the Tauri webview', () => {
    expect(shouldReprobe({ ...base, inTauri: false })).toBe(false);
  });

  it('never fires before the hardware config has loaded', () => {
    expect(shouldReprobe({ ...base, loaded: false })).toBe(false);
  });

  it('does not fire while the tab is hidden', () => {
    expect(shouldReprobe({ ...base, documentHidden: true })).toBe(false);
  });

  it('does not fire while a probe/operation is in flight', () => {
    expect(shouldReprobe({ ...base, inFlight: true })).toBe(false);
  });

  it('does not fire before the interval has elapsed', () => {
    expect(shouldReprobe({ ...base, lastSweepAtMs: base.nowMs - 10_000 })).toBe(false);
  });

  it('fires exactly on the interval boundary', () => {
    expect(
      shouldReprobe({ ...base, lastSweepAtMs: base.nowMs - DEFAULT_REPROBE_INTERVAL_MS }),
    ).toBe(true);
  });

  it('treats a never-probed device as due', () => {
    expect(shouldReprobe({ ...base, lastSweepAtMs: null })).toBe(true);
  });

  it('never fires with a non-positive interval', () => {
    expect(shouldReprobe({ ...base, intervalMs: 0 })).toBe(false);
    expect(shouldReprobe({ ...base, intervalMs: -5 })).toBe(false);
  });
});

// ── Der Zeitgeber selbst, nicht nur die Entscheidung ────────────────────────

/** Ein Fenster aus Papier: node hat kein `document`. */
function fakeDoc(): ReprobeDocument & { hidden: boolean; zuhoerer: number; wechsel: () => void } {
  const listeners = new Set<() => void>();
  return {
    hidden: false,
    get zuhoerer(): number {
      return listeners.size;
    },
    addEventListener(_t: 'visibilitychange', l: () => void): void {
      listeners.add(l);
    },
    removeEventListener(_t: 'visibilitychange', l: () => void): void {
      listeners.delete(l);
    },
    wechsel(): void {
      for (const l of listeners) l();
    },
  };
}

describe('startReprobeLoop — das abgesteckte Kabel wird ohne Zutun rot', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('misst sofort, dann erst wieder nach dem Zeitfenster', async () => {
    let laeufe = 0;
    const doc = fakeDoc();
    const stop = startReprobeLoop({
      sweep: async () => {
        laeufe += 1;
      },
      readGuards: () => ({ loaded: true, inTauri: true }),
      state: createReprobeState(),
      intervalMs: DEFAULT_REPROBE_INTERVAL_MS,
      doc,
    });

    // Der erste Takt ist zugleich der Lauf beim Start.
    expect(laeufe).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(laeufe).toBe(1); // Fenster noch nicht um: kein Bedrängen des Geräts.

    await vi.advanceTimersByTimeAsync(40_000); // jetzt bei 100 s
    expect(laeufe).toBe(2);

    stop();
    await vi.advanceTimersByTimeAsync(10 * DEFAULT_REPROBE_INTERVAL_MS);
    expect(laeufe).toBe(2); // sauber aufgeräumt
    expect(doc.zuhoerer).toBe(0);
  });

  it('misst sofort, wenn die Kasse aus dem Hintergrund zurückkommt', async () => {
    let laeufe = 0;
    const doc = fakeDoc();
    const stop = startReprobeLoop({
      sweep: async () => {
        laeufe += 1;
      },
      readGuards: () => ({ loaded: true, inTauri: true }),
      state: createReprobeState(),
      intervalMs: DEFAULT_REPROBE_INTERVAL_MS,
      doc,
    });
    expect(laeufe).toBe(1);

    doc.hidden = true;
    await vi.advanceTimersByTimeAsync(5 * DEFAULT_REPROBE_INTERVAL_MS);
    expect(laeufe).toBe(1); // verdeckte Kasse sondiert nicht

    doc.hidden = false;
    doc.wechsel();
    expect(laeufe).toBe(2); // beim Zurückkommen sofort, nicht 90 s später
    stop();
  });

  it('lässt keinen zweiten Lauf in einen laufenden hineinfahren', async () => {
    let laeufe = 0;
    const haenger: { freigeben: () => void } = { freigeben: () => undefined };
    const stop = startReprobeLoop({
      sweep: () => {
        laeufe += 1;
        return new Promise<void>((resolve) => {
          haenger.freigeben = resolve;
        });
      },
      readGuards: () => ({ loaded: true, inTauri: true }),
      state: createReprobeState(),
      intervalMs: DEFAULT_REPROBE_INTERVAL_MS,
      doc: fakeDoc(),
    });
    expect(laeufe).toBe(1);

    await vi.advanceTimersByTimeAsync(10 * DEFAULT_REPROBE_INTERVAL_MS);
    expect(laeufe).toBe(1); // der erste hängt noch

    haenger.freigeben();
    await vi.advanceTimersByTimeAsync(DEFAULT_REPROBE_INTERVAL_MS);
    expect(laeufe).toBe(2);
    stop();
  });

  it('sondiert nicht, solange die Einstellungen nicht geladen sind', async () => {
    let laeufe = 0;
    let geladen = false;
    const stop = startReprobeLoop({
      sweep: async () => {
        laeufe += 1;
      },
      readGuards: () => ({ loaded: geladen, inTauri: true }),
      state: createReprobeState(),
      intervalMs: DEFAULT_REPROBE_INTERVAL_MS,
      doc: fakeDoc(),
    });
    expect(laeufe).toBe(0);

    geladen = true;
    await vi.advanceTimersByTimeAsync(DEFAULT_REPROBE_INTERVAL_MS);
    expect(laeufe).toBe(1);
    stop();
  });
});

// ── Ein echter Fehlschlag am Tresen bewegt die Marke ────────────────────────

describe('notePrintOutcome — der Druck als Messung', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
    });
    useHardwareStore.setState((s) => ({
      config: {
        ...s.config,
        thermal: { ...s.config.thermal, lastReachable: null, lastCheckedAt: null },
        label: { ...s.config.label, lastReachable: null, lastCheckedAt: null },
      },
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ein gescheiterter Beleg setzt den Belegdrucker auf „nicht erreichbar"', () => {
    notePrintOutcome('thermal', { kind: 'network', details: 'connection refused' });
    expect(useHardwareStore.getState().config.thermal.lastReachable).toBe(false);
    expect(useHardwareStore.getState().config.thermal.lastCheckedAt).not.toBeNull();
  });

  it('ein geglückter Etikettendruck setzt den Etikettendrucker auf „erreichbar"', () => {
    notePrintOutcome('label', null);
    expect(useHardwareStore.getState().config.label.lastReachable).toBe(true);
  });

  it('ein unbekannter Fehler zählt als nicht erreichbar — lieber laut als still', () => {
    notePrintOutcome('thermal', new Error('irgendetwas'));
    expect(useHardwareStore.getState().config.thermal.lastReachable).toBe(false);
  });

  it('ein Datenfehler lässt die Marke in Ruhe: da war der Drucker nie gefragt', () => {
    notePrintOutcome('thermal', { kind: 'encoding', details: 'bad codepage' });
    expect(useHardwareStore.getState().config.thermal.lastReachable).toBeNull();
    expect(useHardwareStore.getState().config.thermal.lastCheckedAt).toBeNull();
  });
});

// ── Die ANBINDUNG, nicht nur die reine Funktion ─────────────────────────────

/** Jede Quelldatei unter `src`, ohne die Prüfdateien selbst. */
function quelldateien(dir: string): string[] {
  const out: string[] = [];
  for (const eintrag of readdirSync(dir, { withFileTypes: true })) {
    const pfad = join(dir, eintrag.name);
    if (eintrag.isDirectory()) out.push(...quelldateien(pfad));
    else if (/\.tsx?$/.test(eintrag.name) && !eintrag.name.includes('.test.')) out.push(pfad);
  }
  return out;
}

/**
 * DER FUND, den diese Gruppe festnagelt (26.07.2026):
 *
 * `shouldReprobe` hatte NULL Aufrufer ausserhalb dieser Datei. Neun grüne
 * Prüfungen, ein Kopfkommentar, der eine Anbindung an `useHardwareAutoConnect`
 * behauptete — und im laufenden Programm fragte die Funktion niemand. Grün hiess
 * „steht in einer Liste", nicht „gemessen". Genau diese Lücke prüfen wir jetzt:
 * eine Funktion ohne Aufrufer im Programm ist keine Funktion, sondern Deko.
 */
describe('Anbindung: dieser Baustein wird im laufenden Programm wirklich gefragt', () => {
  const programm = quelldateien(SRC).map((p) => ({ pfad: p, text: readFileSync(p, 'utf8') }));

  it('der Zeitgeber wird vom Haken gestartet und wieder aufgeräumt', () => {
    const haken = readFileSync(join(SRC, 'hooks', 'useHardwareAutoConnect.ts'), 'utf8');
    expect(haken).toContain('hardware-reprobe.js');
    expect(haken).toContain('startReprobeLoop(');
    // Der Rückgabewert MUSS die Aufräumung der Wirkung sein, sonst überlebt der
    // Zeitgeber jeden Schirmwechsel.
    expect(haken).toMatch(/return startReprobeLoop\(/);
  });

  it('der Sammellauf erfasst ALLE Gerätearten, nicht nur die Drucker', () => {
    const haken = readFileSync(join(SRC, 'hooks', 'useHardwareAutoConnect.ts'), 'utf8');
    const sammellauf = haken.slice(haken.indexOf('const connectAll'), haken.indexOf('useEffect('));
    for (const art of ['thermal', 'label', 'zvt', 'tse']) {
      expect(sammellauf).toContain(`probeDevice('${art}')`);
    }
  });

  it('BEIDE echten Druckstellen melden ihr Ergebnis über denselben Weg', () => {
    for (const datei of ['screens/verkauf/BezahlenDialog.tsx', 'lib/use-label-printer.ts']) {
      const text = readFileSync(join(SRC, datei), 'utf8');
      const treffer = text.match(/notePrintOutcome\(/g) ?? [];
      // Zweimal: der Erfolg UND der Fehlschlag. Genau der Fehlschlag fehlte.
      expect(treffer.length, `${datei} meldet den Druckausgang nicht`).toBeGreaterThanOrEqual(2);
    }
  });

  it('kein Export dieses Bausteins bleibt ohne Aufrufer im Programm', () => {
    const eigen = join(SRC, 'lib', 'hardware-reprobe.ts');
    const fremd = programm.filter((d) => d.pfad !== eigen);
    for (const name of ['shouldReprobe', 'startReprobeLoop', 'notePrintOutcome']) {
      const nutzer = fremd.filter((d) => d.text.includes(name));
      expect(nutzer.length, `${name} hat keinen Aufrufer im Programm`).toBeGreaterThan(0);
    }
  });
});
