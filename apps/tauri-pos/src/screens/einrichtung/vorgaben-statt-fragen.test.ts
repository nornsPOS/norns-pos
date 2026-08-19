/**
 * ⛔ VORGABEN STATT FRAGEN — und die Grenze, die das traegt
 *
 * Basels Anweisung vom 18.08.2026: sinnvolle, belegte Vorgaben statt einer
 * Fragenflut; gefragt wird nur das wirklich Notwendige. Die Umsetzung folgt
 * der Hausregel vom 12.08.: VORSCHLAG JA, STILLE VORGABE NEIN.
 *
 * Dieser Waechter pinnt BEIDE Seiten:
 *
 *   1. Was vorgeschlagen wird, stammt aus belegten Quellen (der amtlich
 *      gegengepruefte Hausstandard, dieselbe Datei wie in der
 *      SteuerberaterSection) und aus nichts anderem.
 *   2. Was NIE vorgeschlagen werden darf, bleibt drausse: ein geratener
 *      Steuerstatus ist nach § 14c UStG geschuldete Steuer, ein geratenes
 *      Gueltigkeitsdatum macht aeltere Belege im Buchungsstapel falsch
 *      (Befund vom 11.08.2026), und wer verantwortet, sagt der Betrieb.
 */

import { describe, expect, it } from 'vitest';

import { HAUSSTANDARD_DSFINVK } from '../../lib/hausstandard-dsfinvk.js';
import { alleSchluessel, vorschlaegeFuerLeereFelder } from './einrichtungs-schritte.js';

describe('⛔ Vorgaben statt Fragen', () => {
  const HEUTE = '2026-08-18';
  const vorschlaege = vorschlaegeFuerLeereFelder(HEUTE);

  it('⛔ jeder Vorschlag hat eine belegte Quelle, keiner ist erfunden', () => {
    for (const [schluessel, wert] of Object.entries(vorschlaege)) {
      if (schluessel === 'shop.country_code') {
        expect(wert).toBe('DEU'); // deutsches Kassenrecht, § 146a AO
      } else if (schluessel === 'betrieb.inbetriebnahme_am') {
        expect(wert).toBe(HEUTE); // der Tag, an dem der Assistent laeuft
      } else {
        // Alles andere kommt WOERTLICH aus dem Hausstandard, derselben
        // Datei, die auch die SteuerberaterSection anbietet. Ein dritter
        // Wert waere die Drift, gegen die die gemeinsame Quelle gebaut ist.
        expect(
          (HAUSSTANDARD_DSFINVK as Record<string, string>)[schluessel],
          `${schluessel} ist kein Hausstandard-Wert`,
        ).toBe(wert);
      }
    }
  });

  it('⛔ die giftigen Felder bekommen NIE einen Vorschlag', () => {
    // Genau die Felder, deren Raten schon einmal teuer war oder waere.
    for (const verboten of [
      'steuer.modus',
      'steuer.modus_gilt_ab',
      'betrieb.verantwortlich_aufzeichnungen',
      'betrieb.geldwaeschebeauftragter',
      'shop.legal_name',
      'kasse.seriennummer',
    ]) {
      expect(vorschlaege[verboten], `${verboten} wird vorgeschlagen — das ist Raten`).toBeUndefined();
    }
  });

  it('jeder vorgeschlagene Schluessel existiert wirklich im Assistenten', () => {
    // Ein Vorschlag fuer ein Feld, das keine Flaeche traegt, waere ein
    // Schreiben ins Nichts — die Klasse, die shop.email am 09.08. fast war.
    const bekannt = new Set(alleSchluessel());
    for (const schluessel of Object.keys(vorschlaege)) {
      expect(bekannt.has(schluessel), `${schluessel} hat kein Feld im Assistenten`).toBe(true);
    }
  });

  it('das Datum wandert durch, unveraendert', () => {
    expect(vorschlaegeFuerLeereFelder('2027-01-02')['betrieb.inbetriebnahme_am']).toBe('2027-01-02');
  });
});
