/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MIXED STAND IN DER ARTIKELMASKE ZUR AUSWAHL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `MIXED` ist kein Steuerschlüssel, sondern ein GERÜSTWERT am Belegkopf: er
 * sagt „dieser Beleg trägt mehrere Behandlungen". Ein einzelner Gegenstand
 * kann das nie sein.
 *
 * Trotzdem bot ihn die Artikelmaske an, in `ProductSheet.tsx` und in
 * `NeuesProduktDialog.tsx`, und der Server nahm ihn an. Im Monatslauf
 * gemessen, was dann geschieht:
 *
 *     Ein Stück zu 119,00 EUR mit MIXED
 *       → die Kasse rechnet 0,00 EUR Steuer, der Bon weist 0,00 aus
 *       → die Buchungszeile geht auf 8400 (Erlöse 19 %) OHNE Schlüssel
 *
 * Beleg und Buchhaltung widersprechen sich um den vollen Steuerbetrag, ohne
 * eine einzige Fehlermeldung. Es braucht keinen Angreifer — ein Griff in ein
 * Auswahlfeld genügt.
 *
 * Am 28.07.2026 gemessen: null Produkte betroffen. Ein Zeitfenster, kein
 * Dauerzustand — und es schliesst, BEVOR eine Kasse damit beim Händler steht.
 */

import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { CreateProductBody, ProductTaxTreatmentCode } from '../../src/schemas/product.js';

const produkt = (code: string) => ({
  sku: 'T-1',
  name: 'Prüfstück',
  itemType: 'other',
  acquisitionCostEur: '50.00',
  listPriceEur: '119.00',
  taxTreatmentCode: code,
  condition: 'USED_GOOD',
  hallmarkStamps: [],
  isCommission: false,
  listedOnStorefront: false,
  listedOnEbay: false,
});

describe('⛔ MIXED ist keine Eigenschaft einer Ware', () => {
  it('der Server weist ein Produkt mit MIXED AB', () => {
    expect(Value.Check(CreateProductBody, produkt('MIXED'))).toBe(false);
  });

  it('und der Steuerarttyp des Produkts kennt es gar nicht', () => {
    expect(Value.Check(ProductTaxTreatmentCode, 'MIXED')).toBe(false);
  });
});

describe('was weiterhin erlaubt ist', () => {
  it('jede echte Steuerart geht durch', () => {
    for (const code of [
      'MARGIN_25A',
      'INVESTMENT_GOLD_25C',
      'STANDARD_19',
      'REDUCED_7',
      'REVERSE_CHARGE_13B',
    ]) {
      expect(Value.Check(CreateProductBody, produkt(code)), code).toBe(true);
    }
  });

  it('⚠️ und der BELEGKOPF darf MIXED weiterhin tragen', async () => {
    // Dort ist es richtig: ein gemischter Beleg IST gemischt. Wer das mit
    // wegnimmt, bricht die Aufteilung eines Belegs mit mehreren Behandlungen.
    const { TaxTreatmentCode } = await import('../../src/schemas/transaction.js');
    expect(Value.Check(TaxTreatmentCode, 'MIXED')).toBe(true);
  });
});

/**
 * ⚠️ Der Wächter auf der Kassenseite. Beide Masken, nicht nur eine.
 */
describe('die Artikelmasken bieten es nicht mehr an', () => {
  const lies = async (p: string) =>
    (await import('node:fs')).readFileSync(new URL(p, import.meta.url), 'utf8');

  for (const datei of [
    '../../../tauri-pos/src/screens/lager/ProductSheet.tsx',
    '../../../tauri-pos/src/screens/lager/NeuesProduktDialog.tsx',
  ]) {
    it(`${datei.split('/').pop()} hat MIXED nicht in TAX_OPTIONS`, async () => {
      const q = await lies(datei);
      const i = q.indexOf('const TAX_OPTIONS');
      expect(i, 'TAX_OPTIONS gibt es nicht mehr — Prüfung anpassen').toBeGreaterThan(0);
      const block = q.slice(i, q.indexOf('];', i));
      expect(block, 'MIXED steht wieder zur Auswahl').not.toContain("'MIXED'");
      // Und die echten Arten müssen noch da sein — sonst hätte jemand die
      // Liste geleert statt sie zu bereinigen.
      expect(block).toContain("'MARGIN_25A'");
      expect(block).toContain("'INVESTMENT_GOLD_25C'");
      expect(block).toContain("'REVERSE_CHARGE_13B'");
    });
  }
});
