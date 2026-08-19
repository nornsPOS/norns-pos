/**
 * Der Ladenname ist Pflicht — und wird NIE erfunden.
 *
 * Bis zum 26.07.2026 standen zwei stille Rueckfaelle im Haus:
 * `?? 'WAREHOUSE 14'` in routes/shop-info.ts und in routes/closing-export.ts
 * (Kassenbericht-Kopf). Ein Mandant ohne gepflegten Namen bekam damit still
 * den Namen des ERSTEN Kunden auf Bon und Kassenbericht gedruckt — die
 * Fehlerklasse „erfinden statt fragen“, die dieses Haus am selben Tag zweimal
 * gefunden hat (DHL erfand Sendenummern, eBay meldete nie gefragte Enden).
 *
 * Ab jetzt: ein leerer oder fehlender `shop.name` ist ein FEHLER mit klarem
 * deutschen Text und dem Weg zur Abhilfe. 409, weil der Fehler im Zustand des
 * Mandanten liegt, nicht in der Anfrage — dasselbe Muster wie
 * `DatevMandantFehltError` (lib/datev-mandant.ts).
 */

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

export class LadennameNichtGepflegtError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/**
 * Gibt den gepflegten Ladennamen zurueck oder wirft mit klarem Text.
 * Leerraum zaehlt nicht als Name.
 */
export function erzwingeLadenname(wert: string | null | undefined): string {
  const name = (wert ?? '').trim();
  if (name === '') {
    throw new LadennameNichtGepflegtError('Der Name des Ladens ist nicht eingetragen. Bitte unter Einstellungen, Laden nachtragen.');
  }
  return name;
}
