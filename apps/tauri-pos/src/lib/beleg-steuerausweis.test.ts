/**
 * Der Steuerausweis auf dem Beleg.
 *
 * Diese Tests halten eine GESETZLICHE Zusage fest, keine technische: bei
 * Differenzbesteuerung darf die Umsatzsteuer nicht gesondert ausgewiesen
 * werden (§ 14a Abs. 6 Satz 2 UStG). Wer es doch tut, schuldet den
 * ausgewiesenen Betrag zusätzlich nach § 14c, ohne ihn kassiert zu haben.
 *
 * Bis zum 26.07.2026 druckten alle drei Ausgabewege der Kasse die Steuerzeile
 * bedingungslos. Es gab keinen Test, der das verboten hätte.
 */

import { describe, expect, it } from 'vitest';

import {
  type BelegZeile,
  centsAlsBetrag,
  steuerausweisFuerBeleg,
} from './beleg-steuerausweis.js';

const regel = (vatCents: bigint, satz = '0.1900'): BelegZeile => ({
  taxTreatmentCode: satz === '0.0700' ? 'REDUCED_7' : 'STANDARD_19',
  lineVatCents: vatCents,
  appliedVatRate: satz,
});

const marge = (vatCents: bigint): BelegZeile => ({
  taxTreatmentCode: 'MARGIN_25A',
  lineVatCents: vatCents,
  appliedVatRate: null,
});

const anlagegold = (): BelegZeile => ({
  taxTreatmentCode: 'INVESTMENT_GOLD_25C',
  lineVatCents: 0n,
  appliedVatRate: null,
});

describe('§ 25a: die Steuer darf NICHT auf den Beleg', () => {
  it('ein reiner Margenbeleg bekommt GAR KEINE Steuerzeile', () => {
    // Der Fall aus der Praxis: ein Stueck fuer 1.000 Euro, 700 Euro Einstand,
    // Margensteuer 47,90. Genau diese 47,90 standen bisher gedruckt da.
    const a = steuerausweisFuerBeleg([marge(4790n)]);

    expect(a.ausweisbareVatCents).toBeNull();
    expect(a.nichtAusweisbareVatCents).toBe(4790n);
  });

  it('und traegt den gesetzlich vorgeschriebenen Wortlaut', () => {
    const a = steuerausweisFuerBeleg([marge(4790n)]);
    // Art. 226 Nr. 14 MwStSystRL verlangt genau diesen Begriff. Ein blosser
    // Verweis auf § 25a ist der uebliche Zusatz, ersetzt ihn aber nicht.
    expect(a.hinweise[0]).toBe('Gebrauchtgegenstände/Sonderregelung');
    expect(a.hinweise.join(' ')).toContain('§ 25a UStG');
    expect(a.hinweise.join(' ')).toContain('nicht gesondert ausweisbar');
  });

  it('null wird NICHT als "0,00" gedruckt', () => {
    // Eine Null-Zeile ist auch eine Aussage ueber die Steuer und laedt zur
    // Nachfrage ein, ob da etwas fehlt. Gar keine Zeile ist richtig.
    expect(steuerausweisFuerBeleg([marge(4790n)]).ausweisbareVatCents).not.toBe(0n);
  });
});

describe('der gemischte Korb, und warum je ZEILE entschieden wird', () => {
  it('Regelware wird ausgewiesen, Margenware nicht, auf DEMSELBEN Beleg', () => {
    // Die Steuerart haengt am PRODUKT. Ein gebrauchter Goldring und eine neue
    // Ware koennen im selben Korb liegen. Ein Schalter je Beleg waere hier in
    // beide Richtungen falsch.
    const a = steuerausweisFuerBeleg([regel(1900n), marge(4790n)]);

    expect(a.ausweisbareVatCents).toBe(1900n); // NUR die Regelware
    expect(a.nichtAusweisbareVatCents).toBe(4790n);
    expect(a.hinweise[0]).toBe('Gebrauchtgegenstände/Sonderregelung');
  });

  it('mehrere Regelsaetze werden zusammengezaehlt', () => {
    const a = steuerausweisFuerBeleg([regel(1900n), regel(700n, '0.0700')]);
    expect(a.ausweisbareVatCents).toBe(2600n);
    expect(a.hinweise).toEqual([]);
  });

  it('zwei Margenzeilen erzeugen den Hinweis nur EINMAL', () => {
    const a = steuerausweisFuerBeleg([marge(1000n), marge(2000n)]);
    expect(a.nichtAusweisbareVatCents).toBe(3000n);
    expect(a.hinweise.filter((h) => h === 'Gebrauchtgegenstände/Sonderregelung')).toHaveLength(1);
  });
});

describe('die anderen Sonderregelungen', () => {
  it('Anlagegold nach § 25c bekommt seinen eigenen Hinweis', () => {
    const a = steuerausweisFuerBeleg([anlagegold()]);
    expect(a.ausweisbareVatCents).toBeNull();
    expect(a.hinweise.join(' ')).toContain('§ 25c UStG');
  });

  it('Anlagegold und Margenware nebeneinander tragen BEIDE Hinweise', () => {
    const a = steuerausweisFuerBeleg([anlagegold(), marge(4790n)]);
    expect(a.hinweise.join(' ')).toContain('§ 25c UStG');
    expect(a.hinweise.join(' ')).toContain('§ 25a UStG');
  });
});

describe('§ 13b traegt einen SATZ und ist trotzdem eine Sonderregelung', () => {
  it('kein Ausweis, aber der zwingende Hinweis', () => {
    // `computeLineMath` gibt REVERSE_CHARGE_13B den Satz '0.0000' und NICHT
    // null. Ueber den Satz allein waere die Zeile „ausweisbar mit null
    // Steuer", und der nach § 14a Abs. 5 UStG zwingende Hinweis fiele weg.
    // Ein Beleg ohne ihn ist bei § 13b unvollstaendig.
    const a = steuerausweisFuerBeleg([
      { taxTreatmentCode: 'REVERSE_CHARGE_13B', lineVatCents: 0n, appliedVatRate: '0.0000' },
    ]);
    expect(a.ausweisbareVatCents).toBeNull();
    expect(a.hinweise[0]).toBe('Steuerschuldnerschaft des Leistungsempfängers');
  });

  it('B2B-Zeile neben Regelware: die Regelware wird weiterhin ausgewiesen', () => {
    const a = steuerausweisFuerBeleg([
      regel(1900n),
      { taxTreatmentCode: 'REVERSE_CHARGE_13B', lineVatCents: 0n, appliedVatRate: '0.0000' },
    ]);
    expect(a.ausweisbareVatCents).toBe(1900n);
    expect(a.hinweise.join(' ')).toContain('§ 13b UStG');
  });
});

describe('der reine Regelbeleg bleibt unveraendert', () => {
  it('Steuer wird ausgewiesen, kein Hinweis', () => {
    const a = steuerausweisFuerBeleg([regel(1900n), regel(380n)]);
    expect(a.ausweisbareVatCents).toBe(2280n);
    expect(a.hinweise).toEqual([]);
    expect(a.nichtAusweisbareVatCents).toBe(0n);
  });

  it('ein leerer Beleg druckt keine Steuerzeile', () => {
    expect(steuerausweisFuerBeleg([]).ausweisbareVatCents).toBeNull();
  });
});

describe('die Entscheidung haengt am SATZ, nicht am Namen der Steuerart', () => {
  it('eine kuenftige Sonderregelung ist von selbst sicher', () => {
    // Kaeme eine weitere Sonderregelung dazu und niemand daechte an dieses
    // Modul, waere der Ausweis verboten und wuerde trotzdem gedruckt, wenn
    // hier ueber den NAMEN entschieden wuerde. Ueber `appliedVatRate === null`
    // ist die Vorgabe sicher: unbekannt heisst nicht ausweisen.
    const unbekannt = {
      taxTreatmentCode: 'IRGENDWAS_NEUES_29Z' as never,
      lineVatCents: 999n,
      appliedVatRate: null,
    };
    const a = steuerausweisFuerBeleg([unbekannt]);
    expect(a.ausweisbareVatCents).toBeNull();
    expect(a.nichtAusweisbareVatCents).toBe(999n);
  });
});

describe('Cent als Betrag', () => {
  it('formatiert deutsch', () => {
    expect(centsAlsBetrag(4790n)).toBe('47,90');
    expect(centsAlsBetrag(5n)).toBe('0,05');
    expect(centsAlsBetrag(100000n)).toBe('1000,00');
    expect(centsAlsBetrag(0n)).toBe('0,00');
  });
});

/**
 * Der Nachweis der USt-IdNr.-Abfrage auf dem Beleg.
 *
 * Bis zum 26.07.2026 stand auf einem § 13b-Beleg nur der Rechtssatz. Ob
 * jemand die Nummer je abgefragt hatte, war dem Beleg nicht anzusehen — und
 * es hatte nie jemand, weil die Route es gar nicht verlangte.
 */
describe('§ 13b: der Nachweis gehoert auf den Beleg', () => {
  const zeile = {
    taxTreatmentCode: 'REVERSE_CHARGE_13B' as const,
    appliedVatRate: '0.0000',
    lineVatCents: 0n,
  };

  it('druckt den Nachweis, wenn er vorliegt', () => {
    const a = steuerausweisFuerBeleg(
      [zeile],
      'USt-IdNr. DE811907980 · EU-Abfrage vom 23.07.2026 · gültig',
    );
    expect(a.hinweise.join(' ')).toContain('DE811907980');
    expect(a.hinweise.join(' ')).toContain('EU-Abfrage');
  });

  it('⚠️ und sagt es LAUT, wenn er fehlt — statt still zu schweigen', () => {
    // Ein Beleg, der § 13b behauptet und den Nachweis weglaesst, sieht genauso
    // aus wie ein richtiger. Genau das war der Zustand.
    for (const ohne of [undefined, null, '', '   ']) {
      const a = steuerausweisFuerBeleg([zeile], ohne);
      expect(a.hinweise.join(' '), String(ohne)).toContain('FEHLT');
    }
  });

  it('der Rechtssatz bleibt in jedem Fall stehen', () => {
    const a = steuerausweisFuerBeleg([zeile]);
    expect(a.hinweise.join(' ')).toContain('Steuerschuldnerschaft des Leistungsempfängers');
  });

  it('ohne § 13b taucht gar kein Nachweis auf', () => {
    const a = steuerausweisFuerBeleg(
      [{ taxTreatmentCode: 'STANDARD_19', appliedVatRate: '0.1900', lineVatCents: 190n }],
      'sollte nirgends auftauchen',
    );
    expect(a.hinweise.join(' ')).not.toContain('sollte nirgends');
  });
});
