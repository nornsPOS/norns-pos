/**
 * Der DATEV-Kontenrahmen als Einstellung. Spiegelt
 * `apps/api-cloud/src/routes/settings.ts` — `GET /api/settings/datev` und
 * `PATCH /api/settings/datev/:key` — Feld für Feld.
 *
 * Warum eine eigene Datei und nicht ein Anhängsel an `closings.ts`: der Export
 * ist ein fiskalischer Lesevorgang, die Einstellung ein Verwaltungsvorgang mit
 * anderen Rechten (ADMIN, beim Schreiben zusätzlich frische Zweitbestätigung).
 *
 * ── EHRLICHKEIT ────────────────────────────────────────────────────────────
 * Jeder Wert kommt mit `herkunft`. Das ist der ganze Punkt dieser Route: eine
 * Kontonummer, die dieses Haus nur VORSCHLÄGT, sieht sonst genauso aus wie
 * eine, die der Steuerberater BESTAETIGT hat. Eine Oberfläche, die das Merkmal
 * verschweigt, macht aus einem Vorschlag stillschweigend eine Tatsache — genau
 * die Fehlerklasse, gegen die die Route gebaut wurde.
 *
 * Die Route verlangt ADMIN. Ein Steuerberater-Konto (READONLY) bekommt 403;
 * das ist kein Fehler der Oberfläche, sondern die Rechtelage. Wer nur exportiert,
 * lässt den Rahmen einfach weg und der Server nimmt die gespeicherte Einstellung.
 */

import type { ApiClient } from '../client.js';
import type { DatevKontenrahmen } from './closings.js';

/** VORSCHLAG: von diesem Haus vorbelegt. BESTAETIGT: ein Mensch hat gespeichert. */
export type DatevHerkunft = 'VORSCHLAG' | 'BESTAETIGT' | 'FEHLT';

export interface DatevRahmenOption {
  id: string;
  /** Deutsche Beschriftung, vom Server. Die Oberfläche erfindet keine. */
  label: string;
  aktiv: boolean;
}

export interface DatevMandantFeld {
  schluessel: string;
  label: string;
  hinweis: string;
  art: string;
  wert: string | null;
  herkunft: string;
}

export interface DatevKontoZeile {
  schluessel: string;
  /** Der logische Zweck, z. B. `kasse`. Nie als Text anzeigen — dafür ist `label` da. */
  konto: string;
  label: string;
  zweck: string;
  /** Die geltende Kontonummer. */
  wert: string;
  /** Die Nummer der Vorlage, auch wenn `wert` davon abweicht. */
  vorlagewert: string;
  herkunft: string;
  /** Woher die Vorlagezahl stammt, im Klartext. */
  quelle: string;
}

export interface DatevSettings {
  rahmen: string;
  verfuegbareRahmen: DatevRahmenOption[];
  mandant: DatevMandantFeld[];
  konten: DatevKontoZeile[];
}

export interface DatevSettingUpdateResult {
  schluessel: string;
  wert: string;
  herkunft: string;
}

export const settingsDatevApi = {
  /**
   * GET /api/settings/datev — Rahmen, Mandantenangaben und JEDES Konto (ADMIN).
   *
   * `kontenrahmen` zeigt den anderen Rahmen an, ohne etwas umzustellen.
   */
  lesen(client: ApiClient, kontenrahmen?: DatevKontenrahmen): Promise<DatevSettings> {
    const pfad = kontenrahmen
      ? `/api/settings/datev?kontenrahmen=${encodeURIComponent(kontenrahmen)}`
      : '/api/settings/datev';
    return client.request<DatevSettings>('GET', pfad);
  },

  /**
   * PATCH /api/settings/datev/:key — genau eine Angabe ändern
   * (ADMIN + frische Zweitbestätigung). Mit dem Speichern gilt der Wert als
   * BESTAETIGT.
   */
  schreiben(
    client: ApiClient,
    schluessel: string,
    wert: string | number | boolean,
  ): Promise<DatevSettingUpdateResult> {
    return client.request<DatevSettingUpdateResult>(
      'PATCH',
      `/api/settings/datev/${encodeURIComponent(schluessel)}`,
      { value: wert },
    );
  },
};
