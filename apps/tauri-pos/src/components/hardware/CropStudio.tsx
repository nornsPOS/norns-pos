/**
 * CropStudio — modal that intercepts every photo before the R2 pipeline.
 *
 * Why: storefront + eBay photos must be square (1:1), reasonably-sized
 * (≤ 300 KB), and consistently framed. Operators dropping arbitrary
 * camera JPEGs would create a maintenance nightmare. The Studio gives
 * them zoom/pan/aspect lock + Rust-side WebP compression in one swoop.
 *
 * Flow:
 *   1. Caller hands us a `File` / `Blob` + onResult callback.
 *   2. We render it inside `react-easy-crop` with aspect locked 1:1.
 *   3. On "Zuschneiden & Speichern" we draw the cropped region into a
 *      canvas, lift the raw RGBA, send to Rust → WebP, return a Blob.
 *   4. Caller resumes the existing `photo-upload.ts` pipeline with the
 *      compressed Blob in place of the original.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';

import { Fensterboden, Button, Zwischentitel, Icon, ParchmentCard, RotateCcw, RotateCw } from '@norns/ui-kit';
import { describeError } from '@norns/i18n-de';

import {
  compressToWebpBlob,
  describeHardwareError,
  isHardwareError,
  isRunningInTauri,
} from '../../lib/hardware-client.js';

export interface CropStudioProps {
  /** The image the operator picked / shot. */
  source: Blob | File;
  /** Target output dimensions — square. Default 1080×1080 (storefront). */
  outputSize?: number;
  /** Hard cap on WebP payload size, in KiB. Default 300. */
  maxKb?: number;
  onCancel: () => void;
  onResult: (output: {
    blob: Blob;
    width: number;
    height: number;
    sizeBytes: number;
    achievedQuality: number;
  }) => void;
}

export function CropStudio({
  source,
  outputSize = 1080,
  maxKb = 300,
  onCancel,
  onResult,
}: CropStudioProps): JSX.Element {
  const objectUrl = useMemo(() => URL.createObjectURL(source), [source]);

  // Tear down the object URL when the modal closes — keeps the webview's
  // memory footprint clean (10+ MB camera JPEGs add up fast).
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const confirm = useCallback(async () => {
    if (!croppedAreaPixels) return;
    setBusy(true);
    setError(null);
    try {
      const rgba = await drawCroppedRgba(objectUrl, croppedAreaPixels, outputSize, rotation);
      if (!isRunningInTauri()) {
        // Browser fallback — encode via canvas; the storefront quality
        // hit is acceptable for dev-mode previews.
        const blob = await canvasFallbackEncode(rgba, outputSize, outputSize);
        onResult({
          blob,
          width: outputSize,
          height: outputSize,
          sizeBytes: blob.size,
          achievedQuality: 80,
        });
        return;
      }
      const { blob, result } = await compressToWebpBlob(rgba, outputSize, outputSize, {
        quality: 80,
        maxKb,
        minQuality: 60,
      });
      onResult({
        blob,
        width: result.width,
        height: result.height,
        sizeBytes: result.sizeBytes,
        achievedQuality: result.achievedQuality,
      });
    } catch (err) {
      setError(
        isHardwareError(err)
          ? describeHardwareError(err)
          : describeError(err),
      );
    } finally {
      setBusy(false);
    }
  }, [croppedAreaPixels, maxKb, objectUrl, onResult, outputSize, rotation]);

  return (
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label="Foto zuschneiden"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--w14-z-werkbank)',
        backgroundColor: 'var(--w14-overlay)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-24)',
      }}
    >
      <ParchmentCard
        padding="lg"
        style={{ width: 'min(640px, 100%)', boxShadow: 'var(--w14-shadow-modal)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-kopf)',
            textAlign: 'center',
          }}
        >
          Foto zuschneiden
        </h2>
        <p
          style={{
            margin: '6px 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-text)',
            textAlign: 'center',
          }}
        >
          Quadratisch (1:1) · max {maxKb} KB · WebP
        </p>
        <Zwischentitel />

        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            backgroundColor: 'var(--w14-parchment-3)',
            borderRadius: 'var(--w14-radius-button)',
            overflow: 'hidden',
          }}
        >
          <Cropper
            image={objectUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={1}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Zoom + Rotation sliders */}
        <div
          style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: '70px 1fr',
            gap: 'var(--w14-abstand-10)',
            alignItems: 'center',
          }}
        >
          <label
            htmlFor="cs-zoom"
            className="w14-smallcaps"
            style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)' }}
          >
            Zoom
          </label>
          <input
            id="cs-zoom"
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            disabled={busy}
          />
          <label
            htmlFor="cs-rot"
            className="w14-smallcaps"
            style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)' }}
          >
            Drehen
          </label>
          <input
            id="cs-rot"
            type="range"
            min={0}
            max={360}
            step={1}
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value))}
            disabled={busy}
          />
        </div>

        {/* Quick actions: rotate 90° + reset */}
        <div style={{ marginTop: 12, display: 'flex', gap: 'var(--w14-abstand-8)', justifyContent: 'center' }}>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setRotation((r) => (r + 270) % 360)}
            disabled={busy}
          >
            {/* Strich-Pfeile statt ↺/↻ (Dekret „Symbole statt Emoji", 26.07.2026). */}
            <Icon icon={RotateCcw} size={15} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            90°
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            disabled={busy}
          >
            <Icon icon={RotateCw} size={15} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            90°
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              setCrop({ x: 0, y: 0 });
              setZoom(1);
              setRotation(0);
            }}
            disabled={busy}
          >
            Zurücksetzen
          </Button>
        </div>

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '12px 0 0',
              fontSize: 'var(--w14-schrift-text)',
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}

        <div style={{ marginTop: 18, display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            onClick={() => void confirm()}
            disabled={busy || !croppedAreaPixels}
          >
            {busy ? 'Wird komprimiert…' : 'Zuschneiden & Speichern'}
          </Button>
        </div>
      </ParchmentCard>
    </div></Fensterboden>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Canvas helpers — keep the hot path off the React render loop.
// ────────────────────────────────────────────────────────────────────────

/** Decode the source image, draw the cropped + rotated region into an
 * off-screen canvas at the target size, and return raw RGBA bytes. */
async function drawCroppedRgba(
  imageUrl: string,
  area: Area,
  outputSize: number,
  rotationDeg: number,
): Promise<Uint8Array> {
  const image = await loadImage(imageUrl);
  const canvas = supportsOffscreen()
    ? (new OffscreenCanvas(outputSize, outputSize) as unknown as HTMLCanvasElement)
    : (() => {
        const c = document.createElement('canvas');
        c.width = outputSize;
        c.height = outputSize;
        return c;
      })();
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D-Kontext nicht verfügbar');

  // Apply rotation around the image centre.
  if (rotationDeg !== 0) {
    const sw = Math.max(image.width, image.height) * 2;
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sw;
    const tctx = tmp.getContext('2d')!;
    tctx.translate(sw / 2, sw / 2);
    tctx.rotate((rotationDeg * Math.PI) / 180);
    tctx.drawImage(image, -image.width / 2, -image.height / 2);
    // Then crop from the rotated canvas — area coords are in source space,
    // good enough for V1; sub-pixel artifacts at the very edges are fine.
    ctx.drawImage(
      tmp,
      area.x + (sw - image.width) / 2,
      area.y + (sw - image.height) / 2,
      area.width,
      area.height,
      0,
      0,
      outputSize,
      outputSize,
    );
  } else {
    ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, outputSize, outputSize);
  }

  const data = ctx.getImageData(0, 0, outputSize, outputSize).data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = src;
  });
}

function supportsOffscreen(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/** Browser fallback when Tauri/WebP is unavailable — go through canvas
 * `toBlob('image/webp', 0.8)`. Modern Chromium webviews support it. */
async function canvasFallbackEncode(rgba: Uint8Array, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const data = new ImageData(new Uint8ClampedArray(rgba), w, h);
  ctx.putImageData(data, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob lieferte null'))),
      'image/webp',
      0.8,
    );
  });
}
