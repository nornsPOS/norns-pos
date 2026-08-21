/**
 * Rettungsstick und Herstellercode — die zwei jüngeren Türen neben dem
 * Notfallschlüssel (`domains/notfallschluessel.ts`). Eigene Datei aus
 * demselben Grund: eigener Vorgang, eigene Abwägung.
 *
 * ⚠️ Kein Klartext-Geheimnis läuft durch diese Funktionen. Der Stick trägt
 * seines selbst; die Meister-Antwort ist eine Unterschrift, kein Geheimnis.
 */

import type { ApiClient } from '../client.js';

export interface Laufwerk {
  pfad: string;
  name: string;
  traegtSchluessel: boolean;
}

export const rettungsstick = {
  /** Wechseldatenträger dieses Rechners. Nur in der Kasse; die Wolke kennt den Weg nicht. */
  laufwerke(client: ApiClient): Promise<{ laufwerke: Laufwerk[] }> {
    return client.request<{ laufwerke: Laufwerk[] }>('GET', '/api/auth/rettungsstick/laufwerke');
  },
  /** Stick beschreiben. Der vorige stirbt dabei — der Server verlangt die Zwischenprüfung. */
  schreiben(client: ApiClient, laufwerk: string): Promise<{ ok: true; gesetztAm: string }> {
    return client.request<{ ok: true; gesetztAm: string }>(
      'POST',
      '/api/auth/rettungsstick/schreiben',
      { laufwerk },
    );
  },
  /** Mit dem Stick einen neuen Kassencode setzen. Meldet NICHT an. */
  einloesen(
    client: ApiClient,
    body: { laufwerk: string; neuerCode: string },
  ): Promise<{ ok: true; stickNachgeladen: boolean }> {
    return client.request<{ ok: true; stickNachgeladen: boolean }>(
      'POST',
      '/api/auth/rettungsstick/einloesen',
      body,
    );
  },
};

export const meistercode = {
  /** Eine Aufgabe für den Hersteller anfordern (steht danach auf dem Schirm). */
  aufgabe(client: ApiClient): Promise<{ aufgabe: string; gueltigBis: string }> {
    return client.request<{ aufgabe: string; gueltigBis: string }>(
      'GET',
      '/api/auth/meister/aufgabe',
    );
  },
  /** Die Antwort des Herstellers einlösen. Meldet NICHT an. */
  einloesen(
    client: ApiClient,
    body: { antwort: string; neuerCode: string },
  ): Promise<{ ok: true }> {
    return client.request<{ ok: true }>('POST', '/api/auth/meister/einloesen', body);
  },
};
