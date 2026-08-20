/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Die Kasse schlägt eine Artikelnummer vor — an BEIDEN Stellen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Befund steht in `sku-vorschlag.ts`: die Artikelnummer ist am Ankauf ein
 * Pflichtfeld, und der Vorschlag lag als private Funktion im Lager. Wer am
 * Tresen einen Ring kaufte, dachte sich also eine Nummer aus, während der
 * Verkäufer wartete.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ART_KUERZEL, skuVorschlag } from './sku-vorschlag.js';

const HEUTE = new Date('2026-08-20T10:00:00');
/** Ein Zufall, der sich nicht bewegt — sonst prüft die Probe eine Lotterie. */
const FEST = (): number => 0;

describe('Die vorgeschlagene Artikelnummer', () => {
  it('trägt Warenart, Tag und einen Zufallsteil', () => {
    expect(skuVorschlag('gold_coin', HEUTE, FEST)).toBe('GM-260820-AAAA');
    expect(skuVorschlag('silver_bar', HEUTE, FEST)).toBe('SB-260820-AAAA');
  });

  it('⛔ enthält KEINE verwechselbaren Zeichen', () => {
    /*
     * Eine Artikelnummer wird von einer Etikette abgelesen und am Tresen
     * nachgetippt. `I` gegen `1` und `O` gegen `0` kosten irgendwann eine
     * falsche Zuordnung — und die fällt erst bei der Inventur auf.
     */
    let i = 0;
    const durchlauf = (): number => (i++ % 32) / 32;
    const alle = Array.from({ length: 40 }, () => skuVorschlag('other', HEUTE, durchlauf));
    for (const sku of alle) {
      const teil = sku.split('-')[2]!;
      expect(teil, sku).not.toMatch(/[IO01]/);
    }
  });

  it('jede Warenart hat ihr eigenes Kürzel', () => {
    const kuerzel = Object.values(ART_KUERZEL);
    expect(new Set(kuerzel).size, 'zwei Warenarten teilen sich ein Kürzel').toBe(kuerzel.length);
    for (const k of kuerzel) expect(k).toMatch(/^[A-Z]{2}$/);
  });

  it('der Tag steht als JJMMTT darin', () => {
    expect(skuVorschlag('watch', new Date('2027-01-05T10:00:00'), FEST)).toBe('UH-270105-AAAA');
  });

  it('zwei Vorschläge sind verschieden', () => {
    // Ohne festen Zufall: die Nummern dürfen nicht kollidieren.
    const viele = new Set(Array.from({ length: 200 }, () => skuVorschlag('gold_bar', HEUTE)));
    expect(viele.size).toBeGreaterThan(190);
  });
});

describe('⛔ Beide Flächen benutzen DENSELBEN Vorschlag', () => {
  const HIER = dirname(fileURLToPath(import.meta.url));
  const lies = (p: string): string => readFileSync(join(HIER, '..', p), 'utf8');

  it('das Lager hat keine eigene Tabelle mehr', () => {
    /*
     * Bis zum 20.08.2026 stand die Zuordnung Warenart → Kürzel als private
     * Tabelle in `ProductSheet.tsx`. Zwei Tabellen hätten irgendwann zwei
     * Nummernkreise ergeben, und die Etiketten im Regal widersprächen sich.
     */
    const lager = lies('screens/lager/ProductSheet.tsx');
    expect(lager).toContain('skuVorschlag');
    expect(/const TYPE_PREFIX\s*:/.test(lager), 'die alte Tabelle ist zurück').toBe(false);
  });

  it('⛔ und der ANKAUF schlägt auch eine vor', () => {
    // Der eigentliche Anlass: dort war die Nummer ein Pflichtfeld ohne Hilfe.
    const ankauf = lies('screens/ankauf/IntakeList.tsx');
    expect(ankauf).toContain('skuVorschlag');
  });
});
