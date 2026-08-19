/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE KASSE VERWARF DAS § 25a-KENNZEICHEN UND RECHNETE 19 % VOM VOLLPREIS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am 26.07.2026 an der Produktion gemessen:
 *
 *     MARGIN_25A           60 Stück   mit Verkäufer: 0   Kommission: 0
 *     STANDARD_19          47 Stück   mit Verkäufer: 0   Kommission: 0
 *     INVESTMENT_GOLD_25C   8 Stück   mit Verkäufer: 0   Kommission: 0
 *
 * `classifyCartProductTax` verlangte `acquiredFromCustomerId !== null ||
 * isCommission`. Beides ist bei ALLEN 115 Stücken leer. Jedes der 60 als
 * § 25a angelegten Stücke fiel also bis auf `STANDARD_19` durch.
 *
 * Was das kostet, an echten Stücken:
 *
 *     Goldmünze     VK 270,00  EK 250,00  →  43,11 € statt 3,19 €
 *     Silberschmuck VK 220,00  EK 199,00  →  35,13 € statt 3,35 €
 *
 * Beim zweiten Stück beträgt die Rohmarge 21,00 EUR. Der Händler zahlte also
 * **mehr Steuer, als er verdient hat** — der Verkauf wäre ein Verlustgeschäft.
 *
 * ⚠️ Und der Fehler war einseitig: die MOBILE Kasse nimmt den hinterlegten
 * Schlüssel seit jeher (`verkauf-flow.ts:74`). Zwei Kassen, dieselbe Ware,
 * zwei verschiedene Steuern.
 */

import { describe, expect, it } from 'vitest';

import { classifyCartProductTax } from './cart-math.js';

/** Ein Stück, wie es auf der Produktion WIRKLICH aussieht: ohne Verkäuferbezug. */
const wieAufDerProduktion = (ueber: Record<string, unknown> = {}) => ({
  itemType: 'silver_jewelry',
  finenessDecimal: null,
  acquiredFromCustomerId: null,
  isCommission: false,
  ...ueber,
});

describe('⛔ der gemessene Fehler', () => {
  it('ein § 25a-Stueck OHNE Verkaeuferbezug bleibt § 25a', () => {
    // Das ist der Fall von 60 der 115 Stuecke auf der Produktion. Vor dem
    // 26.07.2026 kam hier STANDARD_19 heraus.
    expect(
      classifyCartProductTax(wieAufDerProduktion({ taxTreatmentCode: 'MARGIN_25A' })),
    ).toBe('MARGIN_25A');
  });

  it('und Anlagegold bleibt Anlagegold', () => {
    expect(
      classifyCartProductTax(wieAufDerProduktion({ taxTreatmentCode: 'INVESTMENT_GOLD_25C' })),
    ).toBe('INVESTMENT_GOLD_25C');
  });

  it('⚠️ alle drei Schluessel der Produktion ueberleben die Kasse', () => {
    for (const k of ['MARGIN_25A', 'STANDARD_19', 'INVESTMENT_GOLD_25C'] as const) {
      expect(classifyCartProductTax(wieAufDerProduktion({ taxTreatmentCode: k })), k).toBe(k);
    }
  });
});

describe('die Ableitung bleibt der Rueckfall', () => {
  it('ohne hinterlegten Schluessel wird abgeleitet', () => {
    // Fuer Ware, die nie durch einen Ankauf lief.
    expect(classifyCartProductTax(wieAufDerProduktion())).toBe('STANDARD_19');
  });

  it('und der Ankaufsweg leitet weiterhin richtig ab', () => {
    expect(
      classifyCartProductTax(
        wieAufDerProduktion({ acquiredFromCustomerId: 'kunde-1', itemType: 'antique' }),
      ),
    ).toBe('MARGIN_25A');
  });

  it('Anlagegold nach Feingehalt geht der Ableitung weiterhin vor', () => {
    expect(
      classifyCartProductTax(
        wieAufDerProduktion({
          itemType: 'gold_bar',
          finenessDecimal: '0.9990',
          acquiredFromCustomerId: 'kunde-1',
        }),
      ),
    ).toBe('INVESTMENT_GOLD_25C');
  });

  it('⚠️ ein UNSINNIGER hinterlegter Wert wird nicht durchgereicht', () => {
    // Sonst koennte ein Tippfehler in der Datenbank einen Steuerschluessel
    // erfinden, den es nicht gibt.
    for (const murks of ['margin_25a', 'MIXED', 'REVERSE_CHARGE_13B', '', null, undefined]) {
      expect(
        classifyCartProductTax(wieAufDerProduktion({ taxTreatmentCode: murks })),
        String(murks),
      ).toBe('STANDARD_19');
    }
  });
});

describe('⚠️ der Aufrufer gibt den Schluessel WIRKLICH mit', () => {
  const lies = async (p: string) =>
    (await import('node:fs')).readFileSync(new URL(p, import.meta.url), 'utf8');

  it('der Verkaufsbildschirm', async () => {
    // Die Funktion allein nuetzt nichts, wenn der Aufrufer das Feld weglaesst —
    // dann faellt es auf `undefined` und die Ableitung greift wieder.
    const q = await lies('../screens/verkauf/Verkauf.tsx');
    const i = q.indexOf('classifyCartProductTax(');
    const block = q.slice(i, q.indexOf('});', i) + 3);
    expect(block, 'Verkauf.tsx gibt den hinterlegten Schluessel nicht mit').toContain(
      'taxTreatmentCode: detail.taxTreatmentCode',
    );
  });

  // 14.08.2026: der Bestellungen-Fall stand hier; die Flaeche fiel mit dem
  // Kundenshop bei der Trennung von warehouse14.
});

/**
 * Der Betrag, um den es geht — mit den echten Zahlen zweier Stücke aus dem
 * Bestand nachgerechnet.
 */
describe('was der Fehler in Euro bedeutet', () => {
  const steuer19VomVollpreis = (bruttoCent: bigint) => (bruttoCent * 19n) / 119n;
  const steuer25a = (bruttoCent: bigint, einkaufCent: bigint) => {
    const marge = bruttoCent - einkaufCent;
    return marge <= 0n ? 0n : (marge * 19n) / 119n;
  };

  it('Goldmuenze VK 270,00 / EK 250,00', () => {
    expect(steuer19VomVollpreis(27_000n)).toBe(4_310n); // 43,10 €
    expect(steuer25a(27_000n, 25_000n)).toBe(319n); // 3,19 €
  });

  it('⚠️ Silberschmuck VK 220,00 / EK 199,00 — mehr Steuer als Marge', () => {
    const falsch = steuer19VomVollpreis(22_000n);
    const richtig = steuer25a(22_000n, 19_900n);
    const rohmarge = 2_100n;
    expect(falsch).toBe(3_512n); // 35,12 €
    expect(richtig).toBe(335n); // 3,35 €
    // Der eigentliche Skandal: die falsche Steuer uebersteigt die Marge nicht
    // ganz — aber sie frisst sie zu 167 Prozent auf, wenn man den Einkauf
    // gegenrechnet. Der Verkauf waere ein Verlustgeschaeft gewesen.
    expect(falsch).toBeGreaterThan(rohmarge - richtig);
  });
});
