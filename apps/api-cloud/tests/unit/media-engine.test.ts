import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  buildProductCardElement,
  buildSpecLine,
  compositeCardWebp,
  kartenThema,
} from '../../src/lib/media-engine/index.js';

/** A solid-colour PNG of the given size (mock background bytes). */
async function solidPng(
  width: number,
  height: number,
  rgb: [number, number, number],
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

/** A transparent PNG with a smaller opaque square in the middle (mock cutout). */
async function transparentCutout(size: number): Promise<Buffer> {
  const inner = await sharp({
    create: {
      width: Math.floor(size / 2),
      height: Math.floor(size / 2),
      channels: 4,
      background: { r: 200, g: 160, b: 70, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toBuffer();
}

describe('buildSpecLine', () => {
  it('includes karat + weight + sku when present', () => {
    expect(buildSpecLine({ sku: 'W14-1', title: 'Ring', karat: '585', weightGrams: '3.20' })).toBe(
      '585  ·  3.20 g  ·  W14-1',
    );
  });
  it('omits missing fields but always keeps the sku', () => {
    expect(buildSpecLine({ sku: 'W14-2', title: 'Ring' })).toBe('W14-2');
    expect(buildSpecLine({ sku: 'W14-3', title: 'Ring', karat: '750' })).toBe('750  ·  W14-3');
  });
});

describe('buildProductCardElement', () => {
  it('produces a div tree carrying the title, spec line and price', () => {
    const node = buildProductCardElement(
      {
        sku: 'W14-AU-585-0012',
        title: 'Goldring 585',
        karat: '585',
        weightGrams: '3.20',
        priceEur: '249.00',
      },
      kartenThema('Juwelier Musterhaus'),
    );
    expect(node.type).toBe('div');
    const flat = JSON.stringify(node);
    expect(flat).toContain('Goldring 585');
    expect(flat).toContain('585  ·  3.20 g  ·  W14-AU-585-0012');
    expect(flat).toContain('249.00 €');

    // ⚠️ Hier stand `expect(flat).toContain('WAREHOUSE 14')`. Das war kein
    // Waechter, das war eine SPERRE: der Test pinnte den Namen einer fremden
    // Firma fest, und wer ihn entfernte, bekam Rot. Gemessen wird jetzt, dass
    // der MITGEGEBENE Schriftzug ankommt, nicht ein bestimmtes Wort.
    expect(flat).toContain('Juwelier Musterhaus');
    expect(flat, 'der Name einer fremden Firma steht wieder auf der Karte').not.toContain(
      'WAREHOUSE 14',
    );
  });

  it('⛔ ohne Schriftzug entsteht gar keine Karte', () => {
    // Eine Karte ohne Schriftzug waere ein Werbebild ohne Absender. Lieber ein
    // sichtbarer Abbruch als ein stillschweigend eingesetzter fremder Name,
    // und genau das war der Zustand bis zum 13.08.2026.
    expect(() => kartenThema('   ')).toThrow(/Schriftzug fehlt/);
  });
});

describe('compositeCardWebp (mock bytes)', () => {
  it('composites a cutout onto a raster background → WebP of the target size', async () => {
    const bg = await solidPng(240, 240, [15, 13, 10]);
    const cutout = await transparentCutout(200);

    const out = await compositeCardWebp({
      background: { bytes: bg },
      cutoutBytes: cutout,
      width: 240,
      height: 240,
      quality: 80,
    });

    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(240);
    expect(meta.height).toBe(240);
    expect(out.length).toBeGreaterThan(0);
  });

  it('rasterizes an SVG background and overlays the cutout', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#0f0d0a"/></svg>`;
    const cutout = await transparentCutout(160);

    const out = await compositeCardWebp({
      background: { svg },
      cutoutBytes: cutout,
      width: 200,
      height: 200,
    });

    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
  });
});
