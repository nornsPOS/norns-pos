/**
 * useScaleWeight — read a stable weight from a USB serial scale (MT-SICS) via
 * the Rust `read_scale_weight` Tauri command. Exposes loading/error state plus
 * `readWeight(portPath)` for the Ankauf/Bewertung weigh-in flows, and
 * `listPorts()` to populate the Gerätemanager port dropdown.
 */

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useState } from 'react';
import { describeError } from '@norns/i18n-de';

import { describeHardwareError, isHardwareError } from '../lib/hardware-client.js';

export interface GefundeneWaage {
  port: string;
  baud: number;
  /** Die rohe Antwortzeile, als Beweis. */
  antwort: string;
}

export interface ScaleWeight {
  /** Weight in grams as the scale reported it (string preserves precision). */
  grams: string;
}

export interface UseScaleWeight {
  /** Read a stable weight from the given serial port (baud defaults to 9600). */
  readWeight: (portPath: string, baudRate?: number) => Promise<ScaleWeight>;
  /** Tare (zero) the scale on the given serial port. */
  tare: (portPath: string, baudRate?: number) => Promise<void>;
  /** Enumerate available serial ports. */
  listPorts: () => Promise<string[]>;
  /** Alle Anschlüsse absuchen; was in SICS-Form antwortet, ist eine Waage. */
  suchen: () => Promise<GefundeneWaage[]>;
  weight: ScaleWeight | null;
  loading: boolean;
  error: string | null;
}

/** A scale failure carries the {kind, details} HardwareError shape — prefer its
 *  clean German sentence; fall back to describeError for any other shape. */
function describeScaleError(err: unknown): string {
  return isHardwareError(err) ? describeHardwareError(err) : describeError(err);
}

export function useScaleWeight(): UseScaleWeight {
  const [weight, setWeight] = useState<ScaleWeight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readWeight = useCallback(
    async (portPath: string, baudRate?: number): Promise<ScaleWeight> => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<ScaleWeight>('read_scale_weight', {
          portPath,
          ...(baudRate !== undefined ? { baudRate } : {}),
        });
        setWeight(result);
        return result;
      } catch (err) {
        setError(describeScaleError(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const tare = useCallback(async (portPath: string, baudRate?: number): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await invoke('tare_scale', {
        portPath,
        ...(baudRate !== undefined ? { baudRate } : {}),
      });
    } catch (err) {
      setError(describeScaleError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const listPorts = useCallback(async (): Promise<string[]> => {
    return invoke<string[]>('list_scale_ports');
  }, []);

  /**
   * Die Waage FINDEN statt sie im Klappmenü zu suchen (21.08.2026).
   *
   * Fragt jeden Anschluss mit der SICS-Sofortabfrage an; was in SICS-Form
   * antwortet, IST eine Waage der MT-SICS-Familie. Einzelheiten und die
   * Abwägung (zwei Bytes an fremde Geräte) in `commands/scale.rs`.
   */
  const suchen = useCallback(async (): Promise<GefundeneWaage[]> => {
    return invoke<GefundeneWaage[]>('scale_suchen');
  }, []);

  return { readWeight, tare, listPorts, suchen, weight, loading, error };
}
