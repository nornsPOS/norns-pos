/**
 * Der Belegspeicher — die Regel, die den gemessenen Defekt festhält.
 *
 * VORHER (`last-receipt-store.ts`, Fassung bis 13.08.2026):
 *     setLastReceipt: (r) => set({ lastReceipt: r })
 * Ein Beleg, nur im Arbeitsspeicher, bedingungslos überschrieben.
 *
 * Hier wird der Speicher als Ganzes gefahren, samt Neustart: das Modul wird
 * verworfen und frisch geladen, während die Platte stehen bleibt. Genau das
 * passiert, wenn der Kassierer die Kasse morgens öffnet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BELEGARCHIV_SCHLUESSEL } from '../lib/belegarchiv.js';
import type { ThermalReceiptData } from '../lib/hardware-client.js';

function beleg(nummer: string, extra: Partial<ThermalReceiptData> = {}): ThermalReceiptData {
  return {
    shopName: 'Goldhaus Basel',
    shopAddress: ['Marktplatz 1', '12345 Musterstadt'],
    shopVatId: 'DE123456789',
    shopTaxNumber: '',
    shopPhone: null,
    receiptLocator: nummer,
    printedAt: '2026-08-13T09:15:00.000Z',
    cashierName: 'Hana',
    shiftId: 'schicht-1',
    items: [
      {
        name: 'Goldring 585',
        quantity: 1,
        unitPriceEur: '119.00',
        lineTotalEur: '119.00',
        vatLabel: 'A',
      },
    ],
    subtotalEur: '100.00',
    vatEur: '19.00',
    totalEur: '119.00',
    paymentMethodLabel: 'Bar',
    cashReceivedEur: '120.00',
    changeEur: '1.00',
    tseSignatureValue: 'sig',
    tseSignatureCounter: '7',
    tseTransactionNumber: '42',
    tseQrPayload: 'qr',
    footerLines: ['Vielen Dank für Ihren Besuch.'],
    ...extra,
  };
}

/** Die Platte des Fensters, nachgebaut — sie überlebt den Modulwechsel. */
function platteAnhaengen(): Storage {
  const daten = new Map<string, string>();
  const speicher = {
    get length(): number {
      return daten.size;
    },
    clear: () => daten.clear(),
    getItem: (k: string) => daten.get(k) ?? null,
    key: (i: number) => Array.from(daten.keys())[i] ?? null,
    removeItem: (k: string) => {
      daten.delete(k);
    },
    setItem: (k: string, v: string) => {
      daten.set(k, v);
    },
  } as Storage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: speicher,
    configurable: true,
    writable: true,
  });
  return speicher;
}

/** Die Kasse neu starten: Modul verwerfen, Platte behalten. */
async function kasseNeuStarten(): Promise<typeof import('./last-receipt-store.js')> {
  vi.resetModules();
  return import('./last-receipt-store.js');
}

let platte: Storage;

beforeEach(() => {
  platte = platteAnhaengen();
  vi.resetModules();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'localStorage');
});

describe('Nach dem nächsten Verkauf ist der vorige Beleg NOCH nachdruckbar', () => {
  it('zwei Verkäufe, zwei nachdruckbare Belege', async () => {
    const { useLastReceiptStore } = await kasseNeuStarten();

    useLastReceiptStore.getState().setLastReceipt(beleg('B-2026-0001'));
    useLastReceiptStore.getState().setLastReceipt(beleg('B-2026-0002'));

    const nummern = useLastReceiptStore.getState().belege.map((b) => b.receiptLocator);
    expect(nummern).toContain('B-2026-0001');
    expect(nummern).toContain('B-2026-0002');
  });

  it('`lastReceipt` ist IMMER der vorderste Beleg', async () => {
    // Zwei Felder, die getrennt geschrieben werden, laufen auseinander. Dieser
    // Satz hält fest, dass sie EINE Wahrheit bleiben — das Kassenbuch liest
    // `lastReceipt`, die neue Fläche liest `belege`.
    const { useLastReceiptStore } = await kasseNeuStarten();

    expect(useLastReceiptStore.getState().lastReceipt).toBeNull();

    useLastReceiptStore.getState().setLastReceipt(beleg('B-0001'));
    expect(useLastReceiptStore.getState().lastReceipt?.receiptLocator).toBe('B-0001');
    expect(useLastReceiptStore.getState().lastReceipt).toBe(useLastReceiptStore.getState().belege[0]);

    useLastReceiptStore.getState().setLastReceipt(beleg('B-0002'));
    expect(useLastReceiptStore.getState().lastReceipt?.receiptLocator).toBe('B-0002');
    expect(useLastReceiptStore.getState().lastReceipt).toBe(useLastReceiptStore.getState().belege[0]);
  });
});

describe('Der Neustart der Kasse löscht keinen Beleg', () => {
  it('nach dem Neustart liegen beide Belege wieder bereit', async () => {
    const erste = await kasseNeuStarten();
    erste.useLastReceiptStore.getState().setLastReceipt(beleg('B-2026-0001'));
    erste.useLastReceiptStore.getState().setLastReceipt(beleg('B-2026-0002'));

    // Die Kasse geht aus und wieder an. Nur die Platte bleibt.
    const zweite = await kasseNeuStarten();
    const zustand = zweite.useLastReceiptStore.getState();

    expect(zustand.belege.map((b) => b.receiptLocator)).toEqual(['B-2026-0002', 'B-2026-0001']);
    expect(zustand.lastReceipt?.receiptLocator).toBe('B-2026-0002');
    expect(zustand.belege.find((b) => b.receiptLocator === 'B-2026-0001')?.totalEur).toBe('119.00');
  });

  it('der Beleg liegt wirklich auf der Platte, nicht nur im Speicher', async () => {
    const { useLastReceiptStore } = await kasseNeuStarten();
    useLastReceiptStore.getState().setLastReceipt(beleg('B-0001'));

    const roh = platte.getItem(BELEGARCHIV_SCHLUESSEL);

    expect(roh).not.toBeNull();
    expect(roh).toContain('B-0001');
  });

  it('Leeren räumt Speicher UND Platte', async () => {
    const { useLastReceiptStore } = await kasseNeuStarten();
    useLastReceiptStore.getState().setLastReceipt(beleg('B-0001'));

    useLastReceiptStore.getState().clearLastReceipt();

    expect(useLastReceiptStore.getState().belege).toEqual([]);
    expect(useLastReceiptStore.getState().lastReceipt).toBeNull();
    expect(platte.getItem(BELEGARCHIV_SCHLUESSEL)).toBeNull();

    const nachNeustart = await kasseNeuStarten();
    expect(nachNeustart.useLastReceiptStore.getState().belege).toEqual([]);
  });
});
