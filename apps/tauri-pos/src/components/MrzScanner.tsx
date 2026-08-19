/**
 * MrzScanner — offline ID/passport MRZ capture (GwG/GDPR: identity data never
 * leaves the device; no external OCR APIs).
 *
 * Flow: open the camera, grab a frame every `captureIntervalMs` via the
 * ImageCapture API, hand the frame to an injected offline OCR recognizer
 * (`recognizeMrz`), and feed any candidate MRZ lines to the `mrz` parser
 * (parseMrzDocument). On a successful parse the fields are returned via
 * `onResult`. If the camera is unavailable/denied — or no recognizer is wired —
 * the operator can paste the MRZ lines manually.
 *
 * The pixel→text OCR step is intentionally an injected seam: the offline engine
 * (e.g. tesseract.js with an MRZ-tuned model, bundled locally) plugs in here
 * without this component ever touching the network.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { type MrzPerson, parseMrzDocument } from '../lib/mrz-parse.js';

/** Minimal ImageCapture shape (not in every lib.dom; accessed off window). */
interface ImageCaptureLike {
  grabFrame(): Promise<ImageBitmap>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

/** Offline OCR seam: extract candidate MRZ text lines from a camera frame. */
export type MrzRecognizer = (frame: ImageBitmap) => Promise<string[] | null>;

export interface MrzScannerProps {
  onResult: (person: MrzPerson) => void;
  onCancel?: () => void;
  /** Offline OCR. When omitted, auto-scan is disabled and manual entry is used. */
  recognizeMrz?: MrzRecognizer;
  /** Frame cadence in ms (default 500). */
  captureIntervalMs?: number;
}

type CameraState = 'pending' | 'granted' | 'denied';

export function MrzScanner({
  onResult,
  onCancel,
  recognizeMrz,
  captureIntervalMs = 500,
}: MrzScannerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>('pending');
  const [manualText, setManualText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const finish = useCallback(
    (person: MrzPerson) => {
      // Stop the camera as soon as we have a result — never hold the device open.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      onResult(person);
    },
    [onResult],
  );

  // ── Camera open + frame loop ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let capture: ImageCaptureLike | null = null;

    const stop = () => {
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setCamera('denied');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCamera('granted');

        const Ctor = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
        const track = stream.getVideoTracks()[0];
        if (!recognizeMrz || !Ctor || !track) return; // no OCR engine → manual only
        capture = new Ctor(track);

        timer = setInterval(() => {
          void (async () => {
            if (cancelled || !capture) return;
            try {
              const frame = await capture.grabFrame();
              const lines = await recognizeMrz(frame);
              if (!lines || lines.length === 0) return;
              const person = parseMrzDocument(lines);
              if (person) {
                stop();
                if (!cancelled) finish(person);
              }
            } catch {
              // Transient grab/OCR failure — keep trying on the next tick.
            }
          })();
        }, captureIntervalMs);
      } catch {
        if (!cancelled) setCamera('denied');
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [recognizeMrz, captureIntervalMs, finish]);

  // ── Manual entry (fallback / camera-denied) ───────────────────────────────
  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    setParseError(null);
    const lines = manualText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      setParseError('Bitte die 2 bis 3 MRZ-Zeilen des Ausweises eingeben.');
      return;
    }
    const person = parseMrzDocument(lines);
    if (!person) {
      setParseError('MRZ konnte nicht gelesen werden. Bitte erneut prüfen.');
      return;
    }
    finish(person);
  };

  return (
    <section className="mrz-scanner" aria-label="Ausweis-Scanner">
      {camera === 'granted' ? (
        <div className="mrz-scanner-camera">
          <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 'var(--w14-radius-button)' }} />
          <p className="mrz-scanner-hint">
            {recognizeMrz
              ? 'Ausweis in den Rahmen halten. Die MRZ wird automatisch erkannt.'
              : 'Kamera aktiv. MRZ unten manuell eingeben (kein Offline-Texterkenner geladen).'}
          </p>
        </div>
      ) : null}

      {camera === 'denied' ? (
        <p role="alert">Kamera nicht verfügbar. Bitte die MRZ-Zeilen manuell eingeben.</p>
      ) : null}

      {/* Manual entry is always offered (fallback + when no OCR engine is wired). */}
      <form onSubmit={submitManual} className="mrz-scanner-manual">
        <label>
          MRZ-Zeilen (eine pro Zeile)
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={'P<UTOERIKSSON<<ANNA<MARIA<<<<…\nL898902C36UTO7408122F1204159…'}
          />
        </label>
        {parseError ? <span role="alert">{parseError}</span> : null}
        <div className="mrz-scanner-actions">
          <button type="submit">Übernehmen</button>
          {onCancel ? (
            <button type="button" onClick={onCancel}>
              Abbrechen
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
