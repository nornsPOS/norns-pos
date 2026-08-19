/**
 * hardware-client — typed wrappers around every Tauri command.
 *
 * Single import surface for the React layer. Each function is a thin
 * `invoke<T>(...)` call with a hand-written signature that mirrors the
 * Rust struct in `src-tauri/src/commands/<module>.rs`. Keeping the wrappers
 * here (instead of inline `invoke` calls scattered across screens) means:
 *
 *   • One place to add logging / metrics.
 *   • One place to switch between real and offline-stub when running in
 *     pure-Web mode (Storybook, unit tests).
 *   • The discriminated `HardwareError` union surfaces uniformly so screens
 *     can pattern-match without re-deriving types.
 *
 * See memory.md §18.3 for the IPC contract table.
 */

import { thermalCols, useHardwareStore } from '../state/hardware-store.js';
import { type EtikettPlan, etikettPlan, etikettPlanFuerMedium } from './etikett-layout.js';
import type { Fiskalzustand } from './fiskalzustand-satz.js';
import { logoLaden } from './logo-lager.js';
import { invoke } from '@tauri-apps/api/core';

// ────────────────────────────────────────────────────────────────────────
// Shared error type — mirrors the Rust `HardwareError` serde tag.
// ────────────────────────────────────────────────────────────────────────

export type HardwareErrorKind =
  | 'network'
  | 'timeout'
  | 'device'
  | 'not_configured'
  | 'encoding'
  | 'local_io'
  | 'invalid_argument'
  | 'internal';

export interface HardwareError {
  kind: HardwareErrorKind;
  details: string;
}

/**
 * Type-guard for the shape Rust returns when a command fails. The Tauri
 * `invoke()` promise rejects with the serialized HardwareError object;
 * we narrow it here so callers can `if (isHardwareError(err)) { ... }`.
 */
export function isHardwareError(err: unknown): err is HardwareError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e.kind === 'string' && typeof e.details === 'string';
}

/**
 * Self-contained German message per HardwareError kind, each with an actionable
 * next step. The raw `details` (a technical Rust string like `lpr exited` or
 * `Permission denied`) is NEVER part of these sentences — it is a diagnostic
 * value for the log, not for the operator.
 */
const HARDWARE_ERROR_MESSAGES: Record<HardwareErrorKind, string> = {
  network: 'Keine Verbindung zum Gerät. Bitte Kabel und Netzwerk prüfen und erneut versuchen.',
  timeout:
    'Das Gerät antwortet nicht rechtzeitig. Bitte prüfen, ob es eingeschaltet und verbunden ist, und erneut versuchen.',
  device:
    'Das Gerät hat unerwartet reagiert. Bitte erneut versuchen; bleibt der Fehler, das Gerät neu starten.',
  not_configured: 'Das Gerät ist noch nicht eingerichtet. Bitte im Gerätemanager konfigurieren.',
  encoding: 'Die Daten konnten nicht verarbeitet werden. Bitte erneut versuchen.',
  local_io:
    'Eine lokale Datei konnte nicht gespeichert werden. Bitte Speicherplatz prüfen und erneut versuchen.',
  invalid_argument: 'Die Eingabe war ungültig. Bitte die Angaben prüfen und erneut versuchen.',
  internal: 'Es ist ein unerwarteter Fehler aufgetreten. Bitte erneut versuchen.',
};

/**
 * Human-facing German message for a HardwareError, suitable for a toast or
 * banner. The technical `details` are logged to the console as a diagnostic
 * side-channel and never surfaced to the operator (so `lpr exited` / a reqwest
 * error / `Permission denied` can no longer leak into the UI). Falls back to the
 * internal message for any unmapped kind.
 */
export function describeHardwareError(err: HardwareError): string {
  if (err.details) {
    console.warn(`[hardware:${err.kind}]`, err.details);
  }
  return HARDWARE_ERROR_MESSAGES[err.kind] ?? HARDWARE_ERROR_MESSAGES.internal;
}

// ────────────────────────────────────────────────────────────────────────
// Mandate 1 — Image compression
// ────────────────────────────────────────────────────────────────────────

export interface CompressOptions {
  quality: number;
  maxKb: number;
  minQuality: number;
}

export interface CompressResult {
  bytes: number[]; // serialised as JSON array; convert via `new Uint8Array(bytes)`
  sizeBytes: number;
  achievedQuality: number;
  width: number;
  height: number;
}

export async function compressToWebp(
  rgba: Uint8Array,
  width: number,
  height: number,
  options?: Partial<CompressOptions>,
): Promise<CompressResult> {
  return invoke<CompressResult>('compress_to_webp', {
    rgba: Array.from(rgba),
    width,
    height,
    options,
  });
}

/** Convenience: hand back a real `Blob` ready for `uploadBlobToR2`. */
export async function compressToWebpBlob(
  rgba: Uint8Array,
  width: number,
  height: number,
  options?: Partial<CompressOptions>,
): Promise<{ blob: Blob; result: CompressResult }> {
  const result = await compressToWebp(rgba, width, height, options);
  const blob = new Blob([new Uint8Array(result.bytes)], { type: 'image/webp' });
  return { blob, result };
}

// ────────────────────────────────────────────────────────────────────────
// Mandate 2-A — TSE (Fiskaly Cloud)
// ────────────────────────────────────────────────────────────────────────

export interface TseConfig {
  tssId: string;
  clientId: string;
  /**
   * Fiskaly secrets are NO LONGER carried by the React layer — they live in
   * the OS keychain and are hydrated INSIDE Rust before each call. These stay
   * optional only for a rare explicit override; normal flows omit them.
   */
  apiKey?: string;
  apiSecret?: string;
}

export interface TseStartParams {
  config: TseConfig;
  intentionId: string;
  processType: string;
}

export interface TseIntention {
  intentionId: string;
  fiskalyTransactionId: string;
  startedAt: string;
}

/**
 * fiskaly `payment_type`. Am 08.08.2026 gegen die Live-Spezifikation gemessen:
 * das enum lautet CASH / NON_CASH. Die alten Werte „Bar" und „Unbar" kommen
 * darin null Mal vor.
 */
export type TsePaymentKind = 'CASH' | 'NON_CASH';

/**
 * fiskaly `receipt_type` (DSFinV-K `BON_TYP`). Ein Verkauf ist `RECEIPT`, ein
 * Storno `ANNULATION`. Der Vorgangstyp `Kassenbeleg-V1` gehört NICHT hierher;
 * bis zum 08.08.2026 stand er genau hier.
 */
export type TseReceiptType =
  | 'RECEIPT'
  | 'TRAINING'
  | 'TRANSFER'
  | 'ORDER'
  | 'CANCELLATION'
  | 'ABORT'
  | 'BENEFIT_IN_KIND'
  | 'INVOICE'
  | 'OTHER'
  | 'ANNULATION';

export interface TseFinishParams {
  config: TseConfig;
  intentionId: string;
  fiskalyTransactionId: string;
  /** Vorzeichenbehaftet: ein Storno ist negativ, und die Spezifikation erlaubt das. */
  amountCents: number;
  paymentKind: TsePaymentKind;
  processDataBase64: string;
  /** TR-03151-Vorgangstyp, etwa `Kassenbeleg-V1`. */
  processType: string;
  /** DSFinV-K `BON_TYP`. Ohne Angabe behandelt die Rust-Seite es als RECEIPT. */
  receiptType?: TseReceiptType;
  /**
   * Bruttoaufteilung je Steuersatz für das signierte `amounts_per_vat_rate`.
   * PFLICHTFELD der Schnittstelle; auf der Leitung optional, damit eine alte
   * Zeile aus der dauerhaften Warteschlange signierbar bleibt.
   */
  amountsPerVatRate?: Array<{ vatRate: string; amountCents: number }>;
}

export interface TseSignature {
  signatureValue: string;
  signatureCounter: number;
  signatureAlgorithm: string;
  /**
   * Öffentlicher Schlüssel der Sicherungseinrichtung, den fiskaly zu JEDER
   * Signatur mitliefert. DSFinV-K führt ihn als `TSE_PUBLIC_KEY`; ohne ihn
   * kann ein Prüfer keine einzige Signatur nachrechnen.
   */
  signaturePublicKey: string;
  /** Seriennummer der Sicherungseinrichtung, DSFinV-K `TSE_SERIAL`. */
  tssSerialNumber: string;
  transactionNumber: number;
  /** Protokollzeit DER TSE, nicht die Uhr dieses Rechners. */
  startedAt: string;
  finishedAt: string;
  qrCodePayload: string;
}

export interface TseStatus {
  reachable: boolean;
  tssState: string | null;
  lastCheckedAt: string;
  message: string;
  /**
   * Sind die Signaturen dieser Kasse vor dem Finanzamt etwas wert?
   *
   * ⚠️ 15.08.2026: Bis heute konnte die Kasse mit EINER Umgebungsvariablen
   * gegen die fiskaly-Erprobung signieren, und nichts in der Flaeche sagte es.
   * Gruene Ampel, signierte Belege, QR-Codes, DSFinV-K-Ausfuhr — und jede
   * Signatur wertlos. Aufgefallen waere es am Tag der Kassennachschau.
   */
  rechtsgueltig: boolean;
  /** Die Adresse, gegen die wirklich signiert wird. */
  umgebungAdresse: string;
}

export const tseClient = {
  start(params: TseStartParams): Promise<TseIntention> {
    return invoke('tse_start_transaction', { params });
  },
  finish(params: TseFinishParams): Promise<TseSignature> {
    return invoke('tse_finish_transaction', { params });
  },
  status(config: TseConfig): Promise<TseStatus> {
    return invoke('tse_status', { config });
  },

  // ── OS-keychain credential management (secrets never touch localStorage) ──
  /** Store the Fiskaly key+secret in the OS keychain (write-only from JS). */
  storeCredentials(apiKey: string, apiSecret: string): Promise<void> {
    return invoke('tse_store_credentials', { apiKey, apiSecret });
  },
  /** True when both halves are present in the keychain. */
  credentialsPresent(): Promise<boolean> {
    return invoke('tse_credentials_present');
  },
  /** Remove the credential pair from the keychain. */
  clearCredentials(): Promise<void> {
    return invoke('tse_clear_credentials');
  },
};

// ────────────────────────────────────────────────────────────────────────
// Mandate 2-B — ZVT card terminal
// ────────────────────────────────────────────────────────────────────────

export interface ZvtEndpoint {
  ip: string;
  port: number;
}

export interface ZvtResult {
  success: boolean;
  authorizationCode: string | null;
  cardPanMasked: string | null;
  cardBrand: string | null;
  receiptText: string | null;
  errorMessage: string | null;
}

export const zvtClient = {
  check(endpoint: ZvtEndpoint): Promise<boolean> {
    return invoke('zvt_check_connection', { endpoint });
  },
  authorize(endpoint: ZvtEndpoint, amountCents: number): Promise<ZvtResult> {
    return invoke('zvt_authorize_payment', { endpoint, amountCents });
  },
  reverse(endpoint: ZvtEndpoint, authorizationCode: string): Promise<boolean> {
    return invoke('zvt_reverse_payment', { endpoint, authorizationCode });
  },
};

// ────────────────────────────────────────────────────────────────────────
// Epic B — product sticker labels (ZPL / ESC-POS)
// ────────────────────────────────────────────────────────────────────────

export type LabelMode = 'tcp' | 'system';
/**
 * Was der Etikettendrucker versteht.
 *
 * `RASTER` ist seit dem 26.07.2026 dabei und meint: GAR KEINE Sprache. DYMO,
 * Seiko und Brother QL nehmen keine Steuerbytes entgegen; sie bekommen ein
 * fertig gesetztes Etikett als Seite, und der Treiber des Betriebssystems
 * macht daraus die Rasterzeilen. Vorher passte Basels DYMO in keine der zwei
 * Sprachen und war damit von der Kasse aus überhaupt nicht zu bedrucken.
 */
export type LabelPrinterType = 'ZPL' | 'ESCPOS' | 'RASTER';

export interface LabelConfig {
  mode: LabelMode;
  ip?: string | undefined;
  port?: number | undefined;
  printerName?: string | undefined;
  printerType: LabelPrinterType;
}

export interface LabelData {
  sku: string;
  productName: string;
  weightGrams?: string | null;
  karat?: string | null;
  storageLocation?: string | null;
  /** Der Verkaufspreis als Text, z. B. „890.00". Nur der Rasterweg druckt ihn. */
  priceEur?: string | null;
  /**
   * Der gerechnete Bauplan des Etiketts.
   *
   * Wird HIER angehängt und nicht von den Aufrufstellen verlangt: die vier
   * Stellen, die Etiketten drucken, bauen ihre Datensätze je selbst, und eine
   * Angabe, die an vier Stellen gesetzt werden muss, fehlt irgendwann an einer.
   * Dann käme genau an einer Stelle nichts aus dem Drucker.
   */
  plan?: EtikettPlan | undefined;
}

/**
 * Den Bauplan anhängen — aber nur, wo er gebraucht wird.
 *
 * ZPL und ESC/POS lassen den Drucker selbst setzen; für sie wäre der Bauplan
 * nur Ballast (ein Etikett bringt einige hundert Rechtecke mit, ein Stapel
 * schnell ein Vielfaches davon über die Brücke).
 */
function mitBauplan(
  config: LabelConfig,
  labels: LabelData[],
  groesse?: string,
): LabelData[] {
  if (config.printerType !== 'RASTER') return labels;
  return labels.map((l) => ({
    ...l,
    plan: (groesse ? etikettPlanFuerMedium : etikettPlanOhneMedium)({
      sku: l.sku,
      name: l.productName,
      gewichtGramm: l.weightGrams ?? undefined,
      karat: l.karat ?? undefined,
      lagerort: l.storageLocation ?? undefined,
      preisEur: l.priceEur ?? undefined,
    }, groesse as string),
  }));
}

/** Ohne gewählte Grösse bleibt die Vorgabe — dieselbe wie bisher. */
function etikettPlanOhneMedium(inhalt: Parameters<typeof etikettPlan>[0]): EtikettPlan {
  return etikettPlan(inhalt);
}

export const labelClient = {
  /**
   * Einen Stapel Etiketten drucken. Antwortet mit der Anzahl.
   *
   * `groesse` ist der CUPS-Name des Mediums (z. B. `w54h144`). Fehlt er, gilt
   * die Vorgabe — so verhält sich jeder Aufrufer wie bisher, bis er die Wahl
   * wirklich durchreicht.
   */
  print(config: LabelConfig, labels: LabelData[], groesse?: string): Promise<number> {
    return invoke<number>('print_label', {
      config,
      labels: mitBauplan(config, labels, groesse),
      groesse: groesse ?? null,
    });
  },
  /**
   * One-tap reachability probe — opens a socket (tcp mode) or confirms the CUPS
   * queue exists (system mode) WITHOUT printing a sticker. Drives the
   * "verbunden / nicht erreichbar" badge and the app-start auto-connect sweep.
   */
  check(config: LabelConfig): Promise<boolean> {
    return invoke<boolean>('label_check_connection', { config });
  },
  /** Connection test — prints a single self-test sticker. */
  test(config: LabelConfig): Promise<number> {
    // Geht ABSICHTLICH über `print`: der Testdruck muss denselben Weg nehmen
    // wie der Ernstfall, sonst prüft er etwas anderes, als er behauptet.
    return labelClient.print(config, [
      {
        sku: 'W14-TEST-0000',
        productName: 'Etikettentest',
        weightGrams: null,
        karat: null,
        storageLocation: 'Gerätemanager',
      } satisfies LabelData,
    ]);
  },
};

// ────────────────────────────────────────────────────────────────────────
// Mandate 3-A — ESC/POS thermal receipt
// ────────────────────────────────────────────────────────────────────────

export interface ThermalEndpoint {
  ip: string;
  port: number;
  /**
   * USB / local mode. When set, the receipt prints as raw ESC/POS to this OS
   * print queue (CUPS) instead of over TCP — a USB receipt printer needs no IP.
   * Omit (or empty) for the classic network (9100) mode.
   */
  printerName?: string;
}

export interface ThermalLineItem {
  name: string;
  quantity: number;
  unitPriceEur: string;
  lineTotalEur: string;
  vatLabel: string;
}

export interface ThermalReceiptData {
  shopName: string;
  shopAddress: string[];
  shopVatId: string;
  /**
   * Die Steuernummer. § 14 Abs. 4 Nr. 2 UStG lässt sie ALTERNATIV zur
   * USt-IdNr. zu, und ein junger Betrieb hat oft nur sie. Beide Felder dürfen
   * leer sein, dann ist der Beleg gesperrt; genau eines genügt zum Drucken.
   */
  shopTaxNumber: string;
  shopPhone: string | null;
  receiptLocator: string;
  printedAt: string;
  cashierName: string;
  shiftId: string | null;
  items: ThermalLineItem[];
  subtotalEur: string;
  /**
   * ⚠️ NICHT DRUCKEN. Das ist die Steuer des GANZEN Belegs, einschliesslich
   * der Margensteuer nach § 25a, und die darf nicht gesondert ausgewiesen
   * werden (§ 14a Abs. 6 Satz 2 UStG). Das Feld bleibt für die interne
   * Aufzeichnung; gedruckt wird `vatDisclosableEur`.
   */
  vatEur: string;
  /**
   * Der Betrag, der als „MwSt." auf den Beleg DARF, oder `null` für „gar keine
   * Steuerzeile". Berechnet von `steuerausweisFuerBeleg` je Zeile, weil ein
   * Korb Regelware und Margenware mischen kann.
   *
   * Optional, damit ein älteres Rust-Abbild die Nutzlast weiterhin annimmt.
   * Fehlt das Feld, druckt die neue Fassung KEINE Steuerzeile: im Zweifel
   * lieber eine Angabe zu wenig als einen verbotenen Ausweis.
   */
  vatDisclosableEur?: string | null;
  /**
   * Die gesetzlich vorgeschriebenen Hinweise zu den angewandten
   * Sonderregelungen, etwa „Gebrauchtgegenstände/Sonderregelung".
   * § 14a Abs. 6 Satz 1 UStG verlangt sie, und zwar zusätzlich zum Weglassen
   * der Steuer.
   */
  specialSchemeNotices?: string[];
  totalEur: string;
  paymentMethodLabel: string;
  cashReceivedEur: string | null;
  changeEur: string | null;
  /**
   * § 6 Nr. 6 erste Haelfte — die Kassen-Seriennummer. Optional: der RUMPF
   * fuellt sie beim Drucken SELBST (print_thermal_receipt), die WebView
   * braucht und soll sie nicht kennen. Sichtbar wird sie nur im TSE-Ausfall.
   */
  kassenSeriennummer?: string | null;
  /**
   * § 6 Nr. 2 — der Vorgangsbeginn (ortszeitlich formatiert, wie printedAt).
   * Kommt aus der Vorgangs-Uhr; ohne sie bleibt das Feld weg und der
   * Ausfall-Bon zeigt die Zeiten nicht (ehrlich statt erfunden).
   */
  vorgangBeginn?: string | null;
  tseSignatureValue: string;
  tseSignatureCounter: string;
  tseTransactionNumber: string;
  tseQrPayload: string;
  footerLines: string[];
  /**
   * Which document this is. Absent = a sale (`VERKAUF`), the historical default.
   * `ANKAUF` makes the preview + PDF print an „Ankaufbeleg" heading and the
   * seller line. Optional so the Rust thermal struct (no `deny_unknown_fields`)
   * simply ignores it on the current binary; the footer still carries the legal
   * declaration there.
   */
  documentKind?: 'VERKAUF' | 'ANKAUF';
  /**
   * Der fiskalische Zustand DIESES Belegs, aus `lib/fiskalzustand-satz.ts`.
   *
   * ── WARUM DAS FELD ÜBERHAUPT ENTSTAND (13.08.2026) ──────────────────────
   *
   * Die Vorschau schloss bisher aus einer LEEREN Signatur auf „Signatur wird
   * nachgereicht". Aus einer fehlenden Signatur folgt das aber nicht: sie
   * fehlt genauso, wenn der Ausfall dauerhaft vermerkt ist (dann kommt NIE
   * eine), und wenn die Kasse gar keine Sicherungseinrichtung hinterlegt hat
   * (dann ist auch nie eine entstanden). Der Bildschirm versprach dem Kunden
   * am Tresen eine Nachreichung, die es für diesen Beleg nicht gibt.
   *
   * Wer den Beleg baut, KENNT den Zustand — die Zahlwege rechnen ihn ohnehin
   * aus. Er wird nur nicht mitgegeben. Genau das schliesst dieses Feld.
   *
   * Optional wie `documentKind`: die Rust-Schicht hat kein
   * `deny_unknown_fields` und überliest es auf der jetzigen Fassung. Fehlt
   * es, sagt die Vorschau nur, was sie sicher weiss.
   */
  fiskalzustand?: Fiskalzustand;
  /** The other party on an Ankaufbeleg, e.g. „Verkäufer: Hans Mustermann". */
  counterpartyLabel?: string | null;
  /**
   * Zeichen je Zeile: 32 bei 58-mm-Papier, 48 bei 80 mm. Fehlt das Feld,
   * druckt die Rust-Schicht mit 32 — dem Bild, das bisher aus dem Drucker kam.
   * Gesetzt wird es zentral in `thermalClient.print`, damit keine Aufrufstelle
   * es vergessen kann.
   */
  paperCols?: number;
  /**
   * Das Haendler-Logo fuer den Bonkopf (Basels Dekret, 26.07.2026) — das
   * BEREINIGTE ORIGINAL (svg/png/jpeg, base64), wie es `GET /api/shop-info`
   * liefert. Die Rust-Seite (thermal.rs, `logo_raster`) rastert selbst: SVG
   * ueber resvg je Papierbreite frisch, PNG/JPEG ueber die image-Kiste.
   * Fehlt es, druckt NIEMAND ein fremdes Bild — oben steht nur die dezente
   * norns.de-Systemzeile und der Ladenname als Text.
   *
   * Gesetzt wird alles ZENTRAL in `thermalClient` aus dem lokalen Logo-Lager
   * (Offline-Zwischenspeicher), wie `paperCols` — keine der vier
   * Aufrufstellen kann es vergessen, und ein Bon ohne Netz behaelt sein Logo.
   */
  logoBytesBase64?: string | null;
  /** 'svg' | 'png' | 'jpeg' — s. `logo_format` in thermal.rs. */
  logoFormat?: string | null;
  /** 'klein' | 'mittel' | 'gross' — feste Anteile, Rueckfall mittel. */
  logoSize?: string | null;
}

/**
 * Eine Zeile Papier, wie der Simulator sie aus dem ECHTEN Bytestrom liest —
 * Spiegel von `Papierzeile` in thermal.rs (Serialize, camelCase).
 */
export interface PapierZeile {
  text: string;
  mittig: boolean;
  fett: boolean;
  doppeltHoch: boolean;
  schriftB: boolean;
  /**
   * Ein `GS v 0`-Rasterbild (das Logo): die ECHTEN Bits aus dem Strom, als
   * PNG verpackt und base64-kodiert — die Vorschau zeigt das endgueltige
   * Druckbild, keinen Platzhalter.
   */
  rasterPngBase64?: string | null;
  rasterBreitePunkte?: number | null;
  rasterHoehePunkte?: number | null;
  /** Der Inhalt des QR, wenn diese Zeile der QR-Druckbefehl ist. */
  qrDaten?: string | null;
}

/** Die Antwort von `preview_thermal_receipt` — Spiegel von `ThermalPreview`. */
export interface ThermalPreview {
  /** Die Spaltenzahl, auf der die Zeilen gerechnet sind (32 oder 48). */
  paperCols: number;
  zeilen: PapierZeile[];
}

/**
 * Erkennt die Ablehnung eines NICHT REGISTRIERTEN Tauri-Befehls — so sieht
 * eine Kasse aus, deren Rust-Teil den Simulator-Befehl noch nicht traegt.
 * Tauri 2 lehnt mit einer Zeichenkette ab („… not found"), ein echter
 * Befehlsfehler kommt dagegen als HardwareError-Objekt. Die Unterscheidung
 * traegt die ehrliche Meldung („Vorschau braucht die neue Kassen-Version")
 * statt eines allgemeinen Fehlers.
 */
export function isCommandMissing(err: unknown): boolean {
  return typeof err === 'string' && err.toLowerCase().includes('not found');
}

/**
 * Ein Drucker, den das Betriebssystem sieht — eingerichtet oder nicht.
 *
 * `eingerichtet: false` heisst: angeschlossen und erkannt, aber ohne
 * Warteschlange. Genau in diesem Zustand war Basels Etikettendrucker am
 * 25.07.2026 — sichtbar für `lpinfo`, unsichtbar für jede Auswahlliste.
 */
export interface ErkannterDrucker {
  /** Name der Warteschlange, leer wenn es noch keine gibt. */
  queue: string;
  deviceUri: string;
  hersteller: string;
  modell: string;
  /** `usb`, `netzwerk` oder `andere`. */
  verbindung: string;
  rolle: 'BON' | 'ETIKETT' | 'A4' | 'UNBEKANNT';
  /** Warum diese Vermutung — wird dem Menschen gezeigt, nie verschwiegen. */
  begruendung: string;
  eingerichtet: boolean;
  /**
   * Welche Sprache das Gerät als Etikettendrucker verstünde.
   *
   * Die Erkennung weiss das aus Hersteller und Modell. Vor dem 26.07.2026 warf
   * sie es weg, und jeder übernommene DYMO blieb auf ZPL stehen — einer
   * Sprache, die er nicht kennt.
   */
  sprache: LabelPrinterType;
  /** Warum diese Sprache. Auch hier gilt: eine Vermutung ohne Grund ist wertlos. */
  spracheGrund: string;
}

/**
 * Ein Gerät, wie der USB-Bus es meldet — nicht wie CUPS es beschreibt.
 *
 * ⚠️ Der Unterschied ist der Punkt: `usb://DYMO/LabelWriter%20450?serial=…`
 * ist eine Zeichenkette, die das Drucksystem sich selbst zusammensetzt und die
 * es nur für Geräte gibt, die es schon kennt. Diese Angaben kommen aus dem
 * GERÄT und sind da, sobald es steckt.
 */
export interface UsbGeraet {
  herstellerId: number;
  produktId: number;
  hersteller: string | null;
  modell: string | null;
  seriennummer: string | null;
  istDrucker: boolean;
}

export const usbGeraete = {
  /** Alle angesteckten Drucker, direkt vom Bus. Ohne Warteschlange, ohne Rechte. */
  drucker(): Promise<UsbGeraet[]> {
    return invoke('usb_drucker_auflisten');
  },
};

export const druckerErkennung = {
  /** Alles finden: Warteschlangen UND angeschlossene Geräte ohne. */
  alle(): Promise<ErkannterDrucker[]> {
    return invoke<ErkannterDrucker[]>('detect_printers');
  },
  /**
   * Für ein angeschlossenes Gerät eine Warteschlange anlegen.
   *
   * Für ZPL und ESC/POS wird sie ROH angelegt: die Bytes gehen unverändert
   * durch, denn die Kasse spricht diese Sprachen selbst. Für einen
   * Rasterdrucker ist genau das die Sackgasse — er hat keine Sprache und
   * braucht den Systemtreiber. Deshalb geht die Sprache mit; ohne sie bleibt
   * es beim bisherigen rohen Weg.
   */
  warteschlangeAnlegen(
    deviceUri: string,
    name: string,
    sprache?: LabelPrinterType,
  ): Promise<string> {
    return invoke<string>('create_raw_queue', { deviceUri, name, sprache: sprache ?? null });
  },
};

/**
 * Das Haendler-Logo ZENTRAL anhaengen — dieselbe Lehre wie bei `paperCols`:
 * vier Stellen bauen Belegdatensaetze (Verkauf, Ankauf, Testdruck, Nachdruck),
 * und eine Angabe, die an vier Stellen gesetzt werden muss, fehlt irgendwann
 * an einer. Gelesen wird aus dem lokalen Logo-Lager, damit ein Bon OHNE NETZ
 * sein Logo behaelt (der shop-info-Weg hat keinen Offline-Speicher).
 *
 * Ein bereits gesetzter Wert bleibt stehen (die Logo-Vorschau im
 * Belegdesigner will einen noch UNGESPEICHERTEN Entwurf zeigen); explizites
 * `null` bleibt ebenfalls stehen und heisst „bewusst ohne Logo".
 */
function mitLogo(data: ThermalReceiptData): ThermalReceiptData {
  if (data.logoBytesBase64 !== undefined) return data;
  const logo = logoLaden();
  if (logo === null) {
    return { ...data, logoBytesBase64: null, logoFormat: null, logoSize: null };
  }
  return {
    ...data,
    logoBytesBase64: logo.datenBase64,
    logoFormat: logo.format,
    logoSize: logo.stufe,
  };
}

export const thermalClient = {
  /**
   * Einen Beleg drucken.
   *
   * Die Papierbreite wird HIER aus der Geraete-Einstellung gezogen, nicht von
   * den vier Aufrufstellen. Jede von ihnen baut ihren eigenen Datensatz
   * (Verkauf, Ankauf, Testdruck, Nachdruck), und eine Angabe, die an vier
   * Stellen gesetzt werden muss, ist eine, die irgendwann an einer fehlt — und
   * dann druckt genau ein Weg auf der falschen Breite.
   *
   * Ein bereits gesetzter Wert bleibt stehen, damit ein bewusster Testdruck
   * eine andere Breite erzwingen kann.
   */
  print(endpoint: ThermalEndpoint, data: ThermalReceiptData): Promise<void> {
    const cols = data.paperCols ?? thermalCols(useHardwareStore.getState().config.thermal);
    return invoke('print_thermal_receipt', { endpoint, data: mitLogo({ ...data, paperCols: cols }) });
  },
  /**
   * ⭐ Die Live-Vorschau aus ECHTEN Bytes (Basels Kernwunsch, 26.07.2026):
   * `preview_thermal_receipt` (thermal.rs) baut mit `build_escpos` DENSELBEN
   * Bytestrom, der drucken wuerde, und der Papiersimulator liest ihn zurueck
   * in Zeilen — samt der echten Rasterbits des Logos als PNG. Kein Papier
   * laeuft, kein zweiter Nachbau in React.
   *
   * Auf einer aelteren Kassen-Version fehlt der Befehl; Tauri lehnt dann mit
   * „not found" ab — `isCommandMissing` erkennt das, und die Flaeche sagt es
   * ehrlich, statt zu scheitern.
   */
  simulate(data: ThermalReceiptData): Promise<ThermalPreview> {
    const cols = data.paperCols ?? thermalCols(useHardwareStore.getState().config.thermal);
    return invoke<ThermalPreview>('preview_thermal_receipt', {
      data: mitLogo({ ...data, paperCols: cols }),
    });
  },
  /**
   * One-tap reachability probe — opens a socket to the receipt printer and
   * closes it WITHOUT sending bytes (so it never wakes the cutter). Drives the
   * "verbunden / nicht erreichbar" badge and the app-start auto-connect sweep.
   */
  check(endpoint: ThermalEndpoint): Promise<boolean> {
    return invoke<boolean>('thermal_check_connection', { endpoint });
  },
  /**
   * Auto-detect the most likely USB receipt printer among the OS print queues
   * and return its queue name (or null if none). Lets the operator just plug in
   * the printer — no IP, no manual pick.
   */
  detectReceiptPrinter(): Promise<string | null> {
    return invoke<string | null>('detect_receipt_printer');
  },
};

// ────────────────────────────────────────────────────────────────────────
// Mandate 3-B — A4 PDF
// ────────────────────────────────────────────────────────────────────────

// NOTE: invoice PDF generation moved to the native Typst backend. Build the
// invoice and get bytes via the `useInvoicePdf` hook (src/hooks/useInvoicePdf.ts),
// whose `InvoiceData` shape matches the current `generate_invoice_pdf` command.
// `pdfClient` below keeps only the (PDF-shape-agnostic) print + preview helpers.

export interface PrintA4Params {
  printerName: string;
  pdfBytes: number[];
}

export interface PdfPreviewResult {
  tempPath: string;
}

export const pdfClient = {
  print(printerName: string, pdfBytes: Uint8Array): Promise<void> {
    return invoke('print_a4', {
      params: { printerName, pdfBytes: Array.from(pdfBytes) },
    });
  },
  /**
   * Die A4-Rechnung DIREKT drucken: ein IPC-Aufruf, Quelle bis Papier.
   * Auf Windows rastert der Kern und druckt ueber den Herstellertreiber;
   * auf macOS/Linux setzt er das PDF und gibt es an die Warteschlange.
   * `data` ist dieselbe InvoiceData wie bei `generate_invoice_pdf`.
   */
  printInvoiceDirect(printerName: string, data: unknown): Promise<void> {
    return invoke('print_invoice_a4', { data, printerName });
  },
  preview(pdfBytes: Uint8Array): Promise<PdfPreviewResult> {
    return invoke('open_pdf_preview', { pdfBytes: Array.from(pdfBytes) });
  },
};

// ────────────────────────────────────────────────────────────────────────
// Mandate 4 — System printer probe
// ────────────────────────────────────────────────────────────────────────

export interface SystemPrinter {
  name: string;
  status: 'idle' | 'printing' | 'stopped' | 'unknown';
}

/**
 * Der Wirts-Steckbrief: was die Kasse ueber das Geraet weiss, auf dem sie
 * laeuft. Alles GEMESSEN vom Kern (sysinfo), nichts geraten; der
 * Datentraeger ist der, der die Kassendaten wirklich traegt.
 */
export interface WirtSteckbrief {
  betriebssystem: string;
  kern: string;
  architektur: string;
  rechnername: string;
  prozessor: string;
  kerne: number;
  speicherGesamtMb: number;
  speicherBenutztMb: number;
  plattePfad: string;
  platteGesamtGb: number;
  platteFreiGb: number;
}

export const systemClient = {
  listPrinters(): Promise<SystemPrinter[]> {
    return invoke<SystemPrinter[]>('list_system_printers');
  },
  wirtSteckbrief(): Promise<WirtSteckbrief> {
    return invoke<WirtSteckbrief>('wirt_steckbrief');
  },
};

// ────────────────────────────────────────────────────────────────────────
// Epic C — encrypted local KYC vault (GwG / GDPR)
// ────────────────────────────────────────────────────────────────────────

export type KycDocType = 'AUSWEIS' | 'REISEPASS' | 'AUFENTHALTSTITEL' | 'SONSTIGES';

export interface KycEncryptResult {
  /** Absolute path to the encrypted `.enc` vault file — persist on the record. */
  path: string;
  /** Hex SHA-256 of the original (plaintext) document bytes. */
  sha256: string;
}

/**
 * Encrypt an ID scan and store it in the local vault. The bytes never leave
 * the till unencrypted; the AES-256-GCM master key lives in the OS keyring.
 * Returns the opaque vault path + integrity hash to store against the customer.
 */
export async function encryptAndSaveKycDocument(
  fileBytes: Uint8Array,
  customerId: string,
  docType: KycDocType,
): Promise<KycEncryptResult> {
  return invoke<KycEncryptResult>('encrypt_and_save_kyc_document', {
    fileBytes: Array.from(fileBytes),
    customerId,
    docType,
  });
}

/** Decrypt a vault file back to bytes (e.g. to render a preview). */
export async function decryptAndLoadKycDocument(filePath: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('decrypt_and_load_kyc_document', { filePath });
  return new Uint8Array(bytes);
}

/**
 * Delete a vault ciphertext file (DSGVO Art. 17 erasure). The Rust side confines
 * the path to the vault directory; a file that is already gone resolves cleanly.
 */
export async function deleteKycDocument(filePath: string): Promise<void> {
  await invoke('delete_kyc_document', { filePath });
}

// ────────────────────────────────────────────────────────────────────────
// Tauri probe — useful to short-circuit hardware calls when the React app
// is being rendered outside Tauri (Vitest, Storybook).
// ────────────────────────────────────────────────────────────────────────

export function isRunningInTauri(): boolean {
  // Tauri 2 sets `window.__TAURI_INTERNALS__`; older builds set `__TAURI__`.
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}
