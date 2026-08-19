/**
 * useCamera — MediaDevices wrapper for the Foto-Werkstatt.
 *
 * Responsibilities:
 *   1. Acquire a MediaStream via `navigator.mediaDevices.getUserMedia`.
 *   2. Enumerate available video inputs for the device-switcher UX.
 *   3. REMEMBER the operator's chosen camera (localStorage) and open it by
 *      default next time — never silently snap back to the OS default. If the
 *      saved camera is gone (unplugged), fall back to the default cleanly.
 *   4. Stop the current stream's tracks before requesting a new one.
 *   5. Surface `permission` + `error` states for the empty-state UI.
 *   6. `captureBlob()` draws the current frame to an off-screen canvas
 *      and produces an `image/jpeg` blob at the native resolution.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '@norns/i18n-de';

export type CameraPermission = 'unknown' | 'pending' | 'granted' | 'denied' | 'unavailable';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  permission: CameraPermission;
  error: string | null;
  devices: readonly CameraDevice[];
  activeDeviceId: string | null;
  requestPermission: () => Promise<void>;
  /** Switch camera + remember the choice for next time. */
  switchDevice: (deviceId: string) => Promise<void>;
  /** Re-enumerate the available cameras (e.g. after plugging one in). */
  refreshDevices: () => Promise<void>;
  stop: () => void;
  captureBlob: () => Promise<Blob | null>;
}

export interface UseCameraOptions {
  enabled?: boolean;
}

const CAMERA_KEY = 'warehouse14.camera.deviceId';

function readSavedDevice(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
}
function saveDevice(deviceId: string): void {
  try {
    localStorage.setItem(CAMERA_KEY, deviceId);
  } catch {
    // private mode / quota — non-fatal.
  }
}
function clearSavedDevice(): void {
  try {
    localStorage.removeItem(CAMERA_KEY);
  } catch {
    // non-fatal.
  }
}

export function useCamera(opts: UseCameraOptions = {}): UseCameraResult {
  const { enabled = true } = opts;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [permission, setPermission] = useState<CameraPermission>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<readonly CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);

  const stop = useCallback((): void => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /** Acquire a stream. Returns true on success. */
  const attachStream = useCallback(
    async (deviceId: string | null): Promise<boolean> => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setPermission('unavailable');
        // `navigator.mediaDevices` ist nur in einem sicheren Kontext (HTTPS
        // bzw. das tauri://-Schema der installierten App) verfügbar. Im
        // Browser-Entwicklungsmodus über http://localhost fehlt sie deshalb.
        // In der installierten POS-App ist die Kamera aktiv — bitte ggf. die
        // App neu starten und beim ersten Mal die Kamera-Abfrage bestätigen.
        // Bis dahin steht der Datei-Upload rechts als Alternative bereit.
        setError(
          'Die Kamera ist in dieser Umgebung nicht verfügbar (kein sicherer Kontext). ' +
            'In der installierten POS-App funktioniert die Kamera; bitte den Datei-Upload rechts verwenden.',
        );
        return false;
      }

      setPermission('pending');
      setError(null);
      stop();

      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings();
        setActiveDeviceId(settings?.deviceId ?? deviceId ?? null);
        setPermission('granted');
        return true;
      } catch (err) {
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
            setPermission('denied');
            setError('Kamera-Zugriff verweigert. Bitte in den Systemeinstellungen erlauben.');
            return false;
          }
          if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
            setPermission('unavailable');
            setError('Keine Kamera gefunden.');
            return false;
          }
        }
        setPermission('denied');
        setError(describeError(err));
        return false;
      }
    },
    [stop],
  );

  const refreshDevices = useCallback(async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label.length > 0 ? d.label : `Kamera ${idx + 1}`,
        }));
      setDevices(cams);
    } catch {
      // Best effort.
    }
  }, []);

  // Mount: open the SAVED camera if any; fall back to default if it's gone.
  useEffect(() => {
    if (!enabled) return;
    void (async (): Promise<void> => {
      const saved = readSavedDevice();
      const ok = await attachStream(saved);
      if (!ok && saved) {
        // saved camera vanished — drop the stale pref + open default.
        clearSavedDevice();
        await attachStream(null);
      }
      await refreshDevices();
    })();
    return stop;
  }, [enabled, attachStream, refreshDevices, stop]);

  const requestPermission = useCallback(async (): Promise<void> => {
    await attachStream(activeDeviceId ?? readSavedDevice());
    await refreshDevices();
  }, [attachStream, activeDeviceId, refreshDevices]);

  const switchDevice = useCallback(
    async (deviceId: string): Promise<void> => {
      const ok = await attachStream(deviceId);
      if (ok) saveDevice(deviceId); // remember the choice for next time
    },
    [attachStream],
  );

  const captureBlob = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return null;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
    });
  }, []);

  return {
    videoRef,
    permission,
    error,
    devices,
    activeDeviceId,
    requestPermission,
    switchDevice,
    refreshDevices,
    stop,
    captureBlob,
  };
}
