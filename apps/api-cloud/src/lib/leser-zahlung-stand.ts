/**
 * Der Stand-Automat der Leser-Zahlung — rein, ohne Datenbank, ohne Netz.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  DER DOPPELBELASTUNGS-RIEGEL (26.07.2026, Koordination §9)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Eine girocard-Zahlung mit PIN erzeugt bei Stripe ZWEI Belastungen: erst
 * eine weich abgelehnte mit dem Ablehnungscode
 * `online_or_offline_pin_required`, dann die echte. Der Leser zieht die
 * zweite Belastung SELBST nach — fuer die Kasse ist in diesem Augenblick
 * nichts gescheitert.
 *
 * Wuerde die weiche Ablehnung als Fehlschlag gebucht, passierte eines von
 * zwei Dingen, beide teuer:
 *
 *   • Die Kasse zeigte "abgelehnt", der Kassierer stiesse einen ZWEITEN
 *     Vorgang an, die echte Belastung des ersten liefe trotzdem durch —
 *     der Kunde zahlte doppelt, der Tagesumsatz stuende doppelt in
 *     DSFinV-K.
 *   • Oder der Erfolg traefe auf einen bereits als FAILED gebuchten
 *     Vorgang und niemand wuesste mehr, welcher Stand der wahre ist.
 *
 * Deshalb entscheidet EIN reiner Automat ueber jeden Uebergang, und beide
 * Leser dieses Automaten (der Webhook und die Stand-Abfrage der Kasse)
 * koennen gar nicht voneinander abweichen. Die Regeln:
 *
 *   1. SUCCEEDED ist endgueltig. Kein Ereignis fuehrt wieder heraus.
 *   2. Die weiche Ablehnung aendert den Stand NICHT; sie wird nur
 *      gezaehlt (Beweis der Doppelfolge, nie eine Buchung).
 *   3. Nach einer harten Ablehnung (FAILED) darf der Erfolg noch kommen:
 *      der Leser sammelt weiter, der Kunde darf eine andere Karte ziehen.
 *      Nur aus CANCELED gibt es keinen Erfolg — einen stornierten Intent
 *      kann auch Stripe nicht mehr vollenden.
 */

export type ZahlungsStand = 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

/** Das Fehlerbild fuer die Kasse — klar getrennt statt eines Fehlertexts. */
export type Fehlerbild =
  | 'LESER_OFFLINE'
  | 'KARTE_ABGELEHNT'
  | 'ZEITUEBERSCHREITUNG'
  | 'ABBRUCH_AM_GERAET';

/** Stripes Ablehnungscode der weichen girocard-PIN-Ablehnung. */
export const WEICHE_ABLEHNUNG = 'online_or_offline_pin_required';

export interface LeserEreignis {
  typ: 'erfolg' | 'fehlschlag' | 'storniert' | 'aktion_fehlgeschlagen';
  /** Stripes `decline_code` bzw. `failure_code`, sofern vorhanden. */
  code?: string | undefined;
  meldung?: string | undefined;
}

export type StandUebergang =
  | { geaendert: false; weicheAblehnung: boolean }
  | {
      geaendert: true;
      stand: ZahlungsStand;
      fehlerbild: Fehlerbild | null;
      meldung: string | null;
    };

const KEIN_UEBERGANG: StandUebergang = { geaendert: false, weicheAblehnung: false };

export function naechsterStand(aktuell: ZahlungsStand, e: LeserEreignis): StandUebergang {
  // Regel 1: SUCCEEDED ist endgueltig.
  if (aktuell === 'SUCCEEDED') return KEIN_UEBERGANG;

  switch (e.typ) {
    case 'erfolg':
      // Regel 3: aus PROCESSING wie aus FAILED — nur nicht aus CANCELED.
      if (aktuell === 'CANCELED') return KEIN_UEBERGANG;
      return { geaendert: true, stand: 'SUCCEEDED', fehlerbild: null, meldung: null };

    case 'fehlschlag':
      if (aktuell !== 'PROCESSING') return KEIN_UEBERGANG;
      // Regel 2: DER RIEGEL. Die weiche Ablehnung ist kein Fehlschlag.
      if (e.code === WEICHE_ABLEHNUNG) return { geaendert: false, weicheAblehnung: true };
      return {
        geaendert: true,
        stand: 'FAILED',
        fehlerbild: 'KARTE_ABGELEHNT',
        meldung: e.meldung ?? null,
      };

    case 'storniert':
      if (aktuell === 'CANCELED') return KEIN_UEBERGANG;
      return { geaendert: true, stand: 'CANCELED', fehlerbild: null, meldung: null };

    case 'aktion_fehlgeschlagen': {
      if (aktuell !== 'PROCESSING') return KEIN_UEBERGANG;
      const code = e.code ?? '';
      if (code.includes('timed_out') || code.includes('timeout')) {
        return {
          geaendert: true,
          stand: 'FAILED',
          fehlerbild: 'ZEITUEBERSCHREITUNG',
          meldung: e.meldung ?? null,
        };
      }
      if (code.includes('customer_canceled')) {
        return {
          geaendert: true,
          stand: 'CANCELED',
          fehlerbild: 'ABBRUCH_AM_GERAET',
          meldung: e.meldung ?? null,
        };
      }
      // Eine unverstandene Stoerung ist ein Fehlschlag OHNE erfundenes
      // Fehlerbild — die Meldung traegt, was Stripe gesagt hat.
      return { geaendert: true, stand: 'FAILED', fehlerbild: null, meldung: e.meldung ?? null };
    }
  }
}
