/**
 * scanner-store — liveness state for the global HID-wedge barcode scanner.
 *
 * A USB barcode scanner is a keyboard-class device: it has no IP and nothing
 * to "connect" to — it is reachable the instant it is plugged in and the OS
 * enumerates it. So unlike the printers/terminal (which expose a TCP probe),
 * the scanner's only honest readiness signal is "did we just decode a scan?".
 *
 * The app-wide scan handler (`useGlobalScanStatus`) calls `markScan()` on every
 * successful HID decode; the Gerätemanager reads `lastScanAt` to show a calm
 * "Scanner bereit · zuletzt HH:MM" / "Noch kein Scan erkannt" status. There is
 * no IP form to fill in — the device is plug-and-play by nature, which is the
 * one-tap experience the mandate asks for.
 */

import { create } from 'zustand';

interface ScannerState {
  /** ISO timestamp of the most recent successful HID-wedge decode, or null. */
  lastScanAt: string | null;
  /** The raw code last decoded (for the "zuletzt: …" hint). Never persisted. */
  lastCode: string | null;
  /** Record a successful scan — called by the global handler on every decode. */
  markScan: (code: string) => void;
}

export const useScannerStore = create<ScannerState>((set) => ({
  lastScanAt: null,
  lastCode: null,
  markScan: (code) => set({ lastScanAt: new Date().toISOString(), lastCode: code }),
}));
