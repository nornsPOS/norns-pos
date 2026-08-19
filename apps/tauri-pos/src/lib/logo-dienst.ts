/**
 * logo-dienst — der Weg des Haendler-Logos zwischen Kasse und Server.
 *
 * Der Vertrag ist `belegLogoApi` (packages/api-client, Eincheck 39ae6dc):
 *
 *   lesen()     — GET  /api/shop-info: Belegkopf SAMT `logo` (das bereinigte
 *                 Original als base64 + Format), ein Rundgang.
 *   hochladen() — POST /api/beleg-logo (ADMIN + Stufenanhebung). Die Antwort
 *                 nennt ehrlich, was die SVG-Waesche entfernt hat.
 *   loeschen()  — DELETE /api/beleg-logo.
 *
 * FEATURE-ERKENNUNG UEBER DIE ANTWORT, nicht ueber Raten: `/api/shop-info`
 * gibt es auch auf einer aelteren Produktion — dort traegt die Antwort aber
 * KEIN `logo`-Feld. `'logo' in antwort` unterscheidet den alten Server vom
 * neuen; ein 404 auf POST/DELETE sagt dasselbe fuer die Schreibwege.
 *
 * Seit 26.07. antwortet der neue Server mit 409, wenn der Ladenname nicht
 * gepflegt ist („Ladenname nicht gepflegt") — er erfindet keinen mehr. Das
 * ist ein EIGENER Zustand: der Logo-Weg existiert, aber erst muessen die
 * Geschaeftsdaten stehen.
 *
 * OFFLINE: jedes erfolgreich gelesene Logo landet im logo-lager
 * (localStorage), jedes Entfernen loescht es dort — so behaelt ein Bon ohne
 * Netz sein Logo, und nach einem Entfernen taucht es nicht wieder auf. Die
 * GROESSENSTUFE lebt NUR lokal: der Server traegt keine (siehe
 * `beleg_logo`, Wanderung 0119).
 */

import { ApiError, belegLogoApi } from '@norns/api-client';
import type { ApiClient, BelegLogoFormat, ShopIdentitaet } from '@norns/api-client';

import { type GespeichertesLogo, logoEntfernen, logoLaden, logoSpeichern } from './logo-lager.js';
import type { LogoStufe } from './logo-werk.js';

export type LogoAbruf =
  /** Der Server hat geantwortet; `logo` ist null, wenn keines gesetzt ist. */
  | { status: 'verfuegbar'; logo: GespeichertesLogo | null }
  /** Server ohne Logo-Weg — aeltere Produktion vor dem Server-Update. */
  | { status: 'alterServer'; logo: GespeichertesLogo | null }
  /** 409: der Ladenname ist nicht gepflegt — erst Geschaeftsdaten speichern. */
  | { status: 'keinName'; logo: GespeichertesLogo | null }
  /** Netz oder Server nicht erreichbar — es gilt der lokale Zwischenspeicher. */
  | { status: 'offline'; logo: GespeichertesLogo | null };

/** Die Server-Antwort ins Lager heben; die Stufe bleibt die lokal gewaehlte. */
function uebernehmen(antwort: ShopIdentitaet): GespeichertesLogo | null {
  const logo = antwort.logo;
  if (logo === null || logo === undefined) {
    // Der Server ist die Quelle der Wahrheit: auch „kein Logo" wird lokal
    // uebernommen, sonst druckt diese Kasse ein Logo, das der Inhaber auf
    // einem anderen Geraet laengst entfernt hat.
    logoEntfernen();
    return null;
  }
  const lokal = logoLaden();
  const uebernommen: GespeichertesLogo = {
    datenBase64: logo.dataBase64,
    format: logo.format,
    stufe: lokal?.stufe ?? 'mittel',
    hochgeladenAm: logo.hochgeladenAm,
  };
  logoSpeichern(uebernommen);
  return uebernommen;
}

export async function logoAbrufen(api: ApiClient): Promise<LogoAbruf> {
  try {
    const antwort = await belegLogoApi.lesen(api);
    if (!('logo' in antwort)) {
      // Aelterer Server: /api/shop-info existiert, kennt aber kein Logo.
      return { status: 'alterServer', logo: logoLaden() };
    }
    return { status: 'verfuegbar', logo: uebernehmen(antwort) };
  } catch (err) {
    if (err instanceof ApiError && err.httpStatus === 409) {
      return { status: 'keinName', logo: logoLaden() };
    }
    if (err instanceof ApiError && err.httpStatus === 404) {
      return { status: 'alterServer', logo: logoLaden() };
    }
    return { status: 'offline', logo: logoLaden() };
  }
}

export interface LogoHochladung {
  dateiBase64: string;
  format: BelegLogoFormat;
  stufe: LogoStufe;
}

export interface LogoHochladenErgebnis {
  logo: GespeichertesLogo | null;
  /** Was die SVG-Waesche des Servers entfernt hat — dem Inhaber SAGEN. */
  entfernt: string[];
}

/**
 * Hochladen, dann den GESPEICHERTEN Stand zurueckLESEN: die Antwort des POST
 * traegt die bereinigten Bytes nicht, und im Lager (und damit auf jedem Bon)
 * darf nur stehen, was der Server wirklich abgelegt hat — nicht der Entwurf.
 */
export async function logoHochladen(
  api: ApiClient,
  hochladung: LogoHochladung,
): Promise<LogoHochladenErgebnis> {
  const antwort = await belegLogoApi.hochladen(api, {
    format: hochladung.format,
    dataBase64: hochladung.dateiBase64,
  });
  const stand = await belegLogoApi.lesen(api);
  const logo = stand.logo
    ? ((): GespeichertesLogo => {
        const uebernommen: GespeichertesLogo = {
          datenBase64: stand.logo.dataBase64,
          format: stand.logo.format,
          stufe: hochladung.stufe,
          hochgeladenAm: stand.logo.hochgeladenAm,
        };
        logoSpeichern(uebernommen);
        return uebernommen;
      })()
    : null;
  return { logo, entfernt: antwort.entfernt };
}

export async function logoLoeschen(api: ApiClient): Promise<void> {
  await belegLogoApi.loeschen(api);
  logoEntfernen();
}

/** Nur die lokal gehaltene Groessenstufe wechseln (der Server traegt keine). */
export function logoStufeSetzen(stufe: LogoStufe): GespeichertesLogo | null {
  const lokal = logoLaden();
  if (lokal === null) return null;
  const neu = { ...lokal, stufe };
  logoSpeichern(neu);
  return neu;
}

/** Erkennt den fehlenden Endpunkt in einem Schreib-Fehler (POST/DELETE). */
export function istAlterServer(err: unknown): boolean {
  return err instanceof ApiError && err.httpStatus === 404;
}
