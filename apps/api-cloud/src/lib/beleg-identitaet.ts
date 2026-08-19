/**
 * Die Identität, die auf dem Beleg steht — abgeleitet, nicht doppelt verlangt.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * Es gibt zwei Sätze Anschrift, die sich in genau zwei Feldern überschneiden:
 *
 *   Betrieb, PFLICHT für das Prüferpaket:
 *     shop.legal_name, shop.street, shop.postal_code, shop.city,
 *     shop.country_code, shop.tax_number, shop.vat_id
 *
 *   Beleg, was WIRKLICH gedruckt wird:
 *     shop.name, shop.address_line1, shop.address_line2,
 *     shop.tax_number, shop.vat_id, shop.phone, shop.tagline
 *
 * Wer nur „Betrieb" ausfüllt, hat ein gültiges DSFinV-K-Paket und einen Beleg
 * OHNE KOPF: der Kunde bekommt ein Papier ohne Absender. Wer nur „Beleg"
 * ausfüllt, hat einen schönen Beleg und einen Export, der abbricht. Beides
 * sieht wie „fertig" aus.
 *
 * ── WARUM RÜCKFALL UND NICHT KOPIE ─────────────────────────────────────────
 *
 * Ein Kopierknopf erzeugte zwei Wahrheiten, die auseinanderlaufen: ändert der
 * Händler später die Strasse im Betrieb, bliebe die alte auf dem Beleg stehen
 * — und niemand merkt es, bis ein Kunde das Papier liest.
 *
 * Also: ist das Belegfeld leer, gilt das rechtliche. Trägt der Händler auf dem
 * Beleg etwas anderes ein — einen Geschäftsnamen, der nicht die Firmierung ist
 * — bleibt genau das stehen. Beides ist legitim, und die Kasse entscheidet
 * nicht für ihn.
 *
 * ⚠️ UND EIN RÜCKFALL STELLT NIE ETWAS HER. Fehlen beide Sätze, bleibt das
 * Feld leer. Ein erfundener Belegkopf wäre schlimmer als ein fehlender: er
 * sieht richtig aus.
 */

export interface BelegIdentitaet {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  taxNumber: string;
  phone: string;
}

function w(m: Readonly<Record<string, string | null | undefined>>, k: string): string {
  return (m[k] ?? '').trim();
}

/** Der erste nicht leere Wert, oder eine leere Zeichenkette. */
function ersterVon(...werte: string[]): string {
  return werte.find((v) => v !== '') ?? '';
}

export function belegIdentitaet(
  einstellungen: Readonly<Record<string, string | null | undefined>>,
): BelegIdentitaet {
  const e = einstellungen;

  // Die Ortszeile aus Postleitzahl und Stadt. ⚠️ Beide einzeln behandeln:
  // „73614 " mit Leerzeichen am Ende wäre schlampig gedruckt, und genau so
  // sähe eine naive Verkettung aus, wenn die Stadt fehlt.
  const ort = [w(e, 'shop.postal_code'), w(e, 'shop.city')].filter((s) => s !== '').join(' ');

  return {
    name: ersterVon(w(e, 'shop.name'), w(e, 'shop.legal_name')),
    tagline: w(e, 'shop.tagline'),
    addressLine1: ersterVon(w(e, 'shop.address_line1'), w(e, 'shop.street')),
    addressLine2: ersterVon(w(e, 'shop.address_line2'), ort),
    // ⚠️ Hier wird NICHTS abgeleitet. Die beiden Felder sind ohnehin
    // gemeinsam, und eine erfundene Steuernummer auf einem Beleg wäre ein
    // Fehler mit eigener Rechtsfolge (§ 14 UStG).
    vatId: w(e, 'shop.vat_id'),
    taxNumber: w(e, 'shop.tax_number'),
    phone: w(e, 'shop.phone'),
  };
}
