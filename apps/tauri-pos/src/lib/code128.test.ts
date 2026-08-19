/**
 * Der Strichcode muss gegen die NORM stimmen, nicht gegen sich selbst.
 *
 * Ein Test, der nur prüft „es kommen Zahlen heraus", würde einen falschen
 * Strichcode durchwinken. Der Fehler fiele erst am Handscanner auf, wenn das
 * Paket schon zu ist. Deshalb steht hier eine von Hand nachgerechnete
 * Prüfsumme und ein Muster, das aus der Tabelle von Code 128 stammt.
 */

import { describe, expect, it } from 'vitest';

import { Code128UnkodierbarError, code128BalkenBreiten, code128Svg } from './code128.js';

describe('code128BalkenBreiten', () => {
  it('kodiert eine Bestellnummer mit der von Hand nachgerechneten Prüfsumme', () => {
    // „BST-2026-000001" in Zeichenmenge B:
    //   Start B = 104
    //   B=34, S=51, T=52, -=13, 2=18, 0=16, 2=18, 6=22, -=13,
    //   0=16, 0=16, 0=16, 0=16, 0=16, 1=17
    // Prüfsumme = (104 + 34*1 + 51*2 + 52*3 + 13*4 + 18*5 + 16*6 + 18*7
    //              + 22*8 + 13*9 + 16*10 + 16*11 + 16*12 + 16*13 + 16*14
    //              + 17*15) mod 103
    const werte = [34, 51, 52, 13, 18, 16, 18, 22, 13, 16, 16, 16, 16, 16, 17];
    let summe = 104;
    werte.forEach((w, i) => {
      summe += w * (i + 1);
    });
    const pruefsumme = summe % 103;

    const breiten = code128BalkenBreiten('BST-2026-000001');

    // Start (6) + 15 Zeichen (90) + Prüfsumme (6) + Schluss (7) = 109 Elemente.
    expect(breiten).toHaveLength(6 + werte.length * 6 + 6 + 7);

    // Das Startzeichen 104 hat in der Tabelle das Muster „211214".
    expect(breiten.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);

    // Das Schlusszeichen ist immer „2331112" und steht am Ende.
    expect(breiten.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);

    // Und die Prüfsumme steht direkt davor. Ihr Muster wird hier NICHT aus dem
    // Modul geholt, sondern aus derselben Tabelle nachgeschlagen, damit der
    // Test nicht die Implementierung gegen sich selbst prüft.
    const MUSTER_DER_PRUEFSUMME: Record<number, number[]> = {
      // 2 → „222221". Der Wert 2 ist das Ergebnis der Rechnung oben:
      // 2268 mod 103 = 2, denn 103 · 22 = 2266.
      2: [2, 2, 2, 2, 2, 1],
    };
    expect(pruefsumme).toBe(2);
    expect(breiten.slice(-13, -7)).toEqual(MUSTER_DER_PRUEFSUMME[2]);
  });

  it('beginnt und endet mit einem Strich', () => {
    const breiten = code128BalkenBreiten('BST-2026-000042');
    // Ein Code 128 fängt mit einem Strich an; das Schlusszeichen hat sieben
    // Elemente, damit er auch mit einem Strich aufhört.
    expect(breiten.length % 2).toBe(1);
  });

  it('weist ein Zeichen zurück, das die Zeichenmenge nicht kennt', () => {
    // Ein Umlaut sieht auf der Marke unschuldig aus und hätte kein Muster.
    // Still weglassen wäre ein Strichcode, der etwas ANDERES sagt als der Text
    // darunter — genau der Fehler, den niemand vor dem Versand bemerkt.
    expect(() => code128BalkenBreiten('BST-2026-Ü')).toThrow(Code128UnkodierbarError);
    expect(() => code128BalkenBreiten('')).toThrow(Code128UnkodierbarError);
  });
});

describe('code128Svg', () => {
  it('zeichnet nur die Striche, nicht die Lücken', () => {
    const svg = code128Svg('BST-2026-000001');
    const breiten = code128BalkenBreiten('BST-2026-000001');
    const striche = breiten.filter((_, i) => i % 2 === 0).length;
    expect(svg.match(/<rect /g) ?? []).toHaveLength(striche);
  });

  it('trägt die Bestellnummer als Beschriftung, damit sie vorlesbar bleibt', () => {
    expect(code128Svg('BST-2026-000001')).toContain('aria-label="Strichcode BST-2026-000001"');
  });

  it('rechnet die Breite in Millimetern aus den Einheiten', () => {
    const breiten = code128BalkenBreiten('BST-2026-000001');
    const erwartet = (breiten.reduce((a, b) => a + b, 0) * 0.5).toFixed(3);
    expect(code128Svg('BST-2026-000001', { einheit: 0.5 })).toContain(`width="${erwartet}mm"`);
  });
});
