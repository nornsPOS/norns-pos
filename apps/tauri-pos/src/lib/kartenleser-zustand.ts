/**
 * Zustandslogik der Gruppe „Kartenleser (Stripe)" im Gerätemanager.
 *
 * ── WARUM EINE EIGENE, REINE DATEI ──────────────────────────────────────────
 * Der Massstab des Gewerks: der Zahlungsweg erscheint NUR, wenn Konto und
 * Leser wirklich eingerichtet sind. Ohne Stripe-Schlüssel sieht der Laden
 * eine ruhige Erklärung, kein Fehlerrot. Diese Entscheidung ist Logik, keine
 * Optik — sie gehört getestet, bevor eine Fläche sie benutzt (rot → grün,
 * kartenleser-zustand.test.ts).
 *
 * Quellen der Wahrheit:
 *   • GET /api/stripe/terminal/readers — jeder Angemeldete, die Liste.
 *   • GET /api/stripe/connect/status  — NUR der Inhaber; ein 403 ist darum
 *     kein Fehlerbild, sondern der ehrliche Zustand NUR_INHABER.
 * Registrieren und Entfernen sind serverseitig ADMIN + Stufenanhebung; die
 * PIN-Abfrage öffnet die Stufen-Middleware von selbst.
 */

import { ApiError } from '@norns/api-client';
import { PAYMENT_METHOD_LABEL, describeError } from '@norns/i18n-de';

// ── Die Konto-Auskunft (aus /api/stripe/connect/status) ────────────────────

export interface KontoStatusPayload {
  connected: boolean;
  readyToCharge: boolean;
  hint: string;
}

export type KontoAuskunft =
  | { art: 'LAEDT' }
  | { art: 'GELADEN'; verbunden: boolean; bereit: boolean; hinweis: string }
  /** Die Auskunft ist dem Inhaber vorbehalten (403) — kein Fehlerbild. */
  | { art: 'NUR_INHABER' }
  /** Netz oder Server gestört — wir behaupten dann NICHT „nicht eingerichtet". */
  | { art: 'GESTOERT' }
  /**
   * 27.07.2026: eine Registrier- oder Entfernen-Aktion hat 503 geantwortet,
   * der Server trägt also KEINEN Stripe-Schlüssel. Diese Auskunft schlägt
   * eine alte Kontozeile (connected=true aus der Datenbank), deren Stand der
   * Status-Weg mangels Schlüssel nur veraltet wiedergeben kann.
   */
  | { art: 'SCHLUESSEL_FEHLT' };

/**
 * Erkennt den 503 (SERVICE_UNAVAILABLE) einer Verwaltungs-Aktion: der Server
 * hat keinen Stripe-Schlüssel. Nur DIESER Code zählt, denn ein 409 oder ein
 * Netzfehler sagt nichts über die Einrichtung.
 */
export function istStripeNichtEingerichtet(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'SERVICE_UNAVAILABLE';
}

export function kontoAuskunftAusStatus(payload: KontoStatusPayload): KontoAuskunft {
  return {
    art: 'GELADEN',
    verbunden: payload.connected,
    bereit: payload.readyToCharge,
    hinweis: payload.hint,
  };
}

export function kontoAuskunftAusFehler(err: unknown): KontoAuskunft {
  if (err instanceof ApiError && err.code === 'FORBIDDEN') return { art: 'NUR_INHABER' };
  return { art: 'GESTOERT' };
}

// ── Der Gruppenzustand ─────────────────────────────────────────────────────

/** Die eine ruhige Erklärung für den unkonfigurierten Laden — kein Rot. */
const OHNE_KONTO_ERKLAERUNG =
  `Der Zahlungsweg „${PAYMENT_METHOD_LABEL.STRIPE_TERMINAL}" wird verfügbar, ` +
  'sobald das Stripe-Konto des Ladens eingerichtet ist. Bis dahin ändert sich ' +
  'an der Kasse nichts, das ZVT-Terminal arbeitet unverändert weiter.';

const NUR_INHABER_ERKLAERUNG =
  'Die Einrichtung der Stripe-Kartenleser ist dem Inhaber vorbehalten. ' +
  'Registrierte Leser erscheinen hier, sobald es welche gibt.';

const AUSKUNFT_GESTOERT_ERKLAERUNG =
  'Der Stand des Stripe-Kontos ist gerade nicht abrufbar. Die Anzeige sagt ' +
  'deshalb ehrlich „unbekannt" statt „nicht eingerichtet". Bitte später erneut öffnen.';

/**
 * 27.07.2026: der ehrliche Satz nach einem Registrier-503. Er benennt den
 * fehlenden Schlüssel ausdrücklich, weil die Konto-Anzeige davor veraltet
 * „verbunden" behauptet haben kann; ruhig, ohne das Wort „Fehler".
 */
const SCHLUESSEL_FEHLT_ERKLAERUNG =
  'Auf dem Server fehlt der Stripe-Schlüssel; ein früher verknüpftes Konto ist ' +
  'damit nicht erreichbar, sein zuletzt angezeigter Stand war veraltet. ' +
  `Der Zahlungsweg „${PAYMENT_METHOD_LABEL.STRIPE_TERMINAL}" gilt darum als nicht ` +
  'eingerichtet. An der Kasse ändert sich nichts, das ZVT-Terminal arbeitet ' +
  'unverändert weiter.';

export type LeserGruppe =
  | { art: 'LAEDT' }
  /** (a) Kein verbundenes Konto: ruhige Erklärung, kein Formular. */
  | { art: 'OHNE_KONTO'; erklaerung: string }
  /** (b) Konto da, kein Leser: Registrierung anbieten. */
  | { art: 'REGISTRIERUNG'; kontoHinweis: string | null }
  /** (c) Leser da: die Liste — lesend für alle, verwalten nur mit Konto + Recht. */
  | { art: 'LISTE'; kontoHinweis: string | null; registrierenErlaubt: boolean }
  | { art: 'NUR_INHABER'; erklaerung: string }
  | { art: 'AUSKUNFT_GESTOERT'; erklaerung: string };

export function leiteLeserGruppeAb(input: {
  istAdmin: boolean;
  konto: KontoAuskunft;
  /** null: die Liste ist noch nicht geladen. */
  leser: readonly unknown[] | null;
}): LeserGruppe {
  const { istAdmin, konto, leser } = input;
  if (leser === null) return { art: 'LAEDT' };

  // Vorhandene Leser sind die stärkste Wahrheit: sie werden IMMER gezeigt,
  // auch wenn die Konto-Auskunft fehlt (Kassiererin, Netzstörung).
  if (leser.length > 0) {
    const bereitFuerVerwaltung = istAdmin && konto.art === 'GELADEN' && konto.verbunden;
    return {
      art: 'LISTE',
      kontoHinweis:
        konto.art === 'SCHLUESSEL_FEHLT'
          ? // 27.07.2026: der 503 einer Aktion hat den fehlenden Schlüssel
            // entlarvt; die Liste bleibt (bei Stripe registriert), aber der
            // Satz steht ehrlich dabei.
            SCHLUESSEL_FEHLT_ERKLAERUNG
          : konto.art === 'GELADEN' && !konto.bereit
            ? konto.hinweis || null
            : null,
      registrierenErlaubt: bereitFuerVerwaltung,
    };
  }

  if (!istAdmin) return { art: 'NUR_INHABER', erklaerung: NUR_INHABER_ERKLAERUNG };

  switch (konto.art) {
    case 'LAEDT':
      return { art: 'LAEDT' };
    case 'NUR_INHABER':
      return { art: 'NUR_INHABER', erklaerung: NUR_INHABER_ERKLAERUNG };
    case 'GESTOERT':
      return { art: 'AUSKUNFT_GESTOERT', erklaerung: AUSKUNFT_GESTOERT_ERKLAERUNG };
    case 'SCHLUESSEL_FEHLT':
      // 27.07.2026: ruhiger Nicht-eingerichtet-Zustand statt des veralteten
      // Registrier-Formulars, mit dem Satz, der den Schlüssel benennt.
      return { art: 'OHNE_KONTO', erklaerung: SCHLUESSEL_FEHLT_ERKLAERUNG };
    case 'GELADEN':
      if (!konto.verbunden) return { art: 'OHNE_KONTO', erklaerung: OHNE_KONTO_ERKLAERUNG };
      return {
        art: 'REGISTRIERUNG',
        kontoHinweis: konto.bereit ? null : konto.hinweis || null,
      };
  }
}

// ── Registrierung: Prüfung vor jedem Server-Kontakt ────────────────────────

/** Die Server-Grenze (Schema: maxLength 100) — hier schon einhalten. */
const MAX_LAENGE = 100;

export type RegistrierungsPruefung = { gueltig: true } | { gueltig: false; grund: string };

export function pruefeRegistrierung(input: { code: string; name: string }): RegistrierungsPruefung {
  const code = input.code.trim();
  const name = input.name.trim();
  if (code.length === 0) {
    return { gueltig: false, grund: 'Bitte den Registrierungscode vom Display des Lesers abtippen.' };
  }
  if (name.length === 0) {
    return { gueltig: false, grund: 'Bitte dem Leser einen Namen geben, z. B. „Tresen links".' };
  }
  if (code.length > MAX_LAENGE || name.length > MAX_LAENGE) {
    return { gueltig: false, grund: 'Code und Name dürfen höchstens 100 Zeichen lang sein.' };
  }
  return { gueltig: true };
}

// ── Die Anschrift für den Stripe-Standort ──────────────────────────────────

export interface LeserAnschrift {
  displayName: string;
  line1: string;
  postalCode: string;
  city: string;
}

/**
 * Der Stripe-Standort (`tml_…`) braucht eine Anschrift; sie kommt aus der
 * Ladenidentität (shop-info), NIEMALS aus einem erfundenen Platzhalter —
 * dieselbe Doktrin wie beim Beleg. Trägt die Anschrift nicht (keine zwei
 * Zeilen, keine „PLZ Ort"-Zeile), gibt es null und die Fläche sagt es ehrlich.
 */
export function anschriftAusLaden(shop: {
  name: string;
  address: readonly string[];
}): LeserAnschrift | null {
  const line1 = shop.address[0]?.trim() ?? '';
  const letzte = shop.address[shop.address.length - 1]?.trim() ?? '';
  if (shop.address.length < 2 || line1.length === 0) return null;
  const treffer = /^(\d{4,5})\s+(.+)$/.exec(letzte);
  if (treffer === null) return null;
  return {
    displayName: shop.name,
    line1,
    postalCode: treffer[1] as string,
    city: (treffer[2] as string).trim(),
  };
}

// ── Der zuletzt gesehene Gerätestand — Auskunft, keine Wahrheit ────────────

export type LeserStandTon = 'online' | 'offline' | 'pending';

export function leserStandTon(status: string | null): LeserStandTon {
  if (status === 'online') return 'online';
  if (status === 'offline') return 'offline';
  return 'pending';
}

export function leserStandText(status: string | null): string {
  if (status === 'online') return 'Online';
  if (status === 'offline') return 'Offline';
  return 'Stand unbekannt';
}

/**
 * Der Gerätetyp kommt von Stripe als roher Bezeichner (`bbpos_wisepos_e`).
 * Auf die Fläche gehört ein menschliches Wort; ein unbekannter Typ wird
 * entschärft (keine Unterstriche im Sichtbaren), nie erfunden.
 */
const GERAETETYP_TEXT: Readonly<Record<string, string>> = {
  bbpos_wisepos_e: 'BBPOS WisePOS E',
  stripe_s700: 'Stripe Reader S700',
  stripe_m2: 'Stripe Reader M2',
  simulated_wisepos_e: 'Simulierter Leser (WisePOS E)',
  simulated_stripe_s700: 'Simulierter Leser (S700)',
};

export function geraeteTypText(geraetetyp: string | null): string | null {
  if (geraetetyp === null) return null;
  return GERAETETYP_TEXT[geraetetyp] ?? geraetetyp.replaceAll('_', ' ');
}

// ── Fehlerbilder der Verwaltungs-Aktionen ──────────────────────────────────

export interface LeserFehlerBeschreibung {
  titel: string;
  text: string;
}

/**
 * Registrieren/Entfernen können auf drei Arten scheitern; jede bekommt den
 * ehrlichen deutschen Satz:
 *   • SERVICE_UNAVAILABLE — der Server hat keinen Stripe-Schlüssel. Das ist
 *     der Zustand „noch nicht eingerichtet", RUHIG erklärt, kein „Fehler".
 *   • CONFLICT — der Zustand des Ladens trägt die Aktion nicht (z. B. kein
 *     Händlerkonto). Der Server-Satz ist bereits deutsch und wird wörtlich
 *     weitergegeben.
 *   • alles andere — describeError (i18n-de) übersetzt.
 */
export function beschreibeLeserAktionsFehler(err: unknown): LeserFehlerBeschreibung {
  if (err instanceof ApiError && err.code === 'SERVICE_UNAVAILABLE') {
    return {
      titel: 'Stripe ist noch nicht eingerichtet',
      text: OHNE_KONTO_ERKLAERUNG,
    };
  }
  if (err instanceof ApiError && err.code === 'CONFLICT') {
    return { titel: 'Noch nicht bereit', text: err.message };
  }
  return { titel: 'Das hat nicht geklappt', text: describeError(err) };
}
