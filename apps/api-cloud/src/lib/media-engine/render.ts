/**
 * Satori wrapper — turns the pure card element tree into an SVG string.
 *
 * Satori requires at least one embedded font (it has no system-font access).
 * The caller injects the TTF/OTF bytes (loaded from disk or R2), keeping this
 * module side-effect-free and the font choice configurable.
 */

import satori from 'satori';

import { type CardTheme, type ProductCardMeta, buildProductCardElement } from './template.js';

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface CardFont {
  name: string;
  data: Buffer | ArrayBuffer;
  weight?: FontWeight;
  style?: 'normal' | 'italic';
}

/** Render the luxury card to an SVG string via Satori. Requires ≥1 font. */
export async function renderCardSvg(
  meta: ProductCardMeta,
  fonts: CardFont[],
  theme: CardTheme,
): Promise<string> {
  if (fonts.length === 0) {
    throw new Error('renderCardSvg: at least one font is required by Satori');
  }
  const element = buildProductCardElement(meta, theme);
  // Satori's element type is ReactNode; our structural node is compatible.
  return satori(element as unknown as Parameters<typeof satori>[0], {
    width: theme.width,
    height: theme.height,
    fonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight ?? 400,
      style: f.style ?? 'normal',
    })),
  });
}
