/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE STAMMDATEN DES HÄNDLERS — und warum ein leeres Feld SPERRT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die DSFinV-K verlangt in `cashpointclosing.csv` die Angaben zum
 * Steuerpflichtigen EINZELN: Firmenname, Strasse, Postleitzahl, Ort,
 * Länderkennzeichen und Steuernummer beziehungsweise USt-IdNr. Ohne sie kann
 * ein Prüfer das Paket keinem Steuerpflichtigen zuordnen.
 *
 * ── Auf Romans Produktion gemessen (28.07.2026) ──────────────────────────
 *
 *     shop.name           ""                    ← LEER
 *     shop.address_line1  "Rosenstraße 40"
 *     shop.address_line2  "73614 Schorndorf"    ← PLZ und Ort in EINEM Feld
 *     shop.tax_number     — gab es nicht —
 *     Postleitzahl, Ort, Land — gab es nicht —
 *
 * Wanderung 0126 hat die Fächer angelegt, LEER. Diese Datei liest sie und
 * sagt, was fehlt.
 *
 * ── Warum sie NICHTS erfindet ────────────────────────────────────────────
 *
 * Der bequeme Weg wäre, `shop.name` als Firmenname zu nehmen, `address_line2`
 * mit einem Muster in Postleitzahl und Ort zu zerlegen und beim Land „DEU"
 * anzunehmen.
 *
 * Das ginge in neun von zehn Fällen gut. Der zehnte fällt niemandem auf, bis
 * ein Prüfer danach fragt — und dann steht in einer fortschreibungsgeschützten
 * Aufzeichnung eine Anschrift, die niemand eingegeben hat.
 *
 * Diese Fehlerklasse hat dieses Haus schon mehrfach getroffen: DHL erfand
 * Sendungsnummern, eBay meldete ein Ende ohne Anfrage, und Wanderung 0044
 * säte `DE123456789` als „PROVISIONAL" in jede neue Mandantendatenbank.
 *
 * Ein leeres Feld sperrt den Export mit einer Meldung, die sagt, WAS zu tun
 * ist. Ein erfundenes Feld erzeugt ein Paket, das VOLLSTÄNDIG AUSSIEHT und
 * falsch ist. Das erste ist unbequem, das zweite ist ein Aufzeichnungsmangel.
 */

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

/** Die Schlüssel, wie Wanderung 0126 sie anlegt. */
export const STAMMDATEN_SCHLUESSEL = [
  'shop.legal_name',
  'shop.street',
  'shop.postal_code',
  'shop.city',
  'shop.country_code',
  'shop.tax_number',
] as const;

export interface HaendlerStammdaten {
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
  /** Steuernummer ODER USt-IdNr. — eines von beiden genügt (§ 14 Abs. 4 Nr. 2). */
  taxNumber: string;
  vatId: string;
}

export interface StammdatenBefund {
  /** Vollständig genug für ein DSFinV-K-Paket? */
  vollstaendig: boolean;
  /** Die Werte, wie sie dastehen. Leere Felder bleiben leer. */
  daten: HaendlerStammdaten;
  /** Was fehlt, in der Sprache des Inhabers. Leer, wenn nichts fehlt. */
  fehlt: string[];
}

const BESCHRIFTUNG: Record<string, string> = {
  'shop.legal_name': 'der vollständige Firmenname',
  'shop.street': 'Straße und Hausnummer',
  'shop.postal_code': 'die Postleitzahl',
  'shop.city': 'der Ort',
  'shop.country_code': 'das Länderkennzeichen (z. B. DEU)',
};

const leer = (v: string | null | undefined): boolean => v == null || v.trim() === '';

/**
 * Die Stammdaten aus den Einstellungen lesen und prüfen. Rein: der Aufrufer
 * bringt die Einstellungen mit, diese Datei kennt keine Datenbank.
 */
export function leseStammdaten(
  einstellungen: Readonly<Record<string, string | null | undefined>>,
): StammdatenBefund {
  const w = (k: string): string => (einstellungen[k] ?? '').trim();

  const daten: HaendlerStammdaten = {
    legalName: w('shop.legal_name'),
    street: w('shop.street'),
    postalCode: w('shop.postal_code'),
    city: w('shop.city'),
    countryCode: w('shop.country_code'),
    taxNumber: w('shop.tax_number'),
    vatId: w('shop.vat_id'),
  };

  const fehlt: string[] = [];
  for (const schluessel of STAMMDATEN_SCHLUESSEL) {
    if (schluessel === 'shop.tax_number') continue; // eigene Regel, siehe unten
    if (leer(einstellungen[schluessel])) fehlt.push(BESCHRIFTUNG[schluessel] ?? schluessel);
  }

  // ⚠️ Steuernummer ODER USt-IdNr. — § 14 Abs. 4 Nr. 2 UStG lässt beides zu.
  // Beide zu verlangen wäre strenger als das Gesetz und würde einen Händler
  // aussperren, der nur eines von beiden hat.
  if (leer(daten.taxNumber) && leer(daten.vatId)) {
    fehlt.push('die Steuernummer oder die USt-IdNr.');
  }

  return { vollstaendig: fehlt.length === 0, daten, fehlt };
}

/**
 * Ein DSFinV-K-Paket ohne Angabe des Steuerpflichtigen wird NICHT gebaut.
 *
 * Die Meldung nennt jedes fehlende Feld einzeln und sagt, wo es einzutragen
 * ist — ein „unvollständig" ohne nächsten Schritt führt dazu, dass jemand die
 * Datei trotzdem abgibt.
 */
export class StammdatenUnvollstaendigError extends DomainError {
  /**
   * ⚠️ 409, nicht 500.
   *
   * Der erste Entwurf erbte von `Error`. Der Fehlerbehandler prüft
   * `instanceof DomainError` und machte daraus einen „Internal server
   * error" — die
   * sorgfältig geschriebene Meldung stand nur im Serverprotokoll, und der
   * Mensch am Bildschirm las, dass etwas kaputt sei.
   *
   * Es ist aber nichts kaputt: es fehlt eine Angabe, und der Satz sagt
   * genau welche. Diese beiden Felder tragen ihn bis zum Bildschirm.
   */
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
  public readonly fehlt: readonly string[];
  public constructor(fehlt: readonly string[]) {
    super(
      `Für das Prüferpaket fehlen die Angaben zum Steuerpflichtigen: ${fehlt.join(', ')}. ` +
        `Die DSFinV-K verlangt sie einzeln, und ohne sie kann ein Prüfer das Paket ` +
        `keinem Betrieb zuordnen. Bitte unter Einstellungen → Betrieb eintragen. ` +
        `Es wurde KEINE Datei erzeugt.`,
    );
    this.fehlt = fehlt;
  }
}
