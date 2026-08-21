/**
 * Hardware-config store.
 *
 * Persists every endpoint the POS talks to (thermal printer, A4 printer,
 * ZVT terminal, Fiskaly TSE). Settings live in three places, written in
 * this order on every PATCH:
 *
 *   1. Zustand (in-memory) — instant UI updates.
 *   2. localStorage — survives webview reload, present before network is up.
 *   3. PATCH /api/system-settings/:key — audit-logged source of truth.
 *
 * On cold boot we hydrate from localStorage first, then revalidate
 * asynchronously via the API. The Gerätemanager screen drives the
 * "Test Connection" calls into hardware-client.
 */

import { Type } from '@sinclair/typebox';
import { create } from 'zustand';

import { parseResponse } from '@norns/api-client';

const LOCAL_KEY = 'warehouse14.hardware-config.v1';

// ── Persisted-config validation (P2.6) ──────────────────────────────────────
// localStorage is an UNTRUSTED boundary: a corrupt/tampered value flows straight
// into `zvtClient.authorize` / the TSE client. A non-numeric `zvt.port` or a
// garbage `zvt.ip` MUST fall back to the safe default, never reach the terminal.
// Each sub-object is merged over DEFAULT (forward-compat: a newly-added field is
// filled) THEN validated; a hard type violation (e.g. a string port) drops the
// WHOLE sub-object to DEFAULT rather than trusting a partially-bad config.
const Port = Type.Integer({ minimum: 1, maximum: 65535 });
const NullableBool = Type.Union([Type.Boolean(), Type.Null()]);
const NullableStr = Type.Union([Type.String(), Type.Null()]);

const ThermalSchema = Type.Object({
  mode: Type.Union([Type.Literal('network'), Type.Literal('usb')]),
  ip: Type.String(),
  port: Port,
  printerName: Type.String(),
  lastReachable: NullableBool,
  lastCheckedAt: NullableStr,
  // Nur die zwei Breiten, die es real gibt. Ein anderer Wert aus einem
  // manipulierten localStorage wuerfe die GANZE Drucker-Einstellung auf die
  // Vorgabe zurueck — genau die Absicht dieser Pruefung.
  paperWidthMm: Type.Union([Type.Literal(58), Type.Literal(80)]),
});
const A4Schema = Type.Object({ printerName: Type.String() });
/**
 * AUSGEFÜHRT, damit ein Wächter das Schema selbst prüfen kann statt sein
 * Verhalten nachzubauen. Ein nachgebauter Prüfer wäre grün, während der echte
 * die Einstellung verwirft — genau die Art Wächter, die nichts bewacht.
 */
export const LABEL_SCHEMA_FUER_PRUEFUNG = Type.Object({
  mode: Type.Union([Type.Literal('tcp'), Type.Literal('system')]),
  ip: Type.String(),
  port: Port,
  printerName: Type.String(),
  // Drei Sprachen, weil es drei Bauarten gibt. RASTER ist keine Sprache im
  // Wortsinn: das Gerät versteht überhaupt keine Steuerbytes und bekommt eine
  // fertige Seite, die sein Herstellertreiber rastert. DYMO, Seiko, Brother QL.
  printerType: Type.Union([
    Type.Literal('ZPL'),
    Type.Literal('ESCPOS'),
    Type.Literal('RASTER'),
  ]),
  lastReachable: NullableBool,
  lastCheckedAt: NullableStr,
});
const LabelSchema = LABEL_SCHEMA_FUER_PRUEFUNG;
const ZvtSchema = Type.Object({
  ip: Type.String(),
  port: Port,
  lastReachable: NullableBool,
  lastCheckedAt: NullableStr,
});
const TseSchema = Type.Object({
  tssId: Type.String(),
  clientId: Type.String(),
  credentialsStored: Type.Boolean(),
  lastReachable: NullableBool,
  lastCheckedAt: NullableStr,
  lastSyncAt: NullableStr,
});
const Baud = Type.Integer({ minimum: 300, maximum: 921600 });
const ScaleSchema = Type.Object({
  portPath: Type.String(),
  baudRate: Baud,
});

/** Merge a persisted sub-object over its default, then validate; bad → default. */
function validateSection<T extends object>(
  schema: Parameters<typeof parseResponse>[0],
  fallback: T,
  raw: unknown,
  label: string,
): T {
  const candidate =
    raw !== null && typeof raw === 'object' ? { ...fallback, ...(raw as object) } : fallback;
  return (parseResponse(schema, candidate, label) as T | null) ?? fallback;
}

export interface ThermalConfig {
  /** 'network' = TCP 9100 socket; 'usb' = OS print queue via CUPS raw (no IP). */
  mode: 'network' | 'usb';
  ip: string;
  port: number; // typical 9100
  /** USB mode: the OS print-queue name (e.g. 'Norns-Bon'). */
  printerName: string;
  /** Last-known status from `zvtClient.check` / printer probe. */
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
  /**
   * Die Rollenbreite: 58 mm oder 80 mm.
   *
   * WARUM DAS EINE EINSTELLUNG IST UND KEINE ANNAHME (25.07.2026)
   * Der Aufbau des Belegs rechnete fest mit 32 Zeichen je Zeile und der
   * Kommentar dazu behauptete, das passe auf 80 mm. Das stimmt nicht: 80 mm
   * tragen bei Schrift A 48 Zeichen, 32 ist die Breite von 58 mm. Ein
   * 80-mm-Drucker druckte also auf zwei Dritteln des Papiers, und der QR-Code
   * wurde für die falsche Breite gerechnet.
   *
   * Vorgabe bleibt 58, weil das dem bisher gedruckten Bild entspricht. Ein
   * Kassenzettel, der sich beim Aktualisieren von selbst umbaut, wäre
   * schlimmer als einer, der schmal bleibt.
   */
  paperWidthMm: 58 | 80;
}

/** Zeichen je Zeile bei Schrift A. Die einzige Stelle, die das umrechnet. */
export function thermalCols(cfg: ThermalConfig): number {
  return cfg.paperWidthMm === 80 ? 48 : 32;
}

export interface A4PrinterConfig {
  /** OS print-queue name as returned by `list_system_printers()`. */
  printerName: string;
}

export interface LabelPrinterConfig {
  /** 'tcp' = network 9100 socket; 'system' = CUPS queue via lpr -o raw. */
  mode: 'tcp' | 'system';
  /** Network mode: printer IP. */
  ip: string;
  port: number; // typical 9100
  /** System mode: OS print-queue name. */
  printerName: string;
  /** Command dialect the printer speaks. */
  /**
   * Die Bauart des Geräts. `RASTER` heisst: keine eigene Druckersprache, das
   * Etikett geht als gesetzte Seite über die Warteschlange des Systems.
   */
  printerType: 'ZPL' | 'ESCPOS' | 'RASTER';
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
}

export interface ZvtTerminalConfig {
  ip: string;
  port: number; // typical 20007
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
}

export interface TseFiskalyConfig {
  tssId: string;
  clientId: string;
  /**
   * The Fiskaly api_key/api_secret are NO LONGER stored here. They live in the
   * OS keychain (written via `tseClient.storeCredentials`, hydrated inside Rust).
   * This is a non-secret UI hint: are credentials present in the keychain?
   */
  credentialsStored: boolean;
  /** Last status returned by `tse_status`. */
  lastReachable: boolean | null;
  lastCheckedAt: string | null;
  lastSyncAt: string | null;
}

export interface ScaleConfig {
  /** Serial port path, e.g. '/dev/tty.usbserial-XYZ' (macOS) or 'COM3' (Windows). */
  portPath: string;
  baudRate: number; // typical 9600 for MT-SICS
}

export interface HardwareConfig {
  thermal: ThermalConfig;
  a4: A4PrinterConfig;
  label: LabelPrinterConfig;
  zvt: ZvtTerminalConfig;
  tse: TseFiskalyConfig;
  scale: ScaleConfig;
}

const DEFAULT: HardwareConfig = {
  thermal: {
    mode: 'network',
    ip: '',
    port: 9100,
    printerName: '',
    lastReachable: null,
    lastCheckedAt: null,
    paperWidthMm: 58,
  },
  a4: { printerName: '' },
  label: {
    mode: 'system',
    ip: '',
    port: 9100,
    printerName: '',
    printerType: 'ZPL',
    lastReachable: null,
    lastCheckedAt: null,
  },
  zvt: { ip: '', port: 20007, lastReachable: null, lastCheckedAt: null },
  tse: {
    tssId: '',
    clientId: '',
    credentialsStored: false,
    lastReachable: null,
    lastCheckedAt: null,
    lastSyncAt: null,
  },
  scale: { portPath: '', baudRate: 9600 },
};

/** Die Gerätearten, für die es überhaupt einen Erreichbarkeits-Stempel gibt. */
export type HardwareProbeKind = 'thermal' | 'label' | 'zvt' | 'tse';

/**
 * DER EINE WEG, auf dem ein Erreichbarkeits-Stempel entsteht.
 *
 * FUND (26.07.2026): Es gab keinen. Der Sammellauf schrieb den Stempel mit
 * `setThermal`/`setLabel`/`setZvt` an drei Stellen selbst, und die beiden
 * echten Druckstellen — Beleg und Etikett — schrieben ihn GAR NICHT. Ein
 * Druck, der am Tresen scheiterte, fasste die Marke also nie an: der Punkt
 * blieb grün, auch nach dem zehnten Fehlschlag. Wer eine Messung hat, meldet
 * sie hier, und nur hier.
 */
export function markDeviceReachable(kind: HardwareProbeKind, reachable: boolean): void {
  const s = useHardwareStore.getState();
  const patch = { lastReachable: reachable, lastCheckedAt: new Date().toISOString() };
  if (kind === 'thermal') s.setThermal(patch);
  else if (kind === 'label') s.setLabel(patch);
  else if (kind === 'zvt') s.setZvt(patch);
  else s.setTse(patch);
}

interface HardwareState {
  config: HardwareConfig;
  loaded: boolean;
  setThermal: (patch: Partial<ThermalConfig>) => void;
  setA4: (patch: Partial<A4PrinterConfig>) => void;
  setLabel: (patch: Partial<LabelPrinterConfig>) => void;
  setZvt: (patch: Partial<ZvtTerminalConfig>) => void;
  setTse: (patch: Partial<TseFiskalyConfig>) => void;
  setScale: (patch: Partial<ScaleConfig>) => void;
  hydrateFromLocal: () => void;
  /** Replace the whole config (used after a successful API revalidation). */
  replaceAll: (next: HardwareConfig) => void;
}

export const useHardwareStore = create<HardwareState>((set, get) => ({
  config: DEFAULT,
  loaded: false,

  setThermal: (patch) => {
    const next = { ...get().config, thermal: { ...get().config.thermal, ...patch } };
    persist(next);
    set({ config: next });
  },
  setA4: (patch) => {
    const next = { ...get().config, a4: { ...get().config.a4, ...patch } };
    persist(next);
    set({ config: next });
  },
  setLabel: (patch) => {
    const next = { ...get().config, label: { ...get().config.label, ...patch } };
    persist(next);
    set({ config: next });
  },
  setZvt: (patch) => {
    const next = { ...get().config, zvt: { ...get().config.zvt, ...patch } };
    persist(next);
    set({ config: next });
  },
  setTse: (patch) => {
    const next = { ...get().config, tse: { ...get().config.tse, ...patch } };
    persist(next);
    set({ config: next });
  },
  setScale: (patch) => {
    const next = { ...get().config, scale: { ...get().config.scale, ...patch } };
    persist(next);
    set({ config: next });
  },
  hydrateFromLocal: () => {
    if (get().loaded) return;
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // Validate EACH section independently so one corrupt sub-object (e.g. a
        // tampered zvt.port) falls back to its default without nuking the rest.
        const merged: HardwareConfig = {
          thermal: validateSection(ThermalSchema, DEFAULT.thermal, parsed.thermal, 'hw.thermal'),
          a4: validateSection(A4Schema, DEFAULT.a4, parsed.a4, 'hw.a4'),
          label: validateSection(LabelSchema, DEFAULT.label, parsed.label, 'hw.label'),
          zvt: validateSection(ZvtSchema, DEFAULT.zvt, parsed.zvt, 'hw.zvt'),
          tse: validateSection(TseSchema, DEFAULT.tse, parsed.tse, 'hw.tse'),
          scale: validateSection(ScaleSchema, DEFAULT.scale, parsed.scale, 'hw.scale'),
        };
        // Ein aus dem Speicher gelesener Stand ist eine ERINNERUNG, keine
        // Messung. Alte Installationen tragen dort noch ein `true` von gestern,
        // deshalb wird hier zusaetzlich geleert und nicht nur beim Schreiben.
        set({ config: withoutLiveness(merged), loaded: true });
        return;
      }
    } catch {
      // Corrupt storage — fall through to defaults.
    }
    set({ loaded: true });
  },
  replaceAll: (next) => {
    persist(next);
    set({ config: next });
  },
}));

/**
 * FUND (26.07.2026): Der Erreichbarkeits-Stempel wurde mitgespeichert.
 *
 * `lastReachable` und `lastCheckedAt` beschreiben EINE Messung von vorhin, nicht
 * eine Einstellung. Trotzdem landeten sie im Browserspeicher. Am Tresen hiess
 * das: die Kasse startet morgens neu und zeigt sofort das Gruen von gestern
 * Abend — bevor irgendetwas geprueft wurde. Rutschte ueber Nacht ein Kabel
 * heraus, stand der Punkt trotzdem auf verbunden, und der erste Beleg, der
 * nicht kam, war die Entdeckung.
 *
 * Eine Erreichbarkeit ist nur so lange gueltig, wie das Programm laeuft, das sie
 * gemessen hat. Nach einem Kaltstart ist der ehrliche Stand „noch nicht
 * geprueft" (null) — der Sammellauf fuellt ihn Sekunden spaeter mit einer
 * echten Messung.
 */
function withoutLiveness(config: HardwareConfig): HardwareConfig {
  const ungeprueft = { lastReachable: null, lastCheckedAt: null } as const;
  return {
    ...config,
    thermal: { ...config.thermal, ...ungeprueft },
    label: { ...config.label, ...ungeprueft },
    zvt: { ...config.zvt, ...ungeprueft },
    tse: { ...config.tse, ...ungeprueft },
  };
}

function persist(config: HardwareConfig): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(withoutLiveness(config)));
  } catch {
    // QuotaExceeded — UI surfaces an error if it cares.
  }
}
