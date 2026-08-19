/**
 * useHardwareAutoConnect — silent app-start hardware probe + a one-tap
 * "Alle Geräte verbinden" action for the Gerätemanager.
 *
 * The mandate: hardware should connect ONE-TAP / automatically. On a real shop
 * machine the printers + terminal sit at fixed LAN addresses the operator
 * already configured once, so re-probing every saved endpoint on launch (and
 * marking it connected when it answers) means the POS is "ready" without anyone
 * opening Settings. The probes are pure TCP/queue reachability checks — they
 * send NO bytes, so an auto-probe never feeds paper or wakes the terminal.
 *
 * Each probe writes `lastReachable` + `lastCheckedAt` back into the hardware
 * store, which is exactly what the per-device status badges render. Failures
 * are swallowed (an offline printer is a normal state, surfaced calmly as a red
 * badge — never a crash or a blocking toast at boot).
 *
 * `connectDevice` powers the per-card "Automatisch verbinden" button and
 * returns the boolean result so the caller can also fire a toast.
 */

import { useCallback, useEffect } from 'react';

import {
  type LabelConfig,
  isRunningInTauri,
  labelClient,
  thermalClient,
  tseClient,
  zvtClient,
} from '../lib/hardware-client.js';
import { createReprobeState, startReprobeLoop } from '../lib/hardware-reprobe.js';
import { markDeviceReachable, useHardwareStore } from '../state/hardware-store.js';

export type HardwareDeviceKind = 'thermal' | 'label' | 'zvt' | 'tse';

/**
 * Der Stand liegt auf Modulebene, damit ein zweiter Anhang des Hakens (der
 * Entwicklungsmodus haengt jede Wirkung zweimal an) nicht sofort einen zweiten
 * Sammellauf ausloest.
 */
const reprobeState = createReprobeState();

interface UseHardwareAutoConnect {
  /** Probe a single device; resolves `true` when reachable. Never throws. */
  connectDevice: (kind: HardwareDeviceKind) => Promise<boolean>;
  /** Probe every configured device in parallel (the "Alle verbinden" action). */
  connectAll: () => Promise<void>;
}

/**
 * Probe one device by kind, persisting the verdict into the store. Pulled out
 * of the hook so both the boot sweep and the manual button share one code path.
 * Returns `false` (not a throw) on any error so callers can treat "unreachable"
 * and "errored" identically — both mean "not connected".
 */
async function probeDevice(kind: HardwareDeviceKind): Promise<boolean> {
  const store = useHardwareStore.getState();
  const cfg = store.config;

  try {
    if (kind === 'thermal') {
      const t = cfg.thermal;
      // Configured USB queue → probe that the queue still exists.
      if (t.mode === 'usb' && t.printerName) {
        const ok = await thermalClient.check({ ip: '', port: 9100, printerName: t.printerName });
        markDeviceReachable('thermal', ok);
        return ok;
      }
      // Configured network printer → probe ip:port.
      if (t.ip) {
        const ok = await thermalClient.check({ ip: t.ip, port: t.port });
        markDeviceReachable('thermal', ok);
        return ok;
      }
      // Nothing configured yet → auto-detect a USB receipt printer and adopt it,
      // so the operator just plugs the printer in and the POS is print-ready
      // (Basel's "works automatically on USB connect"). No-op if none found.
      const detected = await thermalClient.detectReceiptPrinter();
      if (!detected) return false;
      store.setThermal({ mode: 'usb', printerName: detected });
      // FUND (26.07.2026): Hier stand vorher „erreichbar" direkt nach dem
      // Finden eines NAMENS. Gefunden wurde aber nur ein Eintrag in der
      // Warteschlangenliste des Betriebssystems — eine Warteschlange bleibt
      // dort auch dann stehen, wenn der Drucker seit Wochen aus ist. Der Punkt
      // wurde also gruen, ohne dass je etwas gemessen wurde. Jetzt wird die
      // eben uebernommene Warteschlange genauso sondiert wie jede andere.
      const ok = await thermalClient.check({ ip: '', port: 9100, printerName: detected });
      markDeviceReachable('thermal', ok);
      return ok;
    }
    if (kind === 'zvt') {
      if (!cfg.zvt.ip) return false;
      const ok = await zvtClient.check({ ip: cfg.zvt.ip, port: cfg.zvt.port });
      markDeviceReachable('zvt', ok);
      return ok;
    }
    if (kind === 'tse') {
      // Die TSE gehoert zum Sammellauf: sie ist das einzige Geraet, dessen
      // Ausfall den Verkauf rechtlich beruehrt. Ohne Einrichtung wird nichts
      // behauptet — der Stand bleibt „noch nicht geprueft".
      if (!cfg.tse.tssId || !cfg.tse.clientId) return false;
      const status = await tseClient.status({ tssId: cfg.tse.tssId, clientId: cfg.tse.clientId });
      markDeviceReachable('tse', status.reachable);
      return status.reachable;
    }
    // label
    const l = cfg.label;
    const configured = l.mode === 'system' ? l.printerName.length > 0 : l.ip.length > 0;
    if (!configured) return false;
    const labelConfig: LabelConfig = {
      mode: l.mode,
      ip: l.ip || undefined,
      port: l.port,
      printerName: l.printerName || undefined,
      printerType: l.printerType,
    };
    const ok = await labelClient.check(labelConfig);
    markDeviceReachable('label', ok);
    return ok;
  } catch {
    // Unreachable / not-configured / browser-mode — mark offline, stay calm.
    markDeviceReachable(kind, false);
    return false;
  }
}

/**
 * @param autoOnMount When true (the App-shell instance), run a one-shot probe
 *   sweep of every saved device once the store has hydrated. The Gerätemanager
 *   passes `false` and only uses the returned manual actions.
 */
export function useHardwareAutoConnect(autoOnMount = false): UseHardwareAutoConnect {
  const loaded = useHardwareStore((s) => s.loaded);

  const connectDevice = useCallback((kind: HardwareDeviceKind) => probeDevice(kind), []);

  const connectAll = useCallback(async () => {
    await Promise.all([
      probeDevice('thermal'),
      probeDevice('label'),
      probeDevice('zvt'),
      probeDevice('tse'),
    ]);
  }, []);

  /**
   * FUND (26.07.2026): Hier gab es NUR einen einmaligen Lauf beim Start.
   *
   * Am Tresen hiess das: morgens alles gruen, um 11:00 rutscht das Druckerkabel
   * heraus, und bis zum Feierabend bleibt der Punkt gruen. Der erste Beleg, der
   * nicht kommt, ist die Entdeckung — und der Belegdruck ist Pflicht, also
   * steht der Verkauf. `shouldReprobe` gab es zu diesem Zeitpunkt bereits, samt
   * neun gruener Pruefungen; nur fragte es niemand. Jetzt haelt
   * `startReprobeLoop` den Zeitgeber und den Sichtbarkeitswechsel, der erste
   * Takt ist zugleich der Lauf beim Start, und das Aufraeumen entfernt beide.
   */
  useEffect(() => {
    if (!autoOnMount) return;
    // Only meaningful inside Tauri; in browser mode the probes would all fail
    // and there is no hardware to connect to.
    if (!isRunningInTauri()) return;
    // Wait for the store to hydrate from localStorage so we probe the SAVED
    // endpoints, not the empty defaults.
    if (!loaded) return;
    return startReprobeLoop({
      sweep: connectAll,
      readGuards: () => ({ loaded: useHardwareStore.getState().loaded, inTauri: isRunningInTauri() }),
      state: reprobeState,
      doc: typeof document === 'undefined' ? null : document,
    });
  }, [autoOnMount, loaded, connectAll]);

  return { connectDevice, connectAll };
}
