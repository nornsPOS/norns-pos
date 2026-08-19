/**
 * Ein Storno auf einen Beleg eines FRÜHEREN Tages darf den Tag nicht sperren.
 *
 * ── DER FUND (26.07.2026) ──────────────────────────────────────────────────
 * Wanderung 0011 widerspricht sich in derselben Datei:
 *
 *   Zeile  72:  -- Money totals (net of storno via the negative-amount arithmetic)
 *   Zeile 152:  -- Gross totals are always non-negative
 *
 * Der Tagesabschluss summierte
 *
 *   SUM(total_eur) FILTER (WHERE direction = 'VERKAUF')
 *
 * und zählte damit die negativen Stornozeilen mit, während die Datenbank per
 * CHECK `daily_closings_gross_non_negative` einen negativen Brutto verbietet.
 * Die Stückzahlen daneben schlossen den Storno korrekt aus, die Summen nicht.
 *
 * Solange Beleg und Storno am selben Tag liegen, heben sich +X und −X auf.
 * Es gibt aber KEINE Regel, die einen Storno auf den Tag seines Belegs
 * beschränkt. Bringt eine Kundin am Dienstag ein Stück zurück, das sie vorige
 * Woche gekauft hat, trägt der Dienstag −3.000 ohne die zugehörigen +3.000.
 * Liegt der Tagesumsatz darunter, ist der Brutto negativ, der INSERT scheitert,
 * und der Tag lässt sich NIE abschliessen — ohne Z-Bon-Zeile liefern DATEV,
 * Kassenbericht und DSFinV-K für diesen Tag dann gar nichts.
 *
 * ── WARUM DIESER TEST SO AUSSIEHT ──────────────────────────────────────────
 * Der Fehler sitzt in einer SQL-Anweisung, und SQL sieht kein Typprüfer an.
 * Statt eine Datenbank hochzufahren, prüft dieser Wächter die ZWEI Merkmale,
 * an denen der Fehler hängt, direkt am Quelltext: dass jede Geldsumme des
 * Abschlusses den Storno ausschliesst, und dass der Betrag stattdessen eine
 * eigene Spalte bekommt. Beides ist mit einem `grep` widerlegbar und damit
 * ehrlicher als ein Test, der eine Datenbank nachbaut, die es hier nicht gibt.
 *
 * Die Rechnung selbst prüft der zweite Teil: sie ist reine Zeichenkettenarbeit
 * in ganzen Cent und braucht keine Datenbank.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildKassenberichtRows } from '../../src/lib/kassenbericht-export.js';

const FINALIZE = new URL('../../src/routes/closings-finalize.ts', import.meta.url).pathname;

describe('der Abschluss trennt Umsatz und Storno', () => {
  const quelle = readFileSync(FINALIZE, 'utf8');

  it('liest ueberhaupt die richtige Datei', () => {
    expect(quelle).toContain('daily_closings');
    expect(quelle.length).toBeGreaterThan(5000);
  });

  it('JEDE Geldsumme des Tages schliesst die Stornozeilen aus', () => {
    // Die vier Summen, die in gross_/net_ landen. Jede muss den Storno
    // ausschliessen; sonst kann der Brutto negativ werden.
    const summen = [...quelle.matchAll(/COALESCE\(SUM\((total_eur|subtotal_eur)\)\s+FILTER \(WHERE direction = '(VERKAUF|ANKAUF)'([^)]*)\)/g)];
    expect(summen.length).toBeGreaterThanOrEqual(4);

    const ohneAusschluss = summen
      .filter((m) => !m[3]?.includes('storno_of_transaction_id IS NULL'))
      .map((m) => m[0].replace(/\s+/g, ' '));
    expect(ohneAusschluss).toEqual([]);
  });

  it('der Stornobetrag bekommt eine EIGENE Spalte, er verschwindet nicht', () => {
    // Der Betrag darf nicht einfach wegfallen: BFH 29.07.2025, X R 23-24/21,
    // Leitsatz 1 — ein System, das Stornierungen zulaesst und sie im
    // Tagesabschluss nicht ausweist, begruendet eine Schaetzungsbefugnis.
    expect(quelle).toContain('storno_verkauf');
    expect(quelle).toContain('storno_ankauf');
    expect(quelle).toContain('storno_verkauf_eur');
  });

  it('der Stornobetrag wird als POSITIVE Groesse gefuehrt', () => {
    // `-SUM(...)` dreht das Vorzeichen der negativen Stornozeilen um.
    expect(quelle).toMatch(/-SUM\(total_eur\)\s+FILTER \(WHERE direction = 'VERKAUF'[^)]*storno_of_transaction_id IS NOT NULL\)/);
  });
});

describe('der Kassenbericht zeigt den Storno mit BETRAG', () => {
  const eingabe = {
    businessDay: '2026-05-29',
    state: 'FINALIZED' as const,
    verkaufCount: 4,
    ankaufCount: 1,
    stornoCount: 1,
    grossVerkaufEur: '1500.00',
    grossAnkaufEur: '600.00',
    netVerkaufEur: '1260.50',
    netAnkaufEur: '600.00',
    stornoVerkaufEur: '3000.00',
    rueckgabeVerkaufEur: '0.00',
    rueckgabeCount: 0,
    stornoAnkaufEur: '0.00',
    vatByTreatment: {},
    paymentsByMethod: {},
    // Dieser Test prüft den Umsatzblock, nicht „Kasse" — leer ist hier
    // wahr, kein Platzhalter (07.08.2026, Wanderung der Kassenrechnung).
    bargeldbewegungen: [],
    ausgabenOhneZahlweg: 0,
    barausgabenEur: '0.00',
    anfangsbestandEur: '0.00',
    barauszahlungAnkaufEur: '0.00',
    cashExpectedEur: null,
    cashCountedEur: null,
    // 0124: Z_NR ist eine FOLGE. Ohne sie wird kein Paket gebaut.
    zNr: '1',
    cashVarianceEur: null,
    tseFinishedCount: 0,
    tsePendingCount: 0,
    tseFailedCount: 0,
    finalizedAt: null,
  };

  it('nennt den stornierten Betrag, nicht nur die Anzahl', () => {
    const zeilen = buildKassenberichtRows(eingabe).flatMap((s) => s.rows);
    const storno = zeilen.find((r) => r.label === 'davon storniert');
    expect(storno?.value).toBe('3000,00 EUR');
  });

  it('rechnet den Umsatz nach Storno in ganzen Cent, auch wenn er negativ wird', () => {
    // Genau der Fall, der den Tag frueher unabschliessbar machte: mehr
    // Storno als Umsatz. Der Bericht darf das zeigen, die Spalte gross_ nicht
    // mehr negativ werden.
    const zeilen = buildKassenberichtRows(eingabe).flatMap((s) => s.rows);
    const nach = zeilen.find((r) => r.label === 'Verkauf brutto nach Storno und Rücknahme');
    expect(nach?.value).toBe('-1500,00 EUR');
  });

  it('verliert keinen Cent bei krummen Betraegen', () => {
    const zeilen = buildKassenberichtRows({
      ...eingabe,
      grossVerkaufEur: '1234.30',
      stornoVerkaufEur: '0.10',
      rueckgabeVerkaufEur: '0.00',
      rueckgabeCount: 0,
    }).flatMap((s) => s.rows);
    const nach = zeilen.find((r) => r.label === 'Verkauf brutto nach Storno und Rücknahme');
    // In Fliesskomma waere das 1234,1999999999998.
    expect(nach?.value).toBe('1234,20 EUR');
  });
});
