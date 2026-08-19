/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER BUCHUNGSSTAPEL UND DIE DSFinV-K WICHEN UM CENTS VONEINANDER AB
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `computeLineMath` rundet je ZEILE. Fünf Stücke mit je 20,00 EUR Marge
 * ergeben fünfmal 3,19, zusammen 15,95. Der Buchungsstapel fasst dieselben
 * Zeilen zu EINER Buchung über 100,00 EUR zusammen, und DATEV rechnet daraus
 * 15,97.
 *
 * Zwei Cent. Ein Prüfer stellt aber genau das gegenüber: den Buchungsstapel je
 * Erlöskonto gegen die DSFinV-K je Steuerbehandlung. Auf Romans Produktion
 * gemessen: 0,05 EUR über 8 Belege mit mehreren Zeilen derselben Behandlung.
 *
 * ── Welche Zahl richtig ist ─────────────────────────────────────────────
 *
 * § 14 Abs. 4 Nr. 8 UStG verlangt den Steuerbetrag für die RECHNUNG, je
 * Steuersatz — nicht je Position. Die zusammengefasste Zahl ist die
 * massgebliche; die Zeilenaufteilung ist eine Aufgliederung davon.
 *
 * Deshalb: einmal je Beleg und Satz runden, dann nach grössten Resten auf die
 * Zeilen verteilen.
 *
 * ⚠️ Was NICHT wandern darf: der Bruttobetrag der Zeile. Der Kunde zahlt, was
 * auf dem Preisschild stand. Verschoben wird nur die Naht zwischen Netto und
 * Steuer INNERHALB der Zeile.
 */

import { describe, expect, it } from 'vitest';

import { computeLineMath, harmonisiereUstJeSatz, type LineMath } from './cart-math.js';
import { roundHalfEven } from './money-core.js';

const marge = (brutto: bigint, margeCents: bigint, ust: bigint): LineMath => ({
  lineTotalCents: brutto,
  lineVatCents: ust,
  lineSubtotalCents: brutto - ust,
  marginCents: margeCents,
  appliedVatRate: null,
  acquisitionCostSnapshotCents: brutto - margeCents,
  lineDiscountCents: 0n,
});

const regel = (brutto: bigint, ust: bigint): LineMath => ({
  lineTotalCents: brutto,
  lineVatCents: ust,
  lineSubtotalCents: brutto - ust,
  marginCents: null,
  appliedVatRate: '0.1900',
  acquisitionCostSnapshotCents: null,
  lineDiscountCents: 0n,
});

describe('⛔ fünfmal 20,00 EUR Marge — seit dem 12.08.2026 EINZELDIFFERENZ', () => {
  /*
   * ── DIESER BLOCK STAND FRÜHER AUF DER BÜNDELUNG ─────────────────────────
   *
   * Er verlangte, dass fünf Margenzeilen zusammen 15,97 ergeben (Steuer auf
   * der SUMME der Margen, zurückverteilt). § 25a Abs. 3 UStG rechnet aber je
   * GEGENSTAND, und der Inhaber hat am 12.08.2026 die Einzeldifferenz
   * festgelegt (Brief an den Steuerberater, Frage 7). Je Stück: 2000 × 19 /
   * 119 = 319,3… → 319. Fünf Stücke: 1595. Die zwei Cent Unterschied zur
   * Bündelung gehören dem Gesetz, nicht der Rundung.
   */
  const zeilen = Array.from({ length: 5 }, () => marge(27_000n, 2_000n, 319n));

  it('jede Zeile behält ihre je Stück gerechnete Steuer', () => {
    const h = harmonisiereUstJeSatz(zeilen);
    expect(h.map((z) => z.lineVatCents)).toEqual([319n, 319n, 319n, 319n, 319n]);
  });

  it('die Belegsumme ist die Summe der Stücke, nicht die Steuer der Summe', () => {
    const h = harmonisiereUstJeSatz(zeilen);
    expect(h.reduce((s, z) => s + z.lineVatCents, 0n)).toBe(1_595n);
  });
});

describe('⛔ was NIEMALS wandern darf', () => {
  const zeilen = [marge(27_000n, 2_000n, 319n), marge(15_000n, 1_111n, 177n)];

  it('der Bruttobetrag jeder Zeile bleibt auf den Cent gleich', () => {
    // Sonst zahlte der Kunde plötzlich einen anderen Preis als ausgezeichnet.
    const h = harmonisiereUstJeSatz(zeilen);
    expect(h.map((z) => z.lineTotalCents)).toEqual(zeilen.map((z) => z.lineTotalCents));
  });

  it('und Netto plus Steuer ergibt weiterhin GENAU den Bruttobetrag', () => {
    for (const z of harmonisiereUstJeSatz(zeilen)) {
      expect(z.lineSubtotalCents + z.lineVatCents).toBe(z.lineTotalCents);
    }
  });

  it('die Marge bleibt unberührt — sie ist die Bemessungsgrundlage', () => {
    const h = harmonisiereUstJeSatz(zeilen);
    expect(h.map((z) => z.marginCents)).toEqual([2_000n, 1_111n]);
  });
});

describe('die Fälle, in denen nichts zu tun ist', () => {
  it('eine einzelne Zeile bleibt Wort für Wort', () => {
    const eine = [marge(27_000n, 2_000n, 319n)];
    expect(harmonisiereUstJeSatz(eine)).toEqual(eine);
  });

  it('steuerfreie Zeilen werden nicht angefasst', () => {
    const frei: LineMath = {
      lineTotalCents: 200_000n, lineVatCents: 0n, lineSubtotalCents: 200_000n,
      marginCents: null, appliedVatRate: null,
      acquisitionCostSnapshotCents: null, lineDiscountCents: 0n,
    };
    expect(harmonisiereUstJeSatz([frei, frei])).toEqual([frei, frei]);
  });

  it('ein Verlustverkauf mit Marge null bleibt bei null Steuer', () => {
    const verlust = marge(120_000n, 0n, 0n);
    const h = harmonisiereUstJeSatz([verlust, verlust]);
    expect(h.every((z) => z.lineVatCents === 0n)).toBe(true);
  });
});

describe('mehrere Sätze auf einem Beleg', () => {
  it('jeder Satz wird für sich harmonisiert', () => {
    const gemischt = [
      marge(27_000n, 2_000n, 319n),
      marge(27_000n, 2_000n, 319n),
      regel(11_900n, 1_900n),
      regel(11_900n, 1_900n),
    ];
    const h = harmonisiereUstJeSatz(gemischt);
    // § 25a seit dem 12.08.2026 je STÜCK (Einzeldifferenz): 319 + 319 = 638.
    // Die Bündelung hätte 639 ergeben — Steuer auf der Summe der Margen.
    expect(h[0]!.lineVatCents + h[1]!.lineVatCents).toBe(638n);
    // 19 %: 238,00 · 19/119 = 38,00 glatt — die Regelsätze werden weiter
    // harmonisiert, nur § 25a nicht.
    expect(h[2]!.lineVatCents + h[3]!.lineVatCents).toBe(3_800n);
  });

  it('⚠️ und die Sätze vermischen sich NICHT', () => {
    // Eine Harmonisierung über Satzgrenzen hinweg wäre ein Steuerfehler,
    // kein Rundungsfehler.
    const gemischt = [marge(27_000n, 2_000n, 319n), regel(11_900n, 1_900n)];
    expect(harmonisiereUstJeSatz(gemischt)).toEqual(gemischt);
  });
});

describe('die Stück-Treue gilt IMMER, auch bei krummen Zahlen', () => {
  it('zwanzig zufällig gewählte Margen: jede Zeile bleibt Wort für Wort', () => {
    // Einzeldifferenz heisst: die Harmonisierung fasst § 25a-Zeilen gar nicht
    // an. Zwanzig krumme Margen hinein, dieselben zwanzig Zeilen heraus.
    const zeilen = Array.from({ length: 20 }, (_, i) => {
      const m = BigInt(137 + i * 91);
      return marge(m * 3n, m, (m * 19n) / 119n);
    });
    const h = harmonisiereUstJeSatz(zeilen);
    expect(h).toEqual(zeilen);
    for (const z of h) {
      expect(z.lineSubtotalCents + z.lineVatCents).toBe(z.lineTotalCents);
    }
  });
});

/**
 * ⚠️ Der Wächter: die Harmonisierung muss WIRKLICH im Verkaufsweg liegen.
 *
 * Eine reine Funktion, die niemand ruft, ist eine grüne Prüfung ohne Wirkung.
 */
describe('der Bezahldialog benutzt sie WIRKLICH', () => {
  const lies = async () =>
    (await import('node:fs')).readFileSync(
      new URL('../screens/verkauf/BezahlenDialog.tsx', import.meta.url),
      'utf8',
    );
  const ohneKommentare = (q: string) =>
    q
      .split('\n')
      .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
      .join('\n');

  it('sie wird auf die Zeilen angewandt', async () => {
    const q = ohneKommentare(await lies());
    expect(q).toContain('harmonisiereUstJeSatz(adjustedPerLineMath)');
  });

  it('⛔ und der BELEGKOPF folgt der harmonisierten Fassung', async () => {
    // Die Funktion zu rufen und dann die alten Zahlen zu summieren wäre die
    // schlimmste Variante: grün, und die Abweichung bliebe.
    const q = ohneKommentare(await lies());
    expect(q).toContain('sumHeader(harmonisiertePerLineMath)');
    expect(
      /sumHeader\(adjustedPerLineMath\)/.test(q),
      'der Kopf summiert die UNharmonisierten Zeilen',
    ).toBe(false);
  });

  it('⛔ und die an den Server gesendeten ZEILEN ebenfalls', async () => {
    // Sonst stünden im Beleg andere Zahlen als im Kopf, und der Server wiese
    // ihn zu Recht ab.
    const q = ohneKommentare(await lies());
    expect(q).toContain('harmonisiertePerLineMath.map');
    expect(
      /adjustedPerLineMath\.map/.test(q),
      'die gesendeten Zeilen umgehen die Harmonisierung',
    ).toBe(false);
  });
});

describe('⛔ § 25a ist EINZELDIFFERENZ — je Stück, nicht je Beleg (Entscheidung 12.08.2026)', () => {
  /*
   * ── WARUM DIESER BLOCK SEINEN VORGAENGER ERSETZT ────────────────────────
   *
   * Am 11.08. stand hier „drei kleine Margen ergeben zusammen einen Cent":
   * die Margen eines Belegs wurden GEBUENDELT und die Steuer auf der Summe
   * gerechnet. Das war weder Einzel- noch Gesamtdifferenz. § 25a Abs. 3 UStG
   * rechnet je GEGENSTAND; die Gesamtdifferenz nach Abs. 4 gilt nur bis
   * 750 EUR Einkaufspreis und nach Wahlausuebung — fuer einen Goldhaendler
   * keine Option. Der Inhaber hat am 12.08.2026 die Einzeldifferenz
   * festgelegt; die Bestaetigung des Steuerberaters steht als Frage 7 im
   * Brief (docs/fiskal/fragen-an-den-steuerberater.md).
   */
  function eur(cents: bigint): string {
    const v = cents < 0n ? -cents : cents;
    const vz = cents < 0n ? '-' : '';
    return `${vz}${v / 100n}.${(v % 100n).toString().padStart(2, '0')}`;
  }

  function margenStueck(bruttoCents: bigint, kostenCents: bigint): LineMath {
    // Der ECHTE Zeilenbau, nicht eine Handpuppe: so entsteht jede
    // § 25a-Zeile in der Kasse.
    return computeLineMath({
      taxTreatmentCode: 'MARGIN_25A',
      listPriceEur: eur(bruttoCents),
      acquisitionCostEur: eur(kostenCents),
    });
  }

  it('jedes Stück traegt seine EIGENE Steuer — die Harmonisierung fasst sie nicht an', () => {
    // Zwei Stuecke mit je 3,10 EUR Marge: einzeln 49 + 49 = 98 Cent.
    // Gebuendelt waeren es 99 — genau der Cent, der Einzeldifferenz von
    // Buendelung unterscheidet.
    const a = margenStueck(50_310n, 50_000n);
    const b = margenStueck(50_310n, 50_000n);
    const raus = harmonisiereUstJeSatz([a, b]);
    expect(raus[0]?.lineVatCents).toBe(49n);
    expect(raus[1]?.lineVatCents).toBe(49n);
    expect(raus.reduce((z, l) => z + l.lineVatCents, 0n)).toBe(98n);
  });

  it('⛔ ein VERLUST mindert die Steuer der anderen Stücke NICHT', () => {
    // Stueck A: 5,00 EUR unter Einkauf verkauft — Marge 0, Steuer 0.
    // Stueck B: 10,00 EUR Marge — Steuer 160 Cent (1000 × 19 / 119).
    // Beleg gesamt: 160, nicht 80. Der Fiskus zahlt keine Steuer zurueck.
    const verlust = margenStueck(49_500n, 50_000n);
    const gewinn = margenStueck(51_000n, 50_000n);
    expect(verlust.marginCents).toBe(0n);
    expect(verlust.lineVatCents).toBe(0n);
    const raus = harmonisiereUstJeSatz([verlust, gewinn]);
    expect(
      raus.reduce((z, l) => z + l.lineVatCents, 0n),
      'der Verlust wurde gegen die Marge des anderen Stücks verrechnet',
    ).toBe(160n);
  });

  it('eine Kleinstmarge rundet je Stück auf null — und bleibt null', () => {
    // 2 Cent Marge: 2 × 19 / 119 rundet auf 0. Unter der Buendelung vom
    // 11.08. haetten drei solcher Stuecke zusammen 1 Cent ergeben; je Stueck
    // gerechnet ergeben sie 0. Das ist die Einzeldifferenz, kein Verlust.
    const raus = harmonisiereUstJeSatz([
      margenStueck(50_002n, 50_000n),
      margenStueck(50_002n, 50_000n),
      margenStueck(50_003n, 50_000n),
    ]);
    expect(raus.reduce((z, l) => z + l.lineVatCents, 0n)).toBe(0n);
  });

  it('die Regelsätze werden weiterhin harmonisiert — nur § 25a nicht', () => {
    const a = computeLineMath({
      taxTreatmentCode: 'STANDARD_19',
      listPriceEur: '100.01',
      acquisitionCostEur: '0.00',
    });
    const b = computeLineMath({
      taxTreatmentCode: 'STANDARD_19',
      listPriceEur: '100.01',
      acquisitionCostEur: '0.00',
    });
    const raus = harmonisiereUstJeSatz([a, b]);
    const summe = raus.reduce((z, l) => z + l.lineVatCents, 0n);
    // Die Steuer des Belegs ist die EINMAL gerundete Steuer der Summe.
    expect(summe).toBe(roundHalfEven(20_002n * 19n, 119n));
  });
});
