/**
 * Die EINE GESTE am Stripe-Leser — reine Ablauflogik für den Bezahldialog.
 *
 * ── WARUM EINE EIGENE, REINE DATEI ──────────────────────────────────────────
 * Der Bezahldialog ist die teuerste Stelle des Ladens. Was hier steht, sagt
 * der Kassierer dem wartenden Kunden wörtlich — deshalb sind die Deutungen
 * Logik, keine Optik, und werden rot→grün getestet, bevor eine Fläche sie
 * benutzt (stripe-leser-ablauf.test.ts; Muster kartenleser-zustand.ts).
 *
 * Die Reihenfolge der Geste (BezahlenDialog orchestriert, dieses Modul deutet):
 *   1. TROCKENLAUF (`dryRun: true`) — fällt er durch, wird KEINE Karte belastet.
 *   2. STARTEN — der Server schickt die echten Warenkorbzeilen auf den
 *      Kundenschirm des Lesers und stößt die Sammlung an.
 *   3. STAND im ruhigen Takt, bis er nicht mehr PROCESSING ist.
 *   4. ERFOLG → finalize mit `STRIPE_TERMINAL`; sonst das Fehlerbild WAHR
 *      benennen und den Weg zurück offen lassen.
 */

import { ApiError, type TerminalLeser, type TerminalPosition } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';

/**
 * Der ruhige Takt der Stand-Abfrage. Der Stand kommt vom Webhook; schneller
 * fragen macht die Antwort nicht schneller, es hämmert nur den Server.
 */
export const LESER_POLL_TAKT_MS = 1200;

/**
 * So viele Netzfehler IN FOLGE toleriert die Stand-Abfrage, bevor sie ehrlich
 * aufgibt (≈ 10 Sekunden Funkstille). Wichtig: Aufgeben heißt NICHT „nicht
 * belastet" — der Stand ist dann UNBEKANNT, und genau so wird es gesagt.
 */
export const LESER_POLL_FEHLER_DECKEL = 8;

/** Ehrlicher Satz für den unbekannten Stand nach Funkstille — KEIN Freibrief. */
export const STAND_UNBEKANNT_MELDUNG =
  'Der Stand der Zahlung ist gerade nicht abrufbar. Die Karte kann bereits ' +
  'belastet worden sein. Den Vorgang NICHT neu beginnen, sondern erneut ' +
  '„Kartenzahlung starten" drücken: derselbe Vorgang wird fortgesetzt, nie ein zweiter eröffnet.';

// ── Sichtbarkeit ───────────────────────────────────────────────────────────

/**
 * Der Zahlungsweg erscheint NUR, wenn mindestens ein Leser registriert ist.
 * `null` heißt: Liste nicht geladen oder nicht abrufbar (auch offline) — dann
 * bleibt der Wähler unverändert, Roman sieht schlicht nichts Neues.
 */
export function stripeZahlartSichtbar(
  leser: readonly TerminalLeser[] | null | undefined,
): boolean {
  return Array.isArray(leser) && leser.length > 0;
}

/**
 * Der Leser der Geste: bevorzugt einen, den Stripe zuletzt „online" sah.
 * Meldet keiner online, trägt der erste — der gemeldete Stand ist Auskunft,
 * keine Wahrheit (der Leser kann längst wieder am Strom hängen); die echte
 * Antwort gibt der Start selbst (Fehlerbild LESER_OFFLINE).
 */
export function waehleLeser(
  leser: readonly TerminalLeser[] | null | undefined,
): TerminalLeser | null {
  if (!Array.isArray(leser) || leser.length === 0) return null;
  return leser.find((l) => l.status === 'online') ?? leser[0] ?? null;
}

// ── Die Positionen für den Kundenschirm des Lesers ─────────────────────────

/**
 * Die ECHTEN Warenkorbzeilen, in ganzen Cent. Menge ist immer 1 — die Kasse
 * verkauft Einzelstücke (serialisiertes Inventar), und der Zeilenbetrag ist
 * bereits der Endbetrag der Zeile (nach Rabatt).
 */
export function terminalPositionen(
  zeilen: readonly { name: string; lineTotalCents: bigint }[],
): TerminalPosition[] {
  return zeilen.map((z) => ({
    bezeichnung: z.name,
    menge: 1,
    betragCents: Number(z.lineTotalCents),
  }));
}

/**
 * Der Leser ist das Kundendisplay: er zeigt nur Zeilen, die aufgehen. Die
 * Summe der Positionen muss den Betrag EXAKT ergeben — sonst wird ehrlich
 * abgelehnt statt dem Kunden eine falsche Rechnung gezeigt.
 */
export function positionenDeckenBetrag(
  positionen: readonly TerminalPosition[],
  amountCents: number,
): boolean {
  if (positionen.length === 0) return false;
  const summe = positionen.reduce((acc, p) => acc + p.betragCents, 0);
  return summe === amountCents;
}

// ── Die Deutung des Stands — Fehler WAHR benennen ──────────────────────────

export type StandDeutung =
  /** Weiter warten; `hinweis` trägt die weiche girocard-Ablehnung, falls eine kam. */
  | { art: 'WARTEN'; hinweis: string | null }
  | { art: 'ERFOLG' }
  /** Endgültig für DIESEN Vorgang — der Weg zurück (andere Zahlart) ist offen. */
  /**
   * `meldung` ist IMMER deutsch und gehört dem Kassierer.
   * `technik` trägt den englischen Originaltext von Stripe für die Diagnose
   * und darf NIE auf den Schirm — siehe die Begründung bei `deuteStand`.
   */
  | { art: 'GESCHEITERT'; meldung: string; technik: string | null };

/**
 * Eine weiche girocard-Ablehnung ändert den Stand NICHT (kein zweiter
 * Anlauf durch die Kasse!) — der Kunde kann selbst eine andere Karte an den
 * Leser halten, die Sammlung läuft weiter.
 */
const WEICHE_ABLEHNUNG_HINWEIS =
  'Karte abgelehnt. Der Kunde kann eine andere Karte an den Leser halten, der Vorgang läuft weiter.';

/** Die Fehlerbilder des Servers, jedes mit dem ehrlichen deutschen Satz. */
const FEHLERBILD_TEXT: Readonly<Record<string, string>> = {
  // „Karte abgelehnt" ist nicht „Verbindung gestört": die Bank hat NEIN
  // gesagt, Netz und Leser sind in Ordnung.
  KARTE_ABGELEHNT:
    'Karte abgelehnt. Die Bank hat diese Zahlung verweigert. Bitte eine andere Karte oder Zahlart wählen, keine Belastung erfolgt.',
  ZEITUEBERSCHREITUNG:
    'Zeitüberschreitung: es wurde keine Karte an den Leser gehalten. Keine Belastung erfolgt.',
  ABBRUCH_AM_GERAET: 'Die Zahlung wurde am Leser abgebrochen. Keine Belastung erfolgt.',
  LESER_OFFLINE:
    'Der Leser ist nicht erreichbar (offline). Bitte Strom und Netz des Lesers prüfen, die Karte wurde nicht belastet.',
};

export function deuteStand(stand: {
  status: string;
  fehlerbild: string | null;
  fehlerMeldung: string | null;
  weicheAblehnungen?: number;
}): StandDeutung {
  switch (stand.status) {
    case 'PROCESSING':
      return {
        art: 'WARTEN',
        hinweis: (stand.weicheAblehnungen ?? 0) > 0 ? WEICHE_ABLEHNUNG_HINWEIS : null,
      };
    case 'SUCCEEDED':
      return { art: 'ERFOLG' };
    case 'CANCELED':
      return {
        art: 'GESCHEITERT',
        meldung:
          (stand.fehlerbild !== null ? FEHLERBILD_TEXT[stand.fehlerbild] : undefined) ??
          'Die Zahlung wurde abgebrochen. Keine Belastung erfolgt.',
        technik: stand.fehlerMeldung ?? null,
      };
    default:
      // FAILED — und alles Unbekannte wird wie ein Scheitern behandelt, nie
      // wie ein Erfolg: im Zweifel bucht die Kasse NICHT.
      return {
        art: 'GESCHEITERT',
        // ⚠️ 01.08.2026: hier stand `?? stand.fehlerMeldung ??` mitten in der
        // Kette. Kennt die Kasse das Fehlerbild nicht, reichte sie damit den
        // englischen Originalsatz von Stripe an den Kassierer durch — etwa
        // „Your card was declined." Die Abbruch-Verzweigung direkt darüber
        // tat das nie; nur diese hier. Der Text ist nicht verloren, er zieht
        // nach `technik` um und wird protokolliert statt angezeigt.
        meldung:
          (stand.fehlerbild !== null ? FEHLERBILD_TEXT[stand.fehlerbild] : undefined) ??
          'Die Zahlung ist fehlgeschlagen. Keine Belastung erfolgt.',
        technik: stand.fehlerMeldung ?? null,
      };
  }
}

// ── Fehler VOR der ersten Belastung (Trockenlauf/Start) ────────────────────

/**
 * Scheitert der Weg, BEVOR eine Karte belastet wurde, bekommt die Kassiererin
 * den ehrlichen Satz:
 *   • SERVICE_UNAVAILABLE — der Server hat keinen Stripe-Schlüssel. Ruhig
 *     erklärt (der Wähler zeigt den Weg dann ohnehin nicht mehr an).
 *   • CONFLICT — der Zustand des Ladens trägt die Aktion nicht; der
 *     Server-Satz ist bereits deutsch und wird wörtlich weitergegeben.
 *   • alles andere — describeError (i18n-de) übersetzt.
 */
export function beschreibeStartFehler(err: unknown): string {
  if (err instanceof ApiError && err.code === 'SERVICE_UNAVAILABLE') {
    return (
      'Stripe ist auf dem Server nicht eingerichtet. Der Weg steht erst mit ' +
      'hinterlegtem Stripe-Schlüssel zur Verfügung. Bitte eine andere Zahlart wählen.'
    );
  }
  if (err instanceof ApiError && err.code === 'CONFLICT') return err.message;
  return describeError(err);
}
