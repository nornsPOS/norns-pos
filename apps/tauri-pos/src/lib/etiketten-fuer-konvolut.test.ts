/**
 * Ein Etikett trägt die ARTIKELNUMMER, nie die Datensatz-Kennung.
 *
 * Der Unterschied ist kein Detail: die Kasse löst einen Scan über SKU oder
 * Barcode auf und schreibt den Suchbegriff dabei gross. Eine kleingeschriebene
 * UUID trifft nichts, und die Ware ist am Tresen nicht auffindbar.
 */
import { describe, expect, it, vi } from 'vitest';

import { etikettenFuerKonvolut, etikettenHinweis } from './etiketten-fuer-konvolut.js';

vi.mock('@norns/api-client', () => ({
  productsApi: {
    get: vi.fn(async (_c: unknown, id: string) => {
      if (id === 'kaputt') throw new Error('nicht erreichbar');
      if (id === 'ohne-sku') return { sku: '   ' };
      return { sku: `SKU-${id.toUpperCase()}` };
    }),
  },
}));

const api = {} as never;

describe('etikettenFuerKonvolut', () => {
  it('setzt die ARTIKELNUMMER, nicht die Datensatz-Kennung', async () => {
    const { etiketten, ohneNummer } = await etikettenFuerKonvolut(api, [
      { productId: 'a3f1', name: 'Silbergroschen' },
      { productId: 'b7c2', name: '20 Mark' },
    ]);
    expect(etiketten.map((e) => e.sku)).toEqual(['SKU-A3F1', 'SKU-B7C2']);
    // Die UUID darf NIRGENDS mehr im Etikett stehen.
    expect(etiketten.some((e) => e.sku === 'a3f1')).toBe(false);
    expect(ohneNummer).toBe(0);
  });

  it('überspringt ein Stück ohne Produkt, statt es zu erfinden', async () => {
    const { etiketten, ohneNummer } = await etikettenFuerKonvolut(api, [
      { productId: null, name: 'abgelehnt' },
      { productId: 'a3f1', name: 'Silbergroschen' },
    ]);
    expect(etiketten).toHaveLength(1);
    // Ein abgelehntes Stueck ist kein Fehler, es hat nur kein Produkt.
    expect(ohneNummer).toBe(0);
  });

  it('druckt KEIN Etikett, wenn die Nummer nicht abrufbar ist', async () => {
    // Lieber kein Etikett als eines mit einem Barcode, den das eigene Haus
    // nicht lesen kann.
    const { etiketten, ohneNummer } = await etikettenFuerKonvolut(api, [
      { productId: 'kaputt', name: 'Netz weg' },
      { productId: 'ohne-sku', name: 'Datensatz ohne Nummer' },
      { productId: 'a3f1', name: 'Silbergroschen' },
    ]);
    expect(etiketten).toHaveLength(1);
    expect(ohneNummer).toBe(2);
  });

  it('reicht Gewicht und Karat durch', async () => {
    const { etiketten } = await etikettenFuerKonvolut(api, [
      { productId: 'a3f1', name: 'Ring', weightGrams: '4.20', karatCode: '585' },
    ]);
    expect(etiketten[0]).toMatchObject({ weightGrams: '4.20', karat: '585' });
  });
});

describe('etikettenHinweis', () => {
  it('schweigt, wenn alles glattging', () => {
    expect(etikettenHinweis({ etiketten: [], ohneNummer: 0 })).toBeNull();
  });

  it('sagt es, wenn Etiketten fehlen — ein stiller Teilerfolg faellt erst am Regal auf', () => {
    const m = etikettenHinweis({ etiketten: [], ohneNummer: 2 });
    expect(m).toContain('2 Stücke haben kein Etikett');
    expect(m).toContain('nachdrucken');
  });

  it('beugt die Einzahl', () => {
    expect(etikettenHinweis({ etiketten: [], ohneNummer: 1 })).toContain('1 Stück hat');
  });
});
