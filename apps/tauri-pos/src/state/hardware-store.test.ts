/**
 * Phase-2 P2.6 — hardware-store hydration validates the persisted config.
 *
 * localStorage is untrusted: a corrupt/tampered `zvt.port` or `zvt.ip` must NOT
 * reach `zvtClient.authorize`. This is the safety-critical case — each section
 * is validated independently and a bad one falls back to its default.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markDeviceReachable, useHardwareStore } from './hardware-store.js';

const KEY = 'warehouse14.hardware-config.v1';

function stubLocalStorage(store: Map<string, string>): void {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
}

describe('hardware-store hydrateFromLocal validation', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    stubLocalStorage(store);
    useHardwareStore.setState({ loaded: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drops the zvt section to default when zvt.port is a string', () => {
    store.set(
      KEY,
      JSON.stringify({
        zvt: { ip: '10.0.0.5', port: '20007', lastReachable: null, lastCheckedAt: null },
      }),
    );
    useHardwareStore.getState().hydrateFromLocal();
    const { zvt } = useHardwareStore.getState().config;
    expect(zvt.port).toBe(20007); // the DEFAULT, NOT the tampered string
    expect(zvt.ip).toBe(''); // the whole section fell back, never reaching zvtClient
  });

  it('drops the zvt section when zvt.port is out of range', () => {
    store.set(
      KEY,
      JSON.stringify({
        zvt: { ip: '10.0.0.5', port: 70000, lastReachable: null, lastCheckedAt: null },
      }),
    );
    useHardwareStore.getState().hydrateFromLocal();
    expect(useHardwareStore.getState().config.zvt.port).toBe(20007);
  });

  it('keeps a valid zvt config intact, aber OHNE den Erreichbarkeits-Stempel', () => {
    store.set(
      KEY,
      JSON.stringify({
        zvt: { ip: '10.0.0.5', port: 20007, lastReachable: true, lastCheckedAt: '2026-06-16' },
      }),
    );
    useHardwareStore.getState().hydrateFromLocal();
    // Diese Erwartung stand bis zum 26.07.2026 auf `lastReachable: true` und
    // hat den Fehler damit festgeschrieben: eine grüne Prüfung dafür, dass die
    // Kasse nach einem Kaltstart das Grün von gestern zeigt. Die Anschrift ist
    // eine Einstellung und bleibt; die Erreichbarkeit war eine Messung von
    // gestern und ist nach einem Neustart schlicht unbekannt.
    expect(useHardwareStore.getState().config.zvt).toEqual({
      ip: '10.0.0.5',
      port: 20007,
      lastReachable: null,
      lastCheckedAt: null,
    });
  });

  it('total garbage → all defaults, loaded true', () => {
    store.set(KEY, '{');
    useHardwareStore.getState().hydrateFromLocal();
    expect(useHardwareStore.getState().loaded).toBe(true);
    expect(useHardwareStore.getState().config.zvt.port).toBe(20007);
    expect(useHardwareStore.getState().config.thermal.port).toBe(9100);
  });
});

describe('hardware-store scale section (Phase 4.1)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    stubLocalStorage(store);
    useHardwareStore.setState({ loaded: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('persists a chosen scale port and restores it on hydrate', () => {
    useHardwareStore.getState().setScale({ portPath: '/dev/tty.usbserial-A1', baudRate: 9600 });
    // A fresh cold-boot hydrate must read the same value back from localStorage.
    useHardwareStore.setState({ loaded: false });
    useHardwareStore.getState().hydrateFromLocal();
    expect(useHardwareStore.getState().config.scale).toEqual({
      portPath: '/dev/tty.usbserial-A1',
      baudRate: 9600,
    });
  });

  it('drops the scale section to default when baudRate is a string', () => {
    store.set(KEY, JSON.stringify({ scale: { portPath: '/dev/ttyUSB0', baudRate: '9600' } }));
    useHardwareStore.getState().hydrateFromLocal();
    expect(useHardwareStore.getState().config.scale).toEqual({ portPath: '', baudRate: 9600 });
  });

  it('defaults the scale section when it is absent from an otherwise valid config', () => {
    store.set(
      KEY,
      JSON.stringify({
        zvt: { ip: '10.0.0.5', port: 20007, lastReachable: null, lastCheckedAt: null },
      }),
    );
    useHardwareStore.getState().hydrateFromLocal();
    expect(useHardwareStore.getState().config.scale).toEqual({ portPath: '', baudRate: 9600 });
  });
});

/**
 * Ein vollständiger, GÜLTIGER gespeicherter Stand mit einem Stempel von gestern
 * Abend. Er muss die Prüfung des Speichers bestehen, sonst fiele die ganze
 * Einstellung auf die Vorgabe zurück und die Marke wäre nur zufällig leer —
 * die Prüfung unten wäre dann aus dem falschen Grund grün.
 */
const STAND_VON_GESTERN = {
  thermal: {
    mode: 'usb',
    ip: '',
    port: 9100,
    printerName: 'Warehouse14-Bon',
    lastReachable: true,
    lastCheckedAt: '2026-07-25T18:04:00.000Z',
    paperWidthMm: 58,
  },
  a4: { printerName: 'Buero-A4' },
  label: {
    mode: 'system',
    ip: '',
    port: 9100,
    printerName: 'Warehouse14-Etikett',
    printerType: 'ZPL',
    lastReachable: true,
    lastCheckedAt: '2026-07-25T18:04:00.000Z',
  },
  zvt: {
    ip: '192.168.1.50',
    port: 20007,
    lastReachable: true,
    lastCheckedAt: '2026-07-25T18:04:00.000Z',
  },
  tse: {
    tssId: 'tss-1',
    clientId: 'client-1',
    credentialsStored: true,
    lastReachable: true,
    lastCheckedAt: '2026-07-25T18:04:00.000Z',
    lastSyncAt: '2026-07-25T18:04:00.000Z',
  },
  scale: { portPath: '/dev/tty.usbserial-XYZ', baudRate: 9600 },
};

/**
 * DER FUND (26.07.2026): Der Erreichbarkeits-Stempel wurde mitgespeichert.
 *
 * Am Tresen: die Kasse startet morgens neu und zeigt sofort das Grün von
 * gestern Abend, bevor irgendetwas geprüft wurde. Rutschte über Nacht ein Kabel
 * heraus, stand der Punkt trotzdem auf verbunden — und der erste Beleg, der
 * nicht kam, war die Entdeckung. Der Belegdruck ist Pflicht, also stand damit
 * der Verkauf.
 */
describe('Kaltstart: „noch nicht geprüft" statt dem Grün von gestern', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    stubLocalStorage(store);
    useHardwareStore.setState({ loaded: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leert beim Laden JEDEN Erreichbarkeits-Stempel', () => {
    store.set(KEY, JSON.stringify(STAND_VON_GESTERN));
    useHardwareStore.getState().hydrateFromLocal();
    const cfg = useHardwareStore.getState().config;

    // Beleg, dass der gespeicherte Stand wirklich angenommen wurde.
    expect(cfg.thermal.printerName).toBe('Warehouse14-Bon');
    expect(cfg.zvt.ip).toBe('192.168.1.50');
    expect(cfg.label.printerName).toBe('Warehouse14-Etikett');
    expect(cfg.tse.tssId).toBe('tss-1');

    for (const geraet of [cfg.thermal, cfg.label, cfg.zvt, cfg.tse]) {
      expect(geraet.lastReachable).toBeNull();
      expect(geraet.lastCheckedAt).toBeNull();
    }
  });

  it('lässt echte Einstellungen und den letzten Abgleich unberührt', () => {
    store.set(KEY, JSON.stringify(STAND_VON_GESTERN));
    useHardwareStore.getState().hydrateFromLocal();
    const cfg = useHardwareStore.getState().config;

    expect(cfg.thermal.mode).toBe('usb');
    expect(cfg.thermal.paperWidthMm).toBe(58);
    expect(cfg.scale.portPath).toBe('/dev/tty.usbserial-XYZ');
    // Ein stattgefundener Abgleich ist eine Tatsache der Vergangenheit, keine
    // Behauptung über das Jetzt — der bleibt stehen.
    expect(cfg.tse.lastSyncAt).toBe('2026-07-25T18:04:00.000Z');
  });

  it('schreibt eine frische Messung NICHT auf die Platte', () => {
    markDeviceReachable('thermal', true);

    // Im laufenden Programm gilt die Messung ...
    expect(useHardwareStore.getState().config.thermal.lastReachable).toBe(true);
    expect(useHardwareStore.getState().config.thermal.lastCheckedAt).not.toBeNull();

    // ... aber sie überlebt keinen Neustart.
    const gespeichert = JSON.parse(store.get(KEY) ?? '{}') as typeof STAND_VON_GESTERN;
    expect(gespeichert.thermal.lastReachable).toBeNull();
    expect(gespeichert.thermal.lastCheckedAt).toBeNull();
    // Die Einstellungen daneben müssen sehr wohl gespeichert bleiben.
    expect(gespeichert.thermal.port).toBe(9100);
  });
});

describe('markDeviceReachable — der eine Weg zur Marke', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    stubLocalStorage(store);
    useHardwareStore.setState({ loaded: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('setzt für jede Geräteart Erreichbarkeit und Zeitpunkt', () => {
    markDeviceReachable('thermal', false);
    markDeviceReachable('label', true);
    markDeviceReachable('zvt', false);
    markDeviceReachable('tse', true);

    const cfg = useHardwareStore.getState().config;
    expect(cfg.thermal.lastReachable).toBe(false);
    expect(cfg.label.lastReachable).toBe(true);
    expect(cfg.zvt.lastReachable).toBe(false);
    expect(cfg.tse.lastReachable).toBe(true);
    for (const geraet of [cfg.thermal, cfg.label, cfg.zvt, cfg.tse]) {
      expect(typeof geraet.lastCheckedAt).toBe('string');
    }
  });

  it('lässt die übrigen Einstellungen der Geräteart in Ruhe', () => {
    useHardwareStore.getState().setThermal({ mode: 'usb', printerName: 'Bon-1' });
    markDeviceReachable('thermal', false);

    const t = useHardwareStore.getState().config.thermal;
    expect(t.mode).toBe('usb');
    expect(t.printerName).toBe('Bon-1');
    expect(t.lastReachable).toBe(false);
  });
});
