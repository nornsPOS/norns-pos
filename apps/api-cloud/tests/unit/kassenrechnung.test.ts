/**
 * ════════════════════════════════════════════════════════════════════════
 *  Der Kassenbericht muss sich auf dem Blatt nachrechnen lassen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 05.08.2026 ───────────────────────────────────────────
 *
 * Der Abschnitt „Kasse" trug drei Zeilen: erwartet, gezählt, Differenz.
 * Anfangsbestand, Barankauf, Einlagen und Entnahmen fehlten vollständig.
 *
 * Gemessen am eigenen Kreuzprobeszenario: Anfangsbestand 1.000,00,
 * Bareinnahmen 269,29, Barankauf 500,00, erwartet 769,29. Auf dem Blatt
 * standen zwei Zahlen, 269,29 und 769,29, und dazwischen klaffte eine
 * Differenz von 500,00 EUR, die durch NICHTS auf dem Blatt erklärt war.
 *
 * Diese Prüfungen rechnen mit genau diesen Zahlen.
 */

import { describe, expect, it } from 'vitest';

import { EINGEORDNETE_BEWEGUNGSARTEN, baueKassenrechnung } from '../../src/lib/kassenrechnung.js';

/** Zeile finden, wie ein Mensch sie auf dem Blatt sucht. */
function wert(r: ReturnType<typeof baueKassenrechnung>, label: string): string | undefined {
  return r.zeilen.find((z) => z.label === label)?.value;
}

describe('Die Kassenbericht-Rechnung', () => {
  it('⚠️ DER GEMESSENE FALL: 1.000,00 Anfang, 269,29 ein, 500,00 Ankauf aus', () => {
    const r = baueKassenrechnung({
      anfangsbestandEur: '1000.00',
      bareinnahmenEur: '269.29',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '500.00',
      bewegungen: [],
      gebuchtErwartetEur: '769.29',
      gezaehltEur: '769.29',
    });

    // Alle vier Grössen stehen jetzt auf dem Blatt.
    expect(wert(r, 'Anfangsbestand (Wechselgeld)')).toBe('1000.00');
    expect(wert(r, 'Bareinnahmen')).toBe('269.29');
    expect(wert(r, 'Barauszahlung Ankauf')).toBe('-500.00');
    expect(wert(r, 'Erwarteter Endbestand')).toBe('769.29');

    // Und die Rechnung geht auf: 1000,00 + 269,29 − 500,00 = 769,29.
    expect(r.erwartetEur).toBe('769.29');
    expect(r.weichtVonGebuchtemAb).toBe(false);
    expect(wert(r, 'Differenz')).toBe('0.00');
  });

  it('⛔ und der erwartete Bestand ist die SUMME der Zeilen darüber', () => {
    // Das ist der eigentliche Zweck: ein Prüfer addiert die Zeilen und kommt
    // auf die Zahl, die darunter steht. Diese Zusage prüft genau das, ohne die
    // Rechnung nachzubauen.
    const r = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      bareinnahmenEur: '840.50',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '1200.00',
      bewegungen: [
        { direction: 'INJECTION', amountEur: '300.00' },
        { direction: 'BANK_DROP', amountEur: '250.00' },
        { direction: 'SAFE_TRANSIT', amountEur: '100.00' },
      ],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });

    const cent = (s: string): number => Math.round(Number(s) * 100);
    const bisErwartet = r.zeilen.slice(
      0,
      r.zeilen.findIndex((z) => z.label === 'Erwarteter Endbestand'),
    );
    const summe = bisErwartet.reduce((a, z) => a + cent(z.value), 0);
    expect(summe).toBe(cent(r.erwartetEur));
    // 500 + 840,50 − 1200 + 300 − 250 − 100 = 90,50
    expect(r.erwartetEur).toBe('90.50');
  });

  it('⚠️ CLOSING_RECONCILIATION ist eine Aufzeichnung, keine Bewegung', () => {
    // Sie hält beim Schichtschluss den gezählten Bestand fest. Wer sie
    // mitrechnet, zählt den Bestand ein zweites Mal.
    const ohne = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      bareinnahmenEur: '100.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bewegungen: [],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    const mit = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      bareinnahmenEur: '100.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bewegungen: [
        { direction: 'CLOSING_RECONCILIATION', amountEur: '600.00' },
      ],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    expect(mit.erwartetEur).toBe(ohne.erwartetEur);
    expect(mit.erwartetEur).toBe('600.00');
  });

  it('eine unbekannte Bewegungsart wird ÜBERGANGEN, nicht geraten', () => {
    // Käme eine neue Art hinzu, wäre ein geratenes Vorzeichen schlimmer als
    // eine fehlende Zeile. Der Wächter unten hält die Liste vollständig.
    const r = baueKassenrechnung({
      anfangsbestandEur: '0.00',
      bareinnahmenEur: '0.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bewegungen: [{ direction: 'ETWAS_NEUES', amountEur: '999.00' }],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    expect(r.erwartetEur).toBe('0.00');
  });

  it('mehrere Schichten summieren sich je Art', () => {
    const r = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      bareinnahmenEur: '0.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bewegungen: [
        { direction: 'BANK_DROP', amountEur: '50.00' },
        { direction: 'BANK_DROP', amountEur: '25.00' },
      ],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    expect(wert(r, 'Anfangsbestand (Wechselgeld)')).toBe('500.00');
    expect(wert(r, 'Entnahme zur Bank')).toBe('-75.00');
    expect(r.erwartetEur).toBe('425.00');
  });
});

describe('⛔ Barausgaben mindern die Lade', () => {
  it('⚠️ DER GEMESSENE FALL: 50,00 EUR Porto aus der Kasse', () => {
    // Bis zum 06.08.2026 hatte `operating_expenses` GAR KEINE Zahlungsart.
    // Wer Porto aus der Lade zahlte, hatte eine Ausgabe in der Liste und einen
    // Fehlbetrag in der Schublade, und nichts verband die beiden. Gemessen war
    // die Lücke genau 50,00 EUR gegen das DATEV-Konto 1000.
    const r = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      bareinnahmenEur: '200.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '50.00',
      barauszahlungAnkaufEur: '0.00',
      bewegungen: [],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    expect(wert(r, 'Barausgaben (Betriebsausgaben)')).toBe('-50.00');
    // 500 + 200 − 50 = 650
    expect(r.erwartetEur).toBe('650.00');
  });

  it('ohne Barausgabe steht die Zeile NICHT da', () => {
    // Eine ständige Null unter jedem Blatt liest sich wie eine Rubrik, die
    // niemand pflegt.
    const r = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      bareinnahmenEur: '200.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bewegungen: [],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    expect(wert(r, 'Barausgaben (Betriebsausgaben)')).toBeUndefined();
    expect(r.erwartetEur).toBe('700.00');
  });

  it('⛔ und sie steht in der Summe der Zeilen darüber', () => {
    const r = baueKassenrechnung({
      anfangsbestandEur: '100.00',
      bareinnahmenEur: '900.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '75.50',
      barauszahlungAnkaufEur: '300.00',
      bewegungen: [{ direction: 'BANK_DROP', amountEur: '200.00' }],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    const cent = (x: string): number => Math.round(Number(x) * 100);
    const bis = r.zeilen.slice(0, r.zeilen.findIndex((z) => z.label === 'Erwarteter Endbestand'));
    expect(bis.reduce((a, z) => a + cent(z.value), 0)).toBe(cent(r.erwartetEur));
    // 100 + 900 − 300 − 75,50 − 200 = 424,50
    expect(r.erwartetEur).toBe('424.50');
  });
});

describe('⛔ Eine Ausgabe ohne Zahlweg fehlt NICHT stumm', () => {
  it('das Blatt nennt sie', () => {
    const r = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      ausgabenOhneZahlweg: 3,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bareinnahmenEur: '100.00',
      bewegungen: [],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    expect(wert(r, 'Ausgaben ohne erfassten Zahlweg')).toBe('3 nicht in der Rechnung');
    // Sie ändern die Rechnung NICHT — geraten wird nichts.
    expect(r.erwartetEur).toBe('600.00');
  });

  it('gibt es keine, bleibt das Blatt still', () => {
    const r = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bareinnahmenEur: '100.00',
      bewegungen: [],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    expect(wert(r, 'Ausgaben ohne erfassten Zahlweg')).toBeUndefined();
  });
});

describe('⛔ Die Gegenprobe gegen die festgeschriebene Zahl', () => {
  it('weicht die Rechnung ab, steht BEIDES auf dem Blatt', () => {
    const r = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      bareinnahmenEur: '200.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bewegungen: [],
      // Der Abschluss hat 350,00 festgeschrieben; gerechnet sind es 700,00.
      // Genau diese 350,00 EUR waren am 05.08.2026 die unerklärte Lücke.
      gebuchtErwartetEur: '350.00',
      gezaehltEur: '350.00',
    });
    expect(r.erwartetEur).toBe('700.00');
    expect(r.weichtVonGebuchtemAb).toBe(true);
    expect(wert(r, 'Beim Abschluss festgeschrieben')).toBe('350.00');
    expect(wert(r, 'Abweichung zur Rechnung oben')).toBe('-350.00');
  });

  it('stimmt sie überein, bleibt das Blatt still', () => {
    const r = baueKassenrechnung({
      anfangsbestandEur: '500.00',
      bareinnahmenEur: '200.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bewegungen: [],
      gebuchtErwartetEur: '700.00',
      gezaehltEur: '700.00',
    });
    expect(r.weichtVonGebuchtemAb).toBe(false);
    expect(wert(r, 'Abweichung zur Rechnung oben')).toBeUndefined();
  });

  it('ohne festgeschriebene Zahl gibt es keine Gegenprobe, aber auch keine Behauptung', () => {
    const r = baueKassenrechnung({
      anfangsbestandEur: '0.00',
      bareinnahmenEur: '10.00',
      ausgabenOhneZahlweg: 0,
      barausgabenEur: '0.00',
      barauszahlungAnkaufEur: '0.00',
      bewegungen: [],
      gebuchtErwartetEur: null,
      gezaehltEur: null,
    });
    expect(r.weichtVonGebuchtemAb).toBe(false);
    expect(wert(r, 'Gezählter Endbestand')).toBe('—');
    expect(wert(r, 'Differenz')).toBeUndefined();
  });
});

describe('⛔ Der Riegel gegen eine Bewegungsart, die niemand einordnet', () => {
  it('jede Art aus dem Datenbanktyp ist hier entschieden', () => {
    /**
     * ⚠️ Der Wächter gegen die stille Lücke. Käme in `cash_movement_direction`
     * eine Art hinzu und niemand ordnete sie hier ein, würde Bargeld
     * unbemerkt an der Kassenrechnung vorbeilaufen — genau die Art Fehler, die
     * erst bei der Nachschau auffällt.
     *
     * Die Liste kommt aus dem ECHTEN Bauplan, nicht aus einer Abschrift.
     */
    const schema = new URL('../../sidecar/erststart/schema.sql', import.meta.url).pathname;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const text = require('node:fs').readFileSync(schema, 'utf8') as string;
    const m = /CREATE TYPE public\.cash_movement_direction AS ENUM \(([\s\S]*?)\);/.exec(text);
    expect(m, 'der Typ steht nicht im Bauplan').not.toBeNull();
    const arten = [...(m?.[1] ?? '').matchAll(/'(\w+)'/g)].map((x) => x[1] as string);
    expect(arten.length, 'keine Arten gelesen').toBeGreaterThan(3);

    /**
     * ⚠️ DER ERSTE ENTWURF DIESES WÄCHTERS WAR GRÜN AUS DEM FALSCHEN GRUND.
     *
     * Er prüfte den BETRAG: 111,00, −111,00 oder 0,00. Eine Art, die niemand
     * eingeordnet hat, wird von der Rechnung übergangen und ergibt 0,00 — und
     * 0,00 stand auf der Liste der erlaubten Werte. Der Wächter hätte genau
     * die Lücke durchgelassen, gegen die er steht.
     *
     * Er prüft jetzt die EINORDNUNG selbst: jede Art aus dem Bauplan muss ein
     * Schlüssel der Tabelle sein. „Bewegt die Lade nicht" ist dort ein
     * ausdrücklicher Eintrag, kein Fehlen.
     */
    const fehlend = arten.filter((a) => !EINGEORDNETE_BEWEGUNGSARTEN.includes(a));
    expect(
      fehlend,
      'diese Bewegungsarten laufen still an der Kassenrechnung vorbei',
    ).toEqual([]);

    // Und umgekehrt: kein Eintrag ohne Art im Bauplan. Ein Geist sieht aus wie
    // offene Arbeit und wird nie geprüft.
    const geister = EINGEORDNETE_BEWEGUNGSARTEN.filter((a) => !arten.includes(a));
    expect(geister, 'diese Einträge haben keine Entsprechung im Bauplan').toEqual([]);
  });
});
