/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  5.393,19 EUR UMSATZSTEUER STANDEN IN KEINER EINZIGEN DATEV-ZEILE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ERLOES_JE_BEHANDLUNG` trug wörtlich:
 *
 *     MARGIN_25A: { konto: 'erloeseMargin25a', bu: '' }
 *
 * Also: EIN Konto, LEERER Buchungsschlüssel, und darauf der VOLLE
 * Verkaufspreis. Ein differenzbesteuerter Verkauf ist aber nicht steuerfrei —
 * steuerfrei ist nur der Einkaufsanteil, auf die Marge fallen 19 Prozent.
 *
 * ── An Romans Produktion gemessen ────────────────────────────────────────
 *
 *     § 25a-Positionen              63
 *     Bruttoumsatz          43.266,46 EUR   ← ging vollständig auf EIN Konto
 *     davon Einkaufsanteil   9.487,85 EUR
 *     davon Marge           33.778,61 EUR
 *     enthaltene USt         5.393,19 EUR   ← kam in KEINER Buchungszeile vor
 *
 * Der Steuerberater sah einen durchweg umsatzsteuerfreien Erlös. Das ist keine
 * Ungenauigkeit, sondern eine um 5.393,19 EUR zu niedrig erklärte Steuer.
 *
 * ── Die Quelle ───────────────────────────────────────────────────────────
 *
 * docs/fiskal/recherche/beraterpraxis.md §3.2, Haufe Finance Office: „beim
 * Verkauf wird der Einkaufspreis auf das Konto ohne USt gebucht und die
 * Differenz zum Verkaufspreis auf das Konto mit 19 Prozent. Also zwei Zeilen
 * je differenzbesteuertem Verkauf, nicht eine."
 *
 * SKR03 8193 „Umsatzerlöse nach §§ 25 und 25a UStG ohne USt", 8191 „… 19 %
 * USt". SKR04 4138 und 4136.
 */

import { describe, expect, it } from 'vitest';

import ECHTE_ZEILEN from './__daten__/marge-25a-produktion.json' assert { type: 'json' };
import {
  MargeOhneEinkaufspreisError,
  teileZeileAuf,
  toDatevRows,
  type DatevItemRow,
  type TxRow,
} from '../../src/routes/closing-export.js';

const pos = (
  vk: string,
  ek: string | null,
  code = 'MARGIN_25A',
): DatevItemRow => ({
  applied_tax_treatment_code: code,
  line_total_eur: vk,
  acquisition_cost_eur_snapshot: ek,
});

describe('⛔ der Befund: ein § 25a-Verkauf zerfällt in ZWEI Anteile', () => {
  it('Goldmuenze VK 270,00 / EK 250,00 → 250,00 ohne USt, 20,00 mit 19 Prozent', () => {
    expect(teileZeileAuf(pos('270.00', '250.00'), 'RCP-1')).toEqual([
      { code: 'MARGIN_25A_EINKAUF', cents: 25_000n },
      { code: 'MARGIN_25A_MARGE', cents: 2_000n },
    ]);
  });

  it('⚠️ und die Anteile ergeben IMMER exakt den Zeilenbetrag', () => {
    for (const [vk, ek] of [
      ['270.00', '250.00'],
      ['1200.00', '13000.00'],
      ['0.95', '2.00'],
      ['22.00', '23.00'],
      ['4999.99', '0.01'],
    ] as const) {
      const teile = teileZeileAuf(pos(vk, ek), 'RCP-1');
      const summe = teile.reduce((s, t) => s + t.cents, 0n);
      expect(summe, `${vk} / ${ek}`).toBe(BigInt(Math.round(Number(vk) * 100)));
    }
  });
});

describe('⚠️ DER VERLUSTVERKAUF: warum gedeckelt wird', () => {
  it('VK 1.200,00 bei EK 13.000,00 → alles ohne USt, KEINE Marge', () => {
    // Die echte Zeile aus RCP-2026-000051. Ohne Deckelung stuende hier ein
    // erfundener Erloes von 13.000 EUR und der Beleg ginge nicht mehr auf.
    expect(teileZeileAuf(pos('1200.00', '13000.00'), 'RCP-2026-000051')).toEqual([
      { code: 'MARGIN_25A_EINKAUF', cents: 120_000n },
    ]);
  });

  it('und das Finanzamt erstattet die Steuer auf einen Verlust nicht', () => {
    // Abschn. 25a.1 Abs. 12 UStAE. Eine negative Marge gibt es nicht.
    const teile = teileZeileAuf(pos('45.00', '55.00'), 'RCP-2026-000073');
    expect(teile.some((t) => t.code === 'MARGIN_25A_MARGE')).toBe(false);
  });

  it('eine Nullzeile erzeugt gar keine Buchung', () => {
    expect(teileZeileAuf(pos('0.00', '1.00'), 'RCP-2026-000073')).toEqual([]);
  });
});

describe('⛔ ohne Einkaufspreis wird NICHT gebucht', () => {
  it('der Export bricht ab, statt den vollen Preis steuerfrei zu stellen', () => {
    // Genau der bequeme Weg, der den Befund verursacht hat.
    expect(() => teileZeileAuf(pos('270.00', null), 'RCP-9')).toThrow(
      MargeOhneEinkaufspreisError,
    );
  });

  it('und die Meldung nennt den Beleg und den Paragraphen', () => {
    try {
      teileZeileAuf(pos('270.00', null), 'RCP-9');
      expect.unreachable('kein Abbruch');
    } catch (e) {
      expect((e as Error).message).toContain('RCP-9');
      expect((e as Error).message).toContain('§ 25a Abs. 6');
    }
  });
});

describe('was unangetastet bleibt', () => {
  it('jede andere Behandlung bleibt EIN Anteil mit ihrem eigenen Code', () => {
    for (const code of [
      'STANDARD_19',
      'REDUCED_7',
      'INVESTMENT_GOLD_25C',
      'REVERSE_CHARGE_13B',
      'KLEINUNTERNEHMER_19',
    ]) {
      expect(teileZeileAuf(pos('119.00', null, code), 'RCP-1'), code).toEqual([
        { code, cents: 11_900n },
      ]);
    }
  });

  it('⚠️ ein Storno zerfaellt spiegelbildlich, nicht in die Deckelung', () => {
    expect(teileZeileAuf(pos('-270.00', '250.00'), 'RCP-S')).toEqual([
      { code: 'MARGIN_25A_EINKAUF', cents: -25_000n },
      { code: 'MARGIN_25A_MARGE', cents: -2_000n },
    ]);
  });
});

/**
 * Und jetzt die ganze Kette: dieselbe Position durch den echten Zeilenbauer.
 */
describe('die DATEV-Zeilen, die dabei herauskommen', () => {
  const tx: TxRow = {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    receipt_locator: 'RCP-2026-000070',
    direction: 'VERKAUF',
    tax_treatment_code: 'MARGIN_25A',
    total_eur: '270.00',
    finalized_at: new Date('2026-07-20T10:00:00Z'),
  } as TxRow;

  const zeilen = () =>
    toDatevRows(tx, [pos('270.00', '250.00')], [{ zahlart: 'CASH', betragEur: '270.00' }]);

  it('ZWEI Zeilen statt einer', () => {
    expect(zeilen()).toHaveLength(2);
  });

  it('⚠️ 250,00 auf SKR03 8193 OHNE Buchungsschlüssel', () => {
    const z = zeilen().find((r) => r.contraAccount === '8193');
    expect(z, 'kein Einkaufsanteil auf 8193').toBeDefined();
    expect(z?.amountEur).toBe('250.00');
    expect(z?.taxKey).toBeUndefined();
  });

  // ── 19.08.2026 berichtigt ───────────────────────────────────────────────
  //
  // Der Kern dieser Prüfung bleibt: die Marge MUSS auf dem 19-Prozent-Konto
  // 8191 landen, sonst fehlt die Steuer im Export. Falsch war nur, wie die
  // Steuer dorthin kommt.
  //
  // 8191 heisst amtlich „Umsatzerlöse nach §§ 25 und 25a UStG 19 % USt" und
  // trägt im SKR03 (Art.-Nr. 11174, Ausgabe 2026) die Funktionsmarke „AM":
  // das Konto errechnet die Umsatzsteuer selbst. Der Export bucht deshalb die
  // BRUTTO-Marge und lässt 19/119 vom Konto herausrechnen. Ein Schlüssel in
  // Feld 9 obendrauf bestimmt dieselbe Bemessungsgrundlage ein zweites Mal.
  it('⚠️ und 20,00 brutto auf 8191, dem 19-Prozent-Automatikkonto', () => {
    const z = zeilen().find((r) => r.contraAccount === '8191');
    expect(z, 'die Marge landet auf keinem 19-Prozent-Konto').toBeDefined();
    expect(z?.amountEur).toBe('20.00');
    expect(z?.taxKey).toBeUndefined();
  });

  it('das alte Sammelkonto 8200 kommt NICHT mehr vor', () => {
    expect(zeilen().map((r) => r.contraAccount)).not.toContain('8200');
  });

  it('und die Zeilen ergeben zusammen den Belegbetrag', () => {
    const summe = zeilen().reduce((s, r) => s + Math.round(Number(r.amountEur) * 100), 0);
    expect(summe).toBe(27_000);
  });

  it('der Buchungstext unterscheidet die beiden Hälften', () => {
    const texte = zeilen().map((r) => r.bookingText);
    expect(texte.some((t) => t.includes('MARGIN_25A_EINKAUF'))).toBe(true);
    expect(texte.some((t) => t.includes('MARGIN_25A_MARGE'))).toBe(true);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE ECHTEN 63 POSITIONEN, DURCH DEN ECHTEN CODE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jede Prüfung oben nährt sich aus Zahlen, die ICH gewählt habe. Diese hier
 * nicht: sie läuft über die 63 § 25a-Positionen, wie sie am 27.07.2026 in
 * Romans Datenbank standen — nur die fünf Zahlenfelder, kein Name, keine
 * Belegnummer, kein Personenbezug.
 *
 * Das ist die einzige Prüfung in dieser Datei, die eine Behauptung über die
 * WIRKLICHKEIT aufstellt statt über ein ausgedachtes Beispiel.
 */
describe('an Romans Produktionsdaten nachgemessen', () => {
  const echt = ECHTE_ZEILEN as {
    applied_tax_treatment_code: string;
    line_total_eur: string;
    acquisition_cost_eur_snapshot: string;
    margin_eur: string;
    line_vat_eur: string;
  }[];

  const summe = (code: string): bigint =>
    echt
      .flatMap((r) => teileZeileAuf(r, 'RCP-messung'))
      .filter((t) => t.code === code)
      .reduce((s, t) => s + t.cents, 0n);

  it('es sind wirklich 63 Positionen', () => {
    expect(echt).toHaveLength(63);
  });

  it('⚠️ die Marge trifft `margin_eur` der Datenbank auf den CENT', () => {
    // Der Kern der Deckelungsregel: der Rest nach dem Einkaufsanteil ist
    // genau das, was die Kasse als Marge gespeichert hat — bei Gewinn wie
    // bei Verlust, ohne eine einzige Ausnahme.
    const gespeichert = echt.reduce(
      (s, r) => s + BigInt(Math.round(Number(r.margin_eur) * 100)),
      0n,
    );
    expect(summe('MARGIN_25A_MARGE')).toBe(gespeichert);
    expect(gespeichert).toBe(3_377_861n); // 33.778,61 EUR
  });

  it('der Einkaufsanteil ist 9.487,85 EUR', () => {
    expect(summe('MARGIN_25A_EINKAUF')).toBe(948_785n);
  });

  it('⚠️ und beide zusammen ergeben den gemessenen Umsatz von 43.266,46 EUR', () => {
    // Geht das nicht auf, stimmt die DATEV-Datei nicht mit den Belegen
    // überein — und genau das prüft ein Betriebsprüfer als Erstes.
    expect(summe('MARGIN_25A_EINKAUF') + summe('MARGIN_25A_MARGE')).toBe(4_326_646n);
  });

  it('⛔ und DAS ist der Befund: 5.393,19 EUR Steuer waren vorher unsichtbar', () => {
    // Vorher ging der volle Betrag auf EIN Konto ohne Buchungsschlüssel.
    // Jetzt trägt die Marge den Schlüssel 3, und 19/119 davon ist die Steuer,
    // die in keiner Zeile stand.
    const ausDerMarge = (summe('MARGIN_25A_MARGE') * 19n) / 119n;
    const gebucht = echt.reduce(
      (s, r) => s + BigInt(Math.round(Number(r.line_vat_eur) * 100)),
      0n,
    );
    expect(gebucht).toBe(539_319n); // 5.393,19 EUR
    // Die Zeilenrundung je Position ergibt gegenüber der Summenrechnung eine
    // Abweichung von wenigen Cent — das ist Rundung, kein Fehler.
    const abstand = ausDerMarge > gebucht ? ausDerMarge - gebucht : gebucht - ausDerMarge;
    expect(abstand).toBeLessThanOrEqual(100n);
  });

  it('keine einzige Position bleibt ohne Einkaufspreis', () => {
    expect(echt.filter((r) => r.acquisition_cost_eur_snapshot === null)).toHaveLength(0);
  });
});

/**
 * ⚠️ Die Ecke, die im GEBAUTEN ABBILD auffiel — nicht im Quelltext.
 *
 * `MARGIN_25A` steht weiterhin in der Zuordnungstabelle (es dient
 * `toDatevRow` als Gerüst, genau wie `MIXED`). Über den Positionsweg wird es
 * nie erreicht. Über den Weg OHNE Positionen wäre es erreicht worden — und
 * der volle Belegbetrag läge steuerfrei auf dem alten Sammelkonto.
 */
describe('⛔ auch OHNE Positionen wird § 25a nicht steuerfrei gebucht', () => {
  const ohneItems = (code: string): TxRow =>
    ({
      id: 'aaaaaaaa-0000-0000-0000-000000000009',
      receipt_locator: 'RCP-2026-000099',
      direction: 'VERKAUF',
      tax_treatment_code: code,
      total_eur: '270.00',
      finalized_at: new Date('2026-07-20T10:00:00Z'),
    }) as TxRow;

  it('ein § 25a-Verkauf ohne Positionen wird ABGEWIESEN', () => {
    expect(() =>
      toDatevRows(ohneItems('MARGIN_25A'), [], [{ zahlart: 'CASH', betragEur: '270.00' }]),
    ).toThrow(MargeOhneEinkaufspreisError);
  });

  it('jede andere Behandlung ohne Positionen bleibt unangetastet', () => {
    const zeilen = toDatevRows(ohneItems('STANDARD_19'), [], [
      { zahlart: 'CASH', betragEur: '270.00' },
    ]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.contraAccount).toBe('8400');
  });

  it('und ein ANKAUF ebenso — er kennt keine Aufteilung', () => {
    const tx = { ...ohneItems('MARGIN_25A'), direction: 'ANKAUF' } as TxRow;
    expect(() => toDatevRows(tx, [], [{ zahlart: 'CASH', betragEur: '270.00' }])).not.toThrow();
  });
});

/**
 * ⚠️ Der Wächter gegen die Rückkehr der einen Zeile.
 */
describe('die Aufteilung haengt WIRKLICH am Einkaufspreis aus der Datenbank', () => {
  const lies = async () =>
    (await import('node:fs')).readFileSync(
      new URL('../../src/routes/closing-export.ts', import.meta.url),
      'utf8',
    );

  it('die Abfrage LIEST den Einkaufspreis der Position', async () => {
    // Ohne diese Spalte waere `teileZeileAuf` immer im Abbruch gelandet — oder,
    // schlimmer, auf einem stillen Rueckfall.
    //
    // ⚠️ Die erste Fassung dieser Pruefung suchte im Abfrageblock nur nach dem
    // Namen `acquisition_cost_eur_snapshot` — und blieb GRUEN, als ich zur
    // Probe `NULL::text AS acquisition_cost_eur_snapshot` einsetzte. Sie hatte
    // den ALIAS getroffen, nicht die Spalte. Genau so sieht ein Waechter aus,
    // der nichts bewacht.
    const q = await lies();
    const i = q.indexOf('FROM transaction_items');
    const abfrage = q.slice(Math.max(0, i - 700), i);
    expect(
      /(?<![\w.])acquisition_cost_eur_snapshot::text\s+AS\s+acquisition_cost_eur_snapshot/.test(
        abfrage,
      ),
      'der Einkaufspreis kommt nicht aus der SPALTE',
    ).toBe(true);
  });

  it('⚠️ und reicht ihn bis in die Aufteilung DURCH', async () => {
    // Der erste Entwurf las die Spalte und liess sie beim Umpacken liegen.
    // Dann ist jede Zeile „ohne Einkaufspreis" und der Export bricht immer ab.
    const q = await lies();
    const i = q.indexOf('applied_tax_treatment_code: it.applied_tax_treatment_code,');
    expect(q.slice(i, i + 300)).toContain(
      'acquisition_cost_eur_snapshot: it.acquisition_cost_eur_snapshot,',
    );
  });

  it('die Gruppenbildung ruft die Aufteilung an, statt selbst zu summieren', async () => {
    const q = await lies();
    const ohneKommentare = q
      .split('\n')
      .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
      .join('\n');
    expect(/(?<!function\s)\bteileZeileAuf\s*\(\s*it\s*,/.test(ohneKommentare)).toBe(true);
    // Die alte Form summierte den Zeilenbetrag stumpf auf den Zeilencode.
    expect(
      /sumByTreatment\.set\(code,.*eurToCents\(it\.line_total_eur\)\)/.test(ohneKommentare),
      'die alte Ein-Zeilen-Summierung ist zurueck',
    ).toBe(false);
  });

  it('⚠️ und MARGIN_25A fuehrt zu KEINEM Erloeskonto mehr', async () => {
    // Solange der Schluessel selbst noch ein Konto haette, koennte ein
    // uebersehener Weg weiterhin den vollen Preis steuerfrei buchen.
    const q = await lies();
    expect(q).toContain("MARGIN_25A_EINKAUF: { konto: 'erloeseMargin25aEinkaufsanteil'");
    expect(q).toContain("MARGIN_25A_MARGE: { konto: 'erloeseMargin25aMarge'");
  });
});
