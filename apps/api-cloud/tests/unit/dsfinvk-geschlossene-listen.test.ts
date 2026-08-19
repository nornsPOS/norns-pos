/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DREI WERTE, DIE IN DER NORM NIE STANDEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `BON_TYP`, `GV_TYP` und `ZAHLART_TYP` sind geschlossene Listen (Anhänge B,
 * C, D). Ein Wert daneben ist kein Schönheitsfehler: das Prüfwerkzeug kennt
 * ihn nicht und weist den Datenträger zurück.
 *
 * Der alte Erzeuger schrieb drei davon:
 *
 *   1. `BON_TYP = 'Beleg-Storno'` — den Wert gibt es nicht, er heisst
 *      `AVBelegstorno`.
 *   2. `GV_TYP = 'Einkauf'` — kommt im ganzen Normtext NULL Mal vor,
 *      am Volltext der amtlichen PDF nachgezählt.
 *   3. `UST_SCHLUESSEL_FALLBACK = '7'` — jeder unbekannte Code wurde still
 *      zur Differenzbesteuerung.
 *
 * Und der schwerste: der Quelltext behauptete, Schlüssel 7 stehe für § 25a.
 * Dafür gibt es keinen Beleg. Anhang C hält die IDs unter 1000 für die Norm
 * selbst zurück; individuelle Sachverhalte beginnen bei 1000.
 */

import { describe, expect, it } from 'vitest';

import {
  BON_TYP,
  bonTypFuer,
  GV_TYP,
  gvTypFuer,
  pruefeBonTyp,
  UnbekannterNormwertError,
  ustSchluesselFuer,
  UstSchluesselOffenError,
  ZAHLART_TYP,
  zahlartTypFuer,
} from '../../src/lib/dsfinvk-schluessel.js';

describe('⛔ Beleg-Storno gibt es nicht — und AVBelegstorno passt auch nicht', () => {
  /**
   * ⚠️ Diese Prüfung wurde ZWEIMAL berichtigt, und die zweite wiegt schwerer.
   *
   * Erst verlangte sie `AVBelegstorno`, weil der Wert in Anhang B steht. Er
   * steht dort — aber er meint etwas anderes, und für eine TSE-Kasse ist er
   * ausdrücklich verboten:
   *
   *   „Mit dem AVBelegstorno ist nicht die negative Darstellung eines
   *    Beleges gemeint. Hierfür muss weiterhin der Vorgangstyp ‚Beleg' mit
   *    umgekehrten Vorzeichen … genutzt werden."
   *
   *   „Achtung! Sobald eine TSE an einer Kasse eingesetzt wird, ist es
   *    technisch nicht mehr möglich, den Vorgangstyp ‚AVBelegstorno' korrekt
   *    zu verwenden."
   *
   * Dieses Haus bucht GEGEN: der Storno ist ein eigener, signierter Beleg mit
   * negierten Beträgen. `AVBelegstorno` nähme dem Prüfer BEIDE Belege aus dem
   * Kassenabschluss; bei uns stehen beide drin und ihre Summe ist null.
   */
  it('⛔ auch ein Storno ist ein „Beleg" — mit umgekehrtem Vorzeichen', () => {
    expect(bonTypFuer(true)).toBe('Beleg');
    expect(bonTypFuer(false)).toBe('Beleg');
  });

  it('⛔ AVBelegstorno wird NICHT geschrieben', () => {
    // Er bleibt in der Liste der Norm — ein anderes Kassensystem darf ihn
    // benutzen. Dieses hier darf es nicht.
    expect(bonTypFuer(true)).not.toBe('AVBelegstorno');
  });

  it('⛔ der alte Wert wird abgewiesen', () => {
    expect(() => pruefeBonTyp('Beleg-Storno')).toThrow(UnbekannterNormwertError);
  });

  it('und die Meldung nennt die erlaubten Werte', () => {
    try {
      pruefeBonTyp('Beleg-Storno');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('AVBelegstorno');
      expect((e as Error).message).toContain('KEIN Paket');
    }
  });
});

describe('⛔ Einkauf steht in keiner Liste', () => {
  it('der Verkauf ist Umsatz — das ist eindeutig', () => {
    expect(gvTypFuer('VERKAUF')).toBe(GV_TYP.UMSATZ);
  });

  it('⛔ der Ankauf bricht ab, statt „Einkauf" zu schreiben', () => {
    // Aus Anhang C käme `Auszahlung` in Betracht. Das ist eine AUSLEGUNG,
    // und Auslegungen dieser Art gehören dem Steuerberater.
    expect(() => gvTypFuer('ANKAUF')).toThrow(/Einkauf/);
  });

  it('und die Meldung sagt, WER entscheidet', () => {
    try {
      gvTypFuer('ANKAUF');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('Steuerberater');
      expect((e as Error).message).toContain('Auszahlung');
    }
  });
});

describe('⛔ KEIN stiller Rückfall mehr beim Steuerschlüssel', () => {
  it('die belegten Schlüssel gelten', () => {
    expect(ustSchluesselFuer('STANDARD_19')).toBe('1');
    expect(ustSchluesselFuer('REDUCED_7')).toBe('2');
    // ⚠️ Hier stand '5'. Dieser Test BEHAUPTETE den Defekt: er hätte jede
    // Korrektur rot gemacht und wäre auf einer falschen Angabe grün geblieben.
    //
    // Anlage 2 zur DSFinV-K (05.12.2024): 5 = „Nicht Steuerbar",
    // 6 = „Umsatzsteuerfrei". § 25c Abs. 1 UStG stellt die Lieferung von
    // Anlagegold STEUERFREI — sie ist steuerbar und befreit, nicht draussen.
    expect(ustSchluesselFuer('INVESTMENT_GOLD_25C')).toBe('6');
  });

  it('⛔ § 25a hat KEINEN festen Wert — 7 war eine Behauptung', () => {
    expect(() => ustSchluesselFuer('MARGIN_25A')).toThrow(UstSchluesselOffenError);
  });

  it('⛔ § 13b ebenso', () => {
    expect(() => ustSchluesselFuer('REVERSE_CHARGE_13B')).toThrow(UstSchluesselOffenError);
  });

  it('⛔ und ein unbekannter Code fällt NICHT auf 7 zurück', () => {
    // Der alte Rückfall machte aus allem Unbekannten eine Marge.
    expect(() => ustSchluesselFuer('WAS_AUCH_IMMER')).toThrow(UstSchluesselOffenError);
  });

  it('✅ mit der Nummer des Beraters geht es durch', () => {
    expect(ustSchluesselFuer('MARGIN_25A', { MARGIN_25A: '1001' })).toBe('1001');
  });

  it('⚠️ eine leere Einstellung zählt NICHT als Antwort', () => {
    // Sonst öffnete ein versehentlich angelegtes Feld den Riegel.
    expect(() => ustSchluesselFuer('MARGIN_25A', { MARGIN_25A: '   ' })).toThrow(
      UstSchluesselOffenError,
    );
  });

  it('und die Meldung erklärt die Tausendergrenze', () => {
    try {
      ustSchluesselFuer('MARGIN_25A');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('1000');
      expect((e as Error).message).toContain('Steuerberater');
    }
  });
});

describe('die Zahlarten', () => {
  it('Bargeld ist Bar, Karte ist ECKarte', () => {
    expect(zahlartTypFuer('CASH')).toBe(ZAHLART_TYP.BAR);
    expect(zahlartTypFuer('ZVT_CARD')).toBe(ZAHLART_TYP.EC_KARTE);
  });

  it('die Dienstleister sind ElZahlungsdienstleister', () => {
    for (const m of ['STRIPE', 'STRIPE_TERMINAL', 'SUMUP', 'MOLLIE', 'EBAY']) {
      expect(zahlartTypFuer(m), m).toBe(ZAHLART_TYP.EL_ZAHLUNGSDIENSTLEISTER);
    }
  });

  it('⛔ eine unbekannte Zahlart bricht ab', () => {
    expect(() => zahlartTypFuer('BITCOIN')).toThrow(UnbekannterNormwertError);
  });
});

describe('die Listen sind die der Norm', () => {
  it('BON_TYP kennt genau die neun Werte des Anhangs B', () => {
    expect(Object.values(BON_TYP).sort()).toEqual(
      [
        'AVBelegabbruch', 'AVBelegstorno', 'AVBestellung', 'AVRechnung',
        'AVSachbezug', 'AVSonstige', 'AVTraining', 'AVTransfer', 'Beleg',
      ].sort(),
    );
  });

  it('GV_TYP kennt fünfundzwanzig Werte', () => {
    expect(Object.values(GV_TYP)).toHaveLength(25);
    expect(Object.values(GV_TYP)).not.toContain('Einkauf');
  });

  it('ZAHLART_TYP kennt sieben', () => {
    expect(Object.values(ZAHLART_TYP)).toHaveLength(7);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN RIEGEL, DER RICHTIG SPERRT UND FALSCH SPRICHT, IST EIN HALBER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Fehlerbehandler prüft `instanceof DomainError`. Alles andere wird zu
 * „Internal server error" — die sorgfältig geschriebene Meldung steht dann nur
 * im Serverprotokoll, und der Mensch am Bildschirm liest, dass etwas kaputt
 * sei.
 *
 * Es ist aber nichts kaputt: es fehlt eine Angabe oder ein Wert passt nicht
 * zur Norm. Niemand weiss dann, was zu tun ist, und irgendwann schaltet
 * jemand den Riegel ab.
 *
 * ⚠️ Und der Ankauf wiegt hier besonders schwer: für einen Edelmetallhändler
 * ist der Ankauf von Privat das halbe Geschäft und die QUELLE der
 * Differenzbesteuerung. Ein nacktes `Error` liess JEDEN Tag mit einem
 * Ankaufbeleg mit 500 scheitern.
 */
describe('⛔ jede Sperre erreicht den Bildschirm', () => {
  it('alle drei Fehlerklassen sind DomainError', async () => {
    const { DomainError } = await import('../../src/plugins/error-handler.js');
    const { GeschaeftsvorfallOffenError } = await import(
      '../../src/lib/dsfinvk-schluessel.js'
    );
    const faelle = [
      new UnbekannterNormwertError('BON_TYP', 'x', ['Beleg']),
      new UstSchluesselOffenError('MARGIN_25A'),
      new GeschaeftsvorfallOffenError('Ankauf ungeklärt'),
    ];
    for (const e of faelle) {
      expect(e instanceof DomainError, `${e.name} wird als 500 ausgeliefert`).toBe(true);
      expect((e as unknown as { httpStatus: number }).httpStatus, e.name).toBe(409);
    }
  });

  it('⛔ und der ANKAUF wirft eine davon, kein nacktes Error', async () => {
    const { GeschaeftsvorfallOffenError } = await import(
      '../../src/lib/dsfinvk-schluessel.js'
    );
    expect(() => gvTypFuer('ANKAUF')).toThrow(GeschaeftsvorfallOffenError);
  });
});
