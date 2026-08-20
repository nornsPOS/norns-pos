/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Steuersatz ist eine Frage des TAGES, nicht eine Zahl im Quelltext
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Befund steht in `umsatzsteuersaetze.ts`: die Sätze 19 und 7 standen an
 * vier Stellen als feste Zahlen, keine kannte ein Datum. Am Tag einer
 * Gesetzesänderung wäre die Kasse entweder für alle ALTEN Belege kaputt
 * (Storno, Nachdruck, Margennachrechnung) oder für alle NEUEN.
 */

import { describe, expect, it } from 'vitest';

import {
  ERMAESSIGTER_SATZ,
  REGELSATZ,
  type Satzspanne,
  UnbekannterSteuersatzError,
  alsTag,
  satzAm,
  satzHeute,
  satzWeichtVonHeuteAb,
} from './umsatzsteuersaetze.js';

describe('Welcher Satz an welchem Tag galt', () => {
  it('heute gilt der Regelsatz 19 Prozent', () => {
    expect(satzAm('REGEL', '2026-08-20')).toBe('0.1900');
    expect(satzAm('ERMAESSIGT', '2026-08-20')).toBe('0.0700');
  });

  it('⛔ das Corona-Halbjahr 2020 trägt 16 und 5 Prozent', () => {
    /*
     * Zweites Corona-Steuerhilfegesetz: vom 1. Juli bis 31. Dezember 2020.
     * § 147 AO verlangt zehn Jahre Aufbewahrung — dieses Halbjahr liegt von
     * 2026 aus MITTEN in der Frist. Ein Storno oder Nachdruck aus dieser
     * Zeit braucht genau diese Sätze.
     */
    expect(satzAm('REGEL', '2020-07-01')).toBe('0.1600');
    expect(satzAm('REGEL', '2020-12-31')).toBe('0.1600');
    expect(satzAm('ERMAESSIGT', '2020-07-01')).toBe('0.0500');
    expect(satzAm('ERMAESSIGT', '2020-12-31')).toBe('0.0500');
  });

  it('⛔ und die Tage DAVOR und DANACH tragen wieder 19 und 7', () => {
    // Die Grenzen sind der ganze Punkt: einen Tag daneben ist der Beleg
    // falsch besteuert.
    expect(satzAm('REGEL', '2020-06-30')).toBe('0.1900');
    expect(satzAm('REGEL', '2021-01-01')).toBe('0.1900');
    expect(satzAm('ERMAESSIGT', '2020-06-30')).toBe('0.0700');
    expect(satzAm('ERMAESSIGT', '2021-01-01')).toBe('0.0700');
  });

  it('kennt auch die Zeit vor 2007', () => {
    expect(satzAm('REGEL', '2006-12-31')).toBe('0.1600');
    expect(satzAm('REGEL', '2007-01-01')).toBe('0.1900');
    expect(satzAm('REGEL', '1998-03-31')).toBe('0.1500');
    expect(satzAm('REGEL', '1998-04-01')).toBe('0.1600');
  });

  it('⛔ rät NIE einen Satz — vor der ersten Spanne wirft es', () => {
    // Eine erfundene Steuerzahl sieht plausibel aus und ist falsch. Lieber
    // ein lauter Abbruch als ein stiller Beleg.
    expect(() => satzAm('REGEL', '1992-12-31')).toThrow(UnbekannterSteuersatzError);
    expect(() => satzAm('REGEL', 'heute')).toThrow(UnbekannterSteuersatzError);
    expect(() => satzAm('REGEL', '20.08.2026')).toThrow(UnbekannterSteuersatzError);
    expect(() => satzAm('ERMAESSIGT', '')).toThrow(UnbekannterSteuersatzError);
  });
});

describe('Die Spannen selbst', () => {
  const lueckenlos = (liste: readonly Satzspanne[]): string[] => {
    const fehler: string[] = [];
    for (let i = 0; i < liste.length - 1; i++) {
      const a = liste[i]!;
      const b = liste[i + 1]!;
      if (a.bis === null) fehler.push(`${a.ab} ist offen, aber es folgt noch ${b.ab}`);
      else {
        const naechster = new Date(`${a.bis}T00:00:00Z`);
        naechster.setUTCDate(naechster.getUTCDate() + 1);
        const soll = naechster.toISOString().slice(0, 10);
        if (soll !== b.ab) fehler.push(`zwischen ${a.bis} und ${b.ab} klafft eine Lücke`);
      }
    }
    return fehler;
  };

  it('⛔ die Spannen stossen lückenlos aneinander', () => {
    // Eine Lücke wäre ein Tag, an dem die Kasse keinen Satz kennt und den
    // Verkauf abbricht — mitten im Geschäft.
    expect(lueckenlos(REGELSATZ)).toEqual([]);
    expect(lueckenlos(ERMAESSIGTER_SATZ)).toEqual([]);
  });

  it('⛔ genau EINE Spanne ist offen, und es ist die letzte', () => {
    for (const [name, liste] of [
      ['Regelsatz', REGELSATZ],
      ['ermässigt', ERMAESSIGTER_SATZ],
    ] as const) {
      const offene = liste.filter((s) => s.bis === null);
      expect(offene.length, `${name}: es muss genau eine offene Spanne geben`).toBe(1);
      expect(liste[liste.length - 1]!.bis, `${name}: die offene muss die letzte sein`).toBeNull();
    }
  });

  it('jede Spanne trägt einen Satz im Format von `applied_vat_rate`', () => {
    for (const s of [...REGELSATZ, ...ERMAESSIGTER_SATZ]) {
      expect(s.satz, `${s.ab}: vier Nachkommastellen wie in den Büchern`).toMatch(/^\d\.\d{4}$/);
    }
  });
});

describe('Der Geschäftstag eines Zeitpunkts', () => {
  it('⛔ rechnet in deutscher Ortszeit, nicht in UTC', () => {
    /*
     * 31.12.2020, 23:30 deutscher Zeit — der LETZTE Tag mit 16 Prozent.
     * In UTC ist es 22:30 desselben Tages, das geht gut. Aber im Sommer:
     * 01.07.2020 um 00:30 deutscher Sommerzeit ist in UTC noch der 30.06.,
     * also der letzte Tag mit 19 Prozent. Ein Verkauf um halb eins nachts
     * bekäme den falschen Satz.
     */
    const kurzNachMitternacht = new Date('2020-06-30T22:30:00Z'); // 00:30 Berlin am 1.7.
    expect(alsTag(kurzNachMitternacht)).toBe('2020-07-01');
    expect(satzAm('REGEL', alsTag(kurzNachMitternacht))).toBe('0.1600');

    // Und die naive UTC-Rechnung hätte hier danebengegriffen:
    expect(kurzNachMitternacht.toISOString().slice(0, 10)).toBe('2020-06-30');
  });

  it('auch an der Winterzeitgrenze', () => {
    const silvester = new Date('2020-12-31T23:30:00Z'); // 00:30 Berlin am 1.1.2021
    expect(alsTag(silvester)).toBe('2021-01-01');
    expect(satzAm('REGEL', alsTag(silvester))).toBe('0.1900');
  });
});

describe('Der Hinweis für die Fläche', () => {
  it('erkennt einen Beleg aus einer Zeit mit anderem Satz', () => {
    const heute = new Date('2026-08-20T10:00:00Z');
    expect(satzWeichtVonHeuteAb('REGEL', '2020-09-01', heute)).toBe(true);
    expect(satzWeichtVonHeuteAb('REGEL', '2026-01-01', heute)).toBe(false);
  });

  it('`satzHeute` und `satzAm` sagen für denselben Tag dasselbe', () => {
    const heute = new Date('2026-08-20T10:00:00Z');
    expect(satzHeute('REGEL', heute)).toBe(satzAm('REGEL', '2026-08-20'));
    expect(satzHeute('ERMAESSIGT', heute)).toBe(satzAm('ERMAESSIGT', '2026-08-20'));
  });
});
