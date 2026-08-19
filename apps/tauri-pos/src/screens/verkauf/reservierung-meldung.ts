/**
 * Was die Kassiererin liest, wenn eine Reservierung nicht zustande kommt.
 *
 * ── WARUM DIESE DEUTUNG EINEN EIGENEN ORT HAT (26.07.2026) ──────────────────
 * In `Verkauf.tsx` standen vier Zweige nebeneinander, und der letzte war ein
 * `else`, das ALLES auffing, was kein `ApiError` ist:
 *
 *     else { addToast({ title: 'Verbindung gestört',
 *                       body: 'Reservierung konnte nicht gesetzt werden.' }) }
 *
 * `ApiOfflineQueuedError` erbt von `Error` und NICHT von `ApiError` (dieselbe
 * Verwechslung, die `src/lib/eingereiht.ts` schon für fünf andere Masken
 * beschreibt). Der Halt landete also im dauerhaften Ausgangskorb, wurde
 * Stunden später WIRKLICH abgespielt und sperrte das Stück bis zu 720 Minuten
 * — während der Satz auf dem Schirm behauptete, es sei nichts passiert.
 *
 * Der Text ist hier keine Verzierung. Er ist die einzige Grundlage, auf der
 * die Kassiererin handelt. „Konnte nicht gesetzt werden" heisst für sie „das
 * Stück ist frei", und genau das war falsch. Deshalb sagt jeder Zweig jetzt
 * dreierlei: was WIRKLICH mit dem Stück ist, was das für den Verkauf bedeutet,
 * und was sie als Nächstes tun kann.
 *
 * Eigene Datei, weil eine Meldung, die in einem 600-Zeilen-Bildschirm wohnt,
 * von keinem Test angesehen wird — und weil das der Grund war, dass dieser
 * Fehler ein halbes Jahr überlebt hat. Siehe `reservierung-meldung.test.ts`.
 */

import {
  ApiCircuitOpenError,
  ApiError,
  ApiNetworkError,
  ApiOfflineQueuedError,
} from '@norns/api-client';
import { describeError } from '@norns/i18n-de';

export interface ReservierungsHinweis {
  readonly tone: 'alert' | 'info';
  readonly title: string;
  readonly body: string;
}

export interface ReservierungsFehlerAntwort {
  /** `null` heisst BEWUSST still — nicht „vergessen". */
  readonly hinweis: ReservierungsHinweis | null;
  /** Der Katalog zeigt einen überholten Bestand und muss neu gelesen werden. */
  readonly katalogAuffrischen: boolean;
}

/**
 * Deutet den Fehler eines `productsApi.reserve`-Aufrufs.
 *
 * Die Reihenfolge der Zweige ist tragend: der eingereihte Fall MUSS vor jeder
 * `instanceof ApiError`-Prüfung stehen, denn er ist keiner — und genau daran
 * ist die alte Fassung gescheitert.
 */
export function reservierungsFehlerDeuten(err: unknown, sku: string): ReservierungsFehlerAntwort {
  // 1. Eingereiht. Nach der Wurzelbehebung in `offline-queue.ts`
  //    (FLUECHTIGE_PFADE) kann das nicht mehr vorkommen; der Zweig bleibt als
  //    zweite Wand. Wichtig: für einen HALT ist Einreihen kein Erfolg, also
  //    NICHT der ruhige `eingereihtHinweis`, den ein Beleg bekommt. Ein Beleg
  //    trägt einen dauerhaften Willen, ein Halt hat eine Haltbarkeit.
  if (err instanceof ApiOfflineQueuedError) {
    return {
      hinweis: {
        tone: 'alert',
        title: 'Stück ist NICHT reserviert',
        body: `${sku} wurde offline nur vorgemerkt, NICHT gehalten. Es kann anderswo verkauft werden. Bitte mit Verbindung erneut antippen.`,
      },
      katalogAuffrischen: false,
    };
  }

  // 2. Ein anderer Kanal war schneller. Der Katalog lügt jetzt, also neu lesen.
  if (err instanceof ApiError && err.code === 'PRODUCT_NOT_RESERVABLE') {
    return {
      hinweis: {
        tone: 'alert',
        title: 'Bereits anderswo reserviert',
        body: `${sku}. Der Storefront oder eBay-Kanal hat zuerst zugegriffen.`,
      },
      katalogAuffrischen: true,
    };
  }

  // 3. Aufforderung abgebrochen: die Kassiererin hat den Vorgang selbst
  //    beendet und weiss es. Ein Hinweis wäre Lärm.
  if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
    return { hinweis: null, katalogAuffrischen: false };
  }

  // 4. Eine echte Antwort des Servers.
  if (err instanceof ApiError) {
    return {
      hinweis: { tone: 'alert', title: 'Reservierung fehlgeschlagen', body: describeError(err) },
      katalogAuffrischen: false,
    };
  }

  // 5. Kein Netz (oder der Kreis ist offen). Das ist der Alltagsfall am Tresen,
  //    und der Satz muss WAHR sein: es wurde nichts gesetzt, nichts gemerkt,
  //    nichts gesperrt. Das Stück bleibt frei — auch für andere.
  if (err instanceof ApiNetworkError || err instanceof ApiCircuitOpenError) {
    return {
      hinweis: {
        tone: 'alert',
        title: 'Ohne Verbindung keine Reservierung',
        body: `${sku} wurde NICHT reserviert und bleibt für andere frei. Sobald die Verbindung zurück ist, erneut antippen.`,
      },
      katalogAuffrischen: false,
    };
  }

  // 6. Unbekannt. Auch hier keine Behauptung über den Bestand, die wir nicht
  //    prüfen können — nur der eine Satz, den wir sicher wissen.
  return {
    hinweis: {
      tone: 'alert',
      title: 'Reservierung fehlgeschlagen',
      body: `${sku} wurde NICHT reserviert. Der Grund ist unklar. Bitte erneut antippen.`,
    },
    katalogAuffrischen: false,
  };
}
