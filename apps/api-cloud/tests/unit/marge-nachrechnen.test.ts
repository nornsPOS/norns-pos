/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER KLIENT ERKLÄRTE SEINE EIGENE STEUER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `validateTransactionMath` prüfte bei § 25a genau EINE Sache: dass
 * `marginEur` und `acquisitionCostEurSnapshot` gemeinsam gesetzt sind
 * (`transaction-math.ts:140`). Ob die Zahlen STIMMEN, prüfte niemand.
 *
 * Ein Aufrufer mit Kassiererrecht konnte also einen erfundenen Einkaufspreis
 * schicken und damit jede beliebige Steuer — in eine hashverkettete, nicht
 * mehr änderbare Aufzeichnung. Und es fiel nirgends auf: die Bilanzgleichung
 * ging auf, die Summen stimmten, der Beleg sah aus wie jeder andere.
 */

import { describe, expect, it } from 'vitest';

import { pruefeMargen, type MargenZeile } from '../../src/lib/marge-nachrechnen.js';

/** Eine echte Zeile aus dem Bestand: Goldmünze, VK 270,00, EK 250,00. */
const echt = (ueber: Partial<MargenZeile> = {}): MargenZeile => ({
  index: 0,
  appliedTaxTreatmentCode: 'MARGIN_25A',
  lineTotalCent: 27_000n,
  behaupteterEinkaufCent: 25_000n,
  behaupteteMargeCent: 2_000n,
  behaupteteSteuerCent: 319n,
  echterEinkaufCent: 25_000n,
  ...ueber,
});

/**
 * Der Tag, von dem diese Proben sprechen. Seit dem 20.08.2026 besteuert die
 * Nachrechnung die Marge mit dem Regelsatz DIESES Tages — im Corona-Halbjahr
 * 2020 waeren es 16 statt 19 Prozent, und die Zahlen unten gingen nicht auf.
 */
const TAG = '2026-08-20';

describe('✅ die ehrliche Zeile geht durch', () => {
  it('Goldmuenze VK 270,00 / EK 250,00 → Marge 20,00, Steuer 3,19', () => {
    expect(pruefeMargen([echt()], TAG)).toEqual([]);
  });

  it('ein Cent Rundungsspiel bei der Steuer bleibt erlaubt', () => {
    // Sonst stuende ein legitimer Verkauf still — und ein Riegel, der
    // legitime Vorgaenge blockiert, wird abgeschaltet.
    expect(pruefeMargen([echt({ behaupteteSteuerCent: 320n })], TAG)).toEqual([]);
    expect(pruefeMargen([echt({ behaupteteSteuerCent: 318n })], TAG)).toEqual([]);
  });

  it('ein Verlustverkauf: Marge null, Steuer null', () => {
    // Abschn. 25a.1 Abs. 12 UStAE — das Finanzamt zahlt nichts zurueck.
    const b = pruefeMargen([
      echt({
        lineTotalCent: 200_000n,
        behaupteterEinkaufCent: 480_000n,
        echterEinkaufCent: 480_000n,
        behaupteteMargeCent: 0n,
        behaupteteSteuerCent: 0n,
      }, TAG),
    ], TAG);
    expect(b).toEqual([]);
  });

  it('andere Steuerarten werden hier nicht angefasst', () => {
    for (const k of ['STANDARD_19', 'INVESTMENT_GOLD_25C', 'REVERSE_CHARGE_13B', null]) {
      expect(
        pruefeMargen([echt({ appliedTaxTreatmentCode: k, echterEinkaufCent: null })], TAG),
        String(k),
      ).toEqual([]);
    }
  });
});

describe('⛔ DER ANGRIFF: einen Einkaufspreis erfinden', () => {
  it('ein zu HOHER Einkaufspreis druekt die Steuer — und wird abgewiesen', () => {
    // Der Kern des Befunds. 269,00 statt 250,00 behauptet → Steuer 0,16
    // statt 3,19.
    const b = pruefeMargen([
      echt({ behaupteterEinkaufCent: 26_900n, behaupteteMargeCent: 100n, behaupteteSteuerCent: 16n }, TAG),
    ], TAG);
    expect(b).toHaveLength(1);
    expect(b[0]?.field).toBe('items[0].acquisitionCostEurSnapshot');
    expect(b[0]?.expected).toBe('250,00 EUR');
    expect(b[0]?.actual).toBe('269,00 EUR');
  });

  it('und ein zu NIEDRIGER ebenso — der Riegel geht in beide Richtungen', () => {
    // Zu viel ausgewiesene Steuer schuldet man nach § 14c genauso.
    expect(
      pruefeMargen([echt({ behaupteterEinkaufCent: 10_000n, behaupteteMargeCent: 17_000n })], TAG),
    ).toHaveLength(1);
  });

  it('⛔ eine Marge, die nicht aus Preis minus Einkauf folgt', () => {
    const b = pruefeMargen([echt({ behaupteteMargeCent: 500n })], TAG);
    expect(b[0]?.field).toBe('items[0].marginEur');
    expect(b[0]?.expected).toBe('20,00 EUR');
  });

  it('⛔ eine Steuer, die nicht aus der Marge folgt', () => {
    const b = pruefeMargen([echt({ behaupteteSteuerCent: 50n })], TAG);
    expect(b[0]?.field).toBe('items[0].lineVatEur');
    expect(b[0]?.expected).toBe('3,19 EUR');
  });

  it('⛔ ohne hinterlegten Einkaufspreis ist § 25a nicht belegbar', () => {
    // § 25a Abs. 6 UStG verlangt die Aufzeichnung. Ohne sie waere die Marge
    // eine Behauptung ohne Grundlage.
    const b = pruefeMargen([echt({ echterEinkaufCent: null })], TAG);
    expect(b[0]?.message).toContain('§ 25a Abs. 6');
  });

  it('⛔ und wenn der Klient GAR KEINEN Einkaufspreis mitschickt', () => {
    expect(pruefeMargen([echt({ behaupteterEinkaufCent: null })], TAG)).toHaveLength(1);
  });
});

describe('die Meldung taugt fuer einen Menschen am Tresen', () => {
  it('sie nennt BEIDE Zahlen', () => {
    const b = pruefeMargen([echt({ behaupteterEinkaufCent: 26_900n })], TAG);
    expect(b[0]?.expected).toMatch(/EUR$/);
    expect(b[0]?.actual).toMatch(/EUR$/);
    // Deutsches Komma, nicht der englische Punkt.
    expect(b[0]?.expected).toContain(',');
  });

  it('und sagt, WORAN es haengt', () => {
    const b = pruefeMargen([echt({ behaupteterEinkaufCent: 26_900n })], TAG);
    expect(b[0]?.message).toContain('§ 25a');
  });
});

describe('mehrere Zeilen', () => {
  it('jede falsche Zeile wird einzeln benannt', () => {
    const b = pruefeMargen([
      echt({ index: 0 }, TAG),
      echt({ index: 1, behaupteteMargeCent: 1n }),
      echt({ index: 2, behaupteteSteuerCent: 9_999n }),
    ], TAG);
    expect(b).toHaveLength(2);
    expect(b.map((x) => x.field)).toEqual(['items[1].marginEur', 'items[2].lineVatEur']);
  });
});

/**
 * ⚠️ Der Wächter gegen die Rückkehr des blinden Vertrauens.
 */
describe('finalize rechnet WIRKLICH nach', () => {
  const lies = async () =>
    (await import('node:fs')).readFileSync(
      new URL('../../src/routes/transactions-finalize.ts', import.meta.url),
      'utf8',
    );

  it('die Route ruft den Riegel an', async () => {
    const q = await lies();
    expect(/(?<!as\s)\bpruefeMargen\s*\(/.test(q), 'finalize rechnet die Marge nicht nach').toBe(true);
  });

  it('⚠️ und sie liest den ECHTEN Einkaufspreis aus dem Bestand', async () => {
    // Ohne diese Abfrage waere der Riegel ein Vergleich der Klientenzahl mit
    // sich selbst — gruen und wertlos.
    const q = await lies();
    const i = q.indexOf('pruefeMargen(', TAG);
    const block = q.slice(i, q.indexOf('  );', i) + 4);
    const davor = q.slice(Math.max(0, q.indexOf('pruefeMargen(', TAG) - 1200), q.indexOf('pruefeMargen(', TAG));
    expect(davor).toContain('acquisition_cost_eur');
    expect(davor).toContain('FROM products');

    // ⚠️ Und der gelesene Wert muss WIRKLICH dorthin. Der erste Entwurf pruefte
    // nur, dass `echterEinkaufCent` im Block vorkommt — und blieb gruen, als
    // ich zur Probe `zuCent(it.acquisitionCostEurSnapshot)` einsetzte. Dann
    // haette der Riegel die Klientenzahl mit sich selbst verglichen: gruen und
    // vollkommen wertlos.
    expect(block, 'echterEinkaufCent kommt nicht aus dem Bestand').toMatch(
      /echterEinkaufCent:\s*zuCent\(jeId\.get\(/,
    );
    expect(
      /echterEinkaufCent:\s*zuCent\(it\./.test(block),
      'echterEinkaufCent kommt aus dem Anfragerumpf statt aus dem Bestand',
    ).toBe(false);
  });

  it('er steht VOR dem Schreiben', async () => {
    /*
     * 14.08.2026: der Anker hiess hier `app.db.transaction`. Diese WOERTLICHE
     * Folge stand aber nur im eBay-Sofort-Delist NACH dem Commit; der echte
     * fiskale Schreibbeginn ist `await app.db` mit `.transaction(` auf der
     * NAECHSTEN Zeile. Der Waechter mass also gegen die falsche Stelle und
     * haette eine Pruefung INNERHALB des fiskalen Blocks nicht bemerkt. Mit
     * der Trennung von warehouse14 fiel der eBay-Block, der Anker lief ins
     * Leere (indexOf -1), und der Fehler wurde sichtbar. Jetzt haengt er am
     * echten Beginn des fiskalen Blocks.
     */
    const q = await lies();
    expect(q.indexOf('pruefeMargen(', TAG)).toBeLessThan(q.indexOf('.transaction(async (tx) => {'));
  });
});
