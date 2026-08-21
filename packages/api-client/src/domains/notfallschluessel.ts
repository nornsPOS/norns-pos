/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Notfallschlüssel — der Weg zurück in eine verschlossene Kasse
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ EIGENE DATEI, nicht in `auth-pin.ts` gestopft (die trägt 255 Zeilen).
 * Der Notausgang ist ein eigener Vorgang mit eigener Abwägung; er gehört
 * neben den Kassencode, nicht hinein.
 *
 * ⚠️ Der Klartext eines Schlüssels darf NIRGENDS zwischengelagert werden —
 * nicht in einem Zustand, nicht in einem Protokoll, nicht in einem Speicher
 * des Browsers. Er geht durch diese Funktionen hindurch zur Fläche, die ihn
 * einmal zeigt, und ist danach fort.
 */

import type { ApiClient } from '../client.js';

export interface Schluesselstand {
  vorhanden: boolean;
  gesetztAm: string | null;
  gebrauchtAm: string | null;
}

export const notfallschluessel = {
  /** Gibt es einen gültigen Schlüssel, und seit wann. NIE der Schlüssel selbst. */
  stand(client: ApiClient): Promise<Schluesselstand> {
    return client.request<Schluesselstand>('GET', '/api/auth/notfallschluessel/stand');
  },

  /**
   * Einen neuen ausgeben. Der Klartext steht in der Antwort — GENAU EINMAL.
   *
   * ⚠️ Der vorige Schlüssel stirbt dabei. Wer den neuen nicht notiert, hat
   * danach gar keinen Weg zurück mehr; deshalb verlangt der Server hier eine
   * frische Zwischenprüfung (siehe `code-nur-fuer-unwiderrufliches`).
   */
  erzeugen(client: ApiClient): Promise<{ schluessel: string; gesetztAm: string }> {
    return client.request<{ schluessel: string; gesetztAm: string }>(
      'POST',
      '/api/auth/notfallschluessel/erzeugen',
    );
  },

  /**
   * Mit dem Schlüssel einen neuen Kassencode setzen — OHNE Anmeldung.
   *
   * ⚠️ Die Antwort meldet NICHT an. Sie enthält nur den Nachfolger des
   * verbrauchten Schlüssels, wieder genau einmal sichtbar. Danach ist es die
   * gewöhnliche Anmeldung mit dem neuen Code.
   */
  einloesen(
    client: ApiClient,
    body: { schluessel: string; neuerCode: string; userId?: string },
  ): Promise<{ ok: true; neuerSchluessel: string }> {
    return client.request<{ ok: true; neuerSchluessel: string }>(
      'POST',
      '/api/auth/notfallschluessel/einloesen',
      {
        schluessel: body.schluessel,
        neuerCode: body.neuerCode,
        ...(body.userId !== undefined ? { userId: body.userId } : {}),
      },
    );
  },
};
