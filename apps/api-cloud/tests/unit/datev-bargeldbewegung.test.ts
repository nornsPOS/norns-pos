/**
 * ════════════════════════════════════════════════════════════════════════
 *  Konto 1000 muss sich bewegen wie die Schublade
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 05.08.2026 ───────────────────────────────────────────
 *
 * Gemessener Lauf 2026-06-01: eine Barausgabe über 50,00 EUR, Wechselgeld
 * 500,00, gezählt 350,00. Die DATEV-Datei hatte FÜNF Buchungszeilen, alle aus
 * Belegen, KEINE für die Bargeldbewegung.
 *
 *     Konto 1000   +119,00 +138,00 +62,00 −300,00 −119,00 = −100,00
 *     Schublade    500,00 → 350,00                        = −150,00
 *     Lücke                                                  −50,00
 *
 * Ein Prüfer, der die Kassensturzfähigkeit rechnet, findet diese 50,00 EUR
 * und kann sie mit nichts erklären.
 */

import { describe, expect, it } from 'vitest';

import {
  BargeldbewegungNichtKontiertError,
  ENTSCHIEDENE_BEWEGUNGSARTEN,
  KONTIERTE_AUSGABENARTEN,
  baueAusgabenzeilen,
  baueBewegungszeilen,
} from '../../src/lib/datev-bargeldbewegung.js';
import { vorlagenplan } from '../../src/lib/kontenrahmen.js';

const SKR03 = vorlagenplan('SKR03');
const SKR04 = vorlagenplan('SKR04');

const bewegung = (direction: string, amountEur: string) => ({
  direction,
  amountEur,
  reason: 'Tagesabschöpfung',
  belegfeld: 'KB-2026-06-01-1',
});

describe('Bargeldbewegungen werden gebucht', () => {
  it('⚠️ eine Entnahme zur Bank: Geldtransit an Kasse', () => {
    const [z] = baueBewegungszeilen([bewegung('BANK_DROP', '300.00')], SKR03);
    expect(z).toMatchObject({
      betragEur: '300.00',
      sollkonto: '1360',
      gegenkonto: '1000',
      belegfeld1: 'KB-2026-06-01-1',
    });
    // Der Grund des Kassierers steht mit im Text; „Geldtransit" allein sagt
    // dem Berater nicht, welcher.
    expect(z?.buchungstext).toBe('Entnahme zur Bank: Tagesabschöpfung');
  });

  it('eine Entnahme in den Tresor bucht dieselbe Richtung', () => {
    const [z] = baueBewegungszeilen([bewegung('SAFE_TRANSIT', '1000.00')], SKR03);
    expect(z).toMatchObject({ sollkonto: '1360', gegenkonto: '1000' });
  });

  it('⛔ eine EINLAGE dreht Soll und Haben, nicht das Vorzeichen', () => {
    // DATEV führt die Richtung über die beiden Konten. Ein negativer Betrag
    // mit vertauschten Konten wäre dieselbe Buchung zweimal falsch.
    const [z] = baueBewegungszeilen([bewegung('INJECTION', '200.00')], SKR03);
    expect(z).toMatchObject({ betragEur: '200.00', sollkonto: '1000', gegenkonto: '1360' });
  });

  it('der Kontenrahmen entscheidet die Nummern, nicht der Quelltext', () => {
    const [z] = baueBewegungszeilen([bewegung('BANK_DROP', '300.00')], SKR04);
    expect(z).toMatchObject({ sollkonto: '1460', gegenkonto: '1600' });
  });

  it('⚠️ der Anfangsbestand wird NICHT gebucht', () => {
    // Er ist der Endbestand des Vortages und steht schon da. Eine Buchung
    // wäre eine Verdoppelung.
    expect(baueBewegungszeilen([bewegung('OPENING_FLOAT', '500.00')], SKR03)).toEqual([]);
  });

  it('⚠️ die Zählung beim Schichtschluss wird NICHT gebucht', () => {
    expect(baueBewegungszeilen([bewegung('CLOSING_RECONCILIATION', '350.00')], SKR03)).toEqual([]);
  });

  it('mehrere Bewegungen ergeben mehrere Zeilen, in ihrer Reihenfolge', () => {
    const zeilen = baueBewegungszeilen(
      [
        bewegung('OPENING_FLOAT', '500.00'),
        bewegung('BANK_DROP', '300.00'),
        bewegung('INJECTION', '50.00'),
      ],
      SKR03,
    );
    expect(zeilen).toHaveLength(2);
    expect(zeilen.map((z) => z.sollkonto)).toEqual(['1360', '1000']);
  });

  it('ein langer Grund wird auf die 60 Zeichen des Feldes gekürzt', () => {
    const [z] = baueBewegungszeilen(
      [{ ...bewegung('BANK_DROP', '1.00'), reason: 'x'.repeat(200) }],
      SKR03,
    );
    expect(z?.buchungstext.length).toBe(60);
  });
});

describe('⛔ Was NICHT still durchgeht', () => {
  it('eine unbekannte Bewegungsart bricht den Export ab', () => {
    expect(() => baueBewegungszeilen([bewegung('ETWAS_NEUES', '10.00')], SKR03)).toThrow(
      BargeldbewegungNichtKontiertError,
    );
  });

  it('und der Satz sagt, was zu tun ist', () => {
    try {
      baueBewegungszeilen([bewegung('ETWAS_NEUES', '10.00')], SKR03);
      expect.unreachable('hätte werfen müssen');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      expect(m).toContain('KEINE DATEV-Datei erzeugt');
      expect(m).toContain('Steuerberater');
    }
  });

  it('⛔ jede Art aus dem Datenbanktyp ist hier ENTSCHIEDEN', () => {
    /**
     * ⚠️ Derselbe Riegel wie in `kassenrechnung.test.ts`, und aus demselben
     * Grund: er prüft die EINORDNUNG, nicht die erzeugten Zeilen. Eine Art,
     * die niemand eingeordnet hat, erzeugt null Zeilen — und null Zeilen
     * sähen aus wie „bewusst nicht gebucht".
     */
    const schema = new URL('../../sidecar/erststart/schema.sql', import.meta.url).pathname;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const text = require('node:fs').readFileSync(schema, 'utf8') as string;
    const m = /CREATE TYPE public\.cash_movement_direction AS ENUM \(([\s\S]*?)\);/.exec(text);
    const arten = [...(m?.[1] ?? '').matchAll(/'(\w+)'/g)].map((x) => x[1] as string);
    expect(arten.length, 'keine Arten gelesen').toBeGreaterThan(3);

    expect(
      arten.filter((a) => !ENTSCHIEDENE_BEWEGUNGSARTEN.includes(a)),
      'diese Bewegungsarten sind in DATEV nicht entschieden',
    ).toEqual([]);
    expect(
      ENTSCHIEDENE_BEWEGUNGSARTEN.filter((a) => !arten.includes(a)),
      'diese Einträge haben keine Entsprechung im Bauplan',
    ).toEqual([]);
  });
});

describe('Barausgaben werden auf ihr Aufwandskonto gebucht', () => {
  const ausgabe = (kategorie: string, betragCent: number) => ({
    kategorie, betragCent, notiz: 'Briefmarken', belegfeld: 'BA-abc12345',
  });

  it('⚠️ DER GEMESSENE FALL: 50,00 EUR Porto aus der Kasse', () => {
    const [z] = baueAusgabenzeilen([ausgabe('VERSAND', 5000)], SKR03);
    expect(z).toMatchObject({
      betragEur: '50.00',
      sollkonto: '4910', // Porto
      gegenkonto: '1000', // Kasse
      belegfeld1: 'BA-abc12345',
    });
    expect(z?.buchungstext).toBe('Porto und Versand: Briefmarken');
  });

  it('jede Ausgabenart trifft ihr eigenes Konto, in BEIDEN Rahmen', () => {
    // Die Paare stammen aus ECOVIS RTS, derselben Quelle wie Kasse und Bank.
    const paare: ReadonlyArray<readonly [string, string, string]> = [
      ['MIETE', '4210', '6310'],
      ['MARKETING', '4600', '6600'],
      ['VERSAND', '4910', '6800'],
      ['BUEROMATERIAL', '4930', '6815'],
      ['REPARATUR', '4805', '6470'],
      ['GEBUEHREN', '4970', '6855'],
      ['REISEKOSTEN', '4670', '6670'],
      ['SONSTIGES', '4900', '6300'],
      // ⚠️ Der Wareneinkauf bekommt KEIN eigenes Konto: dafür gibt es
      // `wareneingang` seit jeher, und über das läuft schon der Ankauf.
      ['WARENEINKAUF', '3200', '5200'],
    ];
    for (const [art, skr03, skr04] of paare) {
      expect(baueAusgabenzeilen([ausgabe(art, 100)], SKR03)[0]?.sollkonto, art).toBe(skr03);
      expect(baueAusgabenzeilen([ausgabe(art, 100)], SKR04)[0]?.sollkonto, art).toBe(skr04);
    }
  });

  it('⛔ ganze Cent werden OHNE Gleitkomma zu Euro', () => {
    expect(baueAusgabenzeilen([ausgabe('MIETE', 1)], SKR03)[0]?.betragEur).toBe('0.01');
    expect(baueAusgabenzeilen([ausgabe('MIETE', 99)], SKR03)[0]?.betragEur).toBe('0.99');
    expect(baueAusgabenzeilen([ausgabe('MIETE', 100)], SKR03)[0]?.betragEur).toBe('1.00');
    expect(baueAusgabenzeilen([ausgabe('MIETE', 123456789)], SKR03)[0]?.betragEur).toBe('1234567.89');
  });

  it('KEIN Buchungsschlüssel: die Vorsteuer hängt am Beleg des Lieferanten', () => {
    // Ein geratener Schlüssel wäre eine erfundene Vorsteuer.
    const [z] = baueAusgabenzeilen([ausgabe('MIETE', 5000)], SKR03);
    expect(Object.keys(z ?? {})).not.toContain('taxKey');
  });
});

describe('⛔ Eine Ausgabenart ohne Konto bricht ab, statt zu raten', () => {
  const ausgabe = (kategorie: string) => ({
    kategorie, betragCent: 100, notiz: null, belegfeld: 'BA-1',
  });

  it('eine unbekannte Art wirft', () => {
    expect(() => baueAusgabenzeilen([ausgabe('ETWAS_NEUES')], SKR03)).toThrow(
      BargeldbewegungNichtKontiertError,
    );
  });

  it('⛔ jede Art aus dem Datenbanktyp HAT ein Konto', () => {
    // Waechst `expense_category`, ohne dass jemand ein Konto nachtraegt, ist
    // das ein lautes Nein statt einer stillen Fehlbuchung — dieser Test faengt
    // es beim Bauen, nicht erst beim Export.
    const schema = new URL('../../sidecar/erststart/schema.sql', import.meta.url).pathname;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const text = require('node:fs').readFileSync(schema, 'utf8') as string;
    const m = /CREATE TYPE public\.expense_category AS ENUM \(([\s\S]*?)\);/.exec(text);
    const arten = [...(m?.[1] ?? '').matchAll(/'(\w+)'/g)].map((x) => x[1] as string);
    expect(arten.length, 'keine Arten gelesen').toBeGreaterThan(5);
    expect(
      arten.filter((a) => !KONTIERTE_AUSGABENARTEN.includes(a)),
      'diese Ausgabenarten haben kein Aufwandskonto',
    ).toEqual([]);
    expect(
      KONTIERTE_AUSGABENARTEN.filter((a) => !arten.includes(a)),
      'diese Eintraege haben keine Entsprechung im Bauplan',
    ).toEqual([]);
  });
});
