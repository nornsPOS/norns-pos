/**
 * DIE ZUSAGE „ÜBERSTEHT EINEN NEUSTART" WIRD GEMESSEN, NICHT GEGLAUBT.
 *
 * ── DER GEMESSENE MANGEL (13.08.2026) ──────────────────────────────────────
 *
 * Die Belegliste behauptete auf dem Bildschirm, die Belege blieben „über einen
 * Neustart hinweg nachdruckbar". Der Speicher konnte das gar nicht wissen:
 *
 *     belegeSchreiben(belege);          // Rückgabewert weggeworfen
 *     set({ belege, lastReceipt: ... });
 *
 * `belegeSchreiben` schluckt einen vollen oder abgeschalteten Speicher
 * ABSICHTLICH (der Beleg ist in dem Moment schon gedruckt und verbucht, eine
 * Ausnahme würde den Verkauf abbrechen) und meldet den Fehlschlag NUR am
 * Rückgabewert. Genau der fiel unter den Tisch. Der Satz auf der Fläche war
 * damit eine Behauptung ohne Messung, und auf einer Kasse mit vollem Speicher
 * schlicht falsch: der Kunde kam am nächsten Morgen mit seinem Bon und bekam
 * nichts.
 *
 * Diese Datei hält beide Richtungen fest.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BELEGARCHIV_SCHLUESSEL } from '../lib/belegarchiv.js';
import type { ThermalReceiptData } from '../lib/hardware-client.js';

function beleg(nummer: string): ThermalReceiptData {
  return {
    shopName: 'Goldhaus Basel',
    shopAddress: ['Marktplatz 1'],
    shopVatId: 'DE123456789',
    shopTaxNumber: '',
    shopPhone: null,
    receiptLocator: nummer,
    printedAt: '3.8.2026, 09:15:00',
    cashierName: 'Bediener',
    shiftId: null,
    items: [
      {
        name: 'Ring',
        quantity: 1,
        unitPriceEur: '119.00',
        lineTotalEur: '119.00',
        vatLabel: '19%',
      },
    ],
    subtotalEur: '100.00',
    vatEur: '19.00',
    totalEur: '119.00',
    paymentMethodLabel: 'Bar',
    cashReceivedEur: null,
    changeEur: null,
    tseSignatureValue: 'sig',
    tseSignatureCounter: '7',
    tseTransactionNumber: '42',
    tseQrPayload: 'qr',
    footerLines: [],
  };
}

/** Eine Platte, die auf Wunsch keinen Schreibvorgang mehr annimmt. */
function platte(voll = false): Storage {
  const daten = new Map<string, string>();
  return {
    get length(): number {
      return daten.size;
    },
    clear: () => daten.clear(),
    getItem: (k: string) => daten.get(k) ?? null,
    key: (i: number) => Array.from(daten.keys())[i] ?? null,
    removeItem: (k: string) => void daten.delete(k),
    setItem: (k: string, v: string) => {
      if (voll) throw new Error('QuotaExceededError');
      daten.set(k, v);
    },
  } as Storage;
}

async function frischerSpeicher(
  lager: Storage | undefined,
): Promise<typeof import('./last-receipt-store.js')> {
  if (lager === undefined) {
    Reflect.deleteProperty(globalThis, 'localStorage');
  } else {
    Object.defineProperty(globalThis, 'localStorage', {
      value: lager,
      configurable: true,
      writable: true,
    });
  }
  vi.resetModules();
  return import('./last-receipt-store.js');
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('Der Speicher weiss, ob die Platte den Vorrat wirklich genommen hat', () => {
  it('eine tragende Platte lässt die Zusage stehen', async () => {
    const { useLastReceiptStore } = await frischerSpeicher(platte());

    useLastReceiptStore.getState().setLastReceipt(beleg('B-0001'));

    expect(useLastReceiptStore.getState().ueberlebtNeustart).toBe(true);
    expect(globalThis.localStorage.getItem(BELEGARCHIV_SCHLUESSEL)).not.toBeNull();
  });

  it('ein voller Speicher widerruft die Zusage', async () => {
    const { useLastReceiptStore } = await frischerSpeicher(platte(true));

    useLastReceiptStore.getState().setLastReceipt(beleg('B-0001'));

    expect(useLastReceiptStore.getState().ueberlebtNeustart).toBe(false);
  });

  it('der Verkauf läuft trotzdem weiter: der Beleg gilt für diese Sitzung', async () => {
    // Der Beleg ist in diesem Moment gedruckt und verbucht. Ein gescheiterter
    // Schreibvorgang darf ihn nicht auch noch aus dem Arbeitsspeicher werfen.
    const { useLastReceiptStore } = await frischerSpeicher(platte(true));

    expect(() => useLastReceiptStore.getState().setLastReceipt(beleg('B-0001'))).not.toThrow();
    expect(useLastReceiptStore.getState().belege).toHaveLength(1);
    expect(useLastReceiptStore.getState().lastReceipt?.receiptLocator).toBe('B-0001');
  });

  it('einmal verloren bleibt verloren, auch wenn die Platte später wieder trägt', async () => {
    // Der Beleg, der nicht auf die Platte kam, kommt durch einen späteren
    // gelungenen Schreibvorgang NICHT zurück. Die Zusage darf also nicht von
    // selbst wieder aufleben.
    let voll = true;
    const wackeligePlatte = {
      ...platte(),
      setItem: (): void => {
        if (voll) throw new Error('QuotaExceededError');
      },
      getItem: (): string | null => null,
    } as unknown as Storage;
    const { useLastReceiptStore } = await frischerSpeicher(wackeligePlatte);

    useLastReceiptStore.getState().setLastReceipt(beleg('B-0001'));
    voll = false;
    useLastReceiptStore.getState().setLastReceipt(beleg('B-0002'));

    expect(useLastReceiptStore.getState().ueberlebtNeustart).toBe(false);
  });

  it('ohne Speicher steht die Zusage vom ersten Augenblick an NICHT', async () => {
    // Ist der Speicher des Fensters abgeschaltet, überlebt nichts einen
    // Neustart, und das ist schon vor dem ersten Verkauf messbar. Vorher
    // behauptete die Fläche die Dauerhaftigkeit vom ersten Rendern an.
    const { useLastReceiptStore } = await frischerSpeicher(undefined);

    expect(useLastReceiptStore.getState().ueberlebtNeustart).toBe(false);
  });
});
