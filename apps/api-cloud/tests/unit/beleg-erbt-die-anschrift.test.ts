/**
 * Die Anschrift wird EINMAL eingetragen, nicht zweimal.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * Es gibt zwei Sätze Anschrift, und sie überschneiden sich in genau zwei
 * Feldern:
 *
 *   Bereich Betrieb, PFLICHT für das Prüferpaket:
 *     shop.legal_name, shop.street, shop.postal_code, shop.city,
 *     shop.country_code, shop.tax_number, shop.vat_id
 *
 *   Bereich Beleg, was WIRKLICH gedruckt wird:
 *     shop.name, shop.address_line1, shop.address_line2,
 *     shop.tax_number, shop.vat_id, shop.phone, shop.tagline
 *
 * Gemeinsam sind nur Steuernummer und USt-IdNr.
 *
 * Wer also nur „Betrieb" ausfüllt, hat ein gültiges DSFinV-K-Paket und einen
 * Beleg OHNE KOPF — der Kunde bekommt ein Papier ohne Absender. Wer nur
 * „Beleg" ausfüllt, hat einen schönen Beleg und einen Export, der abbricht.
 *
 * Beides sieht für den Händler wie „fertig" aus, und der Fehler zeigt sich
 * erst beim Drucken oder beim Prüfer.
 *
 * ── WARUM ERBEN UND NICHT KOPIEREN ─────────────────────────────────────────
 *
 * Ein Kopierknopf hätte zwei Wahrheiten erzeugt, die auseinanderlaufen: ändert
 * der Händler später die Strasse im Betrieb, bliebe die alte auf dem Beleg
 * stehen — und niemand merkt es, bis ein Kunde das Papier liest.
 *
 * Also ein RÜCKFALL: ist das Belegfeld leer, gilt das rechtliche. Trägt der
 * Händler auf dem Beleg etwas anderes ein — einen Geschäftsnamen, der nicht
 * die Firmierung ist — bleibt genau das stehen. Beides ist legitim, und die
 * Kasse entscheidet nicht für ihn.
 */

import { describe, expect, it } from 'vitest';

import { belegIdentitaet } from '../../src/lib/beleg-identitaet.js';

describe('Der Beleg erbt die Anschrift, statt sie zweimal zu verlangen', () => {
  it('leere Belegfelder erben die rechtlichen', () => {
    const i = belegIdentitaet({
      'shop.legal_name': 'Muster Edelmetallhandel e. K.',
      'shop.street': 'Rosenstraße 40',
      'shop.postal_code': '73614',
      'shop.city': 'Schorndorf',
    });
    expect(i.name).toBe('Muster Edelmetallhandel e. K.');
    expect(i.addressLine1).toBe('Rosenstraße 40');
    expect(i.addressLine2).toBe('73614 Schorndorf');
  });

  it('ein eigener Belegname bleibt stehen', () => {
    // ⚠️ Der Grund, warum es ein RÜCKFALL ist und keine Kopie. Ein Händler
    // darf auf dem Beleg einen Geschäftsnamen führen, der nicht seine
    // Firmierung ist. Die Kasse entscheidet das nicht für ihn.
    const i = belegIdentitaet({
      'shop.legal_name': 'Muster Edelmetallhandel e. K.',
      'shop.name': 'Goldhaus Schorndorf',
      'shop.street': 'Rosenstraße 40',
      'shop.address_line1': 'Marktplatz 2',
    });
    expect(i.name).toBe('Goldhaus Schorndorf');
    expect(i.addressLine1).toBe('Marktplatz 2');
  });

  it('Leerzeichen zählen als leer', () => {
    const i = belegIdentitaet({ 'shop.legal_name': 'Muster e. K.', 'shop.name': '   ' });
    expect(i.name).toBe('Muster e. K.');
  });

  it('halbe Angaben ergeben keine halbe Zeile mit Lücke', () => {
    // Nur Postleitzahl, keine Stadt: „73614 " mit Leerzeichen am Ende wäre
    // schlampig gedruckt. Und nur Stadt ohne Postleitzahl ebenso.
    expect(belegIdentitaet({ 'shop.postal_code': '73614' }).addressLine2).toBe('73614');
    expect(belegIdentitaet({ 'shop.city': 'Schorndorf' }).addressLine2).toBe('Schorndorf');
    expect(belegIdentitaet({}).addressLine2).toBe('');
  });

  it('ohne jede Angabe bleibt alles leer, nichts wird erfunden', () => {
    // ⚠️ Ein Rückfall darf niemals etwas HERSTELLEN. Ein erfundener
    // Belegkopf wäre schlimmer als ein fehlender: er sieht richtig aus.
    const i = belegIdentitaet({});
    expect(i.name).toBe('');
    expect(i.addressLine1).toBe('');
    expect(i.addressLine2).toBe('');
  });

  it('Steuernummer und USt-IdNr werden nicht erfunden', () => {
    // Die beiden Felder sind ohnehin gemeinsam; hier darf nichts abgeleitet
    // werden. Eine erfundene Steuernummer auf einem Beleg wäre ein Fehler mit
    // eigener Rechtsfolge.
    const i = belegIdentitaet({ 'shop.legal_name': 'Muster e. K.' });
    expect(i.vatId).toBe('');
    expect(i.taxNumber).toBe('');
  });
});
