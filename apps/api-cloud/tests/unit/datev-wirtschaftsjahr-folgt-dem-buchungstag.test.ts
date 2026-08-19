/**
 * ════════════════════════════════════════════════════════════════════════
 *  Das Wirtschaftsjahr im Kopf muss zum BUCHUNGSTAG passen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 05.08.2026 ───────────────────────────────────────────
 *
 * DATEV wörtlich, zitiert in `docs/fiskal/recherche/datev-format.md` Zeile
 * 203: „Das Jahr wird immer aus dem Feld #13 des Headers ermittelt."
 *
 * Das Belegdatum einer Buchungszeile ist nur VIERSTELLIG (`TTMM`). Welches
 * JAHR gemeint ist, entscheidet allein Kopf-Feld 13, der
 * Wirtschaftsjahresbeginn. Der kam bis heute unverändert aus einer festen
 * Einstellung und wurde NIE gegen den Buchungstag gehalten.
 *
 * Gemessen: Einstellung `datev.wirtschaftsjahr_beginn` = 2026-01-01 (der
 * Vorgabewert, den die Erststart-Saat wörtlich so einträgt), Ausfuhr eines
 * Abschlusses vom 15.03.2027. Ergebnis:
 *
 *     Kopf-Feld 13        20260101
 *     Kopf-Feld 15/16     20270315
 *     Belegzeile Feld 10  1503
 *
 * DATEV liest daraus den 15.03.2026 — ein Jahr, das beim Berater längst
 * festgeschrieben ist. Der eigene Prüfer meldete NULL Befunde.
 *
 * Ab dem 1. Januar des zweiten Betriebsjahres ist damit JEDE Ausfuhr um ein
 * Jahr verschoben, ohne dass jemand etwas anfasst. Trägt der Inhaber den Wert
 * dann von Hand nach, kippt der Fehler auf die Gegenseite: der im Januar 2027
 * gezogene Dezember-2026-Stapel landet im Dezember 2027. Ein FESTER Wert kann
 * für beide Fälle nie stimmen.
 *
 * ── DIE ENTSCHEIDUNG ────────────────────────────────────────────────────
 *
 * Die Einstellung liefert nur noch MONAT und TAG des Wirtschaftsjahresbeginns
 * (Regelfall 01-01, abweichendes Wirtschaftsjahr etwa 07-01). Das JAHR wird
 * aus dem Buchungstag gerechnet.
 *
 * Das ist sicher, weil es genau EINEN Stapelerzeuger gibt (die Route je
 * Abschluss) und ein Stapel genau EINEN Geschäftstag trägt. Eine Datei kann
 * also nie eine Wirtschaftsjahresgrenze überspannen.
 */

import { describe, expect, it } from 'vitest';

import { DatevFormatFehler, type DatevMandant, baueKopfzeile } from '../../src/lib/datev-format.js';
import { nurFehler, pruefeBuchungsstapel } from '../../src/lib/datev-pruefer.js';
import { wirtschaftsjahrFuer } from '../../src/lib/datev-wirtschaftsjahr.js';

/** Derselbe Mandant wie in `datev-format.test.ts`, mit der ALTEN Schreibweise. */
const MANDANT: DatevMandant = {
  beraternummer: 29098,
  mandantennummer: 55003,
  wirtschaftsjahrBeginn: '2026-01-01',
  sachkontenlaenge: 4,
  festschreibung: false,
  sachkontenrahmen: '03',
};

describe('Das Wirtschaftsjahr folgt dem Buchungstag', () => {
  describe('Regelfall Kalenderjahr, Beginn am 1. Januar', () => {
    it('ein Tag im Jahr 2026 ergibt den 1. Januar 2026', () => {
      expect(wirtschaftsjahrFuer('01-01', '2026-06-19')).toBe('2026-01-01');
    });

    it('⚠️ DER BEFUND: derselbe eingestellte Beginn, ein Tag in 2027', () => {
      // Vorher stand hier für immer 2026-01-01, und DATEV buchte den
      // 15.03.2027 als 15.03.2026.
      expect(wirtschaftsjahrFuer('01-01', '2027-03-15')).toBe('2027-01-01');
    });

    it('der erste Tag des Jahres gehört schon zum neuen Wirtschaftsjahr', () => {
      expect(wirtschaftsjahrFuer('01-01', '2027-01-01')).toBe('2027-01-01');
    });

    it('der letzte Tag des Jahres gehört noch zum alten', () => {
      expect(wirtschaftsjahrFuer('01-01', '2026-12-31')).toBe('2026-01-01');
    });

    it('⚠️ DIE GEGENSEITE: der im Januar gezogene Dezemberstapel bleibt im Dezember', () => {
      // Wer den festen Wert nachträgt, verschiebt genau diesen Fall um ein
      // Jahr. Gerechnet bleibt er richtig, weil der BUCHUNGSTAG entscheidet
      // und nicht der Tag der Ausfuhr.
      expect(wirtschaftsjahrFuer('01-01', '2026-12-20')).toBe('2026-01-01');
    });
  });

  describe('Abweichendes Wirtschaftsjahr, Beginn am 1. Juli', () => {
    it('ein Tag im August gehört zum Wirtschaftsjahr, das im Juli begann', () => {
      expect(wirtschaftsjahrFuer('07-01', '2026-08-15')).toBe('2026-07-01');
    });

    it('ein Tag im Mai gehört noch zum Wirtschaftsjahr des VORJAHRES', () => {
      expect(wirtschaftsjahrFuer('07-01', '2026-05-15')).toBe('2025-07-01');
    });

    it('der Beginntag selbst gehört zum neuen Jahr', () => {
      expect(wirtschaftsjahrFuer('07-01', '2026-07-01')).toBe('2026-07-01');
    });

    it('der Tag davor gehört zum alten', () => {
      expect(wirtschaftsjahrFuer('07-01', '2026-06-30')).toBe('2025-07-01');
    });
  });

  describe('Der 29. Februar', () => {
    it('ein Wirtschaftsjahr, das am 29.02. begänne, wird im Nicht-Schaltjahr abgewiesen', () => {
      // Ein Beginn am 29. Februar gibt es in drei von vier Jahren nicht. Ein
      // stillschweigend auf den 28. gerückter Beginn wäre eine erfundene
      // Angabe im Kopf einer Steuerdatei.
      expect(() => wirtschaftsjahrFuer('02-29', '2027-06-01')).toThrow(/29\. Februar/);
    });

    it('im Schaltjahr ist er zulässig', () => {
      expect(wirtschaftsjahrFuer('02-29', '2028-06-01')).toBe('2028-02-29');
    });
  });

  describe('⛔ Was NICHT durchgeht', () => {
    it.each([
      ['leer', ''],
      ['ganzes Datum statt Monat und Tag', '2026-01-01'],
      ['Monat 13', '13-01'],
      ['Monat 0', '00-01'],
      ['Tag 32', '01-32'],
      ['Tag 0', '01-00'],
      ['31. April', '04-31'],
      ['Buchstaben', 'xx-yy'],
      ['ohne Trenner', '0101'],
    ])('%s wird abgewiesen', (_name, wert) => {
      expect(() => wirtschaftsjahrFuer(wert, '2026-06-19')).toThrow();
    });

    it('ein unbrauchbarer Buchungstag wird abgewiesen', () => {
      expect(() => wirtschaftsjahrFuer('01-01', 'morgen')).toThrow();
      expect(() => wirtschaftsjahrFuer('01-01', '')).toThrow();
    });
  });

  describe('Die alte Schreibweise wird noch verstanden', () => {
    it('ein volles Datum aus der Einstellung liefert Monat und Tag', () => {
      // Auf jedem bestehenden Gerät steht dort heute `2026-01-01`. Die
      // Umstellung darf keine Ausfuhr blockieren; sie nimmt Monat und Tag und
      // verwirft das Jahr, das ohnehin nie gestimmt hat.
      expect(wirtschaftsjahrFuer('2026-01-01', '2027-03-15', { altesDatumErlauben: true })).toBe(
        '2027-01-01',
      );
      expect(wirtschaftsjahrFuer('2019-07-01', '2026-08-15', { altesDatumErlauben: true })).toBe(
        '2026-07-01',
      );
    });
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⛔ UND DAS GANZE WIRKLICH ANGESCHLOSSEN
 * ════════════════════════════════════════════════════════════════════════
 *
 * Eine gerechnete Zahl, die niemand einbaut, ist die Hauskrankheit „gebaut
 * und nie angeschlossen". Diese Zusagen prüfen den ECHTEN Kopf.
 */
describe('⛔ Kopf-Feld 13 kommt aus dem Buchungstag, nicht aus der Einstellung', () => {
  const feld = (kopf: string, nr: number): string => kopf.split(';')[nr - 1] ?? '';

  it('⚠️ DER GEMESSENE FALL: Einstellung 2026, Abschluss vom 15.03.2027', () => {
    // Vorher stand hier für immer 20260101, und DATEV buchte den 15.03.2027
    // als 15.03.2026 — ein Jahr, das beim Berater festgeschrieben ist.
    const kopf = baueKopfzeile(
      MANDANT,
      { von: '2027-03-15', bis: '2027-03-15' },
      'Kasse 2027-03-15',
      new Date('2027-03-16T08:00:00.000Z'),
    );
    expect(feld(kopf, 13)).toBe('20270101');
    expect(feld(kopf, 15)).toBe('20270315');
    expect(feld(kopf, 16)).toBe('20270315');
  });

  it('und im ersten Jahr ändert sich nichts', () => {
    const kopf = baueKopfzeile(
      MANDANT,
      { von: '2026-05-01', bis: '2026-05-31' },
      'Kasse Mai 2026',
      new Date('2026-06-01T08:00:00.000Z'),
    );
    expect(feld(kopf, 13)).toBe('20260101');
  });

  it('ein abweichendes Wirtschaftsjahr wird übernommen', () => {
    const kopf = baueKopfzeile(
      { ...MANDANT, wirtschaftsjahrBeginn: '07-01' },
      { von: '2026-05-15', bis: '2026-05-15' },
      'Kasse',
      new Date('2026-05-16T08:00:00.000Z'),
    );
    // Der 15. Mai liegt noch im Wirtschaftsjahr, das am 01.07.2025 begann.
    expect(feld(kopf, 13)).toBe('20250701');
  });

  it('ein unbrauchbarer Beginn bricht mit dem Hausfehler ab, nicht mit einem nackten', () => {
    expect(() =>
      baueKopfzeile(
        { ...MANDANT, wirtschaftsjahrBeginn: '13-01' },
        { von: '2026-05-01', bis: '2026-05-31' },
        'x',
        new Date(),
      ),
    ).toThrow(DatevFormatFehler);
  });
});

describe('⛔ und der eigene Prüfer sieht den Widerspruch jetzt', () => {
  it('ein Zeitraum ausserhalb des Wirtschaftsjahres wird ROT', () => {
    // Genau die Datei, die am 05.08.2026 null Befunde bekam: Feld 13 im Jahr
    // 2026, Zeitraum im Jahr 2027. Der Prüfer sah jedes Feld nur für sich.
    const kopf = baueKopfzeile(
      MANDANT,
      { von: '2026-05-01', bis: '2026-05-31' },
      'Kasse',
      new Date('2026-06-01T08:00:00.000Z'),
    );
    const teile = kopf.split(';');
    teile[14] = '20270315';
    teile[15] = '20270315';
    const spalten = 'x'.repeat(0);
    const datei = `${teile.join(';')}\r\n${spalten}\r\n`;
    const befunde = nurFehler(pruefeBuchungsstapel(datei));
    const treffer = befunde.filter((f) => f.zeile === 1 && (f.feld === 15 || f.feld === 16));
    expect(treffer.length, 'der Widerspruch zwischen Feld 13 und 15/16 bleibt unbemerkt').toBe(2);
    expect(treffer[0]?.text).toContain('Wirtschaftsjahr');
  });

  it('und eine Datei, deren Zeitraum passt, bleibt an dieser Stelle still', () => {
    const kopf = baueKopfzeile(
      MANDANT,
      { von: '2026-05-01', bis: '2026-05-31' },
      'Kasse',
      new Date('2026-06-01T08:00:00.000Z'),
    );
    const datei = `${kopf}\r\n\r\n`;
    const befunde = nurFehler(pruefeBuchungsstapel(datei));
    expect(befunde.filter((f) => f.text.includes('Wirtschaftsjahr'))).toEqual([]);
  });
});
