/**
 * Geräte, die Benachrichtigungen empfangen dürfen (0103).
 *
 * Der Server kann eine neue Bestellung nur melden, wenn er weiss, WOHIN. Diese
 * beiden Wege tragen die Gerätemarke hin und wieder weg.
 */
import type { ApiClient } from '../client.js';

export type PushPlatform = 'ios' | 'android';
/** Welche Personal-Anwendung die Marke hält. Kundengeräte sind hier NICHT gemeint. */
export type PushApp = 'owner' | 'cashier';

export const devicesApi = {
  /**
   * Die Gerätemarke anmelden oder auffrischen.
   *
   * Der Server führt einen eindeutigen Index auf der MARKE allein: wechselt auf
   * demselben Telefon der angemeldete Mensch, wandert die Marke mit, statt dem
   * vorigen Benutzer fremde Bestellungen zu melden.
   */
  registerPushToken(
    client: ApiClient,
    body: { token: string; platform: PushPlatform; app: PushApp; deviceLabel?: string },
  ): Promise<{ ok: boolean }> {
    return client.request<{ ok: boolean }>('POST', '/api/devices/push-token', body);
  },

  /** Die Marke widerrufen, etwa beim Abmelden. Antwortet ehrlich, ob etwas widerrufen wurde. */
  revokePushToken(client: ApiClient, token: string): Promise<{ ok: boolean; revoked: number }> {
    return client.request<{ ok: boolean; revoked: number }>('DELETE', '/api/devices/push-token', {
      token,
    });
  },
};
