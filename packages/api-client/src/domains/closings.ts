/**
 * Closings + tax-export domain client. Mirrors
 * `apps/api-cloud/src/routes/closing-export.ts` exactly.
 *
 * `list` is JSON; the two export methods return the raw CSV body (the route
 * streams a file download) via `responseType: 'text'` — without it the client
 * would try to JSON.parse the CSV and fail. Step-up on the downloads is
 * server-enforced; the POS api-client interceptor handles the 403 → PIN → retry.
 */

import type { ApiClient } from '../client.js';

/**
 * Die beiden Kontenrahmen, die der Server kennt (`apps/api-cloud/src/lib/
 * kontenrahmen.ts`, Konstante `KONTENRAHMEN`). Mehr nimmt die Route nicht an.
 */
export const DATEV_KONTENRAHMEN = ['SKR03', 'SKR04'] as const;
export type DatevKontenrahmen = (typeof DATEV_KONTENRAHMEN)[number];

/**
 * Der Exportpfad, mit oder ohne Rahmenwahl.
 *
 * OHNE Parameter zu fahren ist NICHT dasselbe wie einen Vorgabewert
 * mitzuschicken: nur so entscheidet die gespeicherte Einstellung. Eine
 * Oberfläche, die hier vorsichtshalber „SKR03" einsetzt, würde eine
 * Einstellung überstimmen, die sie gar nicht gelesen hat.
 */
function datevExportPfad(id: string, kontenrahmen?: DatevKontenrahmen): string {
  const basis = `/api/closings/${encodeURIComponent(id)}/export/datev`;
  return kontenrahmen ? `${basis}?kontenrahmen=${encodeURIComponent(kontenrahmen)}` : basis;
}

export interface ClosingListItem {
  id: string;
  businessDay: string;
  state: 'COUNTING' | 'FINALIZED';
  verkaufCount: number;
  ankaufCount: number;
  stornoCount: number;
  netVerkaufEur: string;
  netAnkaufEur: string;
  cashVarianceEur: string | null;
  tseFailedCount: number;
  /**
   * Belege dieses Tages ohne Signatur zum Abschlusszeitpunkt.
   *
   * ⚠️ `tseFailedCount` allein genügt NICHT: der Motor schreibt es als feste
   * Null, weil es keine Quelle gibt, die „fehlgeschlagen" von „ausstehend"
   * unterscheidet. Wer nur darauf schaut, liest auf jeder Zeile grün.
   */
  tsePendingCount: number;
  finalizedAt: string | null;
}

export interface ClosingListResponse {
  items: ClosingListItem[];
  /**
   * Wie viele Abschlüsse dem Filter INSGESAMT entsprechen, auch die, die auf
   * dieser Seite nicht mitkommen.
   *
   * ⚠️ Ohne diese Zahl kann eine Fläche „steht nicht auf dieser Seite" nicht
   * von „gibt es nicht" unterscheiden. Genau daran scheiterte am 05.08.2026
   * die Kassennachschau.
   */
  gesamt: number;
  /** Wahr, wenn hinter dieser Seite noch etwas liegt. */
  weitere: boolean;
}

/** Zeitraum und Blätterung für `closingsApi.list`. */
export interface ClosingListFilter {
  /** Erster Berliner Geschäftstag, einschliesslich, als `JJJJ-MM-TT`. */
  from?: string;
  /** Letzter Berliner Geschäftstag, einschliesslich. */
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ClosingFinalizeResult {
  id: string;
  businessDay: string;
  state: 'FINALIZED';
  verkaufCount: number;
  ankaufCount: number;
  stornoCount: number;
  grossVerkaufEur: string;
  netVerkaufEur: string;
  cashExpectedEur: string;
  cashCountedEur: string;
  cashVarianceEur: string;
  finalizedAt: string;
}

export const closingsApi = {
  /**
   * GET /api/closings — Kassenabschlüsse (ADMIN oder READONLY).
   *
   * ⚠️ OHNE Zeitraum kommen nur die 90 NEUESTEN. Wer einen alten Monat sucht
   * — und ein Prüfer tut genau das — muss `from` und `to` mitgeben, sonst
   * fehlt der Tag, den es sehr wohl gibt. Bis zum 06.08.2026 war das gar
   * nicht möglich, und die Kasse meldete den Monat als nicht vorhanden.
   */
  list(client: ApiClient, filter: ClosingListFilter = {}): Promise<ClosingListResponse> {
    const teile: string[] = [];
    if (filter.from !== undefined) teile.push(`from=${encodeURIComponent(filter.from)}`);
    if (filter.to !== undefined) teile.push(`to=${encodeURIComponent(filter.to)}`);
    if (filter.limit !== undefined) teile.push(`limit=${filter.limit}`);
    if (filter.offset !== undefined) teile.push(`offset=${filter.offset}`);
    const frage = teile.length > 0 ? `?${teile.join('&')}` : '';
    return client.request<ClosingListResponse>('GET', `/api/closings${frage}`);
  },
  /**
   * POST /api/closings/finalize — write the legal Z-Bon (Tagesabschluss) for a
   * business day (ADMIN + step-up). Omit `businessDay` for the current day.
   *
   * ── ⚠️ DER AUSWEG, DEN BIS ZUM 08.08.2026 NIEMAND ERREICHTE ─────────────
   *
   * Der Server hält den Abschluss an, wenn der Tag Belege ohne TSE-Signatur
   * trägt, und lässt ihn nur mit einer ausdrücklichen Bestätigung durch
   * (`closings-finalize.ts:497`). Das ist richtig: ein Tag mit fehlenden
   * Signaturen soll nicht aus Versehen zugehen.
   *
   * Diese Fassung konnte die Bestätigung gar nicht senden. Der Rumpf war
   * höchstens `{ businessDay }`, und im ganzen Baum gab es NULL Sender
   * ausserhalb der Tests. Damit war der Tag nicht „geschützt", sondern für
   * immer offen — und § 146 Abs. 1 Satz 2 AO verlangt, dass er geschlossen
   * wird.
   *
   * @param unsignierteBelegeBestaetigt Der Mensch hat die Zahl der
   *   unsignierten Belege gesehen und schliesst trotzdem ab. Der Server
   *   schreibt diese Bestätigung unveränderlich in die Notiz der
   *   Abschlusszeile, wo der Prüfer sie findet.
   */
  finalize(
    client: ApiClient,
    businessDay?: string,
    unsignierteBelegeBestaetigt?: boolean,
  ): Promise<ClosingFinalizeResult> {
    const rumpf: { businessDay?: string; unsignierteBelegeBestaetigt?: boolean } = {};
    if (businessDay) rumpf.businessDay = businessDay;
    // Nur senden, wenn wirklich bestätigt wurde. Ein `false` im Rumpf sähe aus
    // wie eine Entscheidung, die niemand getroffen hat.
    if (unsignierteBelegeBestaetigt === true) rumpf.unsignierteBelegeBestaetigt = true;
    return client.request<ClosingFinalizeResult>('POST', '/api/closings/finalize', rumpf);
  },
  /**
   * GET /api/closings/:id/export/datev — DATEV EXTF CSV (ADMIN|READONLY + step-up).
   *
   * `kontenrahmen` ist die Wahl beim Export, seit dem 26.07.2026. Wird nichts
   * mitgegeben, entscheidet der SERVER anhand der gespeicherten Einstellung
   * `datev.sachkontenrahmen` — die Oberfläche rät also nie, welcher Rahmen
   * gilt. Ein unbekannter Wert kommt als 400 mit deutscher Meldung zurück.
   */
  datevCsv(client: ApiClient, id: string, kontenrahmen?: DatevKontenrahmen): Promise<ArrayBuffer> {
    // ⚠️ 30.07.2026 — BYTES, NICHT TEXT. Hier stand `responseType: 'text'`.
    //
    // Der Server sendet den Stapel absichtlich als rohe Windows-1252-Bytes
    // (`closing-export.ts`: `reply.type('text/csv; charset=windows-1252')`
    // plus `kodiereAnsi(csv)`), weil DATEV genau das erwartet. Der Klient las
    // ihn mit `res.text()`, und `Response.text()` dekodiert laut Spezifikation
    // IMMER als UTF-8 und ignoriert den Zeichensatz im Kopf.
    //
    // Gemessen: aus dem Byte 0xFC (ü) wurden EF BF BD, also das Ersatzzeichen.
    // Ein Byte wurde zu dreien, und der Weg zurück existiert nicht. Jede
    // Buchung mit Umlaut im Text kam beim Steuerberater verstümmelt an.
    //
    // Wer das hier je wieder auf 'text' stellt, zerstört die Datei erneut.
    return client.request<ArrayBuffer>(
      'GET',
      datevExportPfad(id, kontenrahmen),
      undefined,
      { responseType: 'arraybuffer' },
    );
  },

  /**
   * Wie `datevCsv`, gibt aber den Dateinamen mit, den der SERVER genannt hat.
   *
   * Bei DATEV ist der Name Teil des Vertrags: er muss mit `EXTF_` beginnen und
   * Berater- und Mandantennummer tragen, sonst erscheint die Datei in der
   * Stapelverarbeitung des Steuerberaters gar nicht. Nur der Server kennt
   * diese Nummern, also darf ihn keine Oberfläche erfinden.
   */
  datevDatei(
    client: ApiClient,
    id: string,
    kontenrahmen?: DatevKontenrahmen,
  ): Promise<{ inhalt: ArrayBuffer; dateiname: string | null }> {
    // Bytes, aus demselben Grund wie bei `datevCsv` darüber.
    return client.requestMitDateiname<ArrayBuffer>(
      'GET',
      datevExportPfad(id, kontenrahmen),
      undefined,
      { responseType: 'arraybuffer' },
    );
  },
  /** GET /api/closings/:id/export/kassenbericht — Kassenbericht CSV (ADMIN|READONLY + step-up). */
  kassenberichtCsv(client: ApiClient, id: string): Promise<string> {
    return client.request<string>(
      'GET',
      `/api/closings/${encodeURIComponent(id)}/export/kassenbericht`,
      undefined,
      { responseType: 'text' },
    );
  },
  /**
   * GET /api/closings/:id/export/dsfinvk?encoding=base64 — local DSFinV-K
   * bundle ZIP (ADMIN|READONLY + step-up), returned base64-encoded in a text
   * body. The api-client file path is text-only (it can't carry binary), so the
   * caller decodes the base64 → Blob before triggering the download.
   */
  /**
   * Kassennachschau (§ 146b AO): alle Exporte eines Zeitraums als EIN ZIP.
   * Die Verfahrensdokumentation entsteht im Rumpf (typst) und reist als
   * base64 mit, damit der Pruefer eine einzige Datei bekommt.
   */
  prueferPaket(
    client: ApiClient,
    body: { von: string; bis: string; verfahrensdokuPdfBase64?: string },
  ): Promise<{
    ok: true;
    dateiname: string;
    zipBase64: string;
    tage: number;
    ketteUnversehrt: boolean;
  }> {
    return client.request('POST', '/api/pruefer/paket', body);
  },

  dsfinvkZipBase64(client: ApiClient, id: string): Promise<string> {
    return client.request<string>(
      'GET',
      `/api/closings/${encodeURIComponent(id)}/export/dsfinvk?encoding=base64`,
      undefined,
      { responseType: 'text' },
    );
  },
};
