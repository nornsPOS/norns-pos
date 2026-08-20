/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINE BARRE IST KEIN GEBRAUCHTGEGENSTAND (19.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * § 25a Abs. 1 Nr. 3 UStG nimmt Edelmetalle namentlich nach Zolltarif aus dem
 * Verfahren: Positionen 71 06 (Silber), 71 08 (Gold), 71 10 (Platin). Für
 * Rohmetall in Barrenform gibt es kein Wahlrecht.
 *
 * Bis heute prüfte das niemand, und der Weg dorthin war der bequemste von
 * allen: `NeuesProduktDialog.tsx` stellt das Steuerfeld für JEDE Warenart auf
 * `MARGIN_25A` vor. Wer eine Silberbarre anlegt und das Feld nicht anfasst,
 * verkauft sie differenzbesteuert.
 *
 *     Silberbarre, EK 800,00 / VK 1.000,00
 *       nach § 25a   Marge 200,00 → 19/119 →   31,93 EUR
 *       nach Gesetz  1.000,00 brutto → 19/119 → 159,66 EUR
 *       ────────────────────────────────────────────────
 *       zu wenig erklärt                       127,73 EUR — je Barre.
 *
 * Der Prüfer rechnete die Marge sauber nach. Er fragte nur nie, WAS er da
 * bemargt.
 */

import { describe, expect, it } from 'vitest';
import { pruefeMargen, type MargenZeile } from '../../src/lib/marge-nachrechnen.js';

/** Silberbarre, EK 800,00 / VK 1.000,00 — die Zahlen selbst sind stimmig. */
function barre(warenart: string | null): MargenZeile {
  return {
    index: 0,
    appliedTaxTreatmentCode: 'MARGIN_25A',
    lineTotalCent: 100_000n,
    behaupteterEinkaufCent: 80_000n,
    behaupteteMargeCent: 20_000n,
    behaupteteSteuerCent: 3193n, // 19/119 von 200,00 — rechnerisch korrekt
    echterEinkaufCent: 80_000n,
    warenart,
  };
}

/**
 * Der Tag, von dem diese Proben sprechen. Seit dem 20.08.2026 besteuert die
 * Nachrechnung die Marge mit dem Regelsatz DIESES Tages — im Corona-Halbjahr
 * 2020 waeren es 16 statt 19 Prozent, und die Zahlen unten gingen nicht auf.
 */
const TAG = '2026-08-20';

describe('§ 25a Abs. 1 Nr. 3 UStG — tariflich ausgeschlossene Ware', () => {
  it.each(['gold_bar', 'silver_bar', 'platinum_bar'])(
    'weist %s zurück, obwohl die Marge stimmt',
    (art) => {
      const befunde = pruefeMargen([barre(art)], TAG);
      expect(befunde).toHaveLength(1);
      expect(befunde[0]?.field).toBe('items[0].appliedTaxTreatmentCode');
      expect(befunde[0]?.message).toContain('Barrenform');
      expect(befunde[0]?.expected).toBe('STANDARD_19');
    },
  );

  // ⚠️ Die Gegenprobe ist der eigentliche Wert dieser Datei. Eine Regel, die
  // alles Goldene ablehnt, wäre schlimmer als gar keine: die gebrauchte
  // Goldmünze und der angekaufte Ring SIND der klassische Fall der
  // Differenzbesteuerung. Münzen stehen in Position 71 18, Schmuck in 71 13 —
  // beide nennt § 25a Abs. 1 Nr. 3 nicht.
  it.each([
    'gold_coin',
    'gold_jewelry',
    'silver_coin',
    'silver_jewelry',
    'platinum_coin',
    'platinum_jewelry',
    'watch',
    'antique',
    'other',
  ])('lässt %s durch — dafür ist das Verfahren gemacht', (art) => {
    expect(pruefeMargen([barre(art)], TAG)).toHaveLength(0);
  });

  it('rät nicht, wenn die Warenart fehlt', () => {
    // Ein Aufrufer ohne Bestandszeile darf nicht dazu führen, dass ein
    // rechtmässiger Verkauf abgelehnt wird. Lieber keine Prüfung als eine
    // erfundene.
    expect(pruefeMargen([barre(null)], TAG)).toHaveLength(0);
  });

  it('prüft die Warenart VOR der Rechnung', () => {
    // Sonst käme bei einer Barre mit erfundener Marge der Rechenbefund zuerst,
    // und der Händler korrigierte die Zahl statt den Schlüssel — er landete
    // beim nächsten Versuch wieder in einem Verfahren, das ihm verschlossen ist.
    const falscheZahlUndFalscheWare: MargenZeile = { ...barre('gold_bar'), behaupteteMargeCent: 1n };
    const befunde = pruefeMargen([falscheZahlUndFalscheWare], TAG);
    expect(befunde).toHaveLength(1);
    expect(befunde[0]?.field).toBe('items[0].appliedTaxTreatmentCode');
  });
});
