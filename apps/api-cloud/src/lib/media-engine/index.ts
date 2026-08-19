/**
 * Omnichannel media engine (Decision #48): product metadata + transparent
 * cutout → luxury WebP marketing card.
 *
 *   [meta + cutout] → buildProductCardElement → Satori SVG → Sharp composite → WebP
 *
 * The route/worker fetches the cutout bytes from R2, calls generateProductCard,
 * then stores the result back to R2 via putObjectToR2 (see lib/r2.ts).
 */

import { compositeCardWebp } from './composite.js';
import { type CardFont, renderCardSvg } from './render.js';
import type { CardTheme, ProductCardMeta } from './template.js';

export * from './template.js';
export * from './render.js';
export * from './composite.js';

export interface GenerateProductCardArgs {
  meta: ProductCardMeta;
  /** Transparent cutout bytes (the r2KeyBgRemoved object). */
  cutoutBytes: Buffer;
  /** Satori fonts (≥1). */
  fonts: CardFont[];
  /** ⚠️ Pflicht: der Schriftzug gehoert dem Haendler und wird nie erfunden. */
  theme: CardTheme;
  cutoutScale?: number;
  quality?: number;
}

/** End-to-end: render the card SVG and composite the cutout into a WebP. */
export async function generateProductCard(args: GenerateProductCardArgs): Promise<Buffer> {
  const theme = args.theme;
  const svg = await renderCardSvg(args.meta, args.fonts, theme);
  return compositeCardWebp({
    background: { svg },
    cutoutBytes: args.cutoutBytes,
    width: theme.width,
    height: theme.height,
    ...(args.cutoutScale !== undefined ? { cutoutScale: args.cutoutScale } : {}),
    ...(args.quality !== undefined ? { quality: args.quality } : {}),
  });
}
