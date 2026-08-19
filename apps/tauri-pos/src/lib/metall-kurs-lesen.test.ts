/**
 * Der Goldpreis im Kursstreifen war um das ZEHNTAUSENDFACHE zu hoch.
 *
 * ── DER FUND VOM 04.08.2026 ────────────────────────────────────────────────
 *
 * ⚠️ Auf dem Werkstattbild der laufenden Kasse stand:
 *
 *       GOLD 1138664,00 €/g        SILBER 16654,00 €/g
 *
 * Gold kostet nicht 1,1 Millionen Euro je Gramm. Der Motor hatte an dem Tag
 * 113,8664 EUR/g gezogen und genau das auch gespeichert. Verloren ging es
 * beim LESEN.
 *
 * ── DIE URSACHE ────────────────────────────────────────────────────────────
 *
 * `normalizeDecimal` ist ein Parser fuer MENSCHENTIPP. Er kennt das deutsche
 * Komma, Tausenderpunkte und Vertipper, und wenn beides moeglich ist, raet er.
 * Seine Regel bei einem einzelnen Punkt lautet: stehen dahinter mehr Stellen
 * als erlaubt (Vorgabe zwei), dann war es ein TAUSENDERPUNKT.
 *
 *       normalizeDecimal('113.8664')  →  '1138664'
 *
 * Fuer einen Menschen, der „1.234" tippt, ist das richtig. Fuer eine Zahl aus
 * der Datenbank ist es falsch: die kommt IMMER mit Punkt als Dezimaltrenner
 * und NIE mit Tausenderpunkten. Und Metallkurse tragen vier Nachkommastellen,
 * weil ein Gramm Silber sonst auf null Cent fiele.
 *
 * Die Schreibstelle wusste es (`Kurse.tsx` normalisiert mit 4). Die beiden
 * Lesestellen wussten es nicht. Zwei Listen, die driften, zum wiederholten
 * Mal in diesem Haus.
 *
 * ── WARUM DAS SCHWER WIEGT ─────────────────────────────────────────────────
 *
 * Basels Laden handelt mit Edelmetall. Der Kursstreifen steht ueber JEDEM
 * Bildschirm und ist die Zahl, an der der Haendler den Ankauf abschaetzt.
 * Ein Faktor zehntausend darin ist kein Schoenheitsfehler.
 *
 * ── DIE HEILUNG ────────────────────────────────────────────────────────────
 *
 * Nicht „mehr Stellen erlauben", sondern den richtigen Parser nehmen: eine
 * Zahl vom Server wird NICHT geraten. Damit faellt die ganze Klasse, nicht
 * nur der Fall Gold.
 */

import { describe, expect, it } from 'vitest';

import { zahlVomServer } from './decimal.js';
import { formatMetalTick } from './metal-tick.js';

describe('Ein Kurs aus dem Motor wird gelesen, nicht geraten', () => {
  it('⛔ vier Nachkommastellen bleiben vier Nachkommastellen', () => {
    // Genau die Werte, die der Motor am 04.08.2026 gezogen hat.
    expect(zahlVomServer('113.8664')).toBeCloseTo(113.8664, 6);
    expect(zahlVomServer('1.6641')).toBeCloseTo(1.6641, 6);
    expect(zahlVomServer('48.4425')).toBeCloseTo(48.4425, 6);
    expect(zahlVomServer('38.1677')).toBeCloseTo(38.1677, 6);
  });

  it('⛔ der Kursstreifen zeigt Gold nicht als Millionenbetrag', () => {
    // Der Satz, der Basels Bild festhaelt.
    const tick = formatMetalTick('113.8664', '113.0000');
    expect(tick.price).toBe('113,87');
    expect(tick.price).not.toContain('1138664');
  });

  it('⛔ auch Silber bleibt bei einem Euro und nicht bei sechzehntausend', () => {
    const tick = formatMetalTick('1.6641', '1.6000');
    expect(tick.price).toBe('1,66');
  });

  it('die Richtung und der Abstand stimmen weiterhin', () => {
    // Die Heilung darf den Rest nicht verbiegen: von 113,00 auf 113,8664
    // sind es +0,8 Prozent, und das ist ein Anstieg.
    const tick = formatMetalTick('113.8664', '113.0000');
    expect(tick.tone).toBe('up');
    expect(tick.deltaLabel).toBe('+0,8 %');
  });

  it('zwei Nachkommastellen gehen weiterhin durch', () => {
    // Sonst waere die Heilung eine neue Krankheit.
    expect(formatMetalTick('113.86', null).price).toBe('113,86');
    expect(zahlVomServer('2149.00')).toBeCloseTo(2149, 6);
    expect(zahlVomServer('0')).toBe(0);
  });

  it('⛔ was KEINE Serverzahl ist, wird auch keine', () => {
    // Ein deutscher Tipp gehoert in `normalizeDecimal`, nicht hierher. Wer ihn
    // hier hineinreicht, bekommt nichts, statt eine falsche Zahl zu bekommen.
    for (const unfug of ['1.234,56', '113,8664', '', '   ', 'abc', '1.2.3']) {
      expect(zahlVomServer(unfug), unfug).toBeNull();
    }
    expect(zahlVomServer(null)).toBeNull();
    expect(zahlVomServer(undefined)).toBeNull();
  });

  it('ein unbekannter Kurs bleibt ein Strich, keine Null', () => {
    // Eine Null waere eine Behauptung: „Gold kostet nichts."
    expect(formatMetalTick(null, null).price).toBe('-');
    expect(formatMetalTick('abc', null).price).toBe('-');
  });
});
