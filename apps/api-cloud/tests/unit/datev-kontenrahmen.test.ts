/**
 * Der Kontenrahmen: die Vorlage steht fest, und nichts gibt sich als sicher
 * aus, was es nicht ist.
 *
 * ── WOGEGEN DIESER WÄCHTER STEHT (26.07.2026) ──────────────────────────────
 * Zwei Gefahren, beide still:
 *
 * 1. EINE ZAHL WANDERT. SKR03 ist der Stand, der bereits in der laufenden
 *    Buchführung liegt. Ändert jemand hier eine Ziffer, verschiebt sich der
 *    Buchungsstapel auf ein anderes Konto, ohne dass irgendetwas rot wird —
 *    auffallen würde es beim Jahresabschluss. Deshalb steht die Tabelle unten
 *    ZWEIMAL: einmal im Quelltext, einmal hier, wörtlich abgeschrieben.
 *
 * 2. EIN VORSCHLAG GIBT SICH ALS BESTÄTIGT AUS. Die Nummer 4200 für § 25a in
 *    SKR04 ist eine Recherchezahl, kein Wort des Steuerberaters. Verlöre sie
 *    ihr Merkmal, läse der Inhaber sie als gesichert. Das ist genau die
 *    Fehlerklasse, die dieses Haus mehrfach getroffen hat.
 */
import { describe, expect, it } from 'vitest';

import {
  DatevEinstellungError,
  KONTENRAHMEN,
  KONTO_DEFINITIONEN,
  type KontoId,
  MANDANT_FELDER,
  QUELLE,
  VORLAGE,
  konto,
  kontoSchluessel,
  ladeKontenplan,
  normalisiereRahmen,
  pruefeDatevEinstellung,
  pruefeKontonummer,
  vorlagenplan,
  zerlegeKontoSchluessel,
} from '../../src/lib/kontenrahmen.js';
import {
  SOLLKONTO_JE_ZAHLART,
  sollkontoFuerZahlart,
} from '../../src/lib/datev-kontierung.js';

/**
 * SKR03, wörtlich der Stand, der bis zum 26.07.2026 fest im Quelltext stand
 * (`datev-kontierung.ts` SOLLKONTO_JE_ZAHLART, `closing-export.ts`
 * KONTO_KASSE / KONTO_WARENEINGANG / ERLOES_BY_TREATMENT).
 *
 * Diese Liste ist ABGESCHRIEBEN, nicht abgeleitet. Sie darf sich nur ändern,
 * wenn ein Steuerberater es sagt — und dann bewusst, an zwei Stellen.
 */
const SKR03_WIE_ER_LIEF: Record<KontoId, string> = {
  kasse: '1000',
  bank: '1200',
  // 06.08.2026: NEU, kein Alt-Stand. Bis dahin gab es das Konto gar nicht,
  // und eine Bankabschöpfung erzeugte deshalb KEINE Buchungszeile — Konto
  // 1000 bewegte sich anders als die Schublade. BELEGT in
  // `docs/fiskal/recherche/beraterpraxis.md` §3.1 und §6.3: „Geldtransit
  // 1360". Ändert keine bestehende Zahl dieser Liste.
  geldtransit: '1360',
  // 06.08.2026: NEU, kein Alt-Stand. Die acht Aufwandskonten der
  // Betriebsausgaben. Jede Zahl in `QUELLE` bei ECOVIS RTS belegt, derselben
  // Quelle wie Kasse, Bank und Geldtransit. Ändert keine bestehende Zahl.
  aufwandMiete: '4210',
  aufwandWerbung: '4600',
  aufwandPorto: '4910',
  aufwandBuerobedarf: '4930',
  aufwandReparatur: '4805',
  aufwandGebuehren: '4970',
  aufwandReise: '4670',
  aufwandSonstiges: '4900',
  geldtransitKarte: '1361',
  geldtransitSumUp: '1362',
  geldtransitMollie: '1363',
  geldtransitStripe: '1364',
  // 26.07.2026: NEU fuer den Stripe-Leser im Laden (Wanderung 0120), kein
  // Alt-Stand. Fortgefuehrte Reihe 1361 ff., von Hand abgeschrieben.
  geldtransitStripeTerminal: '1366',
  geldtransitEbay: '1365',
  wareneingang: '3200',
  erloeseStandard19: '8400',
  erloeseReduced7: '8300',
  erloeseMargin25a: '8200',
  // 19.08.2026: 8150 → 8165, bewusst an beiden Stellen. 8150 heisst amtlich
  // „Sonstige steuerfreie Umsaetze (z. B. § 4 Nr. 2 bis 7 UStG)", und § 25c
  // ist keine Befreiung nach § 4. DATEVs Kontenerlaeuterung Dok.-Nr. 5361613
  // nennt fuer die steuerfreie Lieferung von Anlagegold ausdruecklich 8165
  // „Steuerfreie Umsaetze ohne Vorsteuerabzug zum Gesamtumsatz gehoerend".
  erloeseGold25c: '8165',
  // 26.07.2026: NEU. Beide fehlten, und ein Umsatz mit diesen Schluesseln fiel
  // STILL auf 8400 (Erloese 19 %) mit LEEREM Buchungsschluessel. Auf der
  // Produktion gemessen: 1 Vorgang ueber 464,00 EUR lief so.
  //
  // ⚠️ Beide Zahlen sind NICHT belegt — siehe QUELLE in kontenrahmen.ts. Sie
  // stehen hier trotzdem fest angenagelt, damit ihre Aenderung eine bewusste
  // Entscheidung an zwei Stellen bleibt und kein stiller Handgriff.
  erloeseReverseCharge13b: '8337',
  erloeseKleinunternehmer19: '8195',
  // ── 27.07.2026: die zwei Haelften eines § 25a-Verkaufs ─────────────────
  // Vorher ging der volle Verkaufspreis auf EIN Konto ohne Steuerschluessel.
  erloeseMargin25aEinkaufsanteil: '8193',
  erloeseMargin25aMarge: '8191',
  umsatzsteuer19: '1776',
  // 12.08.2026: NEU, kein Alt-Stand. Amtlich geprueft im offiziellen SKR03
  // 2025: 1796 "Ausgegebene Geschenkgutscheine", ohne Automatikfunktion.
  // Vorher brach ein Gutschein-Beleg die DATEV-Datei des ganzen Tages ab.
  // Aendert keine bestehende Zahl dieser Liste.
  gutscheinMehrzweck: '1796',
};

/** Eine Datenbank, die genau die übergebenen Zeilen kennt. */
function db(werte: Record<string, string>) {
  return {
    execute: () =>
      Promise.resolve(Object.entries(werte).map(([key, wert]) => ({ key, wert, value: wert }))),
  };
}

describe('die Vorlage SKR03 steht fest', () => {
  it('trägt Zahl für Zahl den Stand, der bereits gebucht wird', () => {
    expect(VORLAGE.SKR03).toEqual(SKR03_WIE_ER_LIEF);
  });

  it('gibt einem Aufrufer OHNE Kontenplan unverändert die alten Nummern', () => {
    // Der Vorgabewert von `sollkontoFuerZahlart` ist SKR03. Wer die Funktion
    // wie vor dem 26.07.2026 aufruft, bekommt wörtlich dasselbe Ergebnis.
    expect(sollkontoFuerZahlart('CASH')).toBe('1000');
    expect(sollkontoFuerZahlart('ZVT_CARD')).toBe('1361');
    expect(sollkontoFuerZahlart('BANK_TRANSFER')).toBe('1200');
    expect(SOLLKONTO_JE_ZAHLART.CASH).toBe('1000');
  });

  it('bucht mit einem SKR04-Plan auf die SKR04-Konten', () => {
    const plan = vorlagenplan('SKR04');
    expect(sollkontoFuerZahlart('CASH', plan)).toBe('1600');
    expect(sollkontoFuerZahlart('BANK_TRANSFER', plan)).toBe('1800');
  });
});

describe('SKR04 ist vollständig und keine Ziffernvertauschung', () => {
  it('kennt jedes logische Konto', () => {
    for (const def of KONTO_DEFINITIONEN) {
      expect(VORLAGE.SKR04[def.id], `${def.id} fehlt in SKR04`).toMatch(/^\d{4}$/);
    }
  });

  it('ist an keiner Stelle die SKR03-Zahl', () => {
    for (const def of KONTO_DEFINITIONEN) {
      expect(VORLAGE.SKR04[def.id], `${def.id}`).not.toBe(VORLAGE.SKR03[def.id]);
    }
  });

  it('nennt zu JEDER Zahl beider Rahmen ihre Herkunft', () => {
    // Der Kern der Sorgfaltspflicht: keine Zahl ohne Belegstelle oder ohne
    // das ausdrückliche Wort „unbelegt".
    for (const rahmen of KONTENRAHMEN) {
      for (const def of KONTO_DEFINITIONEN) {
        const q = QUELLE[rahmen][def.id];
        expect(q, `${rahmen} ${def.id}`).toBeTruthy();
        expect(q.length, `${rahmen} ${def.id} zu knapp`).toBeGreaterThan(20);
      }
    }
  });

  it('kennzeichnet die frei beschriftbaren Transitkonten ausdrücklich als unbelegt', () => {
    for (const id of ['geldtransitSumUp', 'geldtransitMollie', 'geldtransitStripe', 'geldtransitStripeTerminal', 'geldtransitEbay'] as const) {
      expect(QUELLE.SKR04[id]).toMatch(/unbelegt/);
    }
  });
});

describe('die Schlüssel passen zum Schema', () => {
  const SCHEMA = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

  it('hält die Bedingung system_settings_key_format ein', () => {
    for (const rahmen of KONTENRAHMEN) {
      for (const def of KONTO_DEFINITIONEN) {
        expect(kontoSchluessel(rahmen, def.id)).toMatch(SCHEMA);
      }
    }
    for (const f of MANDANT_FELDER) expect(f.schluessel).toMatch(SCHEMA);
  });

  it('lässt sich wieder zerlegen', () => {
    expect(zerlegeKontoSchluessel('datev.konto.skr03.kasse')).toEqual({
      rahmen: 'SKR03',
      konto: 'kasse',
    });
    expect(zerlegeKontoSchluessel('datev.konto.skr04.erloese_margin_25a')).toEqual({
      rahmen: 'SKR04',
      konto: 'erloeseMargin25a',
    });
    expect(zerlegeKontoSchluessel('datev.beraternummer')).toBeNull();
    expect(zerlegeKontoSchluessel('datev.konto.skr05.kasse')).toBeNull();
  });
});

describe('Vorschlag oder bestätigt — das ehrliche Merkmal', () => {
  it('nennt ohne gespeicherte Zeile JEDES Konto einen Vorschlag', async () => {
    const plan = await ladeKontenplan(db({}), 'SKR04');
    expect(plan.eintraege.every((e) => e.herkunft === 'VORSCHLAG')).toBe(true);
    expect(konto(plan, 'kasse')).toBe('1600');
  });

  it('nennt genau die gespeicherte Zeile bestätigt, und nur sie', async () => {
    const plan = await ladeKontenplan(db({ 'datev.konto.skr03.kasse': '1010' }), 'SKR03');
    const kasse = plan.eintraege.find((e) => e.konto === 'kasse');
    expect(kasse?.wert).toBe('1010');
    expect(kasse?.herkunft).toBe('BESTAETIGT');
    // Die Vorlagezahl bleibt sichtbar, damit der Inhaber zurückkann.
    expect(kasse?.vorlagewert).toBe('1000');
    expect(plan.eintraege.filter((e) => e.herkunft === 'BESTAETIGT')).toHaveLength(1);
    expect(konto(plan, 'kasse')).toBe('1010');
    expect(konto(plan, 'wareneingang')).toBe('3200');
  });

  it('behandelt eine leere Zeile wie keine Zeile', async () => {
    // Sonst wäre eine versehentlich geleerte Einstellung ein „bestätigtes"
    // leeres Konto, und der Buchungsstapel trüge ein leeres Feld 7.
    const plan = await ladeKontenplan(db({ 'datev.konto.skr03.kasse': '  ' }), 'SKR03');
    const kasse = plan.eintraege.find((e) => e.konto === 'kasse');
    expect(kasse?.wert).toBe('1000');
    expect(kasse?.herkunft).toBe('VORSCHLAG');
  });
});

describe('der Rahmen', () => {
  it('nimmt jede Schreibweise', () => {
    for (const roh of ['SKR03', 'skr03', '03', '3']) expect(normalisiereRahmen(roh)).toBe('SKR03');
    for (const roh of ['SKR04', 'skr04', '04', '4']) expect(normalisiereRahmen(roh)).toBe('SKR04');
  });

  it('weist einen unbekannten Rahmen auf Deutsch ab, nicht mit einem 500', () => {
    try {
      normalisiereRahmen('SKR42');
      expect.unreachable('haette werfen muessen');
    } catch (e) {
      expect(e).toBeInstanceOf(DatevEinstellungError);
      expect((e as DatevEinstellungError).httpStatus).toBe(400);
      expect((e as Error).message).toContain('SKR03 und SKR04');
    }
  });
});

describe('was gespeichert werden darf', () => {
  it('nimmt eine Kontonummer und lehnt Unsinn ab', () => {
    expect(pruefeKontonummer('8400')).toBe('8400');
    expect(pruefeKontonummer(' 12345 ')).toBe('12345');
    for (const schlecht of ['', '123', '123456789', '84a0', '0000', 'Kasse']) {
      expect(() => pruefeKontonummer(schlecht), schlecht).toThrow(DatevEinstellungError);
    }
  });

  it('prüft jede der sechs Mandantenangaben', () => {
    expect(pruefeDatevEinstellung('datev.beraternummer', 29098)).toEqual({
      art: 'zahl',
      wert: 29098,
    });
    expect(pruefeDatevEinstellung('datev.mandantennummer', '55003')).toEqual({
      art: 'zahl',
      wert: 55003,
    });
    expect(pruefeDatevEinstellung('datev.sachkontenlaenge', 4)).toEqual({ art: 'zahl', wert: 4 });
    expect(pruefeDatevEinstellung('datev.festschreibung', false)).toEqual({
      art: 'jaNein',
      wert: false,
    });
    expect(pruefeDatevEinstellung('datev.wirtschaftsjahr_beginn', '2026-01-01')).toEqual({
      art: 'text',
      wert: '2026-01-01',
    });
    expect(pruefeDatevEinstellung('datev.sachkontenrahmen', 'skr04')).toEqual({
      art: 'text',
      wert: 'SKR04',
    });
    expect(pruefeDatevEinstellung('datev.konto.skr04.kasse', '1600')).toEqual({
      art: 'text',
      wert: '1600',
    });
  });

  it('lehnt ab, was die Kopfzeile nicht tragen kann', () => {
    // Genau die Grenzen, die `baueKopfzeile` in datev-format.ts prüft. Würden
    // sie hier fehlen, käme der Fehler erst beim Erzeugen der Datei.
    expect(() => pruefeDatevEinstellung('datev.beraternummer', 999)).toThrow(DatevEinstellungError);
    expect(() => pruefeDatevEinstellung('datev.beraternummer', 12345678)).toThrow(
      DatevEinstellungError,
    );
    expect(() => pruefeDatevEinstellung('datev.mandantennummer', 0)).toThrow(DatevEinstellungError);
    expect(() => pruefeDatevEinstellung('datev.sachkontenlaenge', 3)).toThrow(DatevEinstellungError);
    expect(() => pruefeDatevEinstellung('datev.sachkontenlaenge', 9)).toThrow(DatevEinstellungError);
    expect(() => pruefeDatevEinstellung('datev.wirtschaftsjahr_beginn', '01.01.2026')).toThrow(
      DatevEinstellungError,
    );
    expect(() => pruefeDatevEinstellung('datev.festschreibung', 'vielleicht')).toThrow(
      DatevEinstellungError,
    );
  });

  it('lässt sich keinen fremden Schlüssel unterschieben', () => {
    // Der Weg schreibt NUR datev-Schlüssel. Sonst wäre er ein allgemeiner
    // Schreibzugriff auf system_settings, vorbei an der Erlaubnisliste.
    for (const fremd of ['shop.name', 'anomaly.sigma_threshold', 'datev.unbekannt']) {
      expect(() => pruefeDatevEinstellung(fremd, '1'), fremd).toThrow(DatevEinstellungError);
    }
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⛔ VIER STELLEN TRAGEN EIN KONTO, NUR DREI ERZWINGT DER TYPPRÜFER
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── AM 06.08.2026 SELBST HINEINGELAUFEN ─────────────────────────────────
 *
 * Ein neues Konto (`geldtransit`) wurde in `KontoId`, `VORLAGE_SKR03`,
 * `VORLAGE_SKR04` und `QUELLE` eingetragen. Diese vier sind über
 * `Record<KontoId, …>` typisiert, der Typprüfer hat also drei davon
 * eingefordert.
 *
 * `KONTO_DEFINITIONEN` ist ein ARRAY. Es fehlte, der Typprüfer schwieg — und
 * `baueKontenplan` läuft über genau dieses Array. Das Konto landete deshalb
 * NIE in `plan.werte`, und `konto(plan, 'geldtransit')` gab `undefined`
 * zurück. In der erzeugten Datei hätte an der Stelle des Sachkontos NICHTS
 * gestanden.
 *
 * Gefunden hat es ein Test, der die erzeugte Zeile ansah. Diese Zusage findet
 * es beim nächsten Mal sofort.
 */
describe('⛔ jedes Konto ist an ALLEN vier Stellen eingetragen', () => {
  it('KONTO_DEFINITIONEN kennt jedes Konto der Vorlagen', () => {
    const definiert = new Set(KONTO_DEFINITIONEN.map((d) => d.id));
    const ausVorlage = Object.keys(SKR03_WIE_ER_LIEF) as KontoId[];
    expect(
      ausVorlage.filter((id) => !definiert.has(id)),
      'diese Konten stehen in der Vorlage, aber nicht in KONTO_DEFINITIONEN — ' +
        'sie landen deshalb NIE im Kontenplan und kommen als leeres Feld heraus',
    ).toEqual([]);
  });

  it('und jedes Konto kommt im gebauten Plan mit einer Nummer heraus', () => {
    // Der eigentliche Beweis: nicht die Listen vergleichen, sondern den Plan
    // fragen. Eine leere Nummer ist genau das, was der Fehler erzeugte.
    for (const rahmen of ['SKR03', 'SKR04'] as const) {
      const plan = vorlagenplan(rahmen);
      for (const def of KONTO_DEFINITIONEN) {
        const nummer = konto(plan, def.id);
        expect(nummer, `${rahmen}: ${def.id} hat keine Nummer`).toMatch(/^\d{4}$/);
      }
    }
  });
});
