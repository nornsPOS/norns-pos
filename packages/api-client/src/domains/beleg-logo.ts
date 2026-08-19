/**
 * Das Beleg-Logo des Haendlers — Klient zu den Server-Wegen aus dem Dekret
 * vom 26.07.2026 (Wanderung 0119, apps/api-cloud/src/routes/beleg-logo.ts):
 *
 *   lesen()      — GET    /api/shop-info    (jeder Angemeldete; der Weg, den
 *                                            die Kasse fuer den Belegkopf
 *                                            ohnehin zieht — Logo inklusive,
 *                                            kein zweiter Rundgang)
 *   hochladen()  — POST   /api/beleg-logo   (Inhaber: ADMIN + Stufenanhebung)
 *   loeschen()   — DELETE /api/beleg-logo   (Inhaber: zurueck zur Vorgabe)
 *
 * ── EHRLICHKEIT ────────────────────────────────────────────────────────────
 * `hochladen` gibt `entfernt` zurueck: was die SVG-Waesche des Servers aus
 * der Datei gestrichen hat (Script, on*-Attribute, foreignObject, fremde
 * Verweise). Eine Oberflaeche soll das dem Inhaber SAGEN, statt still ein
 * anderes Bild zu speichern als das, das er hochgeladen hat.
 *
 * Gespeichert und zurueckgegeben wird immer das BEREINIGTE Original. Ohne
 * eigenes Logo ist `logo` null — die Kasse druckt dann die dezente
 * norns.de-Systemzeile, NIE ein fremdes Logo.
 */

import type { ApiClient } from '../client.js';

export type BelegLogoFormat = 'svg' | 'png' | 'jpeg';

export interface BelegLogo {
  format: BelegLogoFormat;
  /** Das bereinigte Original, base64 (hoechstens 256 KB entschluesselt). */
  dataBase64: string;
  hochgeladenAm: string;
}

/** Die Antwort von GET /api/shop-info — Belegkopf samt Logo. */
export interface ShopIdentitaet {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  taxNumber: string;
  phone: string;
  /** null: kein eigenes Logo, die Kasse druckt die norns.de-Systemzeile. */
  logo: BelegLogo | null;
}

export interface BelegLogoHochladenBody {
  format: BelegLogoFormat;
  dataBase64: string;
}

export interface BelegLogoHochladenResponse {
  format: string;
  /** Groesse des GESPEICHERTEN (bereinigten) Originals in Bytes. */
  sizeBytes: number;
  hochgeladenAm: string;
  /** Was die SVG-Waesche entfernt hat — dem Inhaber anzeigen. */
  entfernt: string[];
}

export interface BelegLogoLoeschenResponse {
  /** false, wenn gar kein Logo gespeichert war. */
  geloescht: boolean;
}

export const belegLogoApi = {
  /**
   * GET /api/shop-info — Belegkopf samt Logo, ein Rundgang.
   *
   * ⚠️ Seit dem 26.07.2026 antwortet der Server mit 409, wenn der Ladenname
   * nicht gepflegt ist („Ladenname nicht gepflegt — Einstellungen → Laden.“)
   * — er erfindet KEINEN Namen mehr. Die Oberflaeche zeigt die Meldung und
   * fuehrt in die Einstellungen, statt still zu drucken.
   */
  lesen(client: ApiClient): Promise<ShopIdentitaet> {
    return client.request<ShopIdentitaet>('GET', '/api/shop-info');
  },

  /** POST /api/beleg-logo — Logo setzen (ADMIN + Stufenanhebung). */
  hochladen(client: ApiClient, body: BelegLogoHochladenBody): Promise<BelegLogoHochladenResponse> {
    return client.request<BelegLogoHochladenResponse>('POST', '/api/beleg-logo', body);
  },

  /** DELETE /api/beleg-logo — zurueck zur Vorgabe (ADMIN + Stufenanhebung). */
  loeschen(client: ApiClient): Promise<BelegLogoLoeschenResponse> {
    return client.request<BelegLogoLoeschenResponse>('DELETE', '/api/beleg-logo');
  },
};
