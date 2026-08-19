/**
 * Sharp compositer — rasterizes the Satori SVG (or any background bytes) and
 * overlays the transparent product cutout, emitting a high-quality WebP.
 *
 * No canvas coordinate math: Sharp does the SVG raster, the cutout resize, and
 * the centered overlay. Pure function of its inputs → Buffer.
 */

import sharp from 'sharp';

export type CardBackground = { svg: string } | { bytes: Buffer };

export interface CompositeCardArgs {
  /** Background: Satori SVG markup or pre-rendered raster bytes. */
  background: CardBackground;
  /** Transparent product cutout (PNG/WebP bytes), e.g. r2KeyBgRemoved object. */
  cutoutBytes: Buffer;
  width: number;
  height: number;
  /**
   * Longest-side fraction of the card the cutout should occupy. Default 0.62 —
   * leaves room for the brand header and the title/price footer.
   */
  cutoutScale?: number;
  /** WebP quality 1-100. Default 90. */
  quality?: number;
  /** Vertical nudge (px) of the centered cutout — negative = up. Default -40. */
  offsetY?: number;
}

function backgroundInput(bg: CardBackground): Buffer {
  return 'svg' in bg ? Buffer.from(bg.svg, 'utf8') : bg.bytes;
}

/** Composite the cutout onto the background and return WebP bytes. */
export async function compositeCardWebp(args: CompositeCardArgs): Promise<Buffer> {
  const { width, height } = args;
  const scale = args.cutoutScale ?? 0.62;
  const quality = args.quality ?? 90;
  const offsetY = args.offsetY ?? -40;

  // Base canvas at the exact target dimensions.
  const baseBytes = await sharp(backgroundInput(args.background))
    .resize(width, height, { fit: 'cover' })
    .png()
    .toBuffer();

  // Resize the cutout to fit a centered hero box.
  const target = Math.max(1, Math.round(Math.min(width, height) * scale));
  const cutoutMeta = await sharp(args.cutoutBytes)
    .resize(target, target, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.round((width - cutoutMeta.info.width) / 2);
  const top = Math.round((height - cutoutMeta.info.height) / 2 + offsetY);

  return sharp(baseBytes)
    .composite([{ input: cutoutMeta.data, left: Math.max(0, left), top: Math.max(0, top) }])
    .webp({ quality })
    .toBuffer();
}
