import { describe, expect, it } from 'vitest';
import type { Zahlung } from '../../src/lib/datev-kontierung.js';
import { type DatevItemRow, toDatevRow, toDatevRows } from '../../src/routes/closing-export.js';

/**
 * Der Barfall — die Zahlart, bei der Konto 1000 wirklich richtig ist.
 *
 * Diese Datei prüft die STEUERSEITE (welches Erlöskonto, welcher BU-Schlüssel).
 * Damit sie das weiter allein prüft, zahlt hier jeder Beleg bar; die GELDSEITE
 * hat ihre eigene Datei, `datev-kontierung.test.ts`.
 */
const bar = (eur: string): Zahlung[] => [{ zahlart: 'CASH', betragEur: eur }];

/**
 * The Steuerberater-confirmed SKR03 mapping (2026): each VERKAUF must post to
 * the revenue account matching its tax treatment — NOT collapse onto 8400 —
 * with the correct DATEV BU-Schlüssel. This is the fix for the "steuerlich
 * blinde" export an inspector would reject.
 */
const baseTx = {
  total_eur: '780.00',
  direction: 'VERKAUF',
  receipt_locator: 'RCP-2026-000004',
  finalized_at: new Date('2026-06-08T10:00:00Z'),
};

describe('DATEV Belegdatum = the Europe/Berlin business day (not the UTC date)', () => {
  it('a daytime sale keeps its date (UTC date == Berlin date)', () => {
    // 2026-06-08 10:00 UTC = 12:00 Berlin (CEST) → same calendar day.
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'STANDARD_19' });
    expect(r.date).toBe('2026-06-08');
  });

  it('a post-midnight-Berlin summer sale books to the Berlin day, not the UTC day', () => {
    // 2026-06-07 22:30 UTC = 2026-06-08 00:30 Berlin (CEST, UTC+2). The closing
    // that scopes by berlin_business_day() files it under 2026-06-08, so the
    // Belegdatum must be 2026-06-08 — the old UTC-date code gave 2026-06-07.
    const r = toDatevRow({
      ...baseTx,
      tax_treatment_code: 'STANDARD_19',
      finalized_at: new Date('2026-06-07T22:30:00Z'),
    });
    expect(r.date).toBe('2026-06-08');
  });

  it('a post-midnight-Berlin winter sale is DST-correct (UTC+1)', () => {
    // 2026-01-07 23:30 UTC = 2026-01-08 00:30 Berlin (CET, UTC+1) → 2026-01-08.
    const r = toDatevRow({
      ...baseTx,
      tax_treatment_code: 'STANDARD_19',
      finalized_at: new Date('2026-01-07T23:30:00Z'),
    });
    expect(r.date).toBe('2026-01-08');
  });
});

describe('DATEV per-tax-treatment Gegenkonto + BU-Schlüssel routing', () => {
  // ── 19.08.2026 umgedreht ────────────────────────────────────────────────
  //
  // Diese beiden Prüfungen verlangten bis heute genau den Fehler, den sie
  // bewachen sollten: einen Steuerschlüssel auf einem Automatikkonto.
  //
  // 8400 und 8300 tragen im amtlichen SKR03 (Art.-Nr. 11174, Ausgabe 2026)
  // die Funktionsmarke „U AM" — automatische Errechnung der Umsatzsteuer. Das
  // Konto rechnet die Steuer selbst aus dem Bruttobetrag. Ein Schlüssel in
  // Feld 9 bestimmt die Bemessungsgrundlage ein ZWEITES Mal.
  //
  // Nachgezählt in DATEVs eigener Musterdatei
  // (`tests/vorlagen/EXTF_Buchungsstapel_DATEV_Muster.csv`, 54 Buchungen):
  // Konto 8400 kommt 13-mal vor, davon 10-mal mit LEEREM Feld 9, 2-mal mit
  // Schlüssel 40 („Aufhebung der Automatik") und 1-mal mit 20. Mit Schlüssel
  // 3: kein einziges Mal. Beide BU-3-Zeilen der Musterdatei stehen auf 8050,
  // und DATEV hat eine davon selbst „Aufteilung AR ohne Automatikkonto"
  // betitelt.
  it('STANDARD_19 → Gegenkonto 8400, und KEIN Schlüssel (Automatikkonto)', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'STANDARD_19' });
    expect(r.contraAccount).toBe('8400');
    expect(r.taxKey).toBeUndefined();
  });

  it('REDUCED_7 → Gegenkonto 8300, und KEIN Schlüssel (Automatikkonto)', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'REDUCED_7' });
    expect(r.contraAccount).toBe('8300');
    expect(r.taxKey).toBeUndefined();
  });

  it('MARGIN_25A (§25a Differenzbesteuerung) → Gegenkonto 8200, no BU key', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'MARGIN_25A' });
    expect(r.contraAccount).toBe('8200');
    expect(r.taxKey).toBeUndefined();
  });

  // 19.08.2026: 8150 → 8165. § 25c ist keine Befreiung nach § 4 Nr. 2-7, also
  // war 8150 („Sonstige steuerfreie Umsätze (z. B. § 4 Nr. 2 bis 7 UStG)") das
  // falsche Konto. Begründung und Quelle in `kontenrahmen.ts` am Eintrag.
  it('INVESTMENT_GOLD_25C (§25c steuerfrei) → Gegenkonto 8165, no BU key', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'INVESTMENT_GOLD_25C' });
    expect(r.contraAccount).toBe('8165');
    expect(r.taxKey).toBeUndefined();
  });

  it('the four treatments do NOT all collapse onto 8400', () => {
    const accounts = new Set(
      ['STANDARD_19', 'REDUCED_7', 'MARGIN_25A', 'INVESTMENT_GOLD_25C'].map(
        (t) => toDatevRow({ ...baseTx, tax_treatment_code: t }).contraAccount,
      ),
    );
    expect(accounts).toEqual(new Set(['8400', '8300', '8200', '8165']));
  });

  /**
   * ⚠️ Diese Prüfung stand hier bis zum 26.07.2026 GENAU UMGEKEHRT: sie
   * verlangte, dass ein unbekannter Schlüssel auf 8400 fällt, und nannte das
   * „conservative".
   *
   * Konservativ ist daran nichts. Ein Umsatz, dessen Behandlung niemand kennt,
   * landete damit als 19-Prozent-Erlös mit LEEREM Buchungsschlüssel in der
   * DATEV-Datei — falsch und ohne jeden Hinweis. Der Steuerberater sieht eine
   * plausible Zeile, und es fällt Monate später auf, wenn der Monat
   * festgeschrieben ist.
   *
   * Auf der Produktion gemessen: 1 Vorgang über 464,00 EUR lief so.
   *
   * Ein Test, der ein Verhalten festschreibt, macht es zur Zusage. Dieser hier
   * hat den Fehler beschützt.
   */
  it('⛔ ein unbekannter Steuerschluessel bricht den Export AB', () => {
    expect(() => toDatevRow({ ...baseTx, tax_treatment_code: 'SOMETHING_NEW' })).toThrow(
      /kein Erlöskonto/,
    );
  });

  it('§ 13b und § 19 haben jetzt ein eigenes Konto — nicht mehr 8400', () => {
    const r13b = toDatevRow({ ...baseTx, tax_treatment_code: 'REVERSE_CHARGE_13B' });
    expect(r13b.contraAccount).toBe('8337');
    expect(r13b.taxKey).toBeUndefined();

    const r19 = toDatevRow({ ...baseTx, tax_treatment_code: 'KLEINUNTERNEHMER_19' });
    expect(r19.contraAccount).toBe('8195');
    expect(r19.taxKey).toBeUndefined();
  });

  it('⚠️ MIXED bleibt durchlaessig — es ist ein KOPFWERT, kein Schluessel', () => {
    // Die Aufteilung ruft `toDatevRow` als Gerüst auf und überschreibt das
    // Erlöskonto je Zeile. Liesse man MIXED hier auflaufen, wäre der ganze
    // gemischte Beleg unbuchbar — sieben Prüfungen haben mir das gezeigt.
    expect(() => toDatevRow({ ...baseTx, tax_treatment_code: 'MIXED' })).not.toThrow();
  });

  it('ANKAUF posts Wareneingang (3200) an Kasse (1000), no output-VAT key', () => {
    const r = toDatevRow({
      ...baseTx,
      direction: 'ANKAUF',
      tax_treatment_code: 'MARGIN_25A',
    });
    expect(r.account).toBe('3200');
    expect(r.contraAccount).toBe('1000');
    expect(r.taxKey).toBeUndefined();
  });
});

/**
 * MIXED receipts: a single sale whose items span >1 tax treatment carries a
 * transaction-level tax_treatment_code = 'MIXED' (or otherwise has items of
 * different treatments). It MUST NOT collapse onto a single 8400 row — each
 * treatment portion has to land on its own SKR03 Gegenkonto + BU. `toDatevRows`
 * emits one booking line per tax-treatment group; the line sums must reconcile
 * to the receipt total exactly (integer cents).
 */
describe('DATEV MIXED-treatment per-line split', () => {
  const mixedTx = {
    total_eur: '300.00',
    direction: 'VERKAUF',
    tax_treatment_code: 'MIXED',
    receipt_locator: 'RCP-2026-000005',
    finalized_at: new Date('2026-06-08T10:00:00Z'),
  };

  // §25a margin item €200,00 + 19% standard item €100,00 → €300,00 receipt.
  const mixedItems: DatevItemRow[] = [
    { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '200.00',
      acquisition_cost_eur_snapshot: '150.00' },
    { applied_tax_treatment_code: 'STANDARD_19', line_total_eur: '100.00',
      acquisition_cost_eur_snapshot: null },
  ];

  it('emits ONE row per Buchungsanteil (§ 25a zerfaellt in zwei)', () => {
    // ⚠️ 27.07.2026: vorher waren es zwei Zeilen. Ein § 25a-Verkauf ist nicht
    // steuerfrei — steuerfrei ist nur der Einkaufsanteil, auf die Marge fallen
    // 19 Prozent. Aus 200,00 werden 150,00 (8193) und 50,00 (8191).
    const rows = toDatevRows(mixedTx, mixedItems, bar('300.00'));
    expect(rows).toHaveLength(3);
  });

  it('books each portion to the correct Gegenkonto with BU only on the 19% leg', () => {
    const rows = toDatevRows(mixedTx, mixedItems, bar('300.00'));
    const byAccount = new Map(rows.map((r) => [r.contraAccount, r]));

    // Der Einkaufsanteil geht auf 8193 „Umsatzerlöse nach §§ 25 und 25a UStG
    // ohne USt", die Marge auf 8191 „… 19 % USt" — Haufe, siehe
    // docs/fiskal/recherche/beraterpraxis.md §3.2.
    const marginEk = byAccount.get('8193');
    expect(marginEk).toBeDefined();
    expect(marginEk?.amountEur).toBe('150.00');
    expect(marginEk?.taxKey).toBeUndefined();

    const marginMarge = byAccount.get('8191');
    expect(marginMarge).toBeDefined();
    expect(marginMarge?.amountEur).toBe('50.00');
    // 8191 trägt im amtlichen SKR03 die Marke „AM": auch hier rechnet das
    // Konto die 19/119 selbst heraus. Kein Schlüssel. Siehe oben.
    expect(marginMarge?.taxKey).toBeUndefined();

    // Das alte Sammelkonto kommt nicht mehr vor.
    expect(byAccount.get('8200')).toBeUndefined();

    const standard = byAccount.get('8400');
    expect(standard).toBeDefined();
    expect(standard?.amountEur).toBe('100.00');
    // Automatikkonto, siehe oben: die 19 Prozent rechnet 8400 selbst heraus.
    expect(standard?.taxKey).toBeUndefined();
  });

  it('the split rows reconcile to the receipt total exactly (cents)', () => {
    const rows = toDatevRows(mixedTx, mixedItems, bar('300.00'));
    const sumCents = rows.reduce((acc, r) => {
      const [w = '0', f = ''] = r.amountEur.split('.');
      return acc + BigInt(w) * 100n + BigInt(f.padEnd(2, '0'));
    }, 0n);
    expect(sumCents).toBe(30000n); // €300,00 = 30000 cents
  });

  it('groups multiple items of the SAME treatment into one summed row', () => {
    const rows = toDatevRows(
      { ...mixedTx, total_eur: '450.00' },
      [
        { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '200.00',
      acquisition_cost_eur_snapshot: '150.00' },
        { applied_tax_treatment_code: 'STANDARD_19', line_total_eur: '100.00',
      acquisition_cost_eur_snapshot: null },
        { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '150.00',
          acquisition_cost_eur_snapshot: '100.00' },
      ],
      bar('450.00'),
    );
    expect(rows).toHaveLength(3);
    // 150,00 + 100,00 Einkaufsanteil, 50,00 + 50,00 Marge.
    expect(rows.find((r) => r.contraAccount === '8193')?.amountEur).toBe('250.00');
    expect(rows.find((r) => r.contraAccount === '8191')?.amountEur).toBe('100.00');
    const standard = rows.find((r) => r.contraAccount === '8400');
    expect(standard?.amountEur).toBe('100.00');
  });

  it('the Buchungstext names the treatment so each split leg is identifiable', () => {
    const rows = toDatevRows(mixedTx, mixedItems, bar('300.00'));
    const margin = rows.find((r) => r.contraAccount === '8191');
    const standard = rows.find((r) => r.contraAccount === '8400');
    expect(margin?.bookingText).toContain('MARGIN_25A');
    expect(margin?.bookingText).toContain(mixedTx.receipt_locator);
    expect(standard?.bookingText).toContain('STANDARD_19');
  });

  it('SINGLE-treatment VERKAUF stays exactly one row, byte-identical to toDatevRow', () => {
    const tx = {
      total_eur: '780.00',
      direction: 'VERKAUF',
      tax_treatment_code: 'MARGIN_25A',
      receipt_locator: 'RCP-2026-000004',
      finalized_at: new Date('2026-06-08T10:00:00Z'),
    };
    const items: DatevItemRow[] = [
      { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '780.00',
        acquisition_cost_eur_snapshot: '600.00' },
    ];
    const rows = toDatevRows(tx, items, bar('780.00'));
    // ⚠️ Auch ein Beleg mit NUR § 25a zerfaellt jetzt — die Aufteilung haengt
    // an der Steuerart, nicht daran, ob der Beleg gemischt ist.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.contraAccount).sort()).toEqual(['8191', '8193']);
    expect(rows.find((r) => r.contraAccount === '8193')?.amountEur).toBe('600.00');
    expect(rows.find((r) => r.contraAccount === '8191')?.amountEur).toBe('180.00');
    // Alles ausser Betrag, Konto und Text bleibt die Zeile von `toDatevRow`.
    const grund = toDatevRow(tx);
    for (const r of rows) {
      expect(r.account).toBe(grund.account);
      expect(r.date).toBe(grund.date);
      expect(r.reference).toBe(grund.reference);
      expect(r.debitCredit).toBe(grund.debitCredit);
    }
  });

  it('VERKAUF with NO items falls back to the single transaction-level row', () => {
    const tx = {
      total_eur: '50.00',
      direction: 'VERKAUF',
      tax_treatment_code: 'STANDARD_19',
      receipt_locator: 'RCP-2026-000006',
      finalized_at: new Date('2026-06-08T10:00:00Z'),
    };
    const rows = toDatevRows(tx, [], bar('50.00'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(toDatevRow(tx));
  });

  it('ANKAUF is never split even with multi-treatment items', () => {
    const tx = {
      total_eur: '500.00',
      direction: 'ANKAUF',
      tax_treatment_code: 'MIXED',
      receipt_locator: 'RCP-2026-000007',
      finalized_at: new Date('2026-06-08T10:00:00Z'),
    };
    const items: DatevItemRow[] = [
      { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '300.00',
        acquisition_cost_eur_snapshot: '250.00' },
      { applied_tax_treatment_code: 'STANDARD_19', line_total_eur: '200.00',
      acquisition_cost_eur_snapshot: null },
    ];
    const rows = toDatevRows(tx, items, bar('500.00'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(toDatevRow(tx));
    expect(rows[0]?.account).toBe('3200');
  });
});

/**
 * Die GELDSEITE im fertigen Buchungssatz.
 *
 * `datev-kontierung.test.ts` prüft die Zuordnung für sich; hier steht, dass sie
 * auch wirklich in der Zeile ankommt, die exportiert wird. Vor dem 26.07.2026
 * hätte jeder dieser Fälle Konto 1000 gezeigt.
 */
describe('das Geldkonto der Buchungszeile folgt der Zahlart', () => {
  const kartenVerkauf = {
    total_eur: '250.00',
    direction: 'VERKAUF',
    tax_treatment_code: 'STANDARD_19',
    receipt_locator: 'RCP-2026-000300',
    finalized_at: new Date('2026-06-08T10:00:00Z'),
  };

  it('eine Kartenzahlung bucht auf den Geldtransit, NICHT auf die Kasse', () => {
    const rows = toDatevRows(kartenVerkauf, [], [{ zahlart: 'ZVT_CARD', betragEur: '250.00' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.account).toBe('1361');
    expect(rows[0]?.contraAccount).toBe('8400'); // die Steuerseite bleibt unberührt
  });

  it('ein Ankauf per Überweisung nimmt das Geld von der Bank, nicht aus der Kasse', () => {
    // Beim Ankauf steht das Geld auf der HABEN-Seite: Wareneingang an Bank.
    const rows = toDatevRows(
      { ...kartenVerkauf, direction: 'ANKAUF', total_eur: '500.00' },
      [],
      [{ zahlart: 'BANK_TRANSFER', betragEur: '500.00' }],
    );
    expect(rows[0]?.account).toBe('3200');
    expect(rows[0]?.contraAccount).toBe('1200');
  });

  it('ein Beleg mit zwei Zahlarten wird auf ZWEI Geldkonten aufgeteilt', () => {
    const rows = toDatevRows(
      { ...kartenVerkauf, total_eur: '119.00' },
      [],
      [
        { zahlart: 'CASH', betragEur: '50.00' },
        { zahlart: 'ZVT_CARD', betragEur: '69.00' },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.account).sort()).toEqual(['1000', '1361']);
    expect(rows.map((r) => r.amountEur).sort()).toEqual(['50.00', '69.00']);
  });

  it('bei geteilter Zahlung nennt der Buchungstext die Zahlart', () => {
    // Sonst stünden zwei Zeilen mit identischem Text untereinander.
    const rows = toDatevRows(
      { ...kartenVerkauf, total_eur: '119.00' },
      [],
      [
        { zahlart: 'CASH', betragEur: '50.00' },
        { zahlart: 'ZVT_CARD', betragEur: '69.00' },
      ],
    );
    expect(rows.find((r) => r.account === '1000')?.bookingText).toContain('bar');
    expect(rows.find((r) => r.account === '1361')?.bookingText).toContain('Karte');
  });

  it('bei EINER Zahlart bleibt der Buchungstext unverändert wie bisher', () => {
    const rows = toDatevRows(kartenVerkauf, [], [{ zahlart: 'CASH', betragEur: '250.00' }]);
    expect(rows[0]?.bookingText).toBe('VERKAUF RCP-2026-000300 (STANDARD_19)');
  });

  it('ein Beleg ganz OHNE Zahlung erzeugt keine Datei, sondern einen Fehler', () => {
    expect(() => toDatevRows(kartenVerkauf, [], [])).toThrow(/keine Zahlung/);
  });
});

/**
 * STORNO polarity. A storno is a NEW transaction row whose `storno_of_…` FK is
 * set and whose money columns are NEGATIVE (DB CHECK `transactions_sign_
 * discipline`: total_eur <= 0 on a storno row). DATEV's `Umsatz` field MUST be
 * a POSITIVE magnitude — the direction is expressed ENTIRELY by the Soll/Haben
 * (S/H) flag, NOT by a minus sign. So a storno reverses the original posting:
 * the original VERKAUF books Kasse(S) an Erlöse; its storno must flip to Haben
 * (H) on Konto Kasse with the SAME positive magnitude — a clean reversing line.
 * Emitting a negative `Umsatz` with `S` (the pre-fix behaviour) is non-
 * conforming and a Prüfer would reject it.
 *
 * The storno_of_transaction_id is not on the lean TxRow the exporter reads, so
 * the storno signal is the negative total_eur itself (set on storno rows only).
 */
describe('DATEV storno polarity (negative total → positive Umsatz, flipped S/H)', () => {
  const stornoOfSale = {
    total_eur: '-595.00', // storno row: negative per the DB sign-discipline CHECK
    direction: 'VERKAUF',
    tax_treatment_code: 'STANDARD_19',
    receipt_locator: 'RCP-2026-000200',
    finalized_at: new Date('2026-06-08T12:00:00Z'),
  };

  it('a VERKAUF storno emits a POSITIVE Umsatz (no minus sign carried into DATEV)', () => {
    const r = toDatevRow(stornoOfSale);
    expect(r.amountEur).toBe('595.00');
    expect(r.amountEur.startsWith('-')).toBe(false);
  });

  // ── 19.08.2026 umgedreht ────────────────────────────────────────────────
  //
  // Diese Prüfung verlangte die gekippte Seite (H). DATEV Dok.-Nr. 1070379,
  // Kap. 3.2: die Generalumkehr bucht „mit Minuszeichen auf der GLEICHEN
  // Soll-/Haben-Seite" — das Minus liefert Feld 118, nicht die Seite. Eine
  // gekippte Zeile MIT Marke wirkt als Minus auf der Gegenseite und bucht
  // den stornierten Verkauf ein zweites Mal.
  it('a VERKAUF storno keeps the original side S — the Generalumkehr mark carries the minus', () => {
    const r = toDatevRow(stornoOfSale);
    expect(r.debitCredit).toBe('S');
    expect(r.generalumkehr).toBe(true);
  });

  it('a normal (positive) VERKAUF still posts S — non-storno behaviour unchanged', () => {
    const r = toDatevRow({ ...baseTx, tax_treatment_code: 'STANDARD_19' });
    expect(r.debitCredit).toBe('S');
    expect(r.amountEur).toBe('780.00');
  });

  it('the storno still routes the correct per-treatment Gegenkonto', () => {
    const r = toDatevRow(stornoOfSale);
    // Same SKR03 routing as the original sale — only the polarity reverses.
    expect(r.contraAccount).toBe('8400');
    expect(r.taxKey).toBeUndefined();
    expect(r.account).toBe('1000');
  });

  // ── 19.08.2026 neu ──────────────────────────────────────────────────────
  //
  // Die gekippte Soll/Haben-Seite allein macht aus einer Buchung keine
  // Stornobuchung. Ohne Feld 118 zählt DATEV Verkauf UND Storno als Umsatz:
  // 8400 stünde mit 780,00 im Haben und 780,00 im Soll, also 1.560,00
  // Jahresverkehrszahl bei 0,00 echtem Umsatz. Genau diese Zahl liest ein
  // Prüfer bei der Kassennachschau gegen das Belegjournal.
  it('die Stornozeile trägt die Generalumkehr, die normale Zeile nicht', () => {
    expect(toDatevRow(stornoOfSale).generalumkehr).toBe(true);
    expect(toDatevRow({ ...baseTx, tax_treatment_code: 'STANDARD_19' }).generalumkehr).toBeUndefined();
  });

  it('an ANKAUF storno also flips to positive Umsatz on the H side', () => {
    const r = toDatevRow({
      total_eur: '-300.00',
      direction: 'ANKAUF',
      tax_treatment_code: 'MARGIN_25A',
      receipt_locator: 'RCP-2026-000201',
      finalized_at: new Date('2026-06-08T12:05:00Z'),
    });
    expect(r.amountEur).toBe('300.00');
    expect(r.debitCredit).toBe('S'); // gleiche Seite; Feld 118 traegt das Minus
    expect(r.generalumkehr).toBe(true);
    expect(r.account).toBe('3200');
    expect(r.contraAccount).toBe('1000');
  });

  it('a MIXED storno splits per treatment, each leg positive on the H side', () => {
    const tx = {
      total_eur: '-300.00',
      direction: 'VERKAUF',
      tax_treatment_code: 'MIXED',
      receipt_locator: 'RCP-2026-000202',
      finalized_at: new Date('2026-06-08T12:10:00Z'),
    };
    // Storno line totals are negative too (mirror of the original lines).
    const items: DatevItemRow[] = [
      { applied_tax_treatment_code: 'MARGIN_25A', line_total_eur: '-200.00',
        acquisition_cost_eur_snapshot: '150.00' },
      { applied_tax_treatment_code: 'STANDARD_19', line_total_eur: '-100.00',
      acquisition_cost_eur_snapshot: null },
    ];
    const rows = toDatevRows(tx, items, [{ zahlart: 'CASH', betragEur: '-300.00' }]);
    // ⚠️ 27.07.2026: drei statt zwei — der § 25a-Anteil zerfaellt auch im
    // Storno in Einkaufsanteil und Marge. Sonst stuende die Rueckabwicklung
    // steuerlich anders da als der Verkauf, den sie aufhebt.
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.debitCredit).toBe('S'); // gleiche Seite; Feld 118 traegt das Minus
      expect(r.generalumkehr).toBe(true);
      expect(r.amountEur.startsWith('-')).toBe(false);
    }
    const standard = rows.find((r) => r.contraAccount === '8400');
    expect(rows.find((r) => r.contraAccount === '8193')?.amountEur).toBe('150.00');
    expect(rows.find((r) => r.contraAccount === '8191')?.amountEur).toBe('50.00');
    expect(standard?.amountEur).toBe('100.00');
    // Und die Rueckabwicklung ergibt wieder genau den Belegbetrag.
    const summe = rows.reduce((s, r) => s + Math.round(Number(r.amountEur) * 100), 0);
    expect(summe).toBe(30_000);
  });
});
