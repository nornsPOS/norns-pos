/**
 * Ohne die Angaben des Steuerberaters gibt es KEINE Datei — und die Meldung
 * nennt alle fehlenden auf einmal.
 *
 * ── WARUM DAS EIN EIGENER WÄCHTER IST (26.07.2026) ─────────────────────────
 * Vorher stand im Quelltext eine feste Kopfzeile, in der Beraternummer,
 * Mandantennummer, Wirtschaftsjahresbeginn und der Zeitraum leer waren, mit
 * dem Kommentar, DATEV fülle sie beim Import. Das tut DATEV nicht. Der
 * Kommentar war das Gefährlichste an der Stelle: er beruhigte über einen
 * echten Defekt.
 *
 * Zwei Dinge werden hier festgehalten:
 *   1. Fehlt etwas, wird geworfen statt eine unbrauchbare Datei gebaut.
 *   2. Die Meldung nennt JEDE fehlende Angabe. Wer eine Liste bekommt, fragt
 *      seinen Berater einmal; wer eine einzelne Meldung bekommt, fünfmal.
 */
import { describe, expect, it } from 'vitest';

import {
  DATEV_SCHLUESSEL,
  DatevMandantFehltError,
  DatevNichtEingerichtetError,
  ladeDatevMandant,
} from '../../src/lib/datev-mandant.js';

/** Eine Datenbank, die genau die übergebenen Einstellungen kennt. */
function db(werte: Record<string, unknown>) {
  return {
    execute: () =>
      Promise.resolve(Object.entries(werte).map(([key, value]) => ({ key, value }))),
  };
}

const VOLLSTAENDIG = {
  [DATEV_SCHLUESSEL.beraternummer]: 29098,
  [DATEV_SCHLUESSEL.mandantennummer]: 55003,
  [DATEV_SCHLUESSEL.wirtschaftsjahrBeginn]: '2026-01-01',
  [DATEV_SCHLUESSEL.sachkontenlaenge]: 4,
  [DATEV_SCHLUESSEL.festschreibung]: false,
  [DATEV_SCHLUESSEL.sachkontenrahmen]: '03',
};

describe('vollstaendig eingerichtet', () => {
  it('liefert die Angaben, wie der Kopf sie braucht', async () => {
    const m = await ladeDatevMandant(db(VOLLSTAENDIG));
    expect(m).toEqual({
      beraternummer: 29098,
      mandantennummer: 55003,
      wirtschaftsjahrBeginn: '2026-01-01',
      sachkontenlaenge: 4,
      festschreibung: false,
      sachkontenrahmen: '03',
    });
  });

  it('nimmt „SKR03" genauso wie „03"', async () => {
    const m = await ladeDatevMandant(
      db({ ...VOLLSTAENDIG, [DATEV_SCHLUESSEL.sachkontenrahmen]: 'SKR04' }),
    );
    expect(m.sachkontenrahmen).toBe('04');
  });
});

describe('unvollstaendig', () => {
  it('wirft, statt eine Datei mit leeren Ordnungsbegriffen zu bauen', async () => {
    await expect(ladeDatevMandant(db({}))).rejects.toBeInstanceOf(DatevNichtEingerichtetError);
  });

  it('nennt ALLE fehlenden Angaben in EINER Meldung, nicht die erste', async () => {
    // Der eigentliche Punkt dieses Waechters.
    const nurEine = { [DATEV_SCHLUESSEL.beraternummer]: 29098 };
    await expect(ladeDatevMandant(db(nurEine))).rejects.toThrow(
      /Mandantennummer[\s\S]*Wirtschaftsjahres[\s\S]*Sachkonten[\s\S]*Festschreibung[\s\S]*Kontenrahmen/,
    );
  });

  it('sagt es auf Deutsch, ohne rohe Schluesselnamen im Fliesstext', async () => {
    try {
      await ladeDatevMandant(db({}));
      expect.unreachable('haette werfen muessen');
    } catch (e) {
      const text = (e as Error).message;
      expect(text).toContain('Steuerberater');
      expect(text).toContain('Beraternummer');
      // Der rohe Schluessel `datev.beraternummer` gehoert nicht in den Satz,
      // den der Inhaber liest.
      expect(text).not.toContain('datev.beraternummer');
    }
  });

  it('weist eine unbrauchbare Sachkontenlaenge zurueck', async () => {
    await expect(
      ladeDatevMandant(db({ ...VOLLSTAENDIG, [DATEV_SCHLUESSEL.sachkontenlaenge]: 9 })),
    ).rejects.toThrow(/vier bis acht/);
  });

  it('weist einen unbekannten Kontenrahmen zurueck', async () => {
    await expect(
      ladeDatevMandant(db({ ...VOLLSTAENDIG, [DATEV_SCHLUESSEL.sachkontenrahmen]: '07' })),
    ).rejects.toThrow(/SKR03 oder SKR04/);
  });

  it('behandelt einen leeren Text wie fehlend', async () => {
    await expect(
      ladeDatevMandant(db({ ...VOLLSTAENDIG, [DATEV_SCHLUESSEL.wirtschaftsjahrBeginn]: '' })),
    ).rejects.toThrow(/Wirtschaftsjahres/);
  });

  /**
   * ── DER FEHLERCODE, AUF DEN DIE FLÄCHEN BAUEN (26.07.2026) ───────────────
   * Seit Wanderung 0117 steht in keiner Wanderung mehr eine Beraternummer.
   * Damit ist dieser Fall der HAUPTWEG jedes neuen Ladens, nicht mehr die
   * Ausnahme — und ein Hauptweg darf sich nicht wie ein Fehler anfühlen.
   * `DATEV_MANDANT_FEHLT` ist das Zeichen, an dem die Kasse ein
   * Einrichtungsformular zeigt statt einer roten Meldung. Ein generisches
   * `CONFLICT` liesse sich von einem gesperrten Abschluss nicht unterscheiden.
   */
  it('trägt den eigenen Fehlercode DATEV_MANDANT_FEHLT, nicht das allgemeine CONFLICT', async () => {
    try {
      await ladeDatevMandant(db({}));
      expect.unreachable('haette werfen muessen');
    } catch (e) {
      expect(e).toBeInstanceOf(DatevMandantFehltError);
      // Die alte Klasse bleibt der Oberbegriff — wer beide Fälle gleich
      // behandeln will, braucht weiterhin nur eine Klasse.
      expect(e).toBeInstanceOf(DatevNichtEingerichtetError);
      expect((e as DatevMandantFehltError).code).toBe('DATEV_MANDANT_FEHLT');
      expect((e as DatevMandantFehltError).httpStatus).toBe(409);
    }
  });

  it('sagt bei den zwei Ordnungsnummern WOHER sie kommen und WARUM es ohne nicht geht', async () => {
    // Der Händler soll nach EINEM Lesen wissen, wen er fragt und was auf dem
    // Spiel steht. „Fehlt" allein schickt ihn in seine Einstellungen, wo er
    // nichts findet.
    const ohneNummern = {
      ...VOLLSTAENDIG,
      [DATEV_SCHLUESSEL.beraternummer]: undefined,
      [DATEV_SCHLUESSEL.mandantennummer]: undefined,
    };
    try {
      await ladeDatevMandant(db(ohneNummern));
      expect.unreachable('haette werfen muessen');
    } catch (e) {
      const text = (e as Error).message;
      // WAS fehlt — beide einzeln benannt.
      expect(text).toContain('Beraternummer');
      expect(text).toContain('Mandantennummer');
      // WOHER: der Steuerberater, und wer welche Nummer vergibt.
      expect(text).toContain('Steuerberater');
      expect(text).toContain('DATEV');
      expect(text).toContain('Kanzlei');
      // WARUM: eine falsche Nummer landet still in fremden Büchern.
      expect(text).toMatch(/fremden Betriebs/);
      expect(text).toContain('STILL');
      // Und kein roher Schlüsselname im Fliesstext.
      expect(text).not.toContain('datev.beraternummer');
      expect(text).not.toContain('datev.mandantennummer');
    }
  });

  it('hält den Vortrag über DATEVs Anschrift zurück, wenn nur der Kontenrahmen fehlt', async () => {
    // Wer nur eine mandantenneutrale Angabe vergessen hat, soll nicht über
    // fremde Mandantenbestände belehrt werden.
    const nurRahmenFehlt = { ...VOLLSTAENDIG, [DATEV_SCHLUESSEL.sachkontenrahmen]: '' };
    try {
      await ladeDatevMandant(db(nurRahmenFehlt));
      expect.unreachable('haette werfen muessen');
    } catch (e) {
      const text = (e as Error).message;
      expect(text).toContain('Kontenrahmen');
      expect(text).not.toContain('fremden Betriebs');
    }
  });

  it('behandelt „false" bei der Festschreibung NICHT als fehlend', async () => {
    // Der naheliegende Fehler: `if (!wert)` haelt `false` fuer nicht gesetzt,
    // und der Export bricht ab, obwohl der Berater bewusst „nein" gewaehlt hat.
    const m = await ladeDatevMandant(
      db({ ...VOLLSTAENDIG, [DATEV_SCHLUESSEL.festschreibung]: false }),
    );
    expect(m.festschreibung).toBe(false);
  });
});
