/**
 * logo-lager — der lokale Offline-Zwischenspeicher des Haendler-Logos.
 *
 * WARUM (26.07.2026): der shop-info-Weg hat KEINE Offline-Zwischenspeicherung.
 * Faellt der Server aus, greift nur die eingebaute Konstante — und die traegt
 * bewusst kein Logo. Ein Bon ohne Netz muss sein Logo trotzdem tragen; das
 * Logo wird deshalb nach jedem erfolgreichen Laden hier abgelegt und der
 * Druckweg (`thermalClient`, zentraler Anhang) liest von hier.
 *
 * GESPEICHERT WIRD DAS BEREINIGTE ORIGINAL (svg/png/jpeg) samt Format —
 * exakt was `GET /api/shop-info` unter `logo` liefert. Kein Zwischen-PNG:
 * die Rust-Seite rastert selbst (resvg fuer SVG, sonst die image-Kiste),
 * je Papierbreite frisch. Dazu die lokal gewaehlte Groessenstufe: der
 * Server traegt keine, sie ist eine Einstellung DIESER Kasse.
 *
 * WARUM localStorage und nicht SQLite: dasselbe Muster wie die
 * Hardware-Einstellungen (hardware-store.ts) — vor jedem Netz da, uebersteht
 * den Webview-Neustart, und ein Logo-Original ist hoechstens 256 KB (die
 * Server-Grenze), also fern jeder Quota. Die SQLite-Outbox ist fuer
 * Fiskaldaten reserviert, die NIE verloren gehen duerfen; ein Logo ist
 * wiederbeschaffbar, der Verlust kostet nur einen Bon ohne Bild.
 *
 * localStorage ist eine UNVERTRAUTE Grenze (Muster P2.6): ein kaputter oder
 * manipulierter Eintrag ergibt NULL — lieber ein Bon ohne Logo als Muell im
 * Rasterweg.
 */

import { type LogoFormat, type LogoStufe, istLogoStufe } from './logo-werk.js';

export const LOGO_LAGER_SCHLUESSEL = 'warehouse14.beleg-logo.v1';

export interface GespeichertesLogo {
  /** Das bereinigte Original, base64 — wie vom Server geliefert. */
  datenBase64: string;
  format: LogoFormat;
  /** Die an DIESER Kasse gewaehlte Groessenstufe (der Server traegt keine). */
  stufe: LogoStufe;
  /** Vom Server: wann das Logo hochgeladen wurde — fuer die Statuszeile. */
  hochgeladenAm: string;
}

/** Nur echte Base64-Zeichen — der Speicher ist eine Grenze, kein Vertrauter. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function istLogoFormat(wert: unknown): wert is LogoFormat {
  return wert === 'svg' || wert === 'png' || wert === 'jpeg';
}

function standardLager(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function logoSpeichern(
  logo: GespeichertesLogo,
  lager: Storage | null = standardLager(),
): void {
  try {
    lager?.setItem(LOGO_LAGER_SCHLUESSEL, JSON.stringify(logo));
  } catch {
    // Quota oder privater Modus: der Zwischenspeicher ist Komfort, kein
    // Fiskalpfad — ein fehlgeschlagenes Ablegen darf keinen Verkauf stoppen.
  }
}

export function logoEntfernen(lager: Storage | null = standardLager()): void {
  try {
    lager?.removeItem(LOGO_LAGER_SCHLUESSEL);
  } catch {
    // s. o.
  }
}

export function logoLaden(lager: Storage | null = standardLager()): GespeichertesLogo | null {
  let roh: string | null;
  try {
    roh = lager?.getItem(LOGO_LAGER_SCHLUESSEL) ?? null;
  } catch {
    return null;
  }
  if (roh === null) return null;

  let wert: unknown;
  try {
    wert = JSON.parse(roh);
  } catch {
    return null;
  }
  if (typeof wert !== 'object' || wert === null) return null;
  const o = wert as Record<string, unknown>;

  if (typeof o.datenBase64 !== 'string' || o.datenBase64.length === 0) return null;
  if (!BASE64.test(o.datenBase64)) return null;
  if (!istLogoFormat(o.format)) return null;
  if (!istLogoStufe(o.stufe)) return null;
  if (typeof o.hochgeladenAm !== 'string') return null;

  return {
    datenBase64: o.datenBase64,
    format: o.format,
    stufe: o.stufe,
    hochgeladenAm: o.hochgeladenAm,
  };
}
